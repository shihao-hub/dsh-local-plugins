/**
 * 侧栏会话行的「工作区副标题」。
 *
 * 宿主（ui-workspace）把每条会话渲染成一行 32px 的 treeitem：
 *
 *   div[data-row-key^="session:"]        (.…_sessionRow)
 *     span.…_slot / span.…_title / span.…_time / span.…_rowActions
 *
 * 「按工作区」分组时工作区名在组头上，单列表模式（flat）下则完全丢失——
 * 不同工作区的会话混在一起，只能靠标题猜。本插件参考 agy 的会话列表，
 * 在标题下方补一行工作区名（11px、tertiary、带文件夹图标、单行省略），
 * 行高 32 → 46px（标题行内容区仍是 32px，只在下方多出 14px）。
 *
 * 为什么走 DOM 注入而不是整块接管 `sidebar.workspaces`：
 *   宿主没有开放「行副标题」座位（只有 leading 16px 格、hover 卡、行尾动作），
 *   而整块 shadow 要复刻搜索、菜单、拖拽、归档对话框、工作区增删改……
 *   代价远超收益。这里只在宿主自己的行节点末尾追加一个装饰性 span，
 *   并用 CSS 改行高；React 的 reconciliation 只按 index 管理它自己的子节点，
 *   末尾追加的节点不会被它清掉（万一被重建，MutationObserver 会补回）。
 *
 * 数据：`ctx.get('sessions').list` 与 `ctx.get('workspaces').list` 两个
 * 只读快照源（不 retain、不激活 Session）。工作区名优先取 Workspace 的
 * 用户可改标题，其次取会话 cwd 的 basename，都没有时显示「未分组」。
 *
 * 设置：通用设置里一行三选一（所有视图 / 仅单列表 / 关闭），默认所有视图。
 */
(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/session-workspace-label',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      const NS = 'session-workspace-label';
      const STORE_KEY = 'session-workspace-label.mode';
      const STYLE_TAG_ID = '@local/session-workspace-label/rows.css';
      const ROW_ID = 'session-workspace-label';
      const PLUGIN_PACKAGE = '@local/session-workspace-label';

      /** 宿主会话行选择器：项目行（workspace:*）不命中。 */
      const ROW_SELECTOR = 'div[data-row-key^="session:"]';
      /** 行上的「已加副标题」标记，CSS 靠它抬行高。 */
      const ROW_ATTR = 'data-swl';
      /** 副标题节点标记。 */
      const LABEL_ATTR = 'data-swl-label';

      const MODES = ['all', 'flat', 'off'];
      const DEFAULT_MODE = 'flat';

      /** 与宿主 12px 轮廓图标同族的文件夹图标（currentColor，随主题走）。 */
      const ICON =
        '<svg class="swl_icon" width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<path d="M1.75 4.1c0-.61.49-1.1 1.1-1.1h3.2l1.25 1.5h5.85c.61 0 1.1.49 1.1 1.1v6.3c0 .61-.49 1.1-1.1 1.1H2.85c-.61 0-1.1-.49-1.1-1.1V4.1Z" ' +
        'stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/></svg>';

      const CSS = [
        '/* 会话行：标题区仍是 32px，下方留 14px 给工作区副标题。 */',
        'div[data-row-key^="session:"][' + ROW_ATTR + '] {',
        '  position: relative;',
        '  box-sizing: border-box !important;',
        '  height: 46px !important;',
        '  padding-bottom: 14px !important;',
        '}',
        '',
        '/* 副标题：与标题左缘对齐（8px padding + 16px 状态格 + 4px 标题间距）。 */',
        '.swl_label {',
        '  position: absolute;',
        '  left: calc(8px + var(--dsh-workspace-indent, 0px) + 20px);',
        '  right: 8px;',
        '  bottom: 2px;',
        '  display: flex;',
        '  align-items: center;',
        '  gap: 4px;',
        '  min-width: 0;',
        '  color: var(--dsw-alias-label-tertiary);',
        '  font-size: 11px;',
        '  line-height: 14px;',
        '  pointer-events: none;',
        '  overflow: hidden;',
        '}',
        '.swl_icon { flex: none; display: block; opacity: .85; }',
        '.swl_text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
        '',
        '/* ---- 通用设置行（swl_setting*） ---- */',
        '.swl_setting{border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:8px;padding:16px 0}',
        '.swl_head{display:flex;align-items:center;justify-content:space-between;gap:16px}',
        '.swl_copy{display:flex;flex-direction:column;gap:2px;min-width:0}',
        '.swl_title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}',
        '.swl_badge{display:inline-flex;align-items:center;flex:none;margin-left:8px;padding:0 6px;height:18px;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-weight:400;letter-spacing:.02em;white-space:nowrap;vertical-align:middle}',
        '.swl_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
        '.swl_choices{display:flex;align-items:center;gap:4px;flex:none;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}',
        '.swl_choice{padding:3px 10px;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}',
        '.swl_choice:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.swl_choice.swl_choiceActive{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        ''
      ].join('\n');

      const zh = {
        'row.title': '会话行工作区副标题',
        'row.badge': '插件',
        'row.badgeTitle': '由插件 {package} 提供',
        'row.description': '在单列表模式的会话标题下方显示所属工作区（参考 agy 会话列表）；分组视图默认不显示，避免与组头重复',
        'mode.all': '所有视图',
        'mode.flat': '仅单列表',
        'mode.off': '关闭',
        'label.ungrouped': '未分组'
      };
      const en = {
        'row.title': 'Workspace subtitle on session rows',
        'row.badge': 'Plugin',
        'row.badgeTitle': 'Provided by plugin {package}',
        'row.description': 'Shows each session\'s Workspace under its title in the flat list (like the agy session list); grouped views hide it by default so the group header is not repeated',
        'mode.all': 'All views',
        'mode.flat': 'Flat list only',
        'mode.off': 'Off',
        'label.ungrouped': 'Ungrouped'
      };

      let T = function (key) {
        return key;
      };

      // ---- 纯函数（可离线测试） -------------------------------------------

      /** Windows / POSIX 路径的 basename；空串原样返回。 */
      function baseName(path) {
        if (typeof path !== 'string' || path === '') return '';
        const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
        const index = normalized.lastIndexOf('/');
        return index === -1 ? normalized : normalized.slice(index + 1);
      }

      /**
       * Workspace 快照 → sessionId → 工作区显示名。
       * 标题为空时退回 path 的 basename；同一会话只记第一次出现。
       */
      function workspaceTitles(snapshot) {
        const titles = new Map();
        const items = snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.items) ? snapshot.items : [];
        for (const item of items) {
          if (item === null || typeof item !== 'object') continue;
          if (!Array.isArray(item.sessionIds)) continue;
          const raw = typeof item.title === 'string' ? item.title.trim() : '';
          const title = raw !== '' ? raw : baseName(item.path);
          if (title === '') continue;
          for (const id of item.sessionIds) {
            if (typeof id === 'string' && !titles.has(id)) titles.set(id, title);
          }
        }
        return titles;
      }

      /**
       * 一条会话的副标题：Workspace 标题 → cwd basename → 「未分组」。
       * @param {Map<string,string>} titles - workspaceTitles 的结果。
       * @param {object|null} byId - 会话快照的 byId。
       * @param {string} id - 会话 id。
       */
      function labelFor(titles, byId, id) {
        const fromWorkspace = titles.get(id);
        if (typeof fromWorkspace === 'string' && fromWorkspace !== '') return fromWorkspace;
        const summary = byId !== null && typeof byId === 'object' ? byId[id] : null;
        const fromCwd = summary === null || summary === undefined ? '' : baseName(summary.cwd);
        if (fromCwd !== '') return fromCwd;
        return T('label.ungrouped');
      }

      // ---- 持久化 ----------------------------------------------------------

      function readMode() {
        try {
          const raw = window.localStorage.getItem(STORE_KEY);
          return MODES.indexOf(raw) === -1 ? DEFAULT_MODE : raw;
        } catch (error) {
          return DEFAULT_MODE;
        }
      }

      function writeMode(mode) {
        try {
          if (mode === DEFAULT_MODE) window.localStorage.removeItem(STORE_KEY);
          else window.localStorage.setItem(STORE_KEY, mode);
        } catch (error) {
          /* 存储不可用：本次会话内仍然生效 */
        }
      }

      // ---- DOM 同步 --------------------------------------------------------

      let sessionStore = null;
      let workspaceStore = null;
      let activeMode = DEFAULT_MODE;
      let observer = null;
      let scheduled = 0;
      let storeUnsubscribes = [];

      /** 当前是否处于单列表视图（宿主 flat 列表容器的类名后缀是 `_flatList`）。 */
      function isFlatView() {
        return document.querySelector('[class*="_flatList"]') !== null;
      }

      function shouldPaint() {
        if (activeMode === 'off') return false;
        if (sessionStore === null && workspaceStore === null) return false;
        if (activeMode === 'flat' && !isFlatView()) return false;
        return true;
      }

      /** 读两份快照并建好索引；任何异常都退化为空数据而不是抛错。 */
      function readData() {
        let sessionSnapshot = null;
        let workspaceSnapshot = null;
        try {
          if (sessionStore !== null) sessionSnapshot = sessionStore.getSnapshot();
        } catch (error) {
          sessionSnapshot = null;
        }
        try {
          if (workspaceStore !== null) workspaceSnapshot = workspaceStore.getSnapshot();
        } catch (error) {
          workspaceSnapshot = null;
        }
        return {
          titles: workspaceTitles(workspaceSnapshot),
          byId: sessionSnapshot !== null && sessionSnapshot !== undefined && typeof sessionSnapshot.byId === 'object' ? sessionSnapshot.byId : null
        };
      }

      function paintRow(row, label) {
        let span = row.querySelector(':scope > span[' + LABEL_ATTR + ']');
        if (span === null) {
          span = document.createElement('span');
          span.setAttribute(LABEL_ATTR, '');
          span.className = 'swl_label';
          span.innerHTML = ICON + '<span class="swl_text"></span>';
          row.appendChild(span);
        }
        const text = span.querySelector('.swl_text');
        if (text !== null && text.textContent !== label) text.textContent = label;
        if (span.title !== label) span.title = label;
        if (!row.hasAttribute(ROW_ATTR)) row.setAttribute(ROW_ATTR, '');
      }

      function stripRow(row) {
        if (row.hasAttribute(ROW_ATTR)) row.removeAttribute(ROW_ATTR);
        const span = row.querySelector(':scope > span[' + LABEL_ATTR + ']');
        if (span !== null) span.remove();
      }

      function stripAll() {
        if (typeof document === 'undefined') return;
        const marked = document.querySelectorAll('div[' + ROW_ATTR + ']');
        for (const row of marked) row.removeAttribute(ROW_ATTR);
        const labels = document.querySelectorAll('span[' + LABEL_ATTR + ']');
        for (const span of labels) span.remove();
      }

      /** 全量对齐一次：缺的补、变的重写、不该有的清掉。 */
      function syncRows() {
        if (typeof document === 'undefined') return;
        if (!shouldPaint()) {
          stripAll();
          return;
        }
        const data = readData();
        const rows = document.querySelectorAll(ROW_SELECTOR);
        for (const row of rows) {
          const key = row.getAttribute('data-row-key');
          if (typeof key !== 'string' || key.length <= 8) continue;
          /* 只认宿主自己的行：它至少有一个标题 span（`_title` 后缀）。 */
          if (row.querySelector(':scope > span[class$="_title"]') === null) {
            stripRow(row);
            continue;
          }
          const label = labelFor(data.titles, data.byId, key.slice(8));
          if (label === '') stripRow(row);
          else paintRow(row, label);
        }
      }

      function scheduleSync(delay) {
        if (typeof window === 'undefined') return;
        if (scheduled !== 0) window.clearTimeout(scheduled);
        scheduled = window.setTimeout(function () {
          scheduled = 0;
          syncRows();
        }, typeof delay === 'number' ? delay : 120);
      }

      function setActiveMode(mode) {
        activeMode = MODES.indexOf(mode) === -1 ? DEFAULT_MODE : mode;
        scheduleSync(0);
      }

      // ---- 设置行 ----------------------------------------------------------

      function WorkspaceLabelRow() {
        const [mode, setMode] = React.useState(activeMode);
        const pick = (next) => {
          writeMode(next);
          setMode(next);
          setActiveMode(next);
        };
        return h(
          'div',
          {
            className: 'swl_setting',
            'data-plugin-setting': ROW_ID,
            'data-plugin-package': PLUGIN_PACKAGE
          },
          h(
            'div',
            { className: 'swl_head' },
            h(
              'div',
              { className: 'swl_copy' },
              h(
                'div',
                { className: 'swl_title' },
                T('row.title'),
                h(
                  'span',
                  { className: 'swl_badge', title: T('row.badgeTitle', { package: PLUGIN_PACKAGE }) },
                  T('row.badge')
                )
              ),
              h('div', { className: 'swl_desc' }, T('row.description'))
            ),
            h(
              'div',
              { className: 'swl_choices', role: 'group' },
              MODES.map((m) =>
                h(
                  'button',
                  {
                    key: m,
                    type: 'button',
                    className: 'swl_choice' + (mode === m ? ' swl_choiceActive' : ''),
                    'aria-pressed': mode === m,
                    onClick: () => pick(m)
                  },
                  T('mode.' + m)
                )
              )
            )
          )
        );
      }

      // ---- 装配 ------------------------------------------------------------

      function resolveStores(ctx) {
        try {
          const sessions = ctx.get('sessions');
          if (sessions !== null && sessions !== undefined && sessions.list !== null && sessions.list !== undefined) {
            sessionStore = sessions.list;
          }
        } catch (error) {
          sessionStore = null;
        }
        try {
          const workspaces = ctx.get('workspaces');
          if (workspaces !== null && workspaces !== undefined && workspaces.list !== null && workspaces.list !== undefined) {
            workspaceStore = workspaces.list;
          }
        } catch (error) {
          workspaceStore = null;
        }
      }

      function subscribeStores() {
        const offs = [];
        if (sessionStore !== null && typeof sessionStore.subscribe === 'function') {
          offs.push(sessionStore.subscribe(function () {
            scheduleSync();
          }));
        }
        if (workspaceStore !== null && typeof workspaceStore.subscribe === 'function') {
          offs.push(workspaceStore.subscribe(function () {
            scheduleSync();
          }));
        }
        storeUnsubscribes = offs;
        return function () {
          for (const off of storeUnsubscribes) {
            try {
              off();
            } catch (error) {
              /* 订阅已随服务销毁：忽略 */
            }
          }
          storeUnsubscribes = [];
        };
      }

      function mountStyles() {
        if (typeof document === 'undefined') return function () {};
        if (document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]') !== null) return function () {};
        const tag = document.createElement('style');
        tag.dataset.plugin = PLUGIN_PACKAGE;
        tag.dataset.pluginCss = STYLE_TAG_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return function () {
          tag.remove();
        };
      }

      function mountObserver() {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return function () {};
        observer = new MutationObserver(function (records) {
          for (const record of records) {
            if (record.type !== 'childList') continue;
            if (record.addedNodes.length === 0 && record.removedNodes.length === 0) continue;
            scheduleSync();
            return;
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        scheduleSync(0);
        return function () {
          if (observer !== null) {
            observer.disconnect();
            observer = null;
          }
          if (scheduled !== 0) {
            window.clearTimeout(scheduled);
            scheduled = 0;
          }
          stripAll();
        };
      }

      const inject = ['slots', 'locale', 'sessions', 'workspaces'];

      function apply(ctx) {
        ctx.effect(mountStyles, 'session-workspace-label: stylesheet');
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        }, 'session-workspace-label: dictionaries');

        T = ctx.locale.bind(NS);
        activeMode = readMode();
        resolveStores(ctx);

        ctx.effect(subscribeStores, 'session-workspace-label: store subscriptions');
        ctx.effect(mountObserver, 'session-workspace-label: row observer');

        ctx.slots.inject('settings.general.item', function () {
          return ctx.slots.register(
            {
              name: 'settings.general.item',
              id: ROW_ID,
              order: 16,
              locale: NS
            },
            WorkspaceLabelRow
          );
        });
      }

      return {
        inject: inject,
        apply: apply,
        __test: {
          NS: NS,
          STORE_KEY: STORE_KEY,
          STYLE_TAG_ID: STYLE_TAG_ID,
          ROW_ATTR: ROW_ATTR,
          LABEL_ATTR: LABEL_ATTR,
          ROW_SELECTOR: ROW_SELECTOR,
          MODES: MODES,
          DEFAULT_MODE: DEFAULT_MODE,
          CSS: CSS,
          baseName: baseName,
          workspaceTitles: workspaceTitles,
          labelFor: labelFor
        }
      };
    }
  });
})();
