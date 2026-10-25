import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

/**
 * 零依赖自测：在虚拟机里跑 client.js，捕获模块定义与 slot 注册，
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

assert.equal(registrations.length, 2, '应注册 main 与 sidebar.panellist 两项');
const main = registrations.find((entry) => entry.spec.name === 'main');
const side = registrations.find((entry) => entry.spec.name === 'sidebar.panellist');
assert.ok(main !== undefined, 'main slot 已注册');
assert.ok(side !== undefined, 'sidebar.panellist 已注册');
assert.equal(main.spec.key, 'excalidraw-panel');
assert.equal(side.spec.id, 'excalidraw-panel');
assert.equal(side.spec.id, main.spec.key, '侧栏 id 与面板 key 必须一致');
assert.equal(side.spec.order, 25, '侧栏顺序应在接口(20)与设置(30)之间');

assert.equal(exported.__test.EXCALIDRAW_URL, 'https://excalidraw.cn/');
assert.deepEqual(
  Object.keys(exported.__test.zh).sort(),
  Object.keys(exported.__test.en).sort(),
  '中英字典键应完全一致'
);
assert.match(exported.__test.CSS, /\.exp_frame\{display:block;width:100%;height:100%;border:0/);
assert.match(exported.__test.CSS, /\.exp_overlay/);

console.log('excalidraw-panel self-test: 12 assertions passed');
