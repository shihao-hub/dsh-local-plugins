(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/sidebar-label-alias',
    meta: {},
    factory: function () {
      const FROM = '\u81EA\u52A8\u5316\u4EFB\u52A1'; // 自动化任务
      const TO = '\u4EFB\u52A1'; // 任务

      /**
       * 侧栏面板行（slot `sidebar.panellist`）的显示名由注册方提供，插件层
       * 没有可写的覆盖点：
       *   1. locale 层 —— 同一命名空间（`schedule.catalog`）重复注册同一语言
       *      会直接抛错，拿不到宿主的 disposer；
       *   2. slot 层 —— 注册项只读，且宿主把解析后的 label 落进自己的 store，
       *      改 options 不会通知重渲染。
       * 因此只能改渲染结果，并严格限定在 <nav> 内的面板行：页面标题、空状态、
       * 搜索框、任务卡片等其它同名文案一律不动。
       */

      /** 面板行显示名映射；改这里即可换词（左侧为宿主原值）。 */
      const LABELS = new Map([
        [FROM, TO],
        ['Automation tasks', 'Tasks']
      ]);

      function insideNav(element) {
        return typeof element.closest === 'function' && element.closest('nav') !== null;
      }

      /** 面板行里承载标题的 span（宿主结构：button > span.glyph + span.title）。 */
      function titleSpan(button, label) {
        for (const span of button.querySelectorAll('span')) {
          if ((span.textContent || '').trim() === label) return span;
        }
        return null;
      }

      function rewriteRow(button) {
        const label = button.getAttribute('aria-label');
        if (label === null) return;
        const trimmed = label.trim();
        const next = LABELS.get(trimmed);
        if (next === undefined) return;
        if (label !== next) button.setAttribute('aria-label', next);
        const span = titleSpan(button, trimmed);
        if (span !== null && span.textContent !== next) span.textContent = next;
      }

      /** 折叠态没有标题 span，悬停提示才是唯一可见文案。 */
      function rewriteTooltip(tooltip) {
        if (!insideNav(tooltip) && tooltip.getAttribute('role') !== 'tooltip') return;
        for (const child of tooltip.childNodes) {
          if (child.nodeType !== 3) continue;
          const value = (child.nodeValue || '').trim();
          const next = LABELS.get(value);
          if (next !== undefined) child.nodeValue = next;
        }
      }

      function sweep(root) {
        if (typeof root.querySelectorAll !== 'function') return;
        for (const button of root.querySelectorAll('button[aria-label]')) {
          if (insideNav(button)) rewriteRow(button);
        }
        for (const tooltip of root.querySelectorAll('[role="tooltip"]')) rewriteTooltip(tooltip);
      }

      function start() {
        if (typeof document === 'undefined') return () => {};

        sweep(document);

        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === 'attributes') {
              const element = mutation.target;
              if (element.tagName === 'BUTTON' && insideNav(element)) rewriteRow(element);
              continue;
            }
            if (mutation.type === 'characterData') {
              const parent = mutation.target.parentElement;
              if (parent === null) continue;
              if (parent.getAttribute('role') === 'tooltip') rewriteTooltip(parent);
              continue;
            }
            for (const node of mutation.addedNodes) {
              if (node.nodeType !== 1) continue;
              if (node.tagName === 'BUTTON' && insideNav(node)) rewriteRow(node);
              if (node.getAttribute('role') === 'tooltip') rewriteTooltip(node);
              sweep(node);
            }
          }
        });

        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['aria-label']
        });

        return () => observer.disconnect();
      }

      function apply(ctx) {
        ctx.effect(start, 'sidebar-label-alias: panel row label observer');
      }

      return {
        inject: [],
        apply,
        __test: { LABELS, rewriteRow, rewriteTooltip, sweep, insideNav }
      };
    }
  });
})();
