import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

/**
 * 零依赖自测：在虚拟机里跑 client.js，捕获模块定义、slot 注册与右侧栏标签类型，
 * 不依赖 React、jsdom 或宿主。
 */

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
let definition;
const sandbox = {
  window: { __ModuleLoader__: { load: (def) => { definition = def; } } },
  console
};
vm.runInNewContext(source, sandbox, { filename: 'client.js' });

assert.ok(definition !== undefined, 'client 应调用 __ModuleLoader__.load');
assert.equal(definition.id, '@local/excalidraw-panel');

const registrations = [];
const tabTypes = [];
const reactStub = { createElement: () => null };
const exported = definition.factory((name) => {
  if (name === 'react') return reactStub;
  throw new Error('unexpected require: ' + name);
});

const fakeCtx = {
  effect(fn) {
    fn();
  },
  locale: {
    register() {
      return () => {};
    },
    bind() {
      return (key) => key;
    }
  },
  sidebarRightTabs: {
    register(definition) {
      tabTypes.push(definition);
      return () => {};
    }
  },
  slots: {
    inject(name, fn) {
      fn();
    },
    register(spec, component) {
      registrations.push({ spec, component });
      return () => {};
    }
  }
};

exported.apply(fakeCtx);

const slot = (name) => registrations.find((entry) => entry.spec.name === name);
const main = slot('main');
const side = slot('sidebar.panellist');
const tabBody = slot('sidebar.right.pane.tab');
const tabTitle = slot('sidebar.right.pane.tab.title');

assert.ok(main !== undefined, 'main slot 已注册');
assert.ok(side !== undefined, 'sidebar.panellist 已注册');
assert.ok(tabBody !== undefined, 'sidebar.right.pane.tab 已注册');
assert.ok(tabTitle !== undefined, 'sidebar.right.pane.tab.title 已注册');
assert.equal(main.spec.key, 'excalidraw-panel');
assert.equal(side.spec.id, 'excalidraw-panel');
assert.equal(side.spec.id, main.spec.key, '侧栏 id 与主面板 key 必须一致');
assert.equal(side.spec.order, 25, '侧栏顺序应在接口(20)与设置(30)之间');

assert.equal(tabTypes.length, 1, '应注册一个右侧栏标签类型');
assert.equal(tabTypes[0].kind, 'excalidraw');
assert.equal(tabTypes[0].keepMounted, true, '切走再回来时 iframe 不应重载');
assert.equal(tabTypes[0].guide.length, 1);
assert.equal(tabTypes[0].guide[0].order, 25);
assert.equal(tabTypes[0].id, 'excalidraw-panel');
assert.equal(tabBody.spec.key, tabTypes[0].id, 'pane.tab 的 key 与类型 id 一致');
assert.equal(tabTitle.spec.key, tabTypes[0].id, 'pane.tab.title 的 key 与类型 id 一致');

assert.equal(exported.__test.EXCALIDRAW_URL, 'https://excalidraw.cn/');
assert.deepEqual(
  Object.keys(exported.__test.zh).sort(),
  Object.keys(exported.__test.en).sort(),
  '中英字典键应完全一致'
);
assert.match(exported.__test.CSS, /\.exp_frame\{display:block;width:100%;height:100%;border:0/);
assert.match(exported.__test.CSS, /\.exp_tabBody\{position:relative/);
assert.match(exported.__test.CSS, /\.exp_overlay/);

console.log('excalidraw-panel self-test: 19 assertions passed');
