(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/session-tags',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      /* ==================================================================== *
       * 会话标签（纯前端）
       *
       * 宿主能给的座位（已用 cordis_inspect_query + dsh-client-ui-workspace
       * 的 client.js 反编译核实）：
       *
       *   sidebar.session.row.leading         行首 16×20 槽位，仅「非归档 +
       *                                       非空白 + 主状态 idle」的行挂载
       *   sidebar.workspaces.session.row.action 行尾 hover 按钮条（非 blank 行
       *                                       常驻挂载，靠 CSS 在 hover 时显示）
       *   sidebar.workspaces.session.menu.item 行「…」菜单项，带 useMenuOpenState
       *   sidebar.session.row.hover           行悬停卡片段落
       *   shell.overlay                       全局浮层（编辑器弹窗）
       *   sidebar.right.pane.tab              右侧栏页签正文（键 = 类型 id）
       *
       * 数据来源：ctx.sessions.list / ctx.workspaces.list 两个 SnapshotStore，
       * 读取不激活任何 Session。标签只落 localStorage，不写宿主。
       *
       * 刻意不做的事：不 shadow sidebar.workspaces（那要重写整个浏览区），
       * 不在宿主行上写 data-* / 内联样式（宿主类名是 CSS Module 哈希，升级即断）。
       * ==================================================================== */

      const NS = 'session-tags';
      const STORAGE_KEY = 'session-tags.v1';
      const CSS_TAG_ID = 'session-tags-styles';
      const TAB_ID = '@local/session-tags/tree';
      const TAB_KIND = 'sessionTags';

      /** 标签色板：中明度色，深浅两套主题下都可读。 */
      const PALETTE = [
        { id: 'amber', color: '#d9a441' },
        { id: 'blue', color: '#5b9bd5' },
        { id: 'green', color: '#5fae6b' },
        { id: 'red', color: '#d97070' },
        { id: 'purple', color: '#a97fd0' },
        { id: 'teal', color: '#4fa8a0' },
        { id: 'gray', color: '#8c8c8c' }
      ];
      const DEFAULT_COLOR = 'blue';
      const MAX_DOTS = 3;

      /* ------------------------------------------------------------------ *
       * 文案
       * ------------------------------------------------------------------ */

      const zh = {
        'tab.title': '标签',
        'tree.title': '会话标签',
        'tree.guide': '按标签树浏览全部会话，可把侧栏里的会话拖到标签上',
        'tree.loading': '正在读取会话列表…',
        'tree.empty': '还没有任何会话',
        'tree.untagged': '未打标',
        'tree.filter': '筛选会话标题',
        'tree.newTag': '新建标签',
        'tree.remove': '从该标签移除',
        'tree.noTag': '还没有标签，点右上角「新建标签」',
        'browser.workspacesTitle': '工作区',
        'browser.tagsTitle': '标签',
        'browser.sessions': '个会话',
        'browser.filter': '搜索会话',
        'browser.viewOptions': '分组 · 排序 · 筛选',
        'browser.grouping': '分组方式',
        'browser.groupWorkspace': '按工作区',
        'browser.groupWorkspaceTag': '按工作区 + 标签',
        'browser.groupTag': '按标签',
        'browser.groupFlat': '单列表',
        'browser.sorting': '排序方式',
        'browser.sortUpdated': '最近更新',
        'browser.sortManual': '手动（工作区顺序）',
        'browser.filterGroup': '筛选会话',
        'browser.filterHideArchived': '隐藏已归档',
        'browser.filterAll': '全部对话（显示已归档）',
        'browser.filterOnlyArchived': '仅显示已归档',
        'browser.useNative': '切换到原生列表',
        'browser.newWorkspace': '新建工作区',
        'browser.newSession': '新建会话',
        'browser.empty': '没有匹配的会话',
        'browser.expand': '展开侧栏',
        'menu.label': '标签…',
        'action.label': '标签',
        'hover.edit': '编辑标签',
        'editor.sessionTitle': '会话标签',
        'editor.manage': '标签管理',
        'editor.placeholder': '新标签名',
        'editor.create': '新建',
        'editor.close': '关闭',
        'editor.delete': '删除标签',
        'editor.openTree': '打开标签树',
        'editor.parent': '父标签',
        'editor.noParent': '（顶级标签）',
        'editor.empty': '还没有标签，先建一个吧',
        'seed.todo': '待办',
        'seed.doing': '进行中',
        'seed.done': '已完成',
        'seed.archive': '存档',
        'time.now': '刚刚',
        'time.min': '分钟前',
        'time.hour': '小时前',
        'time.day': '天前',
        'time.unknown': ''
      };

      const en = {
        'tab.title': 'Tags',
        'tree.title': 'Session tags',
        'tree.guide': 'Browse every Session as a tag tree; drag a sidebar Session onto a tag to tag it',
        'tree.loading': 'Reading the Session list…',
        'tree.empty': 'No Sessions yet',
        'tree.untagged': 'Untagged',
        'tree.filter': 'Filter Session titles',
        'tree.newTag': 'New tag',
        'tree.remove': 'Remove from this tag',
        'tree.noTag': 'No tags yet — use "New tag" in the header',
        'browser.workspacesTitle': 'Workspaces',
        'browser.tagsTitle': 'Tags',
        'browser.sessions': 'sessions',
        'browser.filter': 'Search sessions',
        'browser.viewOptions': 'Group · sort · filter',
        'browser.grouping': 'Group by',
        'browser.groupWorkspace': 'Workspace',
        'browser.groupWorkspaceTag': 'Workspace, then tag',
        'browser.groupTag': 'Tag',
        'browser.groupFlat': 'Single list',
        'browser.sorting': 'Sort by',
        'browser.sortUpdated': 'Recently updated',
        'browser.sortManual': 'Manual (workspace order)',
        'browser.filterGroup': 'Filter sessions',
        'browser.filterHideArchived': 'Hide archived',
        'browser.filterAll': 'All sessions (show archived)',
        'browser.filterOnlyArchived': 'Only archived',
        'browser.useNative': 'Switch to the host list',
        'browser.newWorkspace': 'New workspace',
        'browser.newSession': 'New Session',
        'browser.empty': 'No matching sessions',
        'browser.expand': 'Expand the sidebar',
        'menu.label': 'Tags…',
        'action.label': 'Tags',
        'hover.edit': 'Edit tags',
        'editor.sessionTitle': 'Session tags',
        'editor.manage': 'Manage tags',
        'editor.placeholder': 'New tag name',
        'editor.create': 'Create',
        'editor.close': 'Close',
        'editor.delete': 'Delete tag',
        'editor.openTree': 'Open the tag tree',
        'editor.parent': 'Parent tag',
        'editor.noParent': '(top level)',
        'editor.empty': 'No tags yet — create one below',
        'seed.todo': 'To do',
        'seed.doing': 'In progress',
        'seed.done': 'Done',
        'seed.archive': 'Archive',
        'time.now': 'just now',
        'time.min': 'm ago',
        'time.hour': 'h ago',
        'time.day': 'd ago',
        'time.unknown': ''
      };

      /** 当前语言的取词函数；apply 里改绑到 locale 命名空间。 */
      let T = function (key) {
        return zh[key] !== undefined ? zh[key] : key;
      };

      /* ------------------------------------------------------------------ *
       * 小工具
       * ------------------------------------------------------------------ */

      function colorOf(tag) {
        if (tag !== undefined && tag !== null) {
          for (const item of PALETTE) {
            if (item.id === tag.color) return item.color;
          }
        }
        return PALETTE[1].color;
      }

      function makeId() {
        return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      }

      /** 诊断输出：不抛错、不刷屏，用户在 DevTools 里能直接看到原因。 */
      function warn(message, error) {
        try {
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[session-tags] ' + message, error);
          }
        } catch {
          /* 控制台不可用 */
        }
      }

      function timeLabel(ms) {
        const diff = Date.now() - Number(ms);
        if (!Number.isFinite(diff) || diff < 60000) return T('time.now');
        const minutes = Math.floor(diff / 60000);
        if (minutes < 60) return minutes + ' ' + T('time.min');
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + ' ' + T('time.hour');
        return Math.floor(hours / 24) + ' ' + T('time.day');
      }

      /* ------------------------------------------------------------------ *
       * 存储：一个不可变快照 + 订阅者
       * ------------------------------------------------------------------ */

      function emptyState() {
        return { seeded: false, tags: [], marks: {} };
      }

      function normalizeTag(raw) {
        if (raw === null || typeof raw !== 'object') return null;
        if (typeof raw.id !== 'string' || raw.id === '') return null;
        let color = DEFAULT_COLOR;
        for (const item of PALETTE) {
          if (item.id === raw.color) color = item.id;
        }
        return {
          id: raw.id,
          name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : raw.id,
          color,
          parentId: typeof raw.parentId === 'string' ? raw.parentId : null
        };
      }

      function load() {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw === null) return emptyState();
          const parsed = JSON.parse(raw);
          if (parsed === null || typeof parsed !== 'object') return emptyState();
          const tags = Array.isArray(parsed.tags) ? parsed.tags.map(normalizeTag).filter(Boolean) : [];
          const marks = {};
          if (parsed.marks !== null && typeof parsed.marks === 'object') {
            for (const key of Object.keys(parsed.marks)) {
              const list = parsed.marks[key];
              if (!Array.isArray(list)) continue;
              const kept = list.filter(function (value) {
                return typeof value === 'string';
              });
              if (kept.length > 0) marks[key] = kept;
            }
          }
          return { seeded: parsed.seeded === true, tags, marks };
        } catch {
          return emptyState();
        }
      }

      let state = load();
      const listeners = new Set();

      function getSnapshot() {
        return state;
      }

      function subscribe(listener) {
        listeners.add(listener);
        return function () {
          listeners.delete(listener);
        };
      }

      function emit() {
        for (const listener of Array.from(listeners)) {
          try {
            listener();
          } catch {
            /* 单个订阅者出错不影响其他订阅者 */
          }
        }
      }

      function persist() {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
          /* 存储不可用（隐私模式/配额）时退化为内存态 */
        }
      }

      function commit(next) {
        state = next;
        persist();
        emit();
      }

      /* ---------------------------- 读 ---------------------------- */

      function tagById(id) {
        for (const tag of state.tags) {
          if (tag.id === id) return tag;
        }
        return undefined;
      }

      /** 该会话身上仍然存在的标签（已删除的标签 id 自动被过滤掉）。 */
      function tagsOf(sessionId) {
        const list = state.marks[sessionId];
        if (!Array.isArray(list)) return [];
        const out = [];
        for (const id of list) {
          const tag = tagById(id);
          if (tag !== undefined) out.push(tag);
        }
        return out;
      }

      function parentOf(tag) {
        if (tag === null || tag === undefined || tag.parentId === null) return undefined;
        return tagById(tag.parentId);
      }

      function childrenOf(parentId) {
        return state.tags.filter(function (tag) {
          return tag.parentId === parentId;
        });
      }

      /** 顶级标签：parentId 为空，或父标签已不存在。 */
      function rootTags() {
        return state.tags.filter(function (tag) {
          return parentOf(tag) === undefined;
        });
      }

      /* ---------------------------- 写 ---------------------------- */

      function writeMarks(sessionId, tagIds) {
        const marks = Object.assign({}, state.marks);
        if (tagIds.length === 0) delete marks[sessionId];
        else marks[sessionId] = tagIds;
        commit(Object.assign({}, state, { marks }));
      }

      function assignTag(sessionId, tagId) {
        if (typeof sessionId !== 'string' || tagById(tagId) === undefined) return;
        const current = (state.marks[sessionId] || []).filter(function (id) {
          return tagById(id) !== undefined;
        });
        if (current.indexOf(tagId) >= 0) return;
        current.push(tagId);
        writeMarks(sessionId, current);
      }

      function toggleTag(sessionId, tagId) {
        if (typeof sessionId !== 'string' || tagById(tagId) === undefined) return;
        const current = (state.marks[sessionId] || []).filter(function (id) {
          return tagById(id) !== undefined;
        });
        const at = current.indexOf(tagId);
        if (at >= 0) current.splice(at, 1);
        else current.push(tagId);
        writeMarks(sessionId, current);
      }

      function createTag(name, color, parentId) {
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (trimmed === '') return undefined;
        const tag = {
          id: makeId(),
          name: trimmed.slice(0, 24),
          color: color === undefined ? DEFAULT_COLOR : color,
          parentId: parentId === undefined || parentId === null ? null : parentId
        };
        commit(Object.assign({}, state, { tags: state.tags.concat([tag]) }));
        return tag;
      }

      function deleteTag(tagId) {
        const target = tagById(tagId);
        if (target === undefined) return;
        /* 子标签上提一级，避免删父标签时把整棵子树一起带走 */
        const tags = state.tags
          .filter(function (tag) {
            return tag.id !== tagId;
          })
          .map(function (tag) {
            if (tag.parentId !== tagId) return tag;
            return Object.assign({}, tag, { parentId: target.parentId });
          });
        const marks = {};
        for (const key of Object.keys(state.marks)) {
          const kept = state.marks[key].filter(function (id) {
            return id !== tagId;
          });
          if (kept.length > 0) marks[key] = kept;
        }
        commit(Object.assign({}, state, { tags, marks }));
      }

      /** 会话列表行数：直接打上该标签的会话数。 */
      function countTagged(tagId) {
        let total = 0;
        for (const key of Object.keys(state.marks)) {
          if (state.marks[key].indexOf(tagId) >= 0) total += 1;
        }
        return total;
      }

      /** 首次运行灌一套默认标签（只灌一次，用户删空后不再回来）。 */
      function seedOnce() {
        if (state.seeded) return;
        const tags = [
          { id: makeId(), name: T('seed.todo'), color: 'amber', parentId: null },
          { id: makeId(), name: T('seed.doing'), color: 'blue', parentId: null },
          { id: makeId(), name: T('seed.done'), color: 'green', parentId: null },
          { id: makeId(), name: T('seed.archive'), color: 'gray', parentId: null }
        ];
        commit(Object.assign({}, state, { seeded: true, tags: state.tags.concat(tags) }));
      }

      /* ------------------------------------------------------------------ *
       * 编辑器目标（弹窗开关），独立于标签数据
       * ------------------------------------------------------------------ */

      let editorTarget = null; /* { sessionId: string|null, title: string } */
      const editorListeners = new Set();

      function getEditorTarget() {
        return editorTarget;
      }

      function subscribeEditor(listener) {
        editorListeners.add(listener);
        return function () {
          editorListeners.delete(listener);
        };
      }

      function openEditor(sessionId, title) {
        editorTarget = { sessionId: typeof sessionId === 'string' ? sessionId : null, title: typeof title === 'string' ? title : '' };
        for (const listener of Array.from(editorListeners)) {
          try {
            listener();
          } catch {
            /* ignore */
          }
        }
      }

      function closeEditor() {
        if (editorTarget === null) return;
        editorTarget = null;
        for (const listener of Array.from(editorListeners)) {
          try {
            listener();
          } catch {
            /* ignore */
          }
        }
      }

      /* ------------------------------------------------------------------ *
       * 订阅式读取（React 18 的 useSyncExternalStore，缺省时退化为 useState）
       * ------------------------------------------------------------------ */

      function makeHook(get, sub) {
        if (typeof React.useSyncExternalStore === 'function') {
          return function useBoundExternal() {
            return React.useSyncExternalStore(sub, get, get);
          };
        }
        return function useBoundState() {
          const [value, setValue] = React.useState(get);
          React.useEffect(function () {
            return sub(function () {
              setValue(get());
            });
          }, []);
          return value;
        };
      }

      const useTagState = makeHook(getSnapshot, subscribe);
      const useEditorTarget = makeHook(getEditorTarget, subscribeEditor);

      /** 宿主快照存储，apply 里填入。 */
      let sessionStore = null;
      let workspaceStore = null;

      const useSessionSnapshot = makeHook(
        function () {
          return sessionStore === null ? null : sessionStore.getSnapshot();
        },
        function (listener) {
          return sessionStore === null ? function () {} : sessionStore.subscribe(listener);
        }
      );

      const useWorkspaceSnapshot = makeHook(
        function () {
          return workspaceStore === null ? null : workspaceStore.getSnapshot();
        },
        function (listener) {
          return workspaceStore === null ? function () {} : workspaceStore.subscribe(listener);
        }
      );

      /* ------------------------------------------------------------------ *
       * 左栏模式：'tags' = 本插件接管 sidebar.workspaces 渲染标签树；
       *           'native' = 让宿主的原生浏览区回来（priority 0 成为最低活项）。
       * 切换是运行时的：占位注册的 disposer 一调，宿主立刻复活。
       * ------------------------------------------------------------------ */

      /* 键名带 v2：v1 时代（未经运行验证的构建）可能把 'native' 写进旧键，
         导致刷新后静默不接管。换键即让脏值失效，默认回到 'tags'。 */
      const SIDEBAR_MODE_KEY = 'session-tags.sidebar.mode.v2';
      const SIDEBAR_TAGS = 'tags';
      const SIDEBAR_NATIVE = 'native';

      function readSidebarMode() {
        /* 历史坑：旧版本把 'native' 持久化了，用户点到底部开关后再也回不来。
           现在主动清掉残留键，并固定从标签树起步——刷新即回标签树。 */
        try {
          window.localStorage.removeItem(SIDEBAR_MODE_KEY);
        } catch {
          /* 存储不可用 */
        }
        return SIDEBAR_TAGS;
      }

      let sidebarMode = readSidebarMode();
      const modeListeners = new Set();

      function getSidebarMode() {
        return sidebarMode;
      }

      function subscribeSidebarMode(listener) {
        modeListeners.add(listener);
        return function () {
          modeListeners.delete(listener);
        };
      }

      function writeSidebarMode(next) {
        const value = next === SIDEBAR_NATIVE ? SIDEBAR_NATIVE : SIDEBAR_TAGS;
        if (value === sidebarMode) return;
        /* 只在本会话生效，不落盘：避免"记住 native 就回不来"的死状态。 */
        sidebarMode = value;
        for (const listener of Array.from(modeListeners)) {
          try {
            listener();
          } catch {
            /* ignore */
          }
        }
      }

      const useSidebarMode = makeHook(getSidebarMode, subscribeSidebarMode);

      /** 宿主「屏幕上正在看哪个 Session」（ctx.sidebarRight.mounted）。 */
      let mountedSessionSource = null;

      const useMountedSession = makeHook(
        function () {
          return mountedSessionSource === null ? undefined : mountedSessionSource.getSnapshot();
        },
        function (listener) {
          return mountedSessionSource === null ? function () {} : mountedSessionSource.subscribe(listener);
        }
      );

      /* ------------------------------------------------------------------ *
       * 跨插件动作（apply 里填入，组件直接读模块变量）
       * ------------------------------------------------------------------ */

      let openTreeTab = function () {};
      let openSessionById = function () {};
      let startNewSession = function () {};
      let addWorkspace = function () {};

      /* ------------------------------------------------------------------ *
       * 组件：行首色点（sidebar.session.row.leading）
       * ------------------------------------------------------------------ */

      function TagLeadDot(props) {
        const snapshot = useTagState();
        const tags = readTags(snapshot, props.sessionId);
        if (tags.length === 0) return null;
        const primary = tags[0];
        return h('span', {
          className: 'stg_lead',
          style: { background: colorOf(primary) },
          title: tags
            .map(function (tag) {
              return tag.name;
            })
            .join(' · '),
          'aria-label': tags
            .map(function (tag) {
              return tag.name;
            })
            .join(' · ')
        });
      }

      /** 快照版本：组件里不能用会读模块 state 的 tagsOf（需对当前快照求值）。 */
      function readTags(snapshot, sessionId) {
        const list = snapshot.marks[sessionId];
        if (!Array.isArray(list)) return [];
        const out = [];
        for (const id of list) {
          for (const tag of snapshot.tags) {
            if (tag.id === id) {
              out.push(tag);
              break;
            }
          }
        }
        return out;
      }

      /* ------------------------------------------------------------------ *
       * 组件：行尾 hover 按钮（sidebar.workspaces.session.row.action）
       * ------------------------------------------------------------------ */

      function TagRowAction(props) {
        const snapshot = useTagState();
        const tags = readTags(snapshot, props.sessionId);
        const dots = tags.slice(0, MAX_DOTS);
        return h(
          'button',
          {
            type: 'button',
            className: 'stg_action',
            title: T('action.label'),
            'aria-label': T('action.label'),
            onClick: function (event) {
              event.stopPropagation();
              openEditor(props.sessionId, props.displayTitle);
            }
          },
          dots.length === 0
            ? h('span', { className: 'stg_actionDot stg_actionDotEmpty' })
            : dots.map(function (tag) {
                return h('span', {
                  key: tag.id,
                  className: 'stg_actionDot',
                  style: { background: colorOf(tag) }
                });
              })
        );
      }

      /* ------------------------------------------------------------------ *
       * 组件：行「…」菜单项（sidebar.workspaces.session.menu.item）
       * ------------------------------------------------------------------ */

      function TagMenuItem(props) {
        useTagState();
        /* 宿主把 useMenuOpenState 投影成 owner 的 hookContext；两种命名都兼容。
           该条件在同一注册上固定不变，因此 hook 调用顺序稳定。 */
        const menuHook =
          (typeof props.useMenuOpenState === 'function' && props.useMenuOpenState) ||
          (typeof props.menuOpenState === 'function' && props.menuOpenState) ||
          null;
        const menuPair = menuHook === null ? null : menuHook();
        const tags = readTags(useTagState(), props.sessionId);
        const closeMenu = function () {
          if (menuPair !== null && typeof menuPair[1] === 'function') menuPair[1](false);
        };
        return h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            className: 'stg_mitem',
            onClick: function () {
              closeMenu();
              openEditor(props.sessionId, props.displayTitle);
            }
          },
          h(
            'span',
            { className: 'stg_miglyph', 'aria-hidden': 'true' },
            tags.length === 0
              ? h('span', { className: 'stg_actionDot stg_actionDotEmpty' })
              : tags.slice(0, MAX_DOTS).map(function (tag) {
                  return h('span', {
                    key: tag.id,
                    className: 'stg_actionDot',
                    style: { background: colorOf(tag) }
                  });
                })
          ),
          h('span', { className: 'stg_milabel' }, T('menu.label'))
        );
      }

      /* ------------------------------------------------------------------ *
       * 组件：行悬停卡片段落（sidebar.session.row.hover）
       * ------------------------------------------------------------------ */

      function TagHoverChips(props) {
        const snapshot = useTagState();
        const tags = readTags(snapshot, props.sessionId);
        if (tags.length === 0) return null;
        return h(
          'div',
          { className: 'stg_chips' },
          tags.map(function (tag) {
            return h(
              'span',
              { key: tag.id, className: 'stg_chip' },
              h('span', { className: 'stg_chipDot', style: { background: colorOf(tag) } }),
              tag.name
            );
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'stg_chipEdit',
              onClick: function (event) {
                event.stopPropagation();
                openEditor(props.sessionId, '');
              }
            },
            T('hover.edit')
          )
        );
      }

      /* ------------------------------------------------------------------ *
       * 组件：编辑器弹窗（shell.overlay）
       * ------------------------------------------------------------------ */

      function TagEditor(props) {
        const target = useEditorTarget();
        const snapshot = useTagState();
        const [draft, setDraft] = React.useState('');
        const [color, setColor] = React.useState(DEFAULT_COLOR);
        const [parentId, setParentId] = React.useState(null);

        React.useEffect(
          function () {
            if (target === null) return undefined;
            setDraft('');
            setColor(DEFAULT_COLOR);
            setParentId(null);
            const onKey = function (event) {
              if (event.key === 'Escape') closeEditor();
            };
            window.addEventListener('keydown', onKey);
            return function () {
              window.removeEventListener('keydown', onKey);
            };
          },
          [target]
        );

        if (target === null) return null;

        const sessionId = target.sessionId;
        const assigned = Array.isArray(snapshot.marks[sessionId]) ? snapshot.marks[sessionId] : [];

        /* 扁平化标签树（带深度），保证子标签缩进显示 */
        const flat = [];
        (function walk(parent, depth) {
          for (const tag of snapshot.tags) {
            const isRoot = tag.parentId === null || tag.parentId === undefined;
            const parentExists =
              tag.parentId !== null && snapshot.tags.some(function (other) { return other.id === tag.parentId; });
            if (parent === null ? !isRoot && parentExists : tag.parentId !== parent) continue;
            flat.push({ tag, depth });
            walk(tag.id, depth + 1);
          }
        })(null, 0);

        const roots = snapshot.tags.filter(function (tag) {
          return tag.parentId === null || !snapshot.tags.some(function (other) { return other.id === tag.parentId; });
        });

        const submit = function () {
          const created = createTag(draft, color, parentId);
          if (created !== undefined) {
            setDraft('');
            if (sessionId !== null) assignTag(sessionId, created.id);
          }
        };

        return h(
          'div',
          {
            className: 'stg_backdrop',
            onPointerDown: function (event) {
              if (event.target === event.currentTarget) closeEditor();
            }
          },
          h(
            'div',
            { className: 'stg_dialog', role: 'dialog', 'aria-modal': 'true' },
            h(
              'div',
              { className: 'stg_dhead' },
              h(
                'div',
                { className: 'stg_dtitles' },
                h('div', { className: 'stg_dtitle' }, sessionId === null ? T('editor.manage') : T('editor.sessionTitle')),
                sessionId === null
                  ? null
                  : h('div', { className: 'stg_dsub' }, target.title)
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'stg_ghost',
                  onClick: function () {
                    closeEditor();
                  }
                },
                T('editor.close')
              )
            ),
            h(
              'div',
              { className: 'stg_dbody' },
              flat.length === 0
                ? h('div', { className: 'stg_empty' }, T('editor.empty'))
                : flat.map(function (item) {
                    const tag = item.tag;
                    const checked = assigned.indexOf(tag.id) >= 0;
                    return h(
                      'div',
                      { key: tag.id, className: 'stg_erow', style: { paddingLeft: 10 + item.depth * 16 } },
                      sessionId === null
                        ? null
                        : h('input', {
                            type: 'checkbox',
                            className: 'stg_check',
                            checked,
                            onChange: function () {
                              toggleTag(sessionId, tag.id);
                            }
                          }),
                      h('span', { className: 'stg_edot', style: { background: colorOf(tag) } }),
                      h('span', { className: 'stg_ename' }, tag.name),
                      h('span', { className: 'stg_egrow' }),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'stg_x',
                          title: T('editor.delete'),
                          'aria-label': T('editor.delete'),
                          onClick: function () {
                            deleteTag(tag.id);
                          }
                        },
                        '×'
                      )
                    );
                  })
            ),
            h(
              'div',
              { className: 'stg_dfoot' },
              h('input', {
                className: 'stg_input',
                type: 'text',
                value: draft,
                placeholder: T('editor.placeholder'),
                'aria-label': T('editor.placeholder'),
                onChange: function (event) {
                  setDraft(event.target.value);
                },
                onKeyDown: function (event) {
                  if (event.key === 'Enter') submit();
                }
              }),
              h(
                'select',
                {
                  className: 'stg_select',
                  value: parentId === null ? '' : parentId,
                  'aria-label': T('editor.parent'),
                  onChange: function (event) {
                    setParentId(event.target.value === '' ? null : event.target.value);
                  }
                },
                h('option', { value: '' }, T('editor.noParent')),
                roots.map(function (tag) {
                  return h('option', { key: tag.id, value: tag.id }, tag.name);
                })
              ),
              h(
                'div',
                { className: 'stg_swatches' },
                PALETTE.map(function (item) {
                  return h('button', {
                    key: item.id,
                    type: 'button',
                    className: 'stg_swatch' + (item.id === color ? ' stg_swatchOn' : ''),
                    style: { background: item.color },
                    title: item.id,
                    'aria-label': item.id,
                    onClick: function () {
                      setColor(item.id);
                    }
                  });
                })
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'stg_primary',
                  disabled: draft.trim() === '',
                  onClick: submit
                },
                T('editor.create')
              )
            ),
            h(
              'div',
              { className: 'stg_dbar' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'stg_link',
                  onClick: function () {
                    closeEditor();
                    openTreeTab();
                  }
                },
                T('editor.openTree')
              )
            )
          )
        );
      }

      /* ------------------------------------------------------------------ *
       * 组件：标签树（右侧栏页签正文）
       * ------------------------------------------------------------------ */

      function TagsTree(props) {
        const snapshot = useTagState();
        const workspaceSnapshot = useWorkspaceSnapshot();
        const sessionSnapshot = useSessionSnapshot();
        const [query, setQuery] = React.useState('');
        const [collapsed, setCollapsed] = React.useState({ __none__: true });
        const [dropTarget, setDropTarget] = React.useState(null);

        const model = React.useMemo(
          function () {
            return buildModel(snapshot, workspaceSnapshot, sessionSnapshot, query);
          },
          [snapshot, workspaceSnapshot, sessionSnapshot, query]
        );

        const toggleCollapse = function (key) {
          setCollapsed(function (previous) {
            const next = Object.assign({}, previous);
            if (next[key]) delete next[key];
            else next[key] = true;
            return next;
          });
        };

        if (model === null) return h('div', { className: 'stg_panel' }, h('div', { className: 'stg_empty' }, T('tree.loading')));

        const onDropTag = function (tagId) {
          return function (event) {
            event.preventDefault();
            event.stopPropagation();
            setDropTarget(null);
            const sessionId = event.dataTransfer.getData('text/plain');
            if (typeof sessionId === 'string' && sessionId !== '') assignTag(sessionId, tagId);
          };
        };

        const renderSessionRow = function (row, tag) {
          return h(
            'div',
            {
              key: 'session:' + row.id + ':' + (tag === null ? 'none' : tag.id),
              className: 'stg_srow' + (row.archived ? ' stg_archived' : ''),
              title: row.title,
              onClick: function () {
                openSessionById(row.id);
              }
            },
            h('span', {
              className: 'stg_sdot' + (row.running ? ' stg_sdotRun' : ''),
              style: row.running ? undefined : { background: 'var(--dsw-alias-state-idle-primary)' }
            }),
            h('span', { className: 'stg_stitle' }, row.title === '' ? row.id : row.title),
            h('span', { className: 'stg_stime' }, timeLabel(row.updatedAt)),
            tag === null
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'stg_x',
                    title: T('tree.remove'),
                    'aria-label': T('tree.remove'),
                    onClick: function (event) {
                      event.stopPropagation();
                      toggleTag(row.id, tag.id);
                    }
                  },
                  '×'
                )
          );
        };

        const renderSessions = function (rows, tag) {
          const groups = new Map();
          for (const row of rows) {
            if (!groups.has(row.workspaceId)) groups.set(row.workspaceId, { title: row.workspaceTitle, rows: [] });
            groups.get(row.workspaceId).rows.push(row);
          }
          const out = [];
          for (const entry of groups) {
            const group = entry[1];
            group.rows.sort(function (a, b) {
              return b.updatedAt - a.updatedAt;
            });
            out.push(h('div', { key: 'ws:' + entry[0] + ':' + (tag === null ? 'none' : tag.id), className: 'stg_wlabel' }, group.title));
            for (const row of group.rows) out.push(renderSessionRow(row, tag));
          }
          return out;
        };

        const renderTag = function (tag, depth) {
          const key = 'tag:' + tag.id;
          const isCollapsed = collapsed[key] === true;
          const own = model.byTag.get(tag.id) || [];
          const kids = model.childrenOf(tag.id);
          const isDrop = dropTarget === tag.id;
          return h(
            'div',
            { key, className: 'stg_node' },
            h(
              'div',
              {
                className: 'stg_trow' + (isDrop ? ' stg_trowDrop' : ''),
                style: { paddingLeft: 6 + depth * 14 },
                onClick: function () {
                  toggleCollapse(key);
                },
                onDragOver: function (event) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = 'link';
                  if (dropTarget !== tag.id) setDropTarget(tag.id);
                },
                onDragLeave: function () {
                  setDropTarget(function (current) {
                    return current === tag.id ? null : current;
                  });
                },
                onDrop: onDropTag(tag.id)
              },
              h('span', { className: 'stg_chev' + (isCollapsed ? '' : ' stg_chevOpen') }, '›'),
              h('span', { className: 'stg_tdot', style: { background: colorOf(tag) } }),
              h('span', { className: 'stg_tname' }, tag.name),
              h('span', { className: 'stg_tcount' }, String(own.length))
            ),
            isCollapsed ? null : h('div', { className: 'stg_tbody' }, kids.map(function (kid) { return renderTag(kid, depth + 1); }), renderSessions(own, tag))
          );
        };

        return h(
          'div',
          { className: 'stg_panel' },
          h(
            'div',
            { className: 'stg_head' },
            h('span', { className: 'stg_headTitle' }, T('tree.title')),
            h('span', { className: 'stg_headCount' }, String(model.taggedSessions)),
            h('span', { className: 'stg_grow' }),
            h(
              'button',
              {
                type: 'button',
                className: 'stg_ghost',
                onClick: function () {
                  openEditor(null, '');
                }
              },
              T('tree.newTag')
            )
          ),
          h(
            'div',
            { className: 'stg_search' },
            h('input', {
              className: 'stg_input stg_inputFlat',
              type: 'search',
              value: query,
              placeholder: T('tree.filter'),
              'aria-label': T('tree.filter'),
              onChange: function (event) {
                setQuery(event.target.value);
              }
            })
          ),
          h(
            'div',
            { className: 'stg_body' },
            model.totalSessions === 0
              ? h('div', { className: 'stg_empty' }, T('tree.empty'))
              : model.roots.map(function (tag) {
                  return renderTag(tag, 0);
                }),
            snapshot.tags.length === 0 ? h('div', { className: 'stg_empty' }, T('tree.noTag')) : null,
            h(
              'div',
              { key: 'untagged', className: 'stg_node' },
              h(
                'div',
                {
                  className: 'stg_trow stg_trowMuted' + (dropTarget === '__none__' ? ' stg_trowDrop' : ''),
                  onClick: function () {
                    toggleCollapse('__none__');
                  },
                  onDragOver: function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = 'link';
                    if (dropTarget !== '__none__') setDropTarget('__none__');
                  },
                  onDragLeave: function () {
                    setDropTarget(function (current) {
                      return current === '__none__' ? null : current;
                    });
                  },
                  onDrop: function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    setDropTarget(null);
                    const sessionId = event.dataTransfer.getData('text/plain');
                    if (typeof sessionId === 'string' && sessionId !== '') writeMarks(sessionId, []);
                  }
                },
                h('span', { className: 'stg_chev' + (collapsed.__none__ === true ? '' : ' stg_chevOpen') }, '›'),
                h('span', { className: 'stg_tdot stg_tdotEmpty' }),
                h('span', { className: 'stg_tname' }, T('tree.untagged')),
                h('span', { className: 'stg_tcount' }, String(model.untagged.length))
              ),
              collapsed.__none__ === true ? null : h('div', { className: 'stg_tbody' }, renderSessions(model.untagged, null))
            )
          )
        );
      }

      /* ------------------------------------------------------------------ *
       * 组件：左栏标签树（接管 sidebar.workspaces，priority 低于宿主）
       *
       * 这是用户要的主视图：左侧列表位置直接按标签渲染成树。
       * 「列表」按钮一按就把这个占位撤掉、宿主原生浏览区原样回来，
       * 所以分组方式/拖拽排序/工作区管理这些原生能力随时可用、一条没丢。
       * ------------------------------------------------------------------ */

      /* ------------------------------------------------------------------ *
       * 组件：左侧浏览区（接管 sidebar.workspaces）
       *
       * 目标：跟宿主原生列表**同构**——同样的段头（标题 + 搜索 + 滑块菜单 +
       * 新建工作区）、同样的 34px/32px 行高、同样的 hover 行为（时间让位给
       * 动作按钮）；区别只在「分组方式」多了标签相关模式。
       *
       * 分组模式：
       *   workspace    按工作区（≈原生默认）
       *   workspaceTag 按工作区，工作区内再按标签分组（默认）
       *   tag          全按标签（标签 → 会话）
       *   flat         单列表
       * ------------------------------------------------------------------ */

      const SORT_UPDATED = 'updated';
      const SORT_MANUAL = 'manual';
      const FILTER_HIDE = 'hideArchived';
      const FILTER_ALL = 'all';
      const FILTER_ONLY = 'onlyArchived';
      const GROUP_WORKSPACE = 'workspace';
      const GROUP_WORKSPACE_TAG = 'workspaceTag';
      const GROUP_TAG = 'tag';
      const GROUP_FLAT = 'flat';

      const VIEW_KEY = 'session-tags.view.v1';
      const COLLAPSE_KEY = 'session-tags.collapsed.v1';

      function readView() {
        const fallback = { grouping: GROUP_WORKSPACE_TAG, sorting: SORT_UPDATED, filter: FILTER_HIDE };
        try {
          const raw = window.localStorage.getItem(VIEW_KEY);
          if (raw === null) return fallback;
          const parsed = JSON.parse(raw);
          if (parsed === null || typeof parsed !== 'object') return fallback;
          const grouping = [GROUP_WORKSPACE, GROUP_WORKSPACE_TAG, GROUP_TAG, GROUP_FLAT].indexOf(parsed.grouping) >= 0 ? parsed.grouping : fallback.grouping;
          const sorting = parsed.sorting === SORT_MANUAL ? SORT_MANUAL : SORT_UPDATED;
          const filter = [FILTER_HIDE, FILTER_ALL, FILTER_ONLY].indexOf(parsed.filter) >= 0 ? parsed.filter : FILTER_HIDE;
          return { grouping, sorting, filter };
        } catch {
          return fallback;
        }
      }

      function writeView(view) {
        try {
          window.localStorage.setItem(VIEW_KEY, JSON.stringify(view));
        } catch {
          /* 存不下就只在本次会话生效 */
        }
      }

      function readCollapsed() {
        try {
          const raw = window.localStorage.getItem(COLLAPSE_KEY);
          const parsed = raw === null ? null : JSON.parse(raw);
          if (parsed === null || typeof parsed !== 'object') return {};
          const out = {};
          for (const key of Object.keys(parsed)) {
            if (parsed[key] === true) out[key] = true;
          }
          return out;
        } catch {
          return {};
        }
      }

      function writeCollapsed(map) {
        try {
          window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(map));
        } catch {
          /* ignore */
        }
      }

      /* ---- 图标（不引入宿主 primitives，全部内联 SVG） ---- */

      function icon(children) {
        return h(
          'svg',
          {
            width: 14,
            height: 14,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true'
          },
          children
        );
      }

      const ICON_CHEVRON = icon([h('path', { key: 1, d: 'M9 6l6 6-6 6' })]);
      const ICON_FOLDER = icon([
        h('path', { key: 1, d: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2a2 2 0 0 1 1.6.8l1 1.2h7.2A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z' })
      ]);
      const ICON_SEARCH = icon([
        h('circle', { key: 1, cx: 11, cy: 11, r: 6 }),
        h('path', { key: 2, d: 'M20 20l-4.2-4.2' })
      ]);
      const ICON_SLIDERS = icon([
        h('path', { key: 1, d: 'M4 7h10M18 7h2M4 17h4M12 17h8' }),
        h('circle', { key: 2, cx: 16, cy: 7, r: 2 }),
        h('circle', { key: 3, cx: 10, cy: 17, r: 2 })
      ]);
      const ICON_FOLDER_PLUS = icon([
        h('path', { key: 1, d: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2a2 2 0 0 1 1.6.8l1 1.2h7.2A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z' }),
        h('path', { key: 2, d: 'M12 11v5M9.5 13.5h5' })
      ]);
      const ICON_CHECK = icon([h('path', { key: 1, d: 'M20 6L9 17l-5-5' })]);
      const ICON_PLUS = icon([h('path', { key: 1, d: 'M12 5v14M5 12h14' })]);
      const ICON_CLOSE = icon([h('path', { key: 1, d: 'M6 6l12 12M18 6L6 18' })]);
      const ICON_TAG = icon([
        h('path', { key: 1, d: 'M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z' }),
        h('circle', { key: 2, cx: 7.5, cy: 7.5, r: 1.4, fill: 'currentColor', stroke: 'none' })
      ]);

      function TagBrowser(props) {
        const snapshot = useTagState();
        const workspaceSnapshot = useWorkspaceSnapshot();
        const sessionSnapshot = useSessionSnapshot();
        const currentId = useMountedSession();
        const [view, setView] = React.useState(readView);
        const [collapsed, setCollapsed] = React.useState(readCollapsed);
        const [query, setQuery] = React.useState('');
        const [searchOpen, setSearchOpen] = React.useState(false);
        const [menuOpen, setMenuOpen] = React.useState(false);
        const [dropTarget, setDropTarget] = React.useState(null);
        const menuRef = React.useRef(null);
        const searchRef = React.useRef(null);

        const model = React.useMemo(
          function () {
            return buildModel(snapshot, workspaceSnapshot, sessionSnapshot, query);
          },
          [snapshot, workspaceSnapshot, sessionSnapshot, query]
        );

        React.useEffect(
          function () {
            if (!menuOpen) return undefined;
            const onDown = function (event) {
              if (menuRef.current !== null && menuRef.current.contains(event.target)) return;
              setMenuOpen(false);
            };
            const onKey = function (event) {
              if (event.key === 'Escape') setMenuOpen(false);
            };
            document.addEventListener('pointerdown', onDown, true);
            document.addEventListener('keydown', onKey);
            return function () {
              document.removeEventListener('pointerdown', onDown, true);
              document.removeEventListener('keydown', onKey);
            };
          },
          [menuOpen]
        );

        React.useEffect(
          function () {
            if (searchOpen && searchRef.current !== null) searchRef.current.focus();
          },
          [searchOpen]
        );

        /* 收起成图标栏时只留一个展开入口，不硬塞整棵树 */
        if (props.wide === false) {
          return h(
            'div',
            { className: 'stg_rail' },
            h(
              'button',
              {
                type: 'button',
                className: 'stg_railBtn',
                title: T('browser.expand'),
                'aria-label': T('browser.expand'),
                onClick: function () {
                  if (typeof props.expandSidebar === 'function') props.expandSidebar();
                }
              },
              ICON_TAG
            )
          );
        }

        if (model === null) {
          return h('div', { className: 'stg_browser' }, h('div', { className: 'stg_empty' }, T('tree.loading')));
        }

        const updateView = function (patch) {
          const next = Object.assign({}, view, patch);
          setView(next);
          writeView(next);
        };

        const toggleGroup = function (key) {
          setCollapsed(function (previous) {
            const next = Object.assign({}, previous);
            if (next[key]) delete next[key];
            else next[key] = true;
            writeCollapsed(next);
            return next;
          });
        };

        const isOpen = function (key) {
          return collapsed[key] !== true;
        };

        /* 筛选：归档三态 */
        const keepByFilter = function (row) {
          if (view.filter === FILTER_ALL) return true;
          if (view.filter === FILTER_ONLY) return row.archived;
          return !row.archived;
        };

        const sortRows = function (rows) {
          const kept = rows.filter(keepByFilter);
          if (view.sorting === SORT_MANUAL) return kept;
          return kept.slice().sort(function (a, b) {
            return b.updatedAt - a.updatedAt;
          });
        };

        const dropHandlers = function (tagId, clear) {
          const key = clear ? '__none__' : tagId;
          return {
            onDragOver: function (event) {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'link';
              if (dropTarget !== key) setDropTarget(key);
            },
            onDragLeave: function () {
              setDropTarget(function (current) {
                return current === key ? null : current;
              });
            },
            onDrop: function (event) {
              event.preventDefault();
              event.stopPropagation();
              setDropTarget(null);
              const sessionId = event.dataTransfer.getData('text/plain');
              if (typeof sessionId !== 'string' || sessionId === '') return;
              if (clear) writeMarks(sessionId, []);
              else assignTag(sessionId, tagId);
            }
          };
        };

        /* ---- 会话行（对齐原生：32px / 圆角 / hover 时间让位给动作） ---- */

        const renderSession = function (row, depth, removableTag) {
          return h(
            'div',
            {
              key: 'row:' + row.id + ':' + String(depth) + ':' + (removableTag ? removableTag.id : '-'),
              className:
                'stg_srow' + (row.archived ? ' stg_arch' : '') + (row.id === currentId ? ' stg_sel' : ''),
              style: { paddingInlineStart: 8 + depth * 14 + 'px' },
              title: row.title,
              draggable: true,
              onClick: function () {
                openSessionById(row.id);
              },
              onDragStart: function (event) {
                event.dataTransfer.effectAllowed = 'link';
                event.dataTransfer.setData('text/plain', row.id);
              }
            },
            h('span', { className: 'stg_slot' }, row.running ? h('span', { className: 'stg_sdot stg_sdotRun' }) : null),
            h('span', { className: 'stg_stitle' }, row.title === '' ? row.id : row.title),
            h('span', { className: 'stg_stime' }, timeLabel(row.updatedAt)),
            h(
              'span',
              { className: 'stg_sactions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'stg_ibtn',
                  title: T('action.label'),
                  'aria-label': T('action.label'),
                  onClick: function (event) {
                    event.stopPropagation();
                    openEditor(row.id, row.title);
                  }
                },
                ICON_TAG
              ),
              removableTag === undefined
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'stg_ibtn',
                      title: T('tree.remove'),
                      'aria-label': T('tree.remove'),
                      onClick: function (event) {
                        event.stopPropagation();
                        toggleTag(row.id, removableTag.id);
                      }
                    },
                    ICON_CLOSE
                  )
            )
          );
        };

        /* ---- 标签分组头（工作区内 / 全局两种层级共用） ---- */

        const renderTagGroup = function (tag, rows, depth, removable) {
          const key = 'tag:' + tag.id + ':d' + String(depth);
          const open = isOpen(key);
          const drop = dropHandlers(tag.id, false);
          return h(
            'div',
            { key, className: 'stg_group' },
            h(
              'div',
              Object.assign(
                {
                  className:
                    'stg_trow' +
                    (open ? ' stg_open' : '') +
                    (dropTarget === tag.id ? ' stg_drop' : ''),
                  style: { paddingInlineStart: 8 + depth * 14 + 'px' },
                  onClick: function () {
                    toggleGroup(key);
                  }
                },
                drop
              ),
              h('span', { className: 'stg_chev' }, ICON_CHEVRON),
              h('span', { className: 'stg_slot' }, h('span', { className: 'stg_tdot', style: { background: colorOf(tag) } })),
              h('span', { className: 'stg_tname' }, tag.name),
              h('span', { className: 'stg_tcount' }, String(rows.length))
            ),
            open
              ? h(
                  'div',
                  { className: 'stg_groupBody' },
                  rows.map(function (row) {
                    return renderSession(row, depth + 1, removable ? tag : undefined);
                  })
                )
              : null
          );
        };

        /* ---- 工作区分组行（对齐原生 projectRow：34px） ---- */

        const renderWorkspace = function (workspace) {
          const key = 'ws:' + workspace.id;
          const open = isOpen(key);
          const rows = sortRows(workspace.rows);
          if (rows.length === 0 && view.grouping !== GROUP_WORKSPACE) return null;
          return h(
            'div',
            { key, className: 'stg_group' },
            h(
              'div',
              {
                className: 'stg_prow' + (open ? ' stg_open' : ''),
                onClick: function () {
                  toggleGroup(key);
                }
              },
              h('span', { className: 'stg_chev' }, ICON_CHEVRON),
              h('span', { className: 'stg_slot stg_pfolder' }, ICON_FOLDER),
              h(
                'span',
                { className: 'stg_ptext' },
                h('span', { className: 'stg_ptitle' }, workspace.title === '' ? workspace.id : workspace.title),
                h('span', { className: 'stg_pmeta' }, String(rows.length) + ' ' + T('browser.sessions'))
              ),
              h(
                'span',
                { className: 'stg_pactions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'stg_ibtn',
                    title: T('browser.newSession'),
                    'aria-label': T('browser.newSession'),
                    onClick: function (event) {
                      event.stopPropagation();
                      startNewSession(workspace.id);
                    }
                  },
                  ICON_PLUS
                )
              )
            ),
            open ? h('div', { className: 'stg_groupBody' }, renderWorkspaceChildren(workspace, rows)) : null
          );
        };

        /* 工作区内部：按模式决定「直接列会话」还是「再按标签分层」 */
        const renderWorkspaceChildren = function (workspace, rows) {
          if (view.grouping !== GROUP_WORKSPACE_TAG) {
            return rows.map(function (row) {
              return renderSession(row, 1, undefined);
            });
          }
          const buckets = new Map();
          const untagged = [];
          for (const row of rows) {
            const ids = (snapshot.marks[row.id] || []).filter(function (id) {
              return snapshot.tags.some(function (tag) {
                return tag.id === id;
              });
            });
            if (ids.length === 0) {
              untagged.push(row);
              continue;
            }
            for (const id of ids) {
              if (!buckets.has(id)) buckets.set(id, []);
              buckets.get(id).push(row);
            }
          }
          const out = [];
          for (const tag of snapshot.tags) {
            const list = buckets.get(tag.id);
            if (list === undefined || list.length === 0) continue;
            out.push(renderTagGroup(tag, list, 1, true));
          }
          if (untagged.length > 0) {
            const subKey = 'untagged:' + workspace.id;
            const subOpen = isOpen(subKey);
            out.push(
              h(
                'div',
                { key: subKey, className: 'stg_group stg_groupMuted' },
                h(
                  'div',
                  {
                    className: 'stg_trow stg_trowMuted' + (subOpen ? ' stg_open' : ''),
                    style: { paddingInlineStart: 22 + 'px' },
                    onClick: function () {
                      toggleGroup(subKey);
                    }
                  },
                  h('span', { className: 'stg_chev' }, ICON_CHEVRON),
                  h('span', { className: 'stg_slot' }, h('span', { className: 'stg_tdot stg_tdotEmpty' })),
                  h('span', { className: 'stg_tname' }, T('tree.untagged')),
                  h('span', { className: 'stg_tcount' }, String(untagged.length))
                ),
                subOpen
                  ? h(
                      'div',
                      { className: 'stg_groupBody' },
                      untagged.map(function (row) {
                        return renderSession(row, 2, undefined);
                      })
                    )
                  : null
              )
            );
          }
          return out;
        };

        /* ---- 全按标签：顶级标签树 + 未打标 ---- */

        const renderGlobalTags = function () {
          const out = [];
          const all = sortRows(
            model.rows.filter(function (row) {
              return keepByFilter(row);
            })
          );
          const byTag = new Map();
          const untagged = [];
          for (const row of all) {
            const ids = (snapshot.marks[row.id] || []).filter(function (id) {
              return snapshot.tags.some(function (tag) {
                return tag.id === id;
              });
            });
            if (ids.length === 0) untagged.push(row);
            for (const id of ids) {
              if (!byTag.has(id)) byTag.set(id, []);
              byTag.get(id).push(row);
            }
          }
          const walk = function (tag, depth) {
            const rows = byTag.get(tag.id) || [];
            const kids = snapshot.tags.filter(function (other) {
              return other.parentId === tag.id;
            });
            const node = renderTagGroup(tag, rows, depth, true);
            if (node === null) return;
            out.push(node);
            for (const kid of kids) walk(kid, depth + 1);
          };
          for (const tag of model.roots) walk(tag, 0);
          out.push(
            h(
              'div',
              { key: 'untagged:global', className: 'stg_group stg_groupMuted' },
              h(
                'div',
                Object.assign(
                  { className: 'stg_trow stg_trowMuted' + (dropTarget === '__none__' ? ' stg_drop' : '') },
                  dropHandlers(null, true)
                ),
                h('span', { className: 'stg_chev' }, ICON_CHEVRON),
                h('span', { className: 'stg_slot' }, h('span', { className: 'stg_tdot stg_tdotEmpty' })),
                h('span', { className: 'stg_tname' }, T('tree.untagged')),
                h('span', { className: 'stg_tcount' }, String(untagged.length))
              ),
              h(
                'div',
                { className: 'stg_groupBody' },
                untagged.map(function (row) {
                  return renderSession(row, 1, undefined);
                })
              )
            )
          );
          return out;
        };

        const menuRow = function (label, active, onPick, glyph) {
          return h(
            'button',
            {
              key: label,
              type: 'button',
              className: 'stg_mrow' + (active ? ' stg_mrowOn' : ''),
              onClick: function () {
                onPick();
                setMenuOpen(false);
              }
            },
            h('span', { className: 'stg_mglyph' }, glyph),
            h('span', { className: 'stg_mlabel' }, label),
            h('span', { className: 'stg_mcheck' }, active ? ICON_CHECK : null)
          );
        };

        const groupingMenu = [
          { key: GROUP_WORKSPACE, label: T('browser.groupWorkspace'), glyph: ICON_FOLDER },
          { key: GROUP_WORKSPACE_TAG, label: T('browser.groupWorkspaceTag'), glyph: ICON_TAG },
          { key: GROUP_TAG, label: T('browser.groupTag'), glyph: ICON_TAG },
          { key: GROUP_FLAT, label: T('browser.groupFlat'), glyph: ICON_SLIDERS }
        ];

        const filteringMenu = [
          { key: FILTER_HIDE, label: T('browser.filterHideArchived') },
          { key: FILTER_ALL, label: T('browser.filterAll') },
          { key: FILTER_ONLY, label: T('browser.filterOnlyArchived') }
        ];

        const body =
          view.grouping === GROUP_TAG
            ? renderGlobalTags()
            : view.grouping === GROUP_FLAT
              ? sortRows(model.rows).map(function (row) {
                  return renderSession(row, 0, undefined);
                })
              : model.workspaces.map(renderWorkspace);

        const title = view.grouping === GROUP_TAG ? T('browser.tagsTitle') : T('browser.workspacesTitle');

        return h(
          'div',
          { className: 'stg_browser' },
          h(
            'div',
            { className: 'stg_shead', ref: menuRef },
            h('span', { className: 'stg_sheadTitle' }, title),
            h('span', { className: 'stg_grow' }),
            h(
              'button',
              {
                type: 'button',
                className: 'stg_hbtn' + (searchOpen ? ' stg_hbtnOn' : ''),
                title: T('browser.filter'),
                'aria-label': T('browser.filter'),
                onClick: function () {
                  setSearchOpen(function (value) {
                    if (value) setQuery('');
                    return !value;
                  });
                }
              },
              ICON_SEARCH
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'stg_hbtn' + (menuOpen ? ' stg_hbtnOn' : ''),
                title: T('browser.viewOptions'),
                'aria-label': T('browser.viewOptions'),
                'aria-expanded': menuOpen,
                onClick: function () {
                  setMenuOpen(function (value) {
                    return !value;
                  });
                }
              },
              ICON_SLIDERS
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'stg_hbtn',
                title: T('browser.newWorkspace'),
                'aria-label': T('browser.newWorkspace'),
                onClick: function () {
                  addWorkspace();
                }
              },
              ICON_FOLDER_PLUS
            ),
            menuOpen
              ? h(
                  'div',
                  { className: 'stg_menu', role: 'menu' },
                  h('div', { className: 'stg_mgroupTitle' }, T('browser.grouping')),
                  groupingMenu.map(function (item) {
                    return menuRow(item.label, view.grouping === item.key, function () {
                      updateView({ grouping: item.key });
                    }, item.glyph);
                  }),
                  h('div', { className: 'stg_msep' }),
                  h('div', { className: 'stg_mgroupTitle' }, T('browser.sorting')),
                  menuRow(T('browser.sortUpdated'), view.sorting === SORT_UPDATED, function () {
                    updateView({ sorting: SORT_UPDATED });
                  }),
                  menuRow(T('browser.sortManual'), view.sorting === SORT_MANUAL, function () {
                    updateView({ sorting: SORT_MANUAL });
                  }),
                  h('div', { className: 'stg_msep' }),
                  h('div', { className: 'stg_mgroupTitle' }, T('browser.filterGroup')),
                  filteringMenu.map(function (item) {
                    return menuRow(item.label, view.filter === item.key, function () {
                      updateView({ filter: item.key });
                    });
                  }),
                  h('div', { className: 'stg_msep' }),
                  menuRow(T('browser.useNative'), false, function () {
                    writeSidebarMode(SIDEBAR_NATIVE);
                  })
                )
              : null
          ),
          searchOpen
            ? h(
                'div',
                { className: 'stg_ssearchRow' },
                h('input', {
                  ref: searchRef,
                  className: 'stg_input stg_inputFlat',
                  type: 'search',
                  value: query,
                  placeholder: T('tree.filter'),
                  'aria-label': T('tree.filter'),
                  onChange: function (event) {
                    setQuery(event.target.value);
                  },
                  onKeyDown: function (event) {
                    if (event.key === 'Escape') {
                      setQuery('');
                      setSearchOpen(false);
                    }
                  }
                })
              )
            : null,
          h(
            'div',
            { className: 'stg_list' },
            model.totalSessions === 0 ? h('div', { className: 'stg_empty' }, T('browser.empty')) : null,
            body
          )
        );
      }

      /**
       * 把「宿主快照 + 标签数据」折成一棵可渲染的模型。
       * @returns 模型，或快照尚未就绪时的 null。
       */
      function buildModel(snapshot, workspaceSnapshot, sessionSnapshot, query) {
        if (workspaceSnapshot === null || sessionSnapshot === null) return null;
        if (!Array.isArray(workspaceSnapshot.items)) return null;
        if (sessionSnapshot.byId === null || typeof sessionSnapshot.byId !== 'object') return null;

        const archived = new Set(Array.isArray(workspaceSnapshot.archivedSessionIds) ? workspaceSnapshot.archivedSessionIds : []);
        const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
        const rows = [];
        const seen = new Set();

        for (const workspace of workspaceSnapshot.items) {
          const ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
          for (const id of ids) {
            if (seen.has(id)) continue;
            const summary = sessionSnapshot.byId[id];
            if (summary === undefined || summary === null) continue;
            if (summary.blank === true) continue;
            const title = typeof summary.displayTitle === 'string' ? summary.displayTitle : '';
            if (needle !== '' && title.toLowerCase().indexOf(needle) < 0) continue;
            seen.add(id);
            rows.push({
              id,
              title,
              updatedAt: Number(summary.updatedAt) || 0,
              running: summary.running === true,
              archived: archived.has(id),
              workspaceId: workspace.workspaceId,
              workspaceTitle: typeof workspace.title === 'string' ? workspace.title : ''
            });
          }
        }

        const byTag = new Map();
        const untagged = [];
        let taggedSessions = 0;
        for (const row of rows) {
          const ids = Array.isArray(snapshot.marks[row.id]) ? snapshot.marks[row.id] : [];
          const live = ids.filter(function (id) {
            return snapshot.tags.some(function (tag) {
              return tag.id === id;
            });
          });
          if (live.length === 0) {
            untagged.push(row);
            continue;
          }
          taggedSessions += 1;
          for (const id of live) {
            if (!byTag.has(id)) byTag.set(id, []);
            byTag.get(id).push(row);
          }
        }

        const roots = snapshot.tags.filter(function (tag) {
          return tag.parentId === null || !snapshot.tags.some(function (other) { return other.id === tag.parentId; });
        });

        const rowsByWorkspace = new Map();
        for (const row of rows) {
          if (!rowsByWorkspace.has(row.workspaceId)) rowsByWorkspace.set(row.workspaceId, []);
          rowsByWorkspace.get(row.workspaceId).push(row);
        }
        const workspaceList = [];
        for (const entry of workspaceSnapshot.items) {
          const list = rowsByWorkspace.get(entry.workspaceId);
          if (list === undefined || list.length === 0) continue;
          workspaceList.push({ id: entry.workspaceId, title: entry.title, path: entry.path, rows: list });
        }

        return {
          rows,
          workspaces: workspaceList,
          roots,
          byTag,
          untagged,
          taggedSessions,
          totalSessions: rows.length,
          childrenOf: function (parentId) {
            return snapshot.tags.filter(function (tag) {
              return tag.parentId === parentId;
            });
          }
        };
      }

      /* ------------------------------------------------------------------ *
       * 样式：只用主题 token
       * ------------------------------------------------------------------ */

      const CSS = [
        '.stg_lead{width:7px;height:7px;border-radius:50%;flex:none;display:block;box-shadow:0 0 0 1px rgba(0,0,0,.22)}',

        '.stg_action{display:inline-flex;align-items:center;gap:2px;height:20px;min-width:14px;padding:0 2px;border:0;background:0 0;border-radius:4px;cursor:pointer;color:var(--dsw-alias-label-secondary)}',
        '.stg_action:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stg_actionDot{width:6px;height:6px;border-radius:50%;display:block;flex:none}',
        '.stg_actionDotEmpty{border:.5px solid var(--dsw-alias-label-tertiary);background:0 0}',

        '.stg_mitem{display:flex;align-items:center;gap:8px;width:100%;padding:5px 10px;border:0;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-title-font-size,13px);text-align:left;cursor:pointer;border-radius:4px}',
        '.stg_mitem:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stg_miglyph{display:inline-flex;align-items:center;gap:2px;width:16px;flex:none}',
        '.stg_milabel{flex:1;white-space:nowrap}',

        '.stg_chips{display:flex;flex-wrap:wrap;align-items:center;gap:4px}',
        '.stg_chip{display:inline-flex;align-items:center;gap:4px;padding:1px 6px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}',
        '.stg_chipDot{width:5px;height:5px;border-radius:50%;flex:none}',
        '.stg_chipEdit{border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font-size:11px;cursor:pointer;padding:1px 4px;border-radius:4px}',
        '.stg_chipEdit:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',

        '.stg_backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:10vh 16px 16px;background:rgba(0,0,0,.42);pointer-events:auto}',
        '.stg_dialog{display:flex;flex-direction:column;width:min(460px,94vw);max-height:72vh;background:var(--dsw-alias-bg-overlay);border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,.38);color:var(--dsw-alias-label-primary);font-size:var(--dsh-title-font-size,13px);overflow:hidden}',
        '.stg_dhead{display:flex;align-items:flex-start;gap:10px;padding:12px 14px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}',
        '.stg_dtitles{flex:1;min-width:0}',
        '.stg_dtitle{font-weight:600}',
        '.stg_dsub{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stg_dbody{flex:1;overflow:auto;padding:6px 6px 8px}',
        '.stg_dfoot{display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:.5px solid var(--dsw-alias-border-l1);flex:none;flex-wrap:wrap}',
        '.stg_dbar{display:flex;justify-content:flex-end;padding:6px 10px;border-top:.5px solid var(--dsw-alias-border-l1);flex:none}',

        '.stg_erow{display:flex;align-items:center;gap:7px;height:28px;padding-right:6px;border-radius:5px}',
        '.stg_erow:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stg_check{accent-color:var(--dsw-alias-brand-primary);margin:0;flex:none}',
        '.stg_edot{width:8px;height:8px;border-radius:50%;flex:none}',
        '.stg_ename{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stg_egrow{flex:1}',

        '.stg_x{border:0;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;line-height:1;padding:2px 5px;border-radius:4px;flex:none;opacity:0;transition:opacity .1s}',
        '.stg_erow:hover .stg_x,.stg_srow:hover .stg_x{opacity:1}',
        '.stg_x:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover)}',

        '.stg_ghost{border:.5px solid var(--dsw-alias-border-l1);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:3px 8px;border-radius:5px;cursor:pointer;flex:none}',
        '.stg_ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.stg_primary{border:0;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted);font:inherit;font-size:11px;font-weight:600;padding:4px 10px;border-radius:5px;cursor:pointer;flex:none}',
        '.stg_primary:disabled{opacity:.45;cursor:default}',
        '.stg_link{border:0;background:0 0;color:var(--dsw-alias-link);font:inherit;font-size:11px;cursor:pointer;padding:2px 4px}',
        '.stg_link:hover{text-decoration:underline}',

        '.stg_input{border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:4px 7px;border-radius:5px;min-width:0;outline:none}',
        '.stg_input:focus{border-color:var(--dsw-alias-brand-primary)}',
        '.stg_inputFlat{width:100%;box-sizing:border-box}',
        '.stg_select{border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:4px 4px;border-radius:5px;max-width:96px;outline:none}',
        '.stg_swatches{display:flex;gap:3px;flex:none}',
        '.stg_swatch{width:13px;height:13px;border-radius:50%;border:1px solid transparent;cursor:pointer;padding:0}',
        '.stg_swatchOn{box-shadow:0 0 0 1.5px var(--dsw-alias-label-primary)}',

        '.stg_panel{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:var(--dsh-title-font-size,13px)}',
        '.stg_head{display:flex;align-items:center;gap:8px;padding:8px 10px 6px;flex:none}',
        '.stg_headTitle{font-weight:600}',
        '.stg_headCount{color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}',
        '.stg_grow{flex:1}',
        '.stg_search{padding:0 8px 6px;flex:none}',
        '.stg_body{flex:1;overflow:auto;padding:0 4px 12px;min-height:0}',

        '.stg_node{display:flex;flex-direction:column}',
        '.stg_trow{display:flex;align-items:center;gap:6px;height:24px;padding-right:6px;border-radius:5px;cursor:pointer;user-select:none}',
        '.stg_trow:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stg_trowMuted .stg_tname{color:var(--dsw-alias-label-tertiary)}',
        '.stg_trowDrop{background:var(--dsw-alias-interactive-bg-hover-accent);outline:1px dashed var(--dsw-alias-brand-primary);outline-offset:-1px}',
        '.stg_chev{width:12px;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .12s;display:inline-block;text-align:center}',
        '.stg_chevOpen{transform:rotate(90deg)}',
        '.stg_tdot{width:8px;height:8px;border-radius:50%;flex:none}',
        '.stg_tdotEmpty{border:.5px solid var(--dsw-alias-label-tertiary);background:0 0}',
        '.stg_tname{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stg_tcount{color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums;flex:none}',
        '.stg_tbody{display:flex;flex-direction:column}',

        '.stg_wlabel{padding:4px 0 2px 26px;color:var(--dsw-alias-label-caption);font-size:10px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stg_srow{display:flex;align-items:center;gap:6px;height:24px;padding-left:26px;padding-right:4px;border-radius:5px;cursor:pointer}',
        '.stg_srow:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stg_archived .stg_stitle{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}',
        '.stg_sdot{width:6px;height:6px;border-radius:50%;flex:none}',
        '.stg_sdotRun{background:var(--dsw-alias-state-success-primary);animation:stg_pulse 2.2s ease-in-out infinite}',
        '.stg_stitle{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}',
        '.stg_stime{color:var(--dsw-alias-label-tertiary);font-size:10px;flex:none;font-variant-numeric:tabular-nums}',
        '.stg_empty{padding:16px 10px;color:var(--dsw-alias-label-tertiary);font-size:11px;text-align:center}',

        '.stg_browser{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;color:var(--dsw-alias-label-primary)}',
        '.stg_shead{display:flex;align-items:center;gap:2px;height:34px;padding:0 4px 0 10px;flex:none;position:relative}',
        '.stg_sheadTitle{font-size:13px;font-weight:600;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
        '.stg_grow{flex:1}',
        '.stg_hbtn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--dsw-radius-sm,5px);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;padding:0}',
        '.stg_hbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.stg_hbtnOn{color:var(--dsw-alias-brand-primary)}',
        '.stg_ssearchRow{padding:0 8px 6px;flex:none}',
        '.stg_list{flex:1;overflow:auto;padding:0 4px 12px;min-height:0}',
        '.stg_menu{position:absolute;top:32px;right:4px;z-index:60;min-width:232px;padding:6px;display:flex;flex-direction:column;gap:1px;background:var(--dsw-alias-bg-overlay);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,8px);box-shadow:0 12px 28px rgba(0,0,0,.35)}',
        '.stg_mgroupTitle{padding:6px 8px 4px;font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary)}',
        '.stg_mrow{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm,5px);background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}',
        '.stg_mrow:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stg_mglyph{display:inline-flex;align-items:center;justify-content:center;width:16px;flex:none;color:var(--dsw-alias-menu-icon,var(--dsw-alias-label-secondary))}',
        '.stg_mlabel{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stg_mcheck{display:inline-flex;align-items:center;width:14px;flex:none;color:var(--dsw-alias-label-primary)}',
        '.stg_msep{height:1px;margin:5px 4px;background:var(--dsw-alias-border-l1)}',
        '.stg_group{display:flex;flex-direction:column}',
        '.stg_groupBody{display:flex;flex-direction:column}',
        '.stg_prow{display:flex;align-items:center;gap:6px;height:34px;padding:0 8px;box-sizing:border-box;border-radius:var(--dsw-radius-md,6px);cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary)}',
        '.stg_prow:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stg_pfolder{color:var(--dsw-alias-label-secondary)}',
        '.stg_ptext{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}',
        '.stg_ptitle{font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stg_pmeta{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stg_pactions{display:none;align-items:center;gap:6px;flex:none}',
        '.stg_prow:hover .stg_pactions{display:inline-flex}',
        '.stg_srow{display:flex;align-items:center;gap:0;height:32px;padding:0 8px;box-sizing:border-box;border-radius:var(--dsw-radius-md,6px);cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary)}',
        '.stg_srow:hover,.stg_srow.stg_sel{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stg_slot{width:16px;height:20px;display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--dsw-alias-label-tertiary)}',
        '.stg_sdot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}',
        '.stg_sdotRun{animation:stg_pulse 2.2s ease-in-out infinite}',
        '.stg_stitle{flex:1;min-width:0;margin:0 6px 0 4px;font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stg_srow.stg_arch .stg_stitle{color:var(--dsw-alias-label-caption)}',
        '.stg_stime{flex:none;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
        '.stg_sactions{display:none;align-items:center;gap:6px;flex:none}',
        '.stg_srow:hover .stg_sactions{display:inline-flex}',
        '.stg_srow:hover .stg_stime{display:none}',
        '.stg_ibtn{width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--dsw-radius-sm,5px);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}',
        '.stg_ibtn:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}',
        '.stg_trow{display:flex;align-items:center;gap:6px;height:28px;padding:0 8px;box-sizing:border-box;border-radius:var(--dsw-radius-md,6px);cursor:pointer;user-select:none;color:var(--dsw-alias-label-secondary)}',
        '.stg_trow:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stg_trowMuted .stg_tname{color:var(--dsw-alias-label-tertiary)}',
        '.stg_tdot{width:8px;height:8px;border-radius:50%;flex:none}',
        '.stg_tdotEmpty{border:.5px solid var(--dsw-alias-label-tertiary);background:0 0}',
        '.stg_tname{flex:1;min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stg_tcount{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
        '.stg_chev{width:14px;height:20px;display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease-in-out}',
        '.stg_open > .stg_chev{transform:rotate(90deg)}',
        '.stg_drop{outline:1px dashed var(--dsw-alias-brand-primary);outline-offset:-1px;background:var(--dsw-alias-interactive-bg-hover-accent)}',
        '.stg_input{border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:4px 7px;border-radius:var(--dsw-radius-sm,5px);min-width:0;outline:none}',
        '.stg_input:focus{border-color:var(--dsw-alias-brand-primary)}',
        '.stg_inputFlat{width:100%;box-sizing:border-box}',
        '.stg_empty{padding:16px 10px;color:var(--dsw-alias-label-tertiary);font-size:11px;text-align:center}',
        '.stg_rail{display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 0;height:100%;box-sizing:border-box}',
        '.stg_railBtn{width:26px;height:26px;border:0;border-radius:var(--dsw-radius-sm,5px);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
        '.stg_railBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      

        '@keyframes stg_pulse{0%,100%{opacity:1}50%{opacity:.35}}'
      ].join('\n');

      /* ------------------------------------------------------------------ *
       * 插件正文
       * ------------------------------------------------------------------ */

      const inject = ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'sidebarRight', 'sidebarRightTabs'];

      function apply(ctx) {
        ctx.effect(function () {
          if (typeof document === 'undefined') return function () {};
          if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') !== null) return function () {};
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/session-tags';
          tag.dataset.pluginCss = CSS_TAG_ID;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return function () {
            tag.remove();
          };
        }, 'session-tags: stylesheet');

        ctx.effect(function () {
          return ctx.locale.register(NS, { zh, en });
        }, 'session-tags: dictionaries');

        const t = ctx.locale.bind(NS);
        T = function (key) {
          const text = t(key);
          return typeof text === 'string' && text !== key ? text : zh[key] !== undefined ? zh[key] : key;
        };

        /* 宿主快照存储：读取不激活 Session。 */
        const sessions = ctx.get('sessions');
        const workspaces = ctx.get('workspaces');
        if (sessions !== undefined && sessions !== null && sessions.list !== undefined) sessionStore = sessions.list;
        if (workspaces !== undefined && workspaces !== null && workspaces.list !== undefined) workspaceStore = workspaces.list;

        const sidebarRight = ctx.get('sidebarRight');
        const uiWorkspace = ctx.get('uiWorkspace');
        if (sidebarRight !== undefined && sidebarRight !== null) {
          const mounted = sidebarRight.mounted;
          if (mounted !== undefined && mounted !== null && typeof mounted.getSnapshot === 'function' && typeof mounted.subscribe === 'function') {
            mountedSessionSource = mounted;
          }
        }

        openTreeTab = function () {
          try {
            if (sidebarRight !== undefined && sidebarRight !== null && typeof sidebarRight.openTab === 'function') {
              sidebarRight.openTab(TAB_KIND);
            }
          } catch {
            /* 右侧栏不可用时静默 */
          }
        };

        openSessionById = function (sessionId) {
          try {
            if (sessionStore === null) return;
            const snapshot = sessionStore.getSnapshot();
            if (snapshot === null || snapshot.byId[sessionId] === undefined) return;
            if (uiWorkspace !== undefined && uiWorkspace !== null && typeof uiWorkspace.openSession === 'function') {
              uiWorkspace.openSession(sessionId);
            }
          } catch {
            /* 打不开就保持原样 */
          }
        };

        startNewSession = function (workspaceId) {
          try {
            if (uiWorkspace !== undefined && uiWorkspace !== null && typeof uiWorkspace.startSession === 'function') {
              uiWorkspace.startSession(workspaceId);
            }
          } catch {
            /* 新建不了就保持原样 */
          }
        };

        addWorkspace = function () {
          try {
            if (uiWorkspace === undefined || uiWorkspace === null || typeof uiWorkspace.pickDirectory !== 'function') return;
            Promise.resolve(uiWorkspace.pickDirectory())
              .then(function (picked) {
                if (typeof picked !== 'string' || picked === '') return undefined;
                const registry = ctx.get('workspaces');
                if (registry !== undefined && registry !== null && typeof registry.create === 'function') {
                  return registry.create({ path: picked });
                }
                return undefined;
              })
              .catch(function (error) {
                warn('add workspace failed', error);
              });
          } catch (error) {
            warn('add workspace failed', error);
          }
        };

        seedOnce();

        /* ---- 左栏：按模式占用 / 让出 sidebar.workspaces ----
         *
         * 单值座的胜者是「优先级最低的那个活项」。宿主浏览区在 priority 0，
         * 所以本插件用 -1 压住它（同优先级才会抛错），disposer 一调即原样复活。
         */

        let sidebarOccupant = null;
        let sidebarRetry = null;
        let sidebarTries = 0;
        const teardownOccupant = function () {
          if (sidebarOccupant === null) return;
          try {
            sidebarOccupant();
          } catch {
            /* 已随 fiber 一起卸掉 */
          }
          sidebarOccupant = null;
        };

        /**
         * 本插件的占位是否真的赢下了这一格。
         * 胜者投影里 -1 才是我们；拿不到投影就假定成功（不折腾）。
         */
        const occupantWins = function () {
          try {
            if (typeof ctx.slots.entriesOfSlot !== 'function') return true;
            const winners = ctx.slots.entriesOfSlot('sidebar.workspaces');
            if (!Array.isArray(winners) || winners.length === 0) return false;
            const head = winners[0];
            return head !== undefined && head.options !== undefined && head.options.priority === -1;
          } catch {
            return true;
          }
        };

        const clearRetry = function () {
          if (sidebarRetry !== null) {
            window.clearTimeout(sidebarRetry);
            sidebarRetry = null;
          }
        };

        const syncSidebarOccupant = function (tag) {
          const marker = typeof tag === 'string' ? tag : 'boot';
          if (getSidebarMode() !== SIDEBAR_TAGS) {
            clearRetry();
            sidebarTries = 0;
            teardownOccupant();
            return;
          }
          if (sidebarOccupant !== null) return;
          clearRetry();
          try {
            sidebarOccupant = ctx.slots.inject('sidebar.workspaces', function () {
              try {
                return ctx.slots.register({ name: 'sidebar.workspaces', priority: -1, locale: NS }, TagBrowser);
              } catch (error) {
                warn('sidebar.workspaces register failed', error);
                return function () {};
              }
            });
          } catch (error) {
            warn('sidebar.workspaces inject failed', error);
            sidebarOccupant = null;
          }
          /* 自检：热重载时上一份实例可能还占着同一格，登记会被挤掉；确认后再收手 */
          if (occupantWins()) {
            sidebarTries = 0;
            return;
          }
          teardownOccupant();
          if (sidebarTries >= 8) {
            warn('sidebar.workspaces occupant never won; keeping the host list');
            return;
          }
          sidebarTries += 1;
          sidebarRetry = window.setTimeout(function () {
            sidebarRetry = null;
            syncSidebarOccupant('retry' + String(sidebarTries));
          }, 200);
        };

        syncSidebarOccupant('boot');
        ctx.effect(function () {
          return subscribeSidebarMode(function () {
            syncSidebarOccupant('mode');
          });
        }, 'session-tags: sidebar mode switch');
        ctx.effect(function () {
          return function () {
            clearRetry();
          };
        }, 'session-tags: sidebar retry cleanup');

        /* ---- 右侧栏页类型：定义 + 正文 ---- */

        const registry = ctx.get('sidebarRightTabs');
        if (registry !== undefined && registry !== null && typeof registry.register === 'function') {
          ctx.effect(
            function () {
              return registry.register({
                id: TAB_ID,
                kind: TAB_KIND,
                priority: 'extension',
                title: function () {
                  return T('tab.title');
                },
                guide: [
                  {
                    id: 'session-tags-tree',
                    order: 40,
                    title: function () {
                      return T('tree.title');
                    },
                    description: function () {
                      return T('tree.guide');
                    }
                  }
                ]
              });
            },
            'session-tags: right-sidebar tab type'
          );

          ctx.slots.inject('sidebar.right.pane.tab', function () {
            return ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS }, TagsTree);
          });
        }

        /* ---- 会话行座位 ---- */

        ctx.slots.inject('sidebar.session.row.leading', function () {
          return ctx.slots.register({ name: 'sidebar.session.row.leading', id: 'session-tags', order: 20, locale: NS }, TagLeadDot);
        });

        ctx.slots.inject('sidebar.workspaces.session.row.action', function () {
          return ctx.slots.register({ name: 'sidebar.workspaces.session.row.action', id: 'session-tags', order: 50, locale: NS }, TagRowAction);
        });

        ctx.slots.inject('sidebar.workspaces.session.menu.item', function () {
          return ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'session-tags', order: 350, locale: NS }, TagMenuItem);
        });

        ctx.slots.inject('sidebar.session.row.hover', function () {
          return ctx.slots.register({ name: 'sidebar.session.row.hover', id: 'session-tags', order: 20, locale: NS }, TagHoverChips);
        });

        /* ---- 编辑器弹窗 ---- */

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({ name: 'shell.overlay', id: 'session-tags-editor', order: 60, locale: NS }, TagEditor);
        });
      }

      return {
        inject,
        apply,
        __test: {
          load,
          normalizeTag,
          buildModel,
          colorOf,
          readSidebarMode,
          getSidebarMode,
          writeSidebarMode,
          PALETTE,
          STORAGE_KEY,
          SIDEBAR_MODE_KEY
        }
      };
    }
  });
})();
