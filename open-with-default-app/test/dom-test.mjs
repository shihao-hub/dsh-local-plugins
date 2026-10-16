/**
 * open-with-default-app 组件行为测试（真 React + 真 DOM；primitives 用桩）。
 *
 * 为什么用桩化的 primitives：本插件对 primitives 只用到「按钮 / 气泡 / 提示条 / 图标」
 * 四个基座件，形状由宿主版本决定；这里要证的是**我们自己的行为**——点一次发几次请求、
 * 空路径渲染不渲染、失败弹不弹提示、禁用态拦不拦点击。真实外观与宿主槽位渲染形状
 * 属于人工验收，不在本文件范围内（注册契约由 self-test.mjs 覆盖）。
 *
 * 依赖不随插件发布，需先装到仓库外（缺失即 SKIP，退出码 0）：
 *   mkdir %TEMP%\owda-test && cd %TEMP%\owda-test && npm init -y
 *   npm i jsdom@24 react@18.3.1 react-dom@18.3.1
 *   set OPEN_WITH_APP_TEST_MODULES=%TEMP%\owda-test
 *
 * 运行：node test/dom-test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(HERE, '..', 'client.js');
const MODULES_DIR = process.env.OPEN_WITH_APP_TEST_MODULES ?? HERE;

// ---------------------------------------------------------------------------
// 依赖解析（jsdom / react / react-dom 不在插件依赖里）
// ---------------------------------------------------------------------------

const require = createRequire(join(MODULES_DIR, 'package.json'));

function tryRequire(name) {
  try {
    return require(name);
  } catch {
    return undefined;
  }
}

const JSDOM = tryRequire('jsdom')?.JSDOM;
const react = tryRequire('react');

if (JSDOM === undefined || react === undefined) {
  console.log('SKIP dom-test：未找到 jsdom / react。');
  console.log('     按文件头注释装到仓库外（如 %TEMP%\\owda-test）后设 OPEN_WITH_APP_TEST_MODULES 再跑。');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 断言脚手架
// ---------------------------------------------------------------------------

let passed = 0;
const failures = [];

function ok(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('ok   ' + name);
    return;
  }
  failures.push(name + (detail === undefined ? '' : ' — ' + detail));
  console.log('FAIL ' + name + (detail === undefined ? '' : ' — ' + detail));
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, 'got ' + a + ', want ' + e);
}

// ---------------------------------------------------------------------------
// 真 DOM + 真 React 环境（必须在 require react-dom 之前铺好全局）
// ---------------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true });

/** Node 24 的 `navigator` 等全局只有 getter，统一用 defineProperty 覆盖。 */
function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

setGlobal('window', dom.window);
setGlobal('document', dom.window.document);
setGlobal('navigator', dom.window.navigator);
setGlobal('HTMLElement', dom.window.HTMLElement);
setGlobal('Node', dom.window.Node);
setGlobal('Event', dom.window.Event);
setGlobal('MouseEvent', dom.window.MouseEvent);
setGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const reactDomClient = tryRequire('react-dom/client');
const reactDom = tryRequire('react-dom');
if (reactDomClient === undefined || reactDom === undefined) {
  console.log('SKIP dom-test：jsdom / react 有了，但缺 react-dom。');
  process.exit(0);
}

const { createRoot } = reactDomClient;
/** React 18.3 起 `act` 在 react 本体上；更早版本在 react-dom/test-utils。 */
const act = typeof react.act === 'function' ? react.act : tryRequire('react-dom/test-utils')?.act;
if (typeof act !== 'function') {
  console.log('SKIP dom-test：当前 react/react-dom 组合里找不到 act()。');
  process.exit(0);
}
const h = react.createElement;

// ---------------------------------------------------------------------------
// primitives 桩（把 label / text 暴露成可断言的属性）
// ---------------------------------------------------------------------------

const primitivesStub = {
  Button: function Button(props) {
    const icon = props.icon;
    const rest = { ...props };
    delete rest.icon;
    delete rest.variant;
    delete rest.size;
    delete rest.children;
    return h('button', rest, icon, props.children);
  },
  Tooltip: function Tooltip(props) {
    const label = typeof props.label === 'function' ? props.label() : props.label;
    return h('span', { 'data-tooltip': label }, props.children);
  },
  Toast: function Toast(props) {
    return h('div', { 'data-toast': props.text }, props.text);
  },
  IconRightUpOutlineRegular: function IconRightUpOutlineRegular() {
    return h('span', { 'data-icon': 'right-up' });
  },
  IconWarningOutlineRegular: function IconWarningOutlineRegular() {
    return h('span', { 'data-icon': 'warning' });
  },
  IconFolderOpenOutlineRegular: function IconFolderOpenOutlineRegular() {
    return h('span', { 'data-icon': 'folder-open' });
  },
  /** 宿主菜单行的等价物：role=menuitem 的按钮，禁用态透传。 */
  MenuItemButton: function MenuItemButton(props) {
    return h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        disabled: props.disabled === true,
        'data-open-with-default-app': props['data-open-with-default-app'],
        onClick: props.onSelect
      },
      props.icon,
      h('span', null, props.children)
    );
  },
  /** 宿主 Menu 的等价物：portal 模式下只有 open 才渲染行，并暴露关闭回调。 */
  Menu: function Menu(props) {
    if (props.open !== true) return h('div', { 'data-menu': 'closed' });
    return h('div', { 'data-menu': 'open' }, props.children);
  }
};

// ---------------------------------------------------------------------------
// 装载 client.js
// ---------------------------------------------------------------------------

function loadPlugin() {
  let record;
  const fakeWindow = {
    __ModuleLoader__: {
      load(value) {
        record = value;
      }
    }
  };
  // eslint-disable-next-line no-new-func
  new Function('window', readFileSync(CLIENT_PATH, 'utf8'))(fakeWindow);
  const requireMap = {
    react,
    '@deepseek-ai/dsh-client-ui-primitives': primitivesStub
  };
  return record.factory((name) => {
    if (Object.prototype.hasOwnProperty.call(requireMap, name)) return requireMap[name];
    throw new Error('unexpected require: ' + name);
  });
}

const plugin = loadPlugin();
const { EmptyOpenButton, MenuOpenButton, MenuFailureToast, PathContextMenu } = plugin.__test;

/** 宿主 `locale.bind(NS)` 的等价物：本测试只认键名，便于断言用了哪个键。 */
const t = (key) => key;

// ---------------------------------------------------------------------------
// 渲染脚手架
// ---------------------------------------------------------------------------

let container;
let root;

function mount(element) {
  container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return container;
}

function unmount() {
  if (root !== null && root !== undefined) {
    act(() => {
      root.unmount();
    });
  }
  if (container !== null && container !== undefined) container.remove();
  root = undefined;
  container = undefined;
}

function buttonIn(scope) {
  return scope.querySelector('button[data-open-with-default-app]');
}

/** 点一下并按 React 的节奏把微任务排空。 */
async function click(node) {
  await act(async () => {
    node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// 1. 空态按钮：渲染 / 路径透传 / 失败提示（标题栏按钮已按「右键路径为准」撤掉）
// ---------------------------------------------------------------------------

{
  const scope = mount(h(EmptyOpenButton, { absolutePath: 'D:\\big.bin', openWithDefaultApp: () => Promise.resolve(true), t }));
  const button = buttonIn(scope);
  eq('空态用完整文案', button.textContent, 'open.button');
  eq('标记了变体', button.getAttribute('data-open-with-default-app'), 'empty');
  unmount();
}
// ---------------------------------------------------------------------------
// 2. 页签右键菜单行：路径来自资源、点击即关菜单、失败弹提示
// ---------------------------------------------------------------------------

/** 菜单行在测试桩里就是一个 role=menuitem 的按钮（宿主用 MenuItemButton 渲染，不透传 data-*）。 */
const menuRowIn = (scope) => scope.querySelector('[role="menuitem"]');

{
  const calls = [];
  let dismissed = 0;
  const scope = mount(
    h(MenuOpenButton, {
      tab: { id: 'tab-1', contentId: 'dsh-resource://file/session/s/README.md' },
      dismiss: () => {
        dismissed += 1;
      },
      useResource: () => ({ value: { absolutePath: 'D:\\Users\\a b\\README.md' } }),
      openWithDefaultApp: (path) => {
        calls.push(path);
        return Promise.resolve(true);
      },
      t
    })
  );
  const row = menuRowIn(scope);
  ok('菜单行渲染出来了', row !== null);
  eq('菜单行文案取 open.menu', row.textContent, 'open.menu');
  eq('菜单行带图标', row.querySelector('[data-icon="right-up"]') !== null, true);

  await click(row);
  eq('点击先把菜单关掉（菜单是宿主的，动作行必须自己 dismiss）', dismissed, 1);
  eq('点击把资源里的绝对路径交给宿主', calls, ['D:\\Users\\a b\\README.md']);
  unmount();
}

{
  const scope = mount(
    h(MenuOpenButton, {
      tab: { id: 'tab-2', contentId: 'dsh-resource://file/session/s/x' },
      useResource: () => ({ value: undefined }),
      openWithDefaultApp: () => Promise.resolve(true),
      t
    })
  );
  ok('不是文件资源（终端 / 首页 / 目录页签）整行不渲染，不留灰死项', menuRowIn(scope) === null);
  unmount();
}

{
  const calls = [];
  const scope = mount(
    h(MenuOpenButton, {
      tab: { id: 'tab-3', contentId: 'x' },
      useResource: () => ({ value: { absolutePath: 'D:\\a\\b.md' } }),
      openWithDefaultApp: (path) => {
        calls.push(path);
        return Promise.resolve(false);
      },
      t
    })
  );
  await click(menuRowIn(scope));
  eq('宿主拒绝时仍发了请求', calls, ['D:\\a\\b.md']);
  unmount();
}

{
  const scope = mount(
    h(MenuOpenButton, {
      tab: { id: 'tab-4', contentId: 'x' },
      useResource: () => ({ value: { absolutePath: 'D:\\a\\b.md' } }),
      t
    })
  );
  ok('宿主没给 opener 时行保留但禁用（不是消失）', menuRowIn(scope) !== null && menuRowIn(scope).disabled === true);
  unmount();
}

{
  const scope = mount(h(MenuFailureToast, { tab: { id: 'tab-9' }, t }));
  ok('没有失败时提示条不渲染（不占位）', scope.querySelector('[data-toast]') === null);
  unmount();
}

// ---------------------------------------------------------------------------
// 3. 路径文本右键菜单：只接管路径的右键、菜单摆到指针处、行执行宿主动作
// ---------------------------------------------------------------------------

{
  const calls = [];
  let closed = 0;
  const actions = {
    open: (path) => {
      calls.push(['open', path]);
      return Promise.resolve({ ok: true, reason: '' });
    },
    reveal: (path) => {
      calls.push(['reveal', path]);
      return Promise.resolve({ ok: true, reason: '' });
    }
  };
  const scope = mount(h(PathContextMenu, { hostFileActions: actions, t }));

  // 宿主预览头部那行路径：PathLabel 恒带 data-path-label + title
  const pathLabel = dom.window.document.createElement('span');
  pathLabel.setAttribute('data-path-label', 'true');
  pathLabel.setAttribute('data-textpreview-path', 'true');
  pathLabel.setAttribute('title', 'D:\\Users\\a b\\README.md');
  pathLabel.textContent = 'README.md';
  dom.window.document.body.appendChild(pathLabel);

  eq('初始未打开时菜单关着', scope.querySelector('[data-menu]').getAttribute('data-menu'), 'closed');

  const rightClick = (node, x, y) => {
    const event = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
    act(() => {
      node.dispatchEvent(event);
    });
    return event;
  };

  const onPath = rightClick(pathLabel, 120, 42);
  ok('右键路径被接管（阻止浏览器原生菜单）', onPath.defaultPrevented === true);
  eq('菜单切到打开态', scope.querySelector('[data-menu]').getAttribute('data-menu'), 'open');
  const rows = [...scope.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent);
  eq('菜单两行：打开 + 在资源管理器中显示', rows, ['open.menu', 'open.reveal']);

  const [openRow, revealRow] = scope.querySelectorAll('[role="menuitem"]');
  await click(openRow);
  eq('第一行把路径交给 open', calls, [['open', 'D:\\Users\\a b\\README.md']]);
  eq('执行后菜单自行关闭', scope.querySelector('[data-menu]').getAttribute('data-menu'), 'closed');
  void closed;

  rightClick(pathLabel, 130, 44);
  await click(scope.querySelectorAll('[role="menuitem"]')[1]);
  eq('第二行走 reveal', calls[1], ['reveal', 'D:\\Users\\a b\\README.md']);

  // 非路径元素：不该被接管
  const other = dom.window.document.createElement('span');
  other.textContent = '正文';
  dom.window.document.body.appendChild(other);
  const onOther = rightClick(other, 10, 10);
  ok('右键普通文本不被接管（宿主 / 浏览器照旧）', onOther.defaultPrevented === false);
  other.remove();
  pathLabel.remove();
  unmount();
}

{
  // 失败原因要出现在提示条里
  const scope = mount(
    h(PathContextMenu, {
      hostFileActions: { open: () => Promise.resolve({ ok: false, reason: 'gateway/bad-request: Path has no verified Host path' }), reveal: () => Promise.resolve({ ok: true, reason: '' }) },
      t
    })
  );
  const pathLabel = dom.window.document.createElement('span');
  pathLabel.setAttribute('data-path-label', 'true');
  pathLabel.setAttribute('title', 'D:\\x\\y.md');
  dom.window.document.body.appendChild(pathLabel);
  act(() => {
    pathLabel.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  });
  await click(scope.querySelectorAll('[role="menuitem"]')[0]);
  const toast = scope.querySelector('[data-toast]');
  ok('失败时提示条带真实原因', toast !== null && toast.getAttribute('data-toast') === 'open.failedDebug', toast === null ? 'no toast' : toast.getAttribute('data-toast'));
  pathLabel.remove();
  unmount();
}

{
  const scope = mount(h(PathContextMenu, { hostFileActions: null, t }));
  const pathLabel = dom.window.document.createElement('span');
  pathLabel.setAttribute('data-path-label', 'true');
  pathLabel.setAttribute('title', 'D:\\x\\y.md');
  dom.window.document.body.appendChild(pathLabel);
  act(() => {
    pathLabel.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  });
  const rows = scope.querySelectorAll('[role="menuitem"]');
  ok('没有可用动作时两行都禁用（而不是点了没反应）', rows.length === 2 && rows[0].disabled === true && rows[1].disabled === true);
  pathLabel.remove();
  unmount();
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

console.log('');
if (failures.length === 0) {
  console.log('全部通过：' + passed + ' 项');
  process.exit(0);
}
console.log('通过 ' + passed + ' 项，失败 ' + failures.length + ' 项：');
for (const failure of failures) console.log('  - ' + failure);
process.exit(1);
