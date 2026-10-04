/**
 * Host half of the app-restart bundle.
 *
 * Serves three loopback HTTP routes on the Host web server:
 *   GET  /plugin/app-restart/status   — diagnostics (parent app exe, helper paths) + one-time token
 *   POST /plugin/app-restart/restart  — kill the app tree, then relaunch it
 *   POST /plugin/app-restart/quit     — kill the app tree, do not relaunch
 *
 * The Host runtime is a plain Node child of the Electron desktop shell, so it
 * cannot call `app.relaunch()` or `app.quit()`. Instead this half writes a
 * small PowerShell helper and launches it OUT of the app's process tree (via
 * WMI, so the helper's parent is the WMI provider, not the runtime). The
 * helper waits for the HTTP response to flush, force-kills the app tree,
 * waits for exit, and — for restart — starts the app executable again.
 *
 * If the WMI launch fails, the helper is spawned detached as a fallback; in
 * that mode it kills only the shell PID and the Host runtime PID (never /T,
 * which would walk the tree and kill the helper itself).
 */
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROUTE_PREFIX = '/plugin/app-restart';
const HELPER_NAME = 'dsh-app-restart-helper.ps1';
const LOG_NAME = 'dsh-app-restart.log';
const APP_EXE_NAME = 'DeepSeek Harness.exe';
const KILL_DELAY_MS = 800;
const POWERSHELL_TIMEOUT_MS = 15000;

/** One PowerShell helper that relaunches the app after the tree is gone. */
const HELPER_SOURCE = String.raw`
param(
	[Parameter(Mandatory = $true)][string]$ExePath,
	[Parameter(Mandatory = $true)][int]$MainPid,
	[int]$HostPid = 0,
	[switch]$TreeKill,
	[switch]$NoRelaunch,
	[int]$DelayMs = 800
)
$ErrorActionPreference = 'Continue'
$log = Join-Path $PSScriptRoot '<LOG_NAME>'
function Write-RestartLog([string]$m) {
	try {
		if ((Test-Path -LiteralPath $log) -and ((Get-Item -LiteralPath $log).Length -gt 65536)) {
			Clear-Content -LiteralPath $log
		}
		Add-Content -LiteralPath $log -Value ('[{0}] {1}' -f (Get-Date -Format o), $m)
	} catch { }
}
function Wait-Gone([int]$targetPid, [int]$seconds) {
	$deadline = (Get-Date).AddSeconds($seconds)
	while ((Get-Date) -lt $deadline) {
		if (-not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) { return $true }
		Start-Sleep -Milliseconds 250
	}
	return -not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)
}
Start-Sleep -Milliseconds $DelayMs
Write-RestartLog ('begin main={0} host={1} tree={2} exe={3}' -f $MainPid, $HostPid, [bool]$TreeKill, $ExePath)
if (-not (Test-Path -LiteralPath $ExePath)) {
	Write-RestartLog 'exe path missing; aborting'
	exit 1
}
if ($TreeKill) {
	& taskkill.exe /F /T /PID $MainPid 2>&1 | ForEach-Object { Write-RestartLog ('taskkill tree: ' + $_) }
} else {
	& taskkill.exe /F /PID $MainPid 2>&1 | ForEach-Object { Write-RestartLog ('taskkill main: ' + $_) }
	if ($HostPid -gt 0 -and $HostPid -ne $PID) {
		& taskkill.exe /F /PID $HostPid 2>&1 | ForEach-Object { Write-RestartLog ('taskkill host: ' + $_) }
	}
}
if (-not (Wait-Gone $MainPid 25)) {
	Write-RestartLog 'main pid still alive after 25s; NOT relaunching (a second instance would fail to bind)'
	exit 1
}
if ($HostPid -gt 0 -and $HostPid -ne $MainPid) {
	Wait-Gone $HostPid 10 | Out-Null
}
if ($NoRelaunch) {
	Write-RestartLog 'quit complete; no relaunch'
	exit 0
}
Start-Sleep -Milliseconds 600
Write-RestartLog 'relaunching'
Start-Process -FilePath $ExePath -WorkingDirectory (Split-Path -Parent $ExePath)
Write-RestartLog 'relaunch requested; done'
exit 0
`.replace('<LOG_NAME>', LOG_NAME);

function runPowerShell(script) {
	return new Promise((resolve) => {
		const encoded = Buffer.from(script, 'utf16le').toString('base64');
		execFile(
			'powershell.exe',
			['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
			{ timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
			(error, stdout) => {
				resolve({ ok: !error, stdout: typeof stdout === 'string' ? stdout.trim() : '', error });
			}
		);
	});
}

function parseJsonObject(text) {
	try {
		const value = JSON.parse(text);
		return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function quoteArgument(value) {
	return '"' + String(value).replace(/"/g, '\\"') + '"';
}

/** Last-resort exe discovery: walk up from the runtime's own node.exe looking for the app. */
function deriveExeFromRuntime() {
	let dir = path.dirname(process.execPath);
	for (let depth = 0; depth < 6; depth += 1) {
		const candidate = path.join(dir, APP_EXE_NAME);
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

function helperFile() {
	return path.join(os.tmpdir(), HELPER_NAME);
}

function logFile() {
	return path.join(os.tmpdir(), LOG_NAME);
}

function ensureHelper() {
	try {
		fs.writeFileSync(helperFile(), HELPER_SOURCE, 'utf8');
		return { path: helperFile(), error: undefined };
	} catch (error) {
		return { path: helperFile(), error };
	}
}

function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store'
	});
	res.end(body);
}

function readBodyIgnored(req) {
	return new Promise((resolve) => {
		req.on('data', () => {});
		req.on('end', resolve);
		req.on('error', resolve);
	});
}

/** Accept absent Origin (local tooling) but reject foreign browser origins. */
function sameOrigin(req) {
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	const host = req.headers.host;
	if (typeof host !== 'string' || host === '') return false;
	return origin === 'http://' + host || origin === 'https://' + host;
}

/** Ask WMI about the parent process once; also the WMI availability probe. */
async function diagnose() {
	const mainPid = typeof process.ppid === 'number' ? process.ppid : 0;
	const info = { mainPid, wmiOk: false, found: false, exe: undefined, processName: undefined, derivedExe: undefined };
	if (mainPid <= 0) return info;
	const script = [
		'$out = @{ found = $false; exe = \'\'; name = \'\' }',
		'try {',
		'  $p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = ' + mainPid + '" | Select-Object -First 1',
		'  if ($null -ne $p) { $out.found = $true; $out.exe = [string]$p.ExecutablePath; $out.name = [string]$p.Name }',
		'} catch { }',
		'[Console]::Out.Write((ConvertTo-Json -Compress -InputObject $out))'
	].join('\n');
	const query = await runPowerShell(script);
	info.wmiOk = query.ok;
	const parsed = query.ok ? parseJsonObject(query.stdout) : undefined;
	if (parsed?.found === true) {
		info.found = true;
		info.exe = typeof parsed.exe === 'string' && parsed.exe !== '' ? parsed.exe : undefined;
		info.processName = typeof parsed.name === 'string' && parsed.name !== '' ? parsed.name : undefined;
	}
	if (info.exe === undefined) info.derivedExe = deriveExeFromRuntime();
	return info;
}

export const inject = ['webServer'];

export function apply(ctx) {
	// One token per armed restart: the browser half fetches it from /status and
	// spends it on /restart. Cross-origin pages cannot read the token (no CORS
	// headers anywhere), so a drive-by form POST cannot restart the app, and
	// spending the token guarantees one click = one restart.
	let token = crypto.randomBytes(24).toString('base64url');
	// Short-lived parent-process diagnosis cache; the client always hits /status
	// right before /restart, so the confirm click stays quick.
	let cachedDiagnosis;
	let cachedDiagnosisAt = 0;
	const DIAGNOSIS_TTL_MS = 10000;

	async function diagnoseCached() {
		const mainPid = typeof process.ppid === 'number' ? process.ppid : 0;
		const now = Date.now();
		if (cachedDiagnosis !== undefined && cachedDiagnosis.mainPid === mainPid && now - cachedDiagnosisAt < DIAGNOSIS_TTL_MS) {
			return cachedDiagnosis;
		}
		cachedDiagnosis = await diagnose();
		cachedDiagnosisAt = now;
		return cachedDiagnosis;
	}

	const statusHandler = async (req, res) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			sendJson(res, 405, { ok: false, error: 'GET only' });
			return;
		}
		const diagnosis = await diagnoseCached();
		const exe = diagnosis.exe ?? diagnosis.derivedExe;
		const supported = diagnosis.found && typeof exe === 'string' && exe.toLowerCase().endsWith('.exe') && fs.existsSync(exe);
		sendJson(res, 200, {
			ok: true,
			supported,
			token,
			mainPid: diagnosis.mainPid,
			processName: diagnosis.processName,
			exe: supported ? exe : undefined,
			exeSource: diagnosis.exe !== undefined ? 'parent-query' : diagnosis.derivedExe !== undefined ? 'derived' : undefined,
			wmiOk: diagnosis.wmiOk,
			helper: ensureHelper().path,
			log: logFile()
		});
	};

	/**
	 * Shared exit pipeline behind both actions: kill the app tree; the helper
	 * relaunches unless `quit` is set. Responds and returns null on failure,
	 * otherwise returns { mode, exe }.
	 */
	const launchExit = async (res, quit) => {
		const diagnosis = await diagnoseCached();
		const exe = diagnosis.exe ?? diagnosis.derivedExe;
		if (!diagnosis.found || typeof exe !== 'string' || !exe.toLowerCase().endsWith('.exe') || !fs.existsSync(exe)) {
			sendJson(res, 409, {
				ok: false,
				error: 'desktop app parent process not found (pid ' + diagnosis.mainPid + '); this only works inside the desktop app'
			});
			return null;
		}

		const helper = ensureHelper();
		if (helper.error !== undefined) {
			sendJson(res, 500, { ok: false, error: 'cannot write helper script: ' + (helper.error?.message ?? String(helper.error)) });
			return null;
		}

		const helperArgs = [
			'-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
			'-File', quoteArgument(helper.path),
			'-ExePath', quoteArgument(exe),
			'-MainPid', String(diagnosis.mainPid),
			'-HostPid', String(process.pid),
			'-DelayMs', String(KILL_DELAY_MS)
		];

		// Primary: WMI creates the helper as a child of the WMI provider, outside
		// the app's process tree, so `taskkill /T` cannot take the helper down and
		// the whole-tree kill is safe. Win32_ProcessStartup.ShowWindow = 0 (SW_HIDE)
		// makes the helper console hidden from birth — without it, PowerShell only
		// hides itself after parsing -WindowStyle, which flashes a window briefly.
		const switches = quit ? '-TreeKill -NoRelaunch' : '-TreeKill';
		const commandLine = ['powershell.exe', ...helperArgs, switches].join(' ');
		const launcher = [
			'$cl = @\'',
			commandLine,
			'\'@',
			'$startup = ([WMIClass]"Win32_ProcessStartup").CreateInstance()',
			'$startup.ShowWindow = 0',
			'$r = ([WMIClass]"Win32_Process").Create($cl, $null, $startup)',
			'[Console]::Out.Write([string]$r.ReturnValue + \' \' + [string]$r.ProcessId)'
		].join('\n');
		const launch = await runPowerShell(launcher);
		let mode = quit ? 'wmi-tree-kill-no-relaunch' : 'wmi-tree-kill';
		if (!launch.ok || !/^\d+ \d+$/.test(launch.stdout)) {
			// Fallback: detached helper INSIDE the tree; it must therefore kill
			// individual PIDs instead of walking the tree (which would include it).
			try {
				const child = spawn('powershell.exe', [...helperArgs, ...(quit ? ['-NoRelaunch'] : [])], {
					detached: true,
					stdio: 'ignore',
					windowsHide: true
				});
				child.unref();
				mode = quit ? 'detached-targeted-kill-no-relaunch' : 'detached-targeted-kill';
			} catch (error) {
				sendJson(res, 500, { ok: false, error: 'failed to start exit helper: ' + (error?.message ?? String(error)) });
				return null;
			}
		}
		return { mode, exe };
	};

	/** POST guard shared by both actions; true when the request may proceed. */
	const mayPost = (req, res) => {
		if (req.method !== 'POST') {
			sendJson(res, 405, { ok: false, error: 'POST only' });
			return false;
		}
		if (!sameOrigin(req)) {
			sendJson(res, 403, { ok: false, error: 'cross-origin requests are rejected' });
			return false;
		}
		if (req.headers['x-app-restart-token'] !== token) {
			sendJson(res, 403, { ok: false, error: 'missing or stale token; fetch /status first' });
			return false;
		}
		token = crypto.randomBytes(24).toString('base64url'); // one shot: a replay cannot double-fire
		return true;
	};

	const restartHandler = async (req, res) => {
		await readBodyIgnored(req);
		if (!mayPost(req, res)) return;
		const result = await launchExit(res, false);
		if (result !== null) sendJson(res, 200, { ok: true, mode: result.mode, exe: result.exe, delayMs: KILL_DELAY_MS });
	};

	const quitHandler = async (req, res) => {
		await readBodyIgnored(req);
		if (!mayPost(req, res)) return;
		const result = await launchExit(res, true);
		if (result !== null) sendJson(res, 200, { ok: true, mode: result.mode, exe: result.exe, delayMs: KILL_DELAY_MS });
	};

	ctx.effect(() => {
		const disposeStatus = ctx.webServer.register({ kind: 'exact', path: ROUTE_PREFIX + '/status', handler: statusHandler });
		const disposeRestart = ctx.webServer.register({ kind: 'exact', path: ROUTE_PREFIX + '/restart', handler: restartHandler });
		const disposeQuit = ctx.webServer.register({ kind: 'exact', path: ROUTE_PREFIX + '/quit', handler: quitHandler });
		return () => {
			try {
				disposeStatus();
			} catch { /* route table already gone */ }
			try {
				disposeRestart();
			} catch { /* route table already gone */ }
			try {
				disposeQuit();
			} catch { /* route table already gone */ }
		};
	}, 'app-restart: routes');
}

/** Test-only surface; not part of the plugin face. */
export const __test = { HELPER_SOURCE, helperFile, logFile, deriveExeFromRuntime, quoteArgument };
