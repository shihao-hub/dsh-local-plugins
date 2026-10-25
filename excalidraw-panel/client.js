(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/excalidraw-panel',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      const PANEL_ID = 'excalidraw-panel';
      const NS = 'excalidraw-panel';
      const CSS_TAG_ID = 'excalidraw-panel-styles';
      /** 右侧栏标签页的 kind（同时是 pane.tab / title 两个 slot 的 key）。 */
      const TAB_KIND = 'excalidraw';
      /** 画板站点；官方 excalidraw.com 的中文镜像，支持直接 iframe 嵌入。 */
      const EXCALIDRAW_URL = 'https://excalidraw.cn/';
      /** 超过该时长仍未触发 iframe load 时，给出慢加载提示。 */
      const SLOW_HINT_DELAY = 12000;

      /** Simplified Chinese dictionary; the key-set source of truth. */
      const zh = {
        panel: '画板',
        title: '画板',
        subtitle: 'Excalidraw · 自动保存到本机',
        tabTitle: '画板',
        guideTitle: 'Excalidraw 画板',
        guideDescription: '在右栏打开手绘白板，和对话同屏',
        reload: '刷新',
        reloadHint: '重新加载画板（手绘内容保存在应用本地存储中，不会丢失）',
        openExternal: '浏览器打开',
        openExternalHint: '在系统默认浏览器中打开 excalidraw.cn',
        iframeTitle: 'Excalidraw 画板',
        loading: '正在加载 Excalidraw…',
        slow: '加载较慢，请检查网络；也可点击「浏览器打开」直接访问'
      };

      /** English dictionary, checked complete against the zh key set. */
      const en = {
        panel: 'Whiteboard',
        title: 'Whiteboard',
        subtitle: 'Excalidraw · saved locally',
        tabTitle: 'Whiteboard',
        guideTitle: 'Excalidraw whiteboard',
        guideDescription: 'Open a hand-drawn whiteboard beside the conversation',
        reload: 'Reload',
        reloadHint: 'Reload the whiteboard (drawings are stored locally and kept)',
        openExternal: 'Open in browser',
        openExternalHint: 'Open excalidraw.cn in the default browser',
        iframeTitle: 'Excalidraw whiteboard',
        loading: 'Loading Excalidraw…',
        slow: 'Still loading. Check your network, or use “Open in browser”.'
      };

      /** Fallback when the host does not hand a bound translator to the panel. */
      const fallbackT = function (key) {
        const dict = typeof navigator !== 'undefined' && /^en/i.test(navigator.language || '') ? en : zh;
        return dict[key] !== undefined ? dict[key] : key;
      };

      const CSS = [
        '.exp_root,.exp_root *{box-sizing:border-box}',
        '.exp_root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-base,var(--dsh-font-family-base,sans-serif));background:var(--dsw-alias-surface-primary)}',
        '.exp_header{display:flex;align-items:center;gap:8px;padding:11px 14px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none;min-width:0}',
        '.exp_icon{display:inline-flex;align-items:center;justify-content:center;color:#4d6bfe;flex:none}',
        '.exp_title{margin:0;font-size:14px;font-weight:600;letter-spacing:-.01em;flex:none}',
        '.exp_sub{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
        '.exp_spacer{flex:1;min-width:8px}',
        '.exp_btn{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1;padding:5px 9px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;flex:none}',
        '.exp_btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}',
        '.exp_btn[data-primary="true"]{border-color:transparent;background:#4d6bfe;color:#fff}',
        '.exp_btn[data-primary="true"]:hover{background:#3f5ce0;color:#fff}',
        '.exp_frameWrap{position:relative;flex:1;min-height:0;overflow:hidden;background:#fff}',
        '.exp_frame{display:block;width:100%;height:100%;border:0;background:#fff}',
        '.exp_tabBody{position:relative;display:flex;flex:1;min-height:0;height:100%;overflow:hidden;background:#fff}',
        '.exp_tabTitle{display:block;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
        '.exp_overlay{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;text-align:center;background:var(--dsw-alias-surface-primary);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6;opacity:1;transition:opacity .2s ease;pointer-events:none}',
        '.exp_overlay[data-hidden="true"]{opacity:0}',
        '.exp_spinner{width:18px;height:18px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:#4d6bfe;animation:exp_spin .8s linear infinite;flex:none}',
        '@keyframes exp_spin{to{transform:rotate(360deg)}}',
        '@media (prefers-reduced-motion:reduce){.exp_spinner{animation-duration:1.8s}}'
      ].join('');

      /** Sidebar icon glyph (pencil over a board). */
      function ExcalidrawGlyph(props) {
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
            d: 'M2.4 13.6l.55-2.35 7.1-7.1 1.8 1.8-7.1 7.1-2.35.55z',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinejoin: 'round'
          }),
          h('path', {
            d: 'M10.05 4.15l1.8 1.8',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinecap: 'round'
          }),
          h('path', {
            d: 'M11.55 2.55c.45-.45 1.2-.45 1.65 0l.25.25c.45.45.45 1.2 0 1.65l-.95.95-1.9-1.9.95-.95z',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinejoin: 'round'
          })
        );
      }

      /** The whiteboard panel shown in the main surface. */
      function ExcalidrawPanel(props) {
        const t = typeof props?.t === 'function' ? props.t : fallbackT;
        const [nonce, setNonce] = React.useState(0);
        const [loaded, setLoaded] = React.useState(false);
        const [slow, setSlow] = React.useState(false);

        React.useEffect(() => {
          setLoaded(false);
          setSlow(false);
          const timer = window.setTimeout(() => setSlow(true), SLOW_HINT_DELAY);
          return () => window.clearTimeout(timer);
        }, [nonce]);

        const reload = () => {
          setLoaded(false);
          setSlow(false);
          setNonce((value) => value + 1);
        };

        const openExternal = () => {
          try {
            window.open(EXCALIDRAW_URL, '_blank', 'noopener,noreferrer');
          } catch {
            /* 弹窗被拦截时保持面板原状 */
          }
        };

        return h(
          'section',
          { className: 'exp_root', 'aria-label': t('title') },
          h(
            'header',
            { className: 'exp_header' },
            h('span', { className: 'exp_icon' }, h(ExcalidrawGlyph, { size: 16 })),
            h('h1', { className: 'exp_title' }, t('title')),
            h('span', { className: 'exp_sub' }, t('subtitle')),
            h('span', { className: 'exp_spacer' }),
            h(
              'button',
              {
                type: 'button',
                className: 'exp_btn',
                onClick: reload,
                title: t('reloadHint'),
                'aria-label': t('reloadHint')
              },
              t('reload')
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'exp_btn',
                'data-primary': 'true',
                onClick: openExternal,
                title: t('openExternalHint'),
                'aria-label': t('openExternalHint')
              },
              t('openExternal')
            )
          ),
          h(
            'div',
            { className: 'exp_frameWrap' },
            h('iframe', {
              key: nonce,
              className: 'exp_frame',
              src: EXCALIDRAW_URL,
              title: t('iframeTitle'),
              allow: 'clipboard-read; clipboard-write; fullscreen',
              referrerPolicy: 'strict-origin-when-cross-origin',
              onLoad: () => setLoaded(true)
            }),
            h(
              'div',
              {
                className: 'exp_overlay',
                'data-hidden': loaded ? 'true' : 'false',
                'aria-hidden': 'true'
              },
              h('span', { className: 'exp_spinner' }),
              h('span', null, slow ? t('slow') : t('loading'))
            )
          )
        );
      }

      /** Right sidebar tab body: the same board, without the main-surface header. */
      function ExcalidrawTabBody(props) {
        const t = typeof props?.t === 'function' ? props.t : fallbackT;
        const [loaded, setLoaded] = React.useState(false);
        const [slow, setSlow] = React.useState(false);

        React.useEffect(() => {
          const timer = window.setTimeout(() => setSlow(true), SLOW_HINT_DELAY);
          return () => window.clearTimeout(timer);
        }, []);

        return h(
          'div',
          { className: 'exp_tabBody' },
          h('iframe', {
            className: 'exp_frame',
            src: EXCALIDRAW_URL,
            title: t('iframeTitle'),
            allow: 'clipboard-read; clipboard-write; fullscreen',
            referrerPolicy: 'strict-origin-when-cross-origin',
            onLoad: () => setLoaded(true)
          }),
          h(
            'div',
            {
              className: 'exp_overlay',
              'data-hidden': loaded ? 'true' : 'false',
              'aria-hidden': 'true'
            },
            h('span', { className: 'exp_spinner' }),
            h('span', null, slow ? t('slow') : t('loading'))
          )
        );
      }

      /** Title chip of the right sidebar tab. */
      function ExcalidrawTabTitle(props) {
        const t = typeof props?.t === 'function' ? props.t : fallbackT;
        return h('span', { className: 'exp_tabTitle' }, t('tabTitle'));
      }

      const inject = ['slots', 'locale', 'sidebarRightTabs'];

      function apply(ctx) {
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {};
          if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') !== null) {
            return () => {};
          }
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/excalidraw-panel';
          tag.dataset.pluginCss = CSS_TAG_ID;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'excalidraw-panel: stylesheet');

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'excalidraw-panel: dictionaries');
        const t = ctx.locale.bind(NS);

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS
            },
            ExcalidrawPanel
          )
        );

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 25,
              label: () => t('panel'),
              locale: NS
            },
            ExcalidrawGlyph
          )
        );

        // 右侧栏「开始」页的快捷卡片 + 画板标签页：与对话同屏，不替换主区。
        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: PANEL_ID,
              kind: TAB_KIND,
              keepMounted: true,
              title: () => t('tabTitle'),
              guide: [
                {
                  id: 'open',
                  order: 25,
                  title: () => t('guideTitle'),
                  description: () => t('guideDescription'),
                  icon: ExcalidrawGlyph
                }
              ]
            }),
          'excalidraw-panel: right sidebar tab type'
        );

        // 右侧栏标签内容与标题按「类型 id」寻址（TabSlot 的 entryKey 取定义 id，不是 kind）。
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: PANEL_ID,
              locale: NS
            },
            ExcalidrawTabBody
          )
        );

        ctx.slots.inject('sidebar.right.pane.tab.title', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab.title',
              key: PANEL_ID,
              locale: NS
            },
            ExcalidrawTabTitle
          )
        );
      }

      return {
        inject,
        apply,
        __test: {
          ExcalidrawPanel,
          ExcalidrawGlyph,
          ExcalidrawTabBody,
          ExcalidrawTabTitle,
          EXCALIDRAW_URL,
          TAB_KIND,
          zh,
          en,
          CSS
        }
      };
    }
  });
})();
