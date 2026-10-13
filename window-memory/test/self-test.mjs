#!/usr/bin/env node
/**
 * window-memory 纯逻辑自检。
 *
 * 只驱动 helper.exe 的 `-SelfTest`：不创建窗口、不碰真实状态文件，
 * 覆盖屏幕外守卫、坏值拒绝与状态文件字节格式（UTF-8 BOM + CRLF）。
 * 与 helper.cs 同源，跑得快，适合每次改动后先跑这一层。
 *
 * 用法：node window-memory/test/self-test.mjs
 */
import { spawnSync } from 'node:child_process';
import { ensureHelper } from '../index.js';

const helper = await ensureHelper();
if (!helper) {
	console.error('FAIL 无法获得 helper.exe（缺 csc.exe 或 helper.cs 编译失败，详见 %TEMP%\\dsh-window-memory.log）');
	process.exit(1);
}

const result = spawnSync(helper, ['-SelfTest'], { encoding: 'utf8', windowsHide: true });
const stdout = result.stdout ?? '';
const stderr = result.stderr ?? '';
process.stdout.write(stdout);
if (stderr.trim()) process.stderr.write(stderr);

const summary = /self-test: (\d+) checks, (\d+) failures/.exec(stdout);
const failedLines = stdout.split(/\r?\n/).filter((line) => line.startsWith('FAIL ')).length;

if (!summary) {
	console.error('FAIL 未拿到自检摘要（helper 可能未正常启动）');
	process.exit(1);
}
const checks = Number(summary[1]);
const failures = Number(summary[2]);

if (result.status !== 0 || failures !== 0 || failedLines !== 0 || checks < 20) {
	console.error(`FAIL self-test: exit=${result.status} checks=${checks} failures=${failures} failLines=${failedLines}`);
	process.exit(1);
}
console.log(`OK self-test: ${checks} checks passed`);
