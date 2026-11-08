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

// ---- 设置行说明（模式 × 当前视图） ------------------------------------------

check('说明 key 覆盖每个模式', () => test.MODES.every((mode) => typeof test.MODE_HINT_KEYS[mode] === 'string'));
check('all 模式说明', () => test.modeHintKey('all', false) === 'mode.hint.all');
check('flat + 单列表说明', () => test.modeHintKey('flat', true) === 'mode.hint.flat');
check('flat + 分组视图说明', () => test.modeHintKey('flat', false) === 'mode.hint.grouped');
check('off 模式说明', () => test.modeHintKey('off', true) === 'mode.hint.off');
check('脏模式回落默认', () => test.modeHintKey('nope', false) === 'mode.hint.grouped');
check('中英字典键集一致', () => {
  const zhKeys = Object.keys(test.zh).sort();
  const enKeys = Object.keys(test.en).sort();
  return JSON.stringify(zhKeys) === JSON.stringify(enKeys);
});
check('四条说明文案中英都非空', () =>
  ['mode.hint.all', 'mode.hint.flat', 'mode.hint.grouped', 'mode.hint.off'].every(
    (key) =>
      typeof test.zh[key] === 'string' &&
      test.zh[key] !== '' &&
      typeof test.en[key] === 'string' &&
      test.en[key] !== ''
  )
);

// ---- CSS 契约 --------------------------------------------------------------

check('CSS 抬高带标记的行', () => /\[data-swl\]\s*\{[^}]*height:\s*46px/s.test(test.CSS));
check('CSS 用 border-box 固定总高', () => /box-sizing:\s*border-box/.test(test.CSS));
check('CSS 预留 14px 底边', () => /padding-bottom:\s*14px/.test(test.CSS));
check('CSS 副标题绝对定位', () => /\.swl_label\s*\{[^}]*position:\s*absolute/s.test(test.CSS));
check('CSS 副标题不挡交互', () => /\.swl_label\s*\{[^}]*pointer-events:\s*none/s.test(test.CSS));
check('CSS 单行省略', () => /\.swl_text\s*\{[^}]*text-overflow:\s*ellipsis/s.test(test.CSS));
check('CSS 尊重工作区缩进变量', () => test.CSS.includes('--dsh-workspace-indent'));
check('CSS 工作区名可压缩（flex:1 1 auto）', () => /\.swl_text\s*\{[^}]*flex:\s*1 1 auto/s.test(test.CSS));
check('CSS 标识胶囊贴右（margin-left:auto）', () => /\.swl_alias\s*\{[^}]*margin-left:\s*auto/s.test(test.CSS));
check('CSS 标识用代号色变量', () => /\.swl_alias\s*\{[^}]*var\(--swl-alias-color/s.test(test.CSS));
check('CSS 标识不退化成裸字（有胶囊底）', () => /\.swl_alias\s*\{[^}]*border-radius:\s*999px/s.test(test.CSS));
check('CSS 浮层压住宿主层', () => /\.swl_veil\s*\{[^}]*z-index:\s*1200/s.test(test.CSS));
check('CSS 菜单项存在', () => /\.swl_mitem\s*\{/.test(test.CSS));
check('CSS 胶囊自身可点（父级 none 不传染）', () => /\.swl_alias\s*\{[^}]*pointer-events:\s*auto/s.test(test.CSS));
check('CSS 空态用「+」提示', () => /\.swl_alias\[data-empty\]::after\s*\{[^}]*content:\s*"?\+"?/s.test(test.CSS));
check('CSS 空态默认不收事件', () => /\.swl_alias\[data-empty\]\s*\{[^}]*pointer-events:\s*none/s.test(test.CSS));
check('CSS 行 hover 才放空态出头', () => /:hover\s+\.swl_alias\[data-empty\]/.test(test.CSS));
check('CSS 有设置说明行', () => /\.swl_hint\s*\{/.test(test.CSS));
check('CSS 选中态用品牌色区分 hover', () => /\.swl_choiceActive\s*\{[^}]*brand-primary/s.test(test.CSS));

// ---- 会话标识契约 ----------------------------------------------------------

check('标识存储键', () => test.ALIAS_KEY === 'session-workspace-label.aliases.v1');
check('代号长度上限 12', () => test.ALIAS_MAX === 12);
check('候选池上限 24', () => test.TOKEN_MAX === 24);
check('色环 7 色且都是十六进制', () =>
  test.ALIAS_COLORS.length === 7 && test.ALIAS_COLORS.every((c) => /^#[0-9a-f]{6}$/.test(c))
);

// ---- normalizeAlias --------------------------------------------------------

check('裸代号原样保留', () => test.normalizeAlias('rea') === 'rea');
check('首尾空白被去掉', () => test.normalizeAlias('  rea  ') === 'rea');
check('全角中括号被剥掉', () => test.normalizeAlias('【rea】') === 'rea');
check('半角中括号被剥掉', () => test.normalizeAlias('[rea]') === 'rea');
check('圆括号被剥掉', () => test.normalizeAlias('（qiu）') === 'qiu');
check('只有一侧括号也剥掉', () => test.normalizeAlias('【dsh') === 'dsh');
check('内部空格压成单个', () => test.normalizeAlias('re   a') === 're a');
check('控制字符被去掉', () => test.normalizeAlias('re\u0000a\u001f') === 'rea');
check('超长代号截断到 12', () => test.normalizeAlias('x'.repeat(30)).length === 12);
check('中文代号可用', () => test.normalizeAlias('论文') === '论文');
check('空串归一为空', () => test.normalizeAlias('') === '' && test.normalizeAlias('   ') === '');
check('非字符串归一为空', () => test.normalizeAlias(null) === '' && test.normalizeAlias(42) === '');

// ---- aliasColor ------------------------------------------------------------

check('同名同色', () => test.aliasColor('rea') === test.aliasColor('rea'));
check('颜色来自色环', () => test.ALIAS_COLORS.includes(test.aliasColor('rea')));
check('中文名也能取色', () => test.ALIAS_COLORS.includes(test.aliasColor('论文')));
check('不同代号分散到多个颜色', () => {
  const seen = new Set(['rea', 'qiu', 'dsh', 'paper', 'x', 'y', 'z', 'w', 'v'].map(test.aliasColor));
  return seen.size >= 2;
});

// ---- normalizeAliasDoc -----------------------------------------------------

check('null 文档归一为空状态', () => eq(test.normalizeAliasDoc(null), { aliases: {}, tokens: [], legacy: {} }));
check('别名自动补进候选池', () =>
  eq(test.normalizeAliasDoc({ aliases: { s1: 'rea' } }), { aliases: { s1: 'rea' }, tokens: ['rea'], legacy: {} })
);
check('空代号被丢弃', () =>
  eq(test.normalizeAliasDoc({ aliases: { s1: '  ', s2: 'qiu' } }), { aliases: { s2: 'qiu' }, tokens: ['qiu'], legacy: {} })
);
check('非对象 aliases 容错', () => eq(test.normalizeAliasDoc({ aliases: 42 }), { aliases: {}, tokens: [], legacy: {} }));
check('候选池去重', () => eq(test.normalizeAliasDoc({ tokens: ['rea', 'rea', 'qiu'] }).tokens, ['rea', 'qiu']));
check('候选池按上限截断', () => {
  const many = Array.from({ length: 40 }, (_, i) => 't' + i);
  const doc = test.normalizeAliasDoc({ tokens: many });
  return doc.tokens.length === test.TOKEN_MAX && doc.tokens[0] === 't0';
});
check('代号在读取时被规范化', () => {
  const doc = test.normalizeAliasDoc({ aliases: { s1: '【rea】' } });
  return doc.aliases.s1 === 'rea' && doc.tokens[0] === 'rea';
});
check('脏会话 id 被跳过', () => eq(test.normalizeAliasDoc({ aliases: { '': 'rea' } }), { aliases: {}, tokens: [], legacy: {} }));

// ---- legacy（迁移撤销凭据） ------------------------------------------------

check('legacy 备份被保留', () => {
  const doc = test.normalizeAliasDoc({ legacy: { s1: { title: '【rea】分析', alias: 'rea', at: 123 } } });
  return doc.legacy.s1.title === '【rea】分析' && doc.legacy.s1.at === 123;
});
check('legacy 脏值被丢弃', () => {
  const doc = test.normalizeAliasDoc({ legacy: { s1: { title: '' }, s2: null, s3: { title: 'x' } } });
  return Object.keys(doc.legacy).length === 1 && doc.legacy.s3.title === 'x';
});
check('缺 legacy 时为空对象', () => eq(test.normalizeAliasDoc({}).legacy, {}));
check('legacy 与 aliases 互不干扰', () => {
  const doc = test.normalizeAliasDoc({ aliases: { s1: 'rea' }, legacy: { s1: { title: '【rea】x', alias: 'rea' } } });
  return doc.aliases.s1 === 'rea' && doc.legacy.s1.title === '【rea】x';
});

// ---- parseTitlePrefix ------------------------------------------------------

check('解析全角前缀', () => eq(test.parseTitlePrefix('【rea】分析记事本函数列表'), { prefix: 'rea', rest: '分析记事本函数列表' }));
check('前缀两侧空白被吃掉', () => eq(test.parseTitlePrefix('  【rea】  分析'), { prefix: 'rea', rest: '分析' }));
check('无前缀返回 null', () => test.parseTitlePrefix('普通标题') === null);
check('半角方括号不解析', () => test.parseTitlePrefix('[rea] 分析') === null);
check('只有前缀没有正文返回 null', () => test.parseTitlePrefix('【rea】') === null && test.parseTitlePrefix('【rea】  ') === null);
check('前缀内部空白压成单个', () => test.parseTitlePrefix('【re a】x').prefix === 're a');
check('中文前缀', () => eq(test.parseTitlePrefix('【待办】写周报'), { prefix: '待办', rest: '写周报' }));
check('非字符串返回 null', () => test.parseTitlePrefix(null) === null && test.parseTitlePrefix(42) === null);

// ---- isStatusPrefix --------------------------------------------------------

check('状态词前缀被识别', () => test.isStatusPrefix('待办') && test.isStatusPrefix('存档') && test.isStatusPrefix('todo'));
check('状态词大小写不敏感', () => test.isStatusPrefix('Todo') && test.isStatusPrefix('DONE'));
check('复合前缀只看第一个词', () => test.isStatusPrefix('待办 electron') && test.isStatusPrefix('todo 抖音'));
check('项目前缀不算状态词', () => !test.isStatusPrefix('rea') && !test.isStatusPrefix('dsh 插件'));
check('空值不算状态词', () => !test.isStatusPrefix('') && !test.isStatusPrefix(null));

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
