/**
 * session-title-edit 组件行为测试（真 React + 真 DOM / jsdom）。
 *
 * 覆盖的是「我们自己的行为」：双击标题进编辑、Enter 提交、Esc 取消、失焦保存、
 * 空值拦截、失败展示、无权限不渲染、连按 Enter 只发一次请求。
 * 宿主槽位装配与真实外观属于浏览器人工验收，不在这里模拟。
 *
 * 依赖不随插件发布，需先装到仓库外（缺失即 SKIP，退出码 0）：
 *   mkdir %TEMP%\stse-test && cd %TEMP%\stse-test && npm init -y
 *   npm i jsdom@24 react@18.3.1 react-dom@18.3.1
 *   set SESSION_TITLE_EDIT_TEST_MODULES=%TEMP%\stse-test
 *
 * 运行：node dom-test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(HERE, 'client.js');
const MODULES_DIR = process.env.SESSION_TITLE_EDIT_TEST_MODULES ?? HERE;

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
  console.log('     按文件头注释装到仓库外后设 SESSION_TITLE_EDIT_TEST_MODULES 再跑。');
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
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}

// ---------------------------------------------------------------------------
// 真 DOM + 真 React 环境（必须在 require react-dom 之前铺好全局）
// ---------------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });

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
setGlobal('KeyboardEvent', dom.window.KeyboardEvent);
setGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const reactDomClient = tryRequire('react-dom/client');
const reactDom = tryRequire('react-dom');
if (reactDomClient === undefined || reactDom === undefined) {
  console.log('SKIP dom-test：缺 react-dom。');
  process.exit(0);
}

const { createRoot } = reactDomClient;
const act = typeof react.act === 'function' ? react.act : tryRequire('react-dom/test-utils')?.act;
if (typeof act !== 'function') {
  console.log('SKIP dom-test：当前 react/react-dom 组合里找不到 act()。');
  process.exit(0);
}
const h = react.createElement;

// ---------------------------------------------------------------------------
// 装载 client.js
// ---------------------------------------------------------------------------

function loadPlugin() {
  let record;
  // 组件运行时仍会读 window（innerWidth / addEventListener / ResizeObserver），
  // 所以这里直接把 jsdom 的 window 当参数传进去，而不是只塞一个 ModuleLoader 桩。
  const fakeWindow = dom.window;
  fakeWindow.__ModuleLoader__ = {
    load(value) {
      record = value;
    }
  };
  // eslint-disable-next-line no-new-func
  new Function('window', readFileSync(CLIENT_PATH, 'utf8'))(fakeWindow);
  return record.factory((name) => {
    if (name === 'react') return react;
    throw new Error('unexpected require: ' + name);
  });
}

const plugin = loadPlugin();
const { TitleRenameAction } = plugin.__test;

/** 宿主 locale.bind(NS) 的等价物：只认键名；带插值时把参数拼进去便于断言。 */
const t = (key, params) => (params === undefined ? key : key + '|' + JSON.stringify(params));

// ---------------------------------------------------------------------------
// 宿主同形 DOM
// ---------------------------------------------------------------------------

function buildFixture(options = {}) {
  const ancestry = options.ancestry === 'multi';
  const doc = dom.window.document;
  const host = doc.createElement('div');
  host.innerHTML = ancestry
    ? [
        '<div class="titleRow">',
        '  <div class="titleCluster">',
        '    <nav>',
        '      <span class="crumbSeg"><button class="crumb">父会话</button></span>',
        '      <span class="crumbSeg"><span class="crumbSep">/</span><span class="crumb crumbCurrent">旧标题</span><div data-slot="conversation.session.header.lineage"></div></span>',
        '    </nav>',
        '    <div class="headerActions"><div data-slot="conversation.session.header.actions"></div></div>',
        '  </div>',
        '</div>'
      ].join('\n')
    : [
        '<div class="titleRow">',
        '  <div class="titleCluster">',
        '    <nav><span class="crumbSeg"><span class="crumb crumbCurrent">旧标题</span><div data-slot="conversation.session.header.lineage"></div></span></nav>',
        '    <div class="headerActions"><div data-slot="conversation.session.header.actions"></div></div>',
        '  </div>',
        '</div>'
      ].join('\n');

  doc.body.appendChild(host);

  return {
    host,
    doc,
    slot: host.querySelector('[data-slot="conversation.session.header.actions"]'),
    nav: host.querySelector('nav'),
    titleEl: host.querySelector('.crumbCurrent'),
    ancestorCrumb: host.querySelector('.crumb:not(.crumbCurrent)')
  };
}

let mounted = null;

function mount(fixture, overrides = {}) {
  const props = {
    sessionId: 's1',
    useSessions: (selector) => selector({ byId: { s1: { displayTitle: '旧标题' } } }),
    useAccess: () => true,
    t,
    renameSession: async () => ({ ok: true, value: {} }),
    ...overrides
  };
  const root = createRoot(fixture.slot);
  act(() => {
    root.render(h(TitleRenameAction, props));
  });
  mounted = { root, fixture };
  return { root, props };
}

function unmount() {
  if (mounted !== null) {
    act(() => {
      mounted.root.unmount();
    });
    mounted.fixture.host.remove();
    mounted = null;
  }
}

function editorIn(fixture) {
  return fixture.slot.querySelector('.stse_editor');
}

function triggerIn(fixture) {
  return fixture.slot.querySelector('.stse_trigger');
}

function errorIn(fixture) {
  return fixture.slot.querySelector('.stse_error');
}

function dblclickOn(fixture, target) {
  act(() => {
    target.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
}

function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function press(input, key) {
  await act(async () => {
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function blur(input) {
  await act(async () => {
    input.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
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
// 1. 铅笔按钮与双击进入编辑
// ---------------------------------------------------------------------------

{
  const fixture = buildFixture();
  mount(fixture);
  ok('铅笔按钮渲染', triggerIn(fixture) !== null);
  eq('按钮 aria-label 用字典键', triggerIn(fixture).getAttribute('aria-label'), 'action.aria');
  ok('初始没有输入框', editorIn(fixture) === null);

  dblclickOn(fixture, fixture.titleEl);
  const input = editorIn(fixture);
  ok('双击标题后出现输入框', input !== null);
  eq('草稿预填当前标题', input.value, '旧标题');
  eq('输入框无障碍名', input.getAttribute('aria-label'), 'editor.label');
  eq('原标题被隐藏（inline style）', fixture.titleEl.style.visibility, 'hidden');
  eq('nav 标上编辑标记（CSS 兜底）', fixture.nav.getAttribute('data-session-title-edit'), '');
  unmount();
}

// ---------------------------------------------------------------------------
// 2. Enter 提交
// ---------------------------------------------------------------------------

{
  const fixture = buildFixture();
  const calls = [];
  mount(fixture, {
    renameSession: async (sessionId, title) => {
      calls.push([sessionId, title]);
      return { ok: true, value: { title } };
    }
  });
  dblclickOn(fixture, fixture.titleEl);
  const input = editorIn(fixture);
  typeInto(input, '  新名字  ');
  await press(input, 'Enter');

  eq('提交参数去空白并带 sessionId', calls, [['s1', '新名字']]);
  ok('提交成功后输入框消失', editorIn(fixture) === null);
  eq('原标题恢复可见', fixture.titleEl.style.visibility, '');
  eq('nav 编辑标记被移除', fixture.nav.hasAttribute('data-session-title-edit'), false);
  unmount();
}

// ---------------------------------------------------------------------------
// 3. Esc 取消（不发请求）
// ---------------------------------------------------------------------------

{
  const fixture = buildFixture();
  const calls = [];
  mount(fixture, {
    renameSession: async (sessionId, title) => {
      calls.push([sessionId, title]);
      return { ok: true, value: { title } };
    }
  });
  dblclickOn(fixture, fixture.titleEl);
  const input = editorIn(fixture);
  typeInto(input, '不会保存');
  await press(input, 'Escape');

  eq('Esc 不发起重命名', calls, []);
  ok('Esc 关闭编辑', editorIn(fixture) === null);
  eq('Esc 恢复原标题可见', fixture.titleEl.style.visibility, '');
  unmount();
}

// ---------------------------------------------------------------------------
// 4. 失焦保存
// ---------------------------------------------------------------------------

{
  const fixture = buildFixture();
  const calls = [];
  mount(fixture, {
    renameSession: async (sessionId, title) => {
      calls.push([sessionId, title]);
      return { ok: true, value: { title } };
    }
  });
  dblclickOn(fixture, fixture.titleEl);
  const input = editorIn(fixture);
  typeInto(input, '失焦保存');
  await blur(input);

  eq('失焦提交一次', calls, [['s1', '失焦保存']]);
  ok('失焦后关闭编辑', editorIn(fixture) === null);
  unmount();
}

// ---------------------------------------------------------------------------
// 5. 空值拦截
// ---------------------------------------------------------------------------

{
  const fixture = buildFixture();
  const calls = [];
  mount(fixture, {
    renameSession: async (sessionId, title) => {
      calls.push([sessionId, title]);
      return { ok: true, value: { title } };
    }
  });
  dblclickOn(fixture, fixture.titleEl);
  const input = editorIn(fixture);
  typeInto(input, '   ');
  await press(input, 'Enter');

  eq('空白标题不发起请求', calls, []);
  ok('保持编辑态', editorIn(fixture) !== null);
  ok('显示空标题错误', errorIn(fixture) !== null);
  eq('错误文案取 error.empty', errorIn(fixture).textContent, 'error.empty');
  eq('输入框标红', editorIn(fixture).hasAttribute('data-invalid'), true);
  unmount();
}

// ---------------------------------------------------------------------------
// 6. 未变化直接关闭（不发请求）
// ---------------------------------------------------------------------------

{
  const fixture = buildFixture();
  const calls = [];
  mount(fixture, {
    renameSession: async (sessionId, title) => {
      calls.push([sessionId, title]);
      return { ok: true, value: { title } };
    }
  });
  dblclickOn(fixture, fixture.titleEl);
  await press(editorIn(fixture), 'Enter');

  eq('标题没改就不发请求', calls, []);
  ok('直接关闭编辑', editorIn(fixture) === null);
  unmount();
}

// ---------------------------------------------------------------------------
// 7. 失败：保持编辑态并展示原因
// ---------------------------------------------------------------------------

{
  const fixture = buildFixture();
  mount(fixture, {
    renameSession: async () => ({ ok: false, error: { message: 'title too long' } })
  });
  dblclickOn(fixture, fixture.titleEl);
  const input = editorIn(fixture);
  typeInto(input, '改成别的');
  await press(input, 'Enter');

  ok('失败后仍停在编辑态', editorIn(fixture) !== null);
  ok('失败后显示错误行', errorIn(fixture) !== null);
  eq('错误文案带宿主返回的 message', errorIn(fixture).textContent, 'error.failed|{"message":"title too long"}');
  eq('草稿保留', editorIn(fixture).value, '改成别的');
  unmount();
}

// ---------------------------------------------------------------------------
// 8. 连按 Enter 只发一次请求
// ---------------------------------------------------------------------------

{
  const fixture = buildFixture();
  const pending = deferred();
  let calls = 0;
  mount(fixture, {
    renameSession: () => {
      calls += 1;
      return pending.promise;
    }
  });
  dblclickOn(fixture, fixture.titleEl);
  const input = editorIn(fixture);
  typeInto(input, '只发一次');

  await act(async () => {
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();
  });

  eq('同一 tick 连按 Enter 只发一次', calls, 1);

  await act(async () => {
    pending.resolve({ ok: true, value: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  ok('请求结束后关闭编辑', editorIn(fixture) === null);
  unmount();
}

// ---------------------------------------------------------------------------
// 9. 无权限：不渲染按钮，双击无效
// ---------------------------------------------------------------------------

{
  const fixture = buildFixture();
  mount(fixture, { useAccess: () => false });
  ok('无权限不渲染铅笔', triggerIn(fixture) === null);

  dblclickOn(fixture, fixture.titleEl);
  ok('无权限时双击也不进编辑', editorIn(fixture) === null);
  eq('无权限时不标编辑标记', fixture.nav.hasAttribute('data-session-title-edit'), false);
  unmount();
}

// ---------------------------------------------------------------------------
// 10. 双击祖先面包屑不触发
// ---------------------------------------------------------------------------

{
  const fixture = buildFixture({ ancestry: 'multi' });
  mount(fixture);
  ok('多级面包屑里有祖先按钮', fixture.ancestorCrumb !== null);

  dblclickOn(fixture, fixture.ancestorCrumb);
  ok('双击祖先不进入编辑', editorIn(fixture) === null);

  dblclickOn(fixture, fixture.titleEl);
  ok('双击当前标题仍可编辑', editorIn(fixture) !== null);
  unmount();
}

// ---------------------------------------------------------------------------
// 11. 铅笔按钮进入编辑
// ---------------------------------------------------------------------------

{
  const fixture = buildFixture();
  mount(fixture);
  act(() => {
    triggerIn(fixture).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  ok('点铅笔进入编辑', editorIn(fixture) !== null);
  eq('点铅笔草稿为当前标题', editorIn(fixture).value, '旧标题');
  unmount();
}

// ---------------------------------------------------------------------------

console.log('\n' + passed + ' 项通过，' + failures.length + ' 项失败');
if (failures.length > 0) {
  for (const failure of failures) console.log('  - ' + failure);
  process.exit(1);
}
