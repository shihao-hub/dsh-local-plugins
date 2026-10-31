import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

/**
 * 零依赖自测：在 vm 里跑 client.js，验证
 *   - 模块 id / inject 声明；
 *   - 宽度纯函数（右栏默认 45%、300～70% clamp；左栏 264～420 clamp）；
 *   - 三种右栏启动语义：无记录 → 默认 480 并落地；有记录 → 恢复该值；auto → 不干预；
 *   - 左栏启动语义：有记录 → 恢复；无记录 / 越界记录 → 不干预；
 *   - 拖动左右分隔条后的持久化；
 *   - 通用设置行的注册规格与中英字典一致性；
 * 不依赖 React、jsdom 或宿主。
 */

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
const KEY = 'rightbar-width.width';
const SIDEBAR_KEY = 'rightbar-width.sidebar';

function createHarness() {
  const storage = new Map();
  const styleTags = [];
  const listeners = new Map();
  const changes = [];
  const calls = [];

  const col = { getBoundingClientRect: () => ({ width: 512, height: 800 }) };
  const frame = { getBoundingClientRect: () => ({ width: 1280, height: 900 }) };
  col.parentElement = frame;

  /** 左栏分隔条：宿主把 cols.sidebar 同时写在 frame 的 grid 第一段和 handle.left 上。 */
  const sidebarFrame = {
    style: { gridTemplateColumns: '360px minmax(400px, 1fr) minmax(0px, 0px)' }
  };
  const sidebarHandle = { style: { left: '360px' }, parentElement: sidebarFrame };

  const document = {
    head: {
      appendChild(node) {
        styleTags.push(node);
      }
    },
    documentElement: {},
    querySelector(selector) {
      if (selector.startsWith('style[')) return null;
      if (selector === '[data-rightbar-col]') return col;
      if (selector === '[data-side="sidebar"]') return sidebarHandle;
      return null;
    },
    createElement() {
      return {
        dataset: {},
        style: {},
        textContent: '',
        remove() {
          const index = styleTags.indexOf(this);
          if (index >= 0) styleTags.splice(index, 1);
        }
      };
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    }
  };

  const window = {
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    },
    innerWidth: 1280,
    requestAnimationFrame(fn) {
      fn();
    },
    setTimeout(fn) {
      fn();
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    dispatchEvent(event) {
      if (event && event.type === 'rightbar-width:change') changes.push(event);
      return true;
    }
  };

  let definition = null;
  const sandbox = {
    window,
    document,
    console,
    CustomEvent: class CustomEvent {
      constructor(type) {
        this.type = type;
      }
    }
  };
  window.__ModuleLoader__ = {
    load(def) {
      definition = def;
    }
  };
  vm.runInNewContext(source, sandbox, { filename: 'client.js' });

  return { window, document, storage, styleTags, listeners, changes, calls, sidebarFrame, sidebarHandle, definition };
}

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (value) => [value, () => {}],
  useEffect: () => {}
};

/**
 * 用一个给定存储值跑一次 apply，返回该实例的 layout 调用与注册表。
 * @param {object} [options]
 * @param {number|'auto'|undefined} [options.stored] - 右栏记录，undefined 表示从未设置。
 * @param {number|undefined} [options.storedSidebar] - 左栏记录。
 * @param {boolean} [options.sidebarOnly] - 模拟只暴露 setSidebar 的宿主。
 */
function bootWith(options = {}) {
  const { stored, storedSidebar, sidebarOnly = false } = options;
  const harness = createHarness();
  if (stored !== undefined) harness.window.localStorage.setItem(KEY, String(stored));
  if (storedSidebar !== undefined) harness.window.localStorage.setItem(SIDEBAR_KEY, String(storedSidebar));

  const registrations = [];
  const calls = [];
  const callsLeft = [];
  const panels = {
    setSidebar(px) {
      callsLeft.push(px);
    }
  };
  if (!sidebarOnly) {
    panels.setRightbar = (px) => {
      calls.push(px);
    };
  }
  const layout = { panels };
  const ctx = {
    get: (name) => (name === 'layout' ? layout : undefined),
    layout,
    effect(fn) {
      const off = fn();
      return typeof off === 'function' ? off : () => {};
    },
    locale: {
      register() {
        return () => {};
      },
      bind() {
        return (key) => key;
      }
    },
    slots: {
      inject(_name, fn) {
        fn();
      },
      register(spec, component) {
        registrations.push({ spec, component });
        return () => {};
      }
    }
  };

  const exported = harness.definition.factory((name) => {
    if (name === 'react') return reactStub;
    throw new Error('unexpected require: ' + name);
  });
  exported.apply(ctx);
  return { harness, exported, calls, callsLeft, registrations };
}

const base = bootWith();
const test = base.exported.__test;

assert.equal(base.harness.definition.id, '@local/rightbar-width');
assert.equal(base.exported.inject.join(','), 'slots,locale,layout');
assert.equal(test.ROW_ID, 'rightbar-width');
assert.equal(test.PLUGIN_PACKAGE, '@local/rightbar-width');
assert.equal(test.STORE_KEY, 'rightbar-width.width');
assert.equal(test.SIDEBAR_STORE_KEY, 'rightbar-width.sidebar');
assert.equal(test.PRESETS.join(','), '360,420,480,560');
assert.equal(test.SIDEBAR_PRESETS.join(','), '280,320,360,400');

// ---- geometry ------------------------------------------------------------

assert.equal(test.MIN_WIDTH, 300);
assert.equal(test.DEFAULT_WIDTH, 480);
assert.equal(test.AUTO, 'auto');
assert.equal(test.HOST_DEFAULT_RATIO, 0.45);
assert.equal(test.HOST_MAX_RATIO, 0.7);
assert.equal(test.hostDefaultWidth(1000), 450);
assert.equal(test.hostDefaultWidth(0), 300);
assert.equal(test.hostDefaultWidth(120), 300, '低于下限时仍取 300');
assert.equal(test.hostDefaultWidth(Number.NaN), 300);
assert.equal(test.clampForViewport(1000, 1000), 700, '70% 上限');
assert.equal(test.clampForViewport(200, 1000), 300, '300 下限');
assert.equal(test.clampForViewport(480, 1000), 480);
assert.equal(test.clampForViewport('abc', 1000), null);

// ---- 左栏几何：宿主 264～420 --------------------------------------------

assert.equal(test.MIN_SIDEBAR, 264);
assert.equal(test.MAX_SIDEBAR, 420);
assert.equal(test.SIDEBAR_DEFAULT, 280);
assert.equal(test.clampSidebar(100), 264, '低于 264 抬到下限');
assert.equal(test.clampSidebar(300), 300);
assert.equal(test.clampSidebar(999), 420, '高于 420 压到上限');
assert.equal(test.clampSidebar(333.6), 334, '四舍五入');
assert.equal(test.clampSidebar('abc'), null);

// ---- boot: 右栏从未配置 → 默认 480；左栏不干预 ---------------------------

assert.deepEqual(base.calls, [480], '首次启用写入默认 480');
assert.deepEqual(base.callsLeft, [], '左栏无记录时保持宿主默认 280');
assert.equal(test.readSaved(), 480, '右栏默认值随即落地，后续启动一致');
assert.equal(test.readSavedSidebar(), null, '左栏不落默认记录');
assert.ok(
  base.harness.styleTags.some((tag) => String(tag.dataset.pluginCss).includes('rightbar-width')),
  '样式已注入'
);

// ---- persistence ---------------------------------------------------------

test.clearSaved();
assert.equal(test.readSaved(), null, '空存储 → null');
assert.equal(test.writeSaved(480), true);
assert.equal(test.readSaved(), 480);
assert.equal(test.writeSaved(120), true, '写入不做几何 clamp');
assert.equal(test.readSaved(), null, '小于 300 的记录视为无效');
test.writeSaved(480);
test.clearSaved();
assert.equal(test.readSaved(), null);
assert.equal(test.writeAuto(), true);
assert.equal(test.readSaved(), 'auto', 'auto 标记表示跟随宿主');
test.clearSaved();

// 左栏：越界记录读出即 clamp，低于下限视为无效
test.clearSavedSidebar();
assert.equal(test.readSavedSidebar(), null);
assert.equal(test.writeSavedSidebar(360), true);
assert.equal(test.readSavedSidebar(), 360);
assert.equal(test.writeSavedSidebar(999), true);
assert.equal(test.readSavedSidebar(), 420, '写入超限被压到 420');
assert.equal(test.writeSavedSidebar('abc'), false, '非法值不写入');
test.clearSavedSidebar();
assert.equal(test.readSavedSidebar(), null);
base.harness.window.localStorage.setItem(SIDEBAR_KEY, '120');
assert.equal(test.readSavedSidebar(), null, '低于 264 的历史记录视为无效');
test.clearSavedSidebar();

assert.equal(test.fixedText('auto'), '');
assert.equal(test.fixedText(null), '');
assert.equal(test.fixedText(480), '480');

// ---- host safety ---------------------------------------------------------

assert.equal(test.resolvePanels(null), null);
assert.equal(test.resolvePanels({ get: () => ({}) }), null, '没有 panels 时返回 null');
const broken = {
  get: () => ({
    get panels() {
      throw new Error('cannot get property "panels"');
    }
  })
};
assert.equal(test.resolvePanels(broken), null, '读取私有字段抛错时安全降级');

const sidebarOnly = bootWith({ sidebarOnly: true });
assert.deepEqual(sidebarOnly.calls, [], '只有 setSidebar 的宿主不会尝试写右栏');
assert.equal(sidebarOnly.exported.__test.resolvePanels({ get: () => ({ panels: { setSidebar() {} } }) }) !== null, true);

// ---- boot: saved widths --------------------------------------------------

const savedBoot = bootWith({ stored: 420, storedSidebar: 360 });
assert.deepEqual(savedBoot.calls, [420], '有记录时恢复右栏宽度');
assert.deepEqual(savedBoot.callsLeft, [360], '有记录时恢复左栏宽度');

// ---- boot: auto + 左栏越界 ----------------------------------------------

const autoBoot = bootWith({ stored: 'auto' });
assert.deepEqual(autoBoot.calls, [], 'auto 时不干预，宿主自己按 45% 初始化');
assert.equal(autoBoot.harness.window.localStorage.getItem(KEY), 'auto', 'auto 标记未被改写');

const badLeftBoot = bootWith({ storedSidebar: 100 });
assert.deepEqual(badLeftBoot.callsLeft, [], '左栏记录非法时不写宿主');

// ---- settings row --------------------------------------------------------

const row = base.registrations.find((entry) => entry.spec.name === 'settings.general.item');
assert.ok(row !== undefined, 'settings.general.item 已注册');
assert.equal(row.spec.id, 'rightbar-width');
assert.equal(row.spec.order, 16, '排在 13/14/15 三条颜色行之后');
assert.equal(row.spec.locale, 'rightbar-width');
assert.equal(typeof row.component, 'function');

assert.deepEqual(Object.keys(test.zh).sort(), Object.keys(test.en).sort(), '中英字典键一致');
for (const key of ['row.title', 'row.badge', 'row.badgeTitle', 'row.description', 'left.label', 'right.label', 'left.placeholder', 'right.placeholder', 'left.reset', 'presetTitle', 'customTitle', 'unit', 'reset']) {
  assert.ok(key in test.zh, 'zh 缺少 ' + key);
}
assert.match(test.zh['row.description'], /左右/);
assert.match(test.zh['row.title'], /侧栏/);
assert.match(test.CSS, /\.rbw_group\{/);
assert.match(test.CSS, /\.rbw_row\{/);
assert.match(test.CSS, /data-plugin-setting/);

// ---- applyWidth / applySidebarWidth --------------------------------------

base.calls.length = 0;
assert.equal(test.applyWidth(640), true);
assert.deepEqual(base.calls, [640]);

base.callsLeft.length = 0;
assert.equal(test.applySidebarWidth(360), true);
assert.deepEqual(base.callsLeft, [360]);

// ---- drag persistence ----------------------------------------------------

assert.equal(test.readSaved(), null, '拖拽前无记录，最终以量到的宽度为准');

const emit = (type, event) => {
  for (const fn of (base.harness.listeners.get(type) || []).slice()) fn(event || {});
};
const pointerOn = (side) => ({ target: { closest: (selector) => (selector === `[data-side="${side}"]` ? {} : null) } });

// 右栏
emit('pointerdown', pointerOn('rightbar'));
emit('pointerup', {});
assert.equal(test.readSaved(), 512, '拖动后记住量到的渲染宽度');
assert.ok(base.harness.changes.length >= 1, '保存后广播变更事件，设置行可同步');

// 左栏：从 frame 的 grid 第一段读 360
emit('pointerdown', pointerOn('sidebar'));
emit('pointerup', {});
assert.equal(test.readSavedSidebar(), 360, '拖动左栏后记住 grid 第一段的宽度');

// 未命中任何手柄时不应改写
emit('pointerdown', { target: { closest: () => null } });
emit('pointerup', {});
assert.equal(test.readSaved(), 512);
assert.equal(test.readSavedSidebar(), 360);

// 取消拖拽不保存
base.harness.window.localStorage.setItem(KEY, '440');
base.harness.window.localStorage.setItem(SIDEBAR_KEY, '320');
emit('pointerdown', pointerOn('sidebar'));
emit('pointercancel', {});
assert.equal(test.readSavedSidebar(), 320);
emit('pointerdown', pointerOn('rightbar'));
emit('pointercancel', {});
assert.equal(test.readSaved(), 440);

// 左栏测量回退链：grid 缺失时读 handle.left，再缺失返回 0
assert.equal(test.measureSidebarWidth(), 360);
base.harness.sidebarFrame.style.gridTemplateColumns = '';
assert.equal(test.measureSidebarWidth(), 360, '回退到分隔条 left');
base.harness.sidebarHandle.style.left = '';
assert.equal(test.measureSidebarWidth(), 0, '无法测量时返回 0');
base.harness.sidebarFrame.style.gridTemplateColumns = '360px minmax(400px, 1fr) minmax(0px, 0px)';
base.harness.sidebarHandle.style.left = '360px';

// 清理函数可解除监听（不残留全局监听）
const off = test.trackDragSaves();
const before = (base.harness.listeners.get('pointerup') || []).length;
off();
assert.equal((base.harness.listeners.get('pointerup') || []).length, before - 1);

console.log('rightbar-width self-test: all assertions passed');
