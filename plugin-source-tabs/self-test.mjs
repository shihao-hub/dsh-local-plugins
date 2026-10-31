import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

/**
 * 零依赖自测：在 vm 里跑 client.js，验证
 *   - 模块 id 与 inject 声明；
 *   - 来源分类（本地 = 以 `@local/` 开头，其余一律「下载」，只认前缀不认子串）；
 *   - 中英字典键完全对齐（分栏文案不会某语言缺一条回退成 key）。
 * 不依赖 React、jsdom 或宿主；DOM 行为由真机验收覆盖（见根 README 插件行）。
 */

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

function loadModule() {
  let captured = null;
  const context = vm.createContext({
    window: {
      __ModuleLoader__: {
        load(module) {
          captured = module;
        }
      }
    },
    console
  });
  vm.runInContext(source, context, { filename: 'client.js' });
  assert.ok(captured !== null, 'client.js 必须调用 __ModuleLoader__.load');
  return captured;
}

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log('  ok  ' + label);
}

const module = loadModule();

check('模块 id 与包名一致', () => {
  assert.equal(module.id, '@local/plugin-source-tabs');
});

const api = module.factory();

check('inject 只声明 locale（不拿激活闸门赌 remote）', () => {
  assert.deepEqual([...api.inject], ['locale']);
});

const { classify, zh, en } = api.__test;

check('本地插件按 @local/ 前缀识别', () => {
  assert.equal(classify('@local/mod-renamer'), 'local');
  assert.equal(classify('@local/plugin-source-tabs'), 'local');
});

check('下载来源（npm / GitHub）归到下载', () => {
  assert.equal(classify('a2ui-render-in-dsh'), 'downloaded');
  assert.equal(classify('argo'), 'downloaded');
  assert.equal(classify('@taxueseek/argo-dsh'), 'downloaded');
  assert.equal(classify('ds-harness-remote'), 'downloaded');
});

check('前缀判定不吃子串与相似 scope', () => {
  assert.equal(classify('foo@local/bar'), 'downloaded');
  assert.equal(classify('@localx/y'), 'downloaded');
  assert.equal(classify('@LOCAL/mod-renamer'), 'downloaded');
  assert.equal(classify(''), 'downloaded');
});

check('中英字典键完全对齐', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(zh).sort(), [
    'empty.downloaded',
    'empty.local',
    'tab.downloaded',
    'tab.local',
    'tabs.label'
  ]);
});

check('字典值都是非空字符串', () => {
  for (const table of [zh, en]) {
    for (const [key, value] of Object.entries(table)) {
      assert.equal(typeof value, 'string', key + ' 必须是字符串');
      assert.ok(value.trim().length > 0, key + ' 不能为空');
    }
  }
});

console.log('\nplugin-source-tabs self-test: ' + passed + ' 项全部通过');
