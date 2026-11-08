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
 * 设置：通用设置里一行三选一（所有视图 / 仅单列表 / 关闭），默认仅单列表。
 *
 * 会话标识（v1.1）：副标题行右侧可以再挂一个小胶囊，显示用户给这条会话起的
 * 短代号（`rea` / `qiu` / `论文`…）。它只渲染，**不改会话标题**——手工在标题前
 * 加 `【rea】` 会把分类信息写进 title，污染搜索、导出与菜单文案；标识则是独立
 * 的一份 sessionId → 代号映射，可随时改、可清除、可跨浏览器。
 *
 * 标识的写入入口是会话「…」菜单（宿主开放的 sidebar.workspaces.session.menu.item），
 * 数据本地存 localStorage 镜像，并通过 Host 半区的同源路由落到
 * `$DSH_HOME/session-workspace-label/state.json`；路由缺失时静默退回单机模式。
 */
(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/session-workspace-label',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      /**
       * 浮层必须挂到 body：宿主 `shell.overlay` 位于 z-index 20 的 stacking context 内，
       * 而设置面板是 z-index 1000 的独立 portal——槽位里的 fixed 浮层再高也盖不住它。
       * 从设置页打开迁移浮层时会直接看不见，所以统一走 createPortal；拿不到 react-dom 时退回槽内。
       */
      let reactDom = null;
      try {
        reactDom = require('react-dom');
      } catch (error) {
        reactDom = null;
      }

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

      /** 把返回 null 表示「关闭」的浮层组件整体搬到 body。 */
      function withPortal(Component) {
        return function Portaled(props) {
          const inner = React.createElement(Component, props);
          return inner === null || inner === undefined ? null : portalToBody(inner);
        };
      }

      const NS = 'session-workspace-label';
      const STORE_KEY = 'session-workspace-label.mode';
      const STYLE_TAG_ID = '@local/session-workspace-label/rows.css';
      const ROW_ID = 'session-workspace-label';
      const PLUGIN_PACKAGE = '@local/session-workspace-label';

      /** 会话标识（sessionId → 短代号）：localStorage 只是镜像，Host 的 state.json 才是权威。 */
      const ALIAS_KEY = 'session-workspace-label.aliases.v1';
      const ALIAS_ROUTE = '/plugins/session-workspace-label/state';
      const ALIAS_GUARD = 'x-session-workspace-label';
      const ALIAS_MAX = 12;
      const TOKEN_MAX = 24;
      /** 代号配色：按名字哈希取环，和 session-tag-lite 共用一套色值。 */
      const ALIAS_COLORS = ['#8fb8e0', '#a3b89a', '#c49fd6', '#e0998a', '#7fc4bd', '#d6b88a', '#b4b3d4'];
      /** 状态类前缀更像标签而不是代号：迁移列表里默认不勾选，避免把「待办」当项目名。 */
      const STATUS_PREFIXES = ['待办', '完成', '进行中', '暂停', '归档', '存档', '草稿', 'todo', 'done', 'wip'];

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
        '.swl_text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
        '',
        '/* 会话标识：右侧胶囊。右缘落在 8px 内边距上，与标题行的时间列同一条基准线；',
        '   与工作区名之间的留白由 margin-left:auto 撑开，不靠整体缩进（缩进会让右缘参差）。 */',
        '.swl_alias {',
        '  flex: none;',
        '  margin-left: auto;',
        '  display: inline-flex;',
        '  align-items: center;',
        '  height: 14px;',
        '  padding: 0 6px;',
        '  border-radius: 999px;',
        '  font-size: 10.5px;',
        '  line-height: 14px;',
        '  letter-spacing: .02em;',
        '  max-width: 80px;',
        '  overflow: hidden;',
        '  text-overflow: ellipsis;',
        '  white-space: nowrap;',
        '  color: var(--swl-alias-color, var(--dsw-alias-label-secondary));',
        '  background: color-mix(in srgb, var(--swl-alias-color, #8f97a1) 16%, transparent);',
        '  box-shadow: inset 0 0 0 .5px color-mix(in srgb, var(--swl-alias-color, #8f97a1) 34%, transparent);',
        '  cursor: pointer;',
        '  pointer-events: auto;',
        '}',
        '/* 没有标识时：右端留一个「+」占位，行 hover 才浮出来，不干扰日常扫视。',
        '   「+」用伪元素画，避免进入无障碍名称（宿主 treeitem 会把子文本拼进可访问名）。 */',
        '.swl_alias[data-empty] { padding: 0; width: 16px; justify-content: center; opacity: 0; background: none; box-shadow: none; color: var(--dsw-alias-label-tertiary); pointer-events: none; }',
        '.swl_alias[data-empty]::after { content: "+"; font-size: 12px; line-height: 14px; }',
        'div[data-row-key^="session:"]:hover .swl_alias[data-empty] { opacity: .7; pointer-events: auto; }',
        '.swl_alias[data-empty]:hover { opacity: 1; color: var(--dsw-alias-label-secondary); }',
        '.swl_alias:hover { filter: brightness(1.12); }',
        '',
        '/* ---- 会话标识编辑浮层（swl_veil / swl_dialog） ---- */',
        '.swl_veil{position:fixed;inset:0;z-index:1200;display:flex;align-items:flex-start;justify-content:center;padding:18vh 16px 16px;background:rgba(0,0,0,.42);pointer-events:auto}',
        '.swl_dialog{display:flex;flex-direction:column;gap:12px;width:min(420px,94vw);padding:16px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#2c2c2e);box-shadow:0 16px 40px rgba(0,0,0,.38);color:var(--dsw-alias-label-primary)}',
        '/* ---- 会话「…」菜单项（swl_mitem*），与宿主菜单同构 ---- */',
        '.swl_mitem{display:flex;align-items:center;gap:8px;width:100%;padding:5px 10px;border:0;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-title-font-size,13px);text-align:left;cursor:pointer;border-radius:4px}',
        '.swl_mitem:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.swl_miglyph{display:inline-flex;align-items:center;width:16px;flex:none;opacity:.75}',
        '.swl_dtitle{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.swl_dhint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
        '.swl_input{height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,#232324);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}',
        '.swl_input:focus{border-color:var(--dsw-alias-border-l3)}',
        '.swl_tokens{display:flex;flex-wrap:wrap;gap:6px}',
        '.swl_token{height:22px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:20px;cursor:pointer}',
        '.swl_token:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.swl_dfoot{display:flex;align-items:center;justify-content:flex-end;gap:8px}',
        '.swl_btn{height:28px;padding:0 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}',
        '.swl_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.swl_btn.swl_primary{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:transparent}',
        '.swl_btn:disabled{opacity:.45;cursor:default}',
        '/* ---- 标题前缀迁移 ---- */',
        '.swl_dialogWide{width:min(620px,94vw);max-height:82vh}',
        '.swl_miglist{display:flex;flex-direction:column;gap:2px;max-height:46vh;overflow:auto;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:8px}',
        '.swl_migitem{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;cursor:pointer;font-size:12px}',
        '.swl_migitem:hover,.swl_migOn{background:var(--dsw-alias-interactive-bg-hover)}',
        '.swl_migprefix{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}',
        '.swl_migtitle{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
        '.swl_migtag{flex:none;font-size:10px;padding:0 5px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);line-height:14px}',
        '.swl_ok{color:var(--dsw-alias-label-secondary)}',
        '.swl_actions{display:flex;gap:8px}',
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
        'row.description': '在单列表模式的会话标题下方显示所属工作区（参考 agy 会话列表），右侧可挂一个会话标识；分组视图默认不显示，避免与组头重复',
        'mode.all': '所有视图',
        'mode.flat': '仅单列表',
        'mode.off': '关闭',
        'label.ungrouped': '未分组',
        'menu.label': '设置会话标识',
        'chip.empty': '设置会话标识',
        'chip.edit': '点击修改',
        'editor.title': '会话标识',
        'editor.hint': '给这条会话起一个短代号，显示在副标题行右侧；不会改动会话标题。留空保存即清除。',
        'editor.placeholder': '例如 rea / qiu / 论文',
        'editor.recent': '用过的',
        'editor.save': '保存',
        'editor.clear': '清除',
        'editor.cancel': '取消',
        'migrate.open': '迁移标题前缀…',
        'migrate.title': '标题前缀迁移',
        'migrate.hint': '把标题里的【xx】搬成右侧标识：标题去掉前缀，前缀写进标识。原标题备份在本地，可撤销。',
        'migrate.empty': '没有找到带【xx】前缀的会话标题。',
        'migrate.statusWord': '状态词',
        'migrate.hasAlias': '已有标识',
        'migrate.all': '全选',
        'migrate.none': '全不选',
        'migrate.run': '迁移 {n} 个',
        'migrate.undo': '撤销迁移（{n} 条）',
        'migrate.busy': '处理中…',
        'migrate.done': '完成：成功 {ok} 条，失败 {failed} 条。',
        'migrate.close': '关闭'
      };
      const en = {
        'row.title': 'Workspace subtitle on session rows',
        'row.badge': 'Plugin',
        'row.badgeTitle': 'Provided by plugin {package}',
        'row.description': 'Shows each session\'s Workspace under its title in the flat list (like the agy session list), with an optional session label on the right; grouped views hide it by default so the group header is not repeated',
        'mode.all': 'All views',
        'mode.flat': 'Flat list only',
        'mode.off': 'Off',
        'label.ungrouped': 'Ungrouped',
        'menu.label': 'Set session label',
        'chip.empty': 'Set session label',
        'chip.edit': 'Click to edit',
        'editor.title': 'Session label',
        'editor.hint': 'A short label shown on the right of the subtitle row. The session title is never changed. Save an empty value to clear it.',
        'editor.placeholder': 'e.g. rea / qiu / paper',
        'editor.recent': 'Recent',
        'editor.save': 'Save',
        'editor.clear': 'Clear',
        'editor.cancel': 'Cancel',
        'migrate.open': 'Migrate title prefixes…',
        'migrate.title': 'Migrate title prefixes',
        'migrate.hint': 'Move 【xx】 out of the title into the label chip. The original title is backed up locally and can be restored.',
        'migrate.empty': 'No session title starts with a 【xx】 prefix.',
        'migrate.statusWord': 'status word',
        'migrate.hasAlias': 'has label',
        'migrate.all': 'Select all',
        'migrate.none': 'Select none',
        'migrate.run': 'Migrate {n}',
        'migrate.undo': 'Undo migration ({n})',
        'migrate.busy': 'Working…',
        'migrate.done': 'Done: {ok} succeeded, {failed} failed.',
        'migrate.close': 'Close'
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

      /**
       * 规范化代号：去掉控制字符、包裹用的括号与多余空白，截断到 ALIAS_MAX。
       * 允许中文；返回空串表示「没有标识」。粘贴进来的 `【rea】` 会被洗成 `rea`。
       */
      function normalizeAlias(raw) {
        if (typeof raw !== 'string') return '';
        let text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
        text = text.replace(/^[\[【(（<《]+/, '').replace(/[\]】)）>》]+$/, '').trim();
        text = text.replace(/\s+/g, ' ');
        if (text.length > ALIAS_MAX) text = text.slice(0, ALIAS_MAX);
        return text;
      }

      /** 同一代号永远同一个颜色：FNV-1a 哈希取模色环。 */
      function aliasColor(name) {
        let hash = 0x811c9dc5;
        for (let i = 0; i < name.length; i += 1) {
          hash ^= name.charCodeAt(i);
          hash = Math.imul(hash, 0x01000193);
        }
        return ALIAS_COLORS[(hash >>> 0) % ALIAS_COLORS.length];
      }

      /**
       * 解析标题前缀：`【rea】分析记事本…` → `{ prefix:'rea', rest:'分析记事本…' }`。
       * 只认全角【】（半角 [] 在 Markdown / 代码标题里太常见，误伤率高）；没有正文的不迁移。
       */
      function parseTitlePrefix(title) {
        if (typeof title !== 'string') return null;
        const match = title.match(/^\s*【([^】]{1,24})】\s*/);
        if (match === null) return null;
        const prefix = normalizeAlias(match[1]);
        const rest = title.slice(match[0].length).trim();
        if (prefix === '' || rest === '') return null;
        return { prefix: prefix, rest: rest };
      }

      /** 本次迁移前的原标题备份条目；脏值丢弃。 */
      function normalizeLegacyEntry(entry) {
        if (entry === null || typeof entry !== 'object') return null;
        if (typeof entry.title !== 'string' || entry.title === '') return null;
        const at = Number(entry.at);
        return {
          title: entry.title,
          alias: normalizeAlias(entry.alias),
          at: Number.isFinite(at) ? at : 0
        };
      }

      /**
       * 本地 / 远端文档 → 干净的内存状态。脏值一律丢弃，不抛错：
       * 非对象别名、空代号、重复代号都不会进池；池上限 TOKEN_MAX。
       */
      function normalizeAliasDoc(doc) {
        const aliases = {};
        const tokens = [];
        const legacy = {};
        if (doc === null || typeof doc !== 'object') return { aliases: aliases, tokens: tokens, legacy: legacy };
        const rawAliases = doc.aliases !== null && typeof doc.aliases === 'object' ? doc.aliases : {};
        for (const id of Object.keys(rawAliases)) {
          const alias = normalizeAlias(rawAliases[id]);
          if (typeof id === 'string' && id !== '' && alias !== '') aliases[id] = alias;
        }
        const rawTokens = Array.isArray(doc.tokens) ? doc.tokens : [];
        for (const token of rawTokens) {
          const alias = normalizeAlias(token);
          if (alias !== '' && tokens.indexOf(alias) === -1 && tokens.length < TOKEN_MAX) tokens.push(alias);
        }
        /* 有别名却不在池里的（旧数据 / 手改文件）：补进池，保证候选里能点到。 */
        for (const id of Object.keys(aliases)) {
          const alias = aliases[id];
          if (tokens.indexOf(alias) === -1 && tokens.length < TOKEN_MAX) tokens.push(alias);
        }
        const rawLegacy = doc.legacy !== null && typeof doc.legacy === 'object' ? doc.legacy : {};
        for (const id of Object.keys(rawLegacy)) {
          const entry = normalizeLegacyEntry(rawLegacy[id]);
          if (typeof id === 'string' && id !== '' && entry !== null) legacy[id] = entry;
        }
        return { aliases: aliases, tokens: tokens, legacy: legacy };
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

      // ---- 会话标识：本地镜像 + Host 落盘 ---------------------------------

      /** 内存状态：aliasState.aliases[sessionId] = 代号；tokens 是候选池（最近使用在前）；
       *  legacy 是「标题前缀迁移」的撤销凭据（sessionId → 原标题）。 */
      let aliasState = { aliases: {}, tokens: [], legacy: {} };
      let aliasRemoteOn = false;
      let pushTimer = 0;

      function readAliasLocal() {
        try {
          const raw = window.localStorage.getItem(ALIAS_KEY);
          return raw === null
            ? { aliases: {}, tokens: [], legacy: {} }
            : normalizeAliasDoc(JSON.parse(raw));
        } catch (error) {
          return { aliases: {}, tokens: [], legacy: {} };
        }
      }

      function writeAliasLocal(doc) {
        try {
          window.localStorage.setItem(ALIAS_KEY, JSON.stringify(doc));
        } catch (error) {
          /* 存储不可用：本次会话内仍然生效 */
        }
      }

      function aliasDoc() {
        return { version: 1, aliases: aliasState.aliases, tokens: aliasState.tokens, legacy: aliasState.legacy };
      }

      function aliasOf(id) {
        return Object.prototype.hasOwnProperty.call(aliasState.aliases, id) ? aliasState.aliases[id] : '';
      }

      function rememberToken(alias) {
        const next = aliasState.tokens.filter(function (token) {
          return token !== alias;
        });
        next.unshift(alias);
        aliasState.tokens = next.slice(0, TOKEN_MAX);
      }

      /** 远端推送：300ms 防抖，整份覆盖（和 session-tag-lite 同一套语义）。 */
      function schedulePush() {
        if (!aliasRemoteOn) return;
        if (pushTimer !== 0) window.clearTimeout(pushTimer);
        pushTimer = window.setTimeout(function () {
          pushTimer = 0;
          void pushAlias();
        }, 300);
      }

      async function pushAlias() {
        try {
          const response = await window.fetch(ALIAS_ROUTE, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', [ALIAS_GUARD]: '1' },
            body: JSON.stringify({ data: aliasDoc() })
          });
          if (!response.ok) aliasRemoteOn = false;
        } catch (error) {
          aliasRemoteOn = false;
        }
      }

      /**
       * 启动拉取。本地优先：本地为空而远端有数据才恢复；本地有数据则反向推送，
       * 避免另一个浏览器的空状态把本机标识抹掉。路由不存在时静默停留在单机模式。
       */
      async function pullAlias() {
        if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
        try {
          const response = await window.fetch(ALIAS_ROUTE, { headers: { [ALIAS_GUARD]: '1' } });
          if (!response.ok) return;
          const payload = await response.json();
          if (payload === null || typeof payload !== 'object' || payload.ok !== true) return;
          aliasRemoteOn = true;
          const remote = normalizeAliasDoc(payload.data);
          const localHas = Object.keys(aliasState.aliases).length > 0 || aliasState.tokens.length > 0;
          const remoteHas = Object.keys(remote.aliases).length > 0 || remote.tokens.length > 0;
          if (!localHas && remoteHas) {
            aliasState = remote;
            writeAliasLocal(aliasDoc());
            scheduleSync(0);
          } else if (localHas) {
            void pushAlias();
          }
        } catch (error) {
          /* 路由缺失：保持 localStorage 单机模式 */
        }
      }

      /** 写一条标识；raw 为空串表示清除。 */
      function setAlias(id, raw) {
        if (typeof id !== 'string' || id === '') return;
        const alias = normalizeAlias(raw);
        if (alias === '') delete aliasState.aliases[id];
        else aliasState.aliases[id] = alias;
        if (alias !== '') rememberToken(alias);
        aliasState = normalizeAliasDoc(aliasDoc());
        writeAliasLocal(aliasDoc());
        schedulePush();
        aliasEditor.emit();
        scheduleSync(0);
      }

      // ---- 编辑浮层的极小 store -------------------------------------------

      const aliasEditor = {
        target: null,
        listeners: new Set(),
        open: function (sessionId, title) {
          this.target = { sessionId: sessionId, title: typeof title === 'string' ? title : '' };
          this.emit();
        },
        close: function () {
          this.target = null;
          this.emit();
        },
        emit: function () {
          for (const listener of Array.from(this.listeners)) listener();
        },
        subscribe: function (listener) {
          this.listeners.add(listener);
          return function () {
            aliasEditor.listeners.delete(listener);
          };
        }
      };

      // ---- 标题前缀迁移 ----------------------------------------------------

      /** 迁移浮层的开关；打开时由组件现扫一遍候选。 */
      const migrateDialog = {
        open: false,
        listeners: new Set(),
        show: function () {
          this.open = true;
          this.emit();
        },
        close: function () {
          this.open = false;
          this.emit();
        },
        emit: function () {
          for (const listener of Array.from(this.listeners)) listener();
        },
        subscribe: function (listener) {
          this.listeners.add(listener);
          return function () {
            migrateDialog.listeners.delete(listener);
          };
        }
      };

      /** 宿主 ctx，rename 要在组件之外调用。 */
      let appCtx = null;

      /** 错误对象 → 一行可读文本（rename 的失败原因要能显示给用户）。 */
      function messageOf(error) {
        if (error === null || error === undefined) return '';
        if (typeof error === 'string') return error;
        if (typeof error.message === 'string') return error.message;
        try {
          return JSON.stringify(error).slice(0, 160);
        } catch (fail) {
          return '';
        }
      }

      /**
       * 统一成 `{ok:true}` / `{ok:false,error}`。两条候选链路依次试：
       * ① `sessions.rename(id, title)`（SessionManager）② `remote.session.rename({sessionId,title})`。
       * 宿主版本不同，只有其中一条存在——和 session-title-edit 的兜底顺序一致。
       */
      async function renameSession(id, title) {
        if (appCtx === null) return { ok: false, error: { message: 'ctx unavailable' } };
        const runners = [];
        const sessions = appCtx.get('sessions');
        if (sessions !== null && sessions !== undefined && typeof sessions.rename === 'function') {
          runners.push(async function () {
            return await sessions.rename(id, title);
          });
        }
        let remote = null;
        try {
          remote = appCtx.get('remote.session');
        } catch (error) {
          remote = null;
        }
        if (remote !== null && remote !== undefined && typeof remote.rename === 'function') {
          runners.push(async function () {
            return await remote.rename({ sessionId: id, title: title });
          });
        }
        if (runners.length === 0) return { ok: false, error: { message: 'rename service unavailable' } };
        let lastError = null;
        for (const run of runners) {
          try {
            const result = await run();
            if (result !== null && typeof result === 'object' && result.ok === false) {
              lastError = result.error;
              continue;
            }
            return { ok: true };
          } catch (error) {
            lastError = error;
          }
        }
        return { ok: false, error: lastError === null ? { message: 'rename failed' } : lastError };
      }

      /** 会话快照里的标题：`displayTitle` 优先，退回 `title`。 */
      function titleOf(summary) {
        if (summary === null || typeof summary !== 'object') return '';
        if (typeof summary.displayTitle === 'string' && summary.displayTitle !== '') return summary.displayTitle;
        if (typeof summary.title === 'string') return summary.title;
        return '';
      }

      /** 前缀是否属于状态词（含「待办 electron」这种复合写法：只看第一个词）。 */
      function isStatusPrefix(prefix) {
        if (typeof prefix !== 'string' || prefix === '') return false;
        return STATUS_PREFIXES.indexOf(prefix.split(' ')[0].toLowerCase()) !== -1;
      }

      /** 扫出可迁移的会话：标题带【xx】、有正文。状态类前缀排在后面供人工确认。 */
      function buildMigrationCandidates() {
        const data = readData();
        const byId = data.byId === null ? {} : data.byId;
        const items = [];
        for (const id of Object.keys(byId)) {
          const title = titleOf(byId[id]);
          const parsed = parseTitlePrefix(title);
          if (parsed === null) continue;
          items.push({
            id: id,
            title: title,
            prefix: parsed.prefix,
            rest: parsed.rest,
            current: aliasOf(id),
            statusWord: isStatusPrefix(parsed.prefix)
          });
        }
        items.sort(function (a, b) {
          if (a.statusWord !== b.statusWord) return a.statusWord ? 1 : -1;
          return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
        });
        return items;
      }

      /** 执行迁移：逐条改名，成功后才写标识并记下原标题（可撤销）。 */
      async function runMigration(list) {
        let ok = 0;
        let failed = 0;
        let firstError = '';
        for (const item of list) {
          const result = await renameSession(item.id, item.rest);
          if (result.ok !== true) {
            failed += 1;
            if (firstError === '') firstError = messageOf(result.error);
            continue;
          }
          aliasState.aliases[item.id] = item.prefix;
          rememberToken(item.prefix);
          aliasState.legacy[item.id] = { title: item.title, alias: item.prefix, at: Date.now() };
          ok += 1;
        }
        aliasState = normalizeAliasDoc(aliasDoc());
        writeAliasLocal(aliasDoc());
        schedulePush();
        aliasEditor.emit();
        scheduleSync(0);
        return { ok: ok, failed: failed, error: firstError };
      }

      /** 撤销：按备份把标题改回去，并删掉对应的标识。 */
      async function undoMigration() {
        let ok = 0;
        let failed = 0;
        for (const id of Object.keys(aliasState.legacy)) {
          const entry = aliasState.legacy[id];
          const result = await renameSession(id, entry.title);
          if (result.ok !== true) {
            failed += 1;
            continue;
          }
          delete aliasState.aliases[id];
          delete aliasState.legacy[id];
          ok += 1;
        }
        aliasState = normalizeAliasDoc(aliasDoc());
        writeAliasLocal(aliasDoc());
        schedulePush();
        aliasEditor.emit();
        scheduleSync(0);
        return { ok: ok, failed: failed };
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

      function paintRow(row, label, alias) {
        let span = row.querySelector(':scope > span[' + LABEL_ATTR + ']');
        if (span === null) {
          span = document.createElement('span');
          span.setAttribute(LABEL_ATTR, '');
          span.className = 'swl_label';
          span.innerHTML = ICON + '<span class="swl_text"></span><span class="swl_alias"></span>';
          row.appendChild(span);
        }
        const text = span.querySelector('.swl_text');
        if (text !== null && text.textContent !== label) text.textContent = label;
        if (span.title !== label) span.title = label;
        /* 兼容热更新前的旧节点：缺 chip 就补一个。 */
        let chip = span.querySelector('.swl_alias');
        if (chip === null) {
          chip = document.createElement('span');
          chip.className = 'swl_alias';
          span.appendChild(chip);
        }
        if (alias === '') {
          if (chip.textContent !== '') chip.textContent = '';
          if (!chip.hasAttribute('data-empty')) chip.setAttribute('data-empty', '');
          const emptyHint = T('chip.empty');
          if (chip.title !== emptyHint) chip.title = emptyHint;
          if (chip.style.display !== '') chip.style.display = '';
        } else {
          if (chip.textContent !== alias) chip.textContent = alias;
          if (chip.hasAttribute('data-empty')) chip.removeAttribute('data-empty');
          const fullHint = alias + ' · ' + T('chip.edit');
          if (chip.title !== fullHint) chip.title = fullHint;
          chip.style.setProperty('--swl-alias-color', aliasColor(alias));
          if (chip.style.display !== '') chip.style.display = '';
        }
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
          const sessionId = key.slice(8);
          const label = labelFor(data.titles, data.byId, sessionId);
          if (label === '') stripRow(row);
          else paintRow(row, label, aliasOf(sessionId));
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
          ),
          h(
            'div',
            { className: 'swl_actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'swl_btn',
                onClick: function () {
                  migrateDialog.show();
                }
              },
              T('migrate.open')
            )
          )
        );
      }

      // ---- 会话标识：菜单项 + 编辑浮层 -------------------------------------

      /** 菜单项 glyph：一个胶囊 + 左侧圆点，暗示「标签」。 */
      function AliasGlyph() {
        return h(
          'svg',
          { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
          h('rect', { x: 2, y: 5, width: 12, height: 6, rx: 3, stroke: 'currentColor', strokeWidth: 1.2 }),
          h('circle', { cx: 5.2, cy: 8, r: 1, fill: 'currentColor' })
        );
      }

      function AliasMenuItem(props) {
        /* 宿主把 useMenuOpenState 投影进 hookContext；两种命名都兼容（同 session-tag-lite）。
           该条件在同一注册上固定不变，hook 调用顺序稳定。 */
        const menuHook =
          (typeof props.useMenuOpenState === 'function' && props.useMenuOpenState) ||
          (typeof props.menuOpenState === 'function' && props.menuOpenState) ||
          null;
        const pair = menuHook === null ? null : menuHook();
        return h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            className: 'swl_mitem',
            onClick: function () {
              if (pair !== null && typeof pair[1] === 'function') pair[1](false);
              aliasEditor.open(props.sessionId, props.displayTitle);
            }
          },
          h('span', { className: 'swl_miglyph' }, h(AliasGlyph)),
          h('span', { className: 'swl_milabel' }, T('menu.label'))
        );
      }

      function AliasEditor() {
        const [target, setTarget] = React.useState(aliasEditor.target);
        const [draft, setDraft] = React.useState('');
        const inputRef = React.useRef(null);
        const sessionId = target === null ? '' : target.sessionId;

        React.useEffect(function () {
          return aliasEditor.subscribe(function () {
            setTarget(aliasEditor.target);
          });
        }, []);

        React.useEffect(
          function () {
            if (sessionId === '') return undefined;
            setDraft(aliasOf(sessionId));
            const onKey = function (event) {
              if (event.key === 'Escape') aliasEditor.close();
            };
            window.addEventListener('keydown', onKey);
            return function () {
              window.removeEventListener('keydown', onKey);
            };
          },
          [sessionId]
        );

        React.useEffect(
          function () {
            if (sessionId !== '' && inputRef.current !== null) inputRef.current.focus();
          },
          [sessionId]
        );

        if (target === null) return null;

        const commit = function () {
          setAlias(sessionId, draft);
          aliasEditor.close();
        };
        const current = aliasOf(sessionId);

        return h(
          'div',
          {
            className: 'swl_veil',
            onMouseDown: function (event) {
              if (event.target === event.currentTarget) aliasEditor.close();
            }
          },
          h(
            'div',
            { className: 'swl_dialog', role: 'dialog', 'aria-label': T('editor.title') },
            h(
              'div',
              { className: 'swl_dtitle' },
              target.title !== '' ? target.title : sessionId.slice(0, 8)
            ),
            h('div', { className: 'swl_dhint' }, T('editor.hint')),
            h('input', {
              ref: inputRef,
              className: 'swl_input',
              value: draft,
              placeholder: T('editor.placeholder'),
              maxLength: ALIAS_MAX,
              onChange: function (event) {
                setDraft(event.target.value);
              },
              onKeyDown: function (event) {
                if (event.key === 'Enter') commit();
              }
            }),
            aliasState.tokens.length === 0
              ? null
              : h(
                  'div',
                  { className: 'swl_tokens' },
                  h('span', { className: 'swl_dhint', style: { width: '100%' } }, T('editor.recent')),
                  aliasState.tokens.map(function (token) {
                    return h(
                      'button',
                      {
                        key: token,
                        type: 'button',
                        className: 'swl_token',
                        onClick: function () {
                          setDraft(token);
                          if (inputRef.current !== null) inputRef.current.focus();
                        }
                      },
                      token
                    );
                  })
                ),
            h(
              'div',
              { className: 'swl_dfoot' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'swl_btn',
                  onClick: function () {
                    aliasEditor.close();
                  }
                },
                T('editor.cancel')
              ),
              current === ''
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'swl_btn',
                      onClick: function () {
                        setAlias(sessionId, '');
                        aliasEditor.close();
                      }
                    },
                    T('editor.clear')
                  ),
              h(
                'button',
                { type: 'button', className: 'swl_btn swl_primary', onClick: commit },
                T('editor.save')
              )
            )
          )
        );
      }

      function MigrateDialog() {
        const [open, setOpen] = React.useState(migrateDialog.open);
        const [items, setItems] = React.useState([]);
        const [picked, setPicked] = React.useState(function () {
          return new Set();
        });
        const [busy, setBusy] = React.useState(false);
        const [result, setResult] = React.useState(null);

        React.useEffect(function () {
          return migrateDialog.subscribe(function () {
            setOpen(migrateDialog.open);
          });
        }, []);

        React.useEffect(
          function () {
            if (!open) return;
            const list = buildMigrationCandidates();
            setItems(list);
            /* 默认只勾「项目类且还没有标识」的：状态类前缀交给人工确认。 */
            setPicked(
              new Set(
                list
                  .filter(function (item) {
                    return !item.statusWord && item.current === '';
                  })
                  .map(function (item) {
                    return item.id;
                  })
              )
            );
            setResult(null);
          },
          [open]
        );

        if (!open) return null;

        const toggle = function (id) {
          const next = new Set(picked);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          setPicked(next);
        };
        const run = async function () {
          setBusy(true);
          const summary = await runMigration(
            items.filter(function (item) {
              return picked.has(item.id);
            })
          );
          setBusy(false);
          setResult(summary);
          setItems([]);
          setPicked(new Set());
        };
        const undo = async function () {
          setBusy(true);
          const summary = await undoMigration();
          setBusy(false);
          setResult(summary);
          setItems([]);
        };
        const legacyCount = Object.keys(aliasState.legacy).length;
        const showList = result === null;

        return h(
          'div',
          {
            className: 'swl_veil',
            onMouseDown: function (event) {
              if (event.target === event.currentTarget) migrateDialog.close();
            }
          },
          h(
            'div',
            { className: 'swl_dialog swl_dialogWide', role: 'dialog', 'aria-label': T('migrate.title') },
            h('div', { className: 'swl_dtitle' }, T('migrate.title')),
            h('div', { className: 'swl_dhint' }, T('migrate.hint')),
            result === null
              ? null
              : h(
                  'div',
                  { className: 'swl_dhint swl_ok' },
                  T('migrate.done', { ok: result.ok, failed: result.failed }),
                  result.error ? '（' + result.error + '）' : ''
                ),
            !showList
              ? null
              : items.length === 0
                ? h('div', { className: 'swl_dhint' }, T('migrate.empty'))
                : h(
                    'div',
                    { className: 'swl_miglist' },
                    items.map(function (item) {
                      const on = picked.has(item.id);
                      return h(
                        'label',
                        { key: item.id, className: 'swl_migitem' + (on ? ' swl_migOn' : '') },
                        h('input', {
                          type: 'checkbox',
                          checked: on,
                          onChange: function () {
                            toggle(item.id);
                          }
                        }),
                        h('span', { className: 'swl_migprefix' }, '【' + item.prefix + '】'),
                        h('span', { className: 'swl_migtitle' }, item.rest),
                        item.statusWord ? h('span', { className: 'swl_migtag' }, T('migrate.statusWord')) : null,
                        item.current !== '' ? h('span', { className: 'swl_migtag' }, T('migrate.hasAlias')) : null
                      );
                    })
                  ),
            h(
              'div',
              { className: 'swl_dfoot' },
              !showList || items.length === 0
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'swl_btn',
                      disabled: busy,
                      onClick: function () {
                        setPicked(
                          new Set(
                            items.map(function (item) {
                              return item.id;
                            })
                          )
                        );
                      }
                    },
                    T('migrate.all')
                  ),
              !showList || items.length === 0
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'swl_btn',
                      disabled: busy,
                      onClick: function () {
                        setPicked(new Set());
                      }
                    },
                    T('migrate.none')
                  ),
              legacyCount === 0
                ? null
                : h(
                    'button',
                    { type: 'button', className: 'swl_btn', disabled: busy, onClick: undo },
                    T('migrate.undo', { n: legacyCount })
                  ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'swl_btn',
                  onClick: function () {
                    migrateDialog.close();
                  }
                },
                T('migrate.close')
              ),
              !showList || items.length === 0
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'swl_btn swl_primary',
                      disabled: busy || picked.size === 0,
                      onClick: run
                    },
                    busy ? T('migrate.busy') : T('migrate.run', { n: picked.size })
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

      /** 点副标题右端的胶囊 / 「+」就能编辑；捕获阶段拦下，免得顺带把会话选中。 */
      function mountChipClick() {
        if (typeof document === 'undefined') return function () {};
        const onClick = function (event) {
          const target = event.target;
          if (target === null || target === undefined || typeof target.closest !== 'function') return;
          const chip = target.closest('span.swl_alias');
          if (chip === null) return;
          const row = chip.closest('div[data-row-key^="session:"]');
          if (row === null) return;
          const key = row.getAttribute('data-row-key');
          if (typeof key !== 'string' || key.length <= 8) return;
          const titleEl = row.querySelector(':scope > span[class$="_title"]');
          event.preventDefault();
          event.stopPropagation();
          aliasEditor.open(key.slice(8), titleEl === null ? '' : titleEl.textContent.trim());
        };
        document.addEventListener('click', onClick, true);
        return function () {
          document.removeEventListener('click', onClick, true);
        };
      }

      const inject = ['slots', 'locale', 'sessions', 'workspaces'];

      function apply(ctx) {
        ctx.effect(mountStyles, 'session-workspace-label: stylesheet');
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        }, 'session-workspace-label: dictionaries');

        T = ctx.locale.bind(NS);
        appCtx = ctx;
        activeMode = readMode();
        aliasState = readAliasLocal();
        resolveStores(ctx);
        void pullAlias();

        ctx.effect(subscribeStores, 'session-workspace-label: store subscriptions');
        ctx.effect(mountObserver, 'session-workspace-label: row observer');
        ctx.effect(mountChipClick, 'session-workspace-label: chip click');

        ctx.slots.inject('sidebar.workspaces.session.menu.item', function () {
          return ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: ROW_ID + '-alias',
              order: 340,
              locale: NS
            },
            AliasMenuItem
          );
        });

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            {
              name: 'shell.overlay',
              id: ROW_ID + '-editor',
              order: 60,
              locale: NS
            },
            withPortal(AliasEditor)
          );
        });

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            {
              name: 'shell.overlay',
              id: ROW_ID + '-migrate',
              order: 61,
              locale: NS
            },
            withPortal(MigrateDialog)
          );
        });

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
          labelFor: labelFor,
          ALIAS_KEY: ALIAS_KEY,
          ALIAS_MAX: ALIAS_MAX,
          TOKEN_MAX: TOKEN_MAX,
          ALIAS_COLORS: ALIAS_COLORS,
          normalizeAlias: normalizeAlias,
          aliasColor: aliasColor,
          normalizeAliasDoc: normalizeAliasDoc,
          parseTitlePrefix: parseTitlePrefix,
          normalizeLegacyEntry: normalizeLegacyEntry,
          isStatusPrefix: isStatusPrefix,
          STATUS_PREFIXES: STATUS_PREFIXES
        }
      };
    }
  });
})();
