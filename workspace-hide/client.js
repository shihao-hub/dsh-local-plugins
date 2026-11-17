/**
 * 侧栏「工作区隐藏」。
 *
 * 背景：宿主（dsh-client-ui-workspace）只给**会话行**开了两个菜单/动作 seat，
 * 工作区行的 `…` 菜单（重命名 / 删除工作区）与「视图选项」菜单都是组件内部
 * 写死的 items，没有插件扩展点；WorkspaceView 也没有 hidden/archived 字段。
 * 但工作区行 DOM 很稳定：
 *
 *   div[data-row-key="workspace:<id>"]                 (projectRow)
 *     ↑ span（AnimatedRows 的行包装）
 *       ↑ div（groupSection：组头 + 子组 + 该组会话）
 *
 * 所以本插件只在渲染结果上做三件事：
 *   1. 在「工作区 …」菜单里追加一条「隐藏工作区」（插在删除之前）；
 *   2. 在「视图选项」菜单末尾追加「工作区 → 管理已隐藏工作区 (N)…」；
 *   3. 给隐藏工作区所在的 groupSection 加 `data-wh-group-hidden`（CSS 整组收起），
 *      单列表模式下则按 workspace.sessionIds 给会话行加 `data-wh-row-hidden`。
 *
 * 隐藏集合存在两处：localStorage 负责首屏即时渲染；Host 半区的
 * `/plugins/workspace-hide/state` 负责跨浏览器（web 构建）持久化。
 * 宿主的工作区注册、会话日志与项目目录一概不动；恢复入口始终保留在
 * 视图选项菜单与「设置 → 通用设置」里，并带 3 秒 toast 撤销。
 *
 * 失败策略：所有 DOM 注入都包 try/catch，宿主结构变化时退化为「菜单不注入」，
 * 但设置行与管理浮层仍可用，界面不报错。
 */
(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/workspace-hide',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      /** 浮层必须挂到 body：shell.overlay 在 z-index 20 的 stacking context 内。 */
      let reactDom = null;
      try {
        reactDom = require('react-dom');
      } catch (error) {
        reactDom = null;
      }

      const NS = 'workspace-hide';
      const PLUGIN_PACKAGE = '@local/workspace-hide';
      const ROW_ID = 'workspace-hide';
      const STORE_KEY = 'workspace-hide.v1';
      const ROUTE_PATH = '/plugins/workspace-hide/state';
      const GUARD_HEADER = 'x-workspace-hide';
      const STYLE_TAG_ID = '@local/workspace-hide/rows.css';
      const ATTR_GROUP = 'data-wh-group-hidden';
      const ATTR_ROW = 'data-wh-row-hidden';
      const ATTR_MENU = 'data-wh-menu';
      const ATTR_PROCESSED = 'data-wh-menu-processed';
      const MENU_WINDOW_MS = 900;
      const MAX_HIDDEN = 500;
      const SYNC_DELAY_MS = 80;
      const PUSH_DELAY_MS = 350;
      const TOAST_MS = 3200;

      /**
       * 运行期文案。设置页的插件名/简介来自 locale/*.json 的 meta，
       * 这里的字典只服务界面注入内容，键集必须 zh/en 对齐。
       */
      const zh = {
        'menu.hide': '隐藏工作区',
        'menu.hideAria': '隐藏工作区「{name}」',
        'view.label': '工作区',
        'view.manage': '管理已隐藏工作区（{n}）…',
        'panel.title': '已隐藏的工作区',
        'panel.empty': '没有隐藏的工作区。',
        'panel.hint': '隐藏只影响侧栏显示，不删除工作区注册，也不影响会话内容。',
        'panel.count': '{n} 个会话',
        'panel.pathUnknown': '工作区记录已不存在，可直接移出隐藏列表。',
        'panel.restore': '恢复',
        'panel.restoreAll': '全部恢复',
        'panel.close': '关闭',
        'toast.hidden': '已隐藏「{name}」',
        'toast.undo': '撤销',
        'row.title': '工作区隐藏',
        'row.description': '把不常用工作区从侧栏隐藏（不删除注册）；可在视图选项菜单或此处管理已隐藏项。',
        'row.manage': '管理已隐藏工作区（{n}）',
        'row.badge': '插件',
        'row.badgeTitle': '来自本地插件 {package}'
      };

      const en = {
        'menu.hide': 'Hide workspace',
        'menu.hideAria': 'Hide workspace "{name}"',
        'view.label': 'Workspaces',
        'view.manage': 'Manage hidden workspaces ({n})…',
        'panel.title': 'Hidden workspaces',
        'panel.empty': 'No hidden workspaces.',
        'panel.hint': 'Hiding only affects the sidebar; workspace registration and session content are untouched.',
        'panel.count': '{n} sessions',
        'panel.pathUnknown': 'The workspace record is gone; remove it from the hidden list.',
        'panel.restore': 'Restore',
        'panel.restoreAll': 'Restore all',
        'panel.close': 'Close',
        'toast.hidden': 'Hidden "{name}"',
        'toast.undo': 'Undo',
        'row.title': 'Workspace hide',
        'row.description': 'Hide infrequently used workspaces from the sidebar without deleting them; manage the list here or from the view-options menu.',
        'row.manage': 'Manage hidden workspaces ({n})',
        'row.badge': 'Plugin',
        'row.badgeTitle': 'From the local plugin {package}'
      };

      /** 与宿主 16px 线性图标同族的「隐藏」图标（currentColor）。 */
      const EYE_OFF_ICON =
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
        'stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M2.2 2.2l11.6 11.6"/>' +
        '<path d="M6.55 6.55a2.05 2.05 0 0 0 2.9 2.9"/>' +
        '<path d="M4.15 4.55C2.9 5.45 2 6.65 1.5 8c1.2 2.6 3.7 4.5 6.5 4.5 1.05 0 2.05-.25 2.95-.7"/>' +
        '<path d="M9.6 4.85c.3.1.6.2.9.35 1.15.55 2.1 1.5 2.7 2.8-.3.65-.7 1.25-1.2 1.75"/>' +
        '</svg>';

      const CSS = [
        '/* 组容器整组收起（组头、子组、会话、显示更多按钮一起） */',
        '[' + ATTR_GROUP + ']{display:none !important;}',
        '/* 单列表模式：归属隐藏工作区的会话行 */',
        '[' + ATTR_ROW + ']{display:none !important;}',

        '/* 设置行 */',
        '.wh_setting{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:6px 0}',
        '.wh_settingMain{min-width:0;flex:1 1 auto}',
        '.wh_settingTitle{display:flex;align-items:center;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}',
        '.wh_badge{display:inline-flex;align-items:center;flex:none;margin-left:8px;padding:0 6px;height:18px;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-weight:400;letter-spacing:.02em;white-space:nowrap;vertical-align:middle}',
        '.wh_desc{margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.55}',
        '.wh_btn{display:inline-flex;align-items:center;justify-content:center;flex:none;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-3, transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
        '.wh_btn:hover{background:var(--dsw-alias-bg-layer-4, rgba(127,127,127,.12))}',
        '.wh_btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4c8dff);outline-offset:1px}',
        '.wh_primary{color:var(--dsw-alias-brand-primary, #4c8dff);border-color:currentColor}',

        '/* 管理浮层 */',
        '.wh_veil{position:fixed;inset:0;z-index:1200;display:flex;align-items:flex-start;justify-content:center;padding:14vh 16px 16px;background:rgba(0,0,0,.42)}',
        '.wh_dialog{display:flex;flex-direction:column;width:min(480px,calc(100vw - 32px));max-height:70vh;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2, #2b2b2b);box-shadow:0 18px 48px rgba(0,0,0,.45);color:var(--dsw-alias-label-primary);overflow:hidden}',
        '.wh_head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px 8px}',
        '.wh_headTitle{font-size:14px;font-weight:600}',
        '.wh_close{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;border-radius:5px;background:0 0;color:var(--dsw-alias-label-tertiary);font-size:18px;line-height:1;cursor:pointer}',
        '.wh_close:hover{background:var(--dsw-alias-bg-layer-4, rgba(127,127,127,.14));color:var(--dsw-alias-label-primary)}',
        '.wh_hint{padding:0 16px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.55}',
        '.wh_list{min-height:0;overflow:auto;padding:0 8px;border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2)}',
        '.wh_item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 8px}',
        '.wh_item + .wh_item{border-top:1px solid var(--dsw-alias-border-l2)}',
        '.wh_itemMain{min-width:0;flex:1 1 auto}',
        '.wh_name{font-size:13px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.wh_path{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.wh_meta{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
        '.wh_empty{padding:20px 8px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}',
        '.wh_foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px}',

        '/* 瞬时提示 */',
        '.wh_toast{position:fixed;left:50%;bottom:24px;z-index:1300;display:flex;align-items:center;gap:12px;max-width:min(560px,calc(100vw - 32px));padding:9px 12px 9px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2, #2b2b2b);box-shadow:0 10px 32px rgba(0,0,0,.45);color:var(--dsw-alias-label-primary);font-size:12px;transform:translateX(-50%)}',
        '.wh_toastText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.wh_toastAction{flex:none;border:0;background:0 0;color:var(--dsw-alias-brand-primary, #4c8dff);font:inherit;font-size:12px;cursor:pointer;padding:2px 4px;border-radius:4px}',
        '.wh_toastAction:hover{background:var(--dsw-alias-bg-layer-4, rgba(127,127,127,.14))}'
      ].join('\n');

      // ---- 模块级状态 -------------------------------------------------------

      /** 当前 locale 取词函数；apply 之前保持透传。 */
      let T = function (key) {
        return key;
      };

      /** 已隐藏的 workspaceId 集合。 */
      let hidden = new Set();
      let workspaceStore = null;
      let sessionStore = null;
      let workspaceSnapshot = null;
      let sessionSnapshot = null;
      let observer = null;
      let scheduled = 0;
      let storeUnsubscribes = [];
      let pendingMenu = null;
      let pendingTimer = 0;
      let pushTimer = 0;
      let routeState = 'unknown'; // unknown | ok | missing
      /** 启动拉取完成前用户已改动时，远端数据不得覆盖本地（改完直接推上去）。 */
      let localTouched = false;
      let panelOpen = false;
      const panelListeners = new Set();
      let toastState = null;
      const toastListeners = new Set();
      let toastTimer = 0;

      // ---- 纯函数（可单测） -------------------------------------------------

      /** 规范隐藏集合：只留非空字符串、去重、封顶。也接受 `{ hidden: [...] }`。 */
      function normalizeHidden(raw) {
        const list = Array.isArray(raw)
          ? raw
          : raw !== null && typeof raw === 'object' && Array.isArray(raw.hidden)
            ? raw.hidden
            : [];
        const out = [];
        const seen = new Set();
        for (const item of list) {
          if (typeof item !== 'string') continue;
          const id = item.trim();
          if (id === '' || seen.has(id)) continue;
          seen.add(id);
          out.push(id);
          if (out.length >= MAX_HIDDEN) break;
        }
        return out;
      }

      /** 路径 basename（同时吃 Windows 与 POSIX 分隔符）。 */
      function baseName(value) {
        if (typeof value !== 'string' || value === '') return '';
        const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
        const index = normalized.lastIndexOf('/');
        return index === -1 ? normalized : normalized.slice(index + 1);
      }

      /** 比较用路径：统一分隔符、去尾斜杠、Windows 下忽略大小写。 */
      function normalizePath(value) {
        return typeof value === 'string'
          ? value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
          : '';
      }

      /** 工作区显示名：标题 → 路径 basename → 空串（调用方再降级成 id）。 */
      function workspaceName(item) {
        if (item === null || typeof item !== 'object') return '';
        const title = typeof item.title === 'string' ? item.title.trim() : '';
        if (title !== '') return title;
        return baseName(item.path);
      }

      /** 由工作区快照的 sessionIds 建 sessionId → workspaceId 映射。 */
      function ownerMapOf(items) {
        const map = new Map();
        for (const item of items) {
          if (item === null || typeof item !== 'object' || !Array.isArray(item.sessionIds)) continue;
          for (const id of item.sessionIds) {
            if (typeof id === 'string' && !map.has(id)) map.set(id, item.workspaceId);
          }
        }
        return map;
      }

      /** 账本未覆盖时的兜底：会话 cwd 落在某个工作区路径之下（取最深前缀）。 */
      function ownerFromCwd(items, cwd) {
        const normalized = normalizePath(cwd);
        if (normalized === '') return undefined;
        let best = null;
        for (const item of items) {
          if (item === null || typeof item !== 'object') continue;
          const path = normalizePath(item.path);
          if (path === '') continue;
          if (normalized === path || normalized.startsWith(path + '/')) {
            if (best === null || path.length > best.path.length) best = { id: item.workspaceId, path: path };
          }
        }
        return best === null ? undefined : best.id;
      }

      /** 「视图选项」触发按钮的 aria-label（宿主字典 zh/en）。 */
      function isViewOptionsLabel(label) {
        if (typeof label !== 'string') return false;
        const text = label.trim();
        return text === '视图选项' || text === '筛选' || /^view options$/i.test(text);
      }

      /**
       * 菜单归属判定：工作区菜单只有 2 项（重命名/删除），视图选项菜单 ≥5 项。
       * 允许工作区菜单出现 1～3 项，给宿主后续追加留余量。
       */
      function menuActionFor(kind, itemCount) {
        if (kind === 'workspace' && itemCount >= 1 && itemCount <= 3) return 'workspace';
        if (kind === 'view' && itemCount >= 5) return 'view';
        return null;
      }

      // ---- 数据读取 ---------------------------------------------------------

      function workspaceItems() {
        if (workspaceSnapshot !== null && Array.isArray(workspaceSnapshot.items)) {
          return workspaceSnapshot.items;
        }
        if (workspaceStore !== null && typeof workspaceStore.getSnapshot === 'function') {
          try {
            const snap = workspaceStore.getSnapshot();
            if (snap !== null && Array.isArray(snap.items)) return snap.items;
          } catch (error) {
            /* 快照暂不可用：按空处理 */
          }
        }
        return [];
      }

      function sessionById() {
        const snap = sessionSnapshot;
        if (snap !== null && typeof snap === 'object' && snap.byId !== null && typeof snap.byId === 'object') {
          return snap.byId;
        }
        return null;
      }

      function nameOfWorkspace(id) {
        let item = null;
        for (const candidate of workspaceItems()) {
          if (candidate !== null && typeof candidate === 'object' && candidate.workspaceId === id) {
            item = candidate;
            break;
          }
        }
        const name = workspaceName(item);
        return name === '' ? id.slice(0, 8) : name;
      }

      function countSessions(id) {
        for (const candidate of workspaceItems()) {
          if (candidate !== null && typeof candidate === 'object' && candidate.workspaceId === id) {
            return Array.isArray(candidate.sessionIds) ? candidate.sessionIds.length : 0;
          }
        }
        return 0;
      }

      function findWorkspace(id) {
        for (const candidate of workspaceItems()) {
          if (candidate !== null && typeof candidate === 'object' && candidate.workspaceId === id) {
            return candidate;
          }
        }
        return null;
      }

      // ---- 持久化 -----------------------------------------------------------

      function readLocal() {
        try {
          if (typeof localStorage === 'undefined') return [];
          const raw = localStorage.getItem(STORE_KEY);
          if (raw === null) return [];
          return normalizeHidden(JSON.parse(raw));
        } catch (error) {
          return [];
        }
      }

      function writeLocal() {
        try {
          if (typeof localStorage === 'undefined') return;
          localStorage.setItem(STORE_KEY, JSON.stringify({ hidden: Array.from(hidden) }));
        } catch (error) {
          /* 隐私模式/配额满：保留内存状态，不回写 */
        }
      }

      function remoteHeaders(extra) {
        const headers = {};
        headers[GUARD_HEADER] = '1';
        if (extra !== undefined) {
          for (const key of Object.keys(extra)) headers[key] = extra[key];
        }
        return headers;
      }

      /** 启动拉取一次；远端有数据时以远端为准（换浏览器/清站点数据后恢复）。 */
      function pullRemote() {
        if (typeof fetch !== 'function') return;
        fetch(ROUTE_PATH, { method: 'GET', headers: remoteHeaders(), cache: 'no-store' })
          .then(function (response) {
            return response.ok ? response.json() : null;
          })
          .then(function (payload) {
            if (payload === null || payload.ok !== true) {
              routeState = 'missing';
              return;
            }
            routeState = 'ok';
            if (localTouched) {
              schedulePush();
              return;
            }
            const data = payload.data;
            if (data !== null && typeof data === 'object' && Array.isArray(data.hidden)) {
              hidden = new Set(normalizeHidden(data.hidden));
              writeLocal();
              scheduleSync(0);
              notifyPanel();
              return;
            }
            schedulePush();
          })
          .catch(function () {
            routeState = 'missing';
          });
      }

      function schedulePush() {
        if (pushTimer !== 0) clearTimeout(pushTimer);
        pushTimer = setTimeout(pushRemote, PUSH_DELAY_MS);
      }

      function pushRemote() {
        pushTimer = 0;
        if (routeState === 'missing' || typeof fetch !== 'function') return;
        fetch(ROUTE_PATH, {
          method: 'PUT',
          headers: remoteHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({ data: { hidden: Array.from(hidden) } })
        })
          .then(function (response) {
            routeState = response.ok ? 'ok' : 'missing';
          })
          .catch(function () {
            /* 保留本地状态；下次变更或下次启动再推 */
          });
      }

      /** 工作区列表就绪后清理已不存在记录的 id（避免幽灵状态），未就绪不动。 */
      function pruneHidden() {
        const snap = workspaceStore !== null ? workspaceStore.getSnapshot() : null;
        const items = snap !== null && Array.isArray(snap.items) ? snap.items : [];
        if (snap === null || snap.phase !== 'ready' || items.length === 0) return;
        const alive = new Set();
        for (const item of items) {
          if (item !== null && typeof item === 'object' && typeof item.workspaceId === 'string') {
            alive.add(item.workspaceId);
          }
        }
        let changed = false;
        for (const id of Array.from(hidden)) {
          if (!alive.has(id)) {
            hidden.delete(id);
            changed = true;
          }
        }
        if (changed) {
          writeLocal();
          schedulePush();
        }
      }

      // ---- 状态变更 ---------------------------------------------------------

      function hideWorkspace(id) {
        if (typeof id !== 'string' || id === '') return;
        if (hidden.has(id)) return;
        hidden.add(id);
        localTouched = true;
        writeLocal();
        schedulePush();
        scheduleSync(0);
        notifyPanel();
        showToast(T('toast.hidden', { name: nameOfWorkspace(id) }), function () {
          unhideWorkspace(id);
        });
      }

      function unhideWorkspace(id) {
        if (typeof id !== 'string' || !hidden.has(id)) return;
        hidden.delete(id);
        localTouched = true;
        writeLocal();
        schedulePush();
        scheduleSync(0);
        notifyPanel();
      }

      function unhideAll() {
        if (hidden.size === 0) return;
        hidden = new Set();
        localTouched = true;
        writeLocal();
        schedulePush();
        scheduleSync(0);
        notifyPanel();
      }

      // ---- DOM 同步 ---------------------------------------------------------

      function rowKey(element) {
        const key = element.getAttribute('data-row-key');
        return typeof key === 'string' ? key : '';
      }

      function idFromKey(key) {
        const index = key.indexOf(':');
        return index === -1 ? '' : key.slice(index + 1);
      }

      /**
       * 由工作区行找到它的 groupSection：行 → span（行包装）→ groupSection。
       * 只认「直接子行就是这一行」的容器，避免误把整个列表当成组。
       */
      function groupOf(row) {
        const wrapper = row.parentElement;
        if (wrapper === null) return null;
        const group = wrapper.parentElement;
        if (group === null || group === row) return null;
        const direct =
          group.querySelector(':scope > span > div[data-row-key^="workspace:"]') ||
          group.querySelector(':scope > div[data-row-key^="workspace:"]');
        return direct === row ? group : null;
      }

      /** 给会话行加隐藏标记；连同单行包装 span 一起（避免外层留出空高）。 */
      function setRowHidden(row, hide) {
        const wrapper = row.parentElement;
        if (hide) {
          if (!row.hasAttribute(ATTR_ROW)) row.setAttribute(ATTR_ROW, '1');
          if (
            wrapper !== null &&
            wrapper.children.length === 1 &&
            !wrapper.hasAttribute('data-row-key') &&
            !wrapper.hasAttribute(ATTR_ROW)
          ) {
            wrapper.setAttribute(ATTR_ROW, '1');
          }
        } else {
          if (row.hasAttribute(ATTR_ROW)) row.removeAttribute(ATTR_ROW);
          if (wrapper !== null && wrapper.hasAttribute(ATTR_ROW)) wrapper.removeAttribute(ATTR_ROW);
        }
      }

      function syncRows() {
        if (typeof document === 'undefined') return;
        const items = workspaceItems();
        const owners = ownerMapOf(items);
        const byId = sessionById();

        // 工作区组：隐藏 id 对应的 groupSection 整组收起
        const seen = new Set();
        for (const row of document.querySelectorAll('div[data-row-key^="workspace:"]')) {
          const group = groupOf(row);
          if (group === null) continue;
          seen.add(group);
          const id = idFromKey(rowKey(row));
          if (hidden.has(id)) {
            if (!group.hasAttribute(ATTR_GROUP)) group.setAttribute(ATTR_GROUP, '1');
          } else if (group.hasAttribute(ATTR_GROUP)) {
            group.removeAttribute(ATTR_GROUP);
          }
        }
        for (const group of document.querySelectorAll('[' + ATTR_GROUP + ']')) {
          if (group.isConnected && !seen.has(group)) group.removeAttribute(ATTR_GROUP);
        }

        // 会话行：分组模式下已随组隐藏；单列表模式按归属过滤
        for (const row of document.querySelectorAll('div[data-row-key^="session:"]')) {
          const sessionId = idFromKey(rowKey(row));
          let owner = owners.get(sessionId);
          if (owner === undefined && byId !== null && byId[sessionId] !== undefined) {
            owner = ownerFromCwd(items, byId[sessionId].cwd);
          }
          setRowHidden(row, owner !== undefined && hidden.has(owner));
        }
      }

      function scheduleSync(delay) {
        if (typeof window === 'undefined') return;
        if (scheduled !== 0) window.clearTimeout(scheduled);
        scheduled = window.setTimeout(function () {
          scheduled = 0;
          syncRows();
        }, typeof delay === 'number' ? delay : SYNC_DELAY_MS);
      }

      // ---- 菜单注入 ---------------------------------------------------------

      function isElement(node) {
        return node !== null && typeof node === 'object' && node.nodeType === 1;
      }

      function armMenu(pending) {
        pendingMenu = { kind: pending.kind, id: pending.id, at: Date.now() };
        if (pendingTimer !== 0) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(function () {
          pendingMenu = null;
          pendingTimer = 0;
        }, MENU_WINDOW_MS + 150);
      }

      function onMouseDown(event) {
        const target = event.target;
        const element =
          target !== null && target !== undefined && target.nodeType === 3 ? target.parentElement : target;
        if (element === null || element === undefined || typeof element.closest !== 'function') return;
        const button = element.closest('button');
        if (button === null) return;

        const row = button.closest('div[data-row-key^="workspace:"]');
        if (row !== null) {
          const id = idFromKey(rowKey(row));
          if (id !== '') armMenu({ kind: 'workspace', id: id });
          return;
        }
        if (isViewOptionsLabel(button.getAttribute('aria-label'))) {
          armMenu({ kind: 'view' });
        }
      }

      function closeHostMenu() {
        if (typeof document === 'undefined') return;
        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } catch (error) {
          /* 没有 KeyboardEvent 的环境忽略 */
        }
      }

      function handleMenu(menu) {
        if (menu.hasAttribute(ATTR_PROCESSED)) return;
        const count = menu.querySelectorAll('button[role="menuitem"]').length;
        if (count === 0) return;
        const pending = pendingMenu;
        if (pending === null) return;
        if (Date.now() - pending.at > MENU_WINDOW_MS) return;
        const action = menuActionFor(pending.kind, count);
        if (action === null) return;
        if (action === 'workspace') {
          if (injectWorkspaceItem(menu, pending.id)) {
            menu.setAttribute(ATTR_PROCESSED, 'workspace');
            pendingMenu = null;
          }
        } else if (injectViewItem(menu)) {
          menu.setAttribute(ATTR_PROCESSED, 'view');
          pendingMenu = null;
        }
      }

      function scanForMenus(node) {
        if (!isElement(node)) return;
        if (node.matches !== undefined && node.matches('[role="menu"]')) handleMenu(node);
        if (node.querySelectorAll !== undefined) {
          for (const menu of node.querySelectorAll('[role="menu"]')) handleMenu(menu);
        }
      }

      function onMutations(records) {
        let structureChanged = false;
        for (const record of records) {
          if (record.type !== 'childList') continue;
          for (const node of record.addedNodes) {
            if (isElement(node)) {
              scanForMenus(node);
              structureChanged = true;
            }
          }
          if (record.removedNodes.length > 0) structureChanged = true;
        }
        if (structureChanged) scheduleSync();
      }

      /** 在工作区菜单（重命名/删除）里追加「隐藏工作区」，插到删除之前。 */
      function injectWorkspaceItem(menu, id) {
        try {
          const buttons = Array.from(menu.querySelectorAll('button[role="menuitem"]'));
          if (buttons.length === 0) return false;
          let anchor = null;
          for (const button of buttons) {
            if (/删除|delete/i.test(button.textContent || '')) {
              anchor = button;
              break;
            }
          }
          if (anchor === null) anchor = buttons[buttons.length - 1];
          const wrap = anchor.parentElement;
          if (wrap === null || wrap.parentElement === null) return false;

          const clone = wrap.cloneNode(true);
          const button = clone.querySelector('button');
          if (button === null) return false;
          const spans = Array.from(button.children).filter(function (child) {
            return child.tagName === 'SPAN';
          });
          const labelSpan = spans.length > 0 ? spans[spans.length - 1] : null;
          const iconSpan = spans.length > 1 ? spans[0] : null;
          if (labelSpan === null) return false;

          for (const className of Array.from(button.classList)) {
            if (/danger/i.test(className)) button.classList.remove(className);
          }
          button.setAttribute(ATTR_MENU, 'workspace');
          button.setAttribute('aria-label', T('menu.hideAria', { name: nameOfWorkspace(id) }));
          labelSpan.textContent = T('menu.hide');
          if (iconSpan !== null) iconSpan.innerHTML = EYE_OFF_ICON;
          button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            hideWorkspace(id);
            closeHostMenu();
          });

          wrap.parentElement.insertBefore(clone, wrap);
          return true;
        } catch (error) {
          console.warn('workspace-hide: workspace menu injection failed', error);
          return false;
        }
      }

      /** 在视图选项菜单末尾追加「工作区 → 管理已隐藏工作区 (N)…」。 */
      function injectViewItem(menu) {
        try {
          const presentation = menu.querySelector('[role="presentation"]');
          if (presentation === null) return false;
          const buttons = Array.from(menu.querySelectorAll('button[role="menuitem"]'));
          if (buttons.length === 0) return false;
          const lastWrap = buttons[buttons.length - 1].parentElement;
          if (lastWrap === null) return false;

          const labels = Array.from(presentation.children).filter(function (child) {
            return (
              child.tagName === 'DIV' &&
              child.getAttribute('role') === 'presentation' &&
              child.textContent.trim() !== '' &&
              child.querySelector('button') === null
            );
          });
          const labelTemplate = labels.length > 0 ? labels[labels.length - 1] : null;
          if (labelTemplate === null) return false;
          const separators = Array.from(presentation.querySelectorAll('[role="separator"]'));
          const separatorTemplate = separators.length > 0 ? separators[separators.length - 1] : null;

          const labelClone = labelTemplate.cloneNode(true);
          labelClone.textContent = T('view.label');

          const itemClone = lastWrap.cloneNode(true);
          const button = itemClone.querySelector('button');
          if (button === null) return false;
          const spans = Array.from(button.children).filter(function (child) {
            return child.tagName === 'SPAN';
          });
          const labelSpan = spans.length > 0 ? spans[spans.length - 1] : null;
          const iconSpan = spans.length > 1 ? spans[0] : null;
          if (labelSpan === null) return false;

          for (const className of Array.from(button.classList)) {
            if (/danger|selected/i.test(className)) button.classList.remove(className);
          }
          for (const child of Array.from(button.children)) {
            if (child.tagName === 'svg') button.removeChild(child);
          }
          button.setAttribute(ATTR_MENU, 'view');
          labelSpan.textContent = T('view.manage', { n: hidden.size });
          if (iconSpan !== null) iconSpan.innerHTML = EYE_OFF_ICON;
          button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            closeHostMenu();
            openPanel();
          });

          if (separatorTemplate !== null) presentation.appendChild(separatorTemplate.cloneNode(true));
          presentation.appendChild(labelClone);
          presentation.appendChild(itemClone);
          return true;
        } catch (error) {
          console.warn('workspace-hide: view menu injection failed', error);
          return false;
        }
      }

      // ---- 浮层状态 ---------------------------------------------------------

      function panelSubscribe(listener) {
        panelListeners.add(listener);
        return function () {
          panelListeners.delete(listener);
        };
      }

      function notifyPanel() {
        for (const listener of Array.from(panelListeners)) {
          try {
            listener();
          } catch (error) {
            /* 单个订阅者异常不拖垮其它组件 */
          }
        }
      }

      function openPanel() {
        panelOpen = true;
        notifyPanel();
      }

      function closePanel() {
        panelOpen = false;
        notifyPanel();
      }

      function toastSubscribe(listener) {
        toastListeners.add(listener);
        return function () {
          toastListeners.delete(listener);
        };
      }

      function notifyToast() {
        for (const listener of Array.from(toastListeners)) {
          try {
            listener();
          } catch (error) {
            /* 同上 */
          }
        }
      }

      function clearToast() {
        if (toastTimer !== 0) {
          clearTimeout(toastTimer);
          toastTimer = 0;
        }
        toastState = null;
        notifyToast();
      }

      function showToast(message, undo) {
        if (toastTimer !== 0) clearTimeout(toastTimer);
        toastState = { message: message, undo: undo };
        notifyToast();
        toastTimer = setTimeout(function () {
          toastTimer = 0;
          toastState = null;
          notifyToast();
        }, TOAST_MS);
      }

      // ---- React 组件 -------------------------------------------------------

      function portalToBody(element) {
        if (
          reactDom !== null &&
          reactDom !== undefined &&
          typeof reactDom.createPortal === 'function' &&
          typeof document !== 'undefined' &&
          document.body !== null
        ) {
          return reactDom.createPortal(element, document.body);
        }
        return element;
      }

      function withPortal(Component) {
        return function Portaled(props) {
          const inner = React.createElement(Component, props);
          return inner === null || inner === undefined ? null : portalToBody(inner);
        };
      }

      function SettingsRow() {
        const [count, setCount] = React.useState(hidden.size);
        React.useEffect(function () {
          return panelSubscribe(function () {
            setCount(hidden.size);
          });
        }, []);
        return h(
          'div',
          {
            className: 'wh_setting',
            'data-plugin-setting': ROW_ID,
            'data-plugin-package': PLUGIN_PACKAGE
          },
          h(
            'div',
            { className: 'wh_settingMain' },
            h(
              'div',
              { className: 'wh_settingTitle' },
              T('row.title'),
              h(
                'span',
                { className: 'wh_badge', title: T('row.badgeTitle', { package: PLUGIN_PACKAGE }) },
                T('row.badge')
              )
            ),
            h('div', { className: 'wh_desc' }, T('row.description'))
          ),
          h(
            'button',
            { type: 'button', className: 'wh_btn', onClick: openPanel },
            T('row.manage', { n: count })
          )
        );
      }

      function ManagerOverlay() {
        const [open, setOpen] = React.useState(panelOpen);
        const [, forceRender] = React.useReducer(function (value) {
          return value + 1;
        }, 0);

        React.useEffect(function () {
          return panelSubscribe(function () {
            setOpen(panelOpen);
            forceRender();
          });
        }, []);

        React.useEffect(
          function () {
            if (!open) return undefined;
            const onKey = function (event) {
              if (event.key === 'Escape') closePanel();
            };
            window.addEventListener('keydown', onKey);
            return function () {
              window.removeEventListener('keydown', onKey);
            };
          },
          [open]
        );

        if (!open) return null;

        const items = Array.from(hidden)
          .map(function (id) {
            const item = findWorkspace(id);
            return {
              id: id,
              name: workspaceName(item) || id.slice(0, 8),
              path: item !== null && typeof item.path === 'string' ? item.path : '',
              sessions: countSessions(id)
            };
          })
          .sort(function (left, right) {
            return left.name.localeCompare(right.name, 'zh');
          });

        const rows =
          items.length === 0
            ? h('div', { className: 'wh_empty' }, T('panel.empty'))
            : items.map(function (entry) {
                return h(
                  'div',
                  { className: 'wh_item', key: entry.id },
                  h(
                    'div',
                    { className: 'wh_itemMain' },
                    h('div', { className: 'wh_name' }, entry.name),
                    entry.path === ''
                      ? h('div', { className: 'wh_meta' }, T('panel.pathUnknown'))
                      : h('div', { className: 'wh_path', title: entry.path }, entry.path),
                    h('div', { className: 'wh_meta' }, T('panel.count', { n: entry.sessions }))
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'wh_btn',
                      onClick: function () {
                        unhideWorkspace(entry.id);
                      }
                    },
                    T('panel.restore')
                  )
                );
              });

        return h(
          'div',
          {
            className: 'wh_veil',
            onMouseDown: function (event) {
              if (event.target === event.currentTarget) closePanel();
            }
          },
          h(
            'div',
            {
              className: 'wh_dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': T('panel.title')
            },
            h(
              'div',
              { className: 'wh_head' },
              h('div', { className: 'wh_headTitle' }, T('panel.title')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'wh_close',
                  'aria-label': T('panel.close'),
                  onClick: closePanel
                },
                '\u00d7'
              )
            ),
            h('div', { className: 'wh_hint' }, T('panel.hint')),
            h('div', { className: 'wh_list' }, rows),
            h(
              'div',
              { className: 'wh_foot' },
              h(
                'button',
                { type: 'button', className: 'wh_btn', onClick: closePanel },
                T('panel.close')
              ),
              items.length === 0
                ? null
                : h(
                    'button',
                    { type: 'button', className: 'wh_btn wh_primary', onClick: unhideAll },
                    T('panel.restoreAll')
                  )
            )
          )
        );
      }

      function ToastOverlay() {
        const [state, setState] = React.useState(toastState);
        React.useEffect(function () {
          return toastSubscribe(function () {
            setState(toastState);
          });
        }, []);
        if (state === null) return null;
        return h(
          'div',
          { className: 'wh_toast', role: 'status' },
          h('span', { className: 'wh_toastText' }, state.message),
          state.undo === null || state.undo === undefined
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'wh_toastAction',
                  onClick: function () {
                    state.undo();
                    clearToast();
                  }
                },
                T('toast.undo')
              )
        );
      }

      // ---- 装配 -------------------------------------------------------------

      function mountStyles() {
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

      function resolveStores(ctx) {
        try {
          const workspaces = ctx.get('workspaces');
          if (workspaces !== null && workspaces !== undefined && workspaces.list !== null && workspaces.list !== undefined) {
            workspaceStore = workspaces.list;
          }
        } catch (error) {
          workspaceStore = null;
        }
        try {
          const sessions = ctx.get('sessions');
          if (sessions !== null && sessions !== undefined && sessions.list !== null && sessions.list !== undefined) {
            sessionStore = sessions.list;
          }
        } catch (error) {
          sessionStore = null;
        }
        if (workspaceStore !== null && typeof workspaceStore.getSnapshot === 'function') {
          try {
            workspaceSnapshot = workspaceStore.getSnapshot();
          } catch (error) {
            workspaceSnapshot = null;
          }
        }
        if (sessionStore !== null && typeof sessionStore.getSnapshot === 'function') {
          try {
            sessionSnapshot = sessionStore.getSnapshot();
          } catch (error) {
            sessionSnapshot = null;
          }
        }
      }

      function subscribeStores() {
        const offs = [];
        if (workspaceStore !== null && typeof workspaceStore.subscribe === 'function') {
          offs.push(
            workspaceStore.subscribe(function () {
              if (typeof workspaceStore.getSnapshot === 'function') {
                try {
                  workspaceSnapshot = workspaceStore.getSnapshot();
                } catch (error) {
                  /* 保留上次快照 */
                }
              }
              pruneHidden();
              scheduleSync();
              notifyPanel();
            })
          );
        }
        if (sessionStore !== null && typeof sessionStore.subscribe === 'function') {
          offs.push(
            sessionStore.subscribe(function () {
              if (typeof sessionStore.getSnapshot === 'function') {
                try {
                  sessionSnapshot = sessionStore.getSnapshot();
                } catch (error) {
                  /* 保留上次快照 */
                }
              }
              scheduleSync();
            })
          );
        }
        storeUnsubscribes = offs;
        return function () {
          for (const off of storeUnsubscribes) {
            try {
              off();
            } catch (error) {
              /* 订阅随服务销毁：忽略 */
            }
          }
          storeUnsubscribes = [];
        };
      }

      function mountDom() {
        if (typeof document === 'undefined' || typeof window === 'undefined') {
          return function () {};
        }
        document.addEventListener('mousedown', onMouseDown, true);
        document.addEventListener('click', onMouseDown, true);

        const onStorage = function (event) {
          if (event.key !== STORE_KEY) return;
          try {
            const parsed = event.newValue === null ? [] : JSON.parse(event.newValue);
            hidden = new Set(normalizeHidden(parsed));
            scheduleSync(0);
            notifyPanel();
          } catch (error) {
            /* 坏数据忽略 */
          }
        };
        window.addEventListener('storage', onStorage);

        if (typeof MutationObserver === 'function') {
          observer = new MutationObserver(onMutations);
          observer.observe(document.body, { childList: true, subtree: true });
        }
        scheduleSync(0);

        return function () {
          document.removeEventListener('mousedown', onMouseDown, true);
          document.removeEventListener('click', onMouseDown, true);
          window.removeEventListener('storage', onStorage);
          if (observer !== null) {
            observer.disconnect();
            observer = null;
          }
          if (scheduled !== 0) {
            window.clearTimeout(scheduled);
            scheduled = 0;
          }
          if (pendingTimer !== 0) {
            window.clearTimeout(pendingTimer);
            pendingTimer = 0;
          }
          if (pushTimer !== 0) {
            window.clearTimeout(pushTimer);
            pushTimer = 0;
          }
          if (toastTimer !== 0) {
            window.clearTimeout(toastTimer);
            toastTimer = 0;
          }
          pendingMenu = null;
          toastState = null;
          panelOpen = false;
          notifyPanel();
          notifyToast();
          for (const node of document.querySelectorAll(
            '[' + ATTR_GROUP + '],[' + ATTR_ROW + '],[' + ATTR_MENU + ']'
          )) {
            node.removeAttribute(ATTR_GROUP);
            node.removeAttribute(ATTR_ROW);
            node.removeAttribute(ATTR_MENU);
          }
        };
      }

      const inject = ['slots', 'locale', 'sessions', 'workspaces'];

      function apply(ctx) {
        // 重载时重置模块状态（effect 清理会断开旧 observer）
        hidden = new Set(readLocal());
        panelOpen = false;
        toastState = null;
        pendingMenu = null;
        workspaceSnapshot = null;
        sessionSnapshot = null;
        workspaceStore = null;
        sessionStore = null;
        routeState = 'unknown';
        localTouched = false;

        ctx.effect(mountStyles, 'workspace-hide: stylesheet');
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        }, 'workspace-hide: dictionaries');
        T = ctx.locale.bind(NS);

        resolveStores(ctx);
        ctx.effect(subscribeStores, 'workspace-hide: store subscriptions');
        ctx.effect(mountDom, 'workspace-hide: dom');
        void pullRemote();

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            { name: 'shell.overlay', id: 'workspace-hide-manager', order: 64, locale: NS },
            withPortal(ManagerOverlay)
          );
        });
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            { name: 'shell.overlay', id: 'workspace-hide-toast', order: 65, locale: NS },
            withPortal(ToastOverlay)
          );
        });
        ctx.slots.inject('settings.general.item', function () {
          return ctx.slots.register(
            { name: 'settings.general.item', id: 'workspace-hide', order: 17, locale: NS },
            SettingsRow
          );
        });
      }

      return {
        inject: inject,
        apply: apply,
        __test: {
          NS: NS,
          ROW_ID: ROW_ID,
          PLUGIN_PACKAGE: PLUGIN_PACKAGE,
          STORE_KEY: STORE_KEY,
          ROUTE_PATH: ROUTE_PATH,
          GUARD_HEADER: GUARD_HEADER,
          STYLE_TAG_ID: STYLE_TAG_ID,
          ATTR_GROUP: ATTR_GROUP,
          ATTR_ROW: ATTR_ROW,
          ATTR_MENU: ATTR_MENU,
          MAX_HIDDEN: MAX_HIDDEN,
          CSS: CSS,
          zh: zh,
          en: en,
          normalizeHidden: normalizeHidden,
          baseName: baseName,
          normalizePath: normalizePath,
          workspaceName: workspaceName,
          ownerMapOf: ownerMapOf,
          ownerFromCwd: ownerFromCwd,
          isViewOptionsLabel: isViewOptionsLabel,
          menuActionFor: menuActionFor
        }
      };
    }
  });
})();
