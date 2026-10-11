(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/settings-button',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      const NS = 'settings-button';

      /** 顶部面板列表里的行键；同时用作兜底主面板键位。 */
      const PANEL_ID = 'settings-button';
      /** 行序：现有「模组」0 →「技能」10 →「接口」20，故本行排在「接口」之后。 */
      const PANEL_ORDER = 30;

      /**
       * DOM 契约（依据与 pin-highlight 相同：CSS Module 类名恒为 `<hash>_<localName>`，
       * hash 随构建变化、localName 稳定；ARIA 语义来自原生组件本体）：
       *
       *   `[class$="_settingsArea"]`                     侧栏底部的设置座位（sidebar.settings 槽）
       *   `[class$="_settingsArea"] button[aria-haspopup="menu"]`
       *                                                  原生账号入口按钮（settings-account 的
       *                                                  AccountMenu 触发按钮）；该插件缺席时
       *                                                  settings-general 的原生回退按钮为 "dialog"
       *   `[data-menu-material] button[role="menuitem"]` 菜单面与菜单项（Menu 把列表 portal 到 body）
       *
       * 本插件**只隐藏账号菜单里的「设置」这一项**，账号按钮本身与「意见反馈 / 退出登录」
       * 全部原样保留。若某个未来构建打破上述任一约定：退化为「设置项不再被隐藏 +
       * 新行点击无动作 + 控制台告警」，不抛错、也不波及其他界面。
       */
      const SETTINGS_AREA = '[class$="_settingsArea"]';
      const TRIGGER_SELECTORS = [
        'button[aria-haspopup="menu"]',
        'button[aria-haspopup="dialog"]',
        'button'
      ];
      const MENU_SURFACE = '[data-menu-material]';
      const MENU_ITEM = 'button[role="menuitem"]';

      /** 「设置」项候选文案（比较前统一小写；当前语言优先，其次两种内置语言原文）。 */
      const SETTINGS_ITEM_LABELS = ['设置', 'settings'];
      /** 账号菜单的识别文案：只有该菜单同时含「意见反馈」，据此避免误伤其他菜单。 */
      const ACCOUNT_MENU_MARKERS = ['意见反馈', 'feedback'];

      /** Simplified Chinese dictionary (the key-set source of truth). */
      const zh = {
        label: '设置'
      };

      /** English dictionary, checked complete against the zh key set. */
      const en = {
        label: 'Settings'
      };

      /** 当前语言绑定，apply 时由 ctx.locale.bind 覆盖。 */
      let t = (key) => key;
      /** 客户端 layout 服务（兜底回退主面板用），apply 时注入。 */
      let layout = null;

      // ---- 原生入口寻址 ---------------------------------------------------

      /** 原生设置入口的触发按钮；查取在点击时进行，避免重渲染后节点失效。 */
      function nativeTrigger() {
        if (typeof document === 'undefined') return null;
        for (const selector of TRIGGER_SELECTORS) {
          const node = document.querySelector(SETTINGS_AREA + ' ' + selector);
          if (node !== null) return node;
        }
        return null;
      }

      /** 菜单项的规范化文本（含快捷键文案，故作前缀匹配）。 */
      function itemText(node) {
        return (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      }

      /** 文本前缀匹配（菜单项文本后面还会跟着快捷键文案，故不能全等比较）。 */
      function textStartsWith(node, labels) {
        const text = itemText(node);
        return labels.some((label) => text.indexOf(label) === 0);
      }

      /** 「设置」项的候选文案（当前语言优先，其次两种内置语言原文）。 */
      function settingsLabels() {
        const out = [];
        for (const candidate of [t('label')].concat(SETTINGS_ITEM_LABELS)) {
          if (typeof candidate !== 'string') continue;
          const text = candidate.trim().toLowerCase();
          if (text !== '' && out.indexOf(text) === -1) out.push(text);
        }
        return out;
      }

      /**
       * 隐藏账号菜单里的「设置」项 —— **只这一项**，账号按钮与其余菜单项不动。
       *
       * `display:none` 视觉移除；同时置 `disabled`：Menu 的键盘走位、Tab 进入与
       * autoFocus 都走 `button:not(:disabled)`，置灰后方向键会直接跳过它，
       * 不会留下一个按了没反应的空键位。
       *
       * 只处理同时含「意见反馈」的菜单面，绝不误伤其他菜单的第一项。
       */
      function hideAccountSettingsItem() {
        if (typeof document === 'undefined') return;
        for (const surface of Array.from(document.querySelectorAll(MENU_SURFACE))) {
          const items = Array.from(surface.querySelectorAll(MENU_ITEM));
          if (items.length === 0) continue;
          if (!items.some((item) => textStartsWith(item, ACCOUNT_MENU_MARKERS))) continue;
          const wanted = settingsLabels();
          for (const item of items) {
            if (!textStartsWith(item, wanted)) continue;
            if (item.style.display !== 'none') item.style.display = 'none';
            item.setAttribute('aria-hidden', 'true');
            item.disabled = true;
          }
        }
      }

      /** 菜单项候选：优先最后一个菜单面（刚打开的那一个）。 */
      function menuItems() {
        if (typeof document === 'undefined') return [];
        const surfaces = Array.from(document.querySelectorAll(MENU_SURFACE));
        for (let index = surfaces.length - 1; index >= 0; index -= 1) {
          const items = Array.from(surfaces[index].querySelectorAll(MENU_ITEM));
          if (items.length > 0) return items;
        }
        return Array.from(document.querySelectorAll(MENU_ITEM));
      }

      /** 命中账号菜单里的「设置」项：先按文本，再退回第一项（账号菜单第一项恒为设置）。 */
      function settingsMenuItem() {
        const items = menuItems();
        if (items.length === 0) return null;
        const wanted = settingsLabels();
        const matched = items.find((item) => textStartsWith(item, wanted));
        return matched !== undefined ? matched : items[0];
      }

      /**
       * 驱动原生设置入口，等价于点账号菜单里的「设置」。
       * @returns 是否找到了原生入口。
       */
      function openNativeSettings() {
        const trigger = nativeTrigger();
        if (trigger === null) {
          console.warn('[settings-button] 未找到原生账号入口，点击已忽略。');
          return false;
        }
        trigger.click();
        // 菜单由 React 在同一事件内挂载，通常可立即命中；未就绪则补两帧重试。
        // 命中失败时保持菜单打开（用户仍可手动点「意见反馈 / 退出登录」）。
        let attempts = 0;
        const pick = () => {
          const item = settingsMenuItem();
          if (item !== null) {
            // 该节点被本插件的 hideAccountSettingsItem 置为 disabled，
            // 而 disabled 按钮不派发 click，故先解除再点击。
            if (item.disabled === true) item.disabled = false;
            item.click();
            return;
          }
          attempts += 1;
          if (attempts <= 2) window.requestAnimationFrame(pick);
        };
        pick();
        return true;
      }

      // ---- 顶部「设置」行 -------------------------------------------------

      /** 齿轮图标：与相邻面板行同款描边风格。 */
      function GearIcon(props) {
        const size = typeof props?.size === 'number' ? props.size : 18;
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 16 16',
            fill: 'none',
            focusable: 'false',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('circle', {
            cx: 8,
            cy: 8,
            r: 4.9,
            stroke: 'currentColor',
            strokeWidth: 1.3
          }),
          h('circle', {
            cx: 8,
            cy: 8,
            r: 1.8,
            stroke: 'currentColor',
            strokeWidth: 1.3
          }),
          h('path', {
            d:
              'M12.9 8h1.8M1.3 8h1.8M8 3.1v-1.8M8 12.9v1.8' +
              'M11.47 11.47l1.27 1.27M4.53 4.53l-1.27-1.27' +
              'M11.47 4.53l1.27-1.27M4.53 11.47l-1.27 1.27',
            stroke: 'currentColor',
            strokeWidth: 1.3,
            strokeLinecap: 'round'
          })
        );
      }

      /**
       * `sidebar.panellist` 的图标位（原生 PanelRow 会把行文字/提示交给本组件）。
       * 该槽语义是「主面板切换」，因此这里在捕获阶段拦下行的 click，
       * 既不改动主面板，也覆盖键盘 Enter/Space 触发的合成 click。
       */
      function SettingsGlyph(props) {
        const ref = React.useRef(null);
        React.useEffect(() => {
          const node = ref.current;
          if (node === null || node === undefined) return undefined;
          const row = node.closest('button');
          if (row === null) return undefined;
          const onClick = (event) => {
            event.stopPropagation();
            openNativeSettings();
          };
          row.setAttribute('aria-haspopup', 'dialog');
          row.addEventListener('click', onClick, true);
          return () => {
            row.removeEventListener('click', onClick, true);
            row.removeAttribute('aria-haspopup');
          };
        });
        return h('span', { ref }, h(GearIcon, { size: props?.size }));
      }

      /**
       * 兜底：万一上面的拦截失效，主面板被切到本插件键位时立刻回到对话并打开设置，
       * 把「卡在空白主面板」变成一次瞬时闪动。
       */
      function SettingsRedirect() {
        React.useEffect(() => {
          if (layout !== null) layout.selectPanel(null);
          openNativeSettings();
        }, []);
        return null;
      }

      // ---- 装配 -----------------------------------------------------------

      const inject = ['slots', 'locale', 'layout'];

      function apply(ctx) {
        ctx.effect(() => {
          if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
            return () => {};
          }
          // 菜单是 portal 到 body 的：body 子节点一变就处理一次。
          // MutationObserver 回调在渲染前执行，所以看不到「设置」项闪现。
          const observer = new MutationObserver(() => {
            hideAccountSettingsItem();
          });
          observer.observe(document.body, { childList: true });
          hideAccountSettingsItem();
          return () => {
            observer.disconnect();
          };
        }, 'settings-button: hide the native settings menu item');

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'settings-button: dictionaries');
        t = ctx.locale.bind(NS);
        layout = ctx.layout;

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: PANEL_ORDER,
              label: () => t('label'),
              locale: NS
            },
            SettingsGlyph
          )
        );

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS
            },
            SettingsRedirect
          )
        );
      }

      return {
        inject,
        apply,
        __test: {
          PANEL_ID,
          PANEL_ORDER,
          SETTINGS_AREA,
          TRIGGER_SELECTORS,
          MENU_SURFACE,
          MENU_ITEM,
          SETTINGS_ITEM_LABELS,
          ACCOUNT_MENU_MARKERS,
          nativeTrigger,
          menuItems,
          settingsMenuItem,
          hideAccountSettingsItem,
          openNativeSettings,
          GearIcon
        }
      };
    }
  });
})();
