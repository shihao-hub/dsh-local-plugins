/**
 * @local/expand-all-sessions 的 Node 侧离线自测（无依赖，`node self-test.mjs` 即可跑）。
 *
 * client.js 是一个接受 `window.__ModuleLoader__.load` 的 IIFE，所以这里用假 DOM +
 * 合成 React fiber 桩把它跑起来，验证纯逻辑：hook 定位、状态映射、方向判据、点击路由、
 * 幂等与重试预算。
 *
 * 注意：桩 fiber 只能验证「我们以为的宿主形状」。真实 React 的提交形状（fiber 指针
 * current/alternate 交替、hooks 链顺序、queue 共享）由 dom-test.mjs 用真 React + jsdom
 * 验证，两者互补，改 fiber 相关逻辑时必须两个都跑。
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    parentNode: null,
    textContent: '',
    get parentElement() {
      return this.parentNode === null || String(this.parentNode.tagName).startsWith('#')
        ? null
        : this.parentNode;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    get rootNode() {
      let node = this;
      while (node.parentNode !== null) node = node.parentNode;
      return node;
    },
    addEventListener(type, handler, options) {
      const list = this.listeners.get(type) ?? [];
      list.push({ handler: handler, capture: options === true });
      this.listeners.set(type, list);
    },
    removeEventListener(type, handler, options) {
      const list = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        list.filter((entry) => entry.handler !== handler || entry.capture !== (options === true))
      );
    },
    listenersOf(type, capture) {
      return (this.listeners.get(type) ?? []).filter((entry) => entry.capture === capture);
    },
    dispatchEvent(event) {
      // 近似真实 DOM 顺序：document→…→target 只跑 capture 监听，target→…→document 只跑冒泡
      // 监听（两者互不重复，target 上的两种都会各触发一次）。
      const path = [];
      for (let node = this; node !== null && node !== undefined; node = node.parentNode) {
        path.push(node);
      }
      for (let at = path.length - 1; at >= 1; at -= 1) {
        for (const entry of path[at].listenersOf(event.type, true)) {
          entry.handler(Object.assign({}, event, { currentTarget: path[at] }));
        }
      }
      for (const entry of path[0].listenersOf(event.type, true)) {
        entry.handler(Object.assign({}, event, { currentTarget: path[0] }));
      }
      for (const entry of path[0].listenersOf(event.type, false)) {
        entry.handler(Object.assign({}, event, { currentTarget: path[0] }));
      }
      for (let at = 1; at < path.length; at += 1) {
        for (const entry of path[at].listenersOf(event.type, false)) {
          entry.handler(Object.assign({}, event, { currentTarget: path[at] }));
        }
      }
      return true;
    },
    dispatch(type) {
      this.dispatchEvent({ type: type, target: this, bubbles: true, defaultPrevented: false });
      return this;
    },
    click() {
      this.clicks += 1;
      this.dispatch('click');
    }
  };
  return node;
}

function createDocument() {
  const document = createElement('#document');
  const body = createElement('body');
  body.parentNode = document;
  document.body = body;
  document.documentElement = body;
  document.readyState = 'complete';
  document.nodes = [body];
  document.createElement = createElement;
  document.querySelectorAll = function (selector) {
    if (selector === 'button[data-row-key^="overflow:"]') {
      return this.nodes.filter(
        (node) =>
          node.tagName === 'button' &&
          String(node.getAttribute('data-row-key') ?? '').startsWith('overflow:')
      );
    }
    return [];
  };
  document.querySelector = function (selector) {
    const match = /^button\[data-row-key="(.*)"\]$/.exec(selector);
    if (match === null) return null;
    const wanted = match[1];
    return (
      this.nodes.find(
        (node) => node.tagName === 'button' && node.getAttribute('data-row-key') === wanted
      ) ?? null
    );
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

/** 近似 useSyncExternalStore：对象快照 + 没有 dispatch 的 queue。 */
function makeStoreHook(snapshot) {
  return {
    memoizedState: snapshot,
    queue: { value: snapshot, getSnapshot: () => snapshot },
    next: null
  };
}

function makeFiber(tag, memoizedState, parent) {
  return {
    tag: tag,
    memoizedState: memoizedState,
    return: parent ?? null,
    child: null,
    props: {},
    stateNode: null,
    alternate: null
  };
}

function chainHooks(fiber, hooks) {
  fiber.memoizedState = hooks[0] ?? null;
  for (let at = 0; at + 1 < hooks.length; at += 1) hooks[at].next = hooks[at + 1];
  return fiber;
}

/**
 * 搭出一棵与 ui-workspace 同形的 fiber 链：
 * div(host) → div(host) → SessionTree(函数组件: useSyncExternalStore / useState({}) /
 *   useState(null) / useRef / useEffect) → div(host, 带按钮)
 *
 * `sessionLimitsState` 默认传 `{}`——**这正是宿主首屏的真实初值**。
 */
function buildTree(buttonNode, sessionLimitsDispatch, sessionLimitsState) {
  const treeFiber = chainHooks(makeFiber(0, null, null), [
    makeStoreHook({ s0: { state: 'idle' } }),
    makeHook(null, () => {}),
    makeRef(null)
  ]);
  const limitsHook = makeHook(sessionLimitsState ?? {}, sessionLimitsDispatch);
  chainHooks(treeFiber, [
    makeStoreHook({ s0: { state: 'idle' } }),
    limitsHook,
    makeHook(null, () => {}),
    makeRef(null),
    makeHook({ tag: 5, create() {}, destroy: null, deps: [] }, undefined)
  ]);
  // useEffect 的 hook 没有 queue
  treeFiber.memoizedState.next.next.next.next.queue = null;
  const sectionFiber = chainHooks(makeFiber(0, null, treeFiber), [makeStoreHook({})]);
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
  button.parentNode = document.body;
  document.nodes.push(button);
  return button;
}

/** 用插件的 start() 挂上 document 级点击路由，返回 teardown。 */
function mountRouting(plugin, api) {
  let teardown = null;
  plugin.apply({
    effect(fn) {
      teardown = fn();
    }
  });
  api.resetForTest();
  return teardown;
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

console.log('[2] limits map 判据（不能把宿主其它对象状态当成 sessionLimits）');
{
  const { api } = loadPlugin();
  equal('空对象 {} 算 limits map（首屏初值）', api.looksLikeLimitsMap({}), true);
  equal('数字值的对象算 limits map', api.looksLikeLimitsMap({ 'ws-1': 5, '': Infinity }), true);
  equal('值为对象的快照不算', api.looksLikeLimitsMap({ s0: { state: 'idle' } }), false);
  equal('值为布尔的 groupExpansion 不算', api.looksLikeLimitsMap({ 'ws-1': true }), false);
  equal('数组不算', api.looksLikeLimitsMap([1, 2]), false);
  equal('Map 不算', api.looksLikeLimitsMap(new Map()), false);
  equal('null 不算', api.looksLikeLimitsMap(null), false);
}

console.log('[3] hook 定位（findLimitsHook）');
{
  const { api, document } = loadPlugin();
  const called = [];
  const button = makeOverflowButton(document, 'ws-1');
  const tree = buildTree(button, (action) => called.push(action), { 'ws-1': 3, 'ws-2': Infinity });

  const found = api.findLimitsHook(button, 'ws-1');
  check('能穿过非目标 fiber 找到 sessionLimits', found !== null);
  equal('命中的是 SessionTree 的 fiber', found === null ? null : found.fiber, tree.treeFiber);
  equal('命中的是那条 useState hook', found === null ? null : found.hook, tree.limitsHook);

  // 回归用例（此前 bug 的根因）：宿主首屏 sessionLimits === {}，任何「必须已带本组 key」
  // 的判据都会让首屏与第一次点击必然失手。
  const fresh = loadPlugin();
  const freshButton = makeOverflowButton(fresh.document, 'ws-1');
  const freshTree = buildTree(freshButton, () => {}, {});
  const freshFound = fresh.api.findLimitsHook(freshButton, 'ws-1');
  check('状态还是 {} 时也必须命中（不能要求已有本组 key）', freshFound !== null);
  equal('命中的仍是那条 useState hook', freshFound === null ? null : freshFound.hook, freshTree.limitsHook);

  const refOnly = api.findLimitsHook(button, 'not-present');
  check('状态里没有本组 key 时退化为最近的 limits map，而不是误命中 useRef', refOnly !== null && refOnly.hook === tree.limitsHook);

  // Ungrouped 分组的 key 是空串（buildGroup("", …)）：它同样「带着 key」。
  const ungrouped = loadPlugin();
  const emptyButton = makeOverflowButton(ungrouped.document, '');
  const emptyTree = buildTree(emptyButton, () => {}, { '': 5 });
  const emptyFound = ungrouped.api.findLimitsHook(emptyButton, '');
  check('空串分组（Ungrouped）按 key 命中', emptyFound !== null && emptyFound.fiber === emptyTree.treeFiber);

  const doc = createDocument();
  const orphan = doc.createElement('button');
  orphan.setAttribute('data-row-key', 'overflow:ws-9');
  equal('没有 fiber 键的按钮返回 null', api.findLimitsHook(orphan, 'ws-9'), null);
}

console.log('[4] 方向判据（aria-expanded 优先，文案无数字=收起）');
{
  const { api, document } = loadPlugin();
  const button = makeOverflowButton(document, 'ws-1');
  buildTree(button, () => {}, { 'ws-1': 5 });

  button.setAttribute('aria-expanded', 'true');
  equal('aria-expanded=true 即宿主的「收起」', api.isFullyExpanded(button, { 'ws-1': 5 }, 'ws-1'), true);

  button.setAttribute('aria-expanded', 'false');
  button.textContent = '展开其余 6 个会话';
  equal('aria-expanded=false 一律按未全量', api.isFullyExpanded(button, { 'ws-1': Infinity }, 'ws-1'), false);

  button.attributes = {};
  button.textContent = '收起';
  equal('无 aria 且文案无数字 = 收起', api.isFullyExpanded(button, { 'ws-1': 10 }, 'ws-1'), true);

  button.textContent = '展开其余 3 个会话';
  equal('无 aria 且 limit=10、隐藏 3 → 未全量（旧实现会误判已全量）', api.isFullyExpanded(button, { 'ws-1': 10 }, 'ws-1'), false);

  button.textContent = '展开其余 3 个会话';
  equal('无 aria 且 limit=Infinity → 已全量', api.isFullyExpanded(button, { 'ws-1': Infinity }, 'ws-1'), true);
}

console.log('[5] 状态映射与一次 dispatch');
{
  const { api, document } = loadPlugin();
  const actions = [];
  const button = makeOverflowButton(document, 'ws-1');
  buildTree(button, (action) => actions.push(action), {});

  const located = api.findLimitsHook(button, 'ws-1');
  check('空状态也能拿到 hook', located !== null);
  const ok = api.dispatchLimit(located, 'ws-1', Infinity);
  check('dispatchLimit 返回 true', ok === true);
  equal('只排入一次更新', actions.length, 1);

  const previous = { 'ws-1': 5, 'ws-2': 10 };
  const next = actions[0](previous);
  equal('该组变成 Infinity', next['ws-1'], Infinity);
  equal('其它组保持不变', next['ws-2'], 10);
  check('不改写传入的旧状态', previous['ws-1'] === 5);

  const collapsed = api.mappedLimits({ 'ws-1': Infinity }, 'ws-1', api.DEFAULT_COLLAPSED_LIMIT);
  equal('收起写回默认配额', collapsed['ws-1'], api.DEFAULT_COLLAPSED_LIMIT);

  const emptyKey = api.mappedLimits({}, '', Infinity);
  equal('空串 key 也能写入', emptyKey[''], Infinity);
}

console.log('[6] 扫描：首屏全量 + 幂等 + 状态重置后重来');
{
  const { api, document } = loadPlugin();
  const actions = [];
  const button = makeOverflowButton(document, 'ws-a');
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '展开其余 8 个会话';
  const tree = buildTree(button, (action) => actions.push(action), {});

  api.sweep();
  equal('首屏（状态 {}）即自动全量', actions.length, 1);
  check('记录已自动全量', api.autoExpanded.has('ws-a'));

  // 宿主把状态写成 Infinity：重复扫描不再更新
  tree.limitsHook.memoizedState = { 'ws-a': Infinity };
  button.setAttribute('aria-expanded', 'true');
  button.textContent = '收起';
  api.sweep();
  equal('已全量时不再更新', actions.length, 1);

  // 用户主动「收起」：limit=5，插件必须尊重，不能弹回
  tree.limitsHook.memoizedState = { 'ws-a': 5 };
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '展开其余 8 个会话';
  api.sweep();
  equal('用户收起后扫描不弹回', actions.length, 1);

  // SessionTree 重挂：状态被重置成 {}
  tree.limitsHook.memoizedState = {};
  api.sweep();
  equal('状态重置后视为新首屏，重新全量', actions.length, 2);
  equal('这次写入的是 Infinity', actions[1]({})['ws-a'], Infinity);
}

console.log('[7] 点击路由：一次点击到全量，「收起」交还宿主');
{
  const { plugin, api, document } = loadPlugin();
  const actions = [];
  const button = makeOverflowButton(document, 'ws-1');
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '展开其余 8 个会话';
  const tree = buildTree(button, (action) => actions.push(action), {});
  const teardown = mountRouting(plugin, api);

  // 状态里还没有本组 key（宿主首屏）时的第一次点击
  button.dispatch('click');
  equal('第一次点击就排入一次全量更新', actions.length, 1);
  equal('写入的是 Infinity', actions[0]({})['ws-1'], Infinity);

  // 宿主切到「收起」
  tree.limitsHook.memoizedState = { 'ws-1': Infinity };
  button.setAttribute('aria-expanded', 'true');
  button.textContent = '收起';
  button.dispatch('click');
  equal('「收起」时不写状态，交还宿主', actions.length, 1);

  // 用户折叠（limit 回到 5）后再点「展开其余」：仍然一次全量
  tree.limitsHook.memoizedState = { 'ws-1': 5 };
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '展开其余 8 个会话';
  button.dispatch('click');
  equal('折叠后再点展开只排入一次全量更新', actions.length, 2);
  equal('这次写入的是 Infinity', actions[1]({ 'ws-1': 5 })['ws-1'], Infinity);
  teardown();
}

console.log('[7a] 回归：按钮节点被 React 替换后点击仍然有效');
{
  const { plugin, api, document } = loadPlugin();
  const actions = [];
  const first = makeOverflowButton(document, 'ws-r');
  first.setAttribute('aria-expanded', 'false');
  first.textContent = '展开其余 8 个会话';
  buildTree(first, (action) => actions.push(action), {});
  const teardown = mountRouting(plugin, api);
  api.sweep();
  equal('第一次扫描就全量（走主路径）', actions.length, 1);

  // 模拟 React 卸载旧节点、挂上一个全新的按钮节点（旧节点上的监听器随之消失）
  const replaced = makeOverflowButton(document, 'ws-r');
  replaced.setAttribute('aria-expanded', 'false');
  replaced.textContent = '展开其余 8 个会话';
  buildTree(replaced, (action) => actions.push(action), { 'ws-r': 5 });
  equal('新节点上没有我们挂的监听器', replaced.listenersOf('click', true).length, 0);
  replaced.dispatch('click');
  equal('document 级路由仍然接住点击并全量', actions.length, 2);
  equal('写入的是 Infinity', actions[1]({ 'ws-r': 5 })['ws-r'], Infinity);
  teardown();
}

console.log('[7b] 回归：Ungrouped（空串 key）分组不能被当成「收起」');
{
  const { plugin, api, document } = loadPlugin();
  const actions = [];
  const button = makeOverflowButton(document, '');
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '展开其余 48 个会话';
  buildTree(button, (action) => actions.push(action), {});
  const teardown = mountRouting(plugin, api);

  api.sweep();
  equal('空串分组首屏即全量（走主路径，非降级点击）', actions.length, 1);
  equal('写入的是 Infinity', actions[0]({})[''], Infinity);

  api.autoExpanded.clear();
  buildTree(button, (action) => actions.push(action), { '': 5 });
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '展开其余 48 个会话';
  equal('空串分组折叠后不是「已全量」', api.isFullyExpanded(button, { '': 5 }, ''), false);
  button.dispatch('click');
  equal('空串分组折叠后点击会排入一次全量更新', actions.length, 2);
  equal('写入的是 Infinity', actions[1]({ '': 5 })[''], Infinity);

  // 宿主切到「收起」后（aria-expanded=true）才应当放行给它自己处理
  buildTree(button, (action) => actions.push(action), { '': Infinity });
  button.setAttribute('aria-expanded', 'true');
  button.textContent = '收起';
  equal('全量态被识别为「收起」', api.isFullyExpanded(button, { '': Infinity }, ''), true);
  button.dispatch('click');
  equal('全量态下点击不再写状态', actions.length, 2);
  teardown();
}

console.log('[8] 找不到 hook：扫描只重试不点击；用户点击则交给有界兜底');
{
  const { plugin, api, document } = loadPlugin();
  const teardown = mountRouting(plugin, api);
  const button = makeOverflowButton(document, 'ws-x'); // 没有任何 fiber
  const hostEvents = [];
  button.addEventListener('click', (event) => hostEvents.push(event), false);
  button.textContent = '展开其余 3 个会话';

  api.sweep();
  equal('扫描阶段找不到 hook 不做合成点击', button.clicks, 0);
  equal('重试预算被消耗一次', api.attempts.get('ws-x'), 1);

  for (let at = 0; at < api.MAX_DISPATCH_ATTEMPTS + 3; at += 1) api.sweep();
  check(
    '重试预算不会超支',
    api.attempts.get('ws-x') <= api.MAX_DISPATCH_ATTEMPTS,
    api.attempts.get('ws-x')
  );
  check('耗尽后留下 exhausted warn', [...api.warned].some((key) => key.startsWith('exhausted:')));
  equal('扫描阶段全程零合成点击', button.clicks, 0);

  // 用户点击：fiber 路径不可用，但点击意图必须被满足 —— 逐帧驱动宿主按钮，
  // 且带卡死检测（这个假按钮外观永远不变，所以最多点 FALLBACK_STUCK_LIMIT 次）。
  button.dispatch('click');
  equal('用户点击先让宿主收到一次', hostEvents.length, 1);
  check(
    '点击时留一条 dispatch-miss warn',
    [...api.warned].some((key) => key.startsWith('dispatch-miss:')),
    [...api.warned]
  );
  await sleep(300);
  equal(
    '兜底点击有界（卡死后停手）',
    button.clicks,
    api.FALLBACK_MAX_CLICKS === 0 ? 0 : 3
  );
  check(
    '卡死后留一条 fallback-stuck warn',
    [...api.warned].some((key) => key.startsWith('fallback-stuck:')),
    [...api.warned]
  );
  teardown();
  api.resetForTest();
}

console.log('[9] 生命周期');
{
  const { plugin, api, document } = loadPlugin();
  const actions = [];
  const button = makeOverflowButton(document, 'ws-t');
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '展开其余 8 个会话';
  buildTree(button, (action) => actions.push(action), {});
  const teardown = mountRouting(plugin, api);
  api.sweep();
  equal('挂载后一次全量', actions.length, 1);

  check('cleanup 是函数', typeof teardown === 'function');
  try {
    teardown();
    check('cleanup 不抛错', true);
  } catch (error) {
    check('cleanup 不抛错', false, String(error));
  }
  const mark = actions.length;
  button.dispatch('click');
  equal('cleanup 后点击不再被接管', actions.length, mark);
}

console.log('[10] 非本插件关心的点击完全不干扰');
{
  const { plugin, api, document } = loadPlugin();
  const teardown = mountRouting(plugin, api);
  const row = document.createElement('div');
  row.setAttribute('data-row-key', 'session:abc');
  row.parentNode = document.body;
  let hits = 0;
  row.addEventListener('click', () => {
    hits += 1;
  }, false);
  row.dispatch('click');
  equal('普通会话行的点击只走宿主自己的监听', hits, 1);
  equal('普通点击不产生任何 warn', api.warned.size, 0);
  teardown();
}

console.log('[11] 兜底路径：主路径没生效时驱动宿主按钮（等价用户手动连点）');
{
  const { plugin, api, document } = loadPlugin();
  const actions = [];
  const hostClicks = [];
  const button = makeOverflowButton(document, 'ws-f');
  const tree = buildTree(button, (action) => actions.push(action), { 'ws-f': 5 });
  const teardown = mountRouting(plugin, api);
  const TOTAL = 23;

  // 模拟宿主自己的 onClick 语义：隐藏 > 5 就 +5，隐藏 ≤ 5 直接 Infinity
  const sync = () => {
    const limit = tree.limitsHook.memoizedState['ws-f'];
    const hidden = TOTAL - Math.min(TOTAL, limit);
    button.setAttribute('aria-expanded', hidden === 0 ? 'true' : 'false');
    button.textContent = hidden === 0 ? '收起' : '展开其余 ' + String(hidden) + ' 个会话';
  };
  button.addEventListener('click', () => {
    hostClicks.push('host');
    const limit = tree.limitsHook.memoizedState['ws-f'];
    const hidden = TOTAL - Math.min(TOTAL, limit);
    tree.limitsHook.memoizedState = { 'ws-f': hidden <= 5 ? Infinity : (limit ?? 5) + 5 };
    sync();
  }, false);
  sync();
  equal('初始是折叠态（aria=false）', button.getAttribute('aria-expanded'), 'false');

  api.driveHostExpand('ws-f');
  await sleep(300); // 兜底是逐帧驱动（16ms 一帧），等它跑完
  check('兜底后按钮变成「收起」', api.isFullyExpanded(button, tree.limitsHook.memoizedState, 'ws-f'));
  equal('宿主状态被推到 Infinity', tree.limitsHook.memoizedState['ws-f'], Infinity);
  equal('真的点了宿主按钮（5→10→15→20→Infinity 共 4 次）', hostClicks.length, 4);
  equal('兜底点击没有走我们自己的 dispatch', actions.length, 0);
  check('留下一条 fallback warn', [...api.warned].some((key) => key.startsWith('fallback:')));

  // 卡死检测：外观永远不变的按钮最多点 3 次就停手
  const stuckButton = makeOverflowButton(document, 'ws-stuck');
  stuckButton.setAttribute('aria-expanded', 'false');
  stuckButton.textContent = '展开其余 9 个会话';
  let stuckClicks = 0;
  stuckButton.addEventListener('click', () => {
    stuckClicks += 1;
  }, false);
  api.driveHostExpand('ws-stuck');
  await sleep(300);
  equal('卡死检测生效（3 次后停手）', stuckClicks, 3);
  teardown();
  api.resetForTest();
}

console.log('[12] 核对任务：写完排一次核对，用户再点同一颗按钮即取消');
{
  const { plugin, api, document } = loadPlugin();
  const actions = [];
  const button = makeOverflowButton(document, 'ws-v');
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '展开其余 8 个会话';
  buildTree(button, (action) => actions.push(action), {});
  const teardown = mountRouting(plugin, api);

  button.dispatch('click');
  equal('点击后派了一次全量更新', actions.length, 1);
  check('排入了一个核对任务', api.pendingVerifies.has('ws-v'));
  const firstTimer = api.pendingVerifies.get('ws-v');

  button.dispatch('click'); // 用户又点了一次（例如收起）
  const secondTimer = api.pendingVerifies.get('ws-v');
  check(
    '新点击撤销了上一轮核对（换成新的核对任务）',
    secondTimer !== undefined && secondTimer !== firstTimer,
    { first: firstTimer, second: secondTimer }
  );
  teardown();
  api.resetForTest();
}

console.log('');
console.log('通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
if (failures.length > 0) {
  for (const failure of failures) console.log('  - ' + failure);
  process.exitCode = 1;
}
