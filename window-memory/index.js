/**
 * Host half of the window-memory bundle.
 *
 * The desktop shell creates its main window at a fixed 1280×820 and persists
 * no window state, and neither the Host services nor the sandboxed renderer
 * preload expose any window-control API. This half therefore works from
 * outside the window: right after the profile composition boots it launches
 * one hidden helper that
 *
 *   1. verifies that the parent really is the desktop shell exe
 *      (DeepSeek Harness.exe / electron.exe) — a terminal-launched standalone
 *      Host is never touched;
 *   2. loads the saved window state (x, y, w, h, zoomed) written by the
 *      PREVIOUS session and applies it to the fresh main window;
 *   3. keeps watching the window for the rest of the session and persists
 *      every user-driven size/position change (debounced) back to the state
 *      file, so the next startup restores exactly what the user last had.
 *
 * The helper itself is `helper.cs`, compiled once into
 * `%LOCALAPPDATA%\dsh-window-memory\helper.exe` and cached there (keyed by the
 * source SHA-256, so editing the .cs triggers a rebuild). It used to be
 * `helper.ps1` driven by powershell.exe, which cost 106 MB RSS plus ~4-5% of
 * one core forever: a bare Windows PowerShell is already 76.6 MB, and every
 * 250 ms tick spent ~10 ms in cmdlet/reflection overhead. The native helper
 * does the same job in a few MB and a few microseconds per tick. Geometry is
 * cosmetic, so nothing here may ever block or break Host boot: a missing
 * compiler or a failed build only costs the window memory and writes a log
 * line.
 *
 * Startup semantics: the helper only fires while the Host itself is still
 * young, so live plugin/config reloads never re-apply an old geometry over a
 * window the user has already been using. Everything is best-effort.
 *
 * Note on spawning: the helper is deliberately NOT detached. `detached: true`
 * (DETACHED_PROCESS) makes console processes die during console initialization
 * in this environment (observed with powershell.exe: instant silent exit, no
 * script execution). With plain windowsHide: true (CREATE_NO_WINDOW) the
 * helper runs cleanly, stays invisible, allocates no console (so no conhost
 * child either), and dies naturally when the app (its parent) closes.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG_NAME = 'dsh-window-memory.log';
const STATE_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'dsh-window-memory');
const STATE_FILE = path.join(STATE_DIR, 'window-state.json');
const HELPER_EXE = path.join(STATE_DIR, 'helper.exe');
const HELPER_HASH = path.join(STATE_DIR, 'helper.sha256');
/** Only engage during this window after Host process start. */
const BOOT_WINDOW_MS = 3 * 60 * 1000;
/** .NET Framework ships this compiler on every Windows 10/11. */
const CSC_CANDIDATES = [
	path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
	path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
];

function logLine(message) {
	try {
		fs.appendFileSync(path.join(os.tmpdir(), LOG_NAME), `[${new Date().toISOString()}] ${message}\n`);
	} catch {
		/* diagnostics only */
	}
}

function helperSourcePath() {
	return fileURLToPath(new URL('./helper.cs', import.meta.url));
}

function sourceDigest() {
	return crypto.createHash('sha256').update(fs.readFileSync(helperSourcePath())).digest('hex');
}

function isUpToDate(digest) {
	try {
		return fs.readFileSync(HELPER_HASH, 'utf8').trim() === digest && fs.existsSync(HELPER_EXE);
	} catch {
		return false;
	}
}

function compileHelper(digest) {
	return new Promise((resolve) => {
		const csc = CSC_CANDIDATES.find((candidate) => fs.existsSync(candidate));
		if (!csc) {
			logLine('helper compile skipped: no csc.exe found; window memory disabled');
			resolve(null);
			return;
		}
		const staged = HELPER_EXE + '.new';
		// /target:winexe 是关键：Node 的 windowsHide 只做 STARTF_USESHOWWINDOW
		// (SW_HIDE)，控制台仍会被分配，于是多出一个 conhost.exe 子进程（约 8MB）。
		// 编成 GUI 子系统就完全不分配控制台。/target:exe 下 stdout 依然可用于
		// `-SelfTest`，因为 Node 会显式重定向管道。
		const child = spawn(
			csc,
			['/nologo', '/target:winexe', '/platform:x64', '/optimize+', `/out:${staged}`, helperSourcePath()],
			{ stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }
		);
		let stderr = '';
		if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
		child.on('error', (error) => {
			logLine('helper compile failed: ' + (error?.message ?? String(error)) + '; window memory disabled');
			resolve(null);
		});
		child.on('exit', (code) => {
			try {
				if (code !== 0 || !fs.existsSync(staged)) {
					logLine(`helper compile failed: csc exit ${code} ${stderr.trim().slice(0, 300)}; window memory disabled`);
					try { fs.rmSync(staged, { force: true }); } catch { /* best effort */ }
					resolve(null);
					return;
				}
				fs.renameSync(staged, HELPER_EXE);
				fs.writeFileSync(HELPER_HASH, digest, 'utf8');
				logLine(`helper compiled: ${HELPER_EXE}`);
				resolve(HELPER_EXE);
			} catch (error) {
				logLine('helper compile failed: ' + (error?.message ?? String(error)) + '; window memory disabled');
				resolve(null);
			}
		});
	});
}

let helperPromise;

/**
 * Resolve the helper executable, compiling it from `helper.cs` when the cached
 * build is missing or stale. Safe to call repeatedly: one build per process.
 * @returns {Promise<string|null>} absolute exe path, or null when unavailable
 */
export function ensureHelper() {
	if (helperPromise) return helperPromise;
	helperPromise = (async () => {
		try {
			const digest = sourceDigest();
			if (process.env.DSH_WINDOW_MEMORY_REBUILD !== '1' && isUpToDate(digest)) return HELPER_EXE;
			fs.mkdirSync(STATE_DIR, { recursive: true });
			return await compileHelper(digest);
		} catch (error) {
			logLine('helper build failed: ' + (error?.message ?? String(error)) + '; window memory disabled');
			return null;
		}
	})();
	return helperPromise;
}

export function apply() {
	try {
		if (process.platform !== 'win32') return; // Win32 helper only.
		if (process.env.ELECTRON_RUN_AS_NODE !== '1') return; // not the desktop-host child.
		if (process.uptime() * 1000 > BOOT_WINDOW_MS) {
			logLine('skip: host already running; live reload must not re-apply geometry');
			return;
		}
		const mainPid = typeof process.ppid === 'number' ? process.ppid : 0;
		if (mainPid <= 0) return;

		fs.mkdirSync(STATE_DIR, { recursive: true });
		ensureHelper()
			.then((helperExe) => {
				if (!helperExe) return; // already logged by the build path
				const child = spawn(
					helperExe,
					['-MainPid', String(mainPid), '-StateFile', STATE_FILE],
					{ stdio: 'ignore', windowsHide: true }
				);
				child.on('error', (error) => logLine('helper spawn failed: ' + (error?.message ?? String(error))));
				child.unref();
				logLine(`helper launched pid=${child.pid} mainPid=${mainPid} state=${STATE_FILE}`);
			})
			.catch((error) => logLine('apply failed: ' + (error?.message ?? String(error))));
	} catch (error) {
		// Swallow: window geometry is cosmetic and must never take the Host down.
		logLine('apply failed: ' + (error?.message ?? String(error)));
	}
}
