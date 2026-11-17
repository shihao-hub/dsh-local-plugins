/**
 * Host half of the mcp-panel bundle.
 *
 * Serves one same-origin HTTP route:
 *   GET /plugin/mcp-panel/catalog
 *
 * The catalog joins four live facts of the Host composition:
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
 *   4. Context price — the heuristic tokens each server's tool declarations
 *      cost the model, under the Host's own 4-chars-per-token density. A
 *      server that publishes 170 tools can silently eat most of the context
 *      window, which is exactly the fact this panel must surface.
 *
 * Credential-shaped values never leave this half: environment variables and
 * HTTP headers are reported as counts only.
 *
 * The `webServer` route contract is Node-style — the handler receives
 * `(req, res)` and owns the whole response.
 */

/** Services this half needs: the HTTP carrier, the Loader entry table, the tool registry, and live agents. */
export const inject = ['webServer', 'loader', 'tools', 'agents'];

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const ROUTE = '/plugin/mcp-panel/catalog';
const ROUTE_TOGGLE = '/plugin/mcp-panel/toggle';
const ROUTE_RESTART = '/plugin/mcp-panel/restart-server';

/** Every Loader entry of this module is one configured MCP server. */
const MCP_MODULE = '@deepseek-ai/dsh-mcp-client';
/** Config shape of @deepseek-ai/dsh-mcp-client: reconnect defaults, restated for display. */
const RECONNECT_DEFAULTS = { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 };

/**
 * 工具定义的上下文计价口径，逐字复刻宿主自身的启发式估算：
 * `@deepseek-ai/dsh-token-meter/lib/types/estimate.js`（dsh 0.2.1-rc.2）把一组
 * 工具 schema 计价为 `ceil(JSON.stringify(tools).length / 4) + 4`，会话上下文
 * 计量条显示的 `toolsTokens` 就是同一数字。链接型本地插件无法 import 宿主内部
 * 包，因此在此重述；若未来宿主改变密度口径，需同步这两项常量。
 */
const CHARS_PER_TOKEN = 4;
/** 整个工具数组的结构性 JSON 开销，只在总量上计入一次（与 estimateToolsTokens 一致）。 */
const TOOLS_BLOCK_OVERHEAD = 4;

/**
 * 停用过的 server 仍要能回答"它停用前吃掉多少上下文"：工具 schema 在 server
 * 停用后已从注册表注销，无法现算，因此把每个 server 最后一次启用时的成本记账
 * 到 `~/.dsh/mcp-panel/tool-costs.json`（可用 DSH_MCP_PANEL_COSTS_FILE 覆盖，
 * 供测试隔离）。只在值变化时落盘；只读环境或写失败静默忽略，面板退回内存值。
 */
const COSTS_DIR = path.join(os.homedir(), '.dsh', 'mcp-panel');
const COSTS_FILE = process.env.DSH_MCP_PANEL_COSTS_FILE ?? path.join(COSTS_DIR, 'tool-costs.json');
const COSTS_VERSION = 1;
/** @type {{version: number, servers: Record<string, object>}|undefined} */
let costCache;

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
		const { servers, memoryProbed, toolDefinitions } = await collectCatalog(ctx);
		sendJson(res, 200, {
			ok: true,
			generatedAt: new Date().toISOString(),
			hostPid: process.pid,
			memoryProbed,
			toolDefinitions,
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
 * Loader entry, joined with that server's live tool registrations, its
 * context price (how many heuristic tokens its tool declarations cost the
 * model), and, when the process snapshot is available, its child-process
 * memory footprint.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {Promise<{servers: Array<object>, memoryProbed: boolean, toolDefinitions?: object}>}
 *   server rows, tools-bearing first, then by context price
 */
async function collectCatalog(ctx) {
	const resolved = resolveToolContext(ctx);
	const toolSchemas = resolved.toolSchemas;
	const snapshot = await processSnapshot();
	const descendants = snapshot.ok ? descendantProcesses(snapshot.processes, process.pid) : [];
	const schemaCharCounts = toolSchemas.map(schemaChars);
	const mcpEntries = [];
	for (const entry of ctx.loader.entries()) {
		if (entry?.options?.name === MCP_MODULE) mcpEntries.push(entry);
	}
	const groups = assignToolGroups(toolSchemas, mcpEntries.map(serverNameOf));
	const toolDefinitions = toolDefinitionTotals(toolSchemas, schemaCharCounts, groups);
	if (toolDefinitions !== undefined) toolDefinitions.basis = resolved.basis;
	const servers = [];
	/** Disabled servers with no recorded cost yet; a one-time backfill may fill them. */
	const missingCost = [];
	for (const entry of mcpEntries) {
		const options = entry.options;
		const config = isRecord(options.config) ? options.config : {};
		const serverName = serverNameOf(entry);
		const entryId = typeof options.id === 'string' ? options.id : undefined;
		const disabled = Boolean(entry.disabled);
		const prefix = `mcp__${serverName}__`;
		const tools = disabled
			? []
			: toolSchemas
				.map((tool, index) => ({ tool, index }))
				.filter(({ tool }) => isRecord(tool) && typeof tool.name === 'string' && tool.name.startsWith(prefix))
				.map(({ tool, index }) => ({
					name: tool.name,
					description: typeof tool.description === 'string' ? tool.description : '',
					params: countKeys(isRecord(tool.parameters) ? tool.parameters.properties : undefined),
					required: countKeys(isRecord(tool.parameters) ? tool.parameters.required : undefined),
					chars: schemaCharCounts[index],
					tokens: tokensOfChars(schemaCharCounts[index])
				}))
				.sort((a, b) => a.name.localeCompare(b.name));
		// A disabled or not-yet-connected server injects nothing, so its live
		// context price is genuinely zero. A disabled one still reports the last
		// cost recorded while it was enabled, marked stale, so "what did turning
		// it off free?" stays answerable after the tools are unregistered.
		const liveChars = disabled ? 0 : sumChars(schemaCharCounts.filter((_, index) => groups[index] === serverName));
		let toolChars = liveChars;
		let toolTokens = tokensOfChars(liveChars);
		let stale;
		if (disabled) {
			const remembered = lastServerCost(entryId);
			if (remembered !== undefined && typeof remembered.toolTokens === 'number' && remembered.toolTokens > 0) {
				toolChars = remembered.toolChars;
				toolTokens = remembered.toolTokens;
				stale = remembered;
			} else if (entryId !== undefined && entryId !== '') {
				missingCost.push({ entryId, serverName });
			}
		}
		const server = {
			entryId,
			serverName,
			disabled,
			toolChars,
			toolTokens,
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
		if (stale !== undefined) {
			server.costStale = true;
			server.costUpdatedAt = typeof stale.updatedAt === 'string' ? stale.updatedAt : undefined;
		}
		if (!disabled && toolChars > 0) {
			recordServerCost(entryId, serverName, liveChars, tokensOfChars(liveChars), tools.length);
		}
		if (!disabled && snapshot.ok && server.transport === 'stdio') {
			const memory = serverMemoryFootprint(descendants, server);
			if (memory !== undefined) server.memory = memory;
		}
		servers.push(server);
	}
	servers.sort((a, b) => {
		if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
		return (b.toolTokens ?? 0) - (a.toolTokens ?? 0) || b.tools.length - a.tools.length || a.serverName.localeCompare(b.serverName);
	});
	if (missingCost.length > 0) scheduleCostBackfill(missingCost);
	return { servers, memoryProbed: snapshot.ok, toolDefinitions };
}

/**
 * Pick the tool set that best represents what a live session actually sends to
 * the model. The bare registry view (`schemas()` without a scope) only covers
 * the GLOBAL layer, so agent-preset built-in tools are missing and every MCP
 * share looks inflated; an agent-scoped view includes them, and the session's
 * last logged request header is an independent cross-check. The widest candidate
 * across live agents wins, which is the closest match for "the session you are
 * looking at".
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {{toolSchemas: Array<object>, basis: {kind: string, agents: number, tools: number}}}
 */
function resolveToolContext(ctx) {
	const agents = typeof ctx.agents?.list === 'function' ? ctx.agents.list() : [];
	let best;
	for (const agent of agents) {
		const candidates = [];
		try {
			const schemas = ctx.tools.schemas(agent);
			if (Array.isArray(schemas) && schemas.length > 0) candidates.push({ tools: schemas, kind: 'agent' });
		} catch {
			/* a scope that refuses projection */
		}
		try {
			const header = agent?.session?.requestHeader?.();
			if (Array.isArray(header?.tools) && header.tools.length > 0) candidates.push({ tools: header.tools, kind: 'header' });
		} catch {
			/* no logged header yet */
		}
		for (const candidate of candidates) {
			if (best === undefined || candidate.tools.length > best.tools.length) best = candidate;
		}
	}
	if (best !== undefined) {
		return { toolSchemas: best.tools, basis: { kind: best.kind, agents: agents.length, tools: best.tools.length } };
	}
	const globalSchemas = Array.isArray(ctx.tools?.schemas?.()) ? ctx.tools.schemas() : [];
	return { toolSchemas: globalSchemas, basis: { kind: 'global', agents: agents.length, tools: globalSchemas.length } };
}

/** Load the persisted last-enabled cost ledger once; unreadable files start empty. */
function loadCostCache() {
	if (costCache !== undefined) return costCache;
	costCache = { version: COSTS_VERSION, servers: {} };
	try {
		const parsed = JSON.parse(fs.readFileSync(COSTS_FILE, 'utf8'));
		if (isRecord(parsed) && isRecord(parsed.servers)) {
			costCache = { version: COSTS_VERSION, servers: parsed.servers };
		}
	} catch {
		/* first run, unreadable file, or a read-only environment */
	}
	return costCache;
}

/** Persist the ledger atomically; failures keep the in-memory copy authoritative. */
function saveCostCache(cache) {
	try {
		fs.mkdirSync(path.dirname(COSTS_FILE), { recursive: true });
		const tmp = COSTS_FILE + '.' + Date.now().toString(16) + '.tmp';
		fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n', 'utf8');
		fs.renameSync(tmp, COSTS_FILE);
	} catch {
		/* read-only home or transient disk failure */
	}
}

/** Remember one enabled server's cost, writing only when a value actually changed. */
function recordServerCost(entryId, serverName, toolChars, toolTokens, tools) {
	if (typeof entryId !== 'string' || entryId === '') return;
	const cache = loadCostCache();
	const previous = cache.servers[entryId];
	if (
		previous !== undefined &&
		previous.serverName === serverName &&
		previous.toolChars === toolChars &&
		previous.toolTokens === toolTokens &&
		previous.tools === tools
	) {
		return;
	}
	cache.servers[entryId] = { serverName, toolChars, toolTokens, tools, updatedAt: new Date().toISOString() };
	saveCostCache(cache);
}

/** The last recorded cost of one server, or undefined when it was never enabled here. */
function lastServerCost(entryId) {
	if (typeof entryId !== 'string' || entryId === '') return undefined;
	const cache = loadCostCache();
	return isRecord(cache.servers[entryId]) ? cache.servers[entryId] : undefined;
}

//#region 停用成本历史补录
/**
 * 面板第一次遇到"停用但从未记账"的 server 时（典型场景：插件升级前就已经关掉
 * 的 rea），从最近的历史会话日志里回溯它最后一次启用时的工具定义，补进成本
 * 账本。只跑一次、后台执行、只读会话文件；任何一个环节失败都静默放弃。
 */
const SESSIONS_DIR = process.env.DSH_MCP_PANEL_SESSIONS_DIR ?? path.join(os.homedir(), '.dsh', 'sessions');
const BACKFILL_FILE_LIMIT = 40;
const BACKFILL_DELAY_MS = 1200;
const ZSTD_MAGIC = 4247762216;
let backfillStarted = false;

/** Queue one background backfill pass; the caller never waits for it. */
function scheduleCostBackfill(targets) {
	if (backfillStarted || targets.length === 0) return;
	backfillStarted = true;
	const timer = setTimeout(() => {
		try {
			backfillCosts(targets);
		} catch {
			/* best effort: the panel keeps showing — for that row */
		}
	}, BACKFILL_DELAY_MS);
	if (typeof timer.unref === 'function') timer.unref();
}

/** Walk the session store and return its newest log files. */
function listSessionLogs(limit) {
	const files = [];
	const walk = (dir, depth) => {
		if (depth > 3) return;
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full, depth + 1);
			} else if (entry.name.endsWith('.jsonl.zstd') || entry.name.endsWith('.jsonl')) {
				try {
					files.push({ path: full, mtime: fs.statSync(full).mtimeMs });
				} catch {
					/* unreadable entry */
				}
			}
		}
	};
	walk(SESSIONS_DIR, 0);
	return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

/** Locate complete Zstandard frames in the concatenated-frame session container. */
function scanZstdFrames(buffer) {
	const frames = [];
	let offset = 0;
	while (offset < buffer.length) {
		const start = offset;
		if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
		offset += 4;
		if (offset === buffer.length) break;
		const descriptor = buffer.readUInt8(offset);
		offset += 1;
		const contentSizeFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 32) !== 0;
		const checksum = (descriptor & 4) !== 0;
		const dictionaryFlag = descriptor & 3;
		const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
		const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
		offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
		for (;;) {
			if (buffer.length - offset < 3) return frames;
			const blockHeader = buffer.readUIntLE(offset, 3);
			offset += 3;
			const lastBlock = (blockHeader & 1) !== 0;
			const blockType = (blockHeader >>> 1) & 3;
			offset += blockType === 1 ? 1 : blockHeader >>> 3;
			if (lastBlock) break;
		}
		if (checksum) offset += 4;
		frames.push({ start, end: offset });
	}
	return frames;
}

/** Decode one session log (plaintext or multi-frame zstd) to text. */
function readSessionText(file) {
	const raw = fs.readFileSync(file);
	if (file.endsWith('.jsonl')) return raw.toString('utf8');
	const parts = [];
	for (const frame of scanZstdFrames(raw)) {
		try {
			parts.push(zstdDecompressSync(raw.subarray(frame.start, frame.end)));
		} catch {
			/* skip a damaged frame */
		}
	}
	return Buffer.concat(parts).toString('utf8');
}

/** The tools of the last logged request header in one session log, optionally one that still carried `prefix`. */
function lastRequestTools(text, prefix) {
	let last;
	for (const line of text.split('\n')) {
		if (line.trim() === '') continue;
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (record?.type !== 'request/header' || !Array.isArray(record.data?.header?.tools)) continue;
		const tools = record.data.header.tools;
		if (prefix !== undefined && !tools.some((tool) => typeof tool?.name === 'string' && tool.name.startsWith(prefix))) {
			continue;
		}
		last = tools;
	}
	return last;
}

/** For each watched prefix, the LAST header inside one log that still declared it. */
function lastToolsByPrefix(text, prefixes) {
	const found = new Map();
	for (const line of text.split('\n')) {
		if (line.trim() === '') continue;
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (record?.type !== 'request/header' || !Array.isArray(record.data?.header?.tools)) continue;
		const tools = record.data.header.tools;
		for (const prefix of prefixes) {
			if (tools.some((tool) => typeof tool?.name === 'string' && tool.name.startsWith(prefix))) {
				found.set(prefix, tools);
			}
		}
	}
	return found;
}

/** Fill the cost ledger for disabled servers from the newest session that still carried them. */
function backfillCosts(targets) {
	const pending = new Map(targets.map((target) => [target.serverName, target]));
	const prefixes = new Map([...pending.values()].map((target) => [`mcp__${target.serverName}__`, target]));
	for (const file of listSessionLogs(BACKFILL_FILE_LIMIT)) {
		if (pending.size === 0) break;
		let matches;
		try {
			matches = lastToolsByPrefix(readSessionText(file.path), [...prefixes.keys()]);
		} catch {
			continue;
		}
		for (const [prefix, tools] of matches) {
			const target = prefixes.get(prefix);
			if (target === undefined || !pending.has(target.serverName)) continue;
			const owned = tools.filter((tool) => typeof tool?.name === 'string' && tool.name.startsWith(prefix));
			if (owned.length === 0) continue;
			const chars = sumChars(owned.map(schemaChars));
			recordServerCost(target.entryId, target.serverName, chars, tokensOfChars(chars), owned.length);
			pending.delete(target.serverName);
		}
	}
}
//#endregion

/** The display name of one MCP Loader entry: `serverName`, else its id, else `mcp`. */
function serverNameOf(entry) {
	const options = entry?.options ?? {};
	const config = isRecord(options.config) ? options.config : {};
	if (typeof config.serverName === 'string' && config.serverName !== '') return config.serverName;
	if (typeof options.id === 'string' && options.id !== '') return options.id;
	return 'mcp';
}

/** One tool schema's JSON character count; undefined when it cannot be serialized. */
function schemaChars(schema) {
	try {
		return JSON.stringify(schema).length;
	} catch {
		return undefined;
	}
}

/** `ceil(chars / CHARS_PER_TOKEN)`; undefined when the count is unusable. */
function tokensOfChars(chars) {
	if (typeof chars !== 'number' || !Number.isFinite(chars) || chars < 0) return undefined;
	return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Sum defined character counts. */
function sumChars(list) {
	let total = 0;
	for (const value of list) {
		if (typeof value === 'number' && Number.isFinite(value)) total += value;
	}
	return total;
}

/**
 * Attribute every registered tool to the MCP server whose `mcp__<name>__`
 * prefix matches it, longest server name first so two servers whose names
 * share a prefix never steal each other's tools. Unmatched tools are built-in.
 * @param {Array<object>} toolSchemas - registered model-facing tool schemas
 * @param {Array<string>} serverNames - configured MCP server names
 * @returns {Array<string|undefined>} one group per schema, aligned by index
 */
function assignToolGroups(toolSchemas, serverNames) {
	const prefixes = [...new Set(serverNames)]
		.filter((name) => typeof name === 'string' && name !== '')
		.sort((a, b) => b.length - a.length)
		.map((name) => ({ name, prefix: `mcp__${name}__` }));
	return toolSchemas.map((tool) => {
		const toolName = typeof tool?.name === 'string' ? tool.name : '';
		for (const { name, prefix } of prefixes) {
			if (toolName.startsWith(prefix)) return name;
		}
		return undefined;
	});
}

/**
 * Price the whole registered tool set exactly as the Host's token meter does
 * (`ceil(chars / 4) + 4`), and split it into the MCP servers' share and the
 * built-in remainder, so the panel can show what MCP actually costs.
 * @returns {{chars: number, tokens: number, mcp: {chars: number, tokens: number}, builtin: {chars: number, tokens: number}}|undefined}
 */
function toolDefinitionTotals(toolSchemas, schemaCharCounts, groups) {
	let totalChars;
	try {
		totalChars = JSON.stringify(toolSchemas).length;
	} catch {
		return undefined;
	}
	const mcpChars = sumChars(schemaCharCounts.filter((_, index) => groups[index] !== undefined));
	const builtinChars = sumChars(schemaCharCounts.filter((_, index) => groups[index] === undefined));
	return {
		chars: totalChars,
		tokens: tokensOfChars(totalChars) + TOOLS_BLOCK_OVERHEAD,
		mcp: { chars: mcpChars, tokens: tokensOfChars(mcpChars) },
		builtin: { chars: builtinChars, tokens: tokensOfChars(builtinChars) }
	};
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
/**
 * Patch-file layers a persisted toggle may have to touch, home layer first.
 * The home layer (`$DSH_HOME/cordis.patch.yml`) is applied LAST for every
 * profile, so it owns user-level server inserts; omitting it made a toggle of
 * such a server survive only in memory and re-enable on the next restart.
 * @returns {Array<string>} every candidate path, whether or not it exists
 */
function patchFileCandidates() {
	const home = os.homedir();
	return [
		path.join(home, '.dsh', 'cordis.patch.yml'),
		path.join(home, '.dsh', 'profiles', 'web', 'cordis.patch.yml'),
		path.join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')
	];
}

/** Locate existing cordis patch files across every layer a dsh install may use. */
function getPatchFilePaths() {
	return patchFileCandidates().filter((p) => {
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
	collectCatalog,
	resolveToolContext,
	loadCostCache,
	recordServerCost,
	lastServerCost,
	backfillCosts,
	scanZstdFrames,
	lastRequestTools,
	lastToolsByPrefix,
	readSessionText,
	descendantProcesses,
	serverMemoryFootprint,
	basenameOf,
	serverNameOf,
	schemaChars,
	tokensOfChars,
	sumChars,
	assignToolGroups,
	toolDefinitionTotals,
	updateYamlEntryDisabled,
	patchFileCandidates,
	findMcpEntry,
	sameOrigin
};
