/**
 * Host half of the app-restart bundle. Two runtimes, one plugin:
 *
 *   desktop mode — the Host runtime is a plain Node child of the Electron
 *     desktop shell, so it cannot call `app.relaunch()` or `app.quit()`. The
 *     target is the PARENT process (`process.ppid`), which must be the desktop
 *     executable.
 *
 *   web mode — the Host runtime IS the service (`node …/dsh/lib/bin.js web
 *     --port N`). There is no desktop parent: `process.ppid` is the launching
 *     shell, which has usually already exited (e.g. `cmd /c start /b`), and
 *     killing it would take down the user's terminal when it is still alive.
 *     The target is therefore the process LISTENING ON OUR OWN PORT, found by
 *     reverse lookup, and it is relaunched from its own command line so no
 *     argument drifts.
 *
 * In both modes the helper is launched OUT of the target's process tree (via
 * WMI, so its parent is the WMI provider) and waits for the HTTP response to
 * flush before killing anything, so the caller always gets its answer first.
 *
 * Serves three loopback HTTP routes on the Host web server:
 *   GET  /plugin/app-restart/status   — diagnostics (mode, target, helper paths) + one-time token
 *   POST /plugin/app-restart/restart  — kill the target, then relaunch it
 *   POST /plugin/app-restart/quit     — kill the target, do not relaunch
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
// Web mode: the HTTP answer must reach the browser before the listener dies.
// The default 800 ms is not enough when the Host is busy streaming a reply, and
// a truncated response leaves the UI stuck in "restarting" forever.
const WEB_KILL_DELAY_MS = 1200;

/** One PowerShell helper that relaunches the target after it is gone. */
const HELPER_SOURCE = String.raw`
param(
	[Parameter(Mandatory = $true)][string]$ExePath,
	[Parameter(Mandatory = $true)][int]$MainPid,
	[int]$HostPid = 0,
	[switch]$TreeKill,
	[switch]$NoRelaunch,
	[int]$DelayMs = 800,
	[int]$Port = 0,
	[string]$RelaunchArgs = '',
	[string]$WorkingDir = ''
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
function Get-PortListenerPid([int]$targetPort) {
	try {
		$conn = Get-NetTCPConnection -LocalPort $targetPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
		if ($null -ne $conn) { return [int]$conn.OwningProcess }
	} catch { }
	return 0
}
function Wait-PortFree([int]$targetPort, [int]$seconds) {
	$deadline = (Get-Date).AddSeconds($seconds)
	while ((Get-Date) -lt $deadline) {
		if ((Get-PortListenerPid $targetPort) -eq 0) { return $true }
		Start-Sleep -Milliseconds 300
	}
	return ((Get-PortListenerPid $targetPort) -eq 0)
}
function Wait-PortListening([int]$targetPort, [int]$seconds) {
	$deadline = (Get-Date).AddSeconds($seconds)
	while ((Get-Date) -lt $deadline) {
		if ((Get-PortListenerPid $targetPort) -gt 0) { return $true }
		Start-Sleep -Milliseconds 300
	}
	return ((Get-PortListenerPid $targetPort) -gt 0)
}
Start-Sleep -Milliseconds $DelayMs

if ($Port -gt 0) {
	# ------------------------------------------------------------------ web mode
	# The target of a restart is whichever process currently listens on our own
	# port. MainPid is only a fallback for the (rare) case where the listener has
	# already vanished by the time we run.
	$listenPid = Get-PortListenerPid $Port
	$targetPid = $listenPid
	if ($targetPid -le 0) { $targetPid = $MainPid }
	Write-RestartLog ('begin web port={0} listener={1} fallback={2} exe={3}' -f $Port, $listenPid, $MainPid, $ExePath)

	if ($targetPid -le 0 -or $targetPid -eq $PID) {
		Write-RestartLog 'no usable target pid; aborting'
		exit 1
	}
	if (-not (Test-Path -LiteralPath $ExePath)) {
		Write-RestartLog 'node exe path missing; aborting'
		exit 1
	}

	# Only the target and its descendants. Never the parents: when the service
	# was started from a terminal, the parent is that terminal.
	& taskkill.exe /F /T /PID $targetPid 2>&1 | ForEach-Object { Write-RestartLog ('taskkill tree: ' + $_) }

	if (-not (Wait-Gone $targetPid 25)) {
		Write-RestartLog 'listener pid still alive after 25s; NOT relaunching'
		exit 1
	}
	if (-not (Wait-PortFree $Port 20)) {
		Write-RestartLog ('port {0} still bound after 20s; NOT relaunching (a second instance could not bind)' -f $Port)
		exit 1
	}
	if ($NoRelaunch) {
		Write-RestartLog 'quit complete; no relaunch'
		exit 0
	}

	Start-Sleep -Milliseconds 300
	# -WindowStyle Hidden matters here: without it the relaunched service keeps a
	# visible console window, because node.exe is a console application and
	# Start-Process gives it a fresh console. The service was born windowless, so
	# a restart must not change that.
	$launchArgs = @{ FilePath = $ExePath; ArgumentList = @($RelaunchArgs); WindowStyle = 'Hidden' }
	if ($WorkingDir -ne '' -and (Test-Path -LiteralPath $WorkingDir)) {
		$launchArgs['WorkingDirectory'] = $WorkingDir
	}
	try {
		Start-Process @launchArgs
		Write-RestartLog ('relaunched: "{0}" {1}' -f $ExePath, $RelaunchArgs)
	} catch {
		Write-RestartLog ('relaunch failed: ' + $_.Exception.Message)
		exit 1
	}
	if (Wait-PortListening $Port 30) {
		Write-RestartLog 'listener is back'
	} else {
		Write-RestartLog 'WARNING: port never came back within 30s'
	}
	exit 0
}

# ------------------------------------------------------------------ desktop mode
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
`
	.replace('<LOG_NAME>', LOG_NAME);

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

/** Ask WMI about the desktop parent process once; also the WMI availability probe. */
async function diagnoseDesktop() {
	const mainPid = typeof process.ppid === 'number' ? process.ppid : 0;
	const info = { mode: 'desktop', mainPid, wmiOk: false, found: false, exe: undefined, processName: undefined, derivedExe: undefined };
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

/**
 * In web mode the restarted target is whichever process LISTENS on our own
 * port — not the parent, which is the launching shell (often already gone).
 * The listener's own command line is captured so the relaunch replays it
 * verbatim with no argument drift.
 */
async function diagnoseWeb(port) {
	const info = {
		mode: 'web',
		port,
		mainPid: typeof process.ppid === 'number' ? process.ppid : 0,
		wmiOk: false,
		found: false,
		exe: undefined,
		args: undefined,
		processName: undefined
	};
	if (!Number.isInteger(port) || port <= 0) return info;
	const script = [
		'$out = @{ found = $false; exe = \'\'; name = \'\'; args = \'\'; cmdline = \'\' }',
		'try {',
		'  $conn = Get-NetTCPConnection -LocalPort ' + port + ' -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1',
		'  if ($null -ne $conn) {',
		'    $p = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId = " + [int]$conn.OwningProcess) | Select-Object -First 1',
		'    if ($null -ne $p) {',
		'      $out.found = $true',
		'      $out.exe = [string]$p.ExecutablePath',
		'      $out.name = [string]$p.Name',
		'      $out.cmdline = [string]$p.CommandLine',
		'      if ($out.cmdline.Length -gt 0 -and $out.cmdline[0] -eq [char]34) {',
		'        $idx = $out.cmdline.IndexOf([char]34, 1)',
		'        if ($idx -gt 0) { $out.args = $out.cmdline.Substring($idx + 1).Trim() }',
		'      }',
		'    }',
		'  }',
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
		info.args = typeof parsed.args === 'string' && parsed.args !== '' ? parsed.args : undefined;
	}
	return info;
}

/**
 * Port the browser used to reach us, taken from Host. This matters when more
 * than one dsh web instance is running: the request's own Host is the only
 * unambiguous way to know which listener we are.
 */
function portFromHost(hostHeader) {
	if (typeof hostHeader !== 'string' || hostHeader === '') return undefined;
	let host = hostHeader.trim();
	if (host.startsWith('[')) {
		// [::1]:11111 — the port follows the closing bracket.
		const close = host.indexOf(']');
		if (close < 0) return undefined;
		const after = host.slice(close + 1);
		if (!after.startsWith(':')) return undefined;
		const port = Number.parseInt(after.slice(1), 10);
		return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
	}
	const lastColon = host.lastIndexOf(':');
	if (lastColon < 0) return undefined;
	const port = Number.parseInt(host.slice(lastColon + 1), 10);
	return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}

/**
 * Last-resort port discovery for a request whose Host carried no port: our own
 * --port flag, then any listener that looks like a dsh web runtime. Only used
 * when Host is unusable, so it can never override a known-good port.
 */
async function discoverWebPort() {
	const argvPortIndex = process.argv.indexOf('--port');
	if (argvPortIndex >= 0) {
		const port = Number.parseInt(process.argv[argvPortIndex + 1], 10);
		if (Number.isInteger(port) && port > 0) return port;
	}
	const script = [
		'$found = 0',
		'foreach ($c in @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)) {',
		'  $p = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId = " + [int]$c.OwningProcess) | Select-Object -First 1',
		'  if ($null -eq $p) { continue }',
		'  $cl = [string]$p.CommandLine',
		'  if (($cl -like \'*bin.js*\') -and ($cl -like \'*web*\')) { $found = [int]$c.LocalPort; break }',
		'}',
		'[Console]::Out.Write([string]$found)'
	].join('\n');
	const query = await runPowerShell(script);
	if (!query.ok) return undefined;
	const port = Number.parseInt(query.stdout, 10);
	return Number.isInteger(port) && port > 0 ? port : undefined;
}

/** Rebuild the helper's ArgumentList from a captured command line. */
function splitArguments(argsLine) {
	const out = [];
	const re = /"([^"]*)"|(\S+)/g;
	let match;
	while ((match = re.exec(argsLine)) !== null) {
		out.push(match[1] !== undefined ? match[1] : match[2]);
	}
	return out;
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
	// Resolved once per process: our own listening port never changes while we live.
	let discoveredPort;
	const DIAGNOSIS_TTL_MS = 10000;

	/** Memoised so the client's status-then-restart pair costs one probe. */
	async function diagnoseCached(req) {
		const mainPid = typeof process.ppid === 'number' ? process.ppid : 0;
		const port = portFromHost(req.headers.host);
		const now = Date.now();
		const fresh = cachedDiagnosis !== undefined && now - cachedDiagnosisAt < DIAGNOSIS_TTL_MS;
		if (fresh) {
			if (port !== undefined && cachedDiagnosis.mode === 'web' && cachedDiagnosis.port === port) return cachedDiagnosis;
			if (port === undefined && cachedDiagnosis.mode !== 'web' && cachedDiagnosis.mainPid === mainPid) return cachedDiagnosis;
		}

		let diagnosis;
		if (port !== undefined) {
			diagnosis = await diagnoseWeb(port);
		} else {
			// Host carried no port: ask our own --port first, then look for a
			// listener that looks like a dsh web runtime. Cached because it is
			// the expensive path, and our own port never changes while we live.
			if (discoveredPort === undefined) discoveredPort = await discoverWebPort();
			diagnosis = discoveredPort === undefined ? await diagnoseDesktop() : await diagnoseWeb(discoveredPort);
		}
		cachedDiagnosis = diagnosis;
		cachedDiagnosisAt = now;
		return diagnosis;
	}

	const statusHandler = async (req, res) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			sendJson(res, 405, { ok: false, error: 'GET only' });
			return;
		}
		const diagnosis = await diagnoseCached(req);
		const isWeb = diagnosis.mode === 'web';
		const target = isWeb ? diagnosis.exe : diagnosis.exe ?? diagnosis.derivedExe;
		const supported = diagnosis.found && typeof target === 'string' && target.toLowerCase().endsWith('.exe') && fs.existsSync(target);
		sendJson(res, 200, {
			ok: true,
			supported,
			mode: diagnosis.mode,
			port: isWeb ? diagnosis.port : undefined,
			token,
			mainPid: diagnosis.mainPid,
			targetPid: isWeb ? (diagnosis.found ? 'listener' : undefined) : diagnosis.mainPid,
			processName: diagnosis.processName,
			exe: supported ? target : undefined,
			exeSource: isWeb ? 'port-listener' : diagnosis.exe !== undefined ? 'parent-query' : diagnosis.derivedExe !== undefined ? 'derived' : undefined,
			wmiOk: diagnosis.wmiOk,
			helper: ensureHelper().path,
			log: logFile()
		});
	};

	/**
	 * Shared exit pipeline behind both actions. Desktop: kill the app tree, the
	 * helper relaunches the desktop exe. Web: kill the port listener and replay
	 * its own command line on the same port. Responds and returns null on
	 * failure, otherwise returns { mode, exe, delayMs }.
	 */
	const launchExit = async (req, res, quit) => {
		const diagnosis = await diagnoseCached(req);

		let exe;
		let isWeb = false;
		if (diagnosis.mode === 'web') {
			exe = diagnosis.exe;
			isWeb = true;
			if (!diagnosis.found || typeof exe !== 'string' || !exe.toLowerCase().endsWith('.exe') || !fs.existsSync(exe)) {
				sendJson(res, 409, {
					ok: false,
					error: 'no dsh web listener found on port ' + diagnosis.port + '; nothing to restart'
				});
				return null;
			}
		} else {
			exe = diagnosis.exe ?? diagnosis.derivedExe;
			if (!diagnosis.found || typeof exe !== 'string' || !exe.toLowerCase().endsWith('.exe') || !fs.existsSync(exe)) {
				sendJson(res, 409, {
					ok: false,
					error: 'desktop app parent process not found (pid ' + diagnosis.mainPid + '); this only works inside the desktop app'
				});
				return null;
			}
		}

		const helper = ensureHelper();
		if (helper.error !== undefined) {
			sendJson(res, 500, { ok: false, error: 'cannot write helper script: ' + (helper.error?.message ?? String(helper.error)) });
			return null;
		}

		const delayMs = isWeb ? WEB_KILL_DELAY_MS : KILL_DELAY_MS;
		const helperArgs = [
			'-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
			'-File', quoteArgument(helper.path),
			'-ExePath', quoteArgument(exe),
			'-MainPid', String(diagnosis.mainPid),
			'-HostPid', String(process.pid),
			'-DelayMs', String(delayMs)
		];

		if (isWeb) {
			helperArgs.push('-Port', String(diagnosis.port));
			if (typeof diagnosis.args === 'string' && diagnosis.args !== '') {
				helperArgs.push('-RelaunchArgs', quoteArgument(diagnosis.args));
			}
			// Reuse the service's own working directory: any relative path inside
			// the captured command line then resolves exactly as it did before.
			try {
				helperArgs.push('-WorkingDir', quoteArgument(process.cwd()));
			} catch { /* cwd unavailable */ }
		}

		// Primary: WMI creates the helper as a child of the WMI provider, outside
		// the target's process tree, so `taskkill /T` cannot take the helper down
		// and the whole-tree kill is safe. Win32_ProcessStartup.ShowWindow = 0
		// (SW_HIDE) makes the helper console hidden from birth — without it,
		// PowerShell only hides itself after parsing -WindowStyle, so a window
		// flashes briefly.
		const switches = ['-TreeKill'];
		if (quit) switches.push('-NoRelaunch');
		const commandLine = ['powershell.exe', ...helperArgs, ...switches].join(' ');
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
			// Web mode is NOT safe in this mode: killing the listener by PID still
			// works, but the helper would be a child of the listener and could be
			// taken down with it. Refuse rather than risk a half-dead service.
			if (isWeb) {
				sendJson(res, 500, {
					ok: false,
					error: 'could not launch the restart helper outside the service tree (WMI unavailable); restart skipped to avoid killing the service without bringing it back'
				});
				return null;
			}
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
		return { mode, exe, delayMs };
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
		const result = await launchExit(req, res, false);
		if (result !== null) sendJson(res, 200, { ok: true, mode: result.mode, exe: result.exe, delayMs: result.delayMs });
	};

	const quitHandler = async (req, res) => {
		await readBodyIgnored(req);
		if (!mayPost(req, res)) return;
		const result = await launchExit(req, res, true);
		if (result !== null) sendJson(res, 200, { ok: true, mode: result.mode, exe: result.exe, delayMs: result.delayMs });
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
export const __test = {
	HELPER_SOURCE,
	helperFile,
	logFile,
	deriveExeFromRuntime,
	quoteArgument,
	portFromHost,
	splitArguments
};
