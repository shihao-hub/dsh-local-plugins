(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/active-session-highlight',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      /**
       * The sidebar (WorkspaceBrowser) renders every session row as:
       *
       *   div[data-row-key^="session:"]      (.…_sessionRow, role="treeitem")
       *     span.…_title / span.…_time / span.…_pinIndicator / span.…_rowActions
       *
       * and the OPEN session additionally carries `aria-selected="true"` — the row
       * host sets it from `selected = node.id === currentId`, on the same element
       * that owns `data-row-key`. Natively the selected state is styled as:
       *
       *   .projectRow:hover, .sessionRow:hover, .sessionRow.selected {
       *     background: var(--dsw-alias-interactive-bg-hover);
       *   }
       *
       * i.e. hover and selected share ONE token, ~6% (light) to 8% (dark) alpha.
       * Under the JetBrains Rider Dark theme that token is #2a2d2e while the
       * sidebar fill is #2b2b2b — (-1,+2,+3) apart — so "which session am I in"
       * has no visible signal at all. No token value can fix this, because the
       * two states are the same declaration; the open row needs a channel of its
       * own: an 18% tint of the theme's business hue.
       *
       * Tint only — no bar, no border (owner's call). v1 drew a 3px inset bar; the
       * row's `border-radius: var(--dsw-radius-md)` curved it into a stray "("
       * bracket, and the 18% tint already carries the row on its own.
       *
       * DOM contract relied upon (stable across builds):
       *   - `data-row-key^="session:"` on the row host (CSS-module classes are
       *     `<hash>_<localName>`; `aria-selected` is not hashed at all)
       *   - `aria-selected="true"` on the same host, only for the open session
       * If a future build breaks either, the plugin degrades to no-op styling;
       * it never errors. Search-result cards also carry `aria-selected`, but no
       * `data-row-key`, so they are deliberately outside this selector.
       *
       * Color pipeline: the stylesheet resolves
       *   var(--dsh-active-row-accent, var(--dsw-alias-state-business-primary, #4176e6))
       * so by default it follows the active theme's business accent (native dark
       * #7aaaff, light #4176e6, JetBrains Rider Dark #75beff), and a custom choice
       * is applied as an inline property on <html>, which beats the stylesheet
       * without re-injection. The choice persists in localStorage and is re-applied
       * on every boot.
       *
       * The selected-row rule deliberately does NOT consume
       * --dsw-alias-interactive-bg-hover, so the theme-side hover fix and this
       * highlight stay independent.
       */

      const NS = 'active-session-highlight';
      const STORE_KEY = 'active-session-highlight.accent';
      const STYLE_TAG_ID = '@local/active-session-highlight/rows.css';
      const DEFAULT_HEX = '#4176e6';

      /** Curated presets, the same five hues pin-highlight offers. */
      const PRESETS = [
        { hex: '#5b9dd9', key: 'preset.blue' },
        { hex: '#e2b341', key: 'preset.amber' },
        { hex: '#57ab5a', key: 'preset.green' },
        { hex: '#db61a2', key: 'preset.magenta' },
        { hex: '#56d4dd', key: 'preset.cyan' }
      ];

      const ACCENT_VAR =
        'var(--dsh-active-row-accent, var(--dsw-alias-state-business-primary, ' + DEFAULT_HEX + '))';

      const CSS = [
        '/* The open session row: an 18% accent tint, nothing else.',
        '   Specificity (0,2,1) beats the native :hover / .selected / .menuOpen rules',
        '   at (0,2,0), so the highlight neither depends on stylesheet order nor drops',
        '   back to the weak hover fill while the pointer (or the row menu) is on it. */',
        'div[data-row-key^="session:"][aria-selected="true"] {',
        '  /* Fallback for engines without color-mix(): the native "active nav item" fill. */',
        '  background: var(--dsw-specific-sidebar-nav-item-active, #43454a);',
        '  background: color-mix(in srgb, ' + ACCENT_VAR + ' 18%, transparent);',
        '  color: var(--dsw-alias-label-primary);',
        '}',
        '',
        '/* ---- 通用设置 row (ash_*) ---- */',
        '.ash_group{border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:8px;padding:16px 0}',
        '.ash_head{display:flex;align-items:center;justify-content:space-between;gap:16px}',
        '.ash_text{display:flex;flex-direction:column;gap:2px;min-width:0}',
        '.ash_title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}',
        '.ash_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
        '.ash_controls{display:flex;align-items:center;gap:8px;flex:none}',
        '.ash_swatch{box-sizing:border-box;flex:none;width:22px;height:22px;padding:0;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;cursor:pointer}',
        '.ash_swatch:hover{border-color:var(--dsw-alias-border-l4)}',
        '.ash_swatch.ash_active{outline:2px solid var(--dsw-focus-ring-color,#3574f0);outline-offset:1px}',
        '.ash_custom{position:relative;box-sizing:border-box;flex:none;width:22px;height:22px;border:1px dashed var(--dsw-alias-border-l4);border-radius:6px;overflow:hidden;cursor:pointer;background:conic-gradient(#ff5757,#ffb657,#f5f563,#63f573,#63c5f5,#a563f5,#ff5757)}',
        '.ash_custom:hover{border-color:var(--dsw-alias-label-tertiary)}',
        '.ash_custom input{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;opacity:0;cursor:pointer}',
        '.ash_reset{flex:none;padding:2px 4px;border:0;background:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer}',
        '.ash_reset:hover{color:var(--dsw-alias-label-primary)}',
        ''
      ].join('\n');

      // ---- persistence & application -------------------------------------

      function storedAccent() {
        try {
          return window.localStorage.getItem(STORE_KEY);
        } catch {
          return null;
        }
      }

      function writeStored(hex) {
        try {
          if (hex === null) window.localStorage.removeItem(STORE_KEY);
          else window.localStorage.setItem(STORE_KEY, hex);
        } catch {
          /* storage unavailable: the choice still works for this session */
        }
      }

      /** Custom choice rides an inline property on <html>: beats the stylesheet. */
      function applyAccent(hex) {
        if (typeof document === 'undefined') return;
        if (hex) document.documentElement.style.setProperty('--dsh-active-row-accent', hex);
        else document.documentElement.style.removeProperty('--dsh-active-row-accent');
      }

      /** The color to show as "current": the custom choice, else the theme token. */
      function effectiveAccent() {
        const stored = storedAccent();
        if (stored) return stored;
        try {
          const raw = getComputedStyle(document.documentElement)
            .getPropertyValue('--dsw-alias-state-business-primary')
            .trim();
          if (/^#[0-9a-fA-F]{6}/.test(raw)) return raw.slice(0, 7);
        } catch {
          /* computed style unavailable: fall through to the constant */
        }
        return DEFAULT_HEX;
      }

      // ---- settings row ----------------------------------------------------

      function ActiveRowColorRow() {
        const [accent, setAccent] = React.useState(storedAccent() || '');

        const choose = (hex) => {
          if (hex) {
            writeStored(hex);
            applyAccent(hex);
            setAccent(hex);
          } else {
            writeStored(null);
            applyAccent(null);
            setAccent('');
          }
        };

        return h(
          'div',
          { className: 'ash_group' },
          h(
            'div',
            { className: 'ash_head' },
            h(
              'div',
              { className: 'ash_text' },
              h('div', { className: 'ash_title' }, t('row.title')),
              h('div', { className: 'ash_desc' }, t('row.description'))
            ),
            h(
              'div',
              { className: 'ash_controls' },
              PRESETS.map((p) =>
                h('button', {
                  key: p.hex,
                  type: 'button',
                  className: 'ash_swatch' + (accent === p.hex ? ' ash_active' : ''),
                  style: { background: p.hex },
                  title: t(p.key),
                  'aria-label': t(p.key),
                  onClick: () => choose(p.hex)
                })
              ),
              h(
                'label',
                { className: 'ash_custom', title: t('custom') },
                h('input', {
                  type: 'color',
                  value: effectiveAccent(),
                  'aria-label': t('custom'),
                  onChange: (e) => choose(e.target.value)
                })
              ),
              accent
                ? h('button', { type: 'button', className: 'ash_reset', onClick: () => choose('') }, t('reset'))
                : null
            )
          )
        );
      }

      const zh = {
        'row.title': '当前会话高亮颜色',
        'row.description': '侧栏当前打开会话的强调条与底纹颜色，改动即时生效',
        custom: '自定义颜色',
        reset: '默认',
        'preset.blue': '蓝色',
        'preset.amber': '琥珀',
        'preset.green': '绿色',
        'preset.magenta': '玫红',
        'preset.cyan': '青色'
      };
      const en = {
        'row.title': 'Open-session highlight color',
        'row.description': 'Accent bar and tint on the open sidebar session; applies instantly',
        custom: 'Custom color',
        reset: 'Default',
        'preset.blue': 'Blue',
        'preset.amber': 'Amber',
        'preset.green': 'Green',
        'preset.magenta': 'Magenta',
        'preset.cyan': 'Cyan'
      };

      // ---- wiring ----------------------------------------------------------

      const STYLE_MOUNTED = 'active-session-highlight: row stylesheet';

      function start() {
        if (typeof document === 'undefined') return () => {};
        if (document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]') !== null) {
          return () => {};
        }
        const tag = document.createElement('style');
        tag.dataset.plugin = '@local/active-session-highlight';
        tag.dataset.pluginCss = STYLE_TAG_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }

      const inject = ['slots', 'locale'];
      let t = (key) => key;

      function apply(ctx) {
        ctx.effect(start, STYLE_MOUNTED);
        ctx.effect(() => {
          applyAccent(storedAccent());
          return () => applyAccent(null);
        }, 'active-session-highlight: applied accent');
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'active-session-highlight: dictionaries');
        t = ctx.locale.bind(NS);
        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'active-session-highlight',
              order: 14,
              locale: NS
            },
            ActiveRowColorRow
          )
        );
      }

      return {
        inject,
        apply,
        __test: {
          CSS,
          STYLE_TAG_ID,
          STORE_KEY,
          DEFAULT_HEX,
          ACCENT_VAR,
          PRESETS,
          storedAccent,
          applyAccent,
          effectiveAccent
        }
      };
    }
  });
})();
