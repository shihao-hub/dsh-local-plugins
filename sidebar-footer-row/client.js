(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/sidebar-footer-row',
    meta: {},
    factory: function (require) {
      /**
       * 侧栏底部（sidebar footer）一行化。
       *
       * 宿主结构与 ds-harness-remote 的注入样式：
       *
       *   div[class*="_footArea"]                  (column)
       *     div[class*="_footerActions"]           ← 宿主只写 display:flex（默认 row）
       *       div                                  ← 透明包裹层（React fragment，实测 0x0）
       *         div.dshRemoteSidebarEntry.isWide   ← Remote 入口（整行按钮，276x36）
       *         span                               ← app-restart：两个 34x34 图标
       *           div.rsr_wrap / div.rsr_wrap
       *
       * ds-harness-remote 为了让 Remote 独占一行，注入：
       *   [class*="_footerActions"]:has(.dshRemoteSidebarEntry){
       *     flex-direction:column; align-items:stretch }
       * 结果 Remote 与 ⟳/⏻ 被拆成两行。
       *
       * 本插件把那三件事改回来：容器回到 row、透明包裹层保持 display:contents
       * （让 Remote 与按钮组成为同级 flex 项）、按钮组用 margin-left:auto 靠右。
       *
       * 关键约束：容器 row 与「按钮组贴右」两条规则**不依赖 Remote 存在**。
       * 未来禁用/移除 ds-harness-remote 后，footer 只剩 ⟳/⏻，它们仍贴在右侧同一位置，
       * 不会因为少了一个插件而滑回左侧。
       */
      const STYLE_TAG_ID = '@local/sidebar-footer-row/footer-row.css';

      const CSS = [
        /* 1) 容器恒为单行 flex —— 不依赖 Remote 是否存在。
         *    这样 ds-harness-remote 被禁用/移除后，restart/quit 的位置不变。 */
        '[class*="_footerActions"]{',
        '  display: flex !important;',
        '  flex-direction: row !important;',
        '  align-items: center !important;',
        '}',
        /* 2) 有 Remote 时留 8px 间距（无 Remote 时按钮组自己贴右，不需要 gap）。 */
        '[class*="_footerActions"]:has(.dshRemoteSidebarEntry){',
        '  gap: 8px;',
        '}',
        /* 3) slot 包裹层（React 渲染的 div，实测 0x0）保持 contents，
         *    让 Remote 与按钮组成为同级 flex 项；有无 Remote 都适用。 */
        '[class*="_footerActions"] > div:not(.dshRemoteSidebarEntry){',
        '  display: contents !important;',
        '}',
        /* 4) Remote 吃掉左侧剩余宽度，文字过长时省略而不是把按钮挤出去。 */
        '[class*="_footerActions"] .dshRemoteSidebarEntry{',
        '  flex: 1 1 auto;',
        '  min-width: 0;',
        '}',
        /* 5) 控制按钮组恒定贴右：Remote 在时靠 right 端，Remote 禁用时仍靠 right 端，
         *    位置不跳。锚点用 app-restart 自己的 .rsr_wrap，不碰兄弟插件。 */
        '[class*="_footerActions"] span:has(> .rsr_wrap){',
        '  margin-left: auto;',
        '  flex: none;',
        '  display: inline-flex;',
        '  align-items: center;',
        '  gap: 4px;',
        '}',
      ].join('\n');

      const inject = [];

      function apply(ctx) {
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {};
          if (document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]') !== null) {
            return () => {};
          }
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/sidebar-footer-row';
          tag.dataset.pluginCss = STYLE_TAG_ID;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'sidebar-footer-row: stylesheet');
      }

      return { inject, apply };
    }
  });
})();
