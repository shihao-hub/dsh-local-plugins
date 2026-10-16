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
      /** Settings namespace owned by the theme plugin whose document stores the preference. */
      const THEME_SETTINGS_NS = 'ui-theme';
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
        // Hover fill sits between --dsw-alias-bg-base (#262626) and
        // --dsw-alias-bg-module-platform (#4a4d51), so it still reads as a hover
        // on both the darker sidebar (--dsw-specific-sidebar-fill #2b2b2b) and the
        // lighter module cards: lighter on the former, darker on the latter.
        // The previous #2a2d2e was only (-1,+2,+3) away from the sidebar fill, which
        // made hover — and, because the workspace rows share this token with their
        // `selected` state, the open session too — invisible in the sidebar.
        '--dsw-alias-interactive-bg-hover': pair('#393b41'),
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
        '.rdt_switch.rdt_on .rdt_thumb{transform:translateX(16px)}',
        '.rdt_warn{color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px}'
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
        'row.disable': '停用 JetBrains Rider Dark',
        'row.lightBase':
          '当前基座是浅色（你在「外观」里选了浅色）：Rider 深色配色已自动撤下，避免深浅混搭。切回「深色」即自动恢复。',
        'row.systemBase':
          '当前基座是浅色（你在「外观」里选了「跟随系统」，而系统此刻是浅色）：Rider 深色配色已自动撤下，避免深浅混搭。切回「深色」即自动恢复。',
        'row.notSaved':
          '外观偏好写不进设置文件（正被编辑器等其它程序占用）：「外观」按钮目前无效，深色基座已由本插件在本页面维持，Rider 配色正常工作。关掉占用该文件的程序即可恢复保存。',
        'row.persistFailed':
          '外观偏好没能写入设置文件（常见原因是该文件正被编辑器等其它程序占用）：基座不是深色，配色已自动撤下，本主题暂不生效。请关闭占用该文件的程序后重新开关一次。'
      };
      const en = {
        'row.description': 'JetBrains Rider dark palette, ported from the Zed theme package',
        'row.enable': 'Enable JetBrains Rider Dark',
        'row.disable': 'Disable JetBrains Rider Dark',
        'row.lightBase':
          'The base scheme is light (you picked Light under Appearance): the Rider palette has been withdrawn so dark tokens never sit on a light base. It comes back automatically when you pick Dark again.',
        'row.systemBase':
          'The base scheme is light (you picked Follow system, and the system is light right now): the Rider palette has been withdrawn so dark tokens never sit on a light base. It comes back automatically when you pick Dark again.',
        'row.notSaved':
          'The appearance preference cannot be saved (another program holds the settings file open): the Appearance buttons have no effect for now, and this page keeps the dark base itself so the Rider palette stays correct. Close that program to get saving back.',
        'row.persistFailed':
          'The appearance preference could not be saved (usually because another program holds the settings file open): the base scheme is not dark, so the palette has been withdrawn and the theme is inactive. Close that program and toggle the switch again.'
      };

      /** Notice key to settings-row dictionary key. */
      const NOTICE_KEYS = {
        'light-base': 'row.lightBase',
        'system-base': 'row.systemBase',
        'not-saved': 'row.notSaved',
        'persist-failed': 'row.persistFailed'
      };

      /**
       * The base the user is looking at.
       *
       * The presenter's stamp wins whenever it can be read, because the runtime snapshot
       * can lag it (a preference write the Host refused leaves the runtime on a value
       * neither the settings document nor the render ever took). Without a DOM — unit-test
       * stubs, non-browser hosts — the snapshot is all there is.
       *
       * @param snapshot - theme snapshot, i.e. `theme.getTheme()`.
       * @param renderedDark - the presenter's stamp, or null when it cannot be read.
       * @returns whether the base scheme is dark.
       */
      const baseIsDark = (snapshot, renderedDark) =>
        renderedDark === null ? snapshot.active.colorScheme === 'dark' : renderedDark;

      /**
       * Why the palette is not painting normally, if it is not.
       *
       * The palette is dark-only, so it may only ride a dark base scheme (see
       * {@link reconcile}). Two situations need words, and `refused` tells them
       * apart — it is set only when a write this plugin asked for demonstrably did
       * not land:
       *
       * - not refused: the Appearance row is working and simply is not on Dark, so
       *   the palette steps aside until Dark comes back. The wording separates the
       *   two ways to get there, because "you picked Light" is wrong for someone who
       *   picked Follow system on a light system.
       * - refused: the settings document is unwritable (another program holds the
       *   file). The client maintains the dark base itself, so the palette stays
       *   correct — but every other preference in this profile is still losing
       *   writes, which the row says out loud.
       *
       * @param enabled - whether the switch is on.
       * @param refused - whether a preference write has been observed to fail.
       * @param snapshot - theme snapshot, i.e. `theme.getTheme()`.
       * @param renderedDark - the presenter's stamp, or null when it cannot be read.
       * @returns notice key to render, or null when the palette is painting normally.
       */
      const noticeFor = (enabled, refused, snapshot, renderedDark = null) => {
        if (!enabled) return null;
        const dark = baseIsDark(snapshot, renderedDark);
        if (refused) return dark ? 'not-saved' : 'persist-failed';
        if (dark) return null;
        return snapshot.preference === 'system' ? 'system-base' : 'light-base';
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
        let notice = null;
        /**
         * Set once a preference write we asked for demonstrably did not stick:
         * the Host settings document refused it (another program holds the file).
         * From then on a dark base is asserted in this client instead, so the
         * appearance row cannot bounce the user back to whatever stale durable
         * preference the document still carries.
         */
        let refused = false;
        let asserting = false;
        /**
         * A builtin preference the runtime moved to but the document does not hold
         * (yet). The document is the only place a preference can actually be stored,
         * so re-reading it shortly after is the one trustworthy way to tell a landed
         * write from a refused one — and it works no matter who asked for the write
         * (this plugin's switch or the user's own Appearance row).
         */
        let requested = null;
        let verifyTimer = null;
        let recheckTimer = null;
        /** Grace period for a write to show up in the document before judging it. */
        const VERIFY_MS = 600;
        /**
         * How long after a snapshot change to look at the painted base again.
         *
         * `theme/change` fires when the runtime's snapshot moves; the presenter stamps
         * `body[data-ds-dark-theme]` one render later. Without a second look, a base that
         * had not been painted yet could pin the palette — or the notice — to the scheme
         * the page just left.
         */
        const RECHECK_MS = 250;
        const subscribers = new Set();
        const publishState = () => {
          const state = { enabled, notice };
          for (const notify of subscribers) notify(state);
        };

        /**
         * The durable preference the settings document currently holds, or undefined
         * when that document cannot be read. Looked up instead of injected so a
         * missing settings transport degrades to "cannot judge writes" rather than
         * keeping the whole row from loading.
         */
        const documentPreference = () => {
          const forms = ctx.get('configForms');
          const host = typeof forms?.get === 'function' ? forms.get(THEME_SETTINGS_NS) : undefined;
          return host?.getSnapshot?.().value?.preference;
        };

        /**
         * The base the presenter actually stamped — the one the user is looking at.
         *
         * `theme.getTheme()` is a runtime view, and it can disagree with what is on
         * screen: a preference write the Host refused leaves the runtime on a value
         * neither the settings document nor the render ever took, so the snapshot can
         * still read `system`/light while the page is dark. The presenter stamps
         * `body[data-ds-dark-theme]` from the scheme it applied, which is the only
         * account of the base that cannot lag behind the pixels — the same attribute
         * the shiki sheet is scoped to.
         *
         * @returns true/false when the attribute can be read, null when there is no DOM
         * (unit-test stubs, non-browser hosts) — callers then fall back to the snapshot.
         */
        const renderedDarkBase = () => {
          if (typeof document === 'undefined' || document.body === null || document.body === undefined) return null;
          if (typeof document.body.hasAttribute !== 'function') return null;
          return document.body.hasAttribute('data-ds-dark-theme');
        };

        const stopVerify = () => {
          if (verifyTimer !== null) {
            window.clearTimeout(verifyTimer);
            verifyTimer = null;
          }
          requested = null;
        };

        /**
         * Note a builtin preference the runtime is on that the document does not
         * hold, and re-read the document once the write has had time to land.
         *
         * @returns The preference the document holds, or undefined when it cannot be
         * read — the caller needs the same reading to tell a fresh Appearance click
         * from the durable value coming back.
         */
        const trackWrite = (snapshot) => {
          const stored = documentPreference();
          if (stored === undefined) return stored; // nothing to judge against
          const preference = snapshot.preference;
          // A registered theme id (our own local assertion) never reaches the
          // document, so it neither confirms nor cancels a pending judgement.
          if (BUILTIN_PREFERENCES.indexOf(preference) === -1) return stored;
          if (stored === preference) {
            if (requested === preference) stopVerify(); // confirmed by the document
            return stored;
          }
          requested = preference;
          if (verifyTimer !== null) window.clearTimeout(verifyTimer);
          verifyTimer = window.setTimeout(() => {
            verifyTimer = null;
            const pending = requested;
            requested = null;
            if (pending === null || documentPreference() === pending) return; // landed
            // Never showed up in the document: the write was refused, so nothing this
            // row or the Appearance row does can be stored until the file is free.
            refused = true;
            reconcile();
          }, VERIFY_MS);
          return stored;
        };

        const mountLayer = () => {
          if (layer === null) layer = theme.overrideTokens(LAYER_SOURCE, TOKENS);
        };
        const dropLayer = () => {
          if (layer === null) return;
          layer();
          layer = null;
        };

        /**
         * Put the base on dark again — locally, with the registered theme.
         *
         * `setTheme` only reaches the settings document for a *builtin* preference
         * (`light`/`dark`/`system`); the registered `rider-dark` id is client-only,
         * so this cannot fail and cannot start a retry loop against a document that
         * just refused a write. The registered definition carries
         * `colorScheme: 'dark'`, which is what makes the presenter stamp
         * `body[data-ds-dark-theme]` and the dark base rules apply. The re-entrant
         * `theme/change` is ignored through `asserting`.
         */
        const assertDark = () => {
          if (asserting) return;
          asserting = true;
          try {
            theme.setTheme(THEME_ID);
          } finally {
            asserting = false;
          }
        };

        /**
         * Bring the override layer, the client-side dark assertion and the row's
         * notice in line with the current snapshot. Driven by `theme/change`, the
         * only moment a preference write's fate is visible: adoption either accepts
         * what we asked for or puts the old durable preference back.
         */
        const reconcile = () => {
          let snapshot = theme.getTheme();
          const stored = trackWrite(snapshot);
          // A light/system preference the document does not already hold can only be
          // the user's own newer click in the Appearance row: a refused write's
          // fallback restores the durable value, so that one never looks new. Such a
          // click is honoured even after a refusal — overriding the choice the user
          // just made is the bug this row must not reintroduce. What the refusal does
          // keep is the dark base: a preference that only came back from the document
          // is not a choice, so it never drags the palette off.
          const preference = snapshot.preference;
          const freshChoice = stored !== undefined && stored !== preference;
          const userChoice =
            (preference === 'light' || preference === 'system') && (!refused || freshChoice);
          // The base, as painted rather than as the runtime remembers it: the row must
          // never withdraw the palette — or announce a light base — while the page in
          // front of the user is dark.
          let renderedDark = renderedDarkBase();
          if (enabled && !userChoice && !baseIsDark(snapshot, renderedDark) && !asserting) {
            refused = true;
            assertDark();
            snapshot = theme.getTheme();
            // Our own assertion is not on screen yet. Judge this pass by the snapshot
            // and let the deferred re-check read the real base once it is stamped.
            renderedDark = null;
          }
          if (enabled && baseIsDark(snapshot, renderedDark)) mountLayer();
          else dropLayer();
          const next = noticeFor(enabled, refused, snapshot, renderedDark);
          if (next === notice) return;
          notice = next;
          publishState();
        };

        const previousPreference = () => {
          const previous = readStored(PREVIOUS_KEY);
          return BUILTIN_PREFERENCES.indexOf(previous) === -1 ? 'dark' : previous;
        };

        /**
         * Turn the plugin on.
         *
         * @param force - true only for an explicit switch flip. A palette can only
         * ride a dark base, so flipping the switch on asks for one; restoring the
         * stored switch position on load must NOT, because a `light` preference
         * adopted since then is the user's newer intent (picking Dark again brings
         * the palette straight back through `reconcile`).
         */
        const activate = (force) => {
          enabled = true;
          notice = null;
          const adopted = theme.getTheme().preference;
          // The durable preference is what adoption falls back to once we stop
          // being selected; a refused write leaves it in place and `reconcile`
          // asserts the dark base in this client instead of half-applying.
          if (force || adopted !== 'light') {
            theme.setTheme('dark');
            theme.setTheme(THEME_ID);
          }
          publishState();
          reconcile();
        };

        const deactivate = () => {
          enabled = false;
          notice = null;
          stopVerify();
          dropLayer();
          publishState();
          // Undo only a preference write this plugin displaced. A preference the
          // user picked in the built-in row afterwards is newer intent and must
          // win, and after a refused write there is nothing to undo (nothing ever
          // landed in the document).
          const current = theme.getTheme().preference;
          if (!refused && (current === THEME_ID || current === 'dark')) theme.setTheme(previousPreference());
        };

        const setEnabled = (on) => {
          if (on === enabled) return;
          if (on) {
            const current = theme.getTheme().preference;
            if (BUILTIN_PREFERENCES.indexOf(current) !== -1) writeStored(PREVIOUS_KEY, current);
            writeStored(ENABLED_KEY, '1');
            activate(true);
            return;
          }
          writeStored(ENABLED_KEY, null);
          deactivate();
        };

        if (enabled) activate(false);

        /**
         * One reconcile per snapshot change, rather than a verdict assumed right
         * after `activate()`: the scheme a write actually lands on is only visible
         * once adoption has run, and reading it here also withdraws the layer the
         * moment the base stops being dark.
         */
        ctx.effect(() => {
          const dispose = ctx.on('theme/change', () => {
            reconcile();
            // The presenter paints the base it applied one render after this event, so
            // judge once more after it has had a chance to catch up.
            if (recheckTimer !== null) window.clearTimeout(recheckTimer);
            recheckTimer = window.setTimeout(() => {
              recheckTimer = null;
              reconcile();
            }, RECHECK_MS);
          });
          return () => {
            if (typeof dispose === 'function') dispose();
          };
        }, 'rider-theme: appearance reconcile');

        ctx.effect(
          () => () => {
            stopVerify();
            if (recheckTimer !== null) {
              window.clearTimeout(recheckTimer);
              recheckTimer = null;
            }
            dropLayer();
          },
          'rider-theme: override layer'
        );

        function RiderRow() {
          const [state, setState] = React.useState({ enabled, notice });
          const on = state.enabled;

          React.useEffect(() => {
            const notify = (next) => setState(next);
            subscribers.add(notify);
            notify({ enabled, notice });
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
            ),
            state.notice === null
              ? null
              : h('div', { className: 'rdt_warn', role: 'status' }, t(NOTICE_KEYS[state.notice]))
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
          pair,
          noticeFor,
          NOTICE_KEYS
        }
      };
    }
  });
})();
