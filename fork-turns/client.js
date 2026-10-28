/**
 * Client half of the fork-turns bundle.
 *
 * Two seats:
 *   - `conversation.input.right` — a compact button in the composer tool row.
 *   - `shell.overlay` — the turn picker dialog it opens.
 *
 * The picker asks the Host route for the current Session's turns, lets the
 * operator check any completed ones, and posts the selection back. On success
 * it refreshes the Session list and opens the child through `uiWorkspace`, the
 * same navigation the stock fork uses.
 *
 * Pure Client concerns stay here: no Host writes, no DOM reads outside the
 * plugin's own nodes, and every label routes through the Client locale service.
 */
(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/fork-turns',
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      const NS = 'fork-turns';
      const ROUTE = '/plugins/fork-turns';
      const CSS_ID = 'fork-turns-styles';

      /* ------------------------------------------------------------------ *
       * 字典
       * ------------------------------------------------------------------ */

      const zh = {
        'button.label': '分叉轮次',
        'button.title': '挑选几个轮次，生成只包含它们的新会话',
        'panel.title': '挑选轮次分叉',
        'panel.hint': '只把勾选的轮次带入新会话；进行中的轮次不可选。',
        'panel.empty': '这个会话还没有可选的轮次。',
        'panel.loading': '正在读取轮次…',
        'panel.retry': '重试',
        'panel.cancel': '取消',
        'panel.create': '创建分支',
        'panel.creating': '创建中…',
        'panel.selected': '已选 {n} 轮',
        'panel.selectAll': '全选',
        'panel.clear': '清空',
        'panel.close': '关闭',
        'row.open': '进行中',
        'row.noUser': '（无用户消息）',
        'row.tools': '{n} 次工具调用',
        'error.prefix': '失败：',
      };

      const en = {
        'button.label': 'Fork turns',
        'button.title': 'Pick a few turns and fork a session that contains only them',
        'panel.title': 'Fork selected turns',
        'panel.hint': 'Only the checked turns enter the new session; a running turn cannot be picked.',
        'panel.empty': 'This session has no pickable turns yet.',
        'panel.loading': 'Reading turns…',
        'panel.retry': 'Retry',
        'panel.cancel': 'Cancel',
        'panel.create': 'Create branch',
        'panel.creating': 'Creating…',
        'panel.selected': '{n} selected',
        'panel.selectAll': 'Select all',
        'panel.clear': 'Clear',
        'panel.close': 'Close',
        'row.open': 'running',
        'row.noUser': '(no user message)',
        'row.tools': '{n} tool calls',
        'error.prefix': 'Failed: ',
      };

      let T = function (key) {
        return zh[key] === undefined ? key : zh[key];
      };

      /**
       * Translate one key and interpolate a single count.
       * @param {string} key - dictionary key.
       * @param {number} [count] - value for `{n}`.
       * @returns {string} localized text.
       */
      function tf(key, count) {
        return T(key).replace('{n}', String(count ?? 0));
      }

      /* ------------------------------------------------------------------ *
       * 模块级状态
       * ------------------------------------------------------------------ */

      let view = {
        open: false,
        sessionId: null,
        title: '',
        turns: [],
        selected: new Set(),
        loading: false,
        busy: false,
        error: null,
      };

      const listeners = new Set();
      let runtime = { uiWorkspace: null, sessions: null };

      /**
       * Publish the next immutable snapshot.
       * @param {object} patch - changed fields.
       * @returns {void}
       */
      function setView(patch) {
        view = Object.assign({}, view, patch);
        for (const listener of Array.from(listeners)) listener();
      }

      /**
       * Subscribe to snapshot changes.
       * @param {() => void} listener - React invalidation callback.
       * @returns {() => void} unsubscribe.
       */
      function subscribe(listener) {
        listeners.add(listener);
        return function () {
          listeners.delete(listener);
        };
      }

      /**
       * Read the current snapshot.
       * @returns {object} snapshot.
       */
      function getView() {
        return view;
      }

      /**
       * React binding for the module store.
       * @returns {object} current snapshot.
       */
      function useView() {
        return React.useSyncExternalStore(subscribe, getView, getView);
      }

      /* ------------------------------------------------------------------ *
       * Host 路由
       * ------------------------------------------------------------------ */

      /**
       * Call one plugin route and normalize failures.
       * @param {string} path - route path.
       * @param {RequestInit} init - fetch options.
       * @returns {Promise<any>} successful body.
       */
      async function callRoute(path, init) {
        const response = await fetch(ROUTE + path, init);
        let body = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        if (!response.ok || body === null || body.ok !== true) {
          const message = body !== null && body.error !== undefined ? body.error.message : `HTTP ${response.status}`;
          throw new Error(message);
        }
        return body;
      }

      /**
       * Read the pickable turn list.
       * @param {string} sessionId - source Session.
       * @returns {Promise<{ title: string, turns: any[] }>} route payload.
       */
      function fetchTurns(sessionId) {
        return callRoute(`/turns?sessionId=${encodeURIComponent(sessionId)}`, {
          method: 'GET',
          headers: { 'x-fork-turns': '1' },
          cache: 'no-store',
        });
      }

      /**
       * Ask the Host to create the child Session.
       * @param {string} sessionId - source Session.
       * @param {number[]} turns - ascending Turn numbers.
       * @returns {Promise<{ childId: string, warning?: string }>} created child.
       */
      function postFork(sessionId, turns) {
        return callRoute('/fork', {
          method: 'POST',
          headers: { 'x-fork-turns': '1', 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, turns: turns }),
        });
      }

      /* ------------------------------------------------------------------ *
       * 动作
       * ------------------------------------------------------------------ */

      /**
       * Load turns for one Session, ignoring stale responses.
       * @param {string} sessionId - Session to read.
       * @returns {Promise<void>} completion.
       */
      async function loadTurns(sessionId) {
        setView({ loading: true, error: null });
        try {
          const body = await fetchTurns(sessionId);
          if (!view.open || view.sessionId !== sessionId) return;
          setView({
            loading: false,
            title: typeof body.title === 'string' ? body.title : '',
            turns: Array.isArray(body.turns) ? body.turns : [],
            selected: new Set(),
          });
        } catch (error) {
          if (!view.open || view.sessionId !== sessionId) return;
          setView({ loading: false, error: String(error && error.message ? error.message : error) });
        }
      }

      /**
       * Open the picker for one Session and start reading its turns.
       * @param {string} sessionId - current Session.
       * @returns {void}
       */
      function openPanel(sessionId) {
        view = {
          open: true,
          sessionId: sessionId,
          title: '',
          turns: [],
          selected: new Set(),
          loading: true,
          busy: false,
          error: null,
        };
        for (const listener of Array.from(listeners)) listener();
        void loadTurns(sessionId);
      }

      /**
       * Close the picker without discarding the last snapshot.
       * @returns {void}
       */
      function closePanel() {
        setView({ open: false, busy: false });
      }

      /**
       * Toggle one completed Turn in the selection.
       * @param {number} turn - Turn number.
       * @returns {void}
       */
      function toggleTurn(turn) {
        const entry = view.turns.find(function (candidate) {
          return candidate.turn === turn;
        });
        if (entry === undefined || entry.completed !== true) return;
        const next = new Set(view.selected);
        if (next.has(turn)) next.delete(turn);
        else next.add(turn);
        setView({ selected: next });
      }

      /**
       * Select every completed Turn, or clear the selection.
       * @param {boolean} select - true selects all completed Turns.
       * @returns {void}
       */
      function setAll(select) {
        const next = new Set();
        if (select) {
          for (const entry of view.turns) if (entry.completed === true) next.add(entry.turn);
        }
        setView({ selected: next });
      }

      /**
       * Create the child Session, refresh the catalog, and open it.
       * @returns {Promise<void>} completion.
       */
      async function createFork() {
        if (view.busy || view.selected.size === 0) return;
        const sessionId = view.sessionId;
        const turns = [...view.selected].sort(function (left, right) {
          return left - right;
        });
        setView({ busy: true, error: null });
        try {
          const body = await postFork(sessionId, turns);
          closePanel();
          if (runtime.sessions !== null && typeof runtime.sessions.refresh === 'function') {
            try {
              await runtime.sessions.refresh();
            } catch (error) {
              console.warn('fork-turns: session list refresh failed', error);
            }
          }
          if (runtime.uiWorkspace !== null && typeof runtime.uiWorkspace.openSession === 'function') {
            runtime.uiWorkspace.openSession(body.childId);
          }
        } catch (error) {
          setView({ busy: false, error: String(error && error.message ? error.message : error) });
        }
      }

      /* ------------------------------------------------------------------ *
       * 渲染
       * ------------------------------------------------------------------ */

      /**
       * Plugin mark used by the composer button.
       * @returns {any} React node.
       */
      function markIcon() {
        return h(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: 14,
            height: 14,
            fill: 'none',
            'aria-hidden': true,
            className: 'ft_btnIcon',
          },
          h('path', {
            d: 'M6 6.5v7a4.5 4.5 0 0 0 4.5 4.5H13',
            stroke: 'currentColor',
            strokeWidth: 1.7,
            strokeLinecap: 'round',
          }),
          h('circle', { cx: 6, cy: 4.5, r: 2, stroke: 'currentColor', strokeWidth: 1.7 }),
          h('path', {
            d: 'M14.4 18.1 16.5 20.2 21 15.6',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          })
        );
      }

      /**
       * Format one epoch millisecond value for the picker.
       * @param {number} value - epoch ms.
       * @returns {string} local `MM-DD HH:mm`.
       */
      function timeLabel(value) {
        if (typeof value !== 'number' || !Number.isFinite(value)) return '';
        const date = new Date(value);
        const pad = function (part) {
          return String(part).padStart(2, '0');
        };
        return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
      }

      /**
       * Composer tool-row entry.
       * @param {any} props - session scope props.
       * @returns {any} button or null.
       */
      function ForkButton(props) {
        const fromSnapshot = typeof props.useSession === 'function'
          ? props.useSession(function (snapshot) {
              return snapshot === undefined || snapshot === null ? undefined : snapshot.sessionId;
            })
          : undefined;
        const sessionId = typeof props.sessionId === 'string' && props.sessionId !== ''
          ? props.sessionId
          : typeof fromSnapshot === 'string'
            ? fromSnapshot
            : '';
        if (sessionId === '') return null;
        return h(
          'button',
          {
            type: 'button',
            className: 'ft_btn',
            title: T('button.title'),
            'aria-label': T('button.label'),
            onClick: function () {
              openPanel(sessionId);
            },
          },
          markIcon(),
          h('span', { className: 'ft_btnLabel' }, T('button.label'))
        );
      }

      /**
       * One selectable turn row.
       * @param {{ entry: any }} props - row data.
       * @returns {any} React node.
       */
      function TurnRow(props) {
        const entry = props.entry;
        const checked = view.selected.has(entry.turn);
        const disabled = entry.completed !== true;
        const meta = [];
        const when = timeLabel(entry.time);
        if (when !== '') meta.push(when);
        if (entry.toolCalls > 0) meta.push(tf('row.tools', entry.toolCalls));
        if (disabled) meta.push(T('row.open'));
        return h(
          'label',
          {
            className: 'ft_row' + (disabled ? ' ft_rowDisabled' : '') + (checked ? ' ft_rowChecked' : ''),
            onClick: function (event) {
              if (disabled) {
                event.preventDefault();
                return;
              }
            },
          },
          h('input', {
            type: 'checkbox',
            className: 'ft_check',
            checked: checked,
            disabled: disabled,
            onChange: function () {
              toggleTurn(entry.turn);
            },
          }),
          h('span', { className: 'ft_no' }, '#' + entry.turn),
          h(
            'span',
            { className: 'ft_body' },
            h('span', { className: 'ft_user' }, entry.userPreview === '' ? T('row.noUser') : entry.userPreview),
            entry.assistantPreview !== ''
              ? h('span', { className: 'ft_assistant' }, entry.assistantPreview)
              : null
          ),
          h('span', { className: 'ft_meta' }, meta.join(' · '))
        );
      }

      /**
       * Overlay picker.
       * @returns {any} React node or null.
       */
      function ForkPanel() {
        const state = useView();
        const cardRef = React.useRef(null);

        React.useEffect(
          function () {
            if (!state.open) return undefined;
            const onKey = function (event) {
              if (event.key === 'Escape') closePanel();
            };
            window.addEventListener('keydown', onKey);
            const timer = setTimeout(function () {
              if (cardRef.current !== null && typeof cardRef.current.focus === 'function') cardRef.current.focus();
            }, 0);
            return function () {
              clearTimeout(timer);
              window.removeEventListener('keydown', onKey);
            };
          },
          [state.open]
        );

        if (!state.open) return null;

        const completed = state.turns.filter(function (entry) {
          return entry.completed === true;
        });
        const selectedCount = state.selected.size;
        const allSelected = completed.length > 0 && selectedCount === completed.length;

        let body;
        if (state.loading) {
          body = h('div', { className: 'ft_state' }, T('panel.loading'));
        } else if (state.turns.length === 0) {
          body = h('div', { className: 'ft_state' }, T('panel.empty'));
        } else {
          body = h(
            'div',
            { className: 'ft_list', role: 'group', 'aria-label': T('panel.title') },
            state.turns.map(function (entry) {
              return h(TurnRow, { key: String(entry.turn), entry: entry });
            })
          );
        }

        return h(
          'div',
          {
            className: 'ft_backdrop',
            onPointerDown: function (event) {
              if (event.target === event.currentTarget) closePanel();
            },
          },
          h(
            'div',
            {
              className: 'ft_dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': T('panel.title'),
              tabIndex: -1,
              ref: cardRef,
            },
            h(
              'header',
              { className: 'ft_head' },
              h(
                'div',
                { className: 'ft_titles' },
                h('div', { className: 'ft_title' }, T('panel.title')),
                h('div', { className: 'ft_sub' }, state.title === '' ? '' : state.title)
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ft_icon',
                  title: T('panel.close'),
                  'aria-label': T('panel.close'),
                  onClick: closePanel,
                },
                '×'
              )
            ),
            h('div', { className: 'ft_hint' }, T('panel.hint')),
            body,
            state.error !== null ? h('div', { className: 'ft_error' }, T('error.prefix') + state.error) : null,
            h(
              'footer',
              { className: 'ft_foot' },
              h('span', { className: 'ft_count' }, tf('panel.selected', selectedCount)),
              h('span', { className: 'ft_grow' }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ft_link',
                  disabled: state.loading || completed.length === 0,
                  onClick: function () {
                    setAll(!allSelected);
                  },
                },
                allSelected ? T('panel.clear') : T('panel.selectAll')
              ),
              h(
                'button',
                { type: 'button', className: 'ft_ghost', onClick: closePanel },
                T('panel.cancel')
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ft_primary',
                  disabled: state.busy || selectedCount === 0,
                  onClick: function () {
                    void createFork();
                  },
                },
                state.busy ? T('panel.creating') : T('panel.create')
              )
            )
          )
        );
      }

      /* ------------------------------------------------------------------ *
       * 样式
       * ------------------------------------------------------------------ */

      const CSS = [
        '.ft_btn{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 8px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap}',
        '.ft_btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.ft_btn:focus-visible{outline:1px solid var(--dsw-alias-border-l2);outline-offset:1px}',
        '.ft_btnIcon{flex:none;display:block}',
        '.ft_btnLabel{max-width:9em;overflow:hidden;text-overflow:ellipsis}',
        '.ft_backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:10vh 16px 16px;background:rgba(0,0,0,.42);pointer-events:auto}',
        '.ft_dialog{display:flex;flex-direction:column;width:min(560px,94vw);max-height:74vh;background:var(--dsw-alias-bg-overlay);border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,.38);color:var(--dsw-alias-label-primary);font-size:var(--dsh-title-font-size,13px);overflow:hidden;outline:none}',
        '.ft_head{display:flex;align-items:flex-start;gap:10px;padding:12px 14px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}',
        '.ft_titles{flex:1;min-width:0}',
        '.ft_title{font-weight:600;font-size:14px}',
        '.ft_sub{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ft_icon{border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:4px;flex:none}',
        '.ft_icon:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.ft_hint{padding:8px 14px 4px;color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}',
        '.ft_list{overflow:auto;padding:4px 8px 8px;display:flex;flex-direction:column;gap:2px}',
        '.ft_row{display:flex;align-items:flex-start;gap:9px;padding:7px 8px;border-radius:7px;cursor:pointer;border:1px solid transparent}',
        '.ft_row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.ft_rowChecked{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l1)}',
        '.ft_rowDisabled{opacity:.5;cursor:not-allowed}',
        '.ft_rowDisabled:hover{background:0 0}',
        '.ft_check{margin:2px 0 0;flex:none;accent-color:var(--dsw-alias-brand-primary)}',
        '.ft_no{flex:none;min-width:32px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums;line-height:18px}',
        '.ft_body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
        '.ft_user{font-size:13px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.ft_assistant{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.ft_meta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;white-space:nowrap}',
        '.ft_state{padding:26px 14px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}',
        '.ft_error{margin:0 14px 6px;padding:7px 9px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:11px;flex:none}',
        '.ft_foot{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:.5px solid var(--dsw-alias-border-l1);flex:none}',
        '.ft_count{color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}',
        '.ft_grow{flex:1}',
        '.ft_link{border:0;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:3px 6px;border-radius:5px;cursor:pointer}',
        '.ft_link:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.ft_link:disabled{opacity:.45;cursor:default}',
        '.ft_ghost{border:.5px solid var(--dsw-alias-border-l1);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:5px 12px;border-radius:6px;cursor:pointer}',
        '.ft_ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.ft_primary{border:.5px solid var(--dsw-alias-brand-primary);background:0 0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;font-weight:600;padding:5px 12px;border-radius:6px;cursor:pointer}',
        '.ft_primary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
        '.ft_primary:disabled{opacity:.45;cursor:default}',
      ].join('\n');

      const inject = ['slots', 'locale', 'uiWorkspace'];

      /**
       * Install the composer entry, the overlay, dictionaries, and styles.
       * @param {any} ctx - Client plugin context.
       * @returns {void}
       */
      function apply(ctx) {
        runtime = {
          uiWorkspace: ctx.get('uiWorkspace') ?? null,
          sessions: ctx.get('sessions') ?? null,
        };

        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        }, 'fork-turns: dictionaries');

        const bound = ctx.locale.bind(NS);
        T = function (key) {
          const text = bound(key);
          if (typeof text === 'string' && text !== key) return text;
          return zh[key] === undefined ? key : zh[key];
        };

        ctx.effect(function () {
          if (typeof document === 'undefined') return function () {};
          if (document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') !== null) return function () {};
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/fork-turns';
          tag.dataset.pluginCss = CSS_ID;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return function () {
            tag.remove();
          };
        }, 'fork-turns: stylesheet');

        ctx.slots.inject('conversation.input.right', function () {
          return ctx.slots.register(
            { name: 'conversation.input.right', id: 'fork-turns', order: 40, locale: NS },
            ForkButton
          );
        });

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({ name: 'shell.overlay', id: 'fork-turns-panel', order: 70, locale: NS }, ForkPanel);
        });

        ctx.effect(function () {
          return function () {
            runtime = { uiWorkspace: null, sessions: null };
          };
        }, 'fork-turns: service handles');
      }

      return {
        inject: inject,
        apply: apply,
        __test: {
          T: function (key) {
            return T(key);
          },
          tf: tf,
          timeLabel: timeLabel,
          openPanel: openPanel,
          closePanel: closePanel,
          toggleTurn: toggleTurn,
          setAll: setAll,
          getView: getView,
          setView: setView,
          subscribe: subscribe,
        },
      };
    },
  });
})();
