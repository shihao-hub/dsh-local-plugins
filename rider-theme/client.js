(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/rider-theme',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      const NS = 'rider-theme';
      const THEME_ID = 'rider-dark';
      const THEME_LABEL = 'JetBrains Rider Dark';
      const LAYER_SOURCE = '@local/rider-theme';
      const ENABLED_KEY = 'rider-theme.enabled';
      const PREVIOUS_KEY = 'rider-theme.previous';
      const CSS_TAG_ID = '@local/rider-theme/row.css';
      const SHIKI_TAG_ID = '@local/rider-theme/shiki.css';
      const BUILTIN_PREFERENCES = ['light', 'dark', 'system'];

      /**
       * Token values must be a { light, dark } pair each; this theme is dark-only,
       * so both sides carry the same Rider value.
       */
      const pair = (value) => ({ light: value, dark: value });

      /**
       * Alias-token overrides for the JetBrains Rider Dark palette.
       *
       * Base palette: the Zed extension `jetbrains-rider`, file
       * themes/jetbrains-rider-dark.json. Semantics Zed does not express are
       * cross-checked against the VS Code ports `LeonYew/rider-islands-theme`
       * (Rider Islands Dark) and `muhammad-sammy/rider-theme`; where they
       * disagree with Zed, Zed wins.
       */
      const TOKENS = {
        // surfaces
        '--dsw-alias-bg-base': pair('#262626'),
        '--dsw-alias-bg-layer-1': pair('#2b2b2b'),
        '--dsw-alias-bg-layer-2': pair('#2b2b2b'),
        '--dsw-alias-bg-layer-3': pair('#2b2b2b'),
        '--dsw-alias-bg-overlay': pair('#2b2b2b'),
        '--dsw-alias-bg-module-platform': pair('#4a4d51'),
        '--dsw-alias-bg-multi-select': pair('#354f85'),
        '--dsw-alias-bg-skeleton': pair('#2a2d2e'),
        '--dsw-alias-bg-document-preview': pair('#262626'),
        '--dsw-alias-bg-document-selection': pair('#08335e'),

        // borders
        '--dsw-alias-border-l1': pair('#1c1c1c'),
        '--dsw-alias-border-l2': pair('#393b41'),
        '--dsw-alias-border-l2-darkmode-thin': pair('#393b41'),
        '--dsw-alias-border-l3': pair('#454545'),
        '--dsw-alias-border-l4': pair('#4a4d51'),
        '--dsw-alias-border-inverted': pair('#dfdfdf'),
        '--dsw-alias-border-inverted2': pair('#bdbdbd'),
        '--dsw-elevation-stroke-color': pair('#393b41'),

        // brand and links
        '--dsw-alias-brand-primary': pair('#3574f0'),
        '--dsw-alias-brand-primary-invert': pair('#ffffff'),
        '--dsw-alias-brand-primary-new-colorprimary-new-color': pair('#3574f0'),
        '--dsw-alias-brand-text': pair('#5a89da'),
        '--dsw-alias-link': pair('#5a89da'),
        '--dsw-focus-ring-color': pair('#3574f0'),

        // buttons
        '--dsw-alias-button-primary-fill': pair('#3574f0'),
        '--dsw-alias-button-primary-hover': pair('#3794ff'),
        '--dsw-alias-button-primary-dimmed': pair('#354f85'),
        '--dsw-alias-button-contrast-fill': pair('#dfdfdf'),
        '--dsw-alias-button-elevated-fill': pair('#2b2b2b'),
        '--dsw-alias-button-floating-fill': pair('#2b2b2b'),
        '--dsw-alias-button-floating-hover': pair('#2a2d2e'),
        '--dsw-alias-button-ghost-active-fill': pair('#354f85'),
        '--dsw-alias-button-ghost-active-hover': pair('#2a2d2e'),
        '--dsw-alias-button-ghost-active-border': pair('#354f85'),
        '--dsw-alias-button-info-fill': pair('#4a4d51'),
        '--dsw-alias-button-info-hover': pair('#5e5e62'),
        '--dsw-alias-button-tool-bar-fill': pair('#2b2b2b'),
        '--dsw-alias-button-tool-bar-fill-invisible': pair('#00000000'),
        '--dsw-alias-button-tool-bar-hover': pair('#2a2d2e'),

        // interactive states
        '--dsw-alias-interactive-bg-hover': pair('#2a2d2e'),
        '--dsw-alias-interactive-bg-active': pair('#4a4d51'),
        '--dsw-alias-interactive-bg-hover-accent': pair('#354f85'),
        '--dsw-alias-interactive-bg-hover-danger': pair('#94151b'),
        '--dsw-alias-interactive-bg-hover-solid': pair('#4a4d51'),

        // labels
        '--dsw-alias-label-primary': pair('#dfdfdf'),
        '--dsw-alias-label-primary-bluish': pair('#c0c0c6'),
        '--dsw-alias-label-primary-dimmed': pair('#e7e7e799'),
        '--dsw-alias-label-primary-foreground': pair('#ffffff'),
        '--dsw-alias-label-primary-inverted': pair('#262626'),
        '--dsw-alias-label-secondary': pair('#cecece'),
        '--dsw-alias-label-tertiary': pair('#858585'),
        '--dsw-alias-label-caption': pair('#858585'),
        '--dsw-alias-label-dimmed': pair('#6a6a70'),
        '--dsw-alias-label-document-preview': pair('#c0c0c6'),
        '--dsw-alias-label-shimmer': pair('#ffffff73'),
        '--dsw-alias-label-deep-diving': pair('#75beff'),
        '--dsw-alias-label-deep-diving-shimmer': pair('#75beffcc'),

        // markdown and code
        '--dsw-alias-markdown-code-block': pair('#2b2b2b'),
        '--dsw-alias-markdown-code-block-banner': pair('#323232'),
        '--dsw-alias-markdown-inline-code': pair('#424447'),
        '--dsw-alias-markdown-tag': pair('#4a4d51'),
        '--dsw-alias-markdown-citation': pair('#2a2d2e'),
        '--dsw-alias-markdown-placeholder': pair('#6a6a70'),
        '--dsw-alias-markdown-code-segment-selected': pair('#354f85'),
        '--dsw-alias-markdown-code-segment-unselected': pair('#4a4d51'),

        // diffs
        '--dsw-alias-code-diff-added': pair('#629755'),
        '--dsw-alias-code-diff-deleted': pair('#94151b'),
        '--dsw-alias-file-diff-added-bg': pair('#6297552e'),
        '--dsw-alias-file-diff-added-gutter': pair('#62975566'),
        '--dsw-alias-file-diff-added-marker': pair('#629755'),
        '--dsw-alias-file-diff-deleted-bg': pair('#94151b2e'),
        '--dsw-alias-file-diff-deleted-gutter': pair('#94151b66'),
        '--dsw-alias-file-diff-deleted-marker': pair('#94151b'),

        // menus and overlays
        '--dsw-menu-surface-fill': pair('#2b2b2b'),
        '--dsw-alias-menu-icon': pair('#cecece'),
        '--dsw-alias-menu-group-header-fill': pair('#2b2b2bf0'),
        '--dsw-specific-menu': pair('#2b2b2b'),
        '--dsw-alias-toast-bg': pair('#2b2b2b'),
        '--dsw-alias-toast-label': pair('#dfdfdf'),
        '--dsw-alias-tooltip-bg': pair('#323232'),
        '--dsw-alias-tooltip-key-bg': pair('#424447'),
        '--dsw-specific-tip': pair('#323232'),

        // sidebar and composer surfaces
        '--dsw-specific-sidebar-fill': pair('#2b2b2b'),
        '--dsw-specific-sidebar-nav-item-active': pair('#354f85'),
        '--dsw-specific-sidebar-nav-item-active-accent': pair('#3574f0'),
        '--dsw-specific-sidebar-nav-item-hover': pair('#2a2d2e'),
        '--dsw-specific-input-major': pair('#303030'),
        '--dsw-specific-login-input': pair('#303030'),
        '--dsw-specific-selector': pair('#303030'),
        '--dsw-specific-bubble': pair('#2b2b2b'),
        '--dsw-specific-bubble-highlight': pair('#323232'),
        '--dsw-alias-switch-thumb': pair('#dfdfdf'),

        // scrollbars and settings cards
        '--dsw-alias-scrollbar-bg-l1': pair('#3e3e42'),
        '--dsw-alias-scrollbar-bg-l2': pair('#4b4b4f'),
        '--dsw-alias-scrollbar-hover-l1': pair('#4b4b4f'),
        '--dsw-alias-scrollbar-hover-l2': pair('#5e5e62'),
        '--dsw-alias-settings-card-fill': pair('#2b2b2b'),
        '--dsw-alias-settings-card-stroke': pair('#393b41'),

        // states
        '--dsw-alias-state-business-primary': pair('#75beff'),
        '--dsw-alias-state-business-tertiary': pair('#75beff4d'),
        '--dsw-alias-state-error-primary': pair('#ff5647'),
        '--dsw-alias-state-error-secondary': pair('#ff5647b3'),
        '--dsw-alias-state-idle-primary': pair('#858585'),
        '--dsw-alias-state-success-primary': pair('#57965c'),
        '--dsw-alias-state-success-secondary': pair('#57965cb3'),
        '--dsw-alias-state-success-tertiary': pair('#57965c4d'),
        '--dsw-alias-state-warn-primary': pair('#c3ad5b'),
        '--dsw-alias-state-warn-secondary': pair('#c3ad5bb3'),
        '--dsw-alias-state-warn-tertiary': pair('#c3ad5b4d'),
        '--dsw-alias-state-warn-label': pair('#c3ad5b'),

        // onboarding
        '--dsw-alias-onboarding-accent': pair('#3574f0'),
        '--dsw-alias-onboarding-card-fill': pair('#2b2b2b'),
        '--dsw-alias-onboarding-checkbox-border': pair('#4a4d51'),
        '--dsw-alias-onboarding-secondary-fill': pair('#303030'),

        // turn trigger
        '--dsw-alias-turn-trigger-bg': pair('#2a2d2e'),
        '--dsw-alias-turn-trigger-bg-hover': pair('#4a4d51')
      };

      const CSS = [
        '.rdt_group{border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:8px;padding:16px 0}',
        '.rdt_head{display:flex;align-items:center;justify-content:space-between;gap:16px}',
        '.rdt_text{display:flex;flex-direction:column;gap:2px;min-width:0}',
        '.rdt_title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}',
        '.rdt_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
        '.rdt_switch{box-sizing:border-box;flex:none;width:36px;height:20px;padding:2px;border:0;border-radius:10px;background:var(--dsw-alias-border-l3);cursor:pointer;display:flex;align-items:center;transition:background .15s ease}',
        '.rdt_switch.rdt_on{background:var(--dsw-alias-brand-primary)}',
        '.rdt_switch:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:2px}',
        '.rdt_thumb{width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb);transition:transform .15s ease}',
        '.rdt_switch.rdt_on .rdt_thumb{transform:translateX(16px)}'
      ].join('');

      /**
       * Shiki syntax colours. `--shiki-*` sits outside the `--dsw-*` alias ladder
       * (ui-theme ships it as a fixed stylesheet), so it needs a sheet of its own.
       * `--shiki-foreground` / `--shiki-background` already resolve through
       * `--dsw-alias-label-primary` and `--dsw-alias-markdown-code-block` and are
       * deliberately not repeated here.
       */
      const SHIKI_CSS = [
        'body[data-ds-dark-theme]{',
        '--shiki-token-keyword:#6C95EB;',
        '--shiki-token-string:#C9A26D;',
        '--shiki-token-string-expression:#C9A26D;',
        '--shiki-token-comment:#85C46C;',
        '--shiki-token-constant:#ED94C0;',
        '--shiki-token-function:#39CC8F;',
        '--shiki-token-parameter:#bdbdbd;',
        '--shiki-token-punctuation:#bdbdbd;',
        '--shiki-token-link:#5a89da',
        '}'
      ].join('');

      /**
       * Mount one plugin-owned stylesheet for exactly the owning plugin lifetime.
       * @param ctx - owning client context.
       * @param tagId - value of the `data-plugin-css` marker used for deduplication.
       * @param css - stylesheet text.
       * @param label - effect label for diagnostics.
       */
      const mountStyle = (ctx, tagId, css, label) =>
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {};
          if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return () => {};
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/rider-theme';
          tag.dataset.pluginCss = tagId;
          tag.textContent = css;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, label);

      const zh = {
        'row.description': '来自 Zed 主题包的 JetBrains Rider 深色配色',
        'row.enable': '启用 JetBrains Rider Dark',
        'row.disable': '停用 JetBrains Rider Dark'
      };
      const en = {
        'row.description': 'JetBrains Rider dark palette, ported from the Zed theme package',
        'row.enable': 'Enable JetBrains Rider Dark',
        'row.disable': 'Disable JetBrains Rider Dark'
      };

      const inject = ['theme', 'slots', 'locale'];

      function apply(ctx) {
        const theme = ctx.theme;

        mountStyle(ctx, CSS_TAG_ID, CSS, 'rider-theme: row stylesheet');
        mountStyle(ctx, SHIKI_TAG_ID, SHIKI_CSS, 'rider-theme: shiki stylesheet');

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rider-theme: dictionaries');
        const t = ctx.locale.bind(NS);

        ctx.effect(
          () => theme.register({ id: THEME_ID, colorScheme: 'dark', tokens: TOKENS }),
          'rider-theme: registration'
        );

        const readStored = (key) => {
          try {
            return window.localStorage.getItem(key);
          } catch {
            return null;
          }
        };
        const writeStored = (key, value) => {
          try {
            if (value === null) window.localStorage.removeItem(key);
            else window.localStorage.setItem(key, value);
          } catch {
            /* storage unavailable: the switch still works for this session */
          }
        };

        /**
         * The palette rides an override layer rather than the selected theme id:
         * ThemeRuntime.adopt() re-reads the durable settings preference whenever
         * the host scope pushes, which would silently drop a `setTheme('rider-dark')`
         * selection. Override layers are keyed by source and survive adoption.
         */
        let layer = null;
        let enabled = readStored(ENABLED_KEY) === '1';
        const subscribers = new Set();
        const publishState = () => {
          for (const notify of subscribers) notify(enabled);
        };

        const previousPreference = () => {
          const previous = readStored(PREVIOUS_KEY);
          return BUILTIN_PREFERENCES.indexOf(previous) === -1 ? 'dark' : previous;
        };

        const activate = () => {
          if (layer === null) layer = theme.overrideTokens(LAYER_SOURCE, TOKENS);
          // A dark-only palette needs the dark colour scheme, and the durable
          // preference is what adoption falls back to once we stop being selected.
          theme.setTheme('dark');
          theme.setTheme(THEME_ID);
          enabled = true;
          publishState();
        };

        const deactivate = () => {
          if (layer !== null) {
            layer();
            layer = null;
          }
          theme.setTheme(previousPreference());
          enabled = false;
          publishState();
        };

        const setEnabled = (on) => {
          if (on === enabled) return;
          if (on) {
            const current = theme.getTheme().preference;
            if (BUILTIN_PREFERENCES.indexOf(current) !== -1) writeStored(PREVIOUS_KEY, current);
            writeStored(ENABLED_KEY, '1');
            activate();
            return;
          }
          writeStored(ENABLED_KEY, null);
          deactivate();
        };

        if (enabled) activate();

        ctx.effect(
          () => () => {
            if (layer === null) return;
            layer();
            layer = null;
          },
          'rider-theme: override layer'
        );

        function RiderRow() {
          const [on, setOn] = React.useState(enabled);

          React.useEffect(() => {
            const notify = (next) => setOn(next);
            subscribers.add(notify);
            setOn(enabled);
            return () => {
              subscribers.delete(notify);
            };
          }, []);

          return h(
            'div',
            { className: 'rdt_group' },
            h(
              'div',
              { className: 'rdt_head' },
              h(
                'div',
                { className: 'rdt_text' },
                h('div', { className: 'rdt_title' }, THEME_LABEL),
                h('div', { className: 'rdt_desc' }, t('row.description'))
              ),
              h(
                'button',
                {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': on,
                  'aria-label': t(on ? 'row.disable' : 'row.enable'),
                  className: on ? 'rdt_switch rdt_on' : 'rdt_switch',
                  onClick: () => setEnabled(!on)
                },
                h('span', { className: 'rdt_thumb' })
              )
            )
          );
        }

        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'rider-theme',
              order: 12,
              locale: NS
            },
            RiderRow
          )
        );
      }

      return {
        inject,
        apply,
        __test: {
          TOKENS,
          SHIKI_CSS,
          THEME_ID,
          LAYER_SOURCE,
          ENABLED_KEY,
          PREVIOUS_KEY,
          BUILTIN_PREFERENCES,
          pair
        }
      };
    }
  });
})();
