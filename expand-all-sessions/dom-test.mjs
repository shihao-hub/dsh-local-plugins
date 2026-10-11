/**
 * expand-all-sessions 真实 React + 真实 DOM 行为测试（打包外依赖，见下方运行说明）。
 *
 * 为什么必须存在这一份：本插件完全依赖宿主 React 的内部结构（fiber / hooks /
 * queue.dispatch），而桩 fiber 只能验证「我们以为的宿主形状」。真实 React 的提交形状
 * 有两个反直觉的事实，正是两个真实 bug 的来源：
 *   1. `sessionLimits` 的初值是 `{}`——要求「状态里必须已有本组 key」的判据必然失手；
 *   2. DOM 节点上的 `__reactFiber$` 指针只在 createInstance 时写入，之后 current /
 *      alternate 逐次交替，直接读 `hook.memoizedState` 会有一半概率读到上一棵树。
 * 因此这里用与 @deepseek-ai/dsh-client-ui-workspace 已构建产物同形的组件
 * （collapsedSessionRows 的 hiddenCount 语义、overflow 按钮的 aria-expanded 与函数式
 * onClick、多分组共用一份 sessionLimits）跑真实 React，逐条断言真人操作路径。
 *
 * 运行（依赖不随插件发布，需要现装）：
 *   mkdir /tmp/dsh-dom-test && cd /tmp/dsh-dom-test
 *   npm init -y && npm i jsdom@24 react@18.3.1 react-dom@18.3.1
 *   EXPAND_ALL_TEST_MODULES=/tmp/dsh-dom-test node <此文件>
 *
 * 也可直接把 jsdom/react/react-dom 装到本插件目录后用 `node dom-test.mjs`
 * （默认就从插件目录解析依赖）。
 *
 * 输出：每条用例 ok/FAIL；全部通过退出码 0。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = join(HERE, 'client.js');
const MODULES_DIR = process.env.EXPAND_ALL_TEST_MODULES ?? HERE;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 依赖解析（jsdom / react / react-dom 不在插件依赖里）
// ---------------------------------------------------------------------------

async function loadDependency(name) {
  const require = createRequire(join(MODULES_DIR, 'package.json'));
  let entry;
  try {
    entry = require.resolve(name);
  } catch (error) {
    console.error(
      '缺少测试依赖 ' + name + '（在 ' + MODULES_DIR + ' 里找不到）。\n' +
        '请先在一个临时目录安装，并用 EXPAND_ALL_TEST_MODULES 指向它：\n' +
        '  npm init -y && npm i jsdom@24 react@18.3.1 react-dom@18.3.1\n' +
        '  EXPAND_ALL_TEST_MODULES=<该目录> node ' + fileURLToPath(import.meta.url)
    );
    process.exit(2);
  }
  return import(pathToFileURL(entry).href);
}

const jsdomModule = await loadDependency('jsdom');
const { JSDOM } = jsdomModule;

// ---------------------------------------------------------------------------
// 宿主行为镜像（逐行对齐已构建产物）
// ---------------------------------------------------------------------------

const COLLAPSED_SESSION_LIMIT = 5;

function makeSessions(prefix, count, runningAt) {
  return Array.from({ length: count }, (_, index) => ({
    id: prefix + String(index),
    blank: false,
    running: index === runningAt,
    runningSubagentCount: 0
  }));
}

function collapsedSessionRows(sessions, limit = COLLAPSED_SESSION_LIMIT) {
  let idleCount = 0;
  const rows = sessions.filter((session) => {
    if (session.blank || session.running || session.runningSubagentCount > 0) return true;
    if (idleCount >= limit) return false;
    idleCount += 1;
    return true;
  });
  return { rows: rows, hiddenCount: sessions.length - rows.length };
}

const STATUS_SNAPSHOT = Object.freeze({ s0: { state: 'idle' } });
const subscribeNoop = () => () => {};

// ---------------------------------------------------------------------------
// 断言
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
// 环境
// ---------------------------------------------------------------------------

let React = null;
let createRoot = null;
let act = null;

async function setupGlobals() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://127.0.0.1:19387/'
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: window.navigator,
      configurable: true,
      writable: true
    });
  } catch (error) {
    /* Node 自带 navigator 只读时忽略 */
  }
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (React === null) {
    const reactModule = await loadDependency('react');
    React = reactModule.default ?? reactModule;
    createRoot = (await loadDependency('react-dom/client')).createRoot;
    act = (await loadDependency('react-dom/test-utils')).act;
  }
  return { window, document: window.document };
}

/**
 * 与宿主同形的 SessionTree：多分组共用一份 sessionLimits。
 * hook 顺序刻意与真实组件一致（外部 store 快照 → useState({}) → useState(null) →
 * useRef → useEffect），用来验证 hook 定位不会误命中别的对象状态。
 *
 * `stateKind: 'map'` 是「宿主把状态换成 Map」的对照宿主：此时插件的 fiber 路径按设计
 * 命中不了（limits map 判据只认纯对象），用来验证「用户点击的意图仍然被满足」——
 * 也就是兜底路径必须能独立完成全量。
 */
function createHost(groups, stateKind = 'object') {
  const useMap = stateKind === 'map';
  return function Host() {
    React.useSyncExternalStore(subscribeNoop, () => STATUS_SNAPSHOT);
    const [sessionLimits, setSessionLimits] = React.useState(() =>
      useMap ? new Map() : {}
    );
    React.useState(null);
    React.useRef(false);
    React.useEffect(() => {}, []);
    const limitOf = (key) => (useMap ? sessionLimits.get(key) : sessionLimits[key]);
    const withLimit = (limits, key, value) => {
      if (!useMap) return { ...limits, [key]: value };
      const next = new Map(limits);
      next.set(key, value);
      return next;
    };
    return React.createElement(
      'div',
      null,
      groups.map((group) => {
        const collapsed = collapsedSessionRows(group.sessions);
        const visible = collapsedSessionRows(group.sessions, limitOf(group.key));
        const sessionsExpanded = visible.hiddenCount === 0;
        const children = visible.rows.map((row) =>
          React.createElement('div', { key: row.id, 'data-row-key': 'session:' + row.id }, row.id)
        );
        if (collapsed.hiddenCount > 0) {
          children.push(
            React.createElement(
              'button',
              {
                key: 'overflow',
                type: 'button',
                'data-row-key': 'overflow:' + group.key,
                'aria-expanded': sessionsExpanded ? 'true' : 'false',
                onClick: () => {
                  setSessionLimits((limits) =>
                    withLimit(
                      limits,
                      group.key,
                      sessionsExpanded
                        ? COLLAPSED_SESSION_LIMIT
                        : visible.hiddenCount <= COLLAPSED_SESSION_LIMIT
                          ? Infinity
                          : ((useMap ? limits.get(group.key) : limits[group.key]) ??
                              COLLAPSED_SESSION_LIMIT) + COLLAPSED_SESSION_LIMIT
                    )
                  );
                }
              },
              sessionsExpanded ? '收起' : '展开其余 ' + String(visible.hiddenCount) + ' 个会话'
            )
          );
        }
        return React.createElement(
          'div',
          {
            key: group.key === '' ? 'ungrouped' : group.key,
            'data-row-key': 'workspace:' + group.key
          },
          children
        );
      })
    );
  };
}

// ---------------------------------------------------------------------------
// 插件装载
// ---------------------------------------------------------------------------

function loadPlugin(window, document) {
  const source = readFileSync(PLUGIN_PATH, 'utf8');
  const captured = { entry: null };
  window.__ModuleLoader__ = { load: (entry) => (captured.entry = entry) };
  new Function(
    'window',
    'document',
    'console',
    'MutationObserver',
    'setTimeout',
    'clearTimeout',
    source
  )(window, document, console, window.MutationObserver, setTimeout, clearTimeout);
  if (captured.entry === null) throw new Error('client.js 未调用 __ModuleLoader__.load');
  return captured.entry.factory(() => ({}));
}

/** 一个场景 = 独立 jsdom + 独立 root + 可选插件。 */
async function makeApp({ groups, withPlugin, autoSettle = true, stateKind = 'object' }) {
  const { window, document } = await setupGlobals();
  const warnings = [];
  let teardown = null;
  let plugin = null;
  if (withPlugin) plugin = loadPlugin(window, document);

  // 整个场景期间都收集插件的 warn（不只是装载期），核对/兜底的降级信息也能被断言到。
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));

  const root = createRoot(document.getElementById('root'));
  const Host = createHost(groups, stateKind);
  const renderSync = () => {
    act(() => {
      root.render(React.createElement(Host));
    });
  };
  const settle = async () => {
    await act(async () => {
      await sleep(80);
    });
  };
  const settleLong = async () => {
    await act(async () => {
      await sleep(400);
    });
  };

  if (withPlugin) {
    plugin.apply({
      effect(fn) {
        teardown = fn();
      }
    });
  }
  renderSync();
  if (autoSettle) await settle();

  const groupNode = (key) => {
    const wanted = 'workspace:' + key;
    return Array.from(document.querySelectorAll('[data-row-key]')).find(
      (node) => node.getAttribute('data-row-key') === wanted
    );
  };
  const rowsOf = (key) => {
    const node = groupNode(key);
    return node === null ? -1 : node.querySelectorAll('[data-row-key^="session:"]').length;
  };
  const buttonOf = (key) => {
    const node = groupNode(key);
    return node === null ? null : node.querySelector('button[data-row-key^="overflow:"]');
  };
  const clickNode = async (node) => {
    await act(async () => {
      node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await settle();
  };
  const clickOverflow = async (key) => {
    const button = buttonOf(key);
    if (button !== null) await clickNode(button);
  };
  const close = async () => {
    await act(async () => {
      root.unmount();
    });
    if (teardown) teardown();
    console.warn = originalWarn;
  };
  return {
    window,
    document,
    plugin,
    Host,
    root,
    renderSync,
    settle,
    settleLong,
    rowsOf,
    buttonOf,
    clickNode,
    clickOverflow,
    warnings,
    close
  };
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

const ALPHA = { key: 'ws-alpha', sessions: makeSessions('a', 14, 3) };
const UNGROUPED = { key: '', sessions: makeSessions('u', 9, -1) };
const TOTAL_ALPHA = ALPHA.sessions.length;
const TOTAL_UNGROUPED = UNGROUPED.sessions.length;

console.log('[1] 宿主自身行为（插件未启用，用作对照）');
{
  const app = await makeApp({ groups: [ALPHA], withPlugin: false });
  equal('首屏只有 5 条闲置 + 运行中行', app.rowsOf(ALPHA.key), 6);
  await app.clickOverflow(ALPHA.key);
  equal('宿主第一次点击只 +5', app.rowsOf(ALPHA.key), 11);
  await app.clickOverflow(ALPHA.key);
  equal('宿主第二次点击到全量', app.rowsOf(ALPHA.key), TOTAL_ALPHA);
  await app.clickOverflow(ALPHA.key);
  equal('宿主「收起」回到 5 条', app.rowsOf(ALPHA.key), 6);
  await app.close();
}

console.log('[2] 首屏即全量（插件核心承诺）');
{
  const app = await makeApp({ groups: [ALPHA, UNGROUPED], withPlugin: true });
  equal('ws-alpha 首屏全量', app.rowsOf(ALPHA.key), TOTAL_ALPHA);
  equal('Ungrouped（空串 key）首屏全量', app.rowsOf(UNGROUPED.key), TOTAL_UNGROUPED);
  equal('无 warn', app.warnings.length, 0);
  await app.close();
}

console.log('[3] 回归：sessionLimits 还是 {} 时的第一次点击必须一次全量');
{
  // 关键时序：插件的自动扫描走 rAF/16ms 定时器，所以在扫描触发前先点一下——
  // 此刻 sessionLimits === {}（宿主初值），「必须已有本组 key」的判据必然失手。
  const app = await makeApp({ groups: [ALPHA], withPlugin: true, autoSettle: false });
  equal('点击前仍是折叠（宿主状态里没有本组 key）', app.rowsOf(ALPHA.key), 6);
  await app.clickOverflow(ALPHA.key);
  equal('第一次点击就全量（不是 +5）', app.rowsOf(ALPHA.key), TOTAL_ALPHA);
  equal('无 warn', app.warnings.length, 0);
  await app.close();
}

console.log('[4] 用户收起后，一次点击必须回到全量');
{
  const app = await makeApp({ groups: [ALPHA], withPlugin: true });
  equal('首屏全量', app.rowsOf(ALPHA.key), TOTAL_ALPHA);
  await app.clickOverflow(ALPHA.key);
  equal('点「收起」回到 5 条闲置 + 运行中行', app.rowsOf(ALPHA.key), 6);
  await app.clickOverflow(ALPHA.key);
  equal('收起后一次点击回到全量', app.rowsOf(ALPHA.key), TOTAL_ALPHA);
  await app.clickOverflow(ALPHA.key);
  equal('再点一次又收起', app.rowsOf(ALPHA.key), 6);
  equal('无 warn', app.warnings.length, 0);
  await app.close();
}

console.log('[5] 回归：SessionTree 重挂（状态被重置成 {}）后重新首屏全量');
{
  const app = await makeApp({ groups: [ALPHA], withPlugin: true });
  await app.clickOverflow(ALPHA.key); // 收起
  equal('收起后 6 条', app.rowsOf(ALPHA.key), 6);
  await act(async () => {
    app.root.unmount();
  });
  const container = app.document.createElement('div');
  app.document.body.appendChild(container);
  const secondRoot = createRoot(container);
  await act(async () => {
    secondRoot.render(React.createElement(app.Host));
  });
  await app.settle();
  equal('重挂后重新全量', app.rowsOf(ALPHA.key), TOTAL_ALPHA);
  await act(async () => {
    secondRoot.unmount();
  });
  await app.close();
}

console.log('[6] 落点不在按钮本身（点按钮内子节点）也能接管');
{
  const app = await makeApp({ groups: [ALPHA], withPlugin: true });
  await app.clickOverflow(ALPHA.key); // 收起
  equal('收起后 6 条', app.rowsOf(ALPHA.key), 6);
  const button = app.buttonOf(ALPHA.key);
  const span = app.document.createElement('span');
  span.textContent = '展开其余';
  button.textContent = '';
  button.appendChild(span);
  await app.clickNode(span);
  equal('点子节点同样一次全量', app.rowsOf(ALPHA.key), TOTAL_ALPHA);
  await app.close();
}

console.log('[7] 非溢出按钮的点击完全不受影响');
{
  const app = await makeApp({ groups: [ALPHA], withPlugin: true });
  const row = app.document.querySelector('[data-row-key^="session:"]');
  let hostClicks = 0;
  row.addEventListener('click', () => {
    hostClicks += 1;
  });
  await app.clickNode(row);
  equal('会话行点击照旧', hostClicks, 1);
  equal('未产生任何 warn', app.warnings.length, 0);
  await app.close();
}

console.log('[8] 核对机制：点击后派核对任务，DOM 达标即静默（不触发兜底）');
{
  const app = await makeApp({ groups: [ALPHA], withPlugin: true });
  const api = app.plugin.__test;
  await app.clickOverflow(ALPHA.key); // 收起
  equal('收起后 6 条', app.rowsOf(ALPHA.key), 6);
  await app.clickOverflow(ALPHA.key); // 展开
  equal('一次点击回到全量', app.rowsOf(ALPHA.key), TOTAL_ALPHA);
  await app.settleLong(); // 等过核对延时（150ms）
  equal('核对任务已收尾', api.pendingVerifies.has(ALPHA.key), false);
  equal(
    '没有走兜底（无 fallback warn）',
    app.warnings.filter((line) => line.indexOf('主路径未生效') >= 0).length,
    0
  );
  await app.close();
}

console.log('[9] 兜底路径：主路径失效时驱动宿主按钮也能到全量');
{
  const app = await makeApp({ groups: [ALPHA], withPlugin: true });
  const api = app.plugin.__test;
  await app.clickOverflow(ALPHA.key); // 收起
  equal('收起后 6 条', app.rowsOf(ALPHA.key), 6);
  let hostClicks = 0;
  app.document.addEventListener('click', (event) => {
    if (
      event.target instanceof app.window.HTMLButtonElement &&
      String(event.target.getAttribute('data-row-key') ?? '').startsWith('overflow:')
    ) {
      hostClicks += 1;
    }
  });
  api.driveHostExpand(ALPHA.key); // 直接走兜底（模拟主路径没生效）
  await app.settleLong(); // 兜底逐帧点击（16ms 一帧）
  equal('兜底后全量', app.rowsOf(ALPHA.key), TOTAL_ALPHA);
  check('兜底确实点了宿主按钮', hostClicks >= 1, hostClicks);
  check(
    '留下 fallback warn',
    app.warnings.some((line) => line.indexOf('主路径未生效') >= 0),
    app.warnings
  );
  await app.close();
}

console.log('[10] 对照宿主：状态换成 Map（fiber 路径命中不了）时，点击仍必须全量');
{
  // limits map 判据只认纯对象，Map 状态下插件按设计找不到 hook。用户点击的意图不能
  // 因此丢失：这条路必须由兜底（驱动宿主按钮）完成，并留下一条 dispatch-miss warn。
  const app = await makeApp({ groups: [ALPHA], withPlugin: true, stateKind: 'map' });
  equal('首屏没能全量（fiber 路径按设计失效）', app.rowsOf(ALPHA.key), 6);
  await app.clickOverflow(ALPHA.key);
  await app.settleLong(); // 兜底逐帧点击
  equal('点击后仍然到达全量', app.rowsOf(ALPHA.key), TOTAL_ALPHA);
  check(
    '留下 dispatch-miss warn',
    app.warnings.some((line) => line.indexOf('找不到该分组的 limit 状态') >= 0),
    app.warnings
  );
  await app.close();
}

// ---------------------------------------------------------------------------

console.log('');
console.log('通过 ' + String(passed) + ' 项，失败 ' + String(failures.length) + ' 项');
if (failures.length > 0) {
  for (const failure of failures) console.log('  - ' + failure);
  process.exitCode = 1;
}
