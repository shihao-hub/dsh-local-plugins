/**
 * 零依赖用例：在 node:vm 里跑 client.js，只测纯函数与静态契约。
 *
 *   node self-test.mjs
 *
 * 模块只在 apply 里操作 document，所以这里不需要 jsdom；
 * React 用最小桩（createElement 返回 null），不渲染任何组件。
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
if (registration.id !== '@local/workspace-hide') {
  console.error('FAIL: 模块 id 不符：', registration.id);
  process.exit(1);
}

const ReactStub = { createElement: () => null };
const mod = registration.factory((id) => (id === 'react-dom' ? ReactStub : ReactStub));
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
check('插件 id', () => registration.id === '@local/workspace-hide');
check('存储键', () => test.STORE_KEY === 'workspace-hide.v1');
check('Host 路由', () => test.ROUTE_PATH === '/plugins/workspace-hide/state');
check('路由 guard 头', () => test.GUARD_HEADER === 'x-workspace-hide');
check('样式标签 id', () => test.STYLE_TAG_ID === '@local/workspace-hide/rows.css');
check('组标记属性', () => test.ATTR_GROUP === 'data-wh-group-hidden');
check('行标记属性', () => test.ATTR_ROW === 'data-wh-row-hidden');
check('菜单标记属性', () => test.ATTR_MENU === 'data-wh-menu');
check('隐藏上限', () => test.MAX_HIDDEN === 500);
check('设置行 id 与包名', () => test.ROW_ID === 'workspace-hide' && test.PLUGIN_PACKAGE === '@local/workspace-hide');

// ---- normalizeHidden --------------------------------------------------------

check('normalizeHidden 过滤非字符串与空串', () =>
  eq(test.normalizeHidden(['a', 1, null, '', '  ', 'b']), ['a', 'b'])
);
check('normalizeHidden 去掉重复', () => eq(test.normalizeHidden(['a', 'a', 'b']), ['a', 'b']));
check('normalizeHidden trim', () => eq(test.normalizeHidden(['  a  ']), ['a']));
check('normalizeHidden 接受对象形状', () =>
  eq(test.normalizeHidden({ hidden: ['a', 'b'] }), ['a', 'b'])
);
check('normalizeHidden 非法输入给空数组', () =>
  eq(test.normalizeHidden(null), []) && eq(test.normalizeHidden(42), [])
);
check('normalizeHidden 封顶', () => {
  const many = [];
  for (let index = 0; index < test.MAX_HIDDEN + 20; index += 1) many.push('id-' + index);
  return test.normalizeHidden(many).length === test.MAX_HIDDEN;
});

// ---- 路径与名称 ------------------------------------------------------------

check('baseName 吃 Windows 路径', () => test.baseName('D:\\Users\\x\\language_projects') === 'language_projects');
check('baseName 吃 POSIX 路径', () => test.baseName('/home/me/project/') === 'project');
check('baseName 空输入', () => test.baseName('') === '' && test.baseName(null) === '');
check('normalizePath 统一分隔符与大小写', () =>
  test.normalizePath('D:\\Users\\X\\Proj\\') === 'd:/users/x/proj'
);
check('workspaceName 标题优先', () =>
  test.workspaceName({ title: '  我的项目  ', path: 'D:\\x\\other' }) === '我的项目'
);
check('workspaceName 回退到路径 basename', () =>
  test.workspaceName({ title: '  ', path: 'D:\\x\\other' }) === 'other'
);
check('workspaceName 空记录', () => test.workspaceName(null) === '');

// ---- 归属映射 --------------------------------------------------------------

const items = [
  { workspaceId: 'w1', path: 'D:\\Users\\a\\alpha', sessionIds: ['s1', 's2'] },
  { workspaceId: 'w2', path: 'D:\\Users\\a\\beta', sessionIds: ['s3'] }
];
check('ownerMapOf 建立 session→workspace', () => {
  const map = test.ownerMapOf(items);
  return map.get('s1') === 'w1' && map.get('s3') === 'w2';
});
check('ownerMapOf 忽略坏记录', () =>
  test.ownerMapOf([null, { workspaceId: 'w', sessionIds: 'x' }]).size === 0
);
check('ownerFromCwd 前缀匹配（大小写不敏感）', () =>
  test.ownerFromCwd(items, 'd:\\users\\a\\alpha\\src') === 'w1'
);
check('ownerFromCwd 取最深前缀', () =>
  test.ownerFromCwd(items, 'D:\\Users\\a\\beta\\deep\\x') === 'w2'
);
check('ownerFromCwd 不匹配时 undefined', () =>
  test.ownerFromCwd(items, 'D:\\elsewhere\\x') === undefined
);
check('ownerFromCwd 空 cwd', () => test.ownerFromCwd(items, '') === undefined);

// ---- 菜单识别 --------------------------------------------------------------

check('视图选项按钮：中文', () => test.isViewOptionsLabel('视图选项') === true);
check('视图选项按钮：英文', () => test.isViewOptionsLabel('View options') === true);
check('工作区菜单按钮不误判', () =>
  test.isViewOptionsLabel('工作区“language_projects”的操作') === false
);
check('空标签不误判', () => test.isViewOptionsLabel(null) === false && test.isViewOptionsLabel('') === false);
check('工作区菜单 2 项', () => test.menuActionFor('workspace', 2) === 'workspace');
check('工作区菜单 3 项仍接受', () => test.menuActionFor('workspace', 3) === 'workspace');
check('工作区菜单 4 项拒绝', () => test.menuActionFor('workspace', 4) === null);
check('会话菜单不误判', () => test.menuActionFor('workspace', 6) === null);
check('视图菜单 8 项', () => test.menuActionFor('view', 8) === 'view');
check('视图菜单项不足拒绝', () => test.menuActionFor('view', 4) === null);
check('未知 kind 拒绝', () => test.menuActionFor('other', 8) === null);

// ---- CSS 契约 --------------------------------------------------------------

check('CSS 整组收起', () => /\[data-wh-group-hidden\]\s*\{[^}]*display:\s*none\s*!important/s.test(test.CSS));
check('CSS 会话行收起', () => /\[data-wh-row-hidden\]\s*\{[^}]*display:\s*none\s*!important/s.test(test.CSS));
check('CSS 浮层 z-index 1200', () => /\.wh_veil\s*\{[^}]*z-index:\s*1200/s.test(test.CSS));
check('CSS toast z-index 1300', () => /\.wh_toast\s*\{[^}]*z-index:\s*1300/s.test(test.CSS));
check('CSS 设置行徽章', () => /\.wh_badge\s*\{/.test(test.CSS));
check('CSS 面板固定高度可滚动', () => /\.wh_list\s*\{[^}]*overflow:\s*auto/s.test(test.CSS));
check('CSS 用宿主 token', () => test.CSS.includes('--dsw-alias-label-primary'));

// ---- 字典契约 --------------------------------------------------------------

check('zh/en 键集一致', () => eq(Object.keys(test.zh).sort(), Object.keys(test.en).sort()));
check('字典无空文案', () =>
  Object.values(test.zh).every((value) => typeof value === 'string' && value.trim() !== '') &&
  Object.values(test.en).every((value) => typeof value === 'string' && value.trim() !== '')
);
check('菜单文案存在', () =>
  typeof test.zh['menu.hide'] === 'string' &&
  typeof test.zh['view.manage'] === 'string' &&
  typeof test.zh['panel.title'] === 'string'
);
check('设置行徽章文案存在', () =>
  test.zh['row.badge'] === '插件' &&
  typeof test.zh['row.badgeTitle'] === 'string' &&
  typeof test.en['row.badge'] === 'string'
);
check('toast 撤销文案存在', () => typeof test.zh['toast.undo'] === 'string' && typeof test.zh['toast.hidden'] === 'string');
check('面板计数模板带 n', () => test.zh['panel.count'].includes('{n}'));
check('视图菜单模板带 n', () => test.zh['view.manage'].includes('{n}'));

// ---- 结果 ------------------------------------------------------------------

console.log('');
if (failures.length === 0) {
  console.log(`PASS: ${passed} 项全部通过`);
  process.exit(0);
}
console.log(`FAIL: ${failures.length} 项失败 / ${passed} 项通过`);
for (const failure of failures) console.log('  - ' + failure);
process.exit(1);
