/**
 * Host half of the window-memory bundle.
 *
 * The desktop shell creates its main window at a fixed 1280×820 and persists
 * no window state, and neither the Host services nor the sandboxed renderer
 * preload expose any window-control API. This half launches one hidden
 * PowerShell helper right after the profile composition boots. The helper:
 *
 *   1. verifies via WMI that the parent really is the desktop shell exe
 *      (DeepSeek Harness.exe / electron.exe) — a terminal-launched standalone
 *      Host is never touched;
 *   2. loads the saved window state (x, y, w, h, zoomed) written by the
 *      PREVIOUS session and applies it to the fresh main window;
 *   3. keeps watching the window for the rest of the session and persists
 *      every user-driven size/position change (debounced) back to the state
 *      file, so the next startup restores exactly what the user last had.
 *
 * Startup semantics: the helper only fires while the Host itself is still
 * young, so live plugin/config reloads never re-apply an old geometry over a
 * window the user has already been using. Everything is best-effort: no
 * failure path here may ever break Host boot.
 *
 * Note on spawning: the helper is deliberately NOT detached. `detached: true`
 * (DETACHED_PROCESS) makes powershell.exe die during console initialization
 * in this environment (observed: instant silent exit, no script execution).
 * With plain windowsHide: true (CREATE_NO_WINDOW) it runs cleanly, stays
 * invisible, and dies naturally when the app (its parent) closes.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPER_NAME = 'dsh-window-memory-helper.ps1';
const LOG_NAME = 'dsh-window-memory.log';
const STATE_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'dsh-window-memory');
/** Only engage during this window after Host process start. */
const BOOT_WINDOW_MS = 3 * 60 * 1000;

function logLine(message) {
	try {
		fs.appendFileSync(path.join(os.tmpdir(), LOG_NAME), `[${new Date().toISOString()}] ${message}\n`);
	} catch {
		/* diagnostics only */
	}
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
		const helperSource = fs.readFileSync(fileURLToPath(new URL('./helper.ps1', import.meta.url)), 'utf8');
		const helperPath = path.join(os.tmpdir(), HELPER_NAME);
		fs.writeFileSync(helperPath, helperSource, 'utf8');

		const child = spawn(
			'powershell.exe',
			[
				'-NoProfile',
				'-NonInteractive',
				'-ExecutionPolicy', 'Bypass',
				'-WindowStyle', 'Hidden',
				'-File', helperPath,
				'-MainPid', String(mainPid),
				'-StateFile', path.join(STATE_DIR, 'window-state.json')
			],
			{ stdio: 'ignore', windowsHide: true }
		);
		child.on('error', (error) => logLine('helper spawn failed: ' + (error?.message ?? String(error))));
		child.unref();
		logLine(`helper launched pid=${child.pid} mainPid=${mainPid} state=${path.join(STATE_DIR, 'window-state.json')}`);
	} catch (error) {
		// Swallow: window geometry is cosmetic and must never take the Host down.
		logLine('apply failed: ' + (error?.message ?? String(error)));
	}
}
