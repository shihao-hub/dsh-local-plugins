/**
 * 零依赖回归测试：只测 client.js 里可离线求值的纯逻辑
 * （标题定位、双击判定、编辑框几何、草稿规范、错误文案、服务回退、注册契约）。
 * DOM / React 座位交互在 dom-test.mjs（需 jsdom + react），浏览器人工验收另计。
 *
 *   node self-test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'client.js'), 'utf8');

let passed = 0;
function test(name, run) {
  run();
  passed += 1;
  console.log('  ok  ' + name);
}

// ---------------------------------------------------------------------------
// 极简 DOM 桩：只实现 client.js 真正用到的成员（children / parentElement /
// closest / querySelector / contains / style），避免为一个插件引入 jsdom。
// ---------------------------------------------------------------------------

function element(tagName, attributes = {}, children = []) {
  const node = {
    tagName,
    children,
    parentElement: null,
    attributes: { ...attributes },
    style: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    getAttribute(name) {
      return name in this.attributes ? this.attributes[name] : null;
    },
    closest(selector) {
      const match = /^\[data-slot="(.+)"\]$/.exec(selector);
      if (!match) return null;
      let cursor = this;
      while (cursor) {
        if (cursor.attributes && cursor.attributes['data-slot'] === match[1]) return cursor;
        cursor = cursor.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      if (selector !== 'nav') return null;
      return findTag(this, 'NAV');
    },
    contains(other) {
      let cursor = other;
      while (cursor) {
        if (cursor === this) return true;
        cursor = cursor.parentElement;
      }
      return false;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 20 };
    },
    get lastElementChild() {
      return this.children.length === 0 ? null : this.children[this.children.length - 1];
    }
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function findTag(root, tagName) {
  const queue = [...root.children];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node.tagName === tagName) return node;
    queue.push(...node.children);
  }
  return null;
}

/** 还原宿主真实结构：titleCluster > (nav, headerActions > [data-slot] > 本插件按钮)。 */
function headerFixture(options = {}) {
  const ancestry = options.ancestry === undefined ? 'single' : options.ancestry;
  const withLineage = options.lineage === true;

  const titleSpan = element('SPAN', { class: 'crumb crumbCurrent' });
  const lineageSlot = element('DIV', { 'data-slot': 'conversation.session.header.lineage' });
  let segmentChildren;
  if (ancestry === 'empty') {
    // ancestry 为空：宿主把会话 id 直接渲染成 nav 的子 span
    segmentChildren = null;
  } else if (ancestry === 'multi') {
    segmentChildren = withLineage ? [element('SPAN', { class: 'crumbSep' }), titleSpan, lineageSlot] : [element('SPAN', { class: 'crumbSep' }), titleSpan];
  } else {
    segmentChildren = withLineage ? [titleSpan, lineageSlot] : [titleSpan];
  }

  const segment = element('SPAN', { class: 'crumbSeg' }, segmentChildren ?? []);
  const nav = element('NAV', {}, ancestry === 'empty' ? [titleSpan] : [segment]);
  const button = element('BUTTON');
  const slotRoot = element('DIV', { 'data-slot': 'conversation.session.header.actions' }, [button]);
  const headerActions = element('DIV', { class: 'headerActions' }, [slotRoot]);
  element('DIV', { class: 'titleCluster' }, [nav, headerActions]);
  return { nav, button, titleSpan, segment, slotRoot };
}

// ---------------------------------------------------------------------------
// 装载 client.js
// ---------------------------------------------------------------------------

function loadPlugin() {
  let definition = null;
  const fakeWindow = {
    __ModuleLoader__: {
      load(value) {
        definition = value;
      }
    }
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'console', source + '\n//# sourceURL=client.js')(fakeWindow, undefined, console);
  assert.ok(definition !== null, 'ModuleLoader.load 被调用');
  assert.equal(definition.id, '@local/session-title-edit');

  const reactStub = {
    createElement: () => null,
    Fragment: Symbol('Fragment'),
    useCallback: (fn) => fn,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: () => ({ current: null }),
    useState: (value) => [value, () => {}]
  };
  const api = definition.factory((name) => {
    if (name === 'react') return reactStub;
    throw new Error('未预期的 require: ' + name);
  });
  return { api, definition };
}

const { api } = loadPlugin();
const testApi = api.__test;

// ---------------------------------------------------------------------------
// 1. 标题定位
// ---------------------------------------------------------------------------

console.log('resolveTitleElement');

test('单级面包屑取标题 span', () => {
  const { nav, titleSpan } = headerFixture();
  assert.equal(testApi.resolveTitleElement(nav), titleSpan);
});

test('多级面包屑跳过 "/" 分隔符，取当前段标题', () => {
  const { nav, titleSpan } = headerFixture({ ancestry: 'multi' });
  assert.equal(testApi.resolveTitleElement(nav), titleSpan);
});

test('lineage 槽（DIV）不参与标题候选', () => {
  const { nav, titleSpan } = headerFixture({ ancestry: 'multi', lineage: true });
  assert.equal(testApi.resolveTitleElement(nav), titleSpan);
});

test('ancestry 为空时返回 nav 自己的 span', () => {
  const { nav, titleSpan } = headerFixture({ ancestry: 'empty' });
  assert.equal(testApi.resolveTitleElement(nav), titleSpan);
});

test('nav 为空 / 无子元素时返回 null', () => {
  assert.equal(testApi.resolveTitleElement(null), null);
  assert.equal(testApi.resolveTitleElement(element('NAV')), null);
});

console.log('resolveHeaderParts');

test('从槽内按钮向上找到 nav（跨 headerActions 一层）', () => {
  const { button, nav } = headerFixture();
  assert.equal(testApi.resolveHeaderParts(button).nav, nav);
});

test('节点不在槽内时返回 null', () => {
  assert.equal(testApi.resolveHeaderParts(element('BUTTON')), null);
  assert.equal(testApi.resolveHeaderParts(null), null);
});

// ---------------------------------------------------------------------------
// 2. 双击判定
// ---------------------------------------------------------------------------

console.log('isTitleDoubleClickTarget');

test('双击标题本体命中', () => {
  const { nav, titleSpan } = headerFixture({ ancestry: 'multi', lineage: true });
  assert.equal(testApi.isTitleDoubleClickTarget(nav, titleSpan), true);
});

test('双击标题内部节点命中', () => {
  const { nav, titleSpan } = headerFixture();
  const inner = element('EM');
  inner.parentElement = titleSpan;
  assert.equal(testApi.isTitleDoubleClickTarget(nav, inner), true);
});

test('双击祖先面包屑不命中', () => {
  const { nav, segment } = headerFixture({ ancestry: 'multi' });
  const ancestorButton = element('BUTTON');
  ancestorButton.parentElement = segment;
  assert.equal(testApi.isTitleDoubleClickTarget(nav, ancestorButton), false);
});

test('双击 lineage 槽不命中', () => {
  const { nav } = headerFixture({ lineage: true });
  const lineageButton = element('BUTTON');
  lineageButton.parentElement = nav.lastElementChild.children[1];
  assert.equal(testApi.isTitleDoubleClickTarget(nav, lineageButton), false);
});

test('空目标不命中', () => {
  const { nav } = headerFixture();
  assert.equal(testApi.isTitleDoubleClickTarget(nav, null), false);
});

// ---------------------------------------------------------------------------
// 3. 编辑框几何
// ---------------------------------------------------------------------------

console.log('computeEditorBox');

test('常规标题：宽高按下限补齐', () => {
  const box = testApi.computeEditorBox({ left: 300, top: 11, width: 60, height: 20 }, { width: 1400 });
  assert.deepEqual({ ...box }, { left: 300, top: 11, width: 140, height: 28 });
});

test('长标题：宽度加上余量但不超上限', () => {
  const box = testApi.computeEditorBox({ left: 300, top: 11, width: 220, height: 28 }, { width: 1400 });
  assert.equal(box.width, 260);
});

test('超长标题收敛到 420', () => {
  const box = testApi.computeEditorBox({ left: 0, top: 0, width: 900, height: 30 }, { width: 1600 });
  assert.equal(box.width, 420);
  assert.equal(box.left, 8);
});

test('贴右缘时向左收，不越过视口', () => {
  const box = testApi.computeEditorBox({ left: 1300, top: 0, width: 200, height: 20 }, { width: 1400 });
  assert.equal(box.left, 1400 - 240 - 8);
});

test('视口极窄时仍保证左边距', () => {
  const box = testApi.computeEditorBox({ left: 30, top: 0, width: 200, height: 20 }, { width: 320 });
  assert.ok(box.left >= 8);
});

// ---------------------------------------------------------------------------
// 4. 草稿规范
// ---------------------------------------------------------------------------

console.log('normalizeDraft');

test('trim 首尾空白', () => {
  assert.equal(testApi.normalizeDraft('  hello  '), 'hello');
});

test('内部空白折叠为一个空格', () => {
  assert.equal(testApi.normalizeDraft('a \n\t b'), 'a b');
});

test('控制字符被移除', () => {
  assert.equal(testApi.normalizeDraft('a\u0000b\u200Bc'), 'abc');
});

test('纯空白 / 纯控制字符得到空串', () => {
  assert.equal(testApi.normalizeDraft('   '), '');
  assert.equal(testApi.normalizeDraft('\u0000\u0007\u200B'), '');
  assert.equal(testApi.normalizeDraft(null), '');
  assert.equal(testApi.normalizeDraft(undefined), '');
});

test('中文与常规标点原样保留', () => {
  assert.equal(testApi.normalizeDraft('  如何有意识提升记忆力？ '), '如何有意识提升记忆力？');
});

// ---------------------------------------------------------------------------
// 5. 错误文案
// ---------------------------------------------------------------------------

console.log('describeRenameFailure');

const t = (key, params) =>
  key === 'error.failed' ? '重命名失败：' + params.message : key === 'error.unavailable' ? '重命名服务不可用' : key;

test('Remote error.message 优先', () => {
  assert.equal(testApi.describeRenameFailure(t, { ok: false, error: { message: 'empty title' } }), '重命名失败：empty title');
});

test('error 只有 code 时用它', () => {
  assert.equal(testApi.describeRenameFailure(t, { ok: false, error: { code: 'SESSION_NOT_FOUND' } }), '重命名失败：SESSION_NOT_FOUND');
});

test('字符串 error 直接用', () => {
  assert.equal(testApi.describeRenameFailure(t, { ok: false, error: 'boom' }), '重命名失败：boom');
});

test('无可用信息时退回统一的“服务不可用”', () => {
  assert.equal(testApi.describeRenameFailure(t, { ok: false, error: null }), '重命名失败：重命名服务不可用');
});

// ---------------------------------------------------------------------------
// 6. 服务回退链
// ---------------------------------------------------------------------------

console.log('createRenameSession');

function ctxWith(services) {
  return {
    get(name) {
      return services[name];
    }
  };
}

test('优先走 sessions.rename 并透传参数', async () => {
  const calls = [];
  const renameSession = testApi.createRenameSession(
    ctxWith({
      sessions: {
        rename(sessionId, title) {
          calls.push([sessionId, title]);
          return Promise.resolve({ ok: true, value: { title } });
        }
      }
    })
  );
  const result = await renameSession('s1', '新名');
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['s1', '新名']]);
});

test('sessions 缺失时回退 remote.session.rename', async () => {
  const calls = [];
  const renameSession = testApi.createRenameSession(
    ctxWith({
      'remote.session': {
        rename(request) {
          calls.push(request);
          return Promise.resolve({ ok: true, value: { title: request.title } });
        }
      }
    })
  );
  const result = await renameSession('s2', '另一个名字');
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ sessionId: 's2', title: '另一个名字' }]);
});

test('两者都缺失时返回失败而不是抛出', async () => {
  const renameSession = testApi.createRenameSession(ctxWith({}));
  const result = await renameSession('s3', 'x');
  assert.equal(result.ok, false);
  assert.equal(result.error.message, 'rename service unavailable');
});

test('sessions.rename 抛异常时被就地转成失败结果', async () => {
  const renameSession = testApi.createRenameSession(
    ctxWith({
      sessions: {
        rename() {
          throw new Error('offline');
        }
      }
    })
  );
  const result = await renameSession('s4', 'x');
  assert.equal(result.ok, false);
  assert.equal(result.error.message, 'offline');
});

test('ctx.get 本身抛错时安静退回', async () => {
  const renameSession = testApi.createRenameSession({
    get() {
      throw new Error('cannot get property "sessions" without inject');
    }
  });
  const result = await renameSession('s5', 'x');
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// 7. 注册契约
// ---------------------------------------------------------------------------

console.log('apply / 注册契约');

function fakeContext() {
  const ledger = { effects: [], locale: [], slots: [], registers: [] };
  const ctx = {
    get: () => undefined,
    effect(fn, label) {
      ledger.effects.push(label);
      return fn();
    },
    locale: {
      register(namespace, dictionary) {
        ledger.locale.push({ namespace, dictionary });
        return () => {};
      }
    },
    slots: {
      inject(name, factory) {
        ledger.slots.push(name);
        return factory();
      },
      register(options, component) {
        ledger.registers.push({ options, component });
        return () => {};
      }
    }
  };
  return { ctx, ledger };
}

test('apply 注册词典、样式与 actions 槽位', () => {
  const { ctx, ledger } = fakeContext();
  api.apply(ctx);
  assert.deepEqual(ledger.locale.map((row) => row.namespace), [testApi.NS]);
  assert.deepEqual(ledger.slots, [testApi.ACTIONS_SLOT]);
  assert.equal(ledger.registers.length, 1);
  assert.equal(ledger.effects.length, 2);
});

test('注册项：id / order / locale 正确', () => {
  const { ctx, ledger } = fakeContext();
  api.apply(ctx);
  const { options, component } = ledger.registers[0];
  assert.equal(options.name, testApi.ACTIONS_SLOT);
  assert.equal(options.id, testApi.NS);
  assert.equal(options.order, testApi.ORDER);
  assert.equal(options.locale, testApi.NS);
  assert.equal(typeof component, 'function');
});

test('槽位 inject 提供 renameSession', () => {
  const { ctx, ledger } = fakeContext();
  api.apply(ctx);
  const injected = ledger.registers[0].options.inject();
  assert.equal(typeof injected.renameSession, 'function');
});

test('inject 声明只含 slots / locale（绝不能加 remote / sessions）', () => {
  assert.deepEqual([...api.inject], ['slots', 'locale']);
});

test('zh / en 字典键完全对称', () => {
  const zhKeys = Object.keys(testApi.zh).sort();
  const enKeys = Object.keys(testApi.en).sort();
  assert.deepEqual(zhKeys, enKeys);
  assert.ok(zhKeys.includes('error.empty'));
  assert.ok(zhKeys.includes('editor.label'));
});

// ---------------------------------------------------------------------------
// 8. 解耦约束（源码级）
// ---------------------------------------------------------------------------

console.log('解耦约束');

test('源码不写 data-row-key（不挂侧栏行属性）', () => {
  assert.equal(source.includes("'data-row-key'"), false);
  assert.equal(source.includes('"data-row-key"'), false);
});

test('源码不读宿主 CSS Module 类名', () => {
  assert.equal(source.includes('YDXeBa'), false);
  assert.equal(source.includes('wSkVaW'), false);
});

test('源码不 shadow conversation.session.header', () => {
  assert.equal(/register\(\s*\{[^}]*name:\s*['"]conversation\.session\.header['"]/.test(source), false);
});

// ---------------------------------------------------------------------------

console.log('\n' + passed + ' 项全部通过');
