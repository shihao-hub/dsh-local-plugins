#!/usr/bin/env node
/**
 * 重打脚本：给已安装的 `@deepseek-ai/dsh-atomic-write` 加上「原地覆写兜底」。
 *
 * 为什么需要它、代价是什么、怎么验证：见同目录 README.md。
 *
 * 用法：
 *   node patches/apply-dsh-atomic-write-fallback.mjs --check          # 只看状态
 *   node patches/apply-dsh-atomic-write-fallback.mjs                  # 打补丁（幂等）
 *   node patches/apply-dsh-atomic-write-fallback.mjs --revert         # 回退到备份
 *   node patches/apply-dsh-atomic-write-fallback.mjs --dsh-root <目录> # 指定安装根
 *
 * 退出码：0 成功/已打过；1 打不上（上游结构变了或找不到安装）。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = join(HERE, '.backup');
const RECORD_PATH = join(BACKUP_DIR, 'applied.json');

/** 打标注释：既是幂等判据，也是「这行不是上游代码」的标记。 */
const MARKER = '//#region dsh-local-patch: atomic-write in-place fallback';
/** 上游文件末尾的导出行；本补丁把它换成「导出包装后的 writeFileAtomic」。 */
const EXPORT_ANCHOR = 'export { withFileLock, writeFileAtomic };';
/** 上游形状自检：这些串必须存在，否则拒绝下手。 */
const SHAPE_PROBES = [
  'WINDOWS_TRANSIENT_RENAME_ERRORS',
  'async function writeFileAtomic(',
  'async function renameAtomicTemp('
];

/**
 * 追加到上游文件末尾的补丁区。故意只用字符串拼接与普通标识符，
 * 以便安全地嵌进本脚本的模板字符串。
 */
const PATCH_REGION = `${MARKER}
import { chmod, open, stat } from "node:fs/promises";
/**
 * 本地补丁，非上游代码。
 *
 * Windows 上，只要还有别的程序握着目标文件的句柄，改名替换就会被拒
 * （典型场景：编辑器握着 profile 的设置文档），而上面那组有限重试等不过
 * 一个整场会话都不松手的句柄。此时内容本身仍然写得进去，所以这次保存不必丢：
 * 退化为「先留 <文件>.bak，再原地覆写」。代价是读方可能在写入过程中看到半份
 * 文件——正是本包原本要排除的原子性缺口——因此每次退化都会通过
 * process.emitWarning 说出文件名，并可用 DSH_ATOMIC_WRITE_NO_INPLACE_FALLBACK=1 关掉。
 */
const DSH_INPLACE_FALLBACK_OFF = process.env.DSH_ATOMIC_WRITE_NO_INPLACE_FALLBACK === "1";
/** 重试耗尽后仍然失败的，是不是「替换本身被 Windows 拒绝」。 */
function isWindowsReplaceRefusal(error) {
	if (process.platform !== "win32") return false;
	return WINDOWS_TRANSIENT_RENAME_ERRORS.has(error?.code ?? "");
}
/** 备份后在原地重写目标内容；返回是否真的救了回来。 */
async function replaceInPlace(filename, content, options) {
	if (DSH_INPLACE_FALLBACK_OFF || process.platform !== "win32") return false;
	let info;
	try {
		info = await stat(filename);
	} catch (error) {
		return false;
	}
	if (!info.isFile()) return false;
	let previous;
	try {
		previous = await readFile(filename);
	} catch (error) {
		return false;
	}
	const next = Buffer.isBuffer(content) ? content : Buffer.from(content);
	try {
		await writeFile(filename + ".bak", previous, { mode: info.mode & 511 });
	} catch (error) {
		return false;
	}
	let handle;
	try {
		handle = await open(filename, "r+");
		await handle.write(next, 0, next.length, 0);
		await handle.truncate(next.length);
		await handle.sync();
	} catch (error) {
		return false;
	} finally {
		if (handle !== undefined) await handle.close().catch(() => {});
	}
	if (options?.mode !== void 0) await chmod(filename, options.mode).catch(() => {});
	process.emitWarning("the atomic replace was refused (a program holds the file open); the content was rewritten in place behind " + filename + ".bak", { code: "DSH_ATOMIC_WRITE_INPLACE_FALLBACK" });
	return true;
}
/** 与上游同名同签名，只在替换被拒时多做一步兜底。 */
async function writeFileAtomicFallback(filename, content, options) {
	try {
		return await writeFileAtomic(filename, content, options);
	} catch (error) {
		if (!isWindowsReplaceRefusal(error)) throw error;
		if (await replaceInPlace(filename, content, options)) return;
		throw error;
	}
}
export { withFileLock, writeFileAtomicFallback as writeFileAtomic };
//#endregion`;

const argOf = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const run = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
};

/** 候选安装根：显式参数 → 环境变量 → npm 全局根 → PATH 里的 dsh 启动器。 */
const candidateRoots = () => {
  const roots = [];
  const explicit = argOf('--dsh-root') ?? process.env.DSH_INSTALL_ROOT;
  if (explicit !== undefined) roots.push(resolve(explicit));
  const globalRoot = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g']);
  if (globalRoot !== undefined && globalRoot.length > 0) roots.push(join(globalRoot, '@deepseek-ai', 'dsh'), globalRoot);
  const where = run(process.platform === 'win32' ? 'where' : 'which', ['dsh']);
  for (const line of (where ?? '').split(/\r?\n/)) {
    let dir = line.trim();
    if (dir.length === 0) continue;
    for (let up = 0; up < 4; up += 1) {
      roots.push(join(dir, 'node_modules', '@deepseek-ai', 'dsh'));
      roots.push(dir);
      dir = dirname(dir);
    }
  }
  return [...new Set(roots)];
};

/** 在候选根下找出 atomic-write 的真实入口文件。 */
const findTarget = () => {
  const relative = [
    join('node_modules', '@deepseek-ai', 'dsh-atomic-write', 'lib', 'index.js'),
    join('@deepseek-ai', 'dsh-atomic-write', 'lib', 'index.js')
  ];
  for (const root of candidateRoots()) {
    for (const rel of relative) {
      const candidate = join(root, rel);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
};

const sha = (text) => createHash('sha256').update(text).digest('hex');
const target = findTarget();
if (target === undefined) {
  console.error('找不到已安装的 @deepseek-ai/dsh-atomic-write/lib/index.js —— 用 --dsh-root 指定安装根。');
  process.exit(1);
}
console.log(`target: ${target}`);

const original = readFileSync(target, 'utf8');
const patched = original.includes(MARKER);
const mode = process.argv.includes('--check') ? 'check' : process.argv.includes('--revert') ? 'revert' : 'apply';

if (mode === 'check') {
  console.log(`state : ${patched ? '已打补丁' : '未打补丁（上游原样）'}  sha256=${sha(original).slice(0, 12)}`);
  if (existsSync(RECORD_PATH)) console.log(`record: ${readFileSync(RECORD_PATH, 'utf8').trim()}`);
  process.exit(0);
}

if (mode === 'revert') {
  if (!existsSync(RECORD_PATH)) {
    console.error('没有备份记录，无法回退。');
    process.exit(1);
  }
  const record = JSON.parse(readFileSync(RECORD_PATH, 'utf8'));
  // 同一份安装常有两个写法（nvm 的 `D:\nvm4w\nodejs` 是软链），按真实路径比对，
  // 免得"不带 --dsh-root 就回退不了"。
  const same = (one, other) => {
    try {
      return realpathSync(one) === realpathSync(other);
    } catch {
      return resolve(one) === resolve(other);
    }
  };
  if (!same(record.target, target)) {
    console.error(`备份记录的 target 与当前目标不是同一份文件：${record.target}`);
    process.exit(1);
  }
  if (!existsSync(record.backup)) {
    console.error(`备份文件不存在：${record.backup}`);
    process.exit(1);
  }
  const restored = readFileSync(record.backup, 'utf8');
  if (sha(restored) !== record.sha256) {
    console.error(`备份文件已被改动（sha256 不符），拒绝回退：${record.backup}`);
    process.exit(1);
  }
  writeFileSync(target, restored, 'utf8');
  console.log(`reverted: 写回上游原文 sha256=${record.sha256.slice(0, 12)}`);
  process.exit(0);
}

if (patched) {
  console.log('already applied: 检测到补丁标记，未改动。');
  process.exit(0);
}

const missing = SHAPE_PROBES.filter((probe) => !original.includes(probe));
const anchorCount = original.split(EXPORT_ANCHOR).length - 1;
if (missing.length > 0 || anchorCount !== 1) {
  console.error('上游结构与本补丁的假设不符，拒绝下手（避免打坏支付路径）。');
  if (missing.length > 0) console.error(`  缺少形状探针：${missing.join(', ')}`);
  if (anchorCount !== 1) console.error(`  导出锚点出现 ${anchorCount} 次（应为 1 次）：${EXPORT_ANCHOR}`);
  process.exit(1);
}

const next = original.replace(EXPORT_ANCHOR, PATCH_REGION);

// 先在一个临时文件里 import 一次组好的内容：上游结构或本补丁本身语法出错时，
// 必须在碰目标文件之前就失败。
const probe = join(tmpdir(), `dsh-atomic-write-patchcheck-${sha(next).slice(0, 12)}.mjs`);
writeFileSync(probe, next, 'utf8');
try {
  execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(probe).href)})`], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
} catch (error) {
  rmSync(probe, { force: true });
  console.error('补丁后的模块 import 失败，未改动目标文件：');
  console.error(String(error.stderr ?? error.message).trim());
  process.exit(1);
}
rmSync(probe, { force: true });
mkdirSync(BACKUP_DIR, { recursive: true });
const backup = join(BACKUP_DIR, `dsh-atomic-write-index.${sha(original).slice(0, 12)}.js`);
writeFileSync(backup, original, 'utf8');
writeFileSync(
  RECORD_PATH,
  `${JSON.stringify({ target, backup, sha256: sha(original), appliedAt: new Date().toISOString() }, null, 2)}\n`,
  'utf8'
);
writeFileSync(target, next, 'utf8');

const verify = readFileSync(target, 'utf8');
if (!verify.includes(MARKER) || !verify.includes('export { withFileLock, writeFileAtomicFallback as writeFileAtomic };')) {
  console.error('写回后校验失败：补丁标记或导出包装不在文件里。请用 --revert 回退。');
  process.exit(1);
}
console.log(`applied: ${target}`);
console.log(`backup : ${backup}`);
console.log(`verify : node --input-type=module -e "await import('file:///${target.replace(/\\/g, '/')}')"`);
