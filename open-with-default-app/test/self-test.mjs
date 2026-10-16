/**
 * open-with-default-app 零依赖自测。
 *
 * 覆盖两件事，都不需要 React / jsdom：
 *   1. **注册契约**——`apply(ctx)` 到底往宿主槽位账本里写了什么（槽名、id、order、
 *      locale、locale 词典键集），以及 session remote 缺失时的退化分支；
 *   2. **纯逻辑**——RPC 载荷形状、信封映射、单飞闸门、可见性判据、路径取末段。
 *
 * 它**不**覆盖：宿主真实渲染形状、primitives 真实外观、点击后的界面表现——
 * 那些属于 dom-test.mjs（真 React + jsdom）与人工验收。
 *
 * 运行：node test/self-test.mjs      全部通过退出码 0
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(HERE, '..', 'client.js');

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
// 装载 client.js（浏览器包装：window.__ModuleLoader__ + 工厂 require）
// ---------------------------------------------------------------------------

/** 工厂期只做定义、不渲染，故 React 桩只需存在。 */
const reactStub = {
  createElement: () => null,
  useState: () => [undefined, () => {}],
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
  Fragment: Symbol('Fragment')
};

/** primitives 全缺失 → 走插件内部的原生元素兜底分支。 */
const primitivesStub = {};

function loadPlugin(requireMap) {
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
  if (record === undefined) throw new Error('client.js did not register a module');
  return {
    record,
    exports: record.factory((name) => {
      if (Object.prototype.hasOwnProperty.call(requireMap, name)) return requireMap[name];
      throw new Error('unexpected require: ' + name);
    })
  };
}

const { record, exports: plugin } = loadPlugin({
  react: reactStub,
  '@deepseek-ai/dsh-client-ui-primitives': primitivesStub
});

ok('模块 id 正确', record.id === '@local/open-with-default-app', String(record.id));
ok('暴露 apply/inject/__test', typeof plugin.apply === 'function' && Array.isArray(plugin.inject) && plugin.__test !== undefined);
/**
 * 这条是**启动安全**回归：本插件 `immediately: true`，与内置 ui-open-in-app 同批加载。
 * 实测把 `remote` / `remote.session` 写进 inject 会让整个 client 启动卡在
 * "web boot: 1 entry did not activate"（页面直接进不去）。
 * session remote 必须靠 `ctx.get('remote.session')` 在点击时旁路取（见 sessionRemote()）。
 */
eq('inject 只有 slots/locale（加 remote 会堵死整批 client 启动）', plugin.inject, ['slots', 'locale']);

// ---------------------------------------------------------------------------
// 1. 注册契约
// ---------------------------------------------------------------------------

/** 与 client.js 里逐条写死的一致；这里硬编码期望值，避免「测试读同一份常量」的自证。 */
const EXPECTED_SLOTS = [
  // 预览头部「路径文本」的右键菜单宿主（主入口；自己挂 document 级委托监听）
  { name: 'sidebar.right.tab.document.actions', id: '@local/open-with-default-app:path-menu', order: undefined, locale: 'open-with-default-app', injected: true },
  // 预览空态（格式不支持 / 内容过大）的带字按钮
  { name: 'sidebar.right.tab.document.unpreviewable', id: '@local/open-with-default-app', order: undefined, locale: 'open-with-default-app', injected: true },
  // 页签右键菜单：一条执行行 + 一条提示条载体，两条独立 id（互不替换）
  { name: 'sidebar.right.tab.menu.item', id: '@local/open-with-default-app:menu', order: 10, locale: 'open-with-default-app', injected: true },
  { name: 'sidebar.right.tab.menu.item', id: '@local/open-with-default-app:menu-toast', order: 11, locale: 'open-with-default-app', injected: false }
];
const EXPECTED_SLOT_COUNT = EXPECTED_SLOTS.length;

/** 按槽名取注册项（条目顺序可随入口增减变化，断言不该依赖数组下标）。 */
function registrationIn(state, slotName) {
  const entry = state.registrations.find((item) => item.options.name === slotName);
  if (entry === undefined) throw new Error('slot not registered: ' + slotName);
  return entry;
}

/** 已按「右键路径为准」的取向撤掉的入口：这些槽里**不许**再出现本插件的条目。 */
const RETIRED_SLOTS = ['deliverables.file.actions', 'deliverables.review.file.actions'];

function makeContext(options) {
  /**
   * session remote 的暴露形态：
   *   get=常规 ctx.get('remote') 直接给带 session 的挂载对象；
   *   property=宽松宿主，ctx.remote 属性直读可用；
   *   dotted=ctx.get('remote.session') 命名空间服务；
   *   strict=宿主严格代理：ctx.remote 直读**抛错**（未 inject），ctx.get('remote') 只给
   *          不含 session 的挂载对象，会话必须走 remote.session 命名空间服务；
   *   strict-no-namespace=严格代理且命名空间服务尚未注册；
   *   none=都没有。
   */
  const shape = options?.shape ?? (options?.withRemote === true ? 'get' : 'none');
  const state = {
    registrations: [],
    dictionaries: [],
    effects: [],
    warnings: []
  };
  const sessionCalls = [];
  const remote = {
    session: {
      openWorkspacePath(request) {
        sessionCalls.push(request);
        return Promise.resolve({ ok: true, value: { opened: true } });
      }
    }
  };
  /**
   * 宿主「remote 挂载对象」的真实形态（0.2.0-rc.2 隔离实例实测）：
   * `ctx.get('remote')` 只给挂载 API，**没有** session 成员；对它取 `.session` 会走服务代理并抛
   * `cannot get property "remote.session" without inject`——旧版插件正是死在这一步。
   */
  const mount = new Proxy({ $mount() {} }, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === 'session') throw new Error('cannot get property "remote.session" without inject');
      return undefined;
    }
  });
  const ctx = {
    get(name) {
      if (name === 'remote') {
        if (shape === 'get' || shape === 'dotted') return remote;
        if (shape === 'strict') return mount;
        return undefined;
      }
      if (name === 'remote.session') return shape === 'dotted' || shape === 'strict' ? remote.session : undefined;
      return undefined;
    },
    effect(fn, label) {
      state.effects.push(label);
      const dispose = fn();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    locale: {
      register(namespace, dictionaries) {
        state.dictionaries.push({ namespace, dictionaries });
        return () => {};
      },
      bind(namespace) {
        return (key, params) => {
          const entry = state.dictionaries.find((item) => item.namespace === namespace);
          const template = entry?.dictionaries?.zh?.[key] ?? key;
          if (params === undefined) return template;
          return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
        };
      }
    },
    slots: {
      inject(name, register) {
        ok('槽位 ' + name + ' 在声明后才注册（走 slots.inject）', typeof register === 'function');
        register();
      },
      register(options, component) {
        state.registrations.push({ options, component, injected: undefined });
        return () => {};
      }
    }
  };
  if (shape === 'property') ctx.remote = remote;
  if (shape === 'strict' || shape === 'strict-no-namespace') {
    Object.defineProperty(ctx, 'remote', {
      get() {
        throw new Error('cannot get property "remote" without inject');
      }
    });
  }
  return { ctx, state, remote, sessionCalls };
}

// --- 1a. session remote 存在 -------------------------------------------------
{
  const { ctx, state } = makeContext({ withRemote: true });
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    plugin.apply(ctx);
  } finally {
    console.warn = originalWarn;
  }

  ok('注册了 4 条槽位条目（路径右键菜单 / 空态按钮 / 页签菜单行 + 提示条载体）', state.registrations.length === EXPECTED_SLOT_COUNT, 'got ' + state.registrations.length);
  ok('注册了 1 份词典且命名空间正确', state.dictionaries.length === 1 && state.dictionaries[0].namespace === 'open-with-default-app');
  ok('词典注册挂在 effect 上（可随生命周期撤销）', state.effects.some((label) => String(label).includes('dictionaries')));
  ok('remote 可用时不打 warn', warnings.length === 0, warnings.join(' | '));

  const actual = state.registrations.map((entry) => ({
    name: entry.options.name,
    id: entry.options.id,
    order: entry.options.order,
    locale: entry.options.locale,
    injected: typeof entry.options.inject === 'function'
  }));
  eq('槽位、id、order、locale 与契约完全一致', actual, EXPECTED_SLOTS);

  // 已撤掉的入口：交付卡片 / 变更对照页的槽里不许再有本插件条目
  for (const retired of RETIRED_SLOTS) {
    ok('入口已撤：' + retired + ' 无本插件注册', !state.registrations.some((entry) => entry.options.name === retired));
  }

  const injectedProps = registrationIn(state, 'sidebar.right.tab.document.unpreviewable').options.inject();
  ok('预览槽位注入 openWithDefaultApp', typeof injectedProps.openWithDefaultApp === 'function');
  ok('路径菜单槽也注入 hostFileActions（带原因的动作面）', typeof registrationIn(state, 'sidebar.right.tab.document.actions').options.inject().hostFileActions.open === 'function');
  

  // 注入的 opener 真的会打到 session remote，且载荷只有 path
  const { sessionCalls } = makeContext({ withRemote: true });
  void sessionCalls;
}

// --- 1b. session remote 缺失 -------------------------------------------------
{
  const { ctx, state } = makeContext({ withRemote: false });
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    plugin.apply(ctx);
  } finally {
    console.warn = originalWarn;
  }
  ok('remote 缺失时仍注册 4 条（两个菜单与空态按钮都不受影响）', state.registrations.length === EXPECTED_SLOT_COUNT, 'got ' + state.registrations.length);
  ok('remote 缺失时留一条 warn', warnings.some((line) => line.includes('not resolvable yet')), warnings.join(' | '));
  const injectedWhenMissing = registrationIn(state, 'sidebar.right.tab.document.unpreviewable').options.inject();
  ok('remote 缺失也照旧注入 opener（按钮不许消失）', typeof injectedWhenMissing.openWithDefaultApp === 'function');
  ok('此时点击会如实失败（不静默）', (await injectedWhenMissing.openWithDefaultApp('X')) === false);
  ok('路径菜单槽同样注入', typeof registrationIn(state, 'sidebar.right.tab.document.actions').options.inject().openWithDefaultApp === 'function');
}

// --- 1c. 各服务暴露形态都能解析到 session remote -----------------------------
{
  for (const shape of ['get', 'property', 'dotted', 'strict']) {
    const { ctx, state, sessionCalls } = makeContext({ shape });
    plugin.apply(ctx);
    const opener = registrationIn(state, 'sidebar.right.tab.document.unpreviewable').options.inject().openWithDefaultApp;
    const opened = await opener('D:\\Users\\a\\b.md');
    ok('形态 ' + shape + '：解析到 session remote 并打开成功', opened === true, 'opened=' + opened);
    eq('形态 ' + shape + '：请求载荷正确', sessionCalls, [{ path: 'D:\\Users\\a\\b.md' }]);
  }
}

// --- 1c-bis. 宿主严格代理：ctx.remote 直读抛错也不许把 apply 带崩 -------------
{
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  let applyThrew = null;
  const { ctx, state } = makeContext({ shape: 'strict-no-namespace' });
  try {
    plugin.apply(ctx);
  } catch (error) {
    applyThrew = error;
  } finally {
    console.warn = originalWarn;
  }
  ok(
    'ctx.remote 抛 "without inject" 时 apply 不崩（这正是 web boot FAILED 的根因回归）',
    applyThrew === null,
    applyThrew === null ? '' : String(applyThrew)
  );
  ok('严格代理下仍注册 4 条槽位', state.registrations.length === EXPECTED_SLOT_COUNT, 'got ' + state.registrations.length);
  ok('命名空间未注册时留 warn 且点击如实失败', warnings.some((line) => line.includes('not resolvable yet')) && (await registrationIn(state, 'sidebar.right.tab.document.unpreviewable').options.inject().openWithDefaultApp('X')) === false);
}

// --- 1c-ter. 回归：真实宿主的「挂载对象取 .session 必抛」形态 -----------------
{
  // 只暴露挂载对象 + 点号名命名空间服务（0.2.0-rc.2 实测形状）。
  // 旧版按 [remote 挂载对象, ctx.remote, 'remote.session'] 的顺序取 `.session`，
  // 第一步就抛 "cannot get property \"remote.session\" without inject"，
  // 于是点击必然以「打开失败」收场——本项就是那条 bug 的回归测试。
  const sessionCalls = [];
  const session = {
    openWorkspacePath(request) {
      sessionCalls.push(request);
      return Promise.resolve({ ok: true, value: { opened: true } });
    }
  };
  const mount = new Proxy({ $mount() {} }, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === 'session') throw new Error('cannot get property "remote.session" without inject');
      return undefined;
    }
  });
  const registrations = [];
  const ctx = {
    get(name) {
      if (name === 'remote') return mount;
      if (name === 'remote.session') return session;
      return undefined;
    },
    effect(fn) {
      fn();
      return () => {};
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (name, register) => register(),
      register: (options) => {
        registrations.push(options);
        return () => {};
      }
    }
  };
  Object.defineProperty(ctx, 'remote', {
    get() {
      throw new Error('cannot get property "remote" without inject');
    }
  });
  plugin.apply(ctx);
  const opener = registrations.find((options) => options.name === 'sidebar.right.tab.document.unpreviewable').inject().openWithDefaultApp;
  const opened = await opener('D:\\Users\\a\\b.md');
  ok('真实形态（挂载对象取 .session 抛错）下仍能打开成功', opened === true, 'opened=' + opened);
  eq('真实形态：请求载荷正确', sessionCalls, [{ path: 'D:\\Users\\a\\b.md' }]);
}

// --- 1d. 词典键集 -----------------------------------------------------------
{
  const t = plugin.__test;
  eq('zh 与 en 键集完全一致', Object.keys(t.zh).sort(), Object.keys(t.en).sort());
  ok('每个键都有非空译文', Object.values(t.zh).every((v) => typeof v === 'string' && v.length > 0) && Object.values(t.en).every((v) => typeof v === 'string' && v.length > 0));
  const { ctx, state } = makeContext({ withRemote: true });
  plugin.apply(ctx);
  const bound = ctx.locale.bind('open-with-default-app');
  ok('t 能插值 {name}', bound('open.tooltipNamed', { name: 'a.md' }).includes('a.md'), bound('open.tooltipNamed', { name: 'a.md' }));
  void state;
}

// --- 1d-bis. 注入样式表：只准改光标，绝不准碰布局 ---------------------------
{
  /**
   * 回归背景：这里一度注入 `width: fit-content; align-self: start; min-width: 0`，
   * 把预览头部那行路径从「撑满整行的 flex 子项」改成「内容尺寸」，绕过了宿主的收缩 +
   * 省略号机制，长路径直接溢出面板（用户看到的「整行错位」）。任何布局声明都不许再回来。
   */
  const injected = [];
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      return {
        tag,
        id: '',
        textContent: '',
        remove() {
          this.removed = true;
        }
      };
    },
    head: {
      appendChild(node) {
        injected.push(node);
      }
    }
  };
  try {
    const { ctx } = makeContext({ withRemote: true });
    plugin.apply(ctx);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  eq('注入了一张样式表', injected.length, 1);
  eq('样式表 id 固定（可按 id 定位/清理）', injected[0].id, 'open-with-default-app-path-hint');
  const css = injected[0].textContent;
  eq('样式表只含一条 cursor 声明', css, '[data-textpreview-path]{cursor:context-menu}');
  for (const forbidden of ['width', 'align-self', 'min-width', 'margin', 'padding', 'position', 'display', ':hover', 'background']) {
    ok('样式表不含布局/观感声明：' + forbidden, !css.includes(forbidden), css);
  }
  ok('样式表只命中预览头部路径（不波及其它 PathLabel）', css.includes('[data-textpreview-path]') && !css.includes('[data-path-label]'), css);
}

// --- 1e. 页签右键菜单行的路径解析（tabFilePathOf） ---------------------------
{
  const x = plugin.__test;
  eq('优先用注入的 absolutePath（页签动作槽既有契约）', x.tabFilePathOf({ absolutePath: 'D:\\a\\b.md', tab: { contentId: 'dsh-resource://file/session/s/other.md' } }), 'D:\\a\\b.md');
  eq(
    '没有 absolutePath 时走 useResource(tab.contentId)（预览正文读的同一份资源）',
    x.tabFilePathOf({
      tab: { contentId: 'dsh-resource://file/session/s/D:/a/b.md' },
      useResource: (address) => ({ value: { absolutePath: address.endsWith('b.md') ? 'D:\\a\\b.md' : 'X' } })
    }),
    'D:\\a\\b.md'
  );
  eq('useResource 抛错 → 空串（调用方据此禁用而不是崩）', x.tabFilePathOf({ tab: { contentId: 'x' }, useResource: () => { throw new Error('boom'); } }), '');
  eq('资源尚无值 → 空串', x.tabFilePathOf({ tab: { contentId: 'x' }, useResource: () => ({ value: undefined }) }), '');
  eq('不是文件资源（无 contentId）→ 空串', x.tabFilePathOf({ tab: { kind: 'guide' }, useResource: () => ({ value: { absolutePath: 'D:\\a\\b.md' } }) }), '');
  eq('props 为空 → 空串', x.tabFilePathOf(undefined), '');
  eq('absolutePath 为空串时继续走资源', x.tabFilePathOf({ absolutePath: '', tab: { contentId: 'x' }, useResource: () => ({ value: { absolutePath: 'D:\\a\\b.md' } }) }), 'D:\\a\\b.md');
  eq('资源地址 → Host 路径（Windows 盘符段保持字面）', plugin.__test.filePathFromResourceUrl('dsh-resource://file/session/s/D:/a b/README.md'), 'D:/a b/README.md');
  eq('资源地址带 query/fragment 也能解析', plugin.__test.filePathFromResourceUrl('dsh-resource://file/session/s/D:/a/b.md?line=3#x'), 'D:/a/b.md');
  eq('URL 编码段被解码', plugin.__test.filePathFromResourceUrl('dsh-resource://file/session/s/D:/a%20b/%E6%80%BB%E7%BB%93.md'), 'D:/a b/总结.md');
  eq('别的 scheme 一律不认', plugin.__test.filePathFromResourceUrl('https://example.com/x.md'), '');
  eq('非字符串不认', plugin.__test.filePathFromResourceUrl(undefined), '');
  ok(
    '菜单行文案键在 zh/en 都有非空译文（两语可同词）',
    typeof x.zh['open.menu'] === 'string' && x.zh['open.menu'].length > 0 && typeof x.en['open.menu'] === 'string' && x.en['open.menu'].length > 0,
    JSON.stringify([x.zh['open.menu'], x.en['open.menu']])
  );
  ok('已撤的悬停提示文案键不再存在（提示与底色都已去掉）', x.zh['open.hint'] === undefined && x.en['open.hint'] === undefined);
}

// ---------------------------------------------------------------------------
// 2. 纯逻辑
// ---------------------------------------------------------------------------

const t = plugin.__test;

eq('fileLabelOf：Windows 路径', t.fileLabelOf('D:\\Users\\a b\\c.md'), 'c.md');
eq('fileLabelOf：POSIX 路径', t.fileLabelOf('/home/u/x/y.tar.gz'), 'y.tar.gz');
eq('fileLabelOf：尾部分隔符（目录）', t.fileLabelOf('D:\\Users\\bilibili\\'), 'bilibili');
eq('fileLabelOf：空串', t.fileLabelOf(''), '');
eq('fileLabelOf：非字符串', t.fileLabelOf(undefined), '');

const payload = t.openRequestPayload('D:\\a b\\c.md');
eq('RPC 载荷只有 path', Object.keys(payload), ['path']);
eq('RPC 载荷不改写路径（空格/反斜杠原样）', payload.path, 'D:\\a b\\c.md');
ok('RPC 载荷不带 action（不传 application 才是 OS 关联）', !('action' in payload) && !('application' in payload));

eq('translatorIn：宿主给了 t 就用它', t.translatorIn({ t: (key) => 'T:' + key })('open.button'), 'T:open.button');
eq('translatorIn：没有 t 时回显键名而不是抛错', t.translatorIn({})('open.button'), 'open.button');
eq('translatorIn：props 为 null 也不抛错', t.translatorIn(null)('open.button'), 'open.button');

// --- 信封映射：失败必须把原因交给调用方（提示条 + 控制台都用它） ------------
{
  const cases = [];
  const record = () => (reason) => cases.push(t.describeFailure(reason));
  {
    const calls = [];
    const session = {
      openWorkspacePath(request) {
        calls.push(request);
        return Promise.resolve({ ok: true, value: { opened: true } });
      }
    };
    const result = await t.requestDefaultOpen(session, 'D:\\x\\y.md', record());
    ok('ok:true → true', result === true);
    eq('调用参数就是 { path }', calls[0], { path: 'D:\\x\\y.md' });
  }
  {
    const result = await t.requestDefaultOpen(
      { openWorkspacePath: () => Promise.resolve({ ok: false, error: { code: 'gateway/bad-request', message: 'Path has no verified Host path' } }) },
      'X',
      record()
    );
    ok('ok:false → false（调用方据此提示）', result === false);
    eq(
      'ok:false 的原因被原样上报（含失败码）',
      cases[cases.length - 1],
      'gateway/bad-request: Path has no verified Host path'
    );
  }
  {
    const result = await t.requestDefaultOpen({ openWorkspacePath: () => Promise.reject(new Error('boom')) }, 'X', record());
    ok('reject → false 且不冒泡', result === false);
    eq('reject 的原因被上报', cases[cases.length - 1], 'boom');
  }
  {
    const result = await t.requestDefaultOpen({ openWorkspacePath: () => { throw new Error('sync boom'); } }, 'X', record());
    ok('同步抛错 → false 且不冒泡', result === false);
    eq('同步抛错的原因被上报', cases[cases.length - 1], 'sync boom');
  }
  {
    ok('session 缺失 → false', (await t.requestDefaultOpen(undefined, 'X', record())) === false);
    ok('session 方法缺失 → false', (await t.requestDefaultOpen({}, 'X', record())) === false);
    eq('session 缺失的原因可读', cases.slice(-2), ['session remote unavailable', 'session remote unavailable']);
  }
  {
    // 宿主真实故障形态：resolve 阶段就抛，openWithDefaultApp 直接把错误抛给组件
    const thrown = new TypeError('session.openWorkspacePath is not a function');
    const result = await t.requestDefaultOpen({ openWorkspacePath: () => Promise.reject(thrown) }, 'X', record());
    ok('抛错对象不是 RemoteError 时也能拿到 message', result === false && cases[cases.length - 1] === 'session.openWorkspacePath is not a function');
  }
}

// --- describeFailure：任何形态都必须给出非空诊断 -----------------------------
{
  eq('RemoteError 形态 → code: message', t.describeFailure({ code: 'gateway/internal', message: 'path open failed' }), 'gateway/internal: path open failed');
  eq('只有 message', t.describeFailure({ message: 'kaboom' }), 'kaboom');
  eq('只有 code', t.describeFailure({ code: 'gateway/cancelled' }), 'gateway/cancelled');
  eq('字符串原样', t.describeFailure('raw text'), 'raw text');
  ok('null 也不空', t.describeFailure(null).length > 0, t.describeFailure(null));
  ok('undefined 也不空', t.describeFailure(undefined).length > 0, t.describeFailure(undefined));
  ok('循环引用不抛错且非空', t.describeFailure({ self: null, code: undefined, message: undefined }).length > 0);
  const circular = { code: undefined, message: undefined };
  circular.self = circular;
  ok('纯循环对象兜底非空', t.describeFailure(circular).length > 0, t.describeFailure(circular));
  eq('奇数形态回落到构造名', t.describeFailure(Object.create(null)), '[object Object]');
}

// --- 单飞闸门 ---------------------------------------------------------------
{
  const gate = t.createSingleFlight();
  let starts = 0;
  let release;
  const blocking = () => {
    starts += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = gate(blocking);
  const second = gate(blocking);
  const secondResult = await second;
  ok('飞行中第二次点击被闸门挡下', secondResult === false && starts === 1, 'starts=' + starts);
  release();
  ok('第一次点击正常完成', (await first) === true);
  let secondRound = 0;
  const reopened = await gate(() => {
    secondRound += 1;
    return Promise.resolve();
  });
  ok('飞完之后可以再点', reopened === true && secondRound === 1, 'reopened=' + reopened + ' secondRound=' + secondRound);
}
{
  const gate = t.createSingleFlight();
  let ran = 0;
  await gate(() => {
    ran += 1;
    throw new Error('task boom');
  }).catch(() => {});
  await gate(() => {
    ran += 1;
  });
  ok('任务抛错也会释放闸门', ran === 2, 'ran=' + ran);
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
