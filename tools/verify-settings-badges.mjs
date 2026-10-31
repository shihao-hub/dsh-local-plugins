/**
 * 通用设置「插件来源徽章」契约检查（零依赖，只读文件）。
 *
 * 为什么需要这一份：5 个本地插件的设置行各自复制了同一份徽章结构（不引共享依赖，
 * 保持插件自包含）。约定一旦在某个插件里漂移——属性名写错、徽章类名漏改、中英字典
 * 只补一侧——设置页不会报错，只会静默少一枚徽章或退化成裸文本，肉眼很难发现。
 *
 * 检查项（每个插件设置行）：
 *   1. 行根节点带 `data-plugin-setting` / `data-plugin-package`；
 *   2. `ROW_ID`（或 `PLUGIN_ID`）常量与注册 id 一致；
 *   3. 徽章类名存在于该插件的样式表；
 *   4. zh / en 字典各含 `badge` 与 `badgeTitle` 两个键。
 *
 * 运行：node tools\verify-settings-badges.mjs
 * 退出码：0 全通过；1 有失败。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 每个设置行的契约。`dictPrefix` 是它自己的字典命名空间前缀：
 * 前四个插件用 `row.*`，model-favorites 用 `settings.*`。
 */
const ROWS = [
  { plugin: 'pin-highlight', rowId: 'pin-highlight', badgeClass: 'php_badge', dictPrefix: 'row' },
  { plugin: 'active-session-highlight', rowId: 'active-session-highlight', badgeClass: 'ash_badge', dictPrefix: 'row' },
  { plugin: 'running-session-highlight', rowId: 'running-session-highlight', badgeClass: 'rsh_badge', dictPrefix: 'row' },
  { plugin: 'rider-theme', rowId: 'rider-theme', badgeClass: 'rdt_badge', dictPrefix: 'row' },
  { plugin: 'model-favorites', rowId: 'model-favorites-status', badgeClass: 'mfs_badge', dictPrefix: 'settings' },
  { plugin: 'rightbar-width', rowId: 'rightbar-width', badgeClass: 'rbw_badge', dictPrefix: 'row' },
  { plugin: 'session-tag-lite', rowId: 'session-tag-lite', badgeClass: 'stl_setBadge', dictPrefix: 'row' }
];

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

/** 统计子串出现次数（用于「中英字典各一条」这类断言）。 */
function count(haystack, needle) {
  let total = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    total += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return total;
}

for (const row of ROWS) {
  const rel = row.plugin + '/client.js';
  console.log(rel);
  let code;
  try {
    code = readFileSync(join(ROOT, rel), 'utf8');
  } catch (error) {
    failures += 1;
    console.log('  FAIL 读取失败：' + error.message);
    continue;
  }

  ok('行根带 data-plugin-setting', code.includes("'data-plugin-setting': "));
  ok('行根带 data-plugin-package', code.includes("'data-plugin-package': "));
  ok('注册 id 与 ROW_ID 一致', code.includes("id: '" + row.rowId + "'"));
  ok(
    'ROW_ID 常量取注册 id',
    code.includes("const ROW_ID = '" + row.rowId + "'") ||
      code.includes("const ROW_ID = '" + row.rowId + "';")
  );
  ok('样式表定义徽章类', code.includes('.' + row.badgeClass + '{'));
  ok('字典含 badge（中英各一）', count(code, "'" + row.dictPrefix + ".badge'") >= 2);
  ok('字典含 badgeTitle（中英各一）', count(code, "'" + row.dictPrefix + ".badgeTitle'") >= 2);
  ok('徽章 title 使用 badgeTitle', code.includes("badgeTitle'"));
}

console.log('');
if (failures === 0) {
  console.log('全部通过：' + checks + ' 项检查。');
  process.exit(0);
} else {
  console.log('失败 ' + failures + ' 项 / 共 ' + checks + ' 项检查。');
  process.exit(1);
}
