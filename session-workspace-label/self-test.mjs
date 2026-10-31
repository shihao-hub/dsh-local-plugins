/**
 * 零依赖用例：在 node:vm 里跑 client.js，只测纯函数与静态契约。
 *
 *   node self-test.mjs
 *
 * 不碰 DOM（模块只在 apply 里操作 document），因此不需要 jsdom。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

let registration = null;
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(entry) {
        registration = entry;
      }
    }
  },
  console
};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'client.js' });

if (registration === null) {
  console.error('FAIL: client.js 没有调用 window.__ModuleLoader__.load');
  process.exit(1);
}
if (registration.id !== '@local/session-workspace-label') {
  console.error('FAIL: 模块 id 不符：', registration.id);
  process.exit(1);
}

const mod = registration.factory(() => ({ createElement: () => null }));
const test = mod.__test;

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    const result = fn();
    if (result === true) {
      passed += 1;
    } else {
      failures.push(`${name}（返回 ${JSON.stringify(result)}）`);
    }
  } catch (error) {
    failures.push(`${name}（抛错 ${error.message}）`);
  }
}

function eq(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

// ---- 模块契约 --------------------------------------------------------------

check('inject 含 slots/locale/sessions/workspaces', () =>
  eq(mod.inject, ['slots', 'locale', 'sessions', 'workspaces'])
);
check('apply 是函数', () => typeof mod.apply === 'function');
check('默认模式 flat（只有单列表显示）', () => test.DEFAULT_MODE === 'flat');
check('模式集合', () => eq(test.MODES, ['all', 'flat', 'off']));
check('行选择器只认 session 行', () => test.ROW_SELECTOR === 'div[data-row-key^="session:"]');
check('行标记属性', () => test.ROW_ATTR === 'data-swl');
check('副标题标记属性', () => test.LABEL_ATTR === 'data-swl-label');
check('样式标签 id', () => test.STYLE_TAG_ID === '@local/session-workspace-label/rows.css');
check('存储键', () => test.STORE_KEY === 'session-workspace-label.mode');

// ---- CSS 契约 --------------------------------------------------------------

check('CSS 抬高带标记的行', () => /\[data-swl\]\s*\{[^}]*height:\s*46px/s.test(test.CSS));
check('CSS 用 border-box 固定总高', () => /box-sizing:\s*border-box/.test(test.CSS));
check('CSS 预留 14px 底边', () => /padding-bottom:\s*14px/.test(test.CSS));
check('CSS 副标题绝对定位', () => /\.swl_label\s*\{[^}]*position:\s*absolute/s.test(test.CSS));
check('CSS 副标题不挡交互', () => /\.swl_label\s*\{[^}]*pointer-events:\s*none/s.test(test.CSS));
check('CSS 单行省略', () => /\.swl_text\s*\{[^}]*text-overflow:\s*ellipsis/s.test(test.CSS));
check('CSS 尊重工作区缩进变量', () => test.CSS.includes('--dsh-workspace-indent'));

// ---- baseName --------------------------------------------------------------

check('Windows 路径取 basename', () => test.baseName('D:\\Users\\dsh-local-plugins') === 'dsh-local-plugins');
check('POSIX 路径取 basename', () => test.baseName('/home/u/proj') === 'proj');
check('尾部分隔符被忽略', () => test.baseName('D:\\a\\b\\') === 'b');
check('混合分隔符', () => test.baseName('D:/a\\b/c') === 'c');
check('空串返回空串', () => test.baseName('') === '');
check('非字符串返回空串', () => test.baseName(null) === '' && test.baseName(42) === '');

// ---- workspaceTitles -------------------------------------------------------

const snapshot = {
  items: [
    { workspaceId: 'w1', title: 'language_projects', path: 'D:\\Users\\language_projects', sessionIds: ['s1', 's2'] },
    { workspaceId: 'w2', title: '', path: 'D:\\Users\\resume-workspace', sessionIds: ['s3'] },
    { workspaceId: 'w3', title: '   ', path: 'D:\\Users\\padded', sessionIds: ['s4'] },
    { workspaceId: 'w4', title: 'dup', path: 'D:\\dup', sessionIds: ['s1'] },
    { workspaceId: 'bad', title: 'no-sessions' },
    null
  ]
};
const titles = test.workspaceTitles(snapshot);

check('标题直接采用', () => titles.get('s1') === 'language_projects');
check('同一会话只记第一次出现', () => titles.get('s1') === 'language_projects');
check('空标题退回 path basename', () => titles.get('s3') === 'resume-workspace');
check('纯空白标题退回 path basename', () => titles.get('s4') === 'padded');
check('缺 sessionIds 的项被跳过', () => !titles.has('no-sessions'));
check('null 快照得到空 Map', () => test.workspaceTitles(null).size === 0);
check('undefined 快照得到空 Map', () => test.workspaceTitles(undefined).size === 0);
check('缺 items 得到空 Map', () => test.workspaceTitles({}).size === 0);

// ---- labelFor --------------------------------------------------------------

const byId = {
  s1: { id: 's1', cwd: 'D:\\Users\\language_projects' },
  s9: { id: 's9', cwd: 'D:\\Users\\orphan' },
  s10: { id: 's10', cwd: '' }
};

check('优先 Workspace 标题', () => test.labelFor(titles, byId, 's1') === 'language_projects');
check('无 Workspace 时用 cwd basename', () => test.labelFor(titles, byId, 's9') === 'orphan');
check('cwd 为空时回退未分组', () => test.labelFor(titles, byId, 's10') === 'label.ungrouped');
check('会话不存在时回退未分组', () => test.labelFor(titles, byId, 'missing') === 'label.ungrouped');
check('byId 为 null 不抛错', () => test.labelFor(titles, null, 's1') === 'language_projects');
check('空 Map + null byId 仍回退', () => test.labelFor(new Map(), null, 'x') === 'label.ungrouped');

// ---- 汇总 ------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`FAIL ${failures.length} 项：`);
  for (const failure of failures) console.error(' -', failure);
  process.exit(1);
}
console.log(`PASS ${passed} 项`);
