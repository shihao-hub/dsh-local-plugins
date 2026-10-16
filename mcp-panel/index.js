/**
 * Host half of the mcp-panel bundle.
 *
 * Serves one same-origin HTTP route:
 *   GET /plugin/mcp-panel/catalog
 *
 * The catalog joins three live facts of the Host composition:
 *   1. Configuration — every Loader entry whose module is
 *      `@deepseek-ai/dsh-mcp-client` (each entry = one configured MCP server,
 *      inserted by the profile patch or by a bundle patch such as argo's).
 *   2. Runtime — the tools each server currently has registered in the global
 *      tool registry (`mcp__<serverName>__*`). A non-empty list is the
 *      observable proof that the server connected and synced its tools; an
 *      empty list means still connecting, failed, or genuinely tool-less.
 *   3. Footprint — the working-set memory of each stdio server's process
 *      subtree. MCP servers are child processes of THIS Host runtime, so the
 *      snapshot is filtered to the Host's descendant tree first (another
 *      app's same-named server never counts) and then matched per server by
 *      its command AND at least one distinctive argument token, so same-command
 *      servers (`node.exe`) never sum one another's subtrees; matched subtrees
 *      are summed (uvx → python, npx → node chains included).
 *
 * Credential-shaped values never leave this half: environment variables and
 * HTTP headers are reported as counts only.
 *
 * The `webServer` route contract is Node-style — the handler receives
 * `(req, res)` and owns the whole response.
 */

/** Services this half needs: the HTTP carrier, the Loader entry table, and the tool registry. */
export const inject = ['webServer', 'loader', 'tools'];

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROUTE = '/plugin/mcp-panel/catalog';
const ROUTE_TOGGLE = '/plugin/mcp-panel/toggle';
const ROUTE_RESTART = '/plugin/mcp-panel/restart-server';

/** Every Loader entry of this module is one configured MCP server. */
const MCP_MODULE = '@deepseek-ai/dsh-mcp-client';
/** Config shape of @deepseek-ai/dsh-mcp-client: reconnect defaults, restated for display. */
const RECONNECT_DEFAULTS = { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 };

/** Process-snapshot cache: one PowerShell enumeration serves every fetch within the TTL. */
const MEMORY_TTL_MS = 10000;
const MEMORY_FAILURE_TTL_MS = 3000;
const PS_TIMEOUT_MS = 8000;
let memoryCache = { at: 0, ok: false, processes: [] };

/**
 * Mount the catalog, toggle, and server-restart routes for the lifetime of this bundle.
 * @param {import('@deepseek-ai/cordis').Context} ctx - context with `webServer`, `loader`, `tools`.
 */
export function apply(ctx) {
	ctx.effect(
		() => {
			const unregCatalog = ctx.webServer.register({
				kind: 'exact',
				path: ROUTE,
				handler: (req, res) => handleCatalog(req, res, ctx)
			});
			const unregToggle = ctx.webServer.register({
				kind: 'exact',
				path: ROUTE_TOGGLE,
				handler: (req, res) => handleToggle(req, res, ctx)
			});
			const unregRestart = ctx.webServer.register({
				kind: 'exact',
				path: ROUTE_RESTART,
				handler: (req, res) => handleRestart(req, res, ctx)
			});
			return () => {
				try { unregCatalog(); } catch { /* ignore */ }
				try { unregToggle(); } catch { /* ignore */ }
				try { unregRestart(); } catch { /* ignore */ }
			};
		},
		'mcp-panel: routes'
	);
}

/** Check same-origin for mutation requests. Local tooling without origin header is accepted. */
function sameOrigin(req) {
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	const host = req.headers.host;
	if (typeof host !== 'string' || host === '') return false;
	return origin === 'http://' + host || origin === 'https://' + host;
}

/** Read incoming request stream to parsed JSON or undefined. */
function readJsonBody(req) {
	return new Promise((resolve) => {
		let data = '';
		req.on('data', (chunk) => { data += chunk; });
		req.on('end', () => {
			if (!data.trim()) {
				resolve(undefined);
				return;
			}
			try {
				resolve(JSON.parse(data));
			} catch {
				resolve(undefined);
			}
		});
		req.on('error', () => resolve(undefined));
	});
}

/** Find one MCP Loader entry by its entryId. */
function findMcpEntry(ctx, entryId) {
	if (!ctx.loader || typeof ctx.loader.entries !== 'function') return undefined;
	for (const entry of ctx.loader.entries()) {
		if (entry?.options?.name === MCP_MODULE && entry?.options?.id === entryId) {
			return entry;
		}
	}
	return undefined;
}

/**
 * Handle catalog request.
 */
async function handleCatalog(req, res, ctx) {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		sendJson(res, 405, { ok: false, error: 'GET only' });
		return;
	}
	try {
		const { servers, memoryProbed } = await collectCatalog(ctx);
		sendJson(res, 200, {
			ok: true,
			generatedAt: new Date().toISOString(),
			hostPid: process.pid,
			memoryProbed,
			servers
		});
	} catch (error) {
		sendJson(res, 500, { ok: false, error: error?.message ?? String(error) });
	}
}

/**
 * Handle toggle request: turn an MCP server entry on or off at runtime and persist to patch yml.
 */
async function handleToggle(req, res, ctx) {
	if (req.method !== 'POST') {
		sendJson(res, 405, { ok: false, error: 'POST only' });
		return;
	}
	if (!sameOrigin(req)) {
		sendJson(res, 403, { ok: false, error: 'cross-origin requests are rejected' });
		return;
	}
	const body = await readJsonBody(req);
	if (!isRecord(body) || typeof body.entryId !== 'string' || typeof body.enabled !== 'boolean') {
		sendJson(res, 400, { ok: false, error: 'invalid payload: entryId (string) and enabled (boolean) required' });
		return;
	}
	const { entryId, enabled } = body;
	const entry = findMcpEntry(ctx, entryId);
	if (!entry) {
		sendJson(res, 404, { ok: false, error: `MCP entry "${entryId}" not found` });
		return;
	}
	try {
		const targetDisabled = !enabled;
		if (Boolean(entry.disabled) !== targetDisabled) {
			await entry.update({ disabled: targetDisabled });
		}
		persistEntryDisabled(entryId, targetDisabled);
		sendJson(res, 200, { ok: true, entryId, enabled });
	} catch (error) {
		sendJson(res, 500, { ok: false, error: error?.message ?? String(error) });
	}
}

/**
 * Handle hot restart of a single MCP server: dispose and re-init in-place.
 */
async function handleRestart(req, res, ctx) {
	if (req.method !== 'POST') {
		sendJson(res, 405, { ok: false, error: 'POST only' });
		return;
	}
	if (!sameOrigin(req)) {
		sendJson(res, 403, { ok: false, error: 'cross-origin requests are rejected' });
		return;
	}
	const body = await readJsonBody(req);
	if (!isRecord(body) || typeof body.entryId !== 'string') {
		sendJson(res, 400, { ok: false, error: 'invalid payload: entryId (string) required' });
		return;
	}
	const { entryId } = body;
	const entry = findMcpEntry(ctx, entryId);
	if (!entry) {
		sendJson(res, 404, { ok: false, error: `MCP entry "${entryId}" not found` });
		return;
	}
	try {
		if (entry.disabled) {
			await entry.update({ disabled: false });
			persistEntryDisabled(entryId, false);
		} else {
			await entry.update({ disabled: true });
			await new Promise((r) => setTimeout(r, 150));
			await entry.update({ disabled: false });
		}
		sendJson(res, 200, { ok: true, entryId, status: 'restarted' });
	} catch (error) {
		sendJson(res, 500, { ok: false, error: error?.message ?? String(error) });
	}
}

/**
 * Build the MCP server catalog: one row per `@deepseek-ai/dsh-mcp-client`
 * Loader entry, joined with that server's live tool registrations and, when
 * the process snapshot is available, its child-process memory footprint.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {Promise<{servers: Array<object>, memoryProbed: boolean}>}
 *   server rows, tools-bearing first, then by name
 */
async function collectCatalog(ctx) {
	const toolSchemas = Array.isArray(ctx.tools?.schemas?.()) ? ctx.tools.schemas() : [];
	const snapshot = await processSnapshot();
	const descendants = snapshot.ok ? descendantProcesses(snapshot.processes, process.pid) : [];
	const servers = [];
	for (const entry of ctx.loader.entries()) {
		const options = entry?.options ?? {};
		if (options.name !== MCP_MODULE) continue;
		const config = isRecord(options.config) ? options.config : {};
		const serverName =
			typeof config.serverName === 'string' && config.serverName !== ''
				? config.serverName
				: typeof options.id === 'string'
					? options.id
					: 'mcp';
		const disabled = Boolean(entry.disabled);
		const prefix = `mcp__${serverName}__`;
		const tools = disabled
			? []
			: toolSchemas
				.filter((tool) => isRecord(tool) && typeof tool.name === 'string' && tool.name.startsWith(prefix))
				.map((tool) => ({
					name: tool.name,
					description: typeof tool.description === 'string' ? tool.description : '',
					params: countKeys(isRecord(tool.parameters) ? tool.parameters.properties : undefined),
					required: countKeys(isRecord(tool.parameters) ? tool.parameters.required : undefined)
				}))
				.sort((a, b) => a.name.localeCompare(b.name));
		const server = {
			entryId: typeof options.id === 'string' ? options.id : undefined,
			serverName,
			disabled,
			transport: config.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
			command: typeof config.command === 'string' ? config.command : undefined,
			args: Array.isArray(config.args) ? config.args.filter((arg) => typeof arg === 'string') : undefined,
			cwd: typeof config.cwd === 'string' && config.cwd !== '' ? config.cwd : undefined,
			envCount: countKeys(config.env),
			url: typeof config.url === 'string' ? config.url : undefined,
			headerCount: countKeys(config.headers),
			toolCallTimeoutMs: typeof config.toolCallTimeoutMs === 'number' ? config.toolCallTimeoutMs : undefined,
			failOnStartupError: config.failOnStartupError === true,
			reconnect: normalizeReconnect(config.reconnect),
			tools
		};
		if (!disabled && snapshot.ok && server.transport === 'stdio') {
			const memory = serverMemoryFootprint(descendants, server);
			if (memory !== undefined) server.memory = memory;
		}
		servers.push(server);
	}
	servers.sort((a, b) => {
		if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
		return b.tools.length - a.tools.length || a.serverName.localeCompare(b.serverName);
	});
	return { servers, memoryProbed: snapshot.ok };
}

/** Display-ready reconnect summary; omission falls back to the client bundle's defaults. */
function normalizeReconnect(raw) {
	const enabled = isRecord(raw) && typeof raw.enabled === 'boolean' ? raw.enabled : RECONNECT_DEFAULTS.enabled;
	const maxAttempts =
		isRecord(raw) && Number.isFinite(raw.maxAttempts) ? raw.maxAttempts : RECONNECT_DEFAULTS.maxAttempts;
	return { enabled, maxAttempts };
}

//#region process footprint
/**
 * One Win32 process snapshot, served from cache within the TTL.
 * @returns {Promise<{ok: boolean, processes: Array<object>}>}
 */
async function processSnapshot() {
	const ttl = memoryCache.ok ? MEMORY_TTL_MS : MEMORY_FAILURE_TTL_MS;
	if (Date.now() - memoryCache.at < ttl) return { ok: memoryCache.ok, processes: memoryCache.processes };
	const processes = await enumerateProcesses();
	memoryCache = { at: Date.now(), ok: processes !== undefined, processes: processes ?? [] };
	return { ok: memoryCache.ok, processes: memoryCache.processes };
}

/**
 * Enumerate every process once via PowerShell/CIM: pid, parent pid, working
 * set, executable path, and command line.
 * @returns {Promise<Array<object>|undefined>} rows, or undefined on failure
 */
function enumerateProcesses() {
	const script =
		"$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" +
		'@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,ExecutablePath,CommandLine | ConvertTo-Json -Compress -Depth 2)';
	return new Promise((resolve) => {
		execFile(
			'powershell.exe',
			['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
			{ timeout: PS_TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
			(error, stdout) => {
				if (error && !stdout) {
					resolve(undefined);
					return;
				}
				try {
					const parsed = JSON.parse(stdout);
					resolve(Array.isArray(parsed) ? parsed : isRecord(parsed) ? [parsed] : []);
				} catch {
					resolve(undefined);
				}
			}
		);
	});
}

/**
 * The descendant subtree of one pid (excluding the pid itself).
 * @param {Array<object>} processes - full snapshot rows
 * @param {number} rootPid - the Host runtime's own pid
 * @returns {Array<object>} descendant rows in snapshot order
 */
function descendantProcesses(processes, rootPid) {
	const byParent = new Map();
	for (const proc of processes) {
		if (!Number.isFinite(proc?.ParentProcessId)) continue;
		if (!byParent.has(proc.ParentProcessId)) byParent.set(proc.ParentProcessId, []);
		byParent.get(proc.ParentProcessId).push(proc);
	}
	const descendants = [];
	const walk = (pid) => {
		for (const child of byParent.get(pid) ?? []) {
			descendants.push(child);
			walk(child.ProcessId);
		}
	};
	walk(rootPid);
	return descendants;
}

/**
 * Sum the working-set footprint of one stdio server's process subtree.
 * Seeds are Host descendants matching this server's command AND at least one
 * of its distinctive (non-flag) arguments; every descendant of a seed counts,
 * so launcher chains (uvx → python, npx → cmd → node) are covered. Requiring
 * both keeps same-command servers (`node.exe`) from summing one another's
 * subtrees. Another user session's same-named server never matches: it lives
 * outside this Host's descendant tree.
 * @param {Array<object>} descendants - Host descendant rows
 * @param {object} server - catalog server row (command/args)
 * @returns {{bytes: number, processes: number}|undefined} undefined when nothing matches
 */
function serverMemoryFootprint(descendants, server) {
	const commandBase = basenameOf(server.command);
	const tokens = (Array.isArray(server.args) ? server.args : [])
		.filter((arg) => typeof arg === 'string' && !arg.startsWith('-') && arg.length >= 4)
		.map((arg) => arg.toLowerCase());
	if (commandBase === '' && tokens.length === 0) return undefined;
	const commandPattern = commandBase === '' ? undefined : wordBoundaryPattern(commandBase);
	const tokenPatterns = tokens.map((token) => wordBoundaryPattern(token));
	const seeds = descendants.filter((proc) => {
		const exe = String(proc?.ExecutablePath ?? '').toLowerCase();
		const cmd = String(proc?.CommandLine ?? '').toLowerCase();
		if (commandBase !== '') {
			const commandMatches =
				basenameOf(exe) === commandBase || (commandPattern !== undefined && commandPattern.test(cmd));
			if (!commandMatches) return false;
		}
		// A command-only match is shared by every same-command server (`node.exe` is
		// common to chrome-devtools, argo, agy, …), which made each of those rows
		// sum the UNION of all such servers. Requiring a distinctive argument token
		// as well pins the seed to this server's own wrapper; only a server that
		// declares no usable token falls back to command-only matching.
		if (tokenPatterns.length === 0) return true;
		return tokenPatterns.some((pattern) => pattern.test(cmd));
	});
	if (seeds.length === 0) return undefined;
	const byParent = new Map();
	for (const proc of descendants) {
		if (!Number.isFinite(proc?.ParentProcessId)) continue;
		if (!byParent.has(proc.ParentProcessId)) byParent.set(proc.ParentProcessId, []);
		byParent.get(proc.ParentProcessId).push(proc);
	}
	const picked = new Set();
	const walk = (pid) => {
		if (picked.has(pid)) return;
		picked.add(pid);
		for (const child of byParent.get(pid) ?? []) walk(child.ProcessId);
	};
	for (const seed of seeds) walk(seed.ProcessId);
	let bytes = 0;
	let count = 0;
	for (const proc of descendants) {
		if (!picked.has(proc.ProcessId)) continue;
		bytes += Number.isFinite(proc?.WorkingSetSize) ? proc.WorkingSetSize : 0;
		count += 1;
	}
	return { bytes, processes: count };
}

/** Basename across separators; empty for non-strings. */
function basenameOf(value) {
	if (typeof value !== 'string' || value === '') return '';
	const parts = value.split(/[\\/]/);
	return (parts[parts.length - 1] ?? '').toLowerCase();
}

/** Case-agnostic regex matching one token not glued into a longer flag/word. */
function wordBoundaryPattern(token) {
	const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?<![\\w:.\\\\/-])${escaped}(?![\\w-])`);
}
//#endregion

/** Narrow one JSON value to a plain object. */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Count the enumerable keys of an object value (or items of an array); other values count as zero. */
function countKeys(value) {
	if (Array.isArray(value)) return value.length;
	return isRecord(value) ? Object.keys(value).length : 0;
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} data */
function sendJson(res, status, data) {
	if (res.headersSent || res.writableEnded) return;
	const payload = JSON.stringify(data);
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(payload)
	});
	res.end(payload);
}

//#region persistence
/** Locate known cordis patch files across standard dsh profiles. */
function getPatchFilePaths() {
	const home = os.homedir();
	const candidates = [
		path.join(home, '.dsh', 'profiles', 'web', 'cordis.patch.yml'),
		path.join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')
	];
	return candidates.filter((p) => {
		try {
			return fs.existsSync(p);
		} catch {
			return false;
		}
	});
}

/**
 * Line-based update of disabled field on an id-targeted YAML entry.
 * Preserves comments, spacing, and !!js tags without destructive full-document re-serialization.
 * @param {string} content
 * @param {string} targetId
 * @param {boolean} disabled
 * @returns {{changed: boolean, content: string}}
 */
function updateYamlEntryDisabled(content, targetId, disabled) {
	const lines = content.split(/\r?\n/);
	let foundIndex = -1;
	let entryIndent = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const match = line.match(/^(\s*)-\s+id:\s*['"]?([^'"\s]+)['"]?/);
		if (match && match[2] === targetId) {
			foundIndex = i;
			entryIndent = match[1].length;
			break;
		}
	}
	if (foundIndex === -1) return { changed: false, content };

	const subIndent = ' '.repeat(entryIndent + 2);
	let disabledLineIndex = -1;
	for (let i = foundIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*$/.test(line)) continue;
		const match = line.match(/^(\s*)-/);
		if (match && match[1].length <= entryIndent) break;
		const topMatch = line.match(/^(\s*)[a-zA-Z0-9_-]+:/);
		if (topMatch && topMatch[1].length <= entryIndent) break;
		if (/^\s*disabled:/.test(line)) {
			disabledLineIndex = i;
		}
	}

	if (disabled) {
		if (disabledLineIndex !== -1) {
			lines[disabledLineIndex] = subIndent + 'disabled: true';
		} else {
			lines.splice(foundIndex + 1, 0, subIndent + 'disabled: true');
		}
	} else {
		if (disabledLineIndex !== -1) {
			lines.splice(disabledLineIndex, 1);
		}
	}
	return { changed: true, content: lines.join('\n') };
}

/**
 * Persist the disabled state of an MCP entry to disk across profiles.
 * @param {string} entryId
 * @param {boolean} disabled
 */
function persistEntryDisabled(entryId, disabled) {
	for (const filePath of getPatchFilePaths()) {
		try {
			const raw = fs.readFileSync(filePath, 'utf8');
			const { changed, content } = updateYamlEntryDisabled(raw, entryId, disabled);
			if (changed && content !== raw) {
				const tmp = filePath + '.' + Date.now().toString(16) + '.tmp';
				fs.writeFileSync(tmp, content, 'utf8');
				fs.renameSync(tmp, filePath);
			}
		} catch {
			// Best-effort write-back
		}
	}
}
//#endregion

/** Exposed for offline tests; not part of the bundle contract. */
export const __test = {
	descendantProcesses,
	serverMemoryFootprint,
	basenameOf,
	updateYamlEntryDisabled,
	findMcpEntry,
	sameOrigin
};
