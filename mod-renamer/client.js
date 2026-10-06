(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/mod-renamer',
    meta: {},
    factory: function () {
      const FROM = '\u63D2\u4EF6'; // 插件
      const TO = '\u6A21\u7EC4'; // 模组

      /**
       * Scope guard — this plugin must never touch conversation/session
       * content (chat messages, agent replies, tool output). Only two kinds
       * of text are renamed:
       *
       * 1. Exact standalone phrases (EXACT_MAP below), safe anywhere in the
       *    chrome: the sidebar nav label, page titles, the add button.
       * 2. Substring occurrences inside the Plugins settings page container,
       *    detected via its heading plus group labels, so descriptions on
       *    that one page are covered too.
       */

      /** Whole-string phrase map, applied when a text node (trimmed) equals the key. */
      const EXACT_MAP = new Map([
        ['\u63D2\u4EF6', '\u6A21\u7EC4'], // 插件 → 模组
        [
          '\u6DFB\u52A0\u63D2\u4EF6',
          '\u6DFB\u52A0\u6A21\u7EC4'
        ], // 添加插件 → 添加模组
        [
          '\u5B89\u88C5\u3001\u542F\u7528\u548C\u914D\u7F6E\u63D2\u4EF6',
          '\u5B89\u88C5\u3001\u542F\u7528\u548C\u914D\u7F6E\u6A21\u7EC4'
        ], // 安装、启用和配置插件 → 安装、启用和配置模组
        [
          '\u63D2\u4EF6\u5217\u8868',
          '\u6A21\u7EC4\u5217\u8868'
        ] // 插件列表 → 模组列表
      ]);

      /** Markers that identify the Plugins page container (group labels / button). */
      const PAGE_MARKERS = [
        '\u5B98\u65B9', // 官方
        '\u5DF2\u5B89\u88C5', // 已安装
        '\u6DFB\u52A0\u63D2\u4EF6', // 添加插件 (before its own rename lands)
        '\u5305\u542B\u7684\u7EC4\u4EF6', // 包含的组件 (bundle detail page)
        '\u5DF2\u542F\u7528', // 已启用 (detail page)
        '\u5DF2\u5173\u95ED' // 已关闭 (detail page)
      ];

      const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'data-tooltip'];
      const scopedContainers = new WeakSet();

      /**
       * Editable regions (composer, search inputs, textareas) are user
       * content: if the user literally types 插件 there, it must stay as
       * typed. Attributes like placeholder are still renamed elsewhere.
       */
      function insideEditable(node) {
        let current = node.nodeType === 1 ? node : node.parentElement;
        while (current !== null) {
          const tag = current.tagName;
          if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
          if (current.isContentEditable === true) return true;
          current = current.parentElement;
        }
        return false;
      }

      function trimmed(node) {
        return (node.nodeValue ?? '').trim();
      }

      function renameSubstring(value) {
        return value.indexOf(FROM) === -1 ? value : value.split(FROM).join(TO);
      }

      function renameExact(node) {
        const value = node.nodeValue;
        if (typeof value !== 'string') return false;
        const mapped = EXACT_MAP.get(value.trim());
        if (mapped === undefined) return false;
        const leading = value.slice(0, value.indexOf(value.trim()));
        node.nodeValue = leading + mapped;
        return true;
      }

      function processTextNode(node, force) {
        if (insideEditable(node)) return;
        if (force) {
          node.nodeValue = renameSubstring(node.nodeValue);
          return;
        }
        renameExact(node);
      }

      function insideScopedContainer(node) {
        let current = node.parentElement;
        while (current !== null) {
          if (scopedContainers.has(current)) return true;
          current = current.parentElement;
        }
        return false;
      }

      /** Substring-rename every text node and renameable attribute under root. */
      function substringSweep(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        for (let current = walker.nextNode(); current !== null; current = walker.nextNode()) {
          processTextNode(current, true);
        }
        for (const name of ATTRIBUTES) {
          for (const element of root.querySelectorAll('[' + name + ']')) {
            const value = element.getAttribute(name);
            if (typeof value === 'string' && value.indexOf(FROM) !== -1) {
              element.setAttribute(name, renameSubstring(value));
            }
          }
        }
      }

      /**
       * Detect Plugins-page containers: a heading whose whole text is 插件
       * plus, in the same region, one of the known page markers. The smallest
       * such ancestor is scoped; everything outside it stays untouched.
       */
      function detectScopedContainers(root) {
        if (typeof root.querySelectorAll !== 'function') return;
        for (const heading of root.querySelectorAll('h1, h2, h3')) {
          if (trimmed(heading.firstChild) !== FROM) continue;
          let container = heading.parentElement;
          for (let depth = 0; container !== null && depth < 12; depth += 1) {
            const text = container.textContent ?? '';
            if (PAGE_MARKERS.some((marker) => text.indexOf(marker) !== -1)) {
              if (!scopedContainers.has(container)) {
                scopedContainers.add(container);
                substringSweep(container);
              }
              break;
            }
            container = container.parentElement;
          }
        }
      }

      function processElement(element) {
        for (const name of ATTRIBUTES) {
          const value = element.getAttribute && element.getAttribute(name);
          if (typeof value !== 'string') continue;
          const mapped = EXACT_MAP.get(value.trim());
          if (mapped !== undefined) {
            element.setAttribute(name, mapped);
          } else if (insideScopedContainer(element) && value.indexOf(FROM) !== -1) {
            element.setAttribute(name, renameSubstring(value));
          }
        }
      }

      function processNode(node) {
        if (node === null || node === undefined) return;
        if (node.nodeType === 3) {
          processTextNode(node, false);
          return;
        }
        if (node.nodeType !== 1) return;
        if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
        processElement(node);
        if (typeof node.querySelectorAll !== 'function') return;

        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
        for (let current = walker.nextNode(); current !== null; current = walker.nextNode()) {
          processNode(current);
        }
        for (const name of ATTRIBUTES) {
          for (const element of node.querySelectorAll('[' + name + ']')) {
            processElement(element);
          }
        }
        detectScopedContainers(node);
      }

      function start() {
        if (typeof document === 'undefined') return () => {};

        processNode(document.documentElement);

        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === 'characterData') {
              processNode(mutation.target);
              continue;
            }
            if (mutation.type === 'attributes') {
              processElement(mutation.target);
              continue;
            }
            for (const node of mutation.addedNodes) {
              processNode(node);
            }
          }
        });

        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ATTRIBUTES
        });

        return () => {
          observer.disconnect();
        };
      }

      const inject = [];

      function apply(ctx) {
        ctx.effect(start, 'mod-renamer: scoped rename observer');
      }

      return {
        inject,
        apply,
        __test: { EXACT_MAP, renameSubstring, renameExact, processNode, detectScopedContainers }
      };
    }
  });
})();
