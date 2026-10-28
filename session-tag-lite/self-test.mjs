/**
 * 零依赖回归测试：只测 client.js 里可离线求值的纯逻辑
 * （存储规范化、标签读写、取色、截止文案、面板模型）。
 * DOM / React 座位交互不在这里模拟——那属于浏览器里的人工验收。
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

function memoryStorage(entries) {
  const map = new Map(Object.entries(entries || {}));
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
    read(key) {
      return map.has(key) ? map.get(key) : null;
    }
  };
}

/**
 * 在同 realm 里跑 client.js（用 new Function 把 window 遮成参数），
 * 断言不会踩跨 realm 的原型比较。工厂拿到的假 React 只有 createElement，
 * 所以 makeHook 会走 useState 退化分支——不执行任何 hook。
 */
function loadPlugin(storage, logger) {
  let definition = null;
  const fakeWindow = {
    __ModuleLoader__: {
      load(def) {
        definition = def;
      }
    },
    localStorage: storage
  };
  const run = new Function('window', 'document', 'console', source + '\n//# sourceURL=client.js');
  run(fakeWindow, undefined, logger || console);
  assert.ok(definition !== null, 'ModuleLoader.load 被调用');
  assert.equal(definition.id, '@local/session-tag-lite');
  const reactStub = { createElement: () => null };
  const api = definition.factory((name) => {
    if (name === 'react') return reactStub;
    throw new Error('未预期的 require: ' + name);
  });
  return { api, storage, test: api.__test };
}

const sessionsFixture = {
  ids: ['s1', 's2', 's3', 'blank1', 'sub1', 'gone'],
  byId: {
    s1: { id: 's1', displayTitle: 'Alpha', updatedAt: 100, running: false, blank: false },
    s2: { id: 's2', displayTitle: 'Beta 会议', updatedAt: 300, running: true, blank: false },
    s3: { id: 's3', displayTitle: 'Gamma', updatedAt: 200, running: false, blank: false },
    blank1: { id: 'blank1', displayTitle: 'New Session', updatedAt: 50, running: false, blank: true },
    sub1: {
      id: 'sub1',
      displayTitle: '子代理任务',
      updatedAt: 400,
      running: false,
      blank: false,
      origin: 'subagent'
    }
  },
  phase: 'ready',
  projectionsBySession: {}
};

const tagState = {
  tags: ['待办', '归档', '读书'],
  marks: { s1: ['待办'], s2: ['读书'], s3: ['归档', '读书'] },
  due: { s2: '2020-01-01' },
  collapsed: {}
};

/* ------------------------------------------------------------------ */

console.log('normalizeData');

test('空输入只给出保留名', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.deepEqual(t.normalizeData(null), {
    version: 1,
    tags: ['待办', '归档'],
    marks: {},
    due: {},
    collapsed: {},
    colors: {},
    options: { recentHours: 24 }
  });
  assert.deepEqual(t.normalizeData('x').tags, ['待办', '归档']);
});

test('保留名始终排在池首，且不重复', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ tags: ['工作', '待办'], marks: { s1: ['工作', '待办'] } });
  assert.deepEqual(out.tags, ['待办', '归档', '工作']);
});

test('脏标签被丢弃、超长被截断、重复去重', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const long = 'x'.repeat(40);
  const out = t.normalizeData({ tags: ['', '  ', long, long], marks: { s1: [long, '同一个', '同一个'] } });
  assert.equal(out.tags.length, 4, '待办 + 归档 + 截断后的长名 + 同一个');
  assert.equal(out.tags[2].length, 24);
  assert.deepEqual(out.marks.s1, [long.slice(0, 24), '同一个']);
});

test('marks 引用到的名字回填到池里', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ tags: [], marks: { s1: ['读书'] } });
  assert.deepEqual(out.tags, ['待办', '归档', '读书']);
});

test('空的 marks 条目被删除', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ marks: { s1: [], s2: ['待办'] } });
  assert.deepEqual(out.marks, { s2: ['待办'] });
});

test('池里已无任何会话使用的标签被清理', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ tags: ['读书', '工作'], marks: { s1: ['读书'] } });
  assert.deepEqual(out.tags, ['待办', '归档', '读书']);
});

test('due 只接受 YYYY-MM-DD', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ due: { s1: '2026-01-02', s2: 'bad', s3: '2026-1-2', s4: 20260102 } });
  assert.deepEqual(out.due, { s1: '2026-01-02' });
});

test('collapsed 只保留布尔值（false 表示显式展开）', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ collapsed: { a: true, b: false, c: 1 } });
  assert.deepEqual(out.collapsed, { a: true, b: false });
});

test('isCollapsed：未打标默认折叠，其余默认展开，显式记录优先', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.isCollapsed({ collapsed: {} }, '待办'), false);
  assert.equal(t.isCollapsed({ collapsed: {} }, t.UNTAGGED_KEY), true);
  assert.equal(
    t.isCollapsed({ collapsed: { [t.UNTAGGED_KEY]: false } }, t.UNTAGGED_KEY),
    false
  );
  assert.equal(t.isCollapsed({ collapsed: { 待办: true } }, '待办'), true);
});

console.log('loadData');

test('没有存档时给出空状态', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.deepEqual(t.loadData().tags, ['待办', '归档']);
});

test('损坏的 JSON 不抛错', () => {
  const { test: t } = loadPlugin(memoryStorage({ 'session-tag-lite.v1': '{not json' }));
  assert.deepEqual(t.loadData().tags, ['待办', '归档']);
});

test('解析存档并规范化', () => {
  const stored = JSON.stringify({
    tags: ['读书'],
    marks: { s1: ['读书'] },
    due: { s1: '2026-05-01' }
  });
  const { test: t } = loadPlugin(memoryStorage({ 'session-tag-lite.v1': stored }));
  const out = t.loadData();
  assert.deepEqual(out.tags, ['待办', '归档', '读书']);
  assert.deepEqual(out.marks, { s1: ['读书'] });
  assert.deepEqual(out.due, { s1: '2026-05-01' });
});

test('工厂初始化时就读取存档', () => {
  const stored = JSON.stringify({ tags: ['读书'], marks: { s1: ['读书'] } });
  const { api } = loadPlugin(memoryStorage({ 'session-tag-lite.v1': stored }));
  assert.deepEqual(api.__test.getData().marks, { s1: ['读书'] });
});

console.log('colorOf');

test('待办 / 归档用固定语义色', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.colorOf({}, '待办'), '#d9a441');
  assert.equal(t.colorOf({}, '归档'), '#9a9ca0');
});

test('没有显式颜色时回退哈希，且落在 7 色环里', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.colorOf({}, '读书'), t.colorOf({}, '读书'));
  for (const name of ['读书', '工作', '一个很长很长很长的标签名', 'a', '🚀']) {
    assert.ok(t.HASH_COLORS.includes(t.colorOf({}, name)), name + ' 的颜色在环里');
  }
});

test('显式颜色优先于哈希；非法颜色被忽略', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.colorOf({ colors: { 读书: '#7fc4bd' } }, '读书'), '#7fc4bd');
  assert.equal(
    t.colorOf({ colors: { 读书: 'chartreuse' } }, '读书'),
    t.colorOf({}, '读书')
  );
});

test('新建标签自动挑尚未用过的颜色', () => {
  const { test: t } = loadPlugin(memoryStorage());
  t.addSessionTag('s1', '甲');
  t.addSessionTag('s1', '乙');
  t.addSessionTag('s1', '丙');
  const used = ['甲', '乙', '丙'].map((name) => t.colorOf(t.getData(), name));
  assert.equal(new Set(used).size, 3, '三个新标签拿到三种不同颜色');
});

test('setTagColor 改色并落盘；保留名不可改', () => {
  const storage = memoryStorage();
  const { test: t } = loadPlugin(storage);
  t.addSessionTag('s1', '读书');
  t.setTagColor('读书', '#d6b88a');
  assert.equal(t.colorOf(t.getData(), '读书'), '#d6b88a');
  const saved = JSON.parse(storage.read('session-tag-lite.v1'));
  assert.equal(saved.colors['读书'], '#d6b88a');
  t.setTagColor('待办', '#d6b88a');
  assert.equal(t.colorOf(t.getData(), '待办'), '#d9a441', '保留名固定色');
});

test('colors 只保留仍在池里的合法颜色', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({
    marks: { s1: ['读书'] },
    colors: { 读书: '#7fc4bd', 孤儿: '#8fb8e0', 脏: 'chartreuse' }
  });
  assert.deepEqual(out.colors, { 读书: '#7fc4bd' });
});

console.log('读辅助');

test('tagsOf 返回副本，改不到原状态', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const names = t.tagsOf(tagState, 's3');
  names.push('污染');
  assert.deepEqual(t.tagsOf(tagState, 's3'), ['归档', '读书']);
});

test('orderedPool：保留名在前，其余字典序', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.deepEqual(t.orderedPool({ tags: ['待办', '归档', 'beta', 'alpha'] }), [
    '待办',
    '归档',
    'alpha',
    'beta'
  ]);
});

test('dueOf 缺失时给空串', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.dueOf(tagState, 's2'), '2020-01-01');
  assert.equal(t.dueOf(tagState, 's1'), '');
});

console.log('写操作');

test('addSessionTag 写入并回填池', () => {
  const { test: t } = loadPlugin(memoryStorage());
  t.addSessionTag('s1', '读书');
  assert.deepEqual(t.tagsOf(t.getData(), 's1'), ['读书']);
  assert.ok(t.getData().tags.includes('读书'));
});

test('重复添加同名标签不产生重复项', () => {
  const { test: t } = loadPlugin(memoryStorage());
  t.addSessionTag('s1', '读书');
  t.addSessionTag('s1', '读书');
  assert.deepEqual(t.tagsOf(t.getData(), 's1'), ['读书']);
});

test('名字前后空白被裁掉', () => {
  const { test: t } = loadPlugin(memoryStorage());
  t.addSessionTag('s1', '  读书  ');
  assert.deepEqual(t.tagsOf(t.getData(), 's1'), ['读书']);
});

test('移除最后一个引用后空 marks 与孤儿标签都被清理', () => {
  const { test: t } = loadPlugin(memoryStorage());
  t.addSessionTag('s1', '读书');
  t.removeSessionTag('s1', '读书');
  assert.deepEqual(t.getData().marks, {});
  assert.deepEqual(t.getData().tags, ['待办', '归档']);
});

test('保留名即使无人使用也留在池里', () => {
  const { test: t } = loadPlugin(memoryStorage());
  t.addSessionTag('s1', '待办');
  t.removeSessionTag('s1', '待办');
  assert.deepEqual(t.getData().tags, ['待办', '归档']);
});

test('toggleSessionTag 往返', () => {
  const { test: t } = loadPlugin(memoryStorage());
  t.toggleSessionTag('s1', '读书');
  assert.deepEqual(t.tagsOf(t.getData(), 's1'), ['读书']);
  t.toggleSessionTag('s1', '读书');
  assert.deepEqual(t.tagsOf(t.getData(), 's1'), []);
});

test('setDue 写入与清除', () => {
  const { test: t } = loadPlugin(memoryStorage());
  t.setDue('s1', '2026-12-31');
  assert.equal(t.dueOf(t.getData(), 's1'), '2026-12-31');
  t.setDue('s1', '');
  assert.equal(t.dueOf(t.getData(), 's1'), '');
  t.setDue('s1', '不是日期');
  assert.equal(t.dueOf(t.getData(), 's1'), '');
});

test('toggleCollapsed 往返', () => {
  const { test: t } = loadPlugin(memoryStorage());
  t.toggleCollapsed('读书');
  assert.equal(t.getData().collapsed['读书'], true);
  t.toggleCollapsed('读书');
  assert.equal(t.getData().collapsed['读书'], false);
});

test('未打标组默认折叠，点一次展开', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.isCollapsed(t.getData(), t.UNTAGGED_KEY), true);
  t.toggleCollapsed(t.UNTAGGED_KEY);
  assert.equal(t.isCollapsed(t.getData(), t.UNTAGGED_KEY), false);
});

console.log('formatDue');

test('过期判定与当年文案', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const year = new Date().getFullYear();
  const future = t.formatDue(String(year) + '-12-31');
  assert.equal(future.text, '12-31 截止');
  assert.equal(future.overdue, false);
});

test('跨年文案带年份，过去日期标过期', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const past = t.formatDue('2020-01-01');
  assert.equal(past.text, '2020-01-01 截止');
  assert.equal(past.overdue, true);
});

test('非法日期返回 null', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.formatDue('2026-1-1'), null);
  assert.equal(t.formatDue(''), null);
});

console.log('relativeTime');

test('分桶：刚刚 / 分钟 / 小时 / 天 / 月 / 年', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const at = (ms) => now - ms;
  assert.deepEqual(t.relativeTime(at(5000), now), { unit: 'now', n: 0 });
  assert.deepEqual(t.relativeTime(at(5 * 60 * 1000), now), { unit: 'minutes', n: 5 });
  assert.deepEqual(t.relativeTime(at(3 * 3600 * 1000), now), { unit: 'hours', n: 3 });
  assert.deepEqual(t.relativeTime(at(8 * 24 * 3600 * 1000), now), { unit: 'days', n: 8 });
  assert.deepEqual(t.relativeTime(at(45 * 24 * 3600 * 1000), now), { unit: 'months', n: 1 });
  assert.deepEqual(t.relativeTime(at(400 * 24 * 3600 * 1000), now), { unit: 'years', n: 1 });
});

test('分桶边界：差一毫秒与整点', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const now = 1_800_000_000_000;
  const at = (ms) => now - ms;
  assert.equal(t.relativeTime(at(59_999), now).unit, 'now');
  assert.deepEqual(t.relativeTime(at(60_000), now), { unit: 'minutes', n: 1 });
  assert.deepEqual(t.relativeTime(at(3_599_999), now), { unit: 'minutes', n: 59 });
  assert.deepEqual(t.relativeTime(at(3_600_000), now), { unit: 'hours', n: 1 });
  assert.deepEqual(t.relativeTime(at(86_399_999), now), { unit: 'hours', n: 23 });
  assert.deepEqual(t.relativeTime(at(86_400_000), now), { unit: 'days', n: 1 });
  assert.deepEqual(t.relativeTime(at(30 * 86_400_000), now), { unit: 'months', n: 1 });
  assert.deepEqual(t.relativeTime(at(365 * 86_400_000), now), { unit: 'years', n: 1 });
});

test('relativeLabel 文案与缺失时间戳', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const now = Date.now();
  const at = (ms) => now - ms;
  assert.equal(t.relativeLabel(at(5000), now), '刚刚');
  assert.equal(t.relativeLabel(at(5 * 60 * 1000), now), '5分钟');
  assert.equal(t.relativeLabel(at(3 * 3600 * 1000), now), '3小时');
  assert.equal(t.relativeLabel(at(8 * 24 * 3600 * 1000), now), '8天');
  assert.equal(t.relativeLabel(0, now), '');
  assert.equal(t.relativeLabel(-5, now), '');
});

console.log('buildPanelModel');

test('快照未就绪时返回 null', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.buildPanelModel(tagState, null, ''), null);
  assert.equal(t.buildPanelModel(tagState, { ids: [], byId: null }, ''), null);
});

test('跳过空白会话、子代理会话与快照里缺失的 id', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, '');
  assert.equal(model.total, 3, 'blank1 / sub1 / gone 被跳过');
  for (const group of model.groups) {
    for (const row of group.rows) {
      assert.ok(row.id === 's1' || row.id === 's2' || row.id === 's3');
    }
  }
});

test('待办 / 归档 / 自定义标签 / 未打标分组', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, '');
  assert.deepEqual(
    model.groups.map((group) => group.key),
    [t.RECENT_KEY, '待办', '归档', '读书'],
    's2 处于运行中，因此也进了「最近」分区'
  );
  const reading = model.groups.find((group) => group.name === '读书');
  assert.deepEqual(reading.rows.map((row) => row.id), ['s2', 's3'], '组内按 updatedAt 倒序');
});

test('无标签会话落入「未打标」组，保留组头始终在', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const state = { tags: ['待办', '归档'], marks: {}, due: {}, collapsed: {} };
  const model = t.buildPanelModel(state, sessionsFixture, '');
  assert.deepEqual(
    model.groups.map((group) => group.key),
    [t.RECENT_KEY, '待办', '归档', t.UNTAGGED_KEY]
  );
  assert.equal(model.groups[2].rows.length, 0, '归档空组仍保留组头，分类骨架稳定');
  assert.equal(model.groups[3].rows.length, 3);
});

test('搜索态不保留空组', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, '会议');
  assert.deepEqual(
    model.groups.map((group) => group.key),
    [t.RECENT_KEY, '读书']
  );
});

test('搜索命中标签名', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, '读书');
  const ids = [...new Set(model.groups.reduce((all, group) => all.concat(group.rows.map((row) => row.id)), []))];
  assert.deepEqual(ids.sort(), ['s2', 's3'], '同一会话可同时出现在多个标签组');
});

test('搜索命中会话标题', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, '会议');
  const reading = model.groups.find((group) => group.name === '读书');
  assert.ok(reading !== undefined, '读书组仍在');
  assert.deepEqual(reading.rows.map((row) => row.id), ['s2']);
});

test('搜索无命中时没有任何分组', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, 'zzz-not-here');
  assert.equal(model.groups.length, 0);
});

test('面板行带出截止日期与运行态', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, '');
  const reading = model.groups.find((group) => group.name === '读书');
  const row = reading.rows.find((item) => item.id === 's2');
  assert.equal(row.due, '2020-01-01');
  assert.equal(row.running, true);
});

console.log('recent（最近 N 小时）');

const recentNow = Date.now();
const recentSessionsFixture = {
  ids: ['r1', 'r2', 'r3', 'rblank'],
  byId: {
    r1: {
      id: 'r1',
      displayTitle: '刚刚聊过',
      updatedAt: recentNow - 30 * 60 * 1000,
      running: false,
      blank: false
    },
    r2: {
      id: 'r2',
      displayTitle: '三十小时前',
      updatedAt: recentNow - 30 * 3600 * 1000,
      running: false,
      blank: false
    },
    r3: {
      id: 'r3',
      displayTitle: '很旧但运行中',
      updatedAt: recentNow - 100 * 3600 * 1000,
      running: true,
      blank: false
    },
    rblank: {
      id: 'rblank',
      displayTitle: 'Blank',
      updatedAt: recentNow,
      running: false,
      blank: true
    }
  },
  phase: 'ready',
  projectionsBySession: {}
};

const staleSessionsFixture = {
  ids: ['old1'],
  byId: {
    old1: {
      id: 'old1',
      displayTitle: 'Old',
      updatedAt: recentNow - 100 * 3600 * 1000,
      running: false,
      blank: false
    }
  },
  phase: 'ready',
  projectionsBySession: {}
};

const recentState = (hours) => ({
  tags: ['待办', '归档'],
  marks: {},
  due: {},
  collapsed: {},
  colors: {},
  options: { recentHours: hours }
});

test('「最近」分区置顶：按窗口过滤，运行中的会话纳入', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(recentState(24), recentSessionsFixture, '');
  assert.equal(model.groups[0].key, t.RECENT_KEY);
  assert.equal(model.groups[0].name, '最近 24 小时');
  assert.equal(model.groups[0].icon, 'clock');
  assert.deepEqual(
    model.groups[0].rows.map((row) => row.id),
    ['r1', 'r3'],
    '30 小时前的 r2 被排除；r3 虽旧但 running，保留'
  );
});

test('窗口放大后更早的会话进入「最近」', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(recentState(48), recentSessionsFixture, '');
  assert.deepEqual(model.groups[0].rows.map((row) => row.id), ['r1', 'r2', 'r3']);
});

test('窗口内没有会话时不出现「最近」分区', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(recentState(24), staleSessionsFixture, '');
  assert.equal(
    model.groups.some((group) => group.key === t.RECENT_KEY),
    false
  );
  assert.deepEqual(
    model.groups.map((group) => group.key),
    ['待办', '归档', t.UNTAGGED_KEY]
  );
});

test('选项规范化：合法值保留，脏值回落 24', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.normalizeData({ options: { recentHours: 48 } }).options.recentHours, 48);
  assert.equal(t.normalizeData({ options: { recentHours: 1 } }).options.recentHours, 1);
  assert.equal(t.normalizeData({ options: { recentHours: 720 } }).options.recentHours, 720);
  for (const dirty of [0, 721, -5, '48', NaN, null, undefined, Infinity]) {
    assert.equal(
      t.normalizeData({ options: { recentHours: dirty } }).options.recentHours,
      24,
      String(dirty)
    );
  }
  assert.equal(t.normalizeData({}).options.recentHours, 24);
});

test('recentHoursOf：缺省 24，读取持久值，越界回落', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.recentHoursOf({}), 24);
  assert.equal(t.recentHoursOf({ options: { recentHours: 72 } }), 72);
  assert.equal(t.recentHoursOf({ options: { recentHours: 999 } }), 24);
});

test('setRecentHours 落盘；越界与非数字不产生提交', () => {
  const storage = memoryStorage();
  const { test: t } = loadPlugin(storage);
  t.setRecentHours(48);
  assert.equal(t.getData().options.recentHours, 48);
  assert.equal(JSON.parse(storage.read('session-tag-lite.v1')).options.recentHours, 48);
  const before = t.getSnapshot();
  t.setRecentHours(0);
  t.setRecentHours(721);
  t.setRecentHours('abc');
  assert.equal(t.getSnapshot(), before);
});

test('hoursLabel：整天用「天」，其余用「小时」', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.hoursLabel(6), '6 小时');
  assert.equal(t.hoursLabel(24), '24 小时');
  assert.equal(t.hoursLabel(48), '2 天');
  assert.equal(t.hoursLabel(168), '7 天');
});

console.log('store');

test('写入后订阅者收到通知，取消订阅后不再收到', () => {
  const { test: t } = loadPlugin(memoryStorage());
  let count = 0;
  const off = t.subscribe(() => {
    count += 1;
  });
  t.addSessionTag('s1', '读书');
  assert.equal(count, 1);
  off();
  t.addSessionTag('s1', '工作');
  assert.equal(count, 1);
});

test('每次提交都换新快照引用', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const first = t.getSnapshot();
  t.addSessionTag('s1', '读书');
  assert.notEqual(t.getSnapshot(), first);
});

test('localStorage 抛错时退化为内存态', () => {
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    }
  };
  const { test: t } = loadPlugin(throwing, { warn() {} });
  t.addSessionTag('s1', '读书');
  assert.deepEqual(t.tagsOf(t.getData(), 's1'), ['读书']);
});

test('写入会落到 localStorage', () => {
  const storage = memoryStorage();
  const { test: t } = loadPlugin(storage);
  t.addSessionTag('s1', '读书');
  const saved = JSON.parse(storage.read('session-tag-lite.v1'));
  assert.deepEqual(saved.marks, { s1: ['读书'] });
  assert.ok(saved.tags.includes('读书'));
});

console.log('fill');

test('占位替换', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.fill('移除「{name}」', { name: '读书' }), '移除「读书」');
  assert.equal(t.fill('{a}-{b}', { a: 1 }), '1-{b}');
});

console.log('\n' + passed + ' 项全部通过');
