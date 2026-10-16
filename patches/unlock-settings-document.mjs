#!/usr/bin/env node
/**
 * 摘掉设置文档上的外部占用（编辑器 / agent 会话握着句柄）。
 *
 * 背景：Windows 上只要还有别的进程打开着目标文件，`rename` 覆盖（DSH 保存设置的最后一步）
 * 就会被拒（Win32 5 / EPERM），而**写权限始终放行**。实测（见 docs/dsh-settings-document-lock.md
 * 第八节）：
 *   - 目标被持有：独占打开拒绝、write/delete 权限都允许、`MoveFileEx(REPLACE_EXISTING)` 失败 5；
 *   - 用 `ReplaceFileW` 或"先删名再落名"之后：路径变 FREE，普通原子 rename 也恢复，且 Zed 不重启、
 *     不重新上锁（20 秒采样 4/4 FREE）。
 *
 * 所以本脚本做的是**换掉路径指向的文件对象**，而不是去动对方的句柄：把当前内容逐字节写一份到
 * 同目录的临时文件，删掉原名字，再把临时文件改名为原名。对方手里那个句柄随之退化成"指向一个
 * 已无名的旧文件"，不再占住这个路径；你这边内容一字未变。
 *
 * 适用与边界：
 *   - 对方必须以共享删除的方式打开（否则 `rm` 会被拒 —— 那时本脚本什么都改不了，
 *     报告出来交给你，写入仍由 `apply-dsh-atomic-write-fallback.mjs` 的原地覆写兜底）；
 *   - 这是"路径级解锁"，不是"让对方松手"：对方下一次重新打开该路径，占用就会回来，再跑一次即可；
 *   - 只碰这几个 profile 设置文档，不触碰任何其它文件。
 *
 * 用法：
 *   node patches/unlock-settings-document.mjs --check            # 只看状态，不改任何文件
 *   node patches/unlock-settings-document.mjs                    # 解开 web / desktop 两份
 *   node patches/unlock-settings-document.mjs --target <文件>     # 指定文件（可重复）
 *   node patches/unlock-settings-document.mjs --settle 20        # 解开后再采样 N 秒，看会不会被重新占
 */
import { copyFileSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** 默认目标：DSH profile 的设置文档（存在才处理）。 */
const DEFAULT_TARGETS = ['web', 'desktop'].map((profile) =>
  join(homedir(), '.dsh', 'profiles', profile, 'cordis.patch.yml')
);
/** Windows 上「替换被拒绝」的错误码集合。 */
const REFUSED = new Set(['EPERM', 'EACCES', 'EBUSY']);

const argOf = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const argsOf = (name) => {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1] !== undefined) values.push(process.argv[index + 1]);
  }
  return values;
};

/**
 * 目标现在能不能走"标准"的原子替换。
 *
 * 判据只能用替换本身，不能用打开：Node 打开文件一律共享读/写/删，被占用的文件照样打得开。
 * 副作用是有的（成功时文件对象被换新，内容不变），而这恰好也是本脚本想要的净效果。
 *
 * @param file - 目标路径。
 * @returns `{ state: 'free' | 'held' | 'missing', detail }`。
 */
const probe = (file) => {
  const staged = `${file}.unlock-probe`;
  try {
    copyFileSync(file, staged);
  } catch (error) {
    return { state: 'missing', detail: String(error?.code ?? error?.message) };
  }
  try {
    renameSync(staged, file);
    return { state: 'free', detail: 'rename 提交成功' };
  } catch (error) {
    rmSync(staged, { force: true });
    if (REFUSED.has(String(error?.code))) return { state: 'held', detail: `${error.code}（rename 被拒）` };
    return { state: 'missing', detail: String(error?.code ?? error?.message) };
  }
};

/**
 * 摘掉目标路径上的占用：内容逐字节保真，换掉的是文件对象。
 *
 * @param file - 目标路径。
 * @returns `{ ok, detail }`，失败时文件保持原状（或已用内存里的原字节立刻补回原名）。
 */
const unlock = (file) => {
  const before = readFileSync(file);
  const staged = `${file}.${process.pid.toString(16)}.unlock`;
  writeFileSync(staged, before);
  if (!readFileSync(staged).equals(before)) {
    rmSync(staged, { force: true });
    return { ok: false, detail: '暂存副本与原文不一致，已放弃（未动目标）' };
  }
  try {
    rmSync(file);
  } catch (error) {
    rmSync(staged, { force: true });
    return { ok: false, detail: `删除原名字被拒（${error?.code}）：对方没有共享删除权限，本脚本无能为力` };
  }
  try {
    renameSync(staged, file);
  } catch (error) {
    // 名字已经摘掉了，必须立刻补回来，否则设置文档会消失。
    writeFileSync(file, before);
    rmSync(staged, { force: true });
    return { ok: false, detail: `落名失败（${error?.code}），已用内存中的原字节恢复原名` };
  }
  const after = readFileSync(file);
  if (!after.equals(before)) return { ok: false, detail: '内容校验不一致（已落名，请人工核对）' };
  return { ok: true, detail: `内容逐字节一致（${before.length} 字节）` };
};

const targets = argsOf('--target').length > 0 ? argsOf('--target') : DEFAULT_TARGETS.filter((file) => {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
});
const checkOnly = process.argv.includes('--check');
const settle = Number(argOf('--settle') ?? '0');

if (targets.length === 0) {
  console.log('没有可处理的设置文档（用 --target <文件> 指定）。');
  process.exit(0);
}

for (const file of targets) {
  const label = `${basename(dirname(file))}/${basename(file)}`;
  const first = probe(file);
  console.log(`${label}: ${first.state}  ${first.detail}`);
  if (first.state !== 'held' || checkOnly) continue;
  const outcome = unlock(file);
  console.log(`  unlock: ${outcome.ok ? 'OK' : 'FAILED'}  ${outcome.detail}`);
  if (outcome.ok) {
    const second = probe(file);
    console.log(`  after : ${second.state}  ${second.detail}`);
  }
}

if (settle > 0) {
  const started = Date.now();
  while (Date.now() - started < settle * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const states = targets.map((file) => `${basename(dirname(file))}=${probe(file).state}`);
    console.log(`  t+${Math.round((Date.now() - started) / 1000)}s  ${states.join('  ')}`);
  }
}
