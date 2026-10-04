(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/app-restart',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      const NS = 'app-restart';
      const CSS_TAG_ID = 'app-restart-styles';
      const ROUTE = '/plugin/app-restart';

      const CSS = [
        '.rsr_wrap{align-self:center;flex:0 0 auto;display:inline-flex;margin:0 6px 0 8px}',
        '.rsr_btn{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);cursor:pointer;width:34px;height:34px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;padding:0;flex:none}',
        '.rsr_btn:hover{background:var(--dsw-alias-bg-layer-2,#2e2e2e);color:var(--dsw-alias-label-primary,#ededed)}',
        '.rsr_btn:disabled{opacity:.45;cursor:default}',
        '.rsr_spin{animation:rsr-rotate 1s linear infinite}',
        '@keyframes rsr-rotate{to{transform:rotate(360deg)}}',
        '.rsr_pop{position:fixed;left:12px;bottom:64px;z-index:2147483000;width:300px;box-sizing:border-box;background:var(--dsw-alias-bg-overlay,#2b2b2b);border:.5px solid var(--dsw-alias-border-l1,#3d3d3d);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.4);padding:12px 14px;font-family:inherit;color:var(--dsw-alias-label-primary,#ededed)}',
        '.rsr_title{margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:-.01em}',
        '.rsr_text{margin:0 0 10px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#a8a8a8)}',
        '.rsr_err{margin:0 0 10px;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-state-error-primary,#e5697a);word-break:break-word}',
        '.rsr_row{display:flex;justify-content:flex-end;align-items:center;gap:8px}',
        '.rsr_btn2{border:.5px solid var(--dsw-alias-border-l2,#4a4a4a);background:var(--dsw-alias-bg-layer-1,#242424);color:var(--dsw-alias-label-primary,#ededed);border-radius:6px;padding:4px 12px;font-size:12px;line-height:1.5;cursor:pointer}',
        '.rsr_btn2:hover{background:var(--dsw-alias-bg-layer-2,#2e2e2e)}',
        '.rsr_btn2:disabled{opacity:.5;cursor:default}',
        '.rsr_btn2.primary{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-bg-base,#141414)}',
        '.rsr_btn2.primary:hover{opacity:.92}',
        '.rsr_visuallyHidden{clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}'
      ].join('');

      /** Simplified Chinese dictionary; the key-set source of truth. */
      const zh = {
        'restartLabel': '\u91cd\u542f\u5e94\u7528',
        'restartTitle': '\u91cd\u542f DeepSeek Harness\uff1f',
        'restartBody': '\u5e94\u7528\u4e0e Host \u5c06\u9000\u51fa\u5e76\u91cd\u65b0\u542f\u52a8\uff0c\u6b63\u5728\u8fd0\u884c\u7684\u4efb\u52a1\u4f1a\u88ab\u4e2d\u65ad\uff1b\u91cd\u542f\u5b8c\u6210\u540e\u7a97\u53e3\u4f1a\u81ea\u52a8\u6062\u590d\u3002',
        'quitLabel': '\u9000\u51fa\u5e94\u7528',
        'quitTitle': '\u9000\u51fa DeepSeek Harness\uff1f',
        'quitBody': '\u5e94\u7528\u5c06\u7acb\u5373\u9000\u51fa\uff0c\u6b63\u5728\u8fd0\u884c\u7684\u4efb\u52a1\u4f1a\u88ab\u4e2d\u65ad\uff1b\u4e4b\u540e\u53ef\u4ece\u5f00\u59cb\u83dc\u5355\u6216\u684c\u9762\u56fe\u6807\u91cd\u65b0\u6253\u5f00\u3002',
        'confirm': '\u786e\u8ba4',
        'restartConfirm': '\u91cd\u542f',
        'quitConfirm': '\u9000\u51fa',
        'cancel': '\u53d6\u6d88',
        'close': '\u5173\u95ed',
        'retry': '\u91cd\u8bd5',
        'restartBusy': '\u6b63\u5728\u8bf7\u6c42\u91cd\u542f\u2026',
        'restartWaiting': '\u6b63\u5728\u91cd\u542f\uff0c\u8bf7\u7a0d\u5019\uff0c\u7a97\u53e3\u5c06\u81ea\u52a8\u6062\u590d\u3002',
        'quitBusy': '\u6b63\u5728\u8bf7\u6c42\u9000\u51fa\u2026',
        'quitWaiting': '\u6b63\u5728\u9000\u51fa\uff0c\u518d\u89c1\u3002',
        'failed': '\u8bf7\u6c42\u5931\u8d25'
      };

      /** English dictionary, checked complete against the zh key set. */
      const en = {
        'restartLabel': 'Restart app',
        'restartTitle': 'Restart DeepSeek Harness?',
        'restartBody': 'The app and its host will exit and start again. Running tasks will be interrupted; the window recovers automatically once the restart finishes.',
        'quitLabel': 'Quit app',
        'quitTitle': 'Quit DeepSeek Harness?',
        'quitBody': 'The app will exit immediately; running tasks will be interrupted. Reopen it later from the Start menu or desktop shortcut.',
        'confirm': 'Confirm',
        'restartConfirm': 'Restart',
        'quitConfirm': 'Quit',
        'cancel': 'Cancel',
        'close': 'Close',
        'retry': 'Retry',
        'restartBusy': 'Requesting restart\u2026',
        'restartWaiting': 'Restarting; the window will come back automatically.',
        'quitBusy': 'Requesting quit\u2026',
        'quitWaiting': 'Quitting. Goodbye.',
        'failed': 'Request failed'
      };

      const fallbackT = function (key) {
        const dict = typeof navigator !== 'undefined' && /^en/i.test(navigator.language || '') ? en : zh;
        return dict[key] !== undefined ? dict[key] : key;
      };

      /** Circular-arrow restart glyph. */
      function RestartGlyph(props) {
        return h(
          'svg',
          {
            className: props?.spinning ? 'rsr_spin' : undefined,
            width: 18,
            height: 18,
            viewBox: '0 0 16 16',
            fill: 'none',
            focusable: 'false',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('path', {
            d: 'M13.2 8a5.2 5.2 0 1 1-1.52-3.68',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round'
          }),
          h('path', {
            d: 'M13.4 1.6v3h-3',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round'
          })
        );
      }

      /** Power-symbol quit glyph. */
      function QuitGlyph(props) {
        return h(
          'svg',
          {
            className: props?.spinning ? 'rsr_spin' : undefined,
            width: 18,
            height: 18,
            viewBox: '0 0 16 16',
            fill: 'none',
            focusable: 'false',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('path', {
            d: 'M4 6a5 5 0 1 0 8 0',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round'
          }),
          h('path', {
            d: 'M8 2v5.2',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round'
          })
        );
      }

      async function fetchJson(path, options) {
        const res = await fetch(path, options);
        if (!res.ok) {
          let detail = '';
          try {
            const payload = await res.json();
            if (payload && typeof payload.error === 'string') detail = payload.error;
          } catch { /* body was not JSON */ }
          throw new Error(detail !== '' ? detail : path + ' -> ' + res.status);
        }
        return res.json();
      }

      /** Shared flow: token from /status, then spend it on the chosen action. */
      async function requestAction(action) {
        const status = await fetchJson(ROUTE + '/status', { method: 'GET', headers: { accept: 'application/json' } });
        if (!status || status.ok !== true || typeof status.token !== 'string') throw new Error('status payload invalid');
        if (status.supported !== true) throw new Error('\u672a\u627e\u5230\u684c\u9762\u5e94\u7528\u7236\u8fdb\u7a0b / desktop app parent not found');
        return fetchJson(ROUTE + '/' + action, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-app-restart-token': status.token },
          body: '{}'
        });
      }

      /**
       * One icon button with its own two-step confirm popover.
       * props: glyph, t, labelKey/titleKey/bodyKey/confirmKey/busyKey/waitingKey, perform.
       */
      function FlowButton(props) {
        const t = typeof props?.t === 'function' ? props.t : fallbackT;
        // idle -> confirm -> busy -> waiting; any failure settles on error.
        const [phase, setPhase] = React.useState('idle');
        const [errorMsg, setErrorMsg] = React.useState('');
        const rootRef = React.useRef(null);

        React.useEffect(() => {
          if (phase !== 'confirm') return undefined;
          const onDown = (event) => {
            if (rootRef.current !== null && !rootRef.current.contains(event.target)) setPhase('idle');
          };
          const onKey = (event) => {
            if (event.key === 'Escape') setPhase('idle');
          };
          document.addEventListener('mousedown', onDown, true);
          document.addEventListener('keydown', onKey, true);
          return () => {
            document.removeEventListener('mousedown', onDown, true);
            document.removeEventListener('keydown', onKey, true);
          };
        }, [phase]);

        const begin = React.useCallback(async () => {
          setPhase('busy');
          setErrorMsg('');
          try {
            await props.perform();
            setPhase('waiting');
          } catch (error) {
            setErrorMsg(error instanceof Error ? error.message : String(error));
            setPhase('error');
          }
        }, [props.perform]);

        const showPop = phase !== 'idle';
        const working = phase === 'busy' || phase === 'waiting';
        const Glyph = props.glyph;

        return h(
          'div',
          { ref: rootRef, className: 'rsr_wrap' },
          h(
            'button',
            {
              type: 'button',
              className: 'rsr_btn',
              onClick: () => setPhase(phase === 'confirm' || phase === 'error' ? 'idle' : 'confirm'),
              disabled: working,
              title: t(props.labelKey),
              'aria-label': t(props.labelKey),
              'aria-expanded': showPop ? 'true' : 'false'
            },
            h(Glyph, { spinning: working }),
            h('span', { className: 'rsr_visuallyHidden' }, t(props.labelKey))
          ),
          showPop
            ? h(
                'div',
                { className: 'rsr_pop', role: 'dialog', 'aria-label': t(props.titleKey) },
                phase === 'waiting'
                  ? [
                      h('p', { key: 't', className: 'rsr_title' }, t(props.titleKey)),
                      h('p', { key: 'b', className: 'rsr_text' }, t(props.waitingKey))
                    ]
                  : phase === 'busy'
                    ? [
                        h('p', { key: 't', className: 'rsr_title' }, t(props.titleKey)),
                        h('p', { key: 'b', className: 'rsr_text' }, t(props.busyKey))
                      ]
                    : [
                        h('p', { key: 't', className: 'rsr_title' }, t(props.titleKey)),
                        phase === 'error' && errorMsg !== ''
                          ? h('p', { key: 'e', className: 'rsr_err' }, t('failed') + '\uff1a' + errorMsg)
                          : h('p', { key: 'b', className: 'rsr_text' }, t(props.bodyKey)),
                        h(
                          'div',
                          { key: 'r', className: 'rsr_row' },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'rsr_btn2',
                              onClick: () => setPhase('idle')
                            },
                            phase === 'error' ? t('close') : t('cancel')
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'rsr_btn2 primary',
                              onClick: begin,
                              autoFocus: true
                            },
                            phase === 'error' ? t('retry') : t(props.confirmKey)
                          )
                        )
                      ]
              )
            : null
        );
      }

      /** The footer.action occupant: restart + quit side by side. */
      function AppControlButtons(props) {
        const t = typeof props?.t === 'function' ? props.t : fallbackT;
        const performRestart = React.useCallback(() => requestAction('restart'), []);
        const performQuit = React.useCallback(() => requestAction('quit'), []);
        return h(
          'span',
          { style: { display: 'inline-flex', alignItems: 'center' } },
          h(FlowButton, {
            key: 'restart',
            glyph: RestartGlyph,
            t,
            labelKey: 'restartLabel',
            titleKey: 'restartTitle',
            bodyKey: 'restartBody',
            confirmKey: 'restartConfirm',
            busyKey: 'restartBusy',
            waitingKey: 'restartWaiting',
            perform: performRestart
          }),
          h(FlowButton, {
            key: 'quit',
            glyph: QuitGlyph,
            t,
            labelKey: 'quitLabel',
            titleKey: 'quitTitle',
            bodyKey: 'quitBody',
            confirmKey: 'quitConfirm',
            busyKey: 'quitBusy',
            waitingKey: 'quitWaiting',
            perform: performQuit
          })
        );
      }

      const inject = ['slots', 'locale'];

      function apply(ctx) {
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {};
          if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') !== null) return () => {};
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/app-restart';
          tag.dataset.pluginCss = CSS_TAG_ID;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'app-restart: stylesheet');

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'app-restart: dictionaries');
        const t = ctx.locale.bind(NS);

        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'app-restart',
              order: 20,
              label: () => t('restartLabel'),
              locale: NS
            },
            AppControlButtons
          )
        );
      }

      return {
        inject,
        apply,
        __test: {
          AppControlButtons,
          RestartGlyph,
          QuitGlyph
        }
      };
    }
  });
})();
