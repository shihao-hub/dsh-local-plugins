/**
 * Host half of the startup-maximize bundle.
 *
 * The desktop shell creates its main window at a fixed 1280×820 with no
 * maximize-on-start and no persisted window state, and neither the Host
 * services nor the sandboxed renderer preload expose any window-control API.
 * The Host runtime, however, is a plain child of the Electron main process,
 * so this half launches one hidden PowerShell helper right after the profile
 * composition boots. The helper:
 *
 *   1. verifies via WMI that the parent really is the desktop shell exe
 *      (DeepSeek Harness.exe / electron.exe) — a terminal-launched
 *      standalone Host is never touched;
 *   2. polls for the parent's largest visible top-level window (the shell
 *      shows its window only after the web client has booted);
 *   3. maximizes it once via Win32 ShowWindow(SW_MAXIMIZE), re-asserts
 *      after two seconds, and exits.
 *
 * Startup semantics: the helper only fires while the Host itself is still
 * young, so live plugin/config reloads never re-maximize a window the user
 * has deliberately restored. Everything is best-effort: no failure path here
 * may ever break Host boot.
 *
 * Note on spawning: the helper is deliberately NOT detached. `detached:
 * true` (DETACHED_PROCESS) makes powershell.exe die during console
 * initialization in this environment (observed: instant silent exit, no
 * script execution). With plain windowsHide: true (CREATE_NO_WINDOW) it runs
 * cleanly, stays invisible, and the Host outlives the helper anyway.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPER_NAME = 'dsh-startup-maximize-helper.ps1';
const LOG_NAME = 'dsh-startup-maximize.log';
/** Auto-maximize only during this window after Host process start. */
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
			logLine('skip: host already running; live reload must not re-maximize');
			return;
		}
		const mainPid = typeof process.ppid === 'number' ? process.ppid : 0;
		if (mainPid <= 0) return;

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
				'-MainPid', String(mainPid)
			],
			{ stdio: 'ignore', windowsHide: true }
		);
		child.on('error', (error) => logLine('helper spawn failed: ' + (error?.message ?? String(error))));
		child.unref();
		logLine(`helper launched pid=${child.pid} mainPid=${mainPid}`);
	} catch (error) {
		// Swallow: maximizing is cosmetic and must never take the Host down.
		logLine('apply failed: ' + (error?.message ?? String(error)));
	}
}
