/**
 * settings-button 真实 DOM 行为测试（jsdom）。
 *
 * 为什么必须存在这一份：本插件的全部行为都压在三组 DOM 合同上——
 * ① 底部设置座位 `[class$="_settingsArea"]`；② 两种入口形态（settings-general 的
 * 回退触发器 `aria-haspopup="dialog"` 与 settings-account 的账号菜单
 * `aria-haspopup="menu"`，后者惰性加载、web 端平时缺席）；③ 菜单面
 * `[data-menu-material] button[role="menuitem"]`。契约一变，「隐藏谁 / 还原谁 /
 * 点击谁」就可能悄悄错位，而这类退化的表现（底部多出一颗设置按钮、顶部新行点了
 * 没反应）只有真 DOM 才能验出来。本测试用与宿主产物同形的静态 DOM 夹具逐条断言
 * 三种形态的隐藏 / 还原 / 委托路径。
 *
 * 运行（依赖不随插件发布，需要现装）：
 *   mkdir /tmp/dsh-sb-test && cd /tmp/dsh-sb-test
 *   npm init -y && npm i jsdom@24
 *   SETTINGS_BUTTON_TEST_MODULES=/tmp/dsh-sb-test node <此文件>
 *
 * 也可直接把 jsdom 装到本插件目录后用 `node dom-test.mjs`
 * （默认就从插件目录解析依赖）。
 *
 * 输出：每条用例 ok/FAIL；全部通过退出码 0。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(HERE, 'client.js');
const MODULES_DIR = process.env.SETTINGS_BUTTON_TEST_MODULES ?? HERE;

const require = createRequire(join(MODULES_DIR, 'package.json'));
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch {
  console.error('缺少 jsdom：见本文件头部「运行」说明。');
  process.exit(2);
}

const code = readFileSync(CLIENT_PATH, 'utf8');

let failures = 0;
let checks = 0;
function ok(label, cond) {
  checks += 1;
  if (cond) console.log('  ok  ' + label);
  else {
    failures += 1;
    console.log('  FAIL ' + label);
  }
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  runScripts: 'dangerously',
  url: 'http://localhost/'
});
const { window } = dom;

const reactStub = {
  createElement: () => null,
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useState: () => [undefined, () => {}],
  Fragment: {}
};

let def;
window.__ModuleLoader__ = { load(d) { def = d; } };
window.eval(code);
const mod = def.factory(() => reactStub);
const T = mod.__test;
const doc = window.document;

const FALLBACK_HTML = `
<div id="app">
  <div class="x_settingsArea">
    <div class="x_triggerRow">
      <span class="tipWrap"><button type="button" id="fallback" class="x_trigger" aria-label="设置" aria-haspopup="dialog" aria-expanded="false">
        <svg></svg><span class="x_triggerLabel">设置</span>
      </button></span>
      <button type="button" id="conn" class="x_indicator" aria-label="重新连接">重新连接中…</button>
    </div>
  </div>
</div>`;

const ACCOUNT_HTML = `
<div id="app">
  <div class="x_settingsArea">
    <div class="x_triggerRow">
      <button type="button" id="account" class="x_accTrigger" aria-label="更多" aria-haspopup="menu" aria-expanded="false">
        <svg></svg><span class="x_label">更多</span>
      </button>
      <button type="button" id="conn" class="x_indicator" aria-label="重新连接">重新连接中…</button>
    </div>
  </div>
</div>`;

function reset(html) {
  doc.body.innerHTML = html;
}

// ---------------------------------------------------------------- Case A
console.log('Case A: web 回退触发器（无账号菜单）');
reset(FALLBACK_HTML);
const fb = doc.getElementById('fallback');
let fbClicks = 0;
fb.addEventListener('click', () => { fbClicks += 1; });

ok('isFallbackTrigger(fallback) === true', T.isFallbackTrigger(fb) === true);
ok('fallbackTrigger() 命中该按钮', T.fallbackTrigger() === fb);

T.hideFallbackTrigger();
ok('按钮被 display:none 隐藏', fb.style.display === 'none');
ok('按钮带 HIDDEN_MARK 标记', fb.getAttribute(T.HIDDEN_MARK) === 'true');
ok('同一行连接指示器未被隐藏', doc.getElementById('conn').style.display !== 'none');

ok('openNativeSettings() 返回 true', T.openNativeSettings() === true);
ok('隐藏按钮仍被编程点击一次（直接打开设置）', fbClicks === 1);

T.hideFallbackTrigger();
ok('重复 hide 幂等', fb.style.display === 'none' && fbClicks === 1);

// ---------------------------------------------------------------- Case B
console.log('Case B: 账号菜单（desktop 形态）');
reset(ACCOUNT_HTML);
let menuClicks = 0;

const account = doc.getElementById('account');
account.addEventListener('click', () => {
  // 模拟 React：点击后同步挂载菜单面（portal 到 body）
  if (doc.querySelector('[data-menu-material]') !== null) return;
  const surface = doc.createElement('div');
  surface.setAttribute('data-menu-material', '');
  surface.innerHTML = `
    <button role="menuitem" id="mi-settings"><svg></svg>设置 <kbd>Ctrl+,</kbd></button>
    <button role="menuitem" id="mi-contact">意见反馈</button>
    <button role="menuitem" id="mi-signin">登录</button>`;
  doc.body.appendChild(surface);
  doc.getElementById('mi-settings').addEventListener('click', () => { menuClicks += 1; });
});

T.hideFallbackTrigger();
ok('账号菜单形态下不隐藏任何按钮', account.style.display !== 'none');
ok('无残留 HIDDEN_MARK（旧标记已随节点移除）', doc.querySelectorAll('[' + T.HIDDEN_MARK + ']').length === 0);

T.hideAccountSettingsItem();
ok('菜单未打开时无副作用', doc.querySelector('[data-menu-material]') === null);

// 用户手动打开菜单：React 同步挂载，MutationObserver 回调随即隐藏（手动模拟该回调）
account.click();
T.hideAccountSettingsItem();
const miSettings = doc.getElementById('mi-settings');
ok('菜单里的「设置」项被隐藏', miSettings.style.display === 'none');
ok('「设置」项被置 disabled（键盘走位跳过）', miSettings.disabled === true);
ok('「意见反馈」项原样保留', doc.getElementById('mi-contact').style.display !== 'none');

// 顶部新行委托：清掉夹具菜单，观察委托路径自己同步挂载
doc.querySelector('[data-menu-material]').remove();
menuClicks = 0;
ok('openNativeSettings() 返回 true（菜单式入口）', T.openNativeSettings() === true);
ok('委托命中「设置」项一次', menuClicks === 1);
ok('账号触发器本身未被动过', account.style.display !== 'none');

// ---------------------------------------------------------------- Case C
console.log('Case C: 合同失效时的还原');
reset(FALLBACK_HTML);
const fb2 = doc.getElementById('fallback');
fb2.setAttribute(T.HIDDEN_MARK, 'true');
fb2.style.display = 'none';
// 同节点被换成菜单触发器：标记仍挂着，但条件已不成立
fb2.setAttribute('aria-haspopup', 'menu');
T.hideFallbackTrigger();
ok('失效标记被还原（display 清空）', fb2.style.display === '');
ok('失效标记被移除', fb2.hasAttribute(T.HIDDEN_MARK) === false);

// 恢复回退形态：应再次隐藏
fb2.setAttribute('aria-haspopup', 'dialog');
T.hideFallbackTrigger();
ok('回退形态回归后被重新隐藏', fb2.style.display === 'none' && fb2.getAttribute(T.HIDDEN_MARK) === 'true');

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILED (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
