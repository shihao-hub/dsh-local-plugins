(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/session-tag-lite',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      /* ==================================================================== *
       * 会话标签（轻量）—— 参考 typeai WebUI 的「添加标签」能力
       *
       * 宿主座位（全部用 cordis_inspect_query 核实过 ownerProps / standardProps）：
       *
       *   sidebar.session.row.leading            行首 16px 色点（仅 idle 行挂载）
       *   sidebar.workspaces.session.row.action  行尾 hover 按钮条
       *   sidebar.workspaces.session.menu.item   「…」菜单项（hookContext: MenuOpenState）
       *   sidebar.session.row.hover              行悬停卡片段落
       *   shell.overlay                          编辑弹窗 + 标签总览面板
       *   sidebar.panellist                      顶部面板列表的「标签」图标
       *   main                                   拦截主面板切换后的兜底重定向
       *
       * 刻意不做：不 shadow `sidebar.workspaces`（不接管左侧会话列表）、
       * 不读宿主 CSS Module 类名、不写 data-*、不改宿主偏好。
       * 数据只落 localStorage：宿主没有写会话元数据的 API。
       * ==================================================================== */

      const NS = 'session-tag-lite';
      const STORAGE_KEY = 'session-tag-lite.v1';
      const REMOTE_URL = '/plugins/session-tag-lite/state';
      const CSS_ID = 'session-tag-lite-styles';

      /** 固定语义标签：始终排在池首，不参与「未使用自动清理」。 */
      const TODO = '待办';
      const ARCHIVE = '归档';
      const RESERVED = [TODO, ARCHIVE];
      const UNTAGGED = '未打标';
      const UNTAGGED_KEY = '__untagged__';

      const MAX_NAME_LEN = 24;
      /** 行尾色盘最多显示几段颜色；超过时只取前几段，完整标签名放在 title 里。 */
      const MAX_DISK_SLICES = 6;
      /** 「未打标」折叠后先露出的行数；超出时由「显示全部」按钮展开。 */
      const UNTAGGED_PREVIEW = 15;

      /** 「最近 N 小时」：时间维度的置顶分区，不是标签。 */
      const RECENT_KEY = '__recent__';
      const DEFAULT_RECENT_HOURS = 24;
      const RECENT_MIN_HOURS = 1;
      const RECENT_MAX_HOURS = 720;
      const RECENT_PRESETS = [6, 12, 24, 48, 72, 168];

      /** 语义色与哈希色环（typeai 同款调色板）。 */
      const TODO_COLOR = '#d9a441';
      const ARCHIVE_COLOR = '#9a9ca0';
      const HASH_COLORS = ['#8fb8e0', '#a3b89a', '#c49fd6', '#e0998a', '#7fc4bd', '#d6b88a', '#b4b3d4'];

      /** 面板 / 弹窗的一次性提示文案键。 */
      const zh = {
        'menu.label': '标签…',
        'action.title': '标签',
        'hover.edit': '编辑标签',
        'editor.title': '会话标签',
        'editor.tagLabel': '标签',
        'editor.placeholder': '+ 新建标签（Enter 创建，可用逗号分隔）',
        'editor.pool': '全库标签池',
        'editor.poolHint': '点击快速添加 / 取消',
        'editor.color': '改颜色',
        'editor.colorFor': '改「{name}」的颜色',
        'editor.colorHint': '为「{name}」选择颜色',
        'editor.due': '截止日期',
        'editor.clearDue': '清除',
        'editor.done': '完成',
        'editor.close': '关闭',
        'editor.removeTag': '移除「{name}」',
        'editor.addTag': '添加「{name}」',
        'editor.empty': '还没有标签；输入名字回车即可创建',
        'panel.title': '标签',
        'panel.heading': '会话标签',
        'panel.guide': '按标签浏览全部会话；搜索同时匹配标签名与会话标题',
        'panel.search': '搜索标签或会话',
        'panel.loading': '正在读取会话列表…',
        'panel.empty': '没有匹配的会话',
        'panel.emptyIdle': '还没有打过标签的会话；在会话行上点标签按钮开始',
        'panel.showAll': '显示全部 {n} 个',
        'panel.close': '关闭',
        'panel.running': '运行中',
        'panel.untagged': UNTAGGED,
        'panel.recent': '最近 {hours} 小时',
        'panel.hoursBtn': '最近 {hours}',
        'panel.hoursHint': '调整「最近」窗口',
        'panel.hoursUnit': '{n} 小时',
        'panel.hoursDays': '{n} 天',
        'panel.hoursCustom': '自定义（{min}–{max} 小时）',
        'panel.hoursUnitHint': '单位：小时，范围 {min}–{max}',
        'panel.hoursApply': '确定',
        'panel.rowTag': '打标签',
        'panel.quickTitle': '给「{title}」打标签',
        'panel.quickPlaceholder': '新建标签，回车添加',
        'time.now': '刚刚',
        'time.minutes': '{n}分钟',
        'time.hours': '{n}小时',
        'time.days': '{n}天',
        'time.months': '{n}个月',
        'time.years': '{n}年',
        'due.format': '{date} 截止',
        'relative.year': '{year}-{month}-{day}'
      };

      const en = {
        'menu.label': 'Tags…',
        'action.title': 'Tags',
        'hover.edit': 'Edit tags',
        'editor.title': 'Session tags',
        'editor.tagLabel': 'Tags',
        'editor.placeholder': '+ New tag (Enter to create, comma separated)',
        'editor.pool': 'All tags',
        'editor.poolHint': 'Click to add or remove',
        'editor.color': 'Change color',
        'editor.colorFor': 'Change the color of “{name}”',
        'editor.colorHint': 'Pick a color for “{name}”',
        'editor.due': 'Due date',
        'editor.clearDue': 'Clear',
        'editor.done': 'Done',
        'editor.close': 'Close',
        'editor.removeTag': 'Remove “{name}”',
        'editor.addTag': 'Add “{name}”',
        'editor.empty': 'No tags yet — type a name and press Enter',
        'panel.title': 'Tags',
        'panel.heading': 'Session tags',
        'panel.guide': 'Browse every Session by tag; search matches tag names and titles',
        'panel.search': 'Search tags or Sessions',
        'panel.loading': 'Reading the Session list…',
        'panel.empty': 'No matching Sessions',
        'panel.emptyIdle': 'No tagged Sessions yet — use the tag button on a Session row',
        'panel.showAll': 'Show all {n}',
        'panel.close': 'Close',
        'panel.running': 'Running',
        'panel.untagged': 'Untagged',
        'panel.recent': 'Last {hours} hours',
        'panel.hoursBtn': 'Last {hours}',
        'panel.hoursHint': 'Adjust the “recent” window',
        'panel.hoursUnit': '{n} h',
        'panel.hoursDays': '{n} d',
        'panel.hoursCustom': 'Custom ({min}–{max} hours)',
        'panel.hoursUnitHint': 'Unit: hours, {min}–{max}',
        'panel.hoursApply': 'Apply',
        'panel.rowTag': 'Tag this Session',
        'panel.quickTitle': 'Tag “{title}”',
        'panel.quickPlaceholder': 'New tag, press Enter',
        'time.now': 'now',
        'time.minutes': '{n}min',
        'time.hours': '{n}h',
        'time.days': '{n}d',
        'time.months': '{n}mo',
        'time.years': '{n}y',
        'due.format': 'Due {date}',
        'relative.year': '{year}-{month}-{day}'
      };

      /* ------------------------------------------------------------------ *
       * 小工具
       * ------------------------------------------------------------------ */

      let T = function (key) {
        return zh[key] === undefined ? key : zh[key];
      };

      function warn(message, error) {
        try {
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[session-tag-lite] ' + message, error);
          }
        } catch {
          /* 控制台不可用 */
        }
      }

      function fill(template, values) {
        return String(template).replace(/\{(\w+)\}/g, function (match, key) {
          return values[key] === undefined ? match : String(values[key]);
        });
      }

      /** 名字哈希取色：旧数据没有显式颜色、或标签池外的名字时的回退。 */
      function hashColorOf(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i += 1) {
          hash = (hash << 5) - hash + name.charCodeAt(i);
          hash |= 0;
        }
        return HASH_COLORS[Math.abs(hash) % HASH_COLORS.length];
      }

      /** 标签颜色：待办 / 归档固定语义色；其余优先用户选定的颜色，缺省回退哈希。 */
      function colorOf(state, name) {
        if (name === TODO) return TODO_COLOR;
        if (name === ARCHIVE) return ARCHIVE_COLOR;
        const stored = state === null || state === undefined || state.colors === undefined
          ? undefined
          : state.colors[name];
        if (typeof stored === 'string' && HASH_COLORS.indexOf(stored) >= 0) return stored;
        return hashColorOf(name);
      }

      /**
       * 新建标签自动选色：优先完全没被用过的颜色，其次用得最少的
       * （并列时取色环里靠前的），保证连建几个标签不会撞色。
       */
      function pickAutoColor(state) {
        const counts = HASH_COLORS.map(function () {
          return 0;
        });
        for (const name of state.tags) {
          if (RESERVED.indexOf(name) >= 0) continue;
          const index = HASH_COLORS.indexOf(colorOf(state, name));
          if (index >= 0) counts[index] += 1;
        }
        let best = 0;
        for (let i = 1; i < counts.length; i += 1) {
          if (counts[i] < counts[best]) best = i;
        }
        return HASH_COLORS[best];
      }

      /** 截止日期：过期判定 + 与 typeai 一致的「MM-DD 截止」文案。 */
      function formatDue(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (match === null) return null;
        const year = Number(match[1]);
        const month = match[2];
        const day = match[3];
        const now = new Date();
        const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
        const dueKey = year * 10000 + Number(month) * 100 + Number(day);
        const dateText =
          year === now.getFullYear()
            ? month + '-' + day
            : fill(T('relative.year'), { year: String(year), month: month, day: day });
        return { text: fill(T('due.format'), { date: dateText }), overdue: dueKey < today };
      }

      /**
       * 相对时间分桶：与宿主 ui-workspace 行上的 `relativeTime` 同构——
       * 刚刚 / N分钟 / N小时 / N天 / N个月 / N年。
       */
      function relativeTime(updatedAt, now) {
        const stamp = Number(updatedAt) || 0;
        const current = Number(now) || Date.now();
        if (stamp <= 0) return { unit: 'none', n: 0 };
        const diff = Math.max(0, current - stamp);
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;
        if (diff < minute) return { unit: 'now', n: 0 };
        if (diff < hour) return { unit: 'minutes', n: Math.floor(diff / minute) };
        if (diff < day) return { unit: 'hours', n: Math.floor(diff / hour) };
        if (diff < 30 * day) return { unit: 'days', n: Math.floor(diff / day) };
        if (diff < 365 * day) return { unit: 'months', n: Math.floor(diff / (30 * day)) };
        return { unit: 'years', n: Math.floor(diff / (365 * day)) };
      }

      /** 面板行尾的时间文案；时间戳缺失时给空串（不渲染）。 */
      function relativeLabel(updatedAt, now) {
        const info = relativeTime(updatedAt, now);
        if (info.unit === 'none') return '';
        if (info.unit === 'now') return T('time.now');
        return fill(T('time.' + info.unit), { n: String(info.n) });
      }

      /* ------------------------------------------------------------------ *
       * 存储：不可变快照 + 订阅者（localStorage 为唯一持久层）
       * ------------------------------------------------------------------ */

      function emptyData() {
        return {
          version: 1,
          tags: [],
          marks: {},
          due: {},
          collapsed: {},
          colors: {},
          options: { recentHours: DEFAULT_RECENT_HOURS }
        };
      }

      function normalizeName(value) {
        if (typeof value !== 'string') return '';
        return value.trim().slice(0, MAX_NAME_LEN);
      }

      /**
       * 读入即规范化：脏数据一律丢弃；marks 引用到的名字回填到池；
       * 池里已无任何会话使用、且不是保留名的标签被清理（typeai 无删除标签界面，
       * 标签随最后一个引用消失）。
       */
      function normalizeData(raw) {
        const out = emptyData();
        out.tags = RESERVED.slice();
        if (raw === null || typeof raw !== 'object') return out;

        const seen = new Set(RESERVED);
        const addName = function (value) {
          const name = normalizeName(value);
          if (name === '' || seen.has(name)) return;
          seen.add(name);
          out.tags.push(name);
        };

        if (Array.isArray(raw.tags)) {
          for (const value of raw.tags) addName(value);
        }

        const marks = {};
        if (raw.marks !== null && typeof raw.marks === 'object') {
          for (const key of Object.keys(raw.marks)) {
            const list = raw.marks[key];
            if (!Array.isArray(list)) continue;
            const names = [];
            for (const value of list) {
              const name = normalizeName(value);
              if (name === '' || names.indexOf(name) >= 0) continue;
              names.push(name);
              addName(name);
            }
            if (names.length > 0) marks[key] = names;
          }
        }
        out.marks = marks;

        const due = {};
        if (raw.due !== null && typeof raw.due === 'object') {
          for (const key of Object.keys(raw.due)) {
            const value = raw.due[key];
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) due[key] = value;
          }
        }
        out.due = due;

        const collapsed = {};
        if (raw.collapsed !== null && typeof raw.collapsed === 'object') {
          for (const key of Object.keys(raw.collapsed)) {
            if (typeof raw.collapsed[key] === 'boolean') collapsed[key] = raw.collapsed[key];
          }
        }
        out.collapsed = collapsed;

        const options = { recentHours: DEFAULT_RECENT_HOURS };
        if (raw.options !== null && typeof raw.options === 'object') {
          const hours = raw.options.recentHours;
          if (typeof hours === 'number' && Number.isFinite(hours)) {
            const rounded = Math.round(hours);
            if (rounded >= RECENT_MIN_HOURS && rounded <= RECENT_MAX_HOURS) {
              options.recentHours = rounded;
            }
          }
        }
        out.options = options;

        const colors = {};
        if (raw.colors !== null && typeof raw.colors === 'object') {
          for (const key of Object.keys(raw.colors)) {
            const value = raw.colors[key];
            if (typeof value === 'string' && HASH_COLORS.indexOf(value) >= 0) colors[key] = value;
          }
        }

        const used = new Set(RESERVED);
        for (const key of Object.keys(marks)) {
          for (const name of marks[key]) used.add(name);
        }
        out.tags = out.tags.filter(function (name) {
          return used.has(name);
        });
        /* 颜色只保留仍在池里的自定义标签；保留名用固定语义色，不落盘。 */
        const kept = new Set(out.tags);
        for (const key of Object.keys(colors)) {
          if (kept.has(key) && RESERVED.indexOf(key) < 0) out.colors[key] = colors[key];
        }
        return out;
      }

      function loadData() {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw === null) return normalizeData(null);
          return normalizeData(JSON.parse(raw));
        } catch {
          return normalizeData(null);
        }
      }

      let data = loadData();
      let ui = { editor: null, panel: false, panelQuery: null };
      let snapshot = { data: data, ui: ui };
      const listeners = new Set();
      let storageWarned = false;

      function getSnapshot() {
        return snapshot;
      }

      function subscribe(listener) {
        listeners.add(listener);
        return function () {
          listeners.delete(listener);
        };
      }

      function publish() {
        snapshot = { data: data, ui: ui };
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
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (error) {
          if (!storageWarned) {
            storageWarned = true;
            warn('localStorage 不可用，标签只保存在本次页面内存里', error);
          }
        }
      }

      /* ------------------------------------------------------------------ *
       * 远端持久化
       *
       * Host 半区在 `/plugins/session-tag-lite/state` 暴露整份状态（写入
       * `$DSH_HOME/session-tag-lite/state.json`）。存在时以远端为准：换浏览器、
       * 清站点数据都不丢；不存在（desktop 没有 webServer）时整个插件退回
       * localStorage 单机模式，行为不变。
       * ------------------------------------------------------------------ */

      let remoteMode = 'unknown';
      let saveTimer = null;

      function remoteHeaders(extra) {
        return Object.assign({ 'x-session-tag-lite': '1' }, extra || {});
      }

      function hasContent(state) {
        if (state === null || state === undefined) return false;
        if (state.marks !== undefined && Object.keys(state.marks).length > 0) return true;
        if (state.due !== undefined && Object.keys(state.due).length > 0) return true;
        return false;
      }

      function pullRemote() {
        if (typeof fetch !== 'function') {
          remoteMode = 'off';
          return;
        }
        fetch(REMOTE_URL, {
          headers: remoteHeaders(),
          credentials: 'same-origin',
          cache: 'no-store'
        })
          .then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
          })
          .then(function (payload) {
            remoteMode = 'on';
            const remote = normalizeData(
              payload !== null && typeof payload === 'object' && payload.data !== undefined
                ? payload.data
                : null
            );
            if (!hasContent(data) && hasContent(remote)) {
              /* 本地为空（新浏览器、清过站点数据）：用远端恢复。 */
              data = remote;
              persist();
              publish();
              return;
            }
            if (hasContent(data)) {
              /* 本地有数据：本地优先，推上去覆盖远端，避免被另一个客户端的
                 空状态（或旧状态）把本机标签抹掉。 */
              scheduleSave();
            }
          })
          .catch(function () {
            remoteMode = 'off';
          });
      }

      function scheduleSave() {
        if (remoteMode !== 'on' || typeof fetch !== 'function') return;
        if (saveTimer !== null) return;
        saveTimer = setTimeout(function () {
          saveTimer = null;
          pushRemote();
        }, 300);
      }

      function pushRemote() {
        fetch(REMOTE_URL, {
          method: 'PUT',
          headers: remoteHeaders({ 'content-type': 'application/json' }),
          credentials: 'same-origin',
          body: JSON.stringify({ data: data })
        }).catch(function () {
          remoteMode = 'off';
        });
      }

      function commitData(next) {
        data = normalizeData(next);
        persist();
        publish();
        scheduleSave();
      }

      /* ---------------------------- 读 ---------------------------- */

      function tagsOf(state, sessionId) {
        const list = state === null || state === undefined ? undefined : state.marks[sessionId];
        return Array.isArray(list) ? list.slice() : [];
      }

      function dueOf(state, sessionId) {
        const value = state === null || state === undefined ? undefined : state.due[sessionId];
        return typeof value === 'string' ? value : '';
      }

      /** 全库标签池的有序视图：保留名在前，其余按字典序。 */
      function orderedPool(state) {
        const others = state.tags.filter(function (name) {
          return RESERVED.indexOf(name) < 0;
        });
        others.sort(function (a, b) {
          return a.localeCompare(b);
        });
        return RESERVED.concat(others);
      }

      /** 分组是否折叠：显式记录优先；「未打标」默认折叠，其余默认展开。 */
      function isCollapsed(state, key) {
        const value = state.collapsed[key];
        if (typeof value === 'boolean') return value;
        return key === UNTAGGED_KEY;
      }

      /** 「最近」窗口的小时数：缺省 24，脏值回落默认。 */
      function recentHoursOf(state) {
        const value =
          state === null || state === undefined || state.options === undefined
            ? undefined
            : state.options.recentHours;
        if (typeof value === 'number' && Number.isFinite(value)) {
          const rounded = Math.round(value);
          if (rounded >= RECENT_MIN_HOURS && rounded <= RECENT_MAX_HOURS) return rounded;
        }
        return DEFAULT_RECENT_HOURS;
      }

      /** 调整「最近 N 小时」窗口；越界或非数字一律忽略。 */
      function setRecentHours(value) {
        const hours = Math.round(Number(value));
        if (!Number.isFinite(hours) || hours < RECENT_MIN_HOURS || hours > RECENT_MAX_HOURS) return;
        if (hours === recentHoursOf(data)) return;
        commitData(
          Object.assign({}, data, {
            options: Object.assign({}, data.options, { recentHours: hours })
          })
        );
      }

      /** 小时数的人话标签：≥2 整天用「N 天」，其余用「N 小时」。 */
      function hoursLabel(hours) {
        if (hours >= 48 && hours % 24 === 0) {
          return fill(T('panel.hoursDays'), { n: String(hours / 24) });
        }
        return fill(T('panel.hoursUnit'), { n: String(hours) });
      }

      /* ---------------------------- 写 ---------------------------- */

      function writeMarks(sessionId, names) {
        if (typeof sessionId !== 'string' || sessionId === '') return;
        const marks = Object.assign({}, data.marks);
        if (names.length === 0) delete marks[sessionId];
        else marks[sessionId] = names;
        const tags = data.tags.slice();
        for (const name of names) {
          if (tags.indexOf(name) < 0) tags.push(name);
        }
        commitData(Object.assign({}, data, { tags: tags, marks: marks }));
      }

      function addSessionTag(sessionId, rawName) {
        const name = normalizeName(rawName);
        if (sessionId === '' || name === '') return;

        const names = tagsOf(data, sessionId);
        if (names.indexOf(name) >= 0) return;

        /* 池里还没有这个标签 → 新建：自动挑一个尚未被用过的颜色。 */
        const isNew = data.tags.indexOf(name) < 0;
        const colors = isNew ? Object.assign({}, data.colors) : data.colors;
        if (isNew) colors[name] = pickAutoColor(data);

        names.push(name);
        const marks = Object.assign({}, data.marks);
        marks[sessionId] = names;
        const tags = isNew ? data.tags.concat([name]) : data.tags;

        commitData(Object.assign({}, data, { tags: tags, marks: marks, colors: colors }));
      }

      /** 改某个自定义标签的颜色（全局生效；待办 / 归档固定色不可改）。 */
      function setTagColor(name, color) {
        const clean = normalizeName(name);
        if (clean === '' || RESERVED.indexOf(clean) >= 0) return;
        if (HASH_COLORS.indexOf(color) < 0) return;
        const colors = Object.assign({}, data.colors);
        colors[clean] = color;
        commitData(Object.assign({}, data, { colors: colors }));
      }

      function removeSessionTag(sessionId, name) {
        const names = tagsOf(data, sessionId).filter(function (item) {
          return item !== name;
        });
        writeMarks(sessionId, names);
      }

      function toggleSessionTag(sessionId, name) {
        if (tagsOf(data, sessionId).indexOf(name) >= 0) removeSessionTag(sessionId, name);
        else addSessionTag(sessionId, name);
      }

      function setDue(sessionId, value) {
        if (typeof sessionId !== 'string' || sessionId === '') return;
        const due = Object.assign({}, data.due);
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) due[sessionId] = value;
        else delete due[sessionId];
        commitData(Object.assign({}, data, { due: due }));
      }

      function toggleCollapsed(key) {
        const collapsed = Object.assign({}, data.collapsed);
        collapsed[key] = !isCollapsed(data, key);
        commitData(Object.assign({}, data, { collapsed: collapsed }));
      }

      /* ---------------------------- UI 状态 ---------------------------- */

      function openEditor(sessionId, displayTitle) {
        if (typeof sessionId !== 'string' || sessionId === '') return;
        ui = {
          editor: { sessionId: sessionId, title: typeof displayTitle === 'string' ? displayTitle : '' },
          panel: false,
          panelQuery: null
        };
        publish();
      }

      function closeEditor() {
        if (ui.editor === null) return;
        ui = { editor: null, panel: false, panelQuery: null };
        publish();
      }

      function openPanel(query) {
        ui = {
          editor: null,
          panel: true,
          panelQuery: typeof query === 'string' && query.trim() !== '' ? query.trim() : null
        };
        publish();
      }

      function closePanel() {
        if (!ui.panel) return;
        ui = { editor: null, panel: false, panelQuery: null };
        publish();
      }

      /* ------------------------------------------------------------------ *
       * 宿主快照 + 订阅式读取
       * ------------------------------------------------------------------ */

      let sessionStore = null;
      let uiWorkspace = null;
      let layout = null;

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

      const useApp = makeHook(getSnapshot, subscribe);
      const useSessions = makeHook(
        function () {
          return sessionStore === null ? null : sessionStore.getSnapshot();
        },
        function (listener) {
          return sessionStore === null ? function () {} : sessionStore.subscribe(listener);
        }
      );

      function openSession(sessionId) {
        try {
          if (uiWorkspace === null || typeof uiWorkspace.openSession !== 'function') return;
          uiWorkspace.openSession(sessionId);
          closePanel();
        } catch (error) {
          warn('打开会话失败', error);
        }
      }

      /* ------------------------------------------------------------------ *
       * 面板模型（纯函数，便于离线测试）
       * ------------------------------------------------------------------ */

      function buildPanelModel(state, sessionList, query) {
        if (sessionList === null || sessionList === undefined) return null;
        if (sessionList.byId === null || typeof sessionList.byId !== 'object') return null;

        const ids = Array.isArray(sessionList.ids) ? sessionList.ids : [];
        const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
        const rows = [];
        const seen = new Set();

        for (const id of ids) {
          if (seen.has(id)) continue;
          const summary = sessionList.byId[id];
          if (summary === undefined || summary === null) continue;
          if (summary.blank === true) continue;
          /* 子代理会话不上架：宿主左栏的 sessionVisible 同样按 origin 过滤，
             这里镜像同一规则，否则标签面板会列出一堆只属于某个父会话的子智能体。 */
          if (summary.origin === 'subagent') continue;
          seen.add(id);
          const title =
            typeof summary.displayTitle === 'string' && summary.displayTitle !== ''
              ? summary.displayTitle
              : String(id).slice(0, 8);
          rows.push({
            id: id,
            title: title,
            updatedAt: Number(summary.updatedAt) || 0,
            running: summary.running === true,
            due: dueOf(state, id),
            tags: tagsOf(state, id)
          });
        }

        const matchTitle = function (row) {
          return needle === '' || row.title.toLowerCase().indexOf(needle) >= 0;
        };
        const matchTag = function (row) {
          if (needle === '') return true;
          for (const name of row.tags) {
            if (name.toLowerCase().indexOf(needle) >= 0) return true;
          }
          return false;
        };
        const filter = function (extra) {
          return rows.filter(function (row) {
            return extra(row) && (matchTitle(row) || matchTag(row));
          });
        };
        const forTag = function (name) {
          return filter(function (row) {
            return row.tags.indexOf(name) >= 0;
          });
        };
        const sortRows = function (list) {
          return list.slice().sort(function (a, b) {
            return b.updatedAt - a.updatedAt;
          });
        };

        const groups = [];
        for (const name of RESERVED) {
          groups.push({
            key: name,
            name: name,
            color: colorOf(state, name),
            rows: sortRows(forTag(name)),
            reserved: true,
            untagged: false
          });
        }
        const others = state.tags.filter(function (name) {
          return RESERVED.indexOf(name) < 0;
        });
        others.sort(function (a, b) {
          return a.localeCompare(b);
        });
        for (const name of others) {
          const list = sortRows(forTag(name));
          if (list.length === 0) continue;
          groups.push({
            key: name,
            name: name,
            color: colorOf(state, name),
            rows: list,
            reserved: false,
            untagged: false
          });
        }
        const untaggedRows = sortRows(
          filter(function (row) {
            return row.tags.length === 0;
          })
        );
        if (untaggedRows.length > 0) {
          groups.push({
            key: UNTAGGED_KEY,
            name: T('panel.untagged'),
            color: '',
            rows: untaggedRows,
            reserved: false,
            untagged: true
          });
        }

        /* 「最近 N 小时」置顶分区：时间维度，不是标签；窗口内（或运行中）的
           会话按最近活动倒序。它自己会随时间收敛，不会像「未打标」那样无限长。 */
        const hours = recentHoursOf(state);
        const windowStart = Date.now() - hours * 3600 * 1000;
        const recentRows = sortRows(
          filter(function (row) {
            return row.running || row.updatedAt >= windowStart;
          })
        );
        if (recentRows.length > 0) {
          groups.unshift({
            key: RECENT_KEY,
            name: fill(T('panel.recent'), { hours: String(hours) }),
            color: '',
            icon: 'clock',
            rows: recentRows,
            reserved: false,
            untagged: false,
            recent: true
          });
        }

        /* 浏览态保留「待办 / 归档」两个组头（即使为空），让分类骨架稳定；
           搜索态只保留有命中的组，避免一堆 0 计数干扰。 */
        return {
          groups:
            needle === ''
              ? groups
              : groups.filter(function (group) {
                  return group.rows.length > 0;
                }),
          total: rows.length
        };
      }

      /* ------------------------------------------------------------------ *
       * 图标
       * ------------------------------------------------------------------ */

      function TagIcon(props) {
        const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16;
        return h(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: size,
            height: size,
            fill: 'none',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('path', {
            d:
              'M11.2 3H5.5A2.5 2.5 0 0 0 3 5.5v5.7c0 .66.26 1.3.73 1.77l7.3 7.3a2.5 2.5 0 0 0 3.54 0l5.7-5.7a2.5 2.5 0 0 0 0-3.54l-7.3-7.3A2.5 2.5 0 0 0 11.2 3Z',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinejoin: 'round'
          }),
          h('circle', { cx: 8.2, cy: 8.2, r: 1.5, fill: 'currentColor' })
        );
      }

      /** 时钟图标：「最近 N 小时」分区的组头标记（不是标签色点）。 */
      function ClockIcon(props) {
        const size = typeof props.size === 'number' && props.size > 0 ? props.size : 12;
        return h(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: size,
            height: size,
            fill: 'none',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('circle', { cx: 12, cy: 12, r: 8.5, stroke: 'currentColor', strokeWidth: 1.7 }),
          h('path', {
            d: 'M12 7.5v5l3 1.8',
            stroke: 'currentColor',
            strokeWidth: 1.7,
            strokeLinecap: 'round'
          })
        );
      }

      /* ------------------------------------------------------------------ *
       * 座位组件
       * ------------------------------------------------------------------ */

      /**
       * 行尾「色盘」：把该会话的标签色合成一个 11–14px 的圆盘。
       * 1 个标签是纯色圆，≥2 个用 conic-gradient 等分扇区，无标签是空心圆。
       * 刻意不再逐点平铺，避免行尾出现一串彩色小圆点。
       */
      function SwatchDisk(props) {
        const colors = Array.isArray(props.colors) ? props.colors : [];
        const size = typeof props.size === 'number' && props.size > 0 ? props.size : 13;
        if (colors.length === 0) {
          return h('span', {
            className: 'stl_disk stl_diskEmpty',
            style: { width: size, height: size }
          });
        }
        const background =
          colors.length === 1
            ? colors[0]
            : 'conic-gradient(' +
              colors
                .map(function (color, index) {
                  const from = (index * 360) / colors.length;
                  const to = ((index + 1) * 360) / colors.length;
                  return color + ' ' + from.toFixed(2) + 'deg ' + to.toFixed(2) + 'deg';
                })
                .join(',') +
              ')';
        return h('span', {
          className: 'stl_disk',
          style: { width: size, height: size, background: background }
        });
      }

      function RowAction(props) {
        const app = useApp();
        const names = tagsOf(app.data, props.sessionId);
        const colors = names.slice(0, MAX_DISK_SLICES).map(function (name) {
          return colorOf(app.data, name);
        });
        const label = names.length === 0 ? T('action.title') : names.join(' · ');
        return h(
          'button',
          {
            type: 'button',
            className: 'stl_action',
            title: label,
            'aria-label': label,
            onClick: function (event) {
              event.stopPropagation();
              openEditor(props.sessionId, props.displayTitle);
            }
          },
          h(SwatchDisk, { colors: colors })
        );
      }

      function MenuItem(props) {
        const app = useApp();
        /* 宿主把 useMenuOpenState 投影进 owner 的 hookContext；两种命名都兼容。
           该条件在同一注册上固定不变，因此 hook 调用顺序稳定。 */
        const menuHook =
          (typeof props.useMenuOpenState === 'function' && props.useMenuOpenState) ||
          (typeof props.menuOpenState === 'function' && props.menuOpenState) ||
          null;
        const names = tagsOf(app.data, props.sessionId);
        const closeMenu = function (pair) {
          if (pair !== null && typeof pair[1] === 'function') pair[1](false);
        };
        const pair = menuHook === null ? null : menuHook();
        return h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            className: 'stl_mitem',
            onClick: function () {
              closeMenu(pair);
              openEditor(props.sessionId, props.displayTitle);
            }
          },
          h(
            'span',
            { className: 'stl_miglyph', 'aria-hidden': 'true' },
            h(SwatchDisk, {
              size: 11,
              colors: names.slice(0, MAX_DISK_SLICES).map(function (name) {
                return colorOf(app.data, name);
              })
            })
          ),
          h('span', { className: 'stl_milabel' }, T('menu.label'))
        );
      }

      function HoverChips(props) {
        const app = useApp();
        const names = tagsOf(app.data, props.sessionId);
        const due = dueOf(app.data, props.sessionId);
        if (names.length === 0 && due === '') return null;
        const dueInfo = due === '' ? null : formatDue(due);
        return h(
          'div',
          { className: 'stl_chips' },
          names.map(function (name) {
            return h(
              'button',
              {
                key: name,
                type: 'button',
                className: 'stl_chip',
                title: fill(T('editor.addTag'), { name: name }),
                onClick: function (event) {
                  event.stopPropagation();
                  openPanel(name);
                }
              },
              h('span', { className: 'stl_chipDot', style: { background: colorOf(app.data, name) } }),
              name
            );
          }),
          dueInfo === null
            ? null
            : h(
                'span',
                { className: 'stl_due' + (dueInfo.overdue ? ' stl_dueLate' : '') },
                dueInfo.text
              ),
          h(
            'button',
            {
              type: 'button',
              className: 'stl_chipEdit',
              onClick: function (event) {
                event.stopPropagation();
                openEditor(props.sessionId, '');
              }
            },
            T('hover.edit')
          )
        );
      }

      /* ---------------------------- 编辑弹窗 ---------------------------- */

      function Editor() {
        const app = useApp();
        const sessionList = useSessions();
        const [draft, setDraft] = React.useState('');
        const [colorTarget, setColorTarget] = React.useState(null);
        const target = app.ui.editor;
        const sessionId = target === null ? '' : target.sessionId;

        React.useEffect(
          function () {
            if (sessionId === '') return undefined;
            setDraft('');
            setColorTarget(null);
            const onKey = function (event) {
              if (event.key === 'Escape') closeEditor();
            };
            if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
              window.addEventListener('keydown', onKey);
              return function () {
                window.removeEventListener('keydown', onKey);
              };
            }
            return undefined;
          },
          [sessionId]
        );

        if (target === null) return null;

        const summary =
          sessionList !== null &&
          sessionList.byId !== null &&
          typeof sessionList.byId === 'object'
            ? sessionList.byId[sessionId]
            : undefined;
        const fallbackTitle =
          summary !== undefined && summary !== null && typeof summary.displayTitle === 'string'
            ? summary.displayTitle
            : '';
        const displayTitle =
          target.title !== ''
            ? target.title
            : fallbackTitle !== ''
              ? fallbackTitle
              : sessionId.slice(0, 8);
        const names = tagsOf(app.data, sessionId);
        const due = dueOf(app.data, sessionId);
        const pool = orderedPool(app.data);

        const commitDraft = function () {
          const raw = draft.trim();
          if (raw === '') return false;
          const parts = raw.split(/[,，]/);
          for (const part of parts) addSessionTag(sessionId, part);
          setDraft('');
          return true;
        };

        return h(
          'div',
          {
            className: 'stl_backdrop',
            onMouseDown: function (event) {
              if (event.target === event.currentTarget) closeEditor();
            }
          },
          h(
            'div',
            {
              className: 'stl_dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': T('editor.title')
            },
            h(
              'div',
              { className: 'stl_dhead' },
              h(
                'div',
                { className: 'stl_dtitles' },
                h('div', { className: 'stl_dtitle' }, T('editor.title')),
                h('div', { className: 'stl_dsub', title: displayTitle }, displayTitle)
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'stl_icon',
                  title: T('editor.close'),
                  'aria-label': T('editor.close'),
                  onClick: closeEditor
                },
                '×'
              )
            ),
            h(
              'div',
              { className: 'stl_dbody' },
              h(
                'div',
                { className: 'stl_field' },
                h('div', { className: 'stl_flabel' }, T('editor.tagLabel')),
                h(
                  'div',
                  { className: 'stl_pills' },
                  names.map(function (name) {
                    const color = colorOf(app.data, name);
                    return h(
                      'span',
                      {
                        key: name,
                        className: 'stl_pill',
                        style: {
                          borderColor: 'color-mix(in srgb, ' + color + ' 45%, transparent)',
                          color: color,
                          background: 'color-mix(in srgb, ' + color + ' 12%, transparent)'
                        }
                      },
                      h('button', {
                        type: 'button',
                        className: 'stl_pillSwatch',
                        style: { background: color },
                        title: fill(T('editor.colorFor'), { name: name }),
                        'aria-label': fill(T('editor.colorFor'), { name: name }),
                        onClick: function () {
                          setColorTarget(colorTarget === name ? null : name);
                        }
                      }),
                      name,
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'stl_pillX',
                          title: fill(T('editor.removeTag'), { name: name }),
                          'aria-label': fill(T('editor.removeTag'), { name: name }),
                          onClick: function () {
                            removeSessionTag(sessionId, name);
                          }
                        },
                        '×'
                      )
                    );
                  }),
                  names.length === 0 ? h('span', { className: 'stl_hint' }, T('editor.empty')) : null
                ),
                colorTarget !== null && names.indexOf(colorTarget) >= 0
                  ? h(
                      'div',
                      { className: 'stl_palette', role: 'group', 'aria-label': T('editor.color') },
                      HASH_COLORS.map(function (option) {
                        const active = colorOf(app.data, colorTarget) === option;
                        return h('button', {
                          key: option,
                          type: 'button',
                          className: 'stl_paletteChip' + (active ? ' stl_paletteChipActive' : ''),
                          style: { background: option },
                          title: option,
                          'aria-label': option,
                          onClick: function () {
                            setTagColor(colorTarget, option);
                            setColorTarget(null);
                          }
                        });
                      }),
                      h(
                        'span',
                        { className: 'stl_paletteHint' },
                        fill(T('editor.colorHint'), { name: colorTarget })
                      )
                    )
                  : null,
                h('input', {
                  className: 'stl_input',
                  value: draft,
                  autoFocus: true,
                  placeholder: T('editor.placeholder'),
                  'aria-label': T('editor.placeholder'),
                  onChange: function (event) {
                    setDraft(event.target.value);
                  },
                  onKeyDown: function (event) {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitDraft();
                    } else if (
                      event.key === 'Backspace' &&
                      draft === '' &&
                      names.length > 0
                    ) {
                      event.preventDefault();
                      removeSessionTag(sessionId, names[names.length - 1]);
                    }
                  }
                })
              ),
              h(
                'div',
                { className: 'stl_field' },
                h(
                  'div',
                  { className: 'stl_flabel' },
                  T('editor.pool') + ' · ' + T('editor.poolHint')
                ),
                h(
                  'div',
                  { className: 'stl_pool' },
                  pool.map(function (name) {
                    const active = names.indexOf(name) >= 0;
                    const color = colorOf(app.data, name);
                    return h(
                      'button',
                      {
                        key: name,
                        type: 'button',
                        className: 'stl_poolChip' + (active ? ' stl_poolChipActive' : ''),
                        style: {
                          color: color,
                          borderColor:
                            'color-mix(in srgb, ' + color + ' ' + (active ? '55' : '25') + '%, transparent)',
                          background: active
                            ? 'color-mix(in srgb, ' + color + ' 18%, transparent)'
                            : 'transparent'
                        },
                        title: active
                          ? fill(T('editor.removeTag'), { name: name })
                          : fill(T('editor.addTag'), { name: name }),
                        onClick: function () {
                          toggleSessionTag(sessionId, name);
                        }
                      },
                      h('span', { className: 'stl_poolDot', style: { background: color } }),
                      (active ? '✓ ' : '+ ') + name
                    );
                  })
                )
              ),
              h(
                'div',
                { className: 'stl_field' },
                h('div', { className: 'stl_flabel' }, T('editor.due')),
                h(
                  'div',
                  { className: 'stl_dueRow' },
                  h('input', {
                    type: 'date',
                    className: 'stl_input',
                    value: due,
                    'aria-label': T('editor.due'),
                    onChange: function (event) {
                      setDue(sessionId, event.target.value);
                    }
                  }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'stl_textBtn',
                      onClick: function () {
                        setDue(sessionId, '');
                      }
                    },
                    T('editor.clearDue')
                  )
                )
              )
            ),
            h(
              'div',
              { className: 'stl_dfoot' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'stl_primary',
                  onClick: function () {
                    commitDraft();
                    closeEditor();
                  }
                },
                T('editor.done')
              )
            )
          )
        );
      }

      /* ---------------------------- 标签总览面板 ---------------------------- */

      function Panel() {
        const app = useApp();
        const sessionList = useSessions();
        const [query, setQuery] = React.useState('');
        const [showAllUntagged, setShowAllUntagged] = React.useState(false);
        const [quickId, setQuickId] = React.useState(null);
        const [quickDraft, setQuickDraft] = React.useState('');
        const [hoursOpen, setHoursOpen] = React.useState(false);
        const [hoursDraft, setHoursDraft] = React.useState('');
        const wasOpen = React.useRef(false);

        React.useEffect(
          function () {
            if (app.ui.panel && !wasOpen.current) {
              wasOpen.current = true;
              setQuery(app.ui.panelQuery === null ? '' : app.ui.panelQuery);
              setShowAllUntagged(false);
              setQuickId(null);
              setQuickDraft('');
              setHoursOpen(false);
              setHoursDraft(String(recentHoursOf(app.data)));
            } else if (!app.ui.panel && wasOpen.current) {
              wasOpen.current = false;
            }
          },
          [app.ui.panel, app.ui.panelQuery]
        );

        React.useEffect(
          function () {
            if (!app.ui.panel) return undefined;
            const onKey = function (event) {
              if (event.key !== 'Escape') return;
              if (quickId !== null) {
                setQuickId(null);
                return;
              }
              if (hoursOpen) {
                setHoursOpen(false);
                return;
              }
              closePanel();
            };
            if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
              window.addEventListener('keydown', onKey);
              return function () {
                window.removeEventListener('keydown', onKey);
              };
            }
            return undefined;
          },
          [app.ui.panel, quickId, hoursOpen]
        );

        if (!app.ui.panel) return null;

        const model = buildPanelModel(app.data, sessionList, query);
        const nowMs = Date.now();

        const renderGroup = function (group) {
          const searching = query.trim() !== '';
          const collapsed = !searching && isCollapsed(app.data, group.key);
          const total = group.rows.length;
          const limited =
            group.untagged && !searching && !showAllUntagged && total > UNTAGGED_PREVIEW;
          const visible = limited ? group.rows.slice(0, UNTAGGED_PREVIEW) : group.rows;
          return h(
            'div',
            { key: group.key, className: 'stl_group' },
            h(
              'button',
              {
                type: 'button',
                className: 'stl_ghead',
                onClick: function () {
                  if (searching) return;
                  toggleCollapsed(group.key);
                }
              },
              h('span', { className: 'stl_gchev' }, collapsed ? '▸' : '▾'),
              group.icon === 'clock'
                ? h('span', { className: 'stl_gclock' }, h(ClockIcon, { size: 12 }))
                : group.color === ''
                  ? h('span', { className: 'stl_gdot stl_gdotEmpty' })
                  : h('span', { className: 'stl_gdot', style: { background: group.color } }),
              h('span', { className: 'stl_gname' }, group.name),
              h('span', { className: 'stl_gcount' }, String(group.rows.length))
            ),
            collapsed
              ? null
              : h(
                  'div',
                  { className: 'stl_grows' },
                  visible.map(function (row) {
                    const dueInfo = row.due === '' ? null : formatDue(row.due);
                    const quick = quickId === row.id;
                    return h(
                      'div',
                      { key: row.id, className: 'stl_srowWrap' },
                      h(
                        'div',
                        {
                          className: 'stl_srow',
                          role: 'button',
                          tabIndex: 0,
                          title: row.title,
                          onClick: function () {
                            openSession(row.id);
                          },
                          onKeyDown: function (event) {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openSession(row.id);
                            }
                          }
                        },
                        h('span', { className: 'stl_stitle', title: row.title }, row.title),
                        row.tags
                          .filter(function (name) {
                            return name !== group.name;
                          })
                          .slice(0, 2)
                          .map(function (name) {
                            return h(
                              'span',
                              { key: name, className: 'stl_sbadge' },
                              h('span', {
                                className: 'stl_sbadgeDot',
                                style: { background: colorOf(app.data, name) }
                              }),
                              name
                            );
                          }),
                        dueInfo === null
                          ? null
                          : h(
                              'span',
                              { className: 'stl_sdue' + (dueInfo.overdue ? ' stl_sdueLate' : '') },
                              dueInfo.text
                            ),
                        row.running
                          ? h('span', { className: 'stl_run', title: T('panel.running') })
                          : null,
                        row.updatedAt > 0
                          ? h(
                              'span',
                              {
                                className: 'stl_stime',
                                title: new Date(row.updatedAt).toLocaleString()
                              },
                              relativeLabel(row.updatedAt, nowMs)
                            )
                          : null,
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'stl_rowAct',
                            title: T('panel.rowTag'),
                            'aria-label': T('panel.rowTag'),
                            'aria-expanded': quick,
                            onClick: function (event) {
                              event.stopPropagation();
                              setQuickId(quick ? null : row.id);
                              setQuickDraft('');
                            }
                          },
                          quick ? '−' : '+'
                        )
                      ),
                      quick
                        ? h(
                            'div',
                            { className: 'stl_quick' },
                            h(
                              'div',
                              { className: 'stl_quickHead' },
                              fill(T('panel.quickTitle'), { title: row.title })
                            ),
                            h(
                              'div',
                              { className: 'stl_quickPool' },
                              orderedPool(app.data).map(function (name) {
                                const active = row.tags.indexOf(name) >= 0;
                                const color = colorOf(app.data, name);
                                return h(
                                  'button',
                                  {
                                    key: name,
                                    type: 'button',
                                    className: 'stl_quickChip' + (active ? ' stl_quickChipActive' : ''),
                                    style: {
                                      color: color,
                                      borderColor:
                                        'color-mix(in srgb, ' +
                                        color +
                                        ' ' +
                                        (active ? '55' : '25') +
                                        '%, transparent)'
                                    },
                                    title: active
                                      ? fill(T('editor.removeTag'), { name: name })
                                      : fill(T('editor.addTag'), { name: name }),
                                    onClick: function () {
                                      toggleSessionTag(row.id, name);
                                    }
                                  },
                                  h('span', { className: 'stl_quickDot', style: { background: color } }),
                                  (active ? '✓ ' : '+ ') + name
                                );
                              })
                            ),
                            h('input', {
                              className: 'stl_input stl_quickInput',
                              value: quickDraft,
                              autoFocus: true,
                              placeholder: T('panel.quickPlaceholder'),
                              'aria-label': T('panel.quickPlaceholder'),
                              onChange: function (event) {
                                setQuickDraft(event.target.value);
                              },
                              onKeyDown: function (event) {
                                if (event.key !== 'Enter') return;
                                event.preventDefault();
                                const parts = quickDraft.trim().split(/[,，]/);
                                for (const part of parts) addSessionTag(row.id, part);
                                setQuickDraft('');
                              }
                            })
                          )
                        : null
                    );
                  }),
                  limited
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'stl_more',
                          onClick: function () {
                            setShowAllUntagged(true);
                          }
                        },
                        fill(T('panel.showAll'), { n: total })
                      )
                    : null
                )
          );
        };

        const searchingNow = query.trim() !== '';
        const hasRows =
          model !== null &&
          model.groups.some(function (group) {
            return group.rows.length > 0;
          });
        const body =
          model === null
            ? h('div', { className: 'stl_empty' }, T('panel.loading'))
            : searchingNow
              ? model.groups.length === 0
                ? h('div', { className: 'stl_empty' }, T('panel.empty'))
                : model.groups.map(renderGroup)
              : hasRows
                ? model.groups.map(renderGroup)
                : h('div', { className: 'stl_empty' }, T('panel.emptyIdle'));

        return h(
          'div',
          {
            className: 'stl_backdrop',
            onMouseDown: function (event) {
              if (event.target === event.currentTarget) closePanel();
            }
          },
          h(
            'div',
            {
              className: 'stl_dialog stl_dialogWide',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': T('panel.heading')
            },
            h(
              'div',
              { className: 'stl_dhead' },
              h(
                'div',
                { className: 'stl_dtitles' },
                h('div', { className: 'stl_dtitle', title: T('panel.guide') }, T('panel.heading'))
              ),
              h(
                'div',
                { className: 'stl_hoursWrap' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'stl_hours',
                    title: T('panel.hoursHint'),
                    'aria-haspopup': 'menu',
                    'aria-expanded': hoursOpen,
                    onClick: function () {
                      setHoursOpen(!hoursOpen);
                      setHoursDraft(String(recentHoursOf(app.data)));
                    }
                  },
                  fill(T('panel.hoursBtn'), { hours: String(recentHoursOf(app.data)) }) + ' ▾'
                ),
                hoursOpen
                  ? h(
                      'div',
                      { className: 'stl_hoursMenu', role: 'menu' },
                      RECENT_PRESETS.map(function (preset) {
                        const active = recentHoursOf(app.data) === preset;
                        return h(
                          'button',
                          {
                            key: preset,
                            type: 'button',
                            role: 'menuitemradio',
                            'aria-checked': active,
                            className: 'stl_hoursItem' + (active ? ' stl_hoursItemActive' : ''),
                            onClick: function () {
                              setRecentHours(preset);
                              setHoursOpen(false);
                            }
                          },
                          hoursLabel(preset)
                        );
                      }),
                      h('div', { className: 'stl_hoursSep' }),
                      h(
                        'div',
                        { className: 'stl_hoursCustom' },
                        h('input', {
                          className: 'stl_input',
                          type: 'number',
                          min: RECENT_MIN_HOURS,
                          max: RECENT_MAX_HOURS,
                          value: hoursDraft,
                          'aria-label': fill(T('panel.hoursCustom'), {
                            min: String(RECENT_MIN_HOURS),
                            max: String(RECENT_MAX_HOURS)
                          }),
                          onChange: function (event) {
                            setHoursDraft(event.target.value);
                          },
                          onKeyDown: function (event) {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            setRecentHours(hoursDraft);
                            setHoursOpen(false);
                          }
                        }),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'stl_hoursApply',
                            onClick: function () {
                              setRecentHours(hoursDraft);
                              setHoursOpen(false);
                            }
                          },
                          T('panel.hoursApply')
                        )
                      ),
                      h(
                        'div',
                        { className: 'stl_hoursTip' },
                        fill(T('panel.hoursUnitHint'), {
                          min: String(RECENT_MIN_HOURS),
                          max: String(RECENT_MAX_HOURS)
                        })
                      )
                    )
                  : null
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'stl_icon',
                  title: T('panel.close'),
                  'aria-label': T('panel.close'),
                  onClick: closePanel
                },
                '×'
              )
            ),
            h(
              'div',
              { className: 'stl_psearch' },
              h('input', {
                className: 'stl_input',
                value: query,
                autoFocus: true,
                placeholder: T('panel.search'),
                'aria-label': T('panel.search'),
                onChange: function (event) {
                  setQuery(event.target.value);
                }
              })
            ),
            h('div', { className: 'stl_dbody' }, body),
            h(
              'div',
              { className: 'stl_dfoot' },
              h(
                'button',
                { type: 'button', className: 'stl_textBtn', onClick: closePanel },
                T('panel.close')
              )
            )
          )
        );
      }

      /* ---------------------------- 顶部面板入口 ---------------------------- */

      /**
       * `sidebar.panellist` 的原生语义是「切换主面板」；这里在捕获阶段拦下行 click，
       * 打开浮层面板而不切换主面板（与 settings-button 同一套已验证的做法）。
       */
      function PanelEntry(props) {
        const ref = React.useRef(null);
        React.useEffect(function () {
          const node = ref.current;
          if (node === null || node === undefined) return undefined;
          const row = node.closest('button');
          if (row === null) return undefined;
          const onClick = function (event) {
            event.stopPropagation();
            event.preventDefault();
            openPanel(null);
          };
          row.setAttribute('aria-haspopup', 'dialog');
          row.addEventListener('click', onClick, true);
          return function () {
            row.removeEventListener('click', onClick, true);
            row.removeAttribute('aria-haspopup');
          };
        });
        return h('span', { ref: ref }, h(TagIcon, { size: props.size }));
      }

      /** 兜底：键盘或宿主内部路径仍把主面板切到本键位时，立刻回到对话并打开面板。 */
      function PanelRedirect() {
        React.useEffect(function () {
          if (layout !== null && typeof layout.selectPanel === 'function') layout.selectPanel(null);
          openPanel(null);
        }, []);
        return null;
      }

      /* ------------------------------------------------------------------ *
       * 样式：只用主题 token（颜色 + color-mix）
       * ------------------------------------------------------------------ */

      const CSS = [
        '.stl_action{display:inline-flex;align-items:center;gap:2px;height:20px;min-width:18px;padding:0 2px;border:0;background:0 0;border-radius:4px;cursor:pointer;color:var(--dsw-alias-label-secondary)}',
        '.stl_action:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stl_disk{display:block;border-radius:50%;flex:none;box-sizing:border-box;box-shadow:inset 0 0 0 1px rgba(0,0,0,.28)}',
        '.stl_diskEmpty{box-shadow:none;border:.5px solid var(--dsw-alias-label-tertiary)}',

        '.stl_mitem{display:flex;align-items:center;gap:8px;width:100%;padding:5px 10px;border:0;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-title-font-size,13px);text-align:left;cursor:pointer;border-radius:4px}',
        '.stl_mitem:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stl_miglyph{display:inline-flex;align-items:center;gap:2px;width:16px;flex:none}',
        '.stl_milabel{flex:1;white-space:nowrap}',

        '.stl_chips{display:flex;flex-wrap:wrap;align-items:center;gap:4px}',
        '.stl_chip{display:inline-flex;align-items:center;gap:4px;padding:1px 6px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer}',
        '.stl_chip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stl_chipDot{width:5px;height:5px;border-radius:50%;flex:none}',
        '.stl_chipEdit{border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;cursor:pointer;padding:1px 4px;border-radius:4px}',
        '.stl_chipEdit:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.stl_due{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none}',
        '.stl_dueLate{color:var(--dsw-alias-state-error-primary)}',

        '.stl_backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:10vh 16px 16px;background:rgba(0,0,0,.42);pointer-events:auto}',
        '.stl_dialog{display:flex;flex-direction:column;width:min(500px,94vw);max-height:74vh;background:var(--dsw-alias-bg-overlay);border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,.38);color:var(--dsw-alias-label-primary);font-size:var(--dsh-title-font-size,13px);overflow:hidden}',
        '.stl_dialogWide{width:min(760px,94vw);max-height:82vh}',
        '.stl_dhead{display:flex;align-items:flex-start;gap:10px;padding:12px 14px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}',
        '.stl_dtitles{flex:1;min-width:0}',
        '.stl_dtitle{font-weight:600;font-size:14px}',
        '.stl_dsub{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stl_icon{border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:4px;flex:none}',
        '.stl_icon:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.stl_hoursWrap{position:relative;flex:none}',
        '.stl_hours{border:.5px solid var(--dsw-alias-border-l1);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:3px 9px;border-radius:9px;cursor:pointer;white-space:nowrap}',
        '.stl_hours:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.stl_hoursMenu{position:absolute;right:0;top:calc(100% + 6px);z-index:6;display:flex;flex-direction:column;min-width:170px;padding:4px;background:var(--dsw-alias-bg-overlay);border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:0 10px 26px rgba(0,0,0,.34)}',
        '.stl_hoursItem{border:0;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;text-align:left;padding:5px 8px;border-radius:5px;cursor:pointer}',
        '.stl_hoursItem:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.stl_hoursItemActive{color:var(--dsw-alias-brand-primary);font-weight:600}',
        '.stl_hoursSep{height:1px;margin:4px 2px;background:var(--dsw-alias-border-l1)}',
        '.stl_hoursCustom{display:flex;align-items:center;gap:4px;padding:3px 4px 1px}',
        '.stl_hoursCustom .stl_input{width:64px;padding:3px 6px;font-size:11px}',
        '.stl_hoursApply{border:.5px solid var(--dsw-alias-border-l1);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:3px 8px;border-radius:5px;cursor:pointer}',
        '.stl_hoursApply:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stl_hoursTip{font-size:10px;color:var(--dsw-alias-label-tertiary);padding:2px 6px 4px}',
        '.stl_dbody{flex:1;overflow:auto;padding:10px 14px 12px}',
        '.stl_psearch{padding:10px 14px 0;flex:none}',
        '.stl_dfoot{display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:8px 12px;border-top:.5px solid var(--dsw-alias-border-l1);flex:none;flex-wrap:wrap}',

        '.stl_field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}',
        '.stl_flabel{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
        '.stl_pills{display:flex;flex-wrap:wrap;gap:5px;min-height:24px;align-items:center}',
        '.stl_pill{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:9px;border:1px solid transparent;font-size:11px;line-height:16px}',
        '.stl_pillSwatch{width:8px;height:8px;border-radius:50%;border:0;padding:0;flex:none;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.28)}',
        '.stl_pillSwatch:hover{outline:1px solid var(--dsw-alias-label-tertiary);outline-offset:1px}',
        '.stl_palette{display:flex;align-items:center;gap:6px;padding:2px 0 4px}',
        '.stl_paletteChip{width:16px;height:16px;border-radius:50%;border:1px solid transparent;padding:0;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.28)}',
        '.stl_paletteChip:hover{border-color:var(--dsw-alias-label-tertiary)}',
        '.stl_paletteChipActive{border-color:var(--dsw-alias-label-primary)}',
        '.stl_paletteHint{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-left:2px}',
        '.stl_pillX{border:0;background:0 0;color:inherit;cursor:pointer;font-size:12px;line-height:1;padding:0 1px;opacity:.75}',
        '.stl_pillX:hover{opacity:1}',
        '.stl_hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
        '.stl_input{border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:6px 9px;border-radius:var(--dsw-radius-sm,5px);min-width:0;width:100%;box-sizing:border-box;outline:none}',
        '.stl_input:focus{border-color:var(--dsw-alias-brand-primary)}',
        '.stl_pool{display:flex;flex-wrap:wrap;gap:5px}',
        '.stl_poolChip{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:9px;border:1px solid transparent;background:0 0;font:inherit;font-size:11px;line-height:17px;cursor:pointer}',
        '.stl_poolChip:hover{border-color:var(--dsw-alias-border-l2)}',
        '.stl_poolChipActive{font-weight:600}',
        '.stl_poolDot{width:5px;height:5px;border-radius:50%;flex:none}',
        '.stl_dueRow{display:flex;align-items:center;gap:8px}',
        '.stl_dueRow .stl_input{flex:1;width:auto}',
        '.stl_textBtn{border:.5px solid var(--dsw-alias-border-l1);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:4px 10px;border-radius:var(--dsw-radius-sm,5px);cursor:pointer;flex:none}',
        '.stl_textBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stl_primary{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:600;padding:5px 14px;border-radius:var(--dsw-radius-sm,5px);cursor:pointer}',
        '.stl_primary:hover{background:var(--dsw-alias-interactive-bg-hover)}',

        '.stl_empty{padding:24px 10px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}',
        '.stl_group{margin-bottom:2px}',
        '.stl_ghead{display:flex;align-items:center;gap:7px;width:100%;height:32px;padding:0 9px;margin-bottom:2px;border:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:600;cursor:pointer;border-radius:5px;text-align:left}',
        '.stl_ghead:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.stl_gchev{width:12px;flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px}',
        '.stl_gdot{width:7px;height:7px;border-radius:50%;flex:none}',
        '.stl_gdotEmpty{border:.5px solid var(--dsw-alias-label-tertiary)}',
        '.stl_gclock{display:inline-flex;align-items:center;justify-content:center;width:12px;flex:none;color:var(--dsw-alias-label-tertiary)}',
        '.stl_gname{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stl_gcount{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-weight:400;font-variant-numeric:tabular-nums}',
        '.stl_grows{display:flex;flex-direction:column;margin-left:13px;padding-left:9px;padding-bottom:2px;margin-bottom:2px;border-left:1px solid var(--dsw-alias-border-l1)}',
        '.stl_srow{position:relative;display:flex;align-items:center;gap:6px;width:100%;height:30px;padding:0 8px;border:0;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;border-radius:5px;text-align:left}',
        '.stl_srow:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.stl_srow:focus-visible{outline:1px solid var(--dsw-alias-border-l2);outline-offset:-1px}',
        '.stl_srowWrap{display:flex;flex-direction:column}',
        '.stl_rowAct{position:absolute;right:6px;top:50%;transform:translateY(-50%);opacity:0;width:20px;height:20px;border:0;border-radius:4px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font:inherit;font-size:15px;line-height:1;cursor:pointer;padding:0;z-index:1}',
        '.stl_srowWrap:hover .stl_rowAct,.stl_srowWrap:focus-within .stl_rowAct,.stl_rowAct:focus-visible{opacity:1}',
        '.stl_rowAct:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.stl_quick{display:flex;flex-direction:column;gap:6px;padding:6px 7px 8px;margin:2px 0 5px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1)}',
        '.stl_quickHead{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stl_quickPool{display:flex;flex-wrap:wrap;gap:4px}',
        '.stl_quickChip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:9px;border:1px solid transparent;background:0 0;font:inherit;font-size:11px;line-height:17px;cursor:pointer}',
        '.stl_quickChip:hover{border-color:var(--dsw-alias-border-l2)}',
        '.stl_quickChipActive{font-weight:600;background:var(--dsw-alias-interactive-bg-hover)}',
        '.stl_quickDot{width:5px;height:5px;border-radius:50%;flex:none}',
        '.stl_quickInput{padding:3px 7px;font-size:11px}',
        '.stl_more{display:block;width:100%;height:26px;padding:0 8px;border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;text-align:left;cursor:pointer;border-radius:5px}',
        '.stl_more:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.stl_stitle{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.stl_sbadge{display:inline-flex;align-items:center;gap:3px;padding:0 5px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;flex:none}',
        '.stl_sbadgeDot{width:5px;height:5px;border-radius:50%;flex:none}',
        '.stl_sdue{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none}',
        '.stl_stime{margin-left:auto;flex:none;padding-left:6px;font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}',
        '.stl_srowWrap:hover .stl_stime{opacity:0}',
        '.stl_sdueLate{color:var(--dsw-alias-state-error-primary)}',
        '.stl_run{width:7px;height:7px;border-radius:50%;border:1.5px solid var(--dsw-alias-state-success-primary);border-top-color:transparent;flex:none;animation:stl_spin 1s linear infinite}',
        '@keyframes stl_spin{to{transform:rotate(360deg)}}'
      ].join('\n');

      /* ------------------------------------------------------------------ *
       * 插件正文
       * ------------------------------------------------------------------ */

      const inject = ['slots', 'locale', 'uiWorkspace'];

      function apply(ctx) {
        ctx.effect(function () {
          if (typeof document === 'undefined') return function () {};
          if (document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') !== null) {
            return function () {};
          }
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/session-tag-lite';
          tag.dataset.pluginCss = CSS_ID;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return function () {
            tag.remove();
          };
        }, 'session-tag-lite: stylesheet');

        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        }, 'session-tag-lite: dictionaries');

        const t = ctx.locale.bind(NS);
        T = function (key) {
          const text = t(key);
          if (typeof text === 'string' && text !== key) return text;
          return zh[key] === undefined ? key : zh[key];
        };

        /* 宿主服务：读取都不激活 Session。 */
        const sessions = ctx.get('sessions');
        if (
          sessions !== undefined &&
          sessions !== null &&
          sessions.list !== undefined &&
          sessions.list !== null
        ) {
          sessionStore = sessions.list;
        }
        const workspaceApi = ctx.get('uiWorkspace');
        if (workspaceApi !== undefined && workspaceApi !== null) uiWorkspace = workspaceApi;
        const layoutApi = ctx.get('layout');
        if (layoutApi !== undefined && layoutApi !== null) layout = layoutApi;

        /* 远端持久化：有 Host 路由就以远端为准，没有就留在 localStorage 模式。 */
        pullRemote();

        /* 会话行座位。刻意不注册 sidebar.session.row.leading：
           那是宿主放「未读 / 待回答 / 运行中」状态点的位置，再塞一个标签色点
           会让用户把标签误读成状态。标签只出现在行尾按钮、悬停卡片、菜单与面板。 */

        ctx.slots.inject('sidebar.workspaces.session.row.action', function () {
          return ctx.slots.register(
            { name: 'sidebar.workspaces.session.row.action', id: 'session-tag-lite', order: 50, locale: NS },
            RowAction
          );
        });

        ctx.slots.inject('sidebar.workspaces.session.menu.item', function () {
          return ctx.slots.register(
            { name: 'sidebar.workspaces.session.menu.item', id: 'session-tag-lite', order: 350, locale: NS },
            MenuItem
          );
        });

        ctx.slots.inject('sidebar.session.row.hover', function () {
          return ctx.slots.register(
            { name: 'sidebar.session.row.hover', id: 'session-tag-lite', order: 20, locale: NS },
            HoverChips
          );
        });

        /* 浮层：编辑弹窗 + 标签总览面板。 */
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            { name: 'shell.overlay', id: 'session-tag-lite-editor', order: 60, locale: NS },
            Editor
          );
        });

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            { name: 'shell.overlay', id: 'session-tag-lite-panel', order: 61, locale: NS },
            Panel
          );
        });

        /* 顶部面板列表入口（原生语义是切换主面板，这里拦截为打开浮层）。 */
        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'session-tag-lite',
              order: 40,
              label: function () {
                return T('panel.title');
              },
              locale: NS
            },
            PanelEntry
          );
        });

        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: 'session-tag-lite', locale: NS }, PanelRedirect);
        });

        ctx.effect(function () {
          return function () {
            sessionStore = null;
            uiWorkspace = null;
            layout = null;
          };
        }, 'session-tag-lite: service handles');
      }

      return {
        inject: inject,
        apply: apply,
        __test: {
          STORAGE_KEY: STORAGE_KEY,
          RESERVED: RESERVED,
          HASH_COLORS: HASH_COLORS,
          UNTAGGED_KEY: UNTAGGED_KEY,
          UNTAGGED_PREVIEW: UNTAGGED_PREVIEW,
          RECENT_KEY: RECENT_KEY,
          RECENT_PRESETS: RECENT_PRESETS,
          DEFAULT_RECENT_HOURS: DEFAULT_RECENT_HOURS,
          RECENT_MIN_HOURS: RECENT_MIN_HOURS,
          RECENT_MAX_HOURS: RECENT_MAX_HOURS,
          normalizeData: normalizeData,
          loadData: loadData,
          colorOf: colorOf,
          formatDue: formatDue,
          relativeTime: relativeTime,
          relativeLabel: relativeLabel,
          fill: fill,
          tagsOf: tagsOf,
          dueOf: dueOf,
          orderedPool: orderedPool,
          isCollapsed: isCollapsed,
          recentHoursOf: recentHoursOf,
          setRecentHours: setRecentHours,
          hoursLabel: hoursLabel,
          pickAutoColor: pickAutoColor,
          setTagColor: setTagColor,
          addSessionTag: addSessionTag,
          removeSessionTag: removeSessionTag,
          toggleSessionTag: toggleSessionTag,
          setDue: setDue,
          toggleCollapsed: toggleCollapsed,
          buildPanelModel: buildPanelModel,
          getSnapshot: getSnapshot,
          getData: function () {
            return data;
          },
          subscribe: subscribe
        }
      };
    }
  });
})();
