/**
 * 零依赖回归测试：只测 client.js 里可离线求值的纯逻辑
 * （存储规范化 + 标签树模型）。DOM / React 座位交互不在这里模拟——
 * 那属于浏览器里的人工验收，桩出来的渲染不算验证。
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
 * 这样断言不会踩跨 realm 的原型比较。工厂拿到的假 React 只有
 * createElement，所以 makeHook 会走 useState 退化分支——不执行任何 hook。
 */
function loadPlugin(storage) {
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
  run(fakeWindow, undefined, console);
  assert.ok(definition !== null, 'ModuleLoader.load 被调用');
  assert.equal(definition.id, '@local/session-tags');
  const reactStub = { createElement: () => null };
  const api = definition.factory((name) => {
    if (name === 'react') return reactStub;
    throw new Error('未预期的 require: ' + name);
  });
  return { definition, api, storage };
}

const workspaceView = (id, title, sessionIds) => ({
  workspaceId: id,
  title,
  path: '/x/' + id,
  sessionIds,
  createdAt: '',
  updatedAt: ''
});

const sessionsFixture = {
  ids: ['s1', 's2', 's3', 'blank1', 'missing'],
  byId: {
    s1: { id: 's1', displayTitle: 'Alpha', updatedAt: 100, running: false },
    s2: { id: 's2', displayTitle: 'Beta', updatedAt: 200, running: true },
    s3: { id: 's3', displayTitle: 'Gamma', updatedAt: 300, running: false },
    blank1: { id: 'blank1', displayTitle: 'New Session', updatedAt: 1, blank: true, running: false }
  },
  phase: 'ready',
  projectionsBySession: {}
};

const workspaceFixture = {
  items: [workspaceView('w1', 'W1', ['s1', 's2', 's3', 'blank1', 'missing']), workspaceView('w2', 'W2', ['s1', 's3'])],
  archivedSessionIds: ['s3'],
  pinnedSessionIds: [],
  state: 'idle',
  phase: 'ready',
  error: null
};

const tagSnapshot = {
  seeded: true,
  tags: [
    { id: 't1', name: '待办', color: 'amber', parentId: null },
    { id: 't2', name: '子标签', color: 'blue', parentId: 't1' }
  ],
  marks: { s1: ['t1'], s2: ['t1', 't2'], s3: ['gone'] }
};

const { api } = loadPlugin(memoryStorage());
const { normalizeTag, buildModel, load, PALETTE } = api.__test;

console.log('normalizeTag');

test('拒绝非对象与空 id', () => {
  assert.equal(normalizeTag(null), null);
  assert.equal(normalizeTag('x'), null);
  assert.equal(normalizeTag({}), null);
  assert.equal(normalizeTag({ id: '' }), null);
});

test('保留合法字段', () => {
  assert.deepEqual(normalizeTag({ id: 'a', name: '待办', color: 'amber', parentId: null }), {
    id: 'a',
    name: '待办',
    color: 'amber',
    parentId: null
  });
});

test('色板外的颜色回落到默认值，缺名回落到 id', () => {
  assert.deepEqual(normalizeTag({ id: 'b', color: 'chartreuse' }), { id: 'b', name: 'b', color: 'blue', parentId: null });
});

test('每个色板色都通过校验', () => {
  for (const item of PALETTE) {
    assert.equal(normalizeTag({ id: 'c', color: item.id }).color, item.id);
  }
});

console.log('load');

test('没有存档时给出空状态', () => {
  assert.deepEqual(loadPlugin(memoryStorage()).api.__test.load(), { seeded: false, tags: [], marks: {} });
});

test('解析存档并丢掉空标签列表', () => {
  const stored = JSON.stringify({
    seeded: true,
    tags: [{ id: 'x', name: 'X', color: 'red', parentId: null }],
    marks: { s1: ['x'], s2: [] }
  });
  const state = loadPlugin(memoryStorage({ 'session-tags.v1': stored })).api.__test.load();
  assert.equal(state.seeded, true);
  assert.equal(state.tags.length, 1);
  assert.deepEqual(state.marks, { s1: ['x'] });
});

test('损坏的 JSON 不抛错', () => {
  assert.deepEqual(loadPlugin(memoryStorage({ 'session-tags.v1': '{not json' })).api.__test.load(), {
    seeded: false,
    tags: [],
    marks: {}
  });
});

test('工厂初始化时就读取存档', () => {
  const stored = JSON.stringify({ seeded: true, tags: [{ id: 'x', name: 'X' }], marks: {} });
  const plugin = loadPlugin(memoryStorage({ 'session-tags.v1': stored }));
  assert.equal(plugin.api.__test.load().tags[0].id, 'x');
});

console.log('buildModel');

test('快照未就绪时返回 null', () => {
  assert.equal(buildModel(tagSnapshot, null, sessionsFixture, ''), null);
  assert.equal(buildModel(tagSnapshot, workspaceFixture, null, ''), null);
  assert.equal(buildModel(tagSnapshot, { items: null }, sessionsFixture, ''), null);
  assert.equal(buildModel(tagSnapshot, workspaceFixture, { ids: [], byId: null }, ''), null);
});

test('跳过空白会话与快照里缺失的 id，并按 id 去重', () => {
  const model = buildModel(tagSnapshot, workspaceFixture, sessionsFixture, '');
  assert.equal(model.totalSessions, 3, 'blank1 与 missing 被跳过，s1 跨工作区只算一次');
});

test('按标签归组，已删除标签的 id 被过滤进未打标', () => {
  const model = buildModel(tagSnapshot, workspaceFixture, sessionsFixture, '');
  const t1 = model.byTag.get('t1');
  assert.equal(t1.length, 2);
  assert.deepEqual(
    t1.map((row) => row.id),
    ['s1', 's2']
  );
  assert.equal(model.byTag.get('t2').length, 1, 's2 同时挂在父子两个标签下');
  assert.deepEqual(
    model.untagged.map((row) => row.id),
    ['s3'],
    's3 只挂了一个已不存在的标签'
  );
  assert.equal(model.taggedSessions, 2);
});

test('归档标记来自 workspace 快照', () => {
  const model = buildModel(tagSnapshot, workspaceFixture, sessionsFixture, '');
  const all = model.untagged.concat(model.byTag.get('t1'));
  const byId = new Map(all.map((row) => [row.id, row]));
  assert.equal(byId.get('s3').archived, true);
  assert.equal(byId.get('s1').archived, false);
});

test('工作区标题、运行态、更新时间随行带出', () => {
  const model = buildModel(tagSnapshot, workspaceFixture, sessionsFixture, '');
  const s2 = model.byTag.get('t1').find((row) => row.id === 's2');
  assert.equal(s2.workspaceTitle, 'W1', '归属以首次出现的工作区为准');
  assert.equal(s2.running, true);
  assert.equal(s2.updatedAt, 200);
});

test('标题筛选忽略大小写与首尾空白，并同步收缩未打标桶', () => {
  const model = buildModel(tagSnapshot, workspaceFixture, sessionsFixture, '  BETA ');
  assert.equal(model.totalSessions, 1);
  assert.deepEqual(
    model.byTag.get('t1').map((row) => row.id),
    ['s2']
  );
  assert.equal(model.untagged.length, 0);
});

test('顶级标签只留无父级的，子标签从 childrenOf 取', () => {
  const model = buildModel(tagSnapshot, workspaceFixture, sessionsFixture, '');
  assert.deepEqual(
    model.roots.map((tag) => tag.id),
    ['t1']
  );
  assert.deepEqual(
    model.childrenOf('t1').map((tag) => tag.id),
    ['t2']
  );
});

test('父标签已消失的标签升格为顶级（删父不丢子树）', () => {
  const orphan = {
    seeded: true,
    tags: [
      { id: 't1', name: '父', color: 'amber', parentId: null },
      { id: 't2', name: '孤儿子', color: 'blue', parentId: 'ghost' }
    ],
    marks: {}
  };
  const model = buildModel(orphan, workspaceFixture, sessionsFixture, '');
  assert.deepEqual(
    model.roots.map((tag) => tag.id),
    ['t1', 't2']
  );
});

test('会话同时挂多个标签时在每个标签下各出现一次', () => {
  const model = buildModel(tagSnapshot, workspaceFixture, sessionsFixture, '');
  assert.deepEqual(
    model.byTag.get('t1').map((row) => row.id),
    ['s1', 's2']
  );
  assert.deepEqual(
    model.byTag.get('t2').map((row) => row.id),
    ['s2']
  );
});

console.log('左栏模式');

test('默认接管标签树', () => {
  assert.equal(loadPlugin(memoryStorage()).api.__test.readSidebarMode(), 'tags');
});

test('非法值回落到标签树', () => {
  assert.equal(loadPlugin(memoryStorage({ 'session-tags.sidebar.mode.v2': 'nonsense' })).api.__test.readSidebarMode(), 'tags');
});

test('存档的 native 被忽略（模式不再持久化）', () => {
  const plugin = loadPlugin(memoryStorage({ 'session-tags.sidebar.mode.v2': 'native' }));
  assert.equal(plugin.api.__test.readSidebarMode(), 'tags');
  assert.equal(plugin.storage.read('session-tags.sidebar.mode.v2'), null, '残留键会被主动清掉');
});

test('切换只在本次会话生效，不落盘', () => {
  const plugin = loadPlugin(memoryStorage());
  assert.equal(plugin.api.__test.getSidebarMode(), 'tags');
  plugin.api.__test.writeSidebarMode('native');
  assert.equal(plugin.api.__test.getSidebarMode(), 'native');
  assert.equal(plugin.storage.read('session-tags.sidebar.mode.v2'), null, '不能把 native 记住');
  plugin.api.__test.writeSidebarMode('tags');
  assert.equal(plugin.api.__test.getSidebarMode(), 'tags');
});

console.log('插件契约');

test('inject 覆盖 apply 里 touch 的服务，__test 暴露纯函数', () => {
  for (const key of ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'sidebarRight', 'sidebarRightTabs']) {
    assert.ok(api.inject.includes(key), 'inject 缺少 ' + key);
  }
  assert.equal(typeof api.apply, 'function');
  for (const key of ['load', 'normalizeTag', 'buildModel', 'colorOf', 'readSidebarMode']) {
    assert.equal(typeof api.__test[key], 'function');
  }
});

test('色板 id 与颜色唯一且格式正确', () => {
  const ids = new Set();
  for (const item of PALETTE) {
    assert.equal(ids.has(item.id), false, '重复的色板 id: ' + item.id);
    ids.add(item.id);
    assert.match(item.color, /^#[0-9a-f]{6}$/i);
  }
});

console.log('\n' + passed + ' 项通过');
