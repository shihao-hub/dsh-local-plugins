(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/note-wall',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      /** 侧栏入口 id，同时是 main 面板的 key（宿主按入口 id 派发主区）。 */
      const PANEL_ID = 'note-wall';
      const NS = 'note-wall';
      const CSS_TAG_ID = 'note-wall-styles';
      /** 本机存储键。版本后缀变化即视为另一份数据，不会误读旧结构。 */
      const STORAGE_KEY = 'note-wall.v1';
      const STORE_VERSION = 1;
      /** 单条便签上限（字符）。 */
      const MAX_LEN = 4000;
      /** 整面墙上限（条）。 */
      const MAX_NOTES = 500;
      /** 删除后撤销条的存活时长。 */
      const UNDO_MS = 6000;
      /** 相对时间的刷新间隔。 */
      const TICK_MS = 60000;

      /**
       * 便签纸色板。`tint` 只用于混色与色点（artwork 自有颜色），
       * 文字与背景始终由宿主主题 token 决定，因此明暗主题都可读。
       */
      const PALETTE = [
        { id: 'amber', tint: '#e6a92c' },
        { id: 'mint', tint: '#3fae86' },
        { id: 'sky', tint: '#4a9ee8' },
        { id: 'rose', tint: '#e0769a' },
        { id: 'lilac', tint: '#9a86e2' }
      ];

      /** 简体中文字典，也是键集基准。 */
      const zh = {
        panel: '便签',
        title: '便签墙',
        count: '{n} 条便签',
        searchLabel: '搜索便签',
        searchPlaceholder: '搜索便签',
        searchClear: '清除搜索',
        placeholder: '随手记一条灵感…',
        hint: 'Enter 保存 · Shift+Enter 换行',
        add: '贴上去',
        addHint: '把这条灵感贴到墙上',
        emptyTitle: '墙上还空着',
        emptyBody: '先把刚冒出来的想法贴上来，之后再整理。',
        emptyHint: '在下方输入，按 Enter 就能贴上',
        noMatch: '没有匹配的便签',
        noMatchHint: '换个词试试，或清除搜索条件',
        clearSearch: '清除搜索',
        pinned: '已置顶',
        pin: '置顶',
        unpin: '取消置顶',
        edit: '编辑',
        editHint: '编辑这条便签（也可双击正文）',
        delete: '删除',
        deleteHint: '删除这条便签',
        recolor: '换色',
        recolorHint: '换一张别的颜色的便签纸',
        save: '保存',
        cancel: '取消',
        expand: '展开全文',
        collapse: '收起',
        deleted: '已删除 1 条便签',
        undo: '撤销',
        saveError: '便签无法写入本机存储（可能空间已满），本次改动在刷新后可能丢失。',
        'time.justNow': '刚刚',
        'time.minutes': '{n} 分钟前',
        'time.hours': '{n} 小时前',
        'time.yesterday': '昨天',
        'time.date': '{m} 月 {d} 日',
        'time.dateYear': '{y} 年 {m} 月 {d} 日',
        colorName: '{name}色',
        'color.amber': '琥珀',
        'color.mint': '薄荷',
        'color.sky': '天空',
        'color.rose': '樱粉',
        'color.lilac': '丁香'
      };

      /** 英文字典，键集与 zh 完全一致。 */
      const en = {
        panel: 'Notes',
        title: 'Note wall',
        count: '{n} notes',
        searchLabel: 'Search notes',
        searchPlaceholder: 'Search notes',
        searchClear: 'Clear search',
        placeholder: 'Jot an idea before it slips away…',
        hint: 'Enter to save · Shift+Enter for a new line',
        add: 'Pin it up',
        addHint: 'Stick this idea onto the wall',
        emptyTitle: 'The wall is empty',
        emptyBody: 'Put the thought you just had up here, and sort it out later.',
        emptyHint: 'Type below and press Enter',
        noMatch: 'No matching notes',
        noMatchHint: 'Try another word, or clear the search.',
        clearSearch: 'Clear search',
        pinned: 'Pinned',
        pin: 'Pin',
        unpin: 'Unpin',
        edit: 'Edit',
        editHint: 'Edit this note (or double-click its text)',
        delete: 'Delete',
        deleteHint: 'Delete this note',
        recolor: 'Recolor',
        recolorHint: 'Move this note onto another paper color',
        save: 'Save',
        cancel: 'Cancel',
        expand: 'Show all',
        collapse: 'Collapse',
        deleted: 'Deleted 1 note',
        undo: 'Undo',
        saveError: 'Notes cannot be written to local storage (it may be full); changes may be lost after a reload.',
        'time.justNow': 'just now',
        'time.minutes': '{n} min ago',
        'time.hours': '{n} h ago',
        'time.yesterday': 'yesterday',
        'time.date': '{m}/{d}',
        'time.dateYear': '{y}/{m}/{d}',
        colorName: '{name}',
        'color.amber': 'Amber',
        'color.mint': 'Mint',
        'color.sky': 'Sky',
        'color.rose': 'Rose',
        'color.lilac': 'Lilac'
      };

      /** 当前界面语言对应的字典（宿主未提供 translator 时兜底）。 */
      function currentDict() {
        let lang = '';
        try {
          if (typeof document !== 'undefined' && document.documentElement) {
            lang = document.documentElement.lang || '';
          }
        } catch (error) {
          lang = '';
        }
        if (!lang && typeof navigator !== 'undefined') lang = navigator.language || '';
        return /^en/i.test(lang) ? en : zh;
      }

      function fallbackT(key) {
        const dict = currentDict();
        return dict[key] !== undefined ? dict[key] : key;
      }

      /** 模板插值：{n} / {m} / {d} / {y} / {name}。 */
      function fill(template, params) {
        if (params === undefined || params === null) return String(template);
        return String(template).replace(/\{(\w+)\}/g, function (match, key) {
          return params[key] !== undefined ? String(params[key]) : match;
        });
      }

      /**
       * 把宿主绑定的 translator 包装成「缺失即回退到本地字典」的形式。
       * 宿主 t 在键缺失时可能返回键名本身，这也要回退。
       */
      function translator(props) {
        const bound = props && typeof props.t === 'function' ? props.t : fallbackT;
        return function (key, params) {
          let value;
          try {
            value = bound(key);
          } catch (error) {
            value = undefined;
          }
          if (value === undefined || value === null || value === key) {
            const dict = currentDict();
            value = dict[key] !== undefined ? dict[key] : key;
          }
          return params ? fill(value, params) : value;
        };
      }

      function colorEntry(id) {
        for (let i = 0; i < PALETTE.length; i++) {
          if (PALETTE[i].id === id) return PALETTE[i];
        }
        return PALETTE[0];
      }

      function nextColorId(id) {
        for (let i = 0; i < PALETTE.length; i++) {
          if (PALETTE[i].id === id) return PALETTE[(i + 1) % PALETTE.length].id;
        }
        return PALETTE[0].id;
      }

      function makeId() {
        return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      }

      /** 把存储里的一条记录整理成安全形状；非法记录返回 null。 */
      function normalizeNote(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const text = typeof raw.text === 'string' ? raw.text.trim() : '';
        if (!text) return null;
        const color = PALETTE.some(function (item) { return item.id === raw.color; })
          ? raw.color
          : PALETTE[0].id;
        const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
        const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
        return {
          id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
          text: text.slice(0, MAX_LEN),
          color: color,
          createdAt: createdAt,
          updatedAt: updatedAt,
          pinned: raw.pinned === true
        };
      }

      /** 置顶优先，其余按创建时间倒序。 */
      function sortNotes(notes) {
        return notes.slice().sort(function (a, b) {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return b.createdAt - a.createdAt;
        });
      }

      function readNotes() {
        try {
          if (typeof window === 'undefined' || !window.localStorage) return [];
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (!raw) return [];
          const parsed = JSON.parse(raw);
          const source = Array.isArray(parsed)
            ? parsed
            : parsed && Array.isArray(parsed.notes)
              ? parsed.notes
              : [];
          const seen = Object.create(null);
          const out = [];
          for (let i = 0; i < source.length && out.length < MAX_NOTES; i++) {
            const note = normalizeNote(source[i]);
            if (!note) continue;
            if (seen[note.id]) note.id = makeId();
            seen[note.id] = true;
            out.push(note);
          }
          return sortNotes(out);
        } catch (error) {
          return [];
        }
      }

      function writeNotes(notes) {
        try {
          if (typeof window === 'undefined' || !window.localStorage) return false;
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: STORE_VERSION, notes: notes })
          );
          return true;
        } catch (error) {
          return false;
        }
      }

      /** 相对时间：一分钟内「刚刚」，随后分钟/小时/昨天/日期。 */
      function timeLabel(ts, now, t) {
        const diff = Math.max(0, now - ts);
        const MINUTE = 60000;
        const HOUR = 3600000;
        const DAY = 86400000;
        if (diff < MINUTE) return t('time.justNow');
        if (diff < HOUR) return fill(t('time.minutes'), { n: Math.floor(diff / MINUTE) });
        if (diff < DAY) return fill(t('time.hours'), { n: Math.floor(diff / HOUR) });
        const date = new Date(ts);
        const current = new Date(now);
        const startOfToday = new Date(
          current.getFullYear(),
          current.getMonth(),
          current.getDate()
        ).getTime();
        if (ts >= startOfToday - DAY) return t('time.yesterday');
        if (date.getFullYear() === current.getFullYear()) {
          return fill(t('time.date'), { m: date.getMonth() + 1, d: date.getDate() });
        }
        return fill(t('time.dateYear'), {
          y: date.getFullYear(),
          m: date.getMonth() + 1,
          d: date.getDate()
        });
      }

      /** 绝对时间（hover 提示用）。 */
      function fullTime(ts) {
        const date = new Date(ts);
        const pad = function (value) {
          return value < 10 ? '0' + value : String(value);
        };
        return (
          date.getFullYear() +
          '-' +
          pad(date.getMonth() + 1) +
          '-' +
          pad(date.getDate()) +
          ' ' +
          pad(date.getHours()) +
          ':' +
          pad(date.getMinutes())
        );
      }

      /** 搜索命中片段染色；只标第一处，避免整篇花掉。 */
      function highlighted(text, query) {
        const needle = String(query || '').trim();
        if (!needle) return text;
        const index = text.toLowerCase().indexOf(needle.toLowerCase());
        if (index < 0) return text;
        return [
          text.slice(0, index),
          h('mark', { key: 'hit', className: 'nw_mark' }, text.slice(index, index + needle.length)),
          text.slice(index + needle.length)
        ];
      }

      const CSS = [
        '.nw_root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;',
        'color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);',
        'font-family:var(--dsw-font-family-base,var(--dsh-font-family-base,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif))}',
        '.nw_root,.nw_root *{box-sizing:border-box}',
        '.nw_root button{font-family:inherit}',
        '.nw_header{display:flex;align-items:center;gap:9px;padding:11px 14px 10px;flex:none;',
        'border-bottom:.5px solid var(--dsw-alias-border-l1);min-width:0}',
        '.nw_headIcon{display:inline-flex;align-items:center;justify-content:center;color:#d8a13a;flex:none}',
        '.nw_heading{display:flex;flex-direction:column;gap:1px;min-width:0;flex:none}',
        '.nw_title{margin:0;font-size:14px;font-weight:600;letter-spacing:-.01em;line-height:1.25}',
        '.nw_count{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;line-height:1.2}',
        '.nw_spacer{flex:1;min-width:8px}',
        '.nw_searchBox{display:flex;align-items:center;gap:5px;height:28px;padding:0 8px;flex:none;',
        'width:220px;max-width:38vw;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;',
        'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);',
        'transition:border-color .15s ease,background-color .15s ease}',
        '.nw_searchBox:focus-within{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
        '.nw_searchIcon{display:inline-flex;flex:none}',
        '.nw_search{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);',
        'font-size:12px;line-height:1.2;padding:0}',
        '.nw_search::placeholder{color:var(--dsw-alias-label-tertiary)}',
        '.nw_clearSearch{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:none;',
        'border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}',
        '.nw_clearSearch:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.nw_body{display:flex;flex-direction:column;flex:1;min-height:0}',
        '.nw_composer{margin:12px 14px 0;flex:none;padding:10px 12px 9px;border-radius:12px;',
        'border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);',
        'transition:border-color .15s ease,box-shadow .15s ease}',
        '.nw_composer:focus-within{border-color:var(--dsw-alias-brand-primary);',
        'box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}',
        '.nw_composer[data-error="true"]{border-color:var(--dsw-alias-state-error-primary)}',
        '.nw_draft{display:block;width:100%;min-height:24px;max-height:200px;resize:none;border:0;outline:0;',
        'background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.62;',
        'font-family:inherit;padding:1px 0 2px;overflow-y:auto}',
        '.nw_draft::placeholder{color:var(--dsw-alias-label-tertiary)}',
        '.nw_composerBar{display:flex;align-items:center;gap:8px;margin-top:7px;flex-wrap:wrap}',
        '.nw_swatches{display:flex;align-items:center;gap:6px;flex:none}',
        '.nw_swatch{width:14px;height:14px;flex:none;border:0;border-radius:50%;padding:0;cursor:pointer;',
        'background:var(--nw-tint);box-shadow:inset 0 0 0 1px rgba(0,0,0,.18);position:relative;',
        'transition:transform .12s ease}',
        '.nw_swatch:hover{transform:scale(1.16)}',
        '.nw_swatch[aria-pressed="true"]{box-shadow:inset 0 0 0 1px rgba(0,0,0,.18),0 0 0 2px var(--dsw-alias-bg-layer-1),0 0 0 3.5px var(--nw-tint)}',
        '.nw_hint{font-size:11px;color:var(--dsw-alias-label-tertiary);min-width:0;flex:1;',
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}',
        '.nw_add{flex:none;border:0;border-radius:7px;padding:5px 11px;font-size:12px;font-weight:500;',
        'line-height:1.4;cursor:pointer;background:var(--dsw-alias-button-primary-fill);',
        'color:var(--dsw-alias-label-primary-inverted)}',
        '.nw_add:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
        '.nw_add:disabled{cursor:default;opacity:.45}',
        '.nw_warn{margin:8px 14px 0;flex:none;font-size:11px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}',
        '.nw_scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:14px 14px 26px}',
        '.nw_grid{column-width:246px;column-gap:12px}',
        '.nw_note{position:relative;display:block;break-inside:avoid;-webkit-column-break-inside:avoid;',
        'margin:0 0 12px;padding:11px 12px 12px;border-radius:10px;',
        'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);',
        'box-shadow:0 1px 2px rgba(0,0,0,.05);',
        'transition:box-shadow .14s ease,transform .14s ease,border-color .14s ease}',
        '.nw_note:hover{box-shadow:0 3px 10px rgba(0,0,0,.10);transform:translateY(-1px)}',
        '.nw_noteTop{display:flex;align-items:center;gap:6px;min-height:20px;margin-bottom:6px}',
        '.nw_time{font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none}',
        '.nw_pinFlag{display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--nw-tint)}',
        '.nw_actions{display:flex;align-items:center;gap:1px;margin-left:auto;flex:none;opacity:0;',
        'transition:opacity .12s ease}',
        '.nw_note:hover .nw_actions,.nw_note:focus-within .nw_actions{opacity:1}',
        '.nw_action{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;',
        'padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
        '.nw_action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.nw_action[data-danger="true"]:hover{background:var(--dsw-alias-interactive-bg-hover-danger);',
        'color:var(--dsw-alias-state-error-primary)}',
        '.nw_text{margin:0;font-size:13px;line-height:1.62;white-space:pre-wrap;overflow-wrap:anywhere;',
        'word-break:break-word;color:var(--dsw-alias-label-primary)}',
        '.nw_text[data-clamped="true"]{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:9;overflow:hidden}',
        '.nw_mark{background:rgba(245,158,11,.3);border-radius:2px;padding:0 1px;color:inherit;',
        'box-shadow:inset 0 -1px 0 rgba(245,158,11,.55)}',
        '.nw_more{align-self:flex-start;margin-top:5px;padding:0;border:0;background:transparent;',
        'color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.4;cursor:pointer}',
        '.nw_more:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}',
        '.nw_picker{display:flex;align-items:center;gap:6px;margin-top:7px;padding-top:7px;',
        'border-top:.5px dashed var(--dsw-alias-border-l2)}',
        '.nw_editor{display:block;width:100%;min-height:78px;max-height:320px;resize:vertical;border-radius:6px;',
        'border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);',
        'color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.62;font-family:inherit;',
        'padding:6px 8px;outline:0}',
        '.nw_editor:focus{border-color:var(--dsw-alias-brand-primary)}',
        '.nw_editBar{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}',
        '.nw_editSpacer{flex:1;min-width:4px}',
        '.nw_editBtn{border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 9px;',
        'font-size:11px;line-height:1.4;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary)}',
        '.nw_editBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.nw_editBtn[data-primary="true"]{border-color:transparent;background:var(--dsw-alias-button-primary-fill);',
        'color:var(--dsw-alias-label-primary-inverted)}',
        '.nw_editBtn[data-primary="true"]:hover{background:var(--dsw-alias-button-primary-hover);',
        'color:var(--dsw-alias-label-primary-inverted)}',
        '.nw_empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;',
        'padding:54px 16px 40px;text-align:center;color:var(--dsw-alias-label-secondary)}',
        '.nw_emptyIcon{color:var(--dsw-alias-label-tertiary);opacity:.55;margin-bottom:2px}',
        '.nw_emptyTitle{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.nw_emptyBody{margin:0;font-size:12px;line-height:1.65;max-width:328px}',
        '.nw_emptyHint{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
        '.nw_empty--compact{padding-top:34px}',
        '.nw_undo{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:3;',
        'display:flex;align-items:center;gap:10px;padding:7px 9px 7px 14px;border-radius:999px;',
        'background:var(--dsw-alias-bg-overlay);border:.5px solid var(--dsw-alias-border-l2);',
        'box-shadow:0 6px 20px rgba(0,0,0,.18);font-size:12px;line-height:1.4;color:var(--dsw-alias-label-primary)}',
        '.nw_undoText{white-space:nowrap}',
        '.nw_undoBtn{border:0;border-radius:999px;padding:3px 10px;font-size:12px;line-height:1.4;cursor:pointer;',
        'background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
        '.nw_undoBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '@supports (background:color-mix(in srgb,red 10%,blue)){',
        '.nw_note{background:color-mix(in srgb,var(--nw-tint) 13%,var(--dsw-alias-bg-layer-1));',
        'border-color:color-mix(in srgb,var(--nw-tint) 26%,var(--dsw-alias-border-l1))}',
        '.nw_note:hover{background:color-mix(in srgb,var(--nw-tint) 18%,var(--dsw-alias-bg-layer-1));',
        'border-color:color-mix(in srgb,var(--nw-tint) 38%,var(--dsw-alias-border-l1))}',
        '.nw_note[data-pinned="true"]{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--nw-tint) 45%,var(--dsw-alias-border-l2)),0 1px 2px rgba(0,0,0,.05)}',
        '.nw_pinFlag{color:color-mix(in srgb,var(--nw-tint) 72%,var(--dsw-alias-label-primary))}',
        '.nw_mark{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent);',
        'box-shadow:inset 0 -1px 0 color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,transparent)}',
        '}',
        '@media (prefers-reduced-motion:reduce){.nw_note,.nw_swatch{transition:none}.nw_note:hover{transform:none}}',
        '@media (max-width:760px){.nw_searchBox{width:150px}.nw_grid{column-width:210px}.nw_hint{display:none}}'
      ].join('');

      /** 侧栏图标与空态大图标：折角便签纸。 */
      function NoteGlyph(props) {
        const size = props && typeof props.size === 'number' ? props.size : 18;
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
            d: 'M3.3 2.4h9.4v7.7L9.5 13.6H3.3z',
            stroke: 'currentColor',
            strokeWidth: 1.25,
            strokeLinejoin: 'round'
          }),
          h('path', {
            d: 'M12.7 10.1H9.5v3.5',
            stroke: 'currentColor',
            strokeWidth: 1.25,
            strokeLinejoin: 'round'
          }),
          h('path', {
            d: 'M5.5 5.05h5M5.5 7.15h5M5.5 9.25h2.9',
            stroke: 'currentColor',
            strokeWidth: 1.05,
            strokeLinecap: 'round',
            opacity: 0.92
          })
        );
      }

      function PinGlyph() {
        return h(
          'svg',
          {
            width: 13,
            height: 13,
            viewBox: '0 0 16 16',
            fill: 'none',
            focusable: 'false',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('path', {
            d: 'M6.1 2.2h4.2l-.7 4.1 2.1 2.1H4.7l2.1-2.1-.7-4.1z',
            stroke: 'currentColor',
            strokeWidth: 1.15,
            strokeLinejoin: 'round'
          }),
          h('path', {
            d: 'M8.2 8.4v5.2',
            stroke: 'currentColor',
            strokeWidth: 1.15,
            strokeLinecap: 'round'
          })
        );
      }

      function PaletteGlyph() {
        return h(
          'svg',
          {
            width: 13,
            height: 13,
            viewBox: '0 0 16 16',
            fill: 'none',
            focusable: 'false',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('circle', { cx: 5.1, cy: 6.1, r: 1.35, fill: 'currentColor' }),
          h('circle', { cx: 9.2, cy: 4.8, r: 1.35, fill: 'currentColor' }),
          h('circle', { cx: 11.4, cy: 8.3, r: 1.35, fill: 'currentColor' }),
          h('circle', { cx: 7, cy: 10.4, r: 1.35, fill: 'currentColor' }),
          h('circle', { cx: 3.5, cy: 9.1, r: 1.05, fill: 'currentColor', opacity: 0.7 })
        );
      }

      function PencilGlyph() {
        return h(
          'svg',
          {
            width: 13,
            height: 13,
            viewBox: '0 0 16 16',
            fill: 'none',
            focusable: 'false',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('path', {
            d: 'M2.6 13.4l.5-2.2 7-7 1.7 1.7-7 7-2.2.5z',
            stroke: 'currentColor',
            strokeWidth: 1.15,
            strokeLinejoin: 'round'
          }),
          h('path', {
            d: 'M10.1 4.2l1.7 1.7',
            stroke: 'currentColor',
            strokeWidth: 1.15,
            strokeLinecap: 'round'
          })
        );
      }

      function TrashGlyph() {
        return h(
          'svg',
          {
            width: 13,
            height: 13,
            viewBox: '0 0 16 16',
            fill: 'none',
            focusable: 'false',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('path', {
            d: 'M3.6 4.6h8.8M6.4 3.1h3.2',
            stroke: 'currentColor',
            strokeWidth: 1.15,
            strokeLinecap: 'round'
          }),
          h('path', {
            d: 'M5.2 4.6l.5 8.3h4.6l.5-8.3',
            stroke: 'currentColor',
            strokeWidth: 1.15,
            strokeLinejoin: 'round'
          })
        );
      }

      function SearchGlyph() {
        return h(
          'svg',
          {
            width: 13,
            height: 13,
            viewBox: '0 0 16 16',
            fill: 'none',
            focusable: 'false',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('circle', { cx: 7, cy: 6.9, r: 3.9, stroke: 'currentColor', strokeWidth: 1.2 }),
          h('path', {
            d: 'M9.9 9.8l3.2 3.2',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinecap: 'round'
          })
        );
      }

      function CrossGlyph() {
        return h(
          'svg',
          {
            width: 10,
            height: 10,
            viewBox: '0 0 16 16',
            fill: 'none',
            focusable: 'false',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('path', {
            d: 'M4 4l8 8M12 4l-8 8',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round'
          })
        );
      }

      /** 色板按钮：选中态用环形描边表达。 */
      function ColorSwatch(props) {
        const entry = props.entry;
        return h('button', {
          type: 'button',
          className: 'nw_swatch',
          style: { '--nw-tint': entry.tint },
          'aria-label': props.label,
          title: props.label,
          'aria-pressed': props.selected ? 'true' : 'false',
          onClick: props.onSelect,
          onMouseDown: props.keepFocus ? function (event) { event.preventDefault(); } : undefined
        });
      }

      /** 输入区：Enter 保存、Shift+Enter 换行，高度随内容增长。 */
      function Composer(props) {
        const t = props.t;
        const areaRef = React.useRef(null);
        const [focused, setFocused] = React.useState(false);

        React.useLayoutEffect(
          function () {
            const area = areaRef.current;
            if (!area) return;
            area.style.height = 'auto';
            area.style.height = Math.min(area.scrollHeight, 200) + 'px';
          },
          [props.draft]
        );

        const onKeyDown = function (event) {
          const composing =
            event.nativeEvent && (event.nativeEvent.isComposing || event.keyCode === 229);
          if (event.key === 'Enter' && !event.shiftKey && !composing) {
            event.preventDefault();
            props.onSubmit();
          }
        };

        const swatches = PALETTE.map(function (entry) {
          return h(ColorSwatch, {
            key: entry.id,
            entry: entry,
            selected: props.colorId === entry.id,
            label: fill(t('colorName'), { name: t('color.' + entry.id) }),
            onSelect: function () {
              props.onColorChange(entry.id);
            }
          });
        });

        const trimmed = props.draft.trim();

        return h(
          'div',
          {
            className: 'nw_composer',
            'data-focused': focused ? 'true' : 'false',
            'data-error': props.saveError ? 'true' : 'false'
          },
          h('textarea', {
            ref: areaRef,
            className: 'nw_draft',
            value: props.draft,
            rows: 1,
            maxLength: MAX_LEN,
            placeholder: t('placeholder'),
            'aria-label': t('placeholder'),
            autoFocus: true,
            spellCheck: false,
            onChange: function (event) {
              props.onDraftChange(event.target.value);
            },
            onKeyDown: onKeyDown,
            onFocus: function () {
              setFocused(true);
            },
            onBlur: function () {
              setFocused(false);
            }
          }),
          h(
            'div',
            { className: 'nw_composerBar' },
            h('div', { className: 'nw_swatches', role: 'group', 'aria-label': t('recolor') }, swatches),
            h('span', { className: 'nw_hint' }, t('hint')),
            h(
              'button',
              {
                type: 'button',
                className: 'nw_add',
                disabled: !trimmed,
                title: t('addHint'),
                'aria-label': t('addHint'),
                onClick: props.onSubmit
              },
              t('add')
            )
          )
        );
      }

      /** 单张便签：展示 / 就地编辑 / 置顶 / 换色 / 删除。 */
      function NoteCard(props) {
        const note = props.note;
        const t = props.t;
        const entry = colorEntry(note.color);
        const [editing, setEditing] = React.useState(false);
        const [draft, setDraft] = React.useState(note.text);
        const [expanded, setExpanded] = React.useState(false);
        const [picking, setPicking] = React.useState(false);
        const editorRef = React.useRef(null);

        React.useEffect(
          function () {
            if (!editing) setDraft(note.text);
          },
          [note.text, editing]
        );

        React.useLayoutEffect(
          function () {
            if (!editing) return;
            const area = editorRef.current;
            if (!area) return;
            area.style.height = 'auto';
            area.style.height = Math.min(Math.max(area.scrollHeight, 78), 320) + 'px';
            area.focus();
            const end = area.value.length;
            area.setSelectionRange(end, end);
          },
          [editing]
        );

        const longText =
          note.text.length > 420 || note.text.split('\n').length > 9;
        const clamped = longText && !expanded;

        const openEditor = function () {
          setPicking(false);
          setDraft(note.text);
          setEditing(true);
        };

        const commit = function () {
          if (!editing) return;
          const text = draft.trim();
          setEditing(false);
          if (!text) {
            props.onDelete(note.id);
            return;
          }
          if (text !== note.text) props.onEdit(note.id, text);
        };

        const cancel = function () {
          setDraft(note.text);
          setEditing(false);
        };

        const onEditorKeyDown = function (event) {
          const composing =
            event.nativeEvent && (event.nativeEvent.isComposing || event.keyCode === 229);
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
            return;
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !composing) {
            event.preventDefault();
            commit();
          }
        };

        const actionButton = function (key, label, glyph, onClick, danger) {
          return h(
            'button',
            {
              key: key,
              type: 'button',
              className: 'nw_action',
              'data-danger': danger ? 'true' : 'false',
              title: label,
              'aria-label': label,
              onMouseDown: function (event) {
                event.preventDefault();
              },
              onClick: onClick
            },
            glyph
          );
        };

        const actions = h(
          'div',
          { className: 'nw_actions' },
          actionButton(
            'pin',
            note.pinned ? t('unpin') : t('pin'),
            h(PinGlyph),
            function () {
              props.onTogglePin(note.id);
            }
          ),
          actionButton(
            'color',
            t('recolorHint'),
            h(PaletteGlyph),
            function () {
              setPicking(function (value) {
                return !value;
              });
            }
          ),
          actionButton('edit', t('editHint'), h(PencilGlyph), openEditor),
          actionButton(
            'delete',
            t('deleteHint'),
            h(TrashGlyph),
            function () {
              props.onDelete(note.id);
            },
            true
          )
        );

        const picker = picking
          ? h(
              'div',
              { className: 'nw_picker' },
              PALETTE.map(function (item) {
                return h(ColorSwatch, {
                  key: item.id,
                  entry: item,
                  selected: note.color === item.id,
                  label: fill(t('colorName'), { name: t('color.' + item.id) }),
                  onSelect: function () {
                    props.onRecolor(note.id, item.id);
                    setPicking(false);
                  }
                });
              })
            )
          : null;

        let body;
        if (editing) {
          body = h(
            'div',
            null,
            h('textarea', {
              ref: editorRef,
              className: 'nw_editor',
              value: draft,
              maxLength: MAX_LEN,
              'aria-label': t('edit'),
              spellCheck: false,
              onChange: function (event) {
                setDraft(event.target.value);
              },
              onKeyDown: onEditorKeyDown,
              onBlur: commit
            }),
            h(
              'div',
              { className: 'nw_editBar' },
              PALETTE.map(function (item) {
                return h(ColorSwatch, {
                  key: item.id,
                  entry: item,
                  selected: note.color === item.id,
                  keepFocus: true,
                  label: fill(t('colorName'), { name: t('color.' + item.id) }),
                  onSelect: function () {
                    props.onRecolor(note.id, item.id);
                  }
                });
              }),
              h('span', { className: 'nw_editSpacer' }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'nw_editBtn',
                  onMouseDown: function (event) {
                    event.preventDefault();
                  },
                  onClick: cancel
                },
                t('cancel')
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'nw_editBtn',
                  'data-primary': 'true',
                  onMouseDown: function (event) {
                    event.preventDefault();
                  },
                  onClick: commit
                },
                t('save')
              )
            )
          );
        } else {
          body = h(
            'div',
            null,
            h(
              'p',
              {
                className: 'nw_text',
                'data-clamped': clamped ? 'true' : 'false'
              },
              highlighted(note.text, props.query)
            ),
            longText
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'nw_more',
                    onClick: function () {
                      setExpanded(function (value) {
                        return !value;
                      });
                    }
                  },
                  expanded ? t('collapse') : t('expand')
                )
              : null,
            picker
          );
        }

        return h(
          'article',
          {
            className: 'nw_note',
            'data-note-id': note.id,
            'data-pinned': note.pinned ? 'true' : 'false',
            style: { '--nw-tint': entry.tint },
            onDoubleClick: function (event) {
              const target = event.target;
              if (target && target.closest && target.closest('button,textarea,a')) return;
              if (!editing) openEditor();
            }
          },
          h(
            'div',
            { className: 'nw_noteTop' },
            note.pinned
              ? h(
                  'span',
                  { className: 'nw_pinFlag', title: t('pinned'), 'aria-label': t('pinned') },
                  h(PinGlyph)
                )
              : null,
            h(
              'time',
              {
                className: 'nw_time',
                dateTime: new Date(note.createdAt).toISOString(),
                title: fullTime(note.createdAt)
              },
              timeLabel(note.createdAt, props.now, t)
            ),
            editing ? null : actions
          ),
          body
        );
      }

      function EmptyWall(props) {
        const t = props.t;
        return h(
          'div',
          { className: 'nw_empty' },
          h('div', { className: 'nw_emptyIcon' }, h(NoteGlyph, { size: 42 })),
          h('h2', { className: 'nw_emptyTitle' }, t('emptyTitle')),
          h('p', { className: 'nw_emptyBody' }, t('emptyBody')),
          h('p', { className: 'nw_emptyHint' }, t('emptyHint'))
        );
      }

      function NoMatch(props) {
        const t = props.t;
        return h(
          'div',
          { className: 'nw_empty nw_empty--compact' },
          h('h2', { className: 'nw_emptyTitle' }, t('noMatch')),
          h('p', { className: 'nw_emptyBody' }, t('noMatchHint')),
          h(
            'button',
            {
              type: 'button',
              className: 'nw_editBtn',
              onClick: props.onClear
            },
            t('clearSearch')
          )
        );
      }

      function NoteWallPanel(props) {
        const t = translator(props);
        const [notes, setNotes] = React.useState(readNotes);
        const [draft, setDraft] = React.useState('');
        const [colorId, setColorId] = React.useState(PALETTE[0].id);
        const [query, setQuery] = React.useState('');
        const [undoNote, setUndoNote] = React.useState(null);
        const [saveError, setSaveError] = React.useState(false);
        const [now, setNow] = React.useState(function () {
          return Date.now();
        });
        const scrollRef = React.useRef(null);

        // 任何改动都立刻落本机；失败时在面板里给出可读提示。
        React.useEffect(
          function () {
            setSaveError(!writeNotes(notes));
          },
          [notes]
        );

        // 多标签页同源共享同一份便签：另一个页面写入后同步过来。
        React.useEffect(function () {
          const onStorage = function (event) {
            if (event.key !== STORAGE_KEY && event.key !== null) return;
            setNotes(readNotes());
          };
          window.addEventListener('storage', onStorage);
          return function () {
            window.removeEventListener('storage', onStorage);
          };
        }, []);

        React.useEffect(function () {
          const timer = window.setInterval(function () {
            setNow(Date.now());
          }, TICK_MS);
          return function () {
            window.clearInterval(timer);
          };
        }, []);

        React.useEffect(
          function () {
            if (!undoNote) return undefined;
            const timer = window.setTimeout(function () {
              setUndoNote(null);
            }, UNDO_MS);
            return function () {
              window.clearTimeout(timer);
            };
          },
          [undoNote]
        );

        const addNote = function () {
          const text = draft.trim();
          if (!text) return;
          const stamp = Date.now();
          const note = {
            id: makeId(),
            text: text.slice(0, MAX_LEN),
            color: colorId,
            createdAt: stamp,
            updatedAt: stamp,
            pinned: false
          };
          setNotes(function (previous) {
            return sortNotes([note].concat(previous)).slice(0, MAX_NOTES);
          });
          setDraft('');
          setColorId(nextColorId(colorId));
          // 搜索生效时新便签可能不匹配：清掉条件，保证刚贴的那条能看见。
          setQuery('');
          const scroller = scrollRef.current;
          if (scroller) scroller.scrollTop = 0;
        };

        const updateNote = function (id, patch) {
          setNotes(function (previous) {
            return previous.map(function (note) {
              if (note.id !== id) return note;
              return Object.assign({}, note, patch, { updatedAt: Date.now() });
            });
          });
        };

        const togglePin = function (id) {
          const note = notes.find(function (item) {
            return item.id === id;
          });
          if (!note) return;
          updateNote(id, { pinned: !note.pinned });
        };

        const deleteNote = function (id) {
          const target = notes.find(function (item) {
            return item.id === id;
          });
          if (!target) return;
          setNotes(function (previous) {
            return previous.filter(function (item) {
              return item.id !== id;
            });
          });
          setUndoNote(target);
        };

        const undoDelete = function () {
          const note = undoNote;
          if (!note) return;
          setUndoNote(null);
          setNotes(function (previous) {
            return sortNotes([note].concat(previous)).slice(0, MAX_NOTES);
          });
        };

        const sorted = React.useMemo(
          function () {
            return sortNotes(notes);
          },
          [notes]
        );

        const filtered = React.useMemo(
          function () {
            const needle = query.trim().toLowerCase();
            if (!needle) return sorted;
            return sorted.filter(function (note) {
              return note.text.toLowerCase().indexOf(needle) >= 0;
            });
          },
          [sorted, query]
        );

        const cards = filtered.map(function (note) {
          return h(NoteCard, {
            key: note.id,
            note: note,
            t: t,
            now: now,
            query: query,
            onEdit: function (id, text) {
              updateNote(id, { text: text });
            },
            onDelete: deleteNote,
            onTogglePin: togglePin,
            onRecolor: function (id, color) {
              updateNote(id, { color: color });
            }
          });
        });

        const searchBox =
          notes.length > 0
            ? h(
                'div',
                { className: 'nw_searchBox' },
                h('span', { className: 'nw_searchIcon' }, h(SearchGlyph)),
                h('input', {
                  className: 'nw_search',
                  type: 'text',
                  value: query,
                  placeholder: t('searchPlaceholder'),
                  'aria-label': t('searchLabel'),
                  spellCheck: false,
                  onChange: function (event) {
                    setQuery(event.target.value);
                  },
                  onKeyDown: function (event) {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setQuery('');
                    }
                  }
                }),
                query
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'nw_clearSearch',
                        title: t('searchClear'),
                        'aria-label': t('searchClear'),
                        onClick: function () {
                          setQuery('');
                        }
                      },
                      h(CrossGlyph)
                    )
                  : null
              )
            : null;

        let wall;
        if (notes.length === 0) {
          wall = h(EmptyWall, { t: t });
        } else if (filtered.length === 0) {
          wall = h(NoMatch, {
            t: t,
            onClear: function () {
              setQuery('');
            }
          });
        } else {
          wall = h('div', { className: 'nw_grid' }, cards);
        }

        const undoBar = undoNote
          ? h(
              'div',
              { className: 'nw_undo', role: 'status' },
              h('span', { className: 'nw_undoText' }, t('deleted')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'nw_undoBtn',
                  onClick: undoDelete
                },
                t('undo')
              )
            )
          : null;

        return h(
          'section',
          { className: 'nw_root', 'aria-label': t('title') },
          h(
            'header',
            { className: 'nw_header' },
            h('span', { className: 'nw_headIcon' }, h(NoteGlyph, { size: 16 })),
            h(
              'div',
              { className: 'nw_heading' },
              h('h1', { className: 'nw_title' }, t('title')),
              h('span', { className: 'nw_count' }, fill(t('count'), { n: notes.length }))
            ),
            h('span', { className: 'nw_spacer' }),
            searchBox
          ),
          h(
            'div',
            { className: 'nw_body' },
            h(Composer, {
              t: t,
              draft: draft,
              colorId: colorId,
              saveError: saveError,
              onDraftChange: setDraft,
              onColorChange: setColorId,
              onSubmit: addNote
            }),
            saveError ? h('p', { className: 'nw_warn' }, t('saveError')) : null,
            h('div', { className: 'nw_scroll', ref: scrollRef }, wall)
          ),
          undoBar
        );
      }

      const inject = ['slots', 'locale'];

      function apply(ctx) {
        ctx.effect(
          function () {
            if (typeof document === 'undefined') return function () {};
            if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') !== null) {
              return function () {};
            }
            const tag = document.createElement('style');
            tag.dataset.plugin = '@local/note-wall';
            tag.dataset.pluginCss = CSS_TAG_ID;
            tag.textContent = CSS;
            document.head.appendChild(tag);
            return function () {
              tag.remove();
            };
          },
          'note-wall: stylesheet'
        );

        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        }, 'note-wall: dictionaries');

        const t = ctx.locale.bind(NS);

        ctx.slots.inject('main', function () {
          return ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS
            },
            NoteWallPanel
          );
        });

        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 26,
              label: function () {
                return t('panel');
              },
              locale: NS
            },
            NoteGlyph
          );
        });
      }

      return {
        inject: inject,
        apply: apply,
        __test: {
          PANEL_ID: PANEL_ID,
          NS: NS,
          STORAGE_KEY: STORAGE_KEY,
          MAX_LEN: MAX_LEN,
          MAX_NOTES: MAX_NOTES,
          PALETTE: PALETTE,
          zh: zh,
          en: en,
          CSS: CSS,
          NoteWallPanel: NoteWallPanel,
          NoteGlyph: NoteGlyph,
          NoteCard: NoteCard,
          Composer: Composer,
          fill: fill,
          timeLabel: timeLabel,
          fullTime: fullTime,
          normalizeNote: normalizeNote,
          sortNotes: sortNotes,
          nextColorId: nextColorId,
          colorEntry: colorEntry,
          readNotes: readNotes,
          writeNotes: writeNotes,
          highlighted: highlighted
        }
      };
    }
  });
})();
