/**
 * 本地插件「显示名 / 简介」locale 元数据契约检查（零依赖，只读文件）。
 *
 * 为什么需要这一份：设置页的插件标题取 `meta.title ?? 包名`，而 meta 来自
 * `<包名>/locale/en.json`（入口）与 `<包名>/locale/zh.json`，并且要求包的
 * `exports` 声明 `./locale/*.json`。任何一环缺失都会**静默**回退成 `@local/xxx`，
 * 界面不报错，只能在设置页肉眼看出来——2026-10 给 21 个插件补中文名时踩过。
 *
 * 检查项（每个一级插件目录）：
 *   1. locale/en.json 存在、JSON 合法、meta.title 非空；
 *   2. locale/zh.json 存在、JSON 合法、meta.title 与 meta.description 非空；
 *   3. package.json 的 exports 声明 "./locale/*.json"；
 *   4. package.json 的 files 含 "locale/*.json"；
 *   5. 以上文件均无 UTF-8 BOM。
 *
 * 运行：node tools\verify-plugin-locale.mjs
 * 退出码：0 全通过；1 有失败。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 不是运行期插件、不参与本约定的目录。 */
const SKIP = new Set(['.archived', '.agents', '.git', 'docs', 'node_modules', 'tools']);

let checks = 0;
let failures = 0;

/** 记一条断言。 */
function ok(label, condition) {
  checks += 1;
  if (condition) {
    console.log('  ok  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL ' + label);
  }
}

/** 文件是否带 UTF-8 BOM（宿主按 UTF-8 读 JSON，BOM 会让 JSON.parse 直接失败）。 */
function hasBom(file) {
  const buf = readFileSync(file);
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

/** 读并解析 JSON。 */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** 非空字符串判定。 */
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

const plugins = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !SKIP.has(entry.name))
  .filter((entry) => existsSync(join(ROOT, entry.name, 'package.json')))
  .map((entry) => entry.name)
  .sort();

console.log('发现 ' + plugins.length + ' 个插件目录：' + plugins.join(', '));
console.log('');

for (const name of plugins) {
  const dir = join(ROOT, name);
  console.log(name);

  const pkgPath = join(dir, 'package.json');
  ok('package.json 无 BOM', !hasBom(pkgPath));

  let pkg;
  try {
    pkg = readJson(pkgPath);
  } catch (error) {
    ok('package.json JSON 合法', false);
    continue;
  }
  ok('package.json JSON 合法', true);
  ok(
    'exports 声明 "./locale/*.json"',
    pkg.exports?.['./locale/*.json'] === './locale/*.json',
  );
  ok(
    'files 含 "locale/*.json"',
    Array.isArray(pkg.files) && pkg.files.includes('locale/*.json'),
  );

  for (const [lang, needDescription] of [['en', false], ['zh', true]]) {
    const rel = name + '/locale/' + lang + '.json';
    const file = join(dir, 'locale', lang + '.json');
    if (!existsSync(file)) {
      ok(rel + ' 存在', false);
      continue;
    }
    ok(rel + ' 无 BOM', !hasBom(file));

    let meta;
    try {
      meta = readJson(file).meta;
    } catch (error) {
      ok(rel + ' JSON 合法', false);
      continue;
    }
    ok(rel + ' JSON 合法', true);
    ok(rel + ' meta.title 非空', isText(meta?.title));
    if (needDescription) {
      ok(rel + ' meta.description 非空', isText(meta?.description));
    }
  }

  console.log('');
}

if (failures === 0) {
  console.log('全部通过：' + checks + ' 项检查。');
  process.exit(0);
} else {
  console.log('失败 ' + failures + ' 项 / 共 ' + checks + ' 项检查。');
  process.exit(1);
}
