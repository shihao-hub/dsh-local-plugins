(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/rightbar-width',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      /**
       * 左右两栏宽度记忆（侧栏 / 右侧预览 / 浏览器 / 终端等栏的宽度偏好）。
       *
       * 宿主事实（`@deepseek-ai/dsh-client-ui-layout/lib/client.js`）：
       *   - 左栏：layout store 的 `layoutInfo.sidebar` 初始 280，拖动走 `setSidebar`，
       *     但 `setSidebar` 与 `computeColumns` 都把宽度硬 clamp 在 264～420px；
       *   - 右栏：`layoutInfo.rightbar` 是「瞬时状态」——初始 null，
       *     openRightbar() 里 `rightbar ??= max(300, round(viewport * 0.45))`，即首次打开固定 45%；
       *   - 两栏拖动都只写内存，页面刷新 / dsh web 重启后回到宿主默认。
       *
       * 本插件只补「持久化」这一层：
       *   1. 启动时若 localStorage 有上次宽度，先写进 layout store 的偏好；
       *   2. 用户拖动分隔条结束（pointerup）后记住最终宽度；
       *   3. 通用设置里给一行，左右各一组：预设宽度 / 自定义 px / 恢复默认。
       *
       * 宿主没有公开的 setRightbar / setSidebar：ctx.layout（LayoutController）只暴露
       * openRightbar/closeRightbar/toggleSidebar，真正的写入是它内部字段 `panels` 上的绑定 action。
       * 那是 JS 运行时的真实属性（bundle 未压缩字段名），但属私有契约：宿主升级若改名，
       * resolvePanels() 会返回 null，插件退化为 no-op（不抛错、不影响宿主）。
       *
       * 拖拽结束到 DOM 提交是异步的，故 pointerup 后等两帧再量宽度（= 宿主 clamp 后的实际值），
       * 而不是拿指针位移自己算。右栏有 `[data-rightbar-col]` 标记；左栏没有等价的 data 标记，
       * 所以从分隔条父节点（frame）的 `grid-template-columns` 第一段读，回退到分隔条的 `left`。
       */

      const NS = 'rightbar-width';
      const STORE_KEY = 'rightbar-width.width';
      const SIDEBAR_STORE_KEY = 'rightbar-width.sidebar';
      const CHANGE_EVENT = 'rightbar-width:change';
      const STYLE_TAG_ID = '@local/rightbar-width/settings.css';
      const ROW_ID = 'rightbar-width';
      const PLUGIN_PACKAGE = '@local/rightbar-width';

      /** 宿主契约：右栏最小 300px、最大 70% 视口（columns.js）。 */
      const MIN_WIDTH = 300;
      const HOST_DEFAULT_RATIO = 0.45;
      const HOST_MAX_RATIO = 0.7;

      /** 宿主契约：左栏宽度 264～420px，初始 280（columns.js / stores.js）。 */
      const MIN_SIDEBAR = 264;
      const MAX_SIDEBAR = 420;
      const SIDEBAR_DEFAULT = 280;

      /** 常用宽度档位（px）。 */
      const PRESETS = [360, 420, 480, 560];
      const SIDEBAR_PRESETS = [280, 320, 360, 400];

      /** 右栏从未设置过时的固定宽度（正是用户抱怨的「一半」的对策）。 */
      const DEFAULT_WIDTH = 480;

      /**
       * 右栏存储值：数字 = 固定 px；AUTO = 跟随宿主 45%；null = 从未设置。
       * 左栏只有「数字 / null」：宿主默认 280 本身就是合理值，无需在首次启用时改写。
       */
      const AUTO = 'auto';

      const STYLE_MOUNTED = 'rightbar-width: settings stylesheet';
      const NAME_RESTORE = 'rightbar-width: restore + drag persistence';
      const NAME_DICT = 'rightbar-width: dictionaries';

      /** 输入框里显示的文本：只有数字宽度才回填，auto / 未设置保持空。 */
      function fixedText(value) {
        return typeof value === 'number' ? String(value) : '';
      }

      // ---- persistence ------------------------------------------------------

      /**
       * @returns {number|'auto'|null} 固定宽度、跟随宿主、或从未设置。
       */
      function readSaved() {
        try {
          const raw = window.localStorage.getItem(STORE_KEY);
          if (raw === null) return null;
          if (raw === AUTO) return AUTO;
          const px = Number(raw);
          if (!Number.isFinite(px) || px < MIN_WIDTH) return null;
          return Math.round(px);
        } catch {
          return null;
        }
      }

      function writeSaved(px) {
        try {
          window.localStorage.setItem(STORE_KEY, String(Math.round(px)));
          return true;
        } catch {
          return false;
        }
      }

      /** 显式选择「跟随宿主」：以后每次启动都不再干预宽度。 */
      function writeAuto() {
        try {
          window.localStorage.setItem(STORE_KEY, AUTO);
          return true;
        } catch {
          return false;
        }
      }

      function clearSaved() {
        try {
          window.localStorage.removeItem(STORE_KEY);
        } catch {
          /* storage unavailable: nothing to clear */
        }
      }

      /** 左栏宽度：数字 px 或 null（从未设置 = 不干预，用宿主默认 280）。 */
      function readSavedSidebar() {
        try {
          const raw = window.localStorage.getItem(SIDEBAR_STORE_KEY);
          if (raw === null) return null;
          const px = Number(raw);
          if (!Number.isFinite(px) || px < MIN_SIDEBAR) return null;
          return clampSidebar(px);
        } catch {
          return null;
        }
      }

      function writeSavedSidebar(px) {
        const clamped = clampSidebar(px);
        if (clamped === null) return false;
        try {
          window.localStorage.setItem(SIDEBAR_STORE_KEY, String(clamped));
          return true;
        } catch {
          return false;
        }
      }

      function clearSavedSidebar() {
        try {
          window.localStorage.removeItem(SIDEBAR_STORE_KEY);
        } catch {
          /* storage unavailable: nothing to clear */
        }
      }

      function dispatchChange() {
        try {
          window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
        } catch {
          /* CustomEvent / dispatch unavailable (e.g. test sandbox) */
        }
      }

      // ---- host geometry ----------------------------------------------------

      /** 宿主首次打开用的默认宽度。 */
      function hostDefaultWidth(viewport) {
        const width = Number(viewport);
        if (!Number.isFinite(width) || width <= 0) return MIN_WIDTH;
        return Math.max(MIN_WIDTH, Math.round(width * HOST_DEFAULT_RATIO));
      }

      /** 与宿主 setRightbar 同一套 clamp（300 ～ 70% 视口）。 */
      function clampForViewport(px, viewport) {
        const wanted = Number(px);
        if (!Number.isFinite(wanted)) return null;
        const view = Number(viewport) > 0 ? Number(viewport) : wanted;
        const max = Math.max(MIN_WIDTH, Math.round(view * HOST_MAX_RATIO));
        return Math.min(max, Math.max(MIN_WIDTH, Math.round(wanted)));
      }

      /** 与宿主 setSidebar / computeColumns 同一套 clamp（264 ～ 420）。 */
      function clampSidebar(px) {
        const wanted = Number(px);
        if (!Number.isFinite(wanted)) return null;
        return Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, Math.round(wanted)));
      }

      /** 当前 frame 宽度（右栏所在 grid 的实际视口）。 */
      function viewportWidth() {
        try {
          const col = document.querySelector('[data-rightbar-col]');
          const frame = col !== null ? col.parentElement : null;
          if (frame !== null) {
            const width = Math.round(frame.getBoundingClientRect().width);
            if (width > 0) return width;
          }
        } catch {
          /* DOM unavailable */
        }
        try {
          return Math.round(window.innerWidth);
        } catch {
          return 0;
        }
      }

      /**
       * 量左栏当前渲染宽度。左栏没有 `data-sidebar-col` 标记，因此：
       *   1. 找左栏分隔条 `[data-side="sidebar"]`，读父节点 frame 的 inline
       *      `grid-template-columns` 第一段（宿主每次渲染都会重写，正是 clamp 后的值）；
       *   2. 退回到分隔条的 inline `left`（同样是 cols.sidebar）；
       *   3. 都拿不到时返回 0，调用方放弃本次保存。
       */
      function measureSidebarWidth() {
        let handle = null;
        try {
          handle = document.querySelector('[data-side="sidebar"]');
        } catch {
          return 0;
        }
        if (handle === null || handle === undefined) return 0;
        try {
          const frame = handle.parentElement;
          const cols = frame !== null && frame.style ? String(frame.style.gridTemplateColumns || '') : '';
          const first = Number.parseInt(cols, 10);
          if (Number.isFinite(first) && first > 0) return first;
        } catch {
          /* fall through to the handle offset */
        }
        try {
          const left = Number.parseInt(String((handle.style && handle.style.left) || ''), 10);
          if (Number.isFinite(left) && left > 0) return left;
        } catch {
          /* unmeasurable */
        }
        return 0;
      }

      /**
       * 取宿主绑定 action：`ctx.layout` 是 LayoutController 实例，
       * 写入入口是它内部的 `panels`（见模块头注释）。
       * 两栏任一 action 存在即返回（旧版宿主可能只暴露其中之一）。
       */
      function resolvePanels(ctx) {
        if (ctx === null || ctx === undefined) return null;
        let layout = null;
        try {
          layout = typeof ctx.get === 'function' ? ctx.get('layout') : null;
        } catch {
          layout = null;
        }
        if (layout === null || layout === undefined) {
          try {
            layout = ctx.layout;
          } catch {
            layout = null;
          }
        }
        if (layout === null || layout === undefined) return null;
        let panels = null;
        try {
          panels = layout.panels;
        } catch {
          panels = null;
        }
        if (panels === null || panels === undefined) return null;
        const hasRightbar = typeof panels.setRightbar === 'function';
        const hasSidebar = typeof panels.setSidebar === 'function';
        return hasRightbar || hasSidebar ? panels : null;
      }

      let ctxRef = null;

      /** 写右栏宽度偏好；宿主不可用时返回 false（插件静默降级）。 */
      function applyWidth(px) {
        const panels = resolvePanels(ctxRef);
        if (panels === null || typeof panels.setRightbar !== 'function') return false;
        try {
          panels.setRightbar(px);
          return true;
        } catch {
          return false;
        }
      }

      /** 写左栏宽度偏好；宿主不可用时返回 false（插件静默降级）。 */
      function applySidebarWidth(px) {
        const panels = resolvePanels(ctxRef);
        if (panels === null || typeof panels.setSidebar !== 'function') return false;
        try {
          panels.setSidebar(px);
          return true;
        } catch {
          return false;
        }
      }

      // ---- drag tracking ----------------------------------------------------

      /** 拖动结束后的保存：等两帧让宿主提交 DOM，再量真实渲染宽度。 */
      function afterSettle(fn) {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => window.requestAnimationFrame(fn));
        } else {
          window.setTimeout(fn, 32);
        }
      }

      /** 记住拖动左栏分隔条后的最终宽度。 */
      function saveSidebarNow() {
        const width = measureSidebarWidth();
        if (!Number.isFinite(width) || width < MIN_SIDEBAR) return;
        const clamped = clampSidebar(width);
        if (clamped === null) return;
        if (writeSavedSidebar(clamped)) dispatchChange();
      }

      /** 记住拖动右栏分隔条后的最终宽度。 */
      function saveRightbarNow() {
        let col = null;
        try {
          col = document.querySelector('[data-rightbar-col]');
        } catch {
          col = null;
        }
        if (col === null) return;
        const width = Math.round(col.getBoundingClientRect().width);
        if (!Number.isFinite(width) || width < MIN_WIDTH) return;
        if (writeSaved(width)) dispatchChange();
      }

      /** 记住拖动分隔条后的最终宽度（左右各一个手柄）。 */
      function trackDragSaves() {
        if (typeof document === 'undefined') return function () {};
        let dragging = null;

        const onDown = (event) => {
          const target = event.target;
          if (!target || typeof target.closest !== 'function') return;
          if (target.closest('[data-side="sidebar"]') !== null) dragging = 'sidebar';
          else if (target.closest('[data-side="rightbar"]') !== null) dragging = 'rightbar';
        };

        const onUp = () => {
          const side = dragging;
          if (side === null) return;
          dragging = null;
          afterSettle(side === 'sidebar' ? saveSidebarNow : saveRightbarNow);
        };

        const onCancel = () => {
          dragging = null;
        };

        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('pointerup', onUp, true);
        document.addEventListener('pointercancel', onCancel, true);
        return function () {
          document.removeEventListener('pointerdown', onDown, true);
          document.removeEventListener('pointerup', onUp, true);
          document.removeEventListener('pointercancel', onCancel, true);
        };
      }

      // ---- settings row -----------------------------------------------------

      /** 一组「预设按钮 + 自定义 px + 复位」，左右栏共用。 */
      function widthControls(props) {
        return h(
          'div',
          { className: 'rbw_row' },
          h('span', { className: 'rbw_label' }, props.label),
          props.presets.map((px) =>
            h(
              'button',
              {
                key: px,
                type: 'button',
                className: 'rbw_preset' + (props.active(px) ? ' rbw_active' : ''),
                title: t('presetTitle', { width: px }),
                onClick: () => props.choose(px)
              },
              String(px)
            )
          ),
          h(
            'label',
            { className: 'rbw_box', title: t('customTitle') },
            h('input', {
              className: 'rbw_input',
              type: 'number',
              min: String(props.min),
              step: '10',
              value: props.draft,
              placeholder: props.placeholder,
              'aria-label': t('customTitle'),
              onChange: (event) => props.onDraft(event.target.value),
              onBlur: props.commit,
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  props.commit();
                } else if (event.key === 'Escape') {
                  props.onDraft('');
                }
              }
            }),
            h('span', { className: 'rbw_unit' }, t('unit'))
          ),
          h('button', { type: 'button', className: 'rbw_reset', onClick: props.reset }, props.resetLabel)
        );
      }

      function WidthRow() {
        const [savedRight, setSavedRight] = React.useState(readSaved());
        const [draftRight, setDraftRight] = React.useState(fixedText(savedRight));
        const [savedLeft, setSavedLeft] = React.useState(readSavedSidebar());
        const [draftLeft, setDraftLeft] = React.useState(fixedText(savedLeft));

        React.useEffect(() => {
          const sync = () => {
            const nextRight = readSaved();
            setSavedRight(nextRight);
            setDraftRight(fixedText(nextRight));
            const nextLeft = readSavedSidebar();
            setSavedLeft(nextLeft);
            setDraftLeft(fixedText(nextLeft));
          };
          window.addEventListener(CHANGE_EVENT, sync);
          return () => window.removeEventListener(CHANGE_EVENT, sync);
        }, []);

        // ---- 右栏 ----

        const chooseRight = (px) => {
          const clamped = clampForViewport(px, viewportWidth());
          if (clamped === null) return;
          const applied = applyWidth(clamped);
          /* 宿主不可用时只改本地记录，下次宿主可用时仍会恢复。 */
          if (writeSaved(clamped) || applied) dispatchChange();
        };

        const commitRightDraft = () => {
          const px = Number(draftRight);
          if (!Number.isFinite(px) || px <= 0) {
            setDraftRight(fixedText(savedRight));
            return;
          }
          chooseRight(px);
        };

        /* 「跟随宿主」：写入 auto 标记，之后启动不再干预。 */
        const resetRight = () => {
          writeAuto();
          applyWidth(hostDefaultWidth(viewportWidth()));
          dispatchChange();
        };

        // ---- 左栏 ----

        const chooseLeft = (px) => {
          const clamped = clampSidebar(px);
          if (clamped === null) return;
          const applied = applySidebarWidth(clamped);
          if (writeSavedSidebar(clamped) || applied) dispatchChange();
        };

        const commitLeftDraft = () => {
          const px = Number(draftLeft);
          if (!Number.isFinite(px) || px <= 0) {
            setDraftLeft(fixedText(savedLeft));
            return;
          }
          chooseLeft(px);
        };

        /* 左栏复位 = 回到宿主默认 280，并清掉记录（之后启动不再干预）。 */
        const resetLeft = () => {
          clearSavedSidebar();
          applySidebarWidth(SIDEBAR_DEFAULT);
          dispatchChange();
        };

        const activeRight = (px) => typeof savedRight === 'number' && savedRight === px;
        const activeLeft = (px) => typeof savedLeft === 'number' && savedLeft === px;

        return h(
          'div',
          {
            className: 'rbw_group',
            'data-plugin-setting': ROW_ID,
            'data-plugin-package': PLUGIN_PACKAGE
          },
          h(
            'div',
            { className: 'rbw_head' },
            h(
              'div',
              { className: 'rbw_text' },
              h(
                'div',
                { className: 'rbw_title' },
                t('row.title'),
                h(
                  'span',
                  { className: 'rbw_badge', title: t('row.badgeTitle', { package: PLUGIN_PACKAGE }) },
                  t('row.badge')
                )
              ),
              h('div', { className: 'rbw_desc' }, t('row.description'))
            )
          ),
          widthControls({
            label: t('left.label'),
            presets: SIDEBAR_PRESETS,
            min: MIN_SIDEBAR,
            draft: draftLeft,
            active: activeLeft,
            choose: chooseLeft,
            onDraft: setDraftLeft,
            commit: commitLeftDraft,
            reset: resetLeft,
            resetLabel: t('left.reset'),
            placeholder: t('left.placeholder')
          }),
          widthControls({
            label: t('right.label'),
            presets: PRESETS,
            min: MIN_WIDTH,
            draft: draftRight,
            active: activeRight,
            choose: chooseRight,
            onDraft: setDraftRight,
            commit: commitRightDraft,
            reset: resetRight,
            resetLabel: t('reset'),
            placeholder: t('right.placeholder')
          })
        );
      }

      // ---- styles -----------------------------------------------------------

      const CSS = [
        '/* 通用设置行（README 的插件来源标注约定：data-plugin-setting / 徽章） */',
        '.rbw_group{border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:8px;padding:16px 0}',
        '.rbw_head{display:flex;flex-direction:column;gap:8px}',
        '.rbw_text{display:flex;flex-direction:column;gap:2px;min-width:0}',
        '.rbw_title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}',
        '.rbw_badge{display:inline-flex;align-items:center;flex:none;margin-left:8px;padding:0 6px;height:18px;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-weight:400;letter-spacing:.02em;white-space:nowrap;vertical-align:middle}',
        '.rbw_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
        '.rbw_row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
        '.rbw_label{flex:none;min-width:28px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
        '.rbw_preset{box-sizing:border-box;height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:22px;font-variant-numeric:tabular-nums;cursor:pointer}',
        '.rbw_preset:hover{border-color:var(--dsw-alias-border-l4);color:var(--dsw-alias-label-primary)}',
        '.rbw_preset.rbw_active{border-color:var(--dsw-alias-state-business-primary,#4176e6);color:var(--dsw-alias-state-business-primary,#4176e6)}',
        '.rbw_box{display:inline-flex;align-items:center;gap:4px}',
        '.rbw_input{box-sizing:border-box;width:64px;height:24px;padding:0 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;font-variant-numeric:tabular-nums}',
        '.rbw_input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#4176e6)}',
        '.rbw_unit{color:var(--dsw-alias-label-tertiary);font-size:12px}',
        '.rbw_reset{flex:none;padding:2px 4px;border:0;background:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer}',
        '.rbw_reset:hover{color:var(--dsw-alias-label-primary)}',
        ''
      ].join('\n');

      function startStyles() {
        if (typeof document === 'undefined') return function () {};
        if (document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]') !== null) {
          return function () {};
        }
        const tag = document.createElement('style');
        tag.dataset.plugin = PLUGIN_PACKAGE;
        tag.dataset.pluginCss = STYLE_TAG_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return function () {
          tag.remove();
        };
      }

      // ---- i18n -------------------------------------------------------------

      const zh = {
        'row.title': '侧栏宽度记忆',
        'row.badge': '插件',
        'row.badgeTitle': '由插件 {package} 提供',
        'row.description': '记住左右两栏的宽度，刷新与重启后保持；拖动分隔条也会记住',
        'left.label': '左栏',
        'right.label': '右栏',
        'left.placeholder': '默认',
        'right.placeholder': '跟随宿主',
        'left.reset': '默认 280',
        'presetTitle': '固定为 {width}px',
        'customTitle': '自定义宽度（px）',
        'unit': 'px',
        reset: '跟随宿主 45%'
      };
      const en = {
        'row.title': 'Sidebar width memory',
        'row.badge': 'Plugin',
        'row.badgeTitle': 'Provided by plugin {package}',
        'row.description': 'Keeps both panel widths across reloads; dragging a splitter is remembered too',
        'left.label': 'Left',
        'right.label': 'Right',
        'left.placeholder': 'Default',
        'right.placeholder': 'Follow host',
        'left.reset': 'Default 280',
        'presetTitle': 'Pin to {width}px',
        'customTitle': 'Custom width (px)',
        'unit': 'px',
        reset: 'Follow host 45%'
      };

      let t = (key) => key;

      // ---- wiring -----------------------------------------------------------

      function apply(ctx) {
        ctxRef = ctx;
        ctx.effect(startStyles, STYLE_MOUNTED);
        ctx.effect(() => {
          /* ctx.locale.register 在同一 effect 内绑定；t 在注册后即生效。 */
          return ctx.locale.register(NS, { zh, en });
        }, NAME_DICT);
        t = ctx.locale.bind(NS);

        ctx.effect(() => {
          const panels = resolvePanels(ctx);
          if (panels !== null) {
            if (typeof panels.setRightbar === 'function') {
              const saved = readSaved();
              if (saved === AUTO) {
                /* 用户明确要跟随宿主：不干预，让 openRightbar 自己按 45% 初始化。 */
              } else if (saved === null) {
                /* 首次启用：直接落到比「一半」窄的默认宽度，并记住它。 */
                try {
                  panels.setRightbar(DEFAULT_WIDTH);
                  writeSaved(DEFAULT_WIDTH);
                } catch {
                  /* 宿主拒绝时保持原样，不阻断启动 */
                }
              } else {
                try {
                  panels.setRightbar(saved);
                } catch {
                  /* 同上 */
                }
              }
            }
            if (typeof panels.setSidebar === 'function') {
              const savedLeft = readSavedSidebar();
              /* 从未设置时不动：宿主默认 280 本来就是合理值。 */
              if (savedLeft !== null) {
                try {
                  panels.setSidebar(savedLeft);
                } catch {
                  /* 同上 */
                }
              }
            }
          }
          return trackDragSaves();
        }, NAME_RESTORE);

        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'rightbar-width',
              order: 16,
              locale: NS
            },
            WidthRow
          )
        );
      }

      const inject = ['slots', 'locale', 'layout'];

      return {
        inject,
        apply,
        __test: {
          NS,
          ROW_ID,
          PLUGIN_PACKAGE,
          STORE_KEY,
          SIDEBAR_STORE_KEY,
          CHANGE_EVENT,
          STYLE_TAG_ID,
          MIN_WIDTH,
          DEFAULT_WIDTH,
          MIN_SIDEBAR,
          MAX_SIDEBAR,
          SIDEBAR_DEFAULT,
          AUTO,
          HOST_DEFAULT_RATIO,
          HOST_MAX_RATIO,
          PRESETS,
          SIDEBAR_PRESETS,
          CSS,
          zh,
          en,
          readSaved,
          writeSaved,
          writeAuto,
          clearSaved,
          readSavedSidebar,
          writeSavedSidebar,
          clearSavedSidebar,
          fixedText,
          hostDefaultWidth,
          clampForViewport,
          clampSidebar,
          resolvePanels,
          applyWidth,
          applySidebarWidth,
          measureSidebarWidth,
          trackDragSaves
        }
      };
    }
  });
})();
