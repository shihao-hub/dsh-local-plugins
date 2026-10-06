(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/skills-panel',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      const PANEL_ID = 'skills-panel';
      const CSS_TAG_ID = 'skills-panel-styles';
      const NS = 'skills-panel';
      const PREFS_STORAGE_KEY = 'skills-panel.collapsed';
      const VIEW_STORAGE_KEY = 'skills-panel.view';
      const VIEW_DEFAULT = 'default'; // 用户安装 + 系统内置
      const VIEW_ALL = 'all'; // 默认来源 + 当前工作区

      function readView() {
        try {
          const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
          return raw === VIEW_ALL ? VIEW_ALL : VIEW_DEFAULT;
        } catch {
          return VIEW_DEFAULT;
        }
      }

      function writeView(view) {
        try {
          window.localStorage.setItem(VIEW_STORAGE_KEY, view);
        } catch {
          /* Storage unavailable */
        }
      }

      // In-memory fallback catalog for resilient display across sessions
      const globalSkillsCache = new Map();

      const DISPLAY_ALIASES = {
        'agy': 'Antigravity',
        'cc': 'Claude Code',
        'sh': 'SH',
        'doc': 'Doc',
        'im': 'IM',
        'vc': 'Video Conf',
        'okr': 'OKR',
        'pwsh7': 'PowerShell 7',
        'uwp': 'UWP',
        'sql': 'SQL',
        'tdd': 'TDD',
        'zed': 'Zed'
      };

      const CSS = [
        '.skp_root{display:flex;flex-direction:column;height:100%;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-base,sans-serif);background:var(--dsw-alias-surface-primary);box-sizing:border-box}',
        '.skp_header{display:flex;align-items:center;gap:8px;padding:12px 14px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}',
        '.skp_title{margin:0;font-size:var(--dsh-title-font-size,13px);font-weight:600;letter-spacing:-.01em}',
        '.skp_count{color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}',
        '.skp_spacer{flex:1}',
        '.skp_refresh{border:0;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:4px;border-radius:var(--dsw-radius-sm);line-height:1;display:inline-flex;align-items:center;justify-content:center}',
        '.skp_refresh:hover{background:var(--dsw-alias-surface-secondary);color:var(--dsw-alias-label-primary)}',
        '.skp_refresh:disabled{opacity:.4;cursor:default}',
        '.skp_viewBtn{font-size:11px;font-weight:600;padding:3px 8px;gap:4px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
        '.skp_viewBtn[aria-pressed="true"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
        '.skp_tools{padding:8px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}',
        '.skp_search{display:flex;align-items:center;gap:6px;background:var(--dsw-alias-surface-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);padding:4px 8px}',
        '.skp_search:focus-within{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}',
        '.skp_searchIcon{color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;flex:none}',
        '.skp_searchInput{border:0;background:0 0;color:var(--dsw-alias-label-primary);font-size:12px;outline:0;width:100%;min-width:0}',
        '.skp_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}',
        '.skp_searchKey{color:var(--dsw-alias-label-caption);font-size:10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:2px;padding:0 3px;flex:none}',
        '.skp_body{flex:1;overflow-y:auto;overflow-x:hidden;padding:6px 0 16px}',
        '.skp_group{margin-bottom:2px}',
        '.skp_groupHead{width:100%;border:0;background:0 0;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer;padding:5px 12px;text-align:left;box-sizing:border-box}',
        '.skp_groupHead:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-surface-secondary)}',
        '.skp_groupHead:hover .skp_groupRule{background:var(--dsw-alias-border-l1)}',
        '.skp_groupHeadL1{padding:7px 12px 6px;margin-top:4px}',
        '.skp_groupLabel{flex:none}',
        '.skp_groupLabelL1{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:700}',
        '.skp_groupHint{color:var(--dsw-alias-label-caption);font-weight:400;font-size:10.5px;flex:none}',
        '.skp_groupRule{flex:1;height:.5px;background:var(--dsw-alias-border-l2);min-width:8px}',
        '.skp_groupCount{color:var(--dsw-alias-label-caption);font-weight:500;font-size:10.5px;font-variant-numeric:tabular-nums;flex:none}',
        '.skp_chev{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}',
        '.skp_chev[data-collapsed="true"]{transform:rotate(-90deg)}',
        '.skp_list{list-style:none;margin:0;padding:0}',
        '.skp_row{border-bottom:.5px solid var(--dsw-alias-border-l2)}',
        '.skp_row:last-child{border-bottom:0}',
        '.skp_summary{display:flex;align-items:center;gap:6px;padding:6px 12px;cursor:pointer;user-select:none;list-style:none;font-size:12px;box-sizing:border-box}',
        '.skp_summary::-webkit-details-marker{display:none}',
        '.skp_summary:hover{background:var(--dsw-alias-surface-secondary)}',
        '.skp_name{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;font-weight:600;flex:none}',
        '.skp_tag{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);padding:0 5px;font-size:10.5px;line-height:15px;flex:none}',
        '.skp_desc{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.skp_detail{flex-direction:column;gap:6px;padding:8px 12px 10px;display:flex;box-sizing:border-box;background:var(--dsw-alias-surface-secondary);border-top:.5px solid var(--dsw-alias-border-l2)}',
        '.skp_detailText{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:1.6}',
        '.skp_when{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.6}',
        '.skp_whenLabel{color:var(--dsw-alias-label-caption);margin-right:6px;font-size:10.5px}',
        '.skp_path{color:var(--dsw-alias-label-caption);margin:0;font-size:11px;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
        '.skp_actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px}',
        '.skp_actionBtn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-surface-primary);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-sm,4px);padding:3px 8px;font-size:11.5px;cursor:pointer;line-height:1.4;transition:all .15s ease}',
        '.skp_actionBtn:hover{background:var(--dsw-alias-surface-tertiary);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-brand-primary)}',
        '.skp_actionView{color:var(--dsw-alias-brand-primary);font-weight:500}',
        '.skp_hint{color:var(--dsw-alias-label-tertiary);padding:18px 14px;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.6}',
        '.skp_hintAction{align-self:flex-start;border:0;background:0 0;color:var(--dsw-alias-brand-primary);cursor:pointer;padding:4px 0;font-size:var(--dsh-content-font-size-secondary,13px)}',
        '.skp_hintAction:hover{text-decoration:underline}',
        '.skp_error{color:var(--dsw-alias-state-error-primary)}',
        '.skp_errorDetail{color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:12px;display:block;word-break:break-word}',
        '.skp_visuallyHidden{clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}'
      ].join('');

      /** Simplified Chinese dictionary; the key-set source of truth. */
      const zh = {
        'panel': '\u6280\u80fd',
        'title': '\u6280\u80fd',
        'refresh': '\u5237\u65b0\u6280\u80fd\u5217\u8868',
        'search': '\u641c\u7d22\u6280\u80fd',
        'searchPlaceholder': '\u641c\u7d22\u6280\u80fd\u540d\u6216\u63cf\u8ff0\u2026',
        'searchShortcut': '/',
        'loading': '\u6b63\u5728\u52a0\u8f7d\u6280\u80fd\u2026',
        'empty': '\u5f53\u524d\u6ca1\u6709\u53ef\u7528\u6280\u80fd\u3002',
        'noSession': '\u672a\u8fdb\u5165\u4f1a\u8bdd\uff08\u5c55\u793a\u5df2\u53d1\u73b0\u7684\u5168\u5c40\u6280\u80fd\uff09',
        'failed': '\u6280\u80fd\u5217\u8868\u52a0\u8f7d\u5931\u8d25',
        'userOnly': '\u4ec5\u7528\u6237',
        'whenToUse': '\u4f7f\u7528\u65f6\u673a',
        'openFile': '\u67e5\u770b SKILL.md',
        'openDir': '\u6253\u5f00\u76ee\u5f55',
        'revealDir': '\u5b9a\u4f4d\u76ee\u5f55',
        'openFileDesc': '\u5728\u53f3\u4fa7\u9884\u89c8 SKILL.md',
        'openDirDesc': '\u5728\u7cfb\u7edf\u7f16\u8f91\u5668/\u6587\u4ef6\u5939\u4e2d\u6253\u5f00\u6b64\u6280\u80fd\u76ee\u5f55',
        'revealDirDesc': '\u5728\u6587\u4ef6\u8d44\u6e90\u7ba1\u7406\u5668\u4e2d\u9ad8\u4eae\u5b9a\u4f4d',
        'noResult': '\u6ca1\u6709\u5339\u914d\u7684\u6280\u80fd',
        'browseAll': '\u6e05\u7a7a\u641c\u7d22\uff0c\u6d4f\u89c8\u5168\u90e8\u6280\u80fd',
        'matchedCount': '\u5339\u914d',
        'groupOther': '\u5176\u4ed6',
        'sourceBuiltin': '\u7cfb\u7edf\u5185\u7f6e',
        'sourceUser': '\u7528\u6237\u5b89\u88c5',
        'sourceWorkspace': '\u5f53\u524d\u5de5\u4f5c\u533a',
        'builtinHint': '\u5185\u7f6e',
        'workspaceHint': '\u5de5\u4f5c\u533a',
        'viewDefaultLabel': '\u9ed8\u8ba4',
        'viewAllLabel': '\u5168\u90e8',
        'viewToAll': '\u5207\u6362\u5230\u5168\u90e8\u6280\u80fd\uff08\u542b\u5f53\u524d\u5de5\u4f5c\u533a\uff09',
        'viewToDefault': '\u5207\u6362\u5230\u9ed8\u8ba4\u89c6\u56fe\uff08\u4ec5\u7528\u6237\u5b89\u88c5\u4e0e\u7cfb\u7edf\u5185\u7f6e\uff09'
      };

      /** English dictionary, checked complete against the zh key set. */
      const en = {
        'panel': 'Skills',
        'title': 'Skills',
        'refresh': 'Refresh skills',
        'search': 'Search skills',
        'searchPlaceholder': 'Search skill name or description\u2026',
        'searchShortcut': '/',
        'loading': 'Loading skills\u2026',
        'empty': 'No skills available.',
        'noSession': 'No session active (showing discovered global skills)',
        'failed': 'Could not load the skill list',
        'userOnly': 'User only',
        'whenToUse': 'When to use',
        'openFile': 'View SKILL.md',
        'openDir': 'Open Folder',
        'revealDir': 'Reveal',
        'openFileDesc': 'Preview SKILL.md in right sidebar',
        'openDirDesc': 'Open skill folder in local editor',
        'revealDirDesc': 'Reveal skill folder in file manager',
        'noResult': 'No matching skills',
        'browseAll': 'Clear the search and browse all skills',
        'matchedCount': 'matched',
        'groupOther': 'Other',
        'sourceBuiltin': 'Built in',
        'sourceUser': 'Installed',
        'sourceWorkspace': 'Workspace',
        'builtinHint': 'read-only',
        'workspaceHint': 'this workspace',
        'viewDefaultLabel': 'Default',
        'viewAllLabel': 'All',
        'viewToAll': 'Switch to all skills (including this workspace)',
        'viewToDefault': 'Switch to default view (installed and built in only)'
      };

      //#region dsh-resource file addresses
      const FILE_ADDRESS_PREFIX = 'dsh-resource://file/';

      function encodeSegment(segment) {
        return encodeURIComponent(segment).replace(/%3A/gi, ':');
      }

      function encodePath(path) {
        return path.split('/').map(encodeSegment).join('/');
      }

      function isAbsoluteWorkspacePath(target) {
        if (typeof target !== 'string' || target.length === 0) return false;
        if (target.startsWith('/') || target.startsWith('\\')) return true;
        return /^[a-zA-Z]:[/\\]/.test(target);
      }

      function sessionFileAddress(sessionId, path) {
        const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
        return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
      }

      function fileAddressFor(sessionId, cwd, path) {
        const normalized = (path ?? '').replace(/\\/g, '/');
        if (normalized === '') return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId ?? 'main')}/`;
        if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId ?? 'main', normalized);
        const root = cwd === undefined ? '' : cwd.replace(/\\/g, '/').replace(/\/+$/, '');
        if (root !== '' && normalized === root) return sessionFileAddress(sessionId ?? 'main', '');
        if (root !== '' && normalized.startsWith(`${root}/`)) {
          return sessionFileAddress(sessionId ?? 'main', normalized.slice(root.length + 1));
        }
        return sessionFileAddress(sessionId ?? 'main', normalized);
      }

      function getSkillDir(skillPath) {
        if (typeof skillPath !== 'string' || skillPath.length === 0) return '';
        const norm = normPath(skillPath);
        if (norm.endsWith('/SKILL.md')) {
          return norm.slice(0, -'/SKILL.md'.length);
        }
        if (norm.endsWith('.md')) {
          const cut = norm.lastIndexOf('/');
          return cut !== -1 ? norm.slice(0, cut) : norm;
        }
        return norm;
      }
      //#endregion

      //#region source recovery from path
      const ROOT_PROJECT_DSH = 'projectDsh';
      const ROOT_PROJECT_AGENTS = 'projectAgents';
      const ROOT_CUSTOM = 'custom';
      const ROOT_USER_DSH = 'userDsh';
      const ROOT_USER_AGENTS = 'userAgents';
      const ROOT_BUNDLED = 'bundled';

      const SOURCE_OF_ROOT = {
        [ROOT_PROJECT_DSH]: 'workspace',
        [ROOT_PROJECT_AGENTS]: 'workspace',
        [ROOT_CUSTOM]: 'user',
        [ROOT_USER_DSH]: 'user',
        [ROOT_USER_AGENTS]: 'user',
        [ROOT_BUNDLED]: 'builtin'
      };

      function isBundledPath(norm) {
        return (
          norm.includes('/resources/runtime/office-skills/') ||
          norm.includes('/resources/runtime/builtin-skills/') ||
          norm.includes('/app.asar/resources/runtime/') ||
          norm.includes('/runtime/office-skills/') ||
          norm.includes('/runtime/builtin-skills/')
        );
      }

      function normPath(p) {
        if (typeof p !== 'string') return '';
        return p.replace(/\\/g, '/');
      }

      function findHomeFromSkills(skills) {
        for (const skill of skills) {
          const norm = normPath(skill.path);
          const match = norm.match(/^(?:[a-zA-Z]:)?\/users\/[^/]+/i);
          if (match !== null) return match[0];
        }
        return undefined;
      }

      function isHomeLikePath(path) {
        if (typeof path !== 'string') return false;
        const norm = normPath(path).toLowerCase();
        // Check if path is root of a user home directory (e.g. C:/Users/29580 or /home/ubuntu)
        return /^(?:[a-zA-Z]:)?\/users\/[^/]+$/i.test(norm) || /^\/home\/[^/]+$/i.test(norm);
      }

      function skillRootsFor(skills, cwd) {
        const home = findHomeFromSkills(skills);
        const roots = [];
        const add = (id, path, priority) => {
          if (typeof path === 'string' && path.length > 0) {
            roots.push({ id, path: normPath(path), priority });
          }
        };

        // Only register workspace root if cwd is NOT the bare user home directory
        const isCwdHome = typeof cwd === 'string' && isHomeLikePath(cwd);
        if (typeof cwd === 'string' && cwd.length > 0 && !isCwdHome) {
          add(ROOT_PROJECT_DSH, cwd + '/.dsh/skills', 100);
          add(ROOT_PROJECT_AGENTS, cwd + '/.agents/skills', 200);
        }
        if (home !== undefined) {
          add(ROOT_USER_DSH, home + '/.dsh/skills', 400);
          add(ROOT_USER_AGENTS, home + '/.agents/skills', 500);
        }
        for (const skill of skills) {
          const norm = normPath(skill.path);
          if (norm !== '' && isBundledPath(norm)) {
            const cut = norm.indexOf('/resources/runtime/');
            if (cut !== -1) {
              add(ROOT_BUNDLED, norm.slice(0, cut + '/resources/runtime/'.length), 600);
              break;
            }
          }
        }
        roots.sort((a, b) => a.priority - b.priority);
        return roots;
      }

      function rootOf(path, roots) {
        const norm = normPath(path);
        if (norm === '') return undefined;
        const lower = norm.toLowerCase();
        for (const root of roots) {
          const rootLower = root.path.toLowerCase();
          if (lower.startsWith(rootLower + '/') || lower === rootLower) {
            return root;
          }
        }
        return undefined;
      }

      function sourceOf(path, roots) {
        if (typeof path !== 'string' || path === '') return 'builtin';
        const norm = normPath(path);
        if (isBundledPath(norm)) return 'builtin';

        // Direct user-agents match: regardless of root table precedence,
        // ~/.agents/skills or ~/.dsh/skills is globally installed user skill.
        const lower = norm.toLowerCase();
        if (lower.includes('/.agents/skills/') || lower.includes('/.dsh/skills/')) {
          const root = rootOf(path, roots);
          if (root !== undefined) {
            return SOURCE_OF_ROOT[root.id] ?? 'user';
          }
          return 'user';
        }

        const root = rootOf(path, roots);
        if (root !== undefined) return SOURCE_OF_ROOT[root.id] ?? 'user';
        return 'user';
      }
      //#endregion

      //#region segment tree algorithm
      function segmentLabel(seg) {
        const lower = seg.toLowerCase();
        const known = DISPLAY_ALIASES[lower];
        return known ?? (seg.charAt(0).toUpperCase() + seg.slice(1));
      }

      function buildSegmentTree(skills, depth = 0, pathPrefix = '') {
        const buckets = new Map();
        const directLeaves = [];

        for (const skill of skills) {
          const parts = skill.name.split('-');
          if (parts.length <= depth + 1) {
            directLeaves.push(skill);
          } else {
            const seg = parts[depth];
            if (!buckets.has(seg)) buckets.set(seg, []);
            buckets.get(seg).push(skill);
          }
        }

        const children = [];
        const sortedKeys = [...buckets.keys()].sort((a, b) => a.localeCompare(b));

        for (const seg of sortedKeys) {
          const groupSkills = buckets.get(seg);
          const nextPrefix = pathPrefix ? `${pathPrefix}/${seg}` : seg;
          const sub = buildSegmentTree(groupSkills, depth + 1, nextPrefix);

          children.push({
            id: nextPrefix,
            label: segmentLabel(seg),
            children: sub.children,
            skills: sub.remainder
          });
        }

        return {
          children,
          remainder: directLeaves.sort((a, b) => a.name.localeCompare(b.name))
        };
      }

      function altsFor(remainder, t, source) {
        if (remainder.length === 0) return undefined;
        return {
          id: `${source}/_other`,
          label: t('groupOther'),
          children: [],
          skills: remainder
        };
      }

      function groupedSkills(skills, cwd, t) {
        const roots = skillRootsFor(skills, cwd);
        const bySource = new Map();
        for (const skill of skills) {
          const source = sourceOf(skill.path, roots);
          if (!bySource.has(source)) bySource.set(source, []);
          bySource.get(source).push(skill);
        }
        const present = ['workspace', 'user', 'builtin'].filter((source) => bySource.has(source));

        return present.map((source) => {
          const members = bySource.get(source);
          const { children, remainder } = buildSegmentTree(members, 0, source);
          const alts = altsFor(remainder, t, source);
          const rootPath = roots.find((root) => SOURCE_OF_ROOT[root.id] === source)?.path;
          return {
            id: source,
            label: t('source' + source.charAt(0).toUpperCase() + source.slice(1)),
            path: rootPath,
            children: alts === undefined ? children : [...children, alts],
            skills: []
          };
        });
      }

      function countSkills(node) {
        return (
          node.skills.length + node.children.reduce((sum, child) => sum + countSkills(child), 0)
        );
      }

      function filterSkills(skills, query) {
        const needle = query.trim().toLowerCase();
        if (needle === '') return skills;
        return skills.filter((skill) =>
          [skill.name, skill.description, skill.whenToUse]
            .filter((value) => typeof value === 'string')
            .some((value) => value.toLowerCase().includes(needle))
        );
      }

      function readCollapsed() {
        try {
          const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
          if (raw === null) return new Set();
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return new Set(parsed.filter((id) => typeof id === 'string'));
          return new Set();
        } catch {
          return new Set();
        }
      }

      function writeCollapsed(collapsedSet) {
        try {
          window.localStorage.setItem(
            PREFS_STORAGE_KEY,
            JSON.stringify([...collapsedSet])
          );
        } catch {
          /* Storage unavailable */
        }
      }
      //#endregion

      /** Sidebar icon glyph. */
      function SkillsGlyph(props) {
        const size = typeof props.size === 'number' ? props.size : 18;
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 16 16',
            fill: 'none',
            focusable: 'false',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('path', {
            d: 'M6.2 1.9l1.15 3.1 3.1 1.15-3.1 1.15L6.2 10.4 5.05 7.3 1.95 6.15 5.05 5z',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinejoin: 'round'
          }),
          h('path', {
            d: 'M11.7 8.7l.58 1.55 1.55.58-1.55.58-.58 1.55-.58-1.55-1.55-.58 1.55-.58z',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinejoin: 'round'
          })
        );
      }

      /** Rotating chevron indicating collapse state. */
      function Chevron(props) {
        return h(
          'svg',
          {
            className: 'skp_chev',
            'data-collapsed': props.collapsed ? 'true' : 'false',
            width: '10',
            height: '10',
            viewBox: '0 0 10 10',
            fill: 'none',
            'aria-hidden': 'true'
          },
          h('path', {
            d: 'M2 3.6L5 6.6l3-3',
            stroke: 'currentColor',
            strokeWidth: 1.3,
            strokeLinecap: 'round',
            strokeLinejoin: 'round'
          })
        );
      }

      /**
       * Render a collapsible section header with hierarchy level.
       */
      function GroupHead(props) {
        const level = props.level ?? 2;
        const indent = (level - 1) * 12 + 12;
        return h(
          'button',
          {
            type: 'button',
            className: 'skp_groupHead' + (level === 1 ? ' skp_groupHeadL1' : ''),
            style: { paddingLeft: indent + 'px' },
            onClick: props.onToggle,
            'aria-expanded': props.collapsed ? 'false' : 'true'
          },
          h(Chevron, { collapsed: props.collapsed }),
          h(
            'span',
            { className: 'skp_groupLabel' + (level === 1 ? ' skp_groupLabelL1' : '') },
            props.label
          ),
          props.hint === undefined || props.hint === '' ? null : h('span', { className: 'skp_groupHint' }, props.hint),
          h('span', { className: 'skp_groupRule' }),
          h('span', { className: 'skp_groupCount' }, String(props.count))
        );
      }

      /**
       * Render one compact skill row that expands in place.
       */
      function SkillRow(props) {
        const skill = props.skill;
        const level = props.level ?? 2;
        const indent = (level - 1) * 12 + 18;
        return h(
          'li',
          { className: 'skp_row' },
          h(
            'details',
            props.expanded === true ? { open: true } : null,
            h(
              'summary',
              { className: 'skp_summary', style: { paddingLeft: indent + 'px' } },
              h('span', { className: 'skp_name' }, skill.name),
              skill.modelInvocable === false ? h('span', { className: 'skp_tag' }, props.t('userOnly')) : null,
              h('span', { className: 'skp_desc' }, skill.description)
            ),
            h(
              'div',
              { className: 'skp_detail', style: { paddingLeft: indent + 'px' } },
              h('p', { className: 'skp_detailText' }, skill.description),
              skill.whenToUse === undefined || skill.whenToUse === ''
                ? null
                : h(
                    'p',
                    { className: 'skp_when' },
                    h('span', { className: 'skp_whenLabel' }, props.t('whenToUse')),
                    skill.whenToUse
                  ),
              h('p', { className: 'skp_path' }, skill.path ?? ''),
              h(
                'div',
                { className: 'skp_actions' },
                props.canOpenResource && skill.path !== undefined
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'skp_actionBtn skp_actionView',
                        onClick: props.onOpen,
                        title: props.t('openFileDesc')
                      },
                      props.t('openFile')
                    )
                  : null,
                props.canOpenNative && skill.path !== undefined
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'skp_actionBtn',
                        onClick: props.onOpenDir,
                        title: props.t('openDirDesc')
                      },
                      props.t('openDir')
                    )
                  : null,
                props.canOpenNative && skill.path !== undefined
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'skp_actionBtn',
                        onClick: props.onRevealDir,
                        title: props.t('revealDirDesc')
                      },
                      props.t('revealDir')
                    )
                  : null
              )
            )
          )
        );
      }

      /**
       * Merge fresh session skills with cached global skills to guarantee
       * user installed skills (~/.agents/skills) never vanish on session switch.
       */
      function mergeWithGlobalCache(incomingSkills, cwd) {
        const roots = skillRootsFor(incomingSkills, cwd);

        // Update cache with any global skills observed
        for (const skill of incomingSkills) {
          const src = sourceOf(skill.path, roots);
          if (src === 'user' || src === 'builtin') {
            globalSkillsCache.set(skill.name, skill);
          }
        }

        // Build combined set: incoming skills have priority
        const combined = new Map();
        for (const [name, skill] of globalSkillsCache.entries()) {
          combined.set(name, skill);
        }
        for (const skill of incomingSkills) {
          combined.set(skill.name, skill);
        }

        return [...combined.values()];
      }

      /**
       * Render the Skills panel for current session.
       */
      function SkillsPanel(props) {
        const t = props.t;
        const useSessions = props.useSessions;
        const {
          loadSkills,
          openSkillFile,
          openSkillDir,
          revealSkillDir,
          canOpenResource,
          canOpenNative
        } = props;

        const sessionId = useSessions((state) => {
          for (const session of Object.values(state.byId)) {
            if ((session.retainedBy?.mainView ?? 0) > 0) return session.id;
          }
          const ids = Object.keys(state.byId);
          return ids.length > 0 ? ids[0] : undefined;
        });
        const cwd = useSessions((state) => (sessionId === undefined ? undefined : state.byId[sessionId]?.cwd));

        const [reload, setReload] = React.useState(0);
        const [query, setQuery] = React.useState('');
        const [view, setView] = React.useState(readView);
        const [collapsed, setCollapsed] = React.useState(readCollapsed);
        const [state, setState] = React.useState({
          status: globalSkillsCache.size > 0 ? 'ready' : 'loading',
          skills: [...globalSkillsCache.values()],
          error: null
        });
        const searchRef = React.useRef(null);

        React.useEffect(() => {
          if (sessionId === undefined) {
            const cached = [...globalSkillsCache.values()];
            setState({
              status: cached.length > 0 ? 'ready' : 'no-session',
              skills: cached,
              error: null
            });
            return undefined;
          }
          const abort = new AbortController();
          setState((prev) => ({
            status: prev.skills.length > 0 ? 'ready' : 'loading',
            skills: prev.skills,
            error: null
          }));
          loadSkills(sessionId, abort.signal).then(
            (incoming) => {
              if (abort.signal.aborted) return;
              const merged = mergeWithGlobalCache(incoming, cwd);
              setState({ status: 'ready', skills: merged, error: null });
            },
            (error) => {
              if (abort.signal.aborted) return;
              const cached = [...globalSkillsCache.values()];
              if (cached.length > 0) {
                // Graceful fallback to cached global skills
                setState({ status: 'ready', skills: cached, error: null });
              } else {
                setState({
                  status: 'error',
                  skills: [],
                  error: error instanceof Error ? error.message : String(error)
                });
              }
            }
          );
          return () => {
            abort.abort();
          };
        }, [sessionId, cwd, reload]);

        const openFor = (skill) => () => {
          openSkillFile(sessionId, cwd, skill.path);
        };

        const openDirFor = (skill) => () => {
          openSkillDir(skill.path);
        };

        const revealDirFor = (skill) => () => {
          revealSkillDir(skill.path);
        };

        const matched = filterSkills(state.skills, query);
        const searching = query.trim() !== '';
        const scopeRoots = skillRootsFor(state.skills, cwd);
        const scoped =
          view === VIEW_ALL
            ? matched
            : matched.filter((skill) => sourceOf(skill.path, scopeRoots) !== 'workspace');
        const sections = groupedSkills(scoped, cwd, t);

        const isNodeExpanded = (id) => searching || !collapsed.has(id);

        const toggleNode = (id) => {
          setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(id)) {
              next.delete(id);
            } else {
              next.add(id);
            }
            writeCollapsed(next);
            return next;
          });
        };

        const renderRows = (skills, level) =>
          h(
            'ul',
            { className: 'skp_list' },
            skills.map((skill) =>
              h(SkillRow, {
                key: skill.name,
                skill,
                level,
                t,
                expanded: searching,
                canOpenResource: Boolean(canOpenResource && skill.path),
                canOpenNative: Boolean(canOpenNative && skill.path),
                onOpen: openFor(skill),
                onOpenDir: openDirFor(skill),
                onRevealDir: revealDirFor(skill)
              })
            )
          );

        const renderNodes = (nodes, level) =>
          nodes.map((node) => {
            const id = node.id;
            const open = isNodeExpanded(id);
            return h(
              'section',
              { key: id, className: 'skp_group' },
              h(GroupHead, {
                level,
                label: node.label,
                count: countSkills(node),
                collapsed: !open,
                onToggle: () => toggleNode(id)
              }),
              open
                ? [
                    node.skills.length > 0 ? renderRows(node.skills, level + 1) : null,
                    node.children.length > 0 ? renderNodes(node.children, level + 1) : null
                  ]
                : null
            );
          });

        const renderSections = () =>
          sections.map((section) => {
            const open = isNodeExpanded(section.id);
            const totalCount = section.children.reduce((sum, child) => sum + countSkills(child), 0);
            return h(
              'section',
              { key: section.id, className: 'skp_group' },
              h(GroupHead, {
                level: 1,
                label: section.label,
                hint: section.hint === undefined ? undefined : t(section.id === 'builtin' ? 'builtinHint' : 'workspaceHint'),
                path: section.path,
                count: totalCount,
                collapsed: !open,
                onToggle: () => toggleNode(section.id)
              }),
              open ? renderNodes(section.children, 2) : null
            );
          });

        let body;
        if (state.status === 'no-session' && state.skills.length === 0) {
          body = h('p', { className: 'skp_hint' }, t('noSession'));
        } else if (state.status === 'loading' && state.skills.length === 0) {
          body = h('p', { className: 'skp_hint' }, t('loading'));
        } else if (state.status === 'error' && state.skills.length === 0) {
          body = h(
            'p',
            { className: 'skp_hint skp_error' },
            t('failed'),
            h('span', { className: 'skp_errorDetail' }, state.error)
          );
        } else if (state.skills.length === 0) {
          body = h('p', { className: 'skp_hint' }, t('empty'));
        } else if (scoped.length === 0) {
          body = h(
            'div',
            { className: 'skp_hint' },
            h('p', { className: 'skp_detailText' }, t('noResult')),
            view === VIEW_DEFAULT
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'skp_hintAction',
                    onClick: () => {
                      setView(VIEW_ALL);
                      writeView(VIEW_ALL);
                    }
                  },
                  t('viewToAll')
                )
              : h(
                  'button',
                  { type: 'button', className: 'skp_hintAction', onClick: () => setQuery('') },
                  t('browseAll')
                )
          );
        } else {
          body = renderSections();
        }

        const showTools = state.skills.length > 0;

        return h(
          'section',
          { className: 'skp_root', 'aria-label': t('title') },
          h(
            'header',
            { className: 'skp_header' },
            h('h1', { className: 'skp_title' }, t('title')),
            scoped.length > 0
              ? h(
                  'span',
                  { className: 'skp_count' },
                  view === VIEW_ALL ? String(scoped.length) : `${scoped.length}/${state.skills.length}`
                )
              : null,
            h('span', { className: 'skp_spacer' }),
            h(
              'button',
              {
                type: 'button',
                className: 'skp_refresh skp_viewBtn',
                onClick: () => {
                  const next = view === VIEW_DEFAULT ? VIEW_ALL : VIEW_DEFAULT;
                  setView(next);
                  writeView(next);
                },
                'aria-pressed': view === VIEW_ALL ? 'true' : 'false',
                title: view === VIEW_DEFAULT ? t('viewToAll') : t('viewToDefault')
              },
              h('span', { 'aria-hidden': 'true' }, view === VIEW_DEFAULT ? t('viewDefaultLabel') : t('viewAllLabel')),
              h(
                'span',
                { className: 'skp_visuallyHidden' },
                view === VIEW_DEFAULT ? t('viewToAll') : t('viewToDefault')
              )
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'skp_refresh',
                onClick: () => setReload((value) => value + 1),
                'aria-label': t('refresh')
              },
              h('span', { 'aria-hidden': 'true' }, '\u21bb'),
              h('span', { className: 'skp_visuallyHidden' }, t('refresh'))
            )
          ),
          showTools
            ? h(
                'div',
                { className: 'skp_tools' },
                h(
                  'label',
                  { className: 'skp_search' },
                  h(
                    'span',
                    { className: 'skp_searchIcon', 'aria-hidden': 'true' },
                    h(
                      'svg',
                      { width: '12', height: '12', viewBox: '0 0 16 16', fill: 'none' },
                      h('circle', { cx: '7', cy: '7', r: '5', stroke: 'currentColor', strokeWidth: 1.4 }),
                      h('path', {
                        d: 'M11 11l3 3',
                        stroke: 'currentColor',
                        strokeWidth: 1.4,
                        strokeLinecap: 'round'
                      })
                    )
                  ),
                  h('input', {
                    ref: searchRef,
                    className: 'skp_searchInput',
                    type: 'search',
                    value: query,
                    placeholder: t('searchPlaceholder'),
                    'aria-label': t('search'),
                    onChange: (event) => setQuery(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Escape') setQuery('');
                    }
                  }),
                  h('span', { className: 'skp_searchKey', 'aria-hidden': 'true' }, t('searchShortcut'))
                )
              )
            : null,
          h('div', { className: 'skp_body' }, body)
        );
      }

      const inject = ['slots', 'locale', 'remote', 'remote.skills', 'remote.session', 'sessions', 'sidebarRight'];

      function apply(ctx) {
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {};
          if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') !== null) return () => {};
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/skills-panel';
          tag.dataset.pluginCss = CSS_TAG_ID;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'skills-panel: stylesheet');

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skills-panel: dictionaries');
        const t = ctx.locale.bind(NS);
        const skills = ctx.remote.skills;
        const sessionRemote = ctx.remote.session;
        const sidebarRight = ctx.get('sidebarRight');
        const canOpenResource = sidebarRight !== undefined && typeof sidebarRight.openResource === 'function';
        const canOpenNative = sessionRemote !== undefined && typeof sessionRemote.openWorkspacePath === 'function';

        const loadSkills = async (sessionId, signal) => {
          const result = await skills.list({ sessionId }, signal);
          if (!result.ok) {
            const failure = result.error ?? {};
            throw new Error(failure.message ?? failure.code ?? 'skills/list failed');
          }
          return result.value.skills;
        };

        const openSkillFile = (sessionId, cwd, path) => {
          if (!canOpenResource || path === undefined) return false;
          try {
            sidebarRight.openResource(fileAddressFor(sessionId, cwd, path));
            return true;
          } catch {
            return false;
          }
        };

        const openSkillDir = (skillPath) => {
          if (!canOpenNative || skillPath === undefined) return false;
          const dir = getSkillDir(skillPath);
          sessionRemote.openWorkspacePath({ path: dir }).catch(() => {});
          return true;
        };

        const revealSkillDir = (skillPath) => {
          if (!canOpenNative || skillPath === undefined) return false;
          const dir = getSkillDir(skillPath);
          sessionRemote.openWorkspacePath({ path: dir, action: 'reveal' }).catch(() => {});
          return true;
        };

        const panelFace = {
          loadSkills,
          openSkillFile,
          openSkillDir,
          revealSkillDir,
          canOpenResource,
          canOpenNative
        };

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => panelFace
            },
            SkillsPanel
          )
        );

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 10,
              label: () => t('panel'),
              locale: NS
            },
            SkillsGlyph
          )
        );
      }

      return {
        inject,
        apply,
        __test: {
          Panel: SkillsPanel,
          skillRootsFor,
          isBundledPath,
          rootOf,
          sourceOf,
          buildSegmentTree,
          segmentLabel,
          groupedSkills,
          filterSkills,
          fileAddressFor,
          sessionFileAddress,
          getSkillDir,
          mergeWithGlobalCache,
          globalSkillsCache
        }
      };
    }
  });
})();
