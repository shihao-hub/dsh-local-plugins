(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/pin-highlight',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      /**
       * The sidebar (WorkspaceBrowser) renders every session row as:
       *
       *   div[data-row-key^="session:"]            (.…_sessionRow)
       *     span.…_slot / span.…_title / span.…_time
       *     span.…_pinIndicator                    (ONLY on pinned, non-archived rows;
       *                                             CSS-module class ends in `_pinIndicator`)
       *     span.…_rowActions
       *
       * Natively the pin marker uses `color: var(--dsw-alias-label-caption)` — the
       * dimmest label tier — so pinned rows are nearly indistinguishable. This
       * plugin recolors ONLY the pin marker (per the owner's call: no bars, no
       * tints), and adds a 通用设置 row with preset swatches, a native color
       * picker, and a reset, so the hue is tunable without editing files.
       *
       * Color pipeline: the stylesheet resolves
       *   var(--dsh-pin-accent, var(--dsw-alias-state-warn-primary, #e2b341))
       * and a custom choice is applied as an inline property on <html>, which
       * beats the stylesheet without re-injection. The choice persists in
       * localStorage and is re-applied on every boot.
       *
       * DOM contract relied upon (stable across builds because CSS-module
       * classes are `<hash>_<localName>` and the local names are stable):
       *   - `data-row-key^="session:"` on the row host
       *   - a class SUFFIX `_pinIndicator` on the marker cell
       * If a future build breaks either, the plugin degrades to no-op styling;
       * it never errors.
       */

      const NS = 'pin-highlight';
      const STORE_KEY = 'pin-highlight.accent';
      const STYLE_TAG_ID = '@local/pin-highlight/rows.css';
      const DEFAULT_HEX = '#e2b341';

      /** Curated presets that hold up on both dark and light schemes. */
      const PRESETS = [
        { hex: '#e2b341', key: 'preset.amber' },
        { hex: '#5b9dd9', key: 'preset.blue' },
        { hex: '#57ab5a', key: 'preset.green' },
        { hex: '#db61a2', key: 'preset.magenta' },
        { hex: '#56d4dd', key: 'preset.cyan' }
      ];

      const ACCENT_VAR = 'var(--dsh-pin-accent, var(--dsw-alias-state-warn-primary, ' + DEFAULT_HEX + '))';

      const CSS = [
        '/* Rest state: the pin marker (caption gray -> chosen accent). */',
        'div[data-row-key^="session:"] > span[class$="_pinIndicator"] {',
        '  color: ' + ACCENT_VAR + ';',
        '}',
        '',
        '/* Hover / open-menu state: the rest-state marker is hidden and replaced by',
        '   the pin toggle button, which is a DIFFERENT node (order 200, rightmost',
        '   in row actions). Recolor it on pinned rows too, so the pin keeps its hue',
        '   instead of flipping back to the neutral icon color under the cursor. */',
        'div[data-row-key^="session:"]:has(> span[class$="_pinIndicator"]) span[class$="_rowActions"] > :last-child,',
        'div[data-row-key^="session:"]:has(> span[class$="_pinIndicator"]) span[class$="_rowActions"] > :last-child button,',
        'div[data-row-key^="session:"]:has(> span[class$="_pinIndicator"]) span[class$="_rowActions"] > :last-child svg {',
        '  color: ' + ACCENT_VAR + ';',
        '}',
        '',
        '/* Fallback hook: should another action ever take the rightmost slot, match',
        '   the unpin button by its own label instead (both shipped locales). */',
        'div[data-row-key^="session:"]:has(> span[class$="_pinIndicator"]) button[aria-label="取消置顶"],',
        'div[data-row-key^="session:"]:has(> span[class$="_pinIndicator"]) button[aria-label="Unpin session"] {',
        '  color: ' + ACCENT_VAR + ';',
        '}',
        '',
        '/* ---- 通用设置 row (php_*) ---- */',
        '.php_group{border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:8px;padding:16px 0}',
        '.php_head{display:flex;align-items:center;justify-content:space-between;gap:16px}',
        '.php_text{display:flex;flex-direction:column;gap:2px;min-width:0}',
        '.php_title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}',
        '.php_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
        '.php_controls{display:flex;align-items:center;gap:8px;flex:none}',
        '.php_swatch{box-sizing:border-box;flex:none;width:22px;height:22px;padding:0;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;cursor:pointer}',
        '.php_swatch:hover{border-color:var(--dsw-alias-border-l4)}',
        '.php_swatch.php_active{outline:2px solid var(--dsw-focus-ring-color,#3574f0);outline-offset:1px}',
        '.php_custom{position:relative;box-sizing:border-box;flex:none;width:22px;height:22px;border:1px dashed var(--dsw-alias-border-l4);border-radius:6px;overflow:hidden;cursor:pointer;background:conic-gradient(#ff5757,#ffb657,#f5f563,#63f573,#63c5f5,#a563f5,#ff5757)}',
        '.php_custom:hover{border-color:var(--dsw-alias-label-tertiary)}',
        '.php_custom input{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;opacity:0;cursor:pointer}',
        '.php_reset{flex:none;padding:2px 4px;border:0;background:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer}',
        '.php_reset:hover{color:var(--dsw-alias-label-primary)}',
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
        if (hex) document.documentElement.style.setProperty('--dsh-pin-accent', hex);
        else document.documentElement.style.removeProperty('--dsh-pin-accent');
      }

      /** The color to show as "current": the custom choice, else the theme token. */
      function effectiveAccent() {
        const stored = storedAccent();
        if (stored) return stored;
        try {
          const raw = getComputedStyle(document.documentElement)
            .getPropertyValue('--dsw-alias-state-warn-primary')
            .trim();
          if (/^#[0-9a-fA-F]{6}/.test(raw)) return raw.slice(0, 7);
        } catch {
          /* computed style unavailable: fall through to the constant */
        }
        return DEFAULT_HEX;
      }

      // ---- settings row ----------------------------------------------------

      function PinColorRow() {
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
          { className: 'php_group' },
          h(
            'div',
            { className: 'php_head' },
            h(
              'div',
              { className: 'php_text' },
              h('div', { className: 'php_title' }, t('row.title')),
              h('div', { className: 'php_desc' }, t('row.description'))
            ),
            h(
              'div',
              { className: 'php_controls' },
              PRESETS.map((p) =>
                h('button', {
                  key: p.hex,
                  type: 'button',
                  className: 'php_swatch' + (accent === p.hex ? ' php_active' : ''),
                  style: { background: p.hex },
                  title: t(p.key),
                  'aria-label': t(p.key),
                  onClick: () => choose(p.hex)
                })
              ),
              h(
                'label',
                { className: 'php_custom', title: t('custom') },
                h('input', {
                  type: 'color',
                  value: effectiveAccent(),
                  'aria-label': t('custom'),
                  onChange: (e) => choose(e.target.value)
                })
              ),
              accent
                ? h('button', { type: 'button', className: 'php_reset', onClick: () => choose('') }, t('reset'))
                : null
            )
          )
        );
      }

      const zh = {
        'row.title': '置顶图钉颜色',
        'row.description': '侧栏置顶会话图钉的颜色，改动即时生效',
        custom: '自定义颜色',
        reset: '默认',
        'preset.amber': '琥珀（默认色）',
        'preset.blue': '蓝色',
        'preset.green': '绿色',
        'preset.magenta': '玫红',
        'preset.cyan': '青色'
      };
      const en = {
        'row.title': 'Pinned-session pin color',
        'row.description': 'Color of the pin marker on pinned sidebar sessions; applies instantly',
        custom: 'Custom color',
        reset: 'Default',
        'preset.amber': 'Amber (default)',
        'preset.blue': 'Blue',
        'preset.green': 'Green',
        'preset.magenta': 'Magenta',
        'preset.cyan': 'Cyan'
      };

      // ---- wiring ----------------------------------------------------------

      const STYLE_MOUNTED = 'pin-highlight: row stylesheet';

      function start() {
        if (typeof document === 'undefined') return () => {};
        if (document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]') !== null) {
          return () => {};
        }
        const tag = document.createElement('style');
        tag.dataset.plugin = '@local/pin-highlight';
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
        }, 'pin-highlight: applied accent');
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'pin-highlight: dictionaries');
        t = ctx.locale.bind(NS);
        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'pin-highlight',
              order: 13,
              locale: NS
            },
            PinColorRow
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
          PRESETS,
          storedAccent,
          applyAccent,
          effectiveAccent
        }
      };
    }
  });
})();
