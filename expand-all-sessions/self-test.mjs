/**
 * @local/expand-all-sessions 的 Node 侧自测。
 *
 * 这里不引入任何测试框架：client.js 是一个接受 `window.__ModuleLoader__.load`
 * 的 IIFE，所以自测用假 DOM + 合成 React fiber 桩把它跑起来，再验证最关键的三段
 * 逻辑——hook 定位、状态映射、点击接管与幂等。
 *
 * 运行：node expand-all-sessions/self-test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 极简断言
// ---------------------------------------------------------------------------

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  ok   ' + name);
    return;
  }
  failures.push(name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  console.log('  FAIL ' + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
}

function equal(name, actual, expected) {
  check(name, actual === expected, { actual: actual, expected: expected });
}

// ---------------------------------------------------------------------------
// 假 DOM
// ---------------------------------------------------------------------------

let nodeSeq = 0;

function createElement(tag) {
  const node = {
    __id: ++nodeSeq,
    tagName: tag,
    attributes: {},
    listeners: new Map(),
    clicks: 0,
    isConnected: true,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(type, handler) {
      const list = this.listeners.get(type) ?? [];
      list.push(handler);
      this.listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        list.filter((entry) => entry !== handler)
      );
    },
    dispatch(type) {
      const event = { type: type, currentTarget: this, target: this };
      for (const handler of this.listeners.get(type) ?? []) handler(event);
    },
    click() {
      this.clicks += 1;
    }
  };
  return node;
}

function createDocument() {
  const body = createElement('body');
  const document = {
    readyState: 'complete',
    body: body,
    documentElement: body,
    nodes: [body],
    createElement: createElement,
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector === 'button[data-row-key^="overflow:"]') {
        return this.nodes.filter(
          (node) => node.tagName === 'button' && String(node.getAttribute('data-row-key') ?? '').startsWith('overflow:')
        );
      }
      return [];
    },
    querySelector(selector) {
      const match = /^button\[data-row-key="(.*)"\]$/.exec(selector);
      if (match === null) return null;
      const wanted = match[1];
      return (
        this.nodes.find(
          (node) => node.tagName === 'button' && node.getAttribute('data-row-key') === wanted
        ) ?? null
      );
    }
  };
  return document;
}

// ---------------------------------------------------------------------------
// 合成 React fiber / hook 桩
// ---------------------------------------------------------------------------

function makeHook(state, dispatch) {
  return {
    memoizedState: state,
    queue: dispatch === undefined ? null : { dispatch: dispatch },
    next: null
  };
}

function makeRef(current) {
  return makeHook({ current: current ?? null }, () => {});
}

function makeFiber(tag, memoizedState, parent) {
  return {
    tag: tag,
    memoizedState: memoizedState,
    return: parent ?? null,
    child: null,
    props: {}
  };
}

function chainHooks(fiber, hooks) {
  fiber.memoizedState = hooks[0] ?? null;
  for (let at = 0; at + 1 < hooks.length; at += 1) hooks[at].next = hooks[at + 1];
  return fiber;
}

/**
 * 搭出一棵与 ui-workspace 同形的 fiber 链：
 * div(host) → div(host) → GroupSection(函数组件, 空 hooks)
 *   → SessionTree(函数组件: usePanelInfo / useSessionStatus / useRef / useRef /
 *     useState({}) / ...) → div(host, 带按钮)
 */
function buildTree(buttonNode, sessionLimitsDispatch, sessionLimitsState) {
  const treeFiber = chainHooks(makeFiber(0, null, null), [
    makeHook(null, () => {}),
    makeHook(null, () => {})
  ]);
  const limitsHook = makeHook(sessionLimitsState ?? {}, sessionLimitsDispatch);
  chainHooks(treeFiber, [
    makeRef('panel'),
    makeHook({}, () => {}),
    makeRef(null),
    makeRef(null),
    limitsHook,
    makeHook(null, () => {}),
    makeRef(null)
  ]);
  const sectionFiber = chainHooks(makeFiber(0, null, treeFiber), [makeHook(null, () => {})]);
  const innerHost = makeFiber(5, null, sectionFiber);
  const outerHost = makeFiber(5, null, innerHost);
  const buttonFiber = makeFiber(5, null, outerHost);
  buttonNode.__reactFiber$selfTest = buttonFiber;
  return { treeFiber: treeFiber, limitsHook: limitsHook, buttonFiber: buttonFiber };
}

// ---------------------------------------------------------------------------
// 加载 client.js
// ---------------------------------------------------------------------------

function loadPlugin() {
  const source = readFileSync(join(HERE, 'client.js'), 'utf8');
  const document = createDocument();
  const captured = { entry: null };
  const warnings = [];

  const window = {
    __ModuleLoader__: {
      load(entry) {
        captured.entry = entry;
      }
    },
    document: document,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame(handler) {
      return setTimeout(handler, 0);
    },
    cancelAnimationFrame(timer) {
      clearTimeout(timer);
    }
  };

  const requireStub = (name) => {
    if (name === 'react') return { useState() {}, useEffect() {} };
    throw new Error('unexpected require: ' + name);
  };

  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    // eslint-disable-next-line no-new-func
    new Function(
      'window',
      'document',
      'console',
      'MutationObserver',
      'setTimeout',
      'clearTimeout',
      source
    )(window, document, console, window.MutationObserver, setTimeout, clearTimeout);
  } finally {
    console.warn = originalWarn;
  }

  if (captured.entry === null) throw new Error('client.js 没有调用 window.__ModuleLoader__.load');
  const plugin = captured.entry.factory(requireStub);
  return { plugin, api: plugin.__test, document, warnings, entry: captured.entry };
}

function makeOverflowButton(document, groupKey) {
  const button = document.createElement('button');
  button.setAttribute('data-row-key', 'overflow:' + groupKey);
  document.nodes.push(button);
  return button;
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

console.log('[1] 模块契约');
{
  const { entry, plugin } = loadPlugin();
  equal('entry.id', entry.id, '@local/expand-all-sessions');
  check('factory 返回 apply/inject', typeof plugin.apply === 'function' && Array.isArray(plugin.inject));
  let effectLabel = null;
  plugin.apply({
    effect(fn, label) {
      effectLabel = label;
      const teardown = fn();
      check('effect 回调返回 teardown', typeof teardown === 'function');
      teardown();
    }
  });
  check('ctx.effect 被调用且带标签', effectLabel !== null && effectLabel.indexOf('expand-all-sessions') === 0, effectLabel);
}

console.log('[2] hook 定位（findLimitsHook）');
{
  const { api, document } = loadPlugin();
  const called = [];
  const button = makeOverflowButton(document, 'ws-1');
  const tree = buildTree(button, (action) => called.push(action), { 'ws-1': 3, 'ws-2': Infinity });

  const found = api.findLimitsHook(button, 'ws-1');
  check('能穿过非目标 fiber 找到 sessionLimits', found !== null);
  equal('命中的是 SessionTree 的 fiber', found === null ? null : found.fiber, tree.treeFiber);
  equal('命中的是那条 useState hook', found === null ? null : found.hook, tree.limitsHook);

  const refOnly = api.findLimitsHook(button, 'not-present');
  equal('本组不在状态里时不误命中 useRef', refOnly, null);

  // Ungrouped 分组的 key 是空串（buildGroup("", …)）：它同样「带着 key」，不能靠空对象判据。
  const ungrouped = loadPlugin();
  const emptyButton = makeOverflowButton(ungrouped.document, '');
  const emptyTree = buildTree(emptyButton, () => {}, { '': 5 });
  const emptyFound = ungrouped.api.findLimitsHook(emptyButton, '');
  check('空串分组（Ungrouped）按 key 命中', emptyFound !== null && emptyFound.fiber === emptyTree.treeFiber);

  equal('空状态 {} 不是「已全量」', api.isExpandedState({}, '', 48), false);
  equal('空串分组的 5 条不是「已全量」', api.isExpandedState({ '': 5 }, '', 48), false);
  equal('无限大是「已全量」', api.isExpandedState({ '': Infinity }, '', 48), true);
  equal('limit ≥ 总数也算「已全量」', api.isExpandedState({ '': 48 }, '', 48), true);

  const doc = createDocument();
  const orphan = doc.createElement('button');
  orphan.setAttribute('data-row-key', 'overflow:ws-9');
  equal('没有 fiber 键的按钮返回 null', api.findLimitsHook(orphan, 'ws-9'), null);
}

console.log('[3] 状态映射与一次 dispatch');
{
  const { api, document } = loadPlugin();
  const actions = [];
  const button = makeOverflowButton(document, 'ws-1');
  buildTree(button, (action) => actions.push(action), { 'ws-1': 3 });

  const ok = api.dispatchGroup('ws-1', button);
  check('dispatchGroup 返回 true', ok === true);
  equal('只排入一次更新', actions.length, 1);

  const previous = { 'ws-1': 5, 'ws-2': 10 };
  const next = actions[0](previous);
  equal('该组变成 Infinity', next['ws-1'], Infinity);
  equal('其它组保持不变', next['ws-2'], 10);
  check('不改写传入的旧状态', previous['ws-1'] === 5);

  const collapsed = api.mappedLimits({ 'ws-1': Infinity }, 'ws-1', false);
  equal('收起写回默认配额', collapsed['ws-1'], api.DEFAULT_COLLAPSED_LIMIT);

  const emptyKey = api.mappedLimits({}, '', true);
  equal('空串 key 也能写入', emptyKey[''], Infinity);
}

console.log('[4] 扫描：首屏全量 + 幂等');
{
  const { api, document } = loadPlugin();
  const actions = [];
  const buttonA = makeOverflowButton(document, 'ws-a');
  const buttonB = makeOverflowButton(document, 'ws-b');
  buildTree(buttonA, (action) => actions.push(['a', action]), { 'ws-a': 3 });
  buildTree(buttonB, (action) => actions.push(['b', action]), { 'ws-b': 4 });

  api.sweep();
  equal('两个分组各排入一次更新', actions.length, 2);
  check('expandedGroups 记录两组', api.expandedGroups.has('ws-a') && api.expandedGroups.has('ws-b'));

  api.sweep();
  equal('重复扫描不再更新（折叠后不弹回）', actions.length, 2);

  api.resetForTest();
  const freshButton = makeOverflowButton(document, 'ws-a');
  buildTree(freshButton, (action) => actions.push(['a2', action]), { 'ws-a': 5 });
  api.sweep();
  equal('同组重建的新按钮在复位后仍会全量', actions.length, 3);
  equal('这次写入的是 Infinity', actions[2][1]({ 'ws-a': 5 })['ws-a'], Infinity);
}

console.log('[5] 点击接管：展开走全量，收起交还宿主');
{
  const { api, document } = loadPlugin();
  const actions = [];
  const button = makeOverflowButton(document, 'ws-1');
  buildTree(button, (action) => actions.push(action), { 'ws-1': 3 });

  api.interceptButton(button);
  api.interceptButton(button);
  equal('重复接管不重复加监听', button.listeners.get('click').length, 1);
  equal('首次接管即自动全量', actions.length, 1);

  // 宿主把它渲染成「收起」：重新提交后的 fiber 状态为 Infinity
  const collapsedTree = buildTree(button, (action) => actions.push(action), { 'ws-1': Infinity });
  button.dispatch('click');
  equal('收起时我们不写状态', actions.length, 1);
  check('收起时仍存在 fiber', collapsedTree.treeFiber !== null);

  // 用户折叠后（状态回到 5）再点「展开其余」：应当直接全量
  buildTree(button, (action) => actions.push(action), { 'ws-1': 5 });
  button.dispatch('click');
  equal('折叠后再点展开只排入一次全量更新', actions.length, 2);
  equal('这次写入的是 Infinity', actions[1]({ 'ws-1': 5 })['ws-1'], Infinity);
}

console.log('[5b] 回归：Ungrouped（空串 key）分组不能被当成「收起」');
{
  const { api, document } = loadPlugin();
  const actions = [];
  const button = makeOverflowButton(document, '');
  buildTree(button, (action) => actions.push(action), { '': 5 });

  button.textContent = '展开其余 48 个会话';
  api.interceptButton(button);
  equal('空串分组首屏即全量（走主路径，非降级点击）', actions.length, 1);
  equal('写入的是 Infinity', actions[0]({ '': 5 })[''], Infinity);

  // 用户折叠回 5 条后再点「展开其余」：仍应直接全量
  buildTree(button, (action) => actions.push(action), { '': 5 });
  equal('空串分组折叠后不是「已全量」', api.isExpandedButton(button, ''), false);
  button.dispatch('click');
  equal('空串分组折叠后点击会排入一次全量更新', actions.length, 2);
  equal('写入的是 Infinity', actions[1]({ '': 5 })[''], Infinity);

  // 宿主切到「收起」后（limit = Infinity）才应当放行给它自己处理
  buildTree(button, (action) => actions.push(action), { '': Infinity });
  equal('全量态被识别为「收起」', api.isExpandedButton(button, ''), true);
  button.dispatch('click');
  equal('全量态下点击不再写状态', actions.length, 2);
}

console.log('[6] 降级路径');
{
  const { api, document } = loadPlugin();
  const button = makeOverflowButton(document, 'ws-x'); // 没有任何 fiber
  api.interceptButton(button);
  equal('主路径不可用时退回原生点击', button.clicks, 1);

  const before = button.clicks;
  api.sweep();
  equal('后续扫描继续推进原生点击', button.clicks, before + 1);

  for (let at = 0; at < api.FALLBACK_CLICK_LIMIT + 5; at += 1) api.sweep();
  check(
    '触达上限后停止点击',
    button.clicks <= api.FALLBACK_CLICK_LIMIT,
    { clicks: button.clicks, limit: api.FALLBACK_CLICK_LIMIT }
  );
  check('上限触发过 warn', [...api.warned].some((key) => key.startsWith('fallback-limit:')));
}

console.log('[7] 生命周期');
{
  const { plugin, api } = loadPlugin();
  let teardown = null;
  plugin.apply({
    effect(fn) {
      teardown = fn();
    }
  });
  check('cleanup 是函数', typeof teardown === 'function');
  try {
    teardown();
    check('cleanup 不抛错', true);
  } catch (error) {
    check('cleanup 不抛错', false, String(error));
  }
}

console.log('');
console.log('通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
if (failures.length > 0) {
  for (const failure of failures) console.log('  - ' + failure);
  process.exitCode = 1;
}
