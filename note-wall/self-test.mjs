/**
 * note-wall 的零依赖自测。
 *
 * 用 node:vm 执行真实 client.js（与浏览器同一份字节），只桩掉宿主提供的
 * `window.__ModuleLoader__`、React、locale/slots 服务与 localStorage。
 * 因此这里验证的是注册契约与纯逻辑，不是渲染结果。
 *
 * 运行：node self-test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));

let passed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(label);
}

function eq(actual, expected, label) {
  ok(
    actual === expected,
    label + '（期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual) + '）'
  );
}

function createStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    }
  };
}

const styleTags = [];
const captured = { module: null, effects: [] };

const sandboxWindow = {
  __ModuleLoader__: {
    load(definition) {
      captured.module = definition;
    }
  },
  localStorage: createStorage(),
  addEventListener() {},
  removeEventListener() {}
};

const sandboxDocument = {
  documentElement: { lang: 'zh-CN' },
  querySelector() {
    return null;
  },
  createElement() {
    const tag = {
      dataset: {},
      textContent: '',
      removed: false,
      remove() {
        this.removed = true;
      }
    };
    return tag;
  },
  head: {
    appendChild(tag) {
      styleTags.push(tag);
    }
  }
};

const sandbox = {
  window: sandboxWindow,
  document: sandboxDocument,
  navigator: { language: 'zh-CN' },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
};

const source = readFileSync(join(here, 'client.js'), 'utf8');
vm.runInNewContext(source, sandbox, { filename: 'client.js' });

ok(captured.module !== null, 'client.js 注册到 __ModuleLoader__');
eq(captured.module && captured.module.id, '@local/note-wall', '模块 id');

const ReactStub = {
  createElement(type, props, ...children) {
    const merged = Object.assign({}, props || {});
    if (children.length === 1) merged.children = children[0];
    else if (children.length > 1) merged.children = children;
    return { type, props: merged };
  },
  useState() {
    throw new Error('render not exercised by this test');
  },
  useEffect() {},
  useLayoutEffect() {},
  useMemo() {},
  useRef() {
    return { current: null };
  }
};

const reactRequire = (name) => {
  if (name === 'react') return ReactStub;
  throw new Error('unexpected require: ' + name);
};

const mod = captured.module.factory(reactRequire);
const test = mod.__test;

ok(typeof mod.apply === 'function', 'factory 返回 apply');
ok(Array.isArray(mod.inject), 'factory 返回 inject 数组');
eq(mod.inject.join(','), 'slots,locale', 'inject 声明 slots 与 locale');
ok(test && typeof test === 'object', '导出 __test');

const zh = test.zh;
const en = test.en;
const zhKeys = Object.keys(zh).sort();
const enKeys = Object.keys(en).sort();

eq(zhKeys.join('|'), enKeys.join('|'), '中英字典键集一致');
ok(zhKeys.length >= 40, '字典键数量充足（' + zhKeys.length + '）');

for (const key of ['panel', 'title', 'placeholder', 'emptyTitle', 'deleted', 'undo', 'saveError']) {
  ok(typeof zh[key] === 'string' && zh[key].length > 0, '中文键 ' + key + ' 有文案');
}

for (const entry of test.PALETTE) {
  ok(typeof zh['color.' + entry.id] === 'string', '中文颜色名 color.' + entry.id);
  ok(typeof en['color.' + entry.id] === 'string', '英文颜色名 color.' + entry.id);
  ok(/^#[0-9a-f]{6}$/i.test(entry.tint), '色板 tint 是十六进制 ' + entry.id);
}

eq(test.PANEL_ID, 'note-wall', '主面板 key');
eq(test.NS, 'note-wall', 'locale 命名空间');
eq(test.STORAGE_KEY, 'note-wall.v1', '存储键');
eq(test.MAX_LEN, 4000, '单条长度上限');
eq(test.MAX_NOTES, 500, '便签数量上限');

eq(test.fill('{n} 条便签', { n: 3 }), '3 条便签', 'fill 插值');
eq(test.fill('{n} 条便签'), '{n} 条便签', 'fill 无参数时保留占位');
eq(test.fill('{a}-{b}', { a: 1 }), '1-{b}', 'fill 缺参数保留占位');

const now = new Date(2026, 10, 3, 20, 0, 0).getTime();
const t = (key) => zh[key];
eq(test.timeLabel(now - 20000, now, t), '刚刚', '时间：20 秒前');
eq(test.timeLabel(now - 5 * 60000, now, t), '5 分钟前', '时间：5 分钟前');
eq(test.timeLabel(now - 3 * 3600000, now, t), '3 小时前', '时间：3 小时前');
eq(test.timeLabel(now - 26 * 3600000, now, t), '昨天', '时间：26 小时前');
eq(test.timeLabel(new Date(2026, 9, 31, 10, 0, 0).getTime(), now, t), '10 月 31 日', '时间：当年更早');
eq(
  test.timeLabel(new Date(2025, 10, 3, 10, 0, 0).getTime(), now, t),
  '2025 年 11 月 3 日',
  '时间：跨年'
);
eq(test.fullTime(new Date(2026, 0, 2, 3, 4, 0).getTime()), '2026-01-02 03:04', '绝对时间补零');

eq(test.normalizeNote(null), null, 'normalizeNote 拒绝 null');
eq(test.normalizeNote({ text: '   ' }), null, 'normalizeNote 拒绝空白');
eq(test.normalizeNote('abc'), null, 'normalizeNote 拒绝字符串');

const normalized = test.normalizeNote({
  id: 'keep',
  text: '  记一条  ',
  color: 'not-a-color',
  createdAt: 'nope',
  updatedAt: null,
  pinned: 'yes'
});
eq(normalized.text, '记一条', 'normalizeNote 去首尾空白');
eq(normalized.id, 'keep', 'normalizeNote 保留 id');
eq(normalized.color, 'amber', 'normalizeNote 非法颜色回退');
ok(Number.isFinite(normalized.createdAt), 'normalizeNote 补 createdAt');
eq(normalized.createdAt, normalized.updatedAt, 'normalizeNote 用 createdAt 补 updatedAt');
eq(normalized.pinned, false, 'normalizeNote 只认严格 true 的 pinned');

const longNote = test.normalizeNote({ text: 'a'.repeat(5000) });
eq(longNote.text.length, 4000, 'normalizeNote 截断超长文本');

const older = { id: 'a', text: 'old', color: 'amber', createdAt: 100, updatedAt: 100, pinned: false };
const newer = { id: 'b', text: 'new', color: 'mint', createdAt: 200, updatedAt: 200, pinned: false };
const pinned = { id: 'c', text: 'pin', color: 'sky', createdAt: 50, updatedAt: 50, pinned: true };

const sourceList = [older, newer, pinned];
const sorted = test.sortNotes(sourceList);
eq(sorted.map((note) => note.id).join(','), 'c,b,a', 'sortNotes 置顶优先 + 时间倒序');
eq(sourceList.map((note) => note.id).join(','), 'a,b,c', 'sortNotes 不改入参数组');

eq(test.nextColorId('amber'), 'mint', 'nextColorId 前进');
eq(test.nextColorId('lilac'), 'amber', 'nextColorId 循环回首色');
eq(test.nextColorId('unknown'), 'amber', 'nextColorId 未知值回退');

eq(test.colorEntry('rose').id, 'rose', 'colorEntry 命中');
eq(test.colorEntry('nope').id, 'amber', 'colorEntry 回退');

sandboxWindow.localStorage = createStorage();
eq(test.readNotes().length, 0, 'readNotes 空存储');

sandboxWindow.localStorage = createStorage({ 'note-wall.v1': '{not json' });
eq(test.readNotes().length, 0, 'readNotes 损坏 JSON');

sandboxWindow.localStorage = createStorage({
  'note-wall.v1': JSON.stringify({ version: 1, notes: [{ text: 'a', id: 'same' }, { text: 'b', id: 'same' }] })
});
const deduped = test.readNotes();
eq(deduped.length, 2, 'readNotes 读取两条');
ok(deduped[0].id !== deduped[1].id, 'readNotes 修正重复 id');

sandboxWindow.localStorage = createStorage({
  'note-wall.v1': JSON.stringify([{ text: 'legacy array', id: 'x' }])
});
eq(test.readNotes().length, 1, 'readNotes 兼容裸数组');

sandboxWindow.localStorage = createStorage();
const stored = test.writeNotes([older]);
eq(stored, true, 'writeNotes 成功');
const persisted = JSON.parse(sandboxWindow.localStorage.getItem('note-wall.v1'));
eq(persisted.version, 1, 'writeNotes 写入 version');
eq(persisted.notes.length, 1, 'writeNotes 写入 notes');

const noHit = test.highlighted('hello world', 'zzz');
eq(noHit, 'hello world', 'highlighter 无命中返回原文');
const hit = test.highlighted('hello world', 'world');
ok(Array.isArray(hit) && hit.length === 3, 'highlighter 命中返回三段');
eq(hit[0], 'hello ', 'highlighter 前置片段');
eq(hit[1].type, 'mark', 'highlighter 中间是 mark');
eq(hit[1].props.children, 'world', 'highlighter 命中文本');
eq(test.highlighted('Hello', ''), 'Hello', 'highlighter 空查询返回原文');

ok(typeof test.NoteWallPanel === 'function', 'NoteWallPanel 是组件');
ok(typeof test.NoteGlyph === 'function', 'NoteGlyph 是组件');
ok(typeof test.NoteCard === 'function', 'NoteCard 是组件');
ok(typeof test.Composer === 'function', 'Composer 是组件');

const speech = ReactStub.createElement('svg', { viewBox: '0 0 16 16' });
eq(speech.type, 'svg', '图标是 SVG 元素');
eq(speech.props.viewBox, '0 0 16 16', '图标 viewBox');

for (const selector of [
  '.nw_root{',
  '.nw_header{',
  '.nw_composer{',
  '.nw_grid{column-width',
  '.nw_note{',
  '.nw_editor{',
  '.nw_swatch{',
  '.nw_empty{',
  '.nw_undo{',
  '@supports (background:color-mix'
]) {
  ok(test.CSS.indexOf(selector) >= 0, '样式含 ' + selector);
}
ok(test.CSS.indexOf('var(--dsw-alias-') >= 0, '样式使用宿主主题 token');
ok(test.CSS.indexOf('prefers-reduced-motion') >= 0, '样式尊重减少动效偏好');

// ---- 注册契约 ----
const registrations = [];
const dictionaries = {};

const ctx = {
  effect(run, label) {
    const dispose = run();
    captured.effects.push({ label, dispose });
    return dispose;
  },
  locale: {
    register(ns, dicts) {
      dictionaries[ns] = dicts;
      return () => {};
    },
    bind(ns) {
      return (key) => {
        const dicts = dictionaries[ns] || {};
        const dict = dicts.zh || {};
        return dict[key] !== undefined ? dict[key] : key;
      };
    }
  },
  slots: {
    inject(ownerKey, run) {
      run();
      return () => {};
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    }
  }
};

mod.apply(ctx);

eq(styleTags.length, 1, '注入一份样式表');
eq(styleTags[0].dataset.plugin, '@local/note-wall', '样式表标记插件名');
eq(styleTags[0].dataset.pluginCss, 'note-wall-styles', '样式表标记 id');
eq(dictionaries['note-wall'] && Object.keys(dictionaries['note-wall']).join(','), 'zh,en', '注册中英字典');

const main = registrations.find((item) => item.options.name === 'main');
ok(Boolean(main), '注册 main 面板');
eq(main && main.options.key, 'note-wall', 'main 面板 key');
eq(main && main.options.locale, 'note-wall', 'main 面板 locale 命名空间');
eq(main && main.component, test.NoteWallPanel, 'main 面板组件');

const panelList = registrations.find((item) => item.options.name === 'sidebar.panellist');
ok(Boolean(panelList), '注册 sidebar.panellist 入口');
eq(panelList && panelList.options.id, 'note-wall', '侧栏入口 id 与主面板 key 对齐');
eq(panelList && panelList.options.order, 26, '侧栏入口 order');
eq(panelList && typeof panelList.options.label, 'function', '侧栏入口 label 是 thunk');
eq(panelList && panelList.options.label(), '便签', '侧栏入口中文 label');
eq(panelList && panelList.component, test.NoteGlyph, '侧栏入口图标组件');

eq(registrations.length, 2, '只注册两处座位');

// ---- 关闭 ----
console.log('\nnote-wall self-test：' + passed + ' 项通过，' + failures.length + ' 项失败');
if (failures.length > 0) {
  for (const failure of failures) console.error('  ✗ ' + failure);
  process.exitCode = 1;
} else {
  console.log('  ✓ 全部通过');
}
