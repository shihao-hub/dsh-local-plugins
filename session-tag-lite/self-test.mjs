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
  tags: ['待办', '存档', '读书'],
  marks: { s1: ['待办'], s2: ['读书'], s3: ['存档', '读书'] },
  due: { s2: '2020-01-01' },
  collapsed: {}
};

/* ------------------------------------------------------------------ */

console.log('normalizeData');

test('空输入只给出保留名', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.deepEqual(t.normalizeData(null), {
    version: 1,
    tags: ['待办', '存档'],
    marks: {},
    due: {},
    collapsed: {},
    colors: {},
    options: { recentHours: 24, rowAction: true, panelView: 'tree', archiveLast: true, tagOrder: null }
  });
  assert.deepEqual(t.normalizeData('x').tags, ['待办', '存档']);
});

test('保留名始终排在池首，且不重复', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ tags: ['工作', '待办'], marks: { s1: ['工作', '待办'] } });
  assert.deepEqual(out.tags, ['待办', '存档', '工作']);
});

test('脏标签被丢弃、超长被截断、重复去重', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const long = 'x'.repeat(40);
  const out = t.normalizeData({ tags: ['', '  ', long, long], marks: { s1: [long, '同一个', '同一个'] } });
  assert.equal(out.tags.length, 4, '待办 + 存档 + 截断后的长名 + 同一个');
  assert.equal(out.tags[2].length, 24);
  assert.deepEqual(out.marks.s1, [long.slice(0, 24), '同一个']);
});

test('marks 引用到的名字回填到池里', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ tags: [], marks: { s1: ['读书'] } });
  assert.deepEqual(out.tags, ['待办', '存档', '读书']);
});

test('空的 marks 条目被删除', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ marks: { s1: [], s2: ['待办'] } });
  assert.deepEqual(out.marks, { s2: ['待办'] });
});

test('池里已无任何会话使用的标签被清理', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ tags: ['读书', '工作'], marks: { s1: ['读书'] } });
  assert.deepEqual(out.tags, ['待办', '存档', '读书']);
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
  assert.deepEqual(t.loadData().tags, ['待办', '存档']);
});

test('损坏的 JSON 不抛错', () => {
  const { test: t } = loadPlugin(memoryStorage({ 'session-tag-lite.v1': '{not json' }));
  assert.deepEqual(t.loadData().tags, ['待办', '存档']);
});

test('解析存档并规范化', () => {
  const stored = JSON.stringify({
    tags: ['读书'],
    marks: { s1: ['读书'] },
    due: { s1: '2026-05-01' }
  });
  const { test: t } = loadPlugin(memoryStorage({ 'session-tag-lite.v1': stored }));
  const out = t.loadData();
  assert.deepEqual(out.tags, ['待办', '存档', '读书']);
  assert.deepEqual(out.marks, { s1: ['读书'] });
  assert.deepEqual(out.due, { s1: '2026-05-01' });
});

test('工厂初始化时就读取存档', () => {
  const stored = JSON.stringify({ tags: ['读书'], marks: { s1: ['读书'] } });
  const { api } = loadPlugin(memoryStorage({ 'session-tag-lite.v1': stored }));
  assert.deepEqual(api.__test.getData().marks, { s1: ['读书'] });
});

console.log('colorOf');

test('待办 / 存档用固定语义色', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.colorOf({}, '待办'), '#d9a441');
  assert.equal(t.colorOf({}, '存档'), '#9a9ca0');
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
  assert.deepEqual(t.tagsOf(tagState, 's3'), ['存档', '读书']);
});

test('orderedPool：保留名在前，其余字典序', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.deepEqual(t.orderedPool({ tags: ['待办', '存档', 'beta', 'alpha'] }), [
    '待办',
    '存档',
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
  assert.deepEqual(t.getData().tags, ['待办', '存档']);
});

test('保留名即使无人使用也留在池里', () => {
  const { test: t } = loadPlugin(memoryStorage());
  t.addSessionTag('s1', '待办');
  t.removeSessionTag('s1', '待办');
  assert.deepEqual(t.getData().tags, ['待办', '存档']);
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

test('待办 / 存档 / 自定义标签 / 未打标分组', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, '');
  assert.deepEqual(
    model.groups.map((group) => group.key),
    [t.RECENT_KEY, '待办', '存档', '读书'],
    's2 处于运行中，因此也进了「最近」分区'
  );
  const reading = model.groups.find((group) => group.name === '读书');
  assert.deepEqual(reading.rows.map((row) => row.id), ['s2', 's3'], '组内按 updatedAt 倒序');
});

test('无标签会话落入「未打标」组，保留组头始终在', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const state = { tags: ['待办', '存档'], marks: {}, due: {}, collapsed: {} };
  const model = t.buildPanelModel(state, sessionsFixture, '');
  assert.deepEqual(
    model.groups.map((group) => group.key),
    [t.RECENT_KEY, '待办', '存档', t.UNTAGGED_KEY]
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

console.log('宿主归档过滤');

test('宿主已归档的会话不进面板（不在最近、也不在标签组）', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, '', new Set(['s3']));
  assert.equal(model.total, 2, 's3 被归档过滤掉');
  for (const group of model.groups) {
    assert.equal(
      group.rows.some((row) => row.id === 's3'),
      false,
      group.key + ' 里不应出现已归档会话'
    );
  }
  const reading = model.groups.find((group) => group.name === '读书');
  assert.deepEqual(reading.rows.map((row) => row.id), ['s2'], '读书组只剩 s2');
});

test('归档过滤不改变未归档会话的分组与计数', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const before = t.buildPanelModel(tagState, sessionsFixture, '');
  const after = t.buildPanelModel(tagState, sessionsFixture, '', new Set(['s3']));
  const normalize = (model) =>
    model.groups.map((group) => ({
      key: group.key,
      ids: group.rows
        .map((row) => row.id)
        .filter((id) => id !== 's3')
    }));
  assert.deepEqual(normalize(after), normalize(before));
  assert.equal(
    after.groups.find((group) => group.key === '存档').rows.length,
    0,
    '归档组骨架仍在，但内容被清空'
  );
});

test('archivedIdsOf 兼容各种快照形状', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.archivedIdsOf(null).size, 0);
  assert.equal(t.archivedIdsOf(undefined).size, 0);
  assert.equal(t.archivedIdsOf({}).size, 0);
  assert.equal(t.archivedIdsOf({ archivedSessionIds: 'nope' }).size, 0);
  assert.deepEqual([...t.archivedIdsOf({ archivedSessionIds: ['a', 'b'] })], ['a', 'b']);
});

console.log('宿主归档筛选（跟随左栏「视图选项」）');

const allRows = (model) =>
  model.groups.reduce((acc, group) => acc.concat(group.rows.map((row) => row.id)), []);

test('archivedFilterOfRaw 解析宿主 viewing store，脏值回落 default', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.archivedFilterOfRaw(null), 'default');
  assert.equal(t.archivedFilterOfRaw(''), 'default');
  assert.equal(t.archivedFilterOfRaw('not json'), 'default');
  assert.equal(t.archivedFilterOfRaw('null'), 'default');
  assert.equal(t.archivedFilterOfRaw('[]'), 'default');
  assert.equal(t.archivedFilterOfRaw('{}'), 'default', '旧快照没有该字段时等同隐藏已归档');
  assert.equal(t.archivedFilterOfRaw('{"archivedFilter":"default"}'), 'default');
  assert.equal(t.archivedFilterOfRaw('{"archivedFilter":"show"}'), 'show');
  assert.equal(t.archivedFilterOfRaw('{"archivedFilter":"only"}'), 'only');
  assert.equal(t.archivedFilterOfRaw('{"archivedFilter":"bogus"}'), 'default');
});

test('archivedFilterOf 读取 dsh.workspace.view.v5 的当前筛选', () => {
  const storage = memoryStorage({
    'dsh.workspace.view.v5': '{"groupBy":"flat","archivedFilter":"only"}'
  });
  const { test: t } = loadPlugin(storage);
  assert.equal(t.HOST_VIEW_STORE_KEY, 'dsh.workspace.view.v5');
  assert.equal(t.archivedFilterOf(), 'only');
  storage.setItem('dsh.workspace.view.v5', '{"archivedFilter":"show"}');
  assert.equal(t.archivedFilterOf(), 'show');
  storage.removeItem('dsh.workspace.view.v5');
  assert.equal(t.archivedFilterOf(), 'default', '没有这个键时等同隐藏已归档');
  storage.setItem('dsh.workspace.view.v5', 'broken');
  assert.equal(t.archivedFilterOf(), 'default', '坏 JSON 不抛错');
});

test('缺省筛选行为与改动前一致：归档会话不上架', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const fallback = t.buildPanelModel(tagState, sessionsFixture, '', new Set(['s3']));
  const explicit = t.buildPanelModel(tagState, sessionsFixture, '', new Set(['s3']), new Set(), 'default');
  assert.deepEqual(allRows(explicit), allRows(fallback));
  assert.equal(fallback.total, 2);
});

test('show：归档与未归档一起出现，归档行带 archived 标记', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, '', new Set(['s3']), new Set(), 'show');
  assert.equal(model.total, 3, 's3 也上架');
  const rows = model.groups.reduce((acc, group) => acc.concat(group.rows), []);
  const archivedIds = [...new Set(rows.filter((row) => row.archived).map((row) => row.id))];
  assert.deepEqual(archivedIds, ['s3']);
  const liveIds = rows.filter((row) => !row.archived).map((row) => row.id);
  assert.equal(liveIds.indexOf('s3'), -1, '归档行只以 archived 身份出现');
  const reading = model.groups.find((group) => group.name === '读书');
  assert.deepEqual(reading.rows.map((row) => row.id), ['s2', 's3'], '标签组也含归档会话');
});

test('only：只保留归档会话，未归档一条不剩', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, '', new Set(['s3']), new Set(), 'only');
  assert.equal(model.total, 1);
  assert.deepEqual([...new Set(allRows(model))], ['s3']);
  const rows = model.groups.reduce((acc, group) => acc.concat(group.rows), []);
  assert.ok(rows.every((row) => row.archived === true));
});

test('only：没有归档会话时保留标签骨架但不留行', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, '', new Set(), new Set(), 'only');
  assert.equal(model.total, 0);
  assert.equal(allRows(model).length, 0);
  assert.deepEqual(
    model.groups.map((group) => group.key),
    ['待办', '存档'],
    '保留组骨架仍在，未打标组不出现'
  );
});

test('only：搜索只在归档集合内命中', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const model = t.buildPanelModel(tagState, sessionsFixture, '会议', new Set(['s3']), new Set(), 'only');
  assert.equal(model.groups.length, 0, 's2 未归档，不参与搜索');

  const hit = t.buildPanelModel(tagState, sessionsFixture, 'Gamma', new Set(['s3']), new Set(), 'only');
  const reading = hit.groups.find((group) => group.name === '读书');
  assert.deepEqual(reading.rows.map((row) => row.id), ['s3']);
});

test('show / only 不会把子代理、空白会话或缺失会话带上架', () => {
  const { test: t } = loadPlugin(memoryStorage());
  for (const scope of ['show', 'only']) {
    const model = t.buildPanelModel(
      tagState,
      sessionsFixture,
      '',
      new Set(['s3', 'sub1', 'blank1', 'gone']),
      new Set(),
      scope
    );
    const ids = [...new Set(allRows(model))];
    assert.equal(ids.indexOf('sub1'), -1, scope + ' 下子代理仍不上架');
    assert.equal(ids.indexOf('blank1'), -1, scope + ' 下空白草稿仍不上架');
    assert.equal(ids.indexOf('gone'), -1, scope + ' 下缺失 id 仍不上架');
    if (scope === 'only') assert.deepEqual(ids, ['s3']);
  }
});

console.log('菜单文案');

test('「…」菜单项是动词短语且不带省略号', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const label = t.menuLabel();
  assert.equal(label, '编辑标签');
  assert.equal(label.indexOf('…'), -1, '不再使用省略号');
  assert.notEqual(label, '标签', '不是孤零零的「标签」两个字');
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
  tags: ['待办', '存档'],
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
    ['待办', '存档', t.UNTAGGED_KEY]
  );
});

/* 「最近」分区横跨多个标签：行序跟随左栏槽位，同槽内仍按时间倒序。 */
function recentWithTags() {
  const now = Date.now();
  const list = {
    ids: ['a', 'b', 'c', 'd'],
    byId: {
      a: { id: 'a', displayTitle: 'A 无标签', updatedAt: now - 1000, running: false, blank: false },
      b: { id: 'b', displayTitle: 'B 待办', updatedAt: now - 2000, running: false, blank: false },
      c: { id: 'c', displayTitle: 'C 存档', updatedAt: now - 3000, running: false, blank: false },
      d: { id: 'd', displayTitle: 'D 待办', updatedAt: now - 4000, running: false, blank: false }
    },
    phase: 'ready',
    projectionsBySession: {}
  };
  return { list, now };
}

test('「最近」分区跟随槽位排序：标签优先，同槽按时间倒序', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const { list } = recentWithTags();
  const state = {
    tags: ['待办', '存档'],
    marks: { b: ['待办'], c: ['存档'], d: ['待办'] },
    due: {},
    collapsed: {},
    colors: {},
    options: { recentHours: 24, tagOrder: ['__pinned__', '待办', '__untagged__', '存档'] }
  };
  const model = t.buildPanelModel(state, list, '', new Set(), new Set());
  assert.equal(model.groups[0].key, t.RECENT_KEY);
  assert.deepEqual(model.groups[0].rows.map((row) => row.id), ['b', 'd', 'a', 'c']);
});

test('默认模式下「最近」分区把存档置底，其余按时间', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const { list } = recentWithTags();
  const state = {
    tags: ['待办', '存档'],
    marks: { c: ['存档'] },
    due: {},
    collapsed: {},
    colors: {},
    options: { recentHours: 24 }
  };
  const model = t.buildPanelModel(state, list, '', new Set(), new Set());
  assert.deepEqual(model.groups[0].rows.map((row) => row.id), ['a', 'b', 'd', 'c']);
});

test('「最近」分区里置顶行归置顶槽', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const { list } = recentWithTags();
  const state = {
    tags: ['待办', '存档'],
    marks: { b: ['待办'], c: ['存档'] },
    due: {},
    collapsed: {},
    colors: {},
    options: { recentHours: 24, tagOrder: ['__pinned__', '待办', '__untagged__', '存档'] }
  };
  const model = t.buildPanelModel(state, list, '', new Set(), new Set(['c']));
  assert.deepEqual(model.groups[0].rows.map((row) => row.id), ['c', 'b', 'a', 'd']);
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

console.log('面板视图（树形 / 标签页）');

test('panelView 缺省树形；合法值保留、脏值回落', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.normalizeData(null).options.panelView, 'tree');
  assert.equal(t.normalizeData({}).options.panelView, 'tree');
  assert.equal(t.normalizeData({ options: { panelView: 'tree' } }).options.panelView, 'tree');
  assert.equal(t.normalizeData({ options: { panelView: 'tabs' } }).options.panelView, 'tabs');
  for (const dirty of ['grid', 'Tabs', '', 1, null, undefined, {}, []]) {
    assert.equal(
      t.normalizeData({ options: { panelView: dirty } }).options.panelView,
      'tree',
      String(dirty)
    );
  }
});

test('panelViewOf：缺省树形，读取持久值，脏值回落', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.panelViewOf(null), 'tree');
  assert.equal(t.panelViewOf(undefined), 'tree');
  assert.equal(t.panelViewOf({}), 'tree');
  assert.equal(t.panelViewOf({ options: {} }), 'tree');
  assert.equal(t.panelViewOf({ options: { panelView: 'tabs' } }), 'tabs');
  assert.equal(t.panelViewOf({ options: { panelView: 'tree' } }), 'tree');
  assert.equal(t.panelViewOf({ options: { panelView: 'nope' } }), 'tree');
});

test('setPanelView 落盘、幂等、不覆盖其他选项', () => {
  const storage = memoryStorage();
  const { test: t } = loadPlugin(storage);
  t.setRecentHours(48);
  t.setRowAction(false);
  let notified = 0;
  const off = t.subscribe(function () {
    notified += 1;
  });

  t.setPanelView('tabs');
  assert.equal(t.panelViewOf(t.getData()), 'tabs');
  assert.equal(notified, 1);
  const saved = JSON.parse(storage.read(t.STORAGE_KEY));
  assert.equal(saved.options.panelView, 'tabs');
  assert.equal(saved.options.recentHours, 48, '视图切换不覆盖「最近」窗口');
  assert.equal(saved.options.rowAction, false, '视图切换不覆盖行尾开关');

  t.setPanelView('tabs');
  assert.equal(notified, 1, '同值不产生提交');

  t.setPanelView('bogus');
  assert.equal(t.panelViewOf(t.getData()), 'tree', '非法值归一为默认树形');
  assert.equal(notified, 2);

  t.setPanelView('tree');
  assert.equal(notified, 2, '归一后同值不产生提交');
  off();
});

test('视图偏好随远端恢复一起读入且不丢标签', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const restored = t.normalizeData({
    options: { recentHours: 24, panelView: 'tabs' },
    marks: { s1: ['待办'] }
  });
  assert.equal(t.panelViewOf(restored), 'tabs');
  assert.deepEqual(restored.marks.s1, ['待办'], '规范化不丢标签数据');
});

console.log('行尾标签按钮开关');

test('缺省显示；只有显式 false 才隐藏', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.rowActionVisible(t.normalizeData(null)), true);
  assert.equal(t.rowActionVisible(t.normalizeData({ options: {} })), true);
  assert.equal(t.rowActionVisible(t.normalizeData({ options: { rowAction: false } })), false);
  assert.equal(t.rowActionVisible(t.normalizeData({ options: { rowAction: true } })), true);
  assert.equal(t.rowActionVisible(t.normalizeData({ options: { rowAction: 'no' } })), true, '脏值回落显示');
  assert.equal(t.rowActionVisible(null), true);
  assert.equal(t.rowActionVisible(undefined), true);
  assert.equal(t.rowActionVisible({}), true);
});

test('setRowAction 落盘、幂等、不碰 recentHours', () => {
  const storage = memoryStorage();
  const { test: t } = loadPlugin(storage);
  t.setRecentHours(48);
  let notified = 0;
  const off = t.subscribe(function () {
    notified += 1;
  });

  t.setRowAction(false);
  assert.equal(t.rowActionVisible(t.getData()), false);
  assert.equal(notified, 1);
  const saved = JSON.parse(storage.read(t.STORAGE_KEY));
  assert.equal(saved.options.rowAction, false);
  assert.equal(saved.options.recentHours, 48, '开关不覆盖「最近」窗口');

  t.setRowAction(false);
  assert.equal(notified, 1, '同值不产生提交');

  t.setRowAction(true);
  assert.equal(t.rowActionVisible(t.getData()), true);
  assert.equal(notified, 2);
  assert.equal(JSON.parse(storage.read(t.STORAGE_KEY)).options.rowAction, true);
  off();
});

test('开关状态随远端恢复一起读入', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const restored = t.normalizeData({ options: { recentHours: 24, rowAction: false }, marks: { s1: ['待办'] } });
  assert.equal(t.rowActionVisible(restored), false);
  assert.deepEqual(restored.marks.s1, ['待办'], '规范化不丢标签数据');
});

console.log('左栏排序：默认模式（存档置底）');

test('缺省开启；只有显式 false 才关闭', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.archiveLastOn(t.normalizeData(null)), true);
  assert.equal(t.archiveLastOn(t.normalizeData({ options: {} })), true);
  assert.equal(t.archiveLastOn(t.normalizeData({ options: { archiveLast: false } })), false);
  assert.equal(t.archiveLastOn(t.normalizeData({ options: { archiveLast: true } })), true);
  assert.equal(t.archiveLastOn(t.normalizeData({ options: { archiveLast: 'no' } })), true, '脏值回落开启');
  assert.equal(t.archiveLastOn(null), true);
  assert.equal(t.archiveLastOn(undefined), true);
  assert.equal(t.archiveLastOn({}), true);
});

test('setArchiveLast 落盘、幂等、不覆盖其他选项', () => {
  const storage = memoryStorage();
  const { test: t } = loadPlugin(storage);
  t.setRecentHours(48);
  t.setRowAction(false);
  let notified = 0;
  const off = t.subscribe(function () {
    notified += 1;
  });

  t.setArchiveLast(false);
  assert.equal(t.archiveLastOn(t.getData()), false);
  assert.equal(notified, 1);
  const saved = JSON.parse(storage.read(t.STORAGE_KEY));
  assert.equal(saved.options.archiveLast, false);
  assert.equal(saved.options.recentHours, 48, '置底开关不覆盖「最近」窗口');
  assert.equal(saved.options.rowAction, false, '置底开关不覆盖行尾开关');

  t.setArchiveLast(false);
  assert.equal(notified, 1, '同值不产生提交');

  t.setArchiveLast(true);
  assert.equal(t.archiveLastOn(t.getData()), true);
  assert.equal(notified, 2);
  off();
});

console.log('左栏排序：自定义槽位');

test('tagOrderOf：缺省、空数组与非数组都表示默认模式', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.tagOrderOf(t.normalizeData(null)), null);
  assert.equal(t.tagOrderOf({ options: {} }), null);
  assert.equal(t.tagOrderOf({ options: { tagOrder: [] } }), null);
  assert.equal(t.tagOrderOf({ options: { tagOrder: 'x' } }), null);
  assert.deepEqual(t.tagOrderOf({ options: { tagOrder: ['待办'] }, tags: ['待办', '存档'] }), ['待办']);
});

test('normalizeTagOrder：只留池内标签与保留槽，去重保序并截断', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const state = { tags: ['待办', '存档', '读书'] };
  assert.deepEqual(
    t.normalizeTagOrder(['__pinned__', '读书', '读书', '不存在', '', '__untagged__'], state),
    ['__pinned__', '读书', '__untagged__']
  );
  assert.equal(t.normalizeTagOrder([], state), null);
  assert.equal(t.normalizeTagOrder('x', state), null);
  assert.equal(t.normalizeTagOrder(['不存在'], state), null);
});

test('resolveSlots：补齐置顶与未打标，新标签插到未打标之前', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const state = { tags: ['待办', '存档', '读书', '工作'] };
  assert.deepEqual(t.resolveSlots(state, ['待办', '存档']), [
    '__pinned__',
    '待办',
    '存档',
    '读书',
    '工作',
    '__untagged__'
  ]);
  assert.deepEqual(t.resolveSlots(state, ['__pinned__', '读书', '__untagged__', '存档']), [
    '__pinned__',
    '读书',
    '待办',
    '工作',
    '__untagged__',
    '存档'
  ]);
  assert.equal(t.resolveSlots(state, null), null);
});

test('defaultOrderPreset：最近 › 置顶 › 待办 › 其他标签 › 未打标 › 存档', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const preset = t.defaultOrderPreset({ tags: ['待办', '存档', '读书', '工作'] });
  assert.equal(preset[0], '__recent__');
  assert.equal(preset[1], '__pinned__');
  assert.equal(preset[2], '待办');
  assert.deepEqual(preset.slice(-2), ['__untagged__', '存档']);
  assert.deepEqual(preset.slice(3, -2).slice().sort(), ['工作', '读书'].sort());
});

test('normalizeTagOrder / resolveSlots 接受「最近」槽，但不会自动补它', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const state = { tags: ['待办', '存档'] };
  assert.deepEqual(
    t.normalizeTagOrder(['__recent__', '待办', '__untagged__'], state),
    ['__recent__', '待办', '__untagged__']
  );
  assert.equal(t.resolveSlots(state, ['待办'])[0], '__pinned__', '不自动补最近');
  assert.equal(t.resolveSlots(state, ['__recent__', '待办']).indexOf('__recent__'), 1);
});

test('slotOfSession 不会把会话归到「最近」槽', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const slots = ['__recent__', '__pinned__', '待办', '__untagged__'];
  assert.equal(t.slotOfSession('s1', ['待办'], new Set(), slots), '待办');
  assert.equal(t.slotOfSession('s2', [], new Set(), slots), '__untagged__');
});

test('orderGroups：面板分组顺序跟随槽位，最近可排到最后', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const state = {
    tags: ['待办', '存档', '读书'],
    options: { recentHours: 24, tagOrder: ['待办', '存档', '__recent__', '读书', '__untagged__'] }
  };
  const groups = [
    { key: '__recent__' },
    { key: '待办' },
    { key: '存档' },
    { key: '读书' },
    { key: '__untagged__' }
  ];
  assert.deepEqual(
    t.orderGroups(state, groups).map((group) => group.key),
    ['待办', '存档', '__recent__', '读书', '__untagged__']
  );

  /* 旧数组没有「最近」槽：保持它在最前。 */
  const legacy = { tags: ['待办'], options: { tagOrder: ['待办', '__untagged__'] } };
  assert.deepEqual(
    t.orderGroups(legacy, [{ key: '__recent__' }, { key: '待办' }, { key: '__untagged__' }]).map(
      (group) => group.key
    ),
    ['__recent__', '待办', '__untagged__']
  );
});

test('slotOfSession：置顶与标签按槽位先后竞争，未排标签归未打标', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const slots = ['__pinned__', '待办', '读书', '__untagged__', '存档'];
  assert.equal(t.slotOfSession('p1', ['读书'], new Set(['p1']), slots), '__pinned__');
  assert.equal(t.slotOfSession('s1', ['存档', '待办'], new Set(), slots), '待办');
  assert.equal(t.slotOfSession('s2', ['存档'], new Set(), slots), '存档');
  assert.equal(t.slotOfSession('s3', [], new Set(), slots), '__untagged__');
  assert.equal(t.slotOfSession('s4', ['工作'], new Set(), slots), '__untagged__');
  assert.equal(t.slotOfSession('s5', ['工作'], new Set(), null), null);

  /* 存档槽排在置顶前：置顶+存档的会话归存档区；无标签置顶仍归置顶槽。 */
  const archiveFirst = ['存档', '__pinned__', '__untagged__'];
  assert.equal(t.slotOfSession('p2', ['存档'], new Set(['p2']), archiveFirst), '存档');
  assert.equal(t.slotOfSession('p3', [], new Set(['p3']), archiveFirst), '__pinned__');
});

test('orderValueOf：空白草稿 -1，其余是槽位下标', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const slots = ['__pinned__', '待办', '__untagged__'];
  assert.equal(t.orderValueOf('blank', { blank: true }, [], new Set(), slots), -1);
  assert.equal(t.orderValueOf('p', {}, [], new Set(['p']), slots), 0);
  assert.equal(t.orderValueOf('t', {}, ['待办'], new Set(), slots), 1);
  assert.equal(t.orderValueOf('u', {}, [], new Set(), slots), 2);
});

test('inRecentWindow：运行中算最近，其余按窗口', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const now = Date.now();
  assert.equal(t.inRecentWindow(null, 24, now), false);
  assert.equal(t.inRecentWindow({ updatedAt: now - 1000 }, 24, now), true);
  assert.equal(t.inRecentWindow({ updatedAt: now - 30 * 3600 * 1000 }, 24, now), false);
  assert.equal(t.inRecentWindow({ updatedAt: now - 30 * 3600 * 1000, running: true }, 24, now), true);
  assert.equal(t.inRecentWindow({ updatedAt: 0 }, 24, now), false);
});

test('slotOfSession：最近窗口内的会话归「最近」槽，按槽位先后竞争', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const slots = ['__pinned__', '__recent__', '待办', '__untagged__', '存档'];
  assert.equal(t.slotOfSession('r1', [], new Set(), slots, true), '__recent__');
  assert.equal(t.slotOfSession('r2', ['待办'], new Set(), slots, true), '__recent__');
  assert.equal(t.slotOfSession('r3', ['待办'], new Set(), slots, false), '待办');
  assert.equal(t.slotOfSession('p1', [], new Set(['p1']), slots, true), '__pinned__');

  /* 最近排在置顶前：置顶+最近也归最近。 */
  const recentFirst = ['__recent__', '__pinned__', '__untagged__'];
  assert.equal(t.slotOfSession('p2', [], new Set(['p2']), recentFirst, true), '__recent__');
  assert.equal(t.slotOfSession('p3', [], new Set(['p3']), recentFirst, false), '__pinned__');
});

test('orderValueOf 支持 recent 参数', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const slots = ['__recent__', '__pinned__', '待办', '__untagged__'];
  assert.equal(t.orderValueOf('r', {}, [], new Set(), slots, true), 0);
  assert.equal(t.orderValueOf('u', {}, [], new Set(), slots, false), 3);
});

test('orderSummary：默认摘要与自定义链路', () => {
  const { test: t } = loadPlugin(memoryStorage());
  assert.equal(t.orderSummary(t.normalizeData(null)), '默认 · 存档置底');
  assert.equal(t.orderSummary(t.normalizeData({ options: { archiveLast: false } })), '默认 · 不排序');
  const custom = t.normalizeData({
    options: { tagOrder: ['__pinned__', '待办', '__untagged__', '存档'] }
  });
  assert.equal(t.orderSummary(custom), '置顶会话 › 待办 › 未打标 › 存档');
});

test('setTagOrder 落盘、幂等、不覆盖其他选项；resetTagOrder 回默认', () => {
  const storage = memoryStorage();
  const { test: t } = loadPlugin(storage);
  t.setRecentHours(48);
  t.setArchiveLast(false);
  let notified = 0;
  const off = t.subscribe(function () {
    notified += 1;
  });

  t.setTagOrder(['待办', '__untagged__']);
  assert.deepEqual(t.tagOrderOf(t.getData()), ['待办', '__untagged__']);
  assert.equal(notified, 1);
  const saved = JSON.parse(storage.read(t.STORAGE_KEY));
  assert.deepEqual(saved.options.tagOrder, ['待办', '__untagged__']);
  assert.equal(saved.options.recentHours, 48, '排序不覆盖「最近」窗口');
  assert.equal(saved.options.archiveLast, false, '排序不覆盖存档置底开关');

  t.setTagOrder(['待办', '__untagged__']);
  assert.equal(notified, 1, '同值不产生提交');

  t.resetTagOrder();
  assert.equal(t.tagOrderOf(t.getData()), null);
  assert.equal(notified, 2);
  assert.equal(JSON.parse(storage.read(t.STORAGE_KEY)).options.tagOrder, null);
  off();
});

test('排序数组里的孤儿标签在规范化时被丢弃', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({
    tags: ['读书'],
    marks: { s1: ['读书'] },
    options: { tagOrder: ['读书', '已删除', '待办'] }
  });
  assert.deepEqual(out.options.tagOrder, ['读书', '待办']);
});

test('旧数据没有 tagOrder 时保持 null（默认模式）', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ options: { recentHours: 24 } });
  assert.equal(out.options.tagOrder, null);
});

console.log('旧保留名迁移（归档 → 存档）');

test('旧的「归档」在池、marks、collapsed 三处都迁移成「存档」', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({
    tags: ['待办', '归档', '读书'],
    marks: { s1: ['归档'], s2: ['归档', '读书'] },
    collapsed: { 归档: true }
  });
  assert.deepEqual(out.tags, ['待办', '存档', '读书']);
  assert.deepEqual(out.marks.s1, ['存档']);
  assert.deepEqual(out.marks.s2, ['存档', '读书']);
  assert.deepEqual(out.collapsed, { 存档: true });
});

test('新旧键同时存在时以新键为准', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ collapsed: { 归档: true, 存档: false } });
  assert.deepEqual(out.collapsed, { 存档: false });
});

test('旧名已经没有任何引用时不会重新出现在池里', () => {
  const { test: t } = loadPlugin(memoryStorage());
  const out = t.normalizeData({ tags: ['归档'], marks: { s1: ['读书'] } });
  assert.deepEqual(out.tags, ['待办', '存档', '读书']);
});

test('用户输入「归档」等同输入「存档」', () => {
  const { test: t } = loadPlugin(memoryStorage());
  t.addSessionTag('s1', '归档');
  assert.deepEqual(t.tagsOf(t.getData(), 's1'), ['存档']);
  assert.deepEqual(t.getData().tags, ['待办', '存档']);
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
