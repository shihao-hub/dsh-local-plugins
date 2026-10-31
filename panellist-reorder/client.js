(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/panellist-reorder',
    meta: {},
    factory: function () {
      /**
       * 侧栏面板行的拖拽排序。
       *
       * 宿主只在注册时读取 `order`，注册表本身只读，没有任何可写的排序入口：
       *   `ctx.slots.register({ name: 'sidebar.panellist', order })` 由各插件在装配期
       *   一次性声明，之后由 `<nav aria-label="全局面板">` 按 order 渲染成
       *   `button[class*="_panelRow"]` 行。
       * 因此顺序只能在渲染结果上做：拖动结束后把行的 DOM 顺序写回 nav，并把
       * 「行键 → 名次」存进 localStorage；每次宿主重渲染（切换语言、插件启停、
       * 面板重建）后由 MutationObserver 再校正一次。
       *
       * 行键取自 React 的 PanelRow fiber key（plugins / skills-panel / schedules /
       * mcp-panel / excalidraw-panel / settings-button / session-tag-lite），它和插件
       * 注册 id 同源，跨语言切换稳定；fiber 取不到时退回 aria-label 文案。
       *
       * DOM 契约（CSS Module 类名恒为 `<hash>_<localName>`，hash 随构建变化，
       * localName 稳定）：
       *   nav[class$="_panelList"]          面板行容器（flex column）
       *   button[class$="_panelRow"]        单行；标题 span 折叠态不渲染
       * 契约失效时本插件静默退化：不再排序，但绝不改动宿主结构。
       */

      // ---- 常量 ---------------------------------------------------------

      const STYLE_ID = '@local/panellist-reorder/panellist-reorder.css';
      const LIST_SELECTOR = 'nav[class$="_panelList"]';
      const ROW_SELECTOR = 'button[class$="_panelRow"]';
      /** 每个浏览器各自记住自己的顺序；换浏览器回到宿主默认顺序。 */
      const STORAGE_KEY = 'dsh.panellist-order.v1';
      /** 指针移动超过该像素才判定为拖拽，否则按点击处理（不抢面板切换）。 */
      const DRAG_THRESHOLD = 4;
      const DRAGGING_CLASS = 'plrDragging';
      const PLACEHOLDER_CLASS = 'plrPlaceholder';
      const ACTIVE_ROOT_CLASS = 'plrDragActive';
      const FIBER_PREFIX = '__reactFiber$';
      /** React 会保留 `__reactFiber$<hash>` 这个实例字段；拖动期间行是用 inline style 抬起的。 */
      const DRAG_INLINE_STYLE = 'position:fixed;left:0;top:0;width:0;height:0;margin:0;';

      const CSS = [
        /* 默认抓手光标，提示这些行可以拖。 */
        'nav[class$="_panelList"] > button[class$="_panelRow"]{cursor:grab;}',
        /* 抬起中的行：脱离文档流跟随指针，原位置由占位块顶住。 */
        'button[class$="_panelRow"].' + DRAGGING_CLASS + '{',
        '  position:fixed !important;',
        '  margin:0 !important;',
        '  z-index:60;',
        '  pointer-events:none;',
        '  cursor:grabbing;',
        '  border-radius:8px;',
        /* 抬起行必须有不透明底色：否则原位置的虚线占位会透过来，看着像两个东西叠着。 */
        '  background:var(--dsw-alias-bg-layer-2, rgba(72,72,72,.97)) !important;',
        '  box-shadow:0 12px 30px rgba(0,0,0,.38), 0 0 0 1px var(--dsw-alias-border-l2, rgba(128,128,128,.45));',
        '  will-change:top;',
        '}',
        /* 占位块：与被拖行同高，虚线示意落点。 */
        '.' + PLACEHOLDER_CLASS + '{',
        '  flex:none;',
        '  box-sizing:border-box;',
        '  border:1px dashed var(--dsw-alias-border-l2, rgba(140,140,140,.65));',
        '  border-radius:8px;',
        '  background:var(--dsw-alias-interactive-bg-hover, rgba(140,140,140,.1));',
        '}',
        /* 拖动全程统一抓手光标，顺带屏蔽文本选中。 */
        'html.' + ACTIVE_ROOT_CLASS + ',',
        'html.' + ACTIVE_ROOT_CLASS + ' *{',
        '  cursor:grabbing !important;',
        '  user-select:none !important;',
        '}',
      ].join('\n');

      // ---- 模块状态 -----------------------------------------------------

      /** 用户自定义顺序（行键数组）；空数组表示沿用宿主顺序。 */
      let order = [];
      /** 行键缓存：DOM 节点复用时不重复走 fiber 链。 */
      const keyCache = new WeakMap();
      /** 已按下、尚未越过阈值的那一行。 */
      let pending = null;
      /** 正在进行的拖拽。 */
      let drag = null;
      /** 拖拽结束后吞掉紧随其后的那一次 click，避免误切面板。 */
      let suppressClick = false;
      let suppressTimer = 0;
      let observer = null;
      let scheduled = false;
      let rafId = 0;

      // ---- 行识别 -------------------------------------------------------

      function fiberOf(node) {
        for (const key of Object.keys(node)) {
          if (key.indexOf(FIBER_PREFIX) === 0) return node[key];
        }
        return null;
      }

      /** 行键：优先取宿主 PanelRow 的 React key，取不到退回 aria-label 文案。 */
      function computeKey(row) {
        let fiber = fiberOf(row);
        let depth = 0;
        while (fiber !== null && fiber !== undefined && depth < 12) {
          if (typeof fiber.key === 'string' && fiber.key !== '') return fiber.key;
          if (typeof fiber.key === 'number') return String(fiber.key);
          fiber = fiber.return;
          depth += 1;
        }
        const label = row.getAttribute('aria-label');
        if (label === null) return null;
        const trimmed = label.trim();
        return trimmed === '' ? null : 'label:' + trimmed;
      }

      function keyOfRow(row) {
        const cached = keyCache.get(row);
        if (cached !== undefined) return cached;
        const key = computeKey(row);
        keyCache.set(row, key);
        return key;
      }

      // ---- 顺序存取 -----------------------------------------------------

      function readOrder() {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw === null) return [];
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) return [];
          return parsed.filter((item) => typeof item === 'string' && item !== '');
        } catch (error) {
          return [];
        }
      }

      function writeOrder(keys) {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
        } catch (error) {
          /* 隐私模式 / 配额不足：本次仍生效，只是不跨刷新保留。 */
        }
      }

      /** 按自定义顺序排好行；没见过的行（新装插件、语言切换后的新键）追加到末尾。 */
      function sortRows(rows) {
        const rank = new Map();
        for (let index = 0; index < order.length; index += 1) rank.set(order[index], index);
        const known = [];
        const unknown = [];
        rows.forEach((row, index) => {
          const value = rank.get(keyOfRow(row));
          if (typeof value === 'number') known.push({ row, rank: value, index });
          else unknown.push(row);
        });
        known.sort((a, b) => (a.rank - b.rank) || (a.index - b.index));
        return known.map((item) => item.row).concat(unknown);
      }

      // ---- 重排 ---------------------------------------------------------

      function listOf() {
        return document.querySelector(LIST_SELECTOR);
      }

      function applyOrder() {
        if (drag !== null || document === null) return;
        const list = listOf();
        if (list === null) return;
        const rows = Array.from(list.querySelectorAll(ROW_SELECTOR));
        if (rows.length === 0) return;
        const target = sortRows(rows);

        let same = target.length === rows.length;
        if (same) {
          for (let index = 0; index < rows.length; index += 1) {
            if (rows[index] !== target[index]) {
              same = false;
              break;
            }
          }
        }
        if (same) return;

        // nav 里若混进了非行元素（宿主未来改结构），只好整体按序重挂。
        if (list.children.length !== rows.length) {
          for (const row of target) list.appendChild(row);
          return;
        }
        // 逐个校正：把应当排在第 i 位的行移到第 i 位，只在错位处动 DOM。
        for (let index = 0; index < target.length; index += 1) {
          const desired = target[index];
          const current = list.children[index];
          if (current !== desired) list.insertBefore(desired, current === undefined ? null : current);
        }
      }

      function scheduleApply() {
        if (scheduled) return;
        scheduled = true;
        const run = () => {
          scheduled = false;
          applyOrder();
        };
        if (typeof window.requestAnimationFrame === 'function') {
          rafId = window.requestAnimationFrame(run);
        } else {
          rafId = window.setTimeout(run, 16);
        }
      }

      // ---- 拖拽 ---------------------------------------------------------

      /** 指针 Y 位置对应的落点：返回应插到哪一个兄弟行之前，null 表示排到最后。 */
      function dropBefore(list, row, clientY) {
        const siblings = Array.from(list.querySelectorAll(ROW_SELECTOR)).filter((item) => item !== row);
        for (const sibling of siblings) {
          const rect = sibling.getBoundingClientRect();
          if (clientY < rect.top + rect.height / 2) return sibling;
        }
        return null;
      }

      function movePlaceholder(clientY) {
        const list = drag.list;
        const before = dropBefore(list, drag.row, clientY);
        const placeholder = drag.placeholder;
        if (before === null) {
          if (list.lastElementChild !== placeholder) list.appendChild(placeholder);
          return;
        }
        if (placeholder.nextElementSibling !== before) list.insertBefore(placeholder, before);
      }

      function enterDrag(event) {
        const row = pending.row;
        const list = pending.list;
        const rect = row.getBoundingClientRect();
        const placeholder = document.createElement('div');
        placeholder.className = PLACEHOLDER_CLASS;
        placeholder.style.height = rect.height + 'px';
        placeholder.style.width = rect.width + 'px';
        list.insertBefore(placeholder, row);

        drag = {
          pointerId: pending.pointerId,
          row,
          list,
          placeholder,
          grabOffsetY: event.clientY - rect.top,
          savedStyle: row.getAttribute('style'),
          moved: false,
        };

        row.classList.add(DRAGGING_CLASS);
        row.style.cssText =
          DRAG_INLINE_STYLE +
          'left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;';
        document.documentElement.classList.add(ACTIVE_ROOT_CLASS);
      }

      function updateDrag(event) {
        drag.moved = true;
        drag.row.style.top = event.clientY - drag.grabOffsetY + 'px';
        movePlaceholder(event.clientY);
      }

      /** 结束拖拽：把抬起行放回落点。`commit` 为 false 时还原到起始位置。 */
      function exitDrag(commit) {
        if (drag === null) return;
        const { row, list, placeholder, savedStyle } = drag;
        if (commit) list.insertBefore(row, placeholder);
        else if (placeholder.parentNode === list) list.insertBefore(row, placeholder);
        placeholder.remove();

        row.classList.remove(DRAGGING_CLASS);
        if (savedStyle === null) row.removeAttribute('style');
        else row.setAttribute('style', savedStyle);
        document.documentElement.classList.remove(ACTIVE_ROOT_CLASS);

        const shouldSave = commit && drag.moved;
        drag = null;
        pending = null;

        if (shouldSave) {
          const keys = Array.from(list.querySelectorAll(ROW_SELECTOR))
            .map((item) => keyOfRow(item))
            .filter((key) => key !== null);
          order = keys;
          writeOrder(keys);
        }
      }

      function cancelSuppress() {
        suppressClick = false;
        if (suppressTimer !== 0) {
          window.clearTimeout(suppressTimer);
          suppressTimer = 0;
        }
      }

      function armSuppress() {
        cancelSuppress();
        suppressClick = true;
        suppressTimer = window.setTimeout(() => {
          suppressClick = false;
          suppressTimer = 0;
        }, 400);
      }

      // ---- 事件 ---------------------------------------------------------

      function onPointerDown(event) {
        if (event.button !== 0 || event.isPrimary === false) return;
        if (drag !== null) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const row = target.closest(ROW_SELECTOR);
        if (row === null) return;
        const list = row.closest(LIST_SELECTOR);
        if (list === null) return;
        pending = {
          pointerId: event.pointerId,
          row,
          list,
          startX: event.clientX,
          startY: event.clientY,
        };
      }

      function onPointerMove(event) {
        if (drag !== null) {
          if (event.pointerId !== drag.pointerId) return;
          updateDrag(event);
          return;
        }
        if (pending === null || event.pointerId !== pending.pointerId) return;
        const dx = event.clientX - pending.startX;
        const dy = event.clientY - pending.startY;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
        enterDrag(event);
        updateDrag(event);
      }

      function onPointerUp(event) {
        if (drag !== null) {
          if (event.pointerId !== drag.pointerId) return;
          const moved = drag.moved;
          exitDrag(true);
          if (moved) armSuppress();
          scheduleApply();
          return;
        }
        pending = null;
      }

      function onPointerCancel(event) {
        if (drag !== null && event.pointerId === drag.pointerId) {
          exitDrag(false);
          return;
        }
        if (pending !== null && event.pointerId === pending.pointerId) pending = null;
      }

      /** 拖动后的那一次 click 必须吞掉，否则会顺带切换主面板。 */
      function onClickCapture(event) {
        if (!suppressClick) return;
        cancelSuppress();
        event.stopPropagation();
        event.preventDefault();
      }

      function onWindowBlur() {
        if (drag !== null) exitDrag(false);
        pending = null;
      }

      // ---- 装配 ---------------------------------------------------------

      function injectStyle() {
        const selector = 'style[data-plugin-css="' + STYLE_ID + '"]';
        if (document.querySelector(selector) !== null) return () => {};
        const tag = document.createElement('style');
        tag.dataset.plugin = '@local/panellist-reorder';
        tag.dataset.pluginCss = STYLE_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }

      function start() {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
          return () => {};
        }
        order = readOrder();
        const disposeStyle = injectStyle();

        observer = new MutationObserver(scheduleApply);
        if (document.body !== null) {
          observer.observe(document.body, { childList: true, subtree: true });
        }
        applyOrder();

        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('pointermove', onPointerMove, true);
        document.addEventListener('pointerup', onPointerUp, true);
        document.addEventListener('pointercancel', onPointerCancel, true);
        document.addEventListener('click', onClickCapture, true);
        window.addEventListener('blur', onWindowBlur);

        return () => {
          if (observer !== null) {
            observer.disconnect();
            observer = null;
          }
          if (rafId !== 0) {
            if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(rafId);
            else window.clearTimeout(rafId);
            rafId = 0;
          }
          scheduled = false;
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('pointermove', onPointerMove, true);
          document.removeEventListener('pointerup', onPointerUp, true);
          document.removeEventListener('pointercancel', onPointerCancel, true);
          document.removeEventListener('click', onClickCapture, true);
          window.removeEventListener('blur', onWindowBlur);
          if (drag !== null) exitDrag(false);
          pending = null;
          cancelSuppress();
          disposeStyle();
        };
      }

      function apply(ctx) {
        ctx.effect(start, 'panellist-reorder: drag the sidebar panel rows into a custom order');
      }

      return {
        inject: [],
        apply,
        __test: {
          STORAGE_KEY,
          LIST_SELECTOR,
          ROW_SELECTOR,
          DRAG_THRESHOLD,
          CSS,
          computeKey,
          keyOfRow,
          sortRows,
          applyOrder,
          readOrder,
          writeOrder,
          dropBefore,
          getOrder: () => order,
          setOrder: (next) => {
            order = Array.isArray(next) ? next : [];
          },
          isDragging: () => drag !== null,
        },
      };
    },
  });
})();
