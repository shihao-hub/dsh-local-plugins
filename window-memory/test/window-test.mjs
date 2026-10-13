#!/usr/bin/env node
/**
 * window-memory 真窗口回归测试。
 *
 * 用 test/test-window.cs 编译出的夹具窗口（必然由自己持有窗口，不依赖系统
 * 记事本/画图之类的商店包行为）覆盖 helper 的每一条生产分支：
 *
 *   1. 恢复 + 去抖写回：保存值与夹具初始几何不同 → 必须被挪过去并写回
 *   2. 首次运行：无状态文件 → 只报 no saved state，随后写回当前几何
 *   3. 坏值拒绝：状态被毒化成隐藏停靠位 → 删除而不是套用，随后写回好值
 *   4. 屏幕外守卫：窗口停在 (-25600,-25600) → 绝不落盘，状态文件不得出现
 *   5. 最大化态：zoomed 状态 → SW_MAXIMIZE，并只记录 zoomed 标志
 *   6. 窗口销毁：杀掉夹具 → watcher 自行退出且进程结束
 *
 * 夹具会把自身真实几何打到 stdout，作为独立于 helper 日志的第三方证据；
 * 因此断言不看 helper 自己说"我恢复了什么"，而是看窗口真的在哪。
 *
 * 用法：node window-memory/test/window-test.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureHelper } from '../index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(os.tmpdir(), 'dsh-window-memory-test');
const CSC_CANDIDATES = [
	path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
	path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
];

let passed = 0;
let failed = 0;
const cleanups = [];

function check(ok, label, detail) {
	if (ok) {
		passed++;
		console.log(`  PASS ${label}`);
	} else {
		failed++;
		console.log(`  FAIL ${label}${detail ? ' -- ' + detail : ''}`);
	}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(probe, timeoutMs, intervalMs = 80) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		let value;
		try { value = probe(); } catch { value = undefined; }
		if (value) return value;
		if (Date.now() > deadline) return undefined;
		await sleep(intervalMs);
	}
}

function readLog(logPath) {
	try { return fs.readFileSync(logPath, 'utf8'); } catch { return ''; }
}

const waitForLog = (logPath, needle, timeoutMs = 8000) =>
	waitFor(() => (readLog(logPath).includes(needle) ? true : undefined), timeoutMs);
const waitForLogMatch = (logPath, regex, timeoutMs = 8000) =>
	waitFor(() => (regex.test(readLog(logPath)) ? true : undefined), timeoutMs);

function writeState(stateFile, geometry) {
	const text = JSON.stringify({
		x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h, zoomed: Boolean(geometry.zoomed),
		at: new Date().toISOString()
	});
	fs.writeFileSync(stateFile, text, 'utf8');
}

function readState(stateFile) {
	try {
		return JSON.parse(fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, ''));
	} catch {
		return null;
	}
}

function compileFixture() {
	const source = path.join(HERE, 'test-window.cs');
	const exe = path.join(BUILD_DIR, 'test-window.exe');
	fs.mkdirSync(BUILD_DIR, { recursive: true });
	if (fs.existsSync(exe) && fs.statSync(exe).mtimeMs >= fs.statSync(source).mtimeMs) return exe;
	const csc = CSC_CANDIDATES.find((candidate) => fs.existsSync(candidate));
	if (!csc) throw new Error('找不到 csc.exe（.NET Framework 4.x 应随 Windows 提供）');
	const staged = exe + '.new';
	const result = spawnSync(csc, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', `/out:${staged}`, source], { encoding: 'utf8', windowsHide: true });
	if (result.status !== 0 || !fs.existsSync(staged)) {
		throw new Error(`夹具编译失败: exit=${result.status} ${(result.stdout || '') + (result.stderr || '')}`);
	}
	fs.renameSync(staged, exe);
	return exe;
}

/** 启动夹具窗口；windowsHide 保证它不分配控制台（否则控制台窗口可能被当成"最大窗口"）。 */
function startFixture(fixtureExe, spec) {
	const args = ['--x', String(spec.x), '--y', String(spec.y), '--w', String(spec.w), '--h', String(spec.h)];
	if (spec.maximize) args.push('--maximize');
	const proc = spawn(fixtureExe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
	const rects = [];
	let buffer = '';
	proc.stdout.on('data', (chunk) => {
		buffer += chunk.toString('utf8');
		let index;
		while ((index = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, index).trim();
			buffer = buffer.slice(index + 1);
			const match = /^rect (-?\d+) (-?\d+) (-?\d+) (-?\d+)$/.exec(line);
			if (match) rects.push({ x: Number(match[1]), y: Number(match[2]), w: Number(match[3]), h: Number(match[4]) });
		}
	});
	const fixture = {
		proc,
		pid: proc.pid,
		rects,
		latest: () => rects[rects.length - 1],
		hasRect: (want) => rects.some((r) => r.x === want.x && r.y === want.y && r.w === want.w && r.h === want.h),
		waitRect: (want, timeoutMs = 8000) => waitFor(() => (fixture.hasRect(want) ? true : undefined), timeoutMs),
		stop: () => { try { proc.kill(); } catch { /* already gone */ } }
	};
	cleanups.push(() => fixture.stop());
	return fixture;
}

function startHelper(helperExe, options) {
	const args = [
		'-MainPid', String(options.mainPid),
		'-StateFile', options.stateFile,
		'-LogFile', options.logFile,
		'-AllowExeName', '^test-window\\.exe$',
		'-WaitSec', String(options.waitSec ?? 20),
		'-PollMs', String(options.pollMs ?? 100),
		'-SaveDebounceMs', String(options.saveDebounceMs ?? 300)
	];
	const proc = spawn(helperExe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
	let stderr = '';
	proc.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
	const helper = { proc, stderr: () => stderr, stop: () => { try { proc.kill(); } catch { /* already gone */ } } };
	cleanups.push(() => helper.stop());
	return helper;
}

function waitExit(proc, timeoutMs) {
	return new Promise((resolve) => {
		let settled = false;
		const timer = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, timeoutMs);
		proc.on('exit', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(true); } });
	});
}

function newCase(name) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-test-'));
	cleanups.push(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
	console.log(`\n# ${name}`);
	return { dir, stateFile: path.join(dir, 'state.json'), logFile: path.join(dir, 'log.txt') };
}

// ---------------------------------------------------------------- 场景

async function caseRestoreAndSave(helperExe, fixtureExe) {
	const c = newCase('恢复 + 去抖写回');
	const fixture = startFixture(fixtureExe, { x: 900, y: 620, w: 820, h: 520 });
	check(await waitFor(() => fixture.latest(), 8000), '夹具窗口已就绪');
	writeState(c.stateFile, { x: 300, y: 200, w: 700, h: 500 });

	const helper = startHelper(helperExe, { mainPid: fixture.pid, stateFile: c.stateFile, logFile: c.logFile });
	check(await waitForLogMatch(c.logFile, /restored: 700x500 @\(300,200\) \(actual 700x500 @\(300,200\)\)/),
		'按保存值恢复，且回读与请求一致', readLog(c.logFile).trim().split('\n').slice(-3).join(' | '));
	check(await fixture.waitRect({ x: 300, y: 200, w: 700, h: 500 }),
		'窗口真实几何等于保存值（夹具自报，独立于 helper 日志）');
	check(await waitForLog(c.logFile, 'saved: 700x500 @(300,200)'), '去抖后写回状态文件');
	const saved = readState(c.stateFile);
	check(saved && saved.x === 300 && saved.y === 200 && saved.w === 700 && saved.h === 500 && saved.zoomed === false,
		'状态文件内容与恢复值一致', JSON.stringify(saved));
	helper.stop();
	fixture.stop();
}

async function caseFirstRun(fixtureExe, helperExe) {
	const c = newCase('首次运行（无状态文件）');
	const fixture = startFixture(fixtureExe, { x: 400, y: 300, w: 760, h: 520 });
	const initial = await waitFor(() => fixture.latest(), 8000);
	check(Boolean(initial), '夹具窗口已就绪');

	const helper = startHelper(helperExe, { mainPid: fixture.pid, stateFile: c.stateFile, logFile: c.logFile });
	check(await waitForLog(c.logFile, 'no saved state; first run, keeping default geometry'), '报告无保存状态且不改几何');
	check(!fixture.hasRect({ x: 300, y: 200, w: 700, h: 500 }), '确实没有套用任何几何');
	check(await waitForLog(c.logFile, `saved: ${initial.w}x${initial.h} @(${initial.x},${initial.y})`), '随后把当前几何写回');
	const saved = readState(c.stateFile);
	check(saved && saved.x === initial.x && saved.w === initial.w, '状态文件记录当前几何', JSON.stringify(saved));
	helper.stop();
	fixture.stop();
}

async function casePoisonedState(fixtureExe, helperExe) {
	const c = newCase('坏值拒绝（隐藏停靠位）');
	const fixture = startFixture(fixtureExe, { x: 500, y: 400, w: 800, h: 600 });
	const initial = await waitFor(() => fixture.latest(), 8000);
	check(Boolean(initial), '夹具窗口已就绪');
	writeState(c.stateFile, { x: -25600, y: -25600, w: 159, h: 27 });

	// 去抖调大，好在"拒绝并删除"与"随后写回"之间留出观察窗口
	const helper = startHelper(helperExe, { mainPid: fixture.pid, stateFile: c.stateFile, logFile: c.logFile, saveDebounceMs: 1500 });
	check(await waitForLog(c.logFile, 'saved state rejected: off-screen or degenerate rect 159x27 @(-25600,-25600); deleted, keeping default geometry'),
		'识别并拒绝被毒化的状态');
	check(!fs.existsSync(c.stateFile), '坏状态文件已被删除');
	check(!fixture.hasRect({ x: -25600, y: -25600, w: 159, h: 27 }), '没有把窗口挪到屏幕外');
	check(await waitForLog(c.logFile, `saved: ${initial.w}x${initial.h} @(${initial.x},${initial.y})`, 10000), '随后写回当前正常几何', readLog(c.logFile).trim().split('\n').slice(-2).join(' | '));
	helper.stop();
	fixture.stop();
}

async function caseOffScreenGuard(fixtureExe, helperExe) {
	const c = newCase('屏幕外守卫（不落盘）');
	// Chromium 给隐藏窗口的停靠位。尺寸用系统允许的窗口矩形：可缩放窗口有最小
	// 跟踪尺寸，159x27 会被系统撑成 159x39，所以这里只用"位置"触发屏幕外交集判据。
	const fixture = startFixture(fixtureExe, { x: -25600, y: -25600, w: 400, h: 300 });
	const parked = await waitFor(() => {
		const rect = fixture.latest();
		return rect && rect.x === -25600 && rect.y === -25600 ? rect : undefined;
	}, 8000);
	check(Boolean(parked), '夹具停在隐藏停靠位', JSON.stringify(fixture.latest()));

	const helper = startHelper(helperExe, { mainPid: fixture.pid, stateFile: c.stateFile, logFile: c.logFile, saveDebounceMs: 300 });
	check(await waitForLog(c.logFile, 'no saved state; first run, keeping default geometry'), '报告无保存状态');
	check(await waitForLog(c.logFile, `state save skipped: off-screen or degenerate rect ${parked.w}x${parked.h} @(-25600,-25600)`),
		'屏幕外几何被守卫拦下', readLog(c.logFile).trim().split('\n').slice(-2).join(' | '));
	await sleep(800); // 给"万一写盘"留出时间，再断言文件不存在
	check(!fs.existsSync(c.stateFile), '状态文件始终没有被创建');
	helper.stop();
	fixture.stop();
}

async function caseMaximized(fixtureExe, helperExe) {
	const c = newCase('最大化态（只记 zoomed 标志）');
	const fixture = startFixture(fixtureExe, { x: 300, y: 200, w: 700, h: 500 });
	check(Boolean(await waitFor(() => fixture.latest(), 8000)), '夹具窗口已就绪');
	writeState(c.stateFile, { x: 0, y: 0, w: 0, h: 0, zoomed: true });

	const helper = startHelper(helperExe, { mainPid: fixture.pid, stateFile: c.stateFile, logFile: c.logFile });
	check(await waitForLog(c.logFile, 'restored: maximized (per saved state)'), '按保存态最大化');
	check(await waitForLog(c.logFile, 'saved: maximized'), '监视阶段记录最大化');
	const saved = await waitFor(() => {
		const value = readState(c.stateFile);
		return value && value.zoomed === true ? value : undefined;
	}, 8000);
	check(Boolean(saved), '状态文件记录 zoomed=true 而不是原始坐标', JSON.stringify(readState(c.stateFile)));
	helper.stop();
	fixture.stop();
}

async function caseWindowDestroyed(fixtureExe, helperExe) {
	const c = newCase('窗口销毁后 watcher 自行退出');
	const fixture = startFixture(fixtureExe, { x: 300, y: 200, w: 700, h: 500 });
	check(Boolean(await waitFor(() => fixture.latest(), 8000)), '夹具窗口已就绪');
	writeState(c.stateFile, { x: 300, y: 200, w: 700, h: 500 });

	const helper = startHelper(helperExe, { mainPid: fixture.pid, stateFile: c.stateFile, logFile: c.logFile });
	check(await waitForLog(c.logFile, 'window found hwnd='), 'watcher 已接管窗口');
	fixture.stop();
	const exited = await waitExit(helper.proc, 6000);
	check(exited, '窗口销毁后 helper 进程结束');
	check(/window destroyed; watcher exits|parent exited; watcher exits/.test(readLog(c.logFile)), '日志记录了退出原因',
		readLog(c.logFile).trim().split('\n').slice(-2).join(' | '));
}

// ---------------------------------------------------------------- 主流程

console.log('window-memory 真窗口回归测试');

const helperExe = await ensureHelper();
if (!helperExe) {
	console.error('FAIL 无法获得 helper.exe（缺 csc.exe 或编译失败，详见 %TEMP%\\dsh-window-memory.log）');
	process.exit(1);
}
console.log(`helper: ${helperExe}`);

try {
	const fixtureExe = compileFixture();
	console.log(`fixture: ${fixtureExe}`);
	await caseRestoreAndSave(helperExe, fixtureExe);
	await caseFirstRun(fixtureExe, helperExe);
	await casePoisonedState(fixtureExe, helperExe);
	await caseOffScreenGuard(fixtureExe, helperExe);
	await caseMaximized(fixtureExe, helperExe);
	await caseWindowDestroyed(fixtureExe, helperExe);
} catch (error) {
	failed++;
	console.error(`FAIL 测试执行异常: ${error?.stack ?? error}`);
} finally {
	for (const cleanup of cleanups.reverse()) cleanup();
	await sleep(200);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
