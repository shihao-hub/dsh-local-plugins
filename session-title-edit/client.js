(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/session-title-edit',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      /* ==================================================================== *
       * 会话标题就地重命名
       *
       * 目标：主区顶部的会话标题不再只能去左侧栏双击改名——在这里双击标题
       * （或点标题右侧的铅笔）就地变成输入框，Enter 保存、Esc 取消。
       *
       * 宿主座位（已用 chrome-devtools 实测 ownerProps / 结构）：
       *
       *   conversation.session.header.actions   list 槽，id 必填；标准 props 自带
       *                                          sessionId / useSessions / useAccess / t
       *
       * 刻意不做：
       *   - 不 shadow `conversation.session.header`（single 槽）——那会丢掉
       *     「对话 / 轨迹」标签，因为 useConversationViews 不在标准 props 里；
       *   - 不复刻左侧会话行（宿主行组件不导出、也没有复用座位），
       *     因此主区元素不带 data-row-key、不读宿主 CSS Module 类名，
       *     pin-highlight / running-session-highlight 等侧栏插件的样式
       *     不会误套到主区标题上；
       *   - 不在插件里改写标题 DOM 文本：改名成功后由宿主的 title 投影推送刷新。
       *
       * 提交链路：`sessions.rename(sessionId, title)`（SessionManager，会顺手
       * settle 本地投影）→ 回退 `remote.session.rename({sessionId, title})`。
       * 两者都通过 `ctx.get()` 旁路解析：**绝不**写进 inject 声明，否则会卡住
       * 整个 client 启动（见 open-with-default-app 的实测记录）。
       * ==================================================================== */

      const NS = 'session-title-edit';
      const ACTIONS_SLOT = 'conversation.session.header.actions';
      /** 排在宿主内建 actions（agent-preset / job-list / subagent）前面，紧贴标题。 */
      const ORDER = -10;
      const STYLE_ID = 'session-title-edit-styles';
      const SLOT_SELECTOR = '[data-slot="' + ACTIONS_SLOT + '"]';

      const zh = {
        'action.title': '重命名会话',
        'action.aria': '重命名会话',
        'action.hint': '重命名此会话（也可双击标题）',
        'editor.label': '会话标题',
        'error.empty': '标题不能为空',
        'error.failed': '重命名失败：{message}',
        'error.unavailable': '重命名服务不可用'
      };

      const en = {
        'action.title': 'Rename session',
        'action.aria': 'Rename session',
        'action.hint': 'Rename this session (or double-click the title)',
        'editor.label': 'Session title',
        'error.empty': 'A title is required',
        'error.failed': 'Rename failed: {message}',
        'error.unavailable': 'the rename service is unavailable'
      };

      /** 与宿主 normalizeSessionTitle 同向：去控制字符、空白折叠、trim。 */
      const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

      const MIN_EDITOR_WIDTH = 140;
      const MAX_EDITOR_WIDTH = 420;
      const EDITOR_WIDTH_BONUS = 40;
      const EDITOR_MIN_HEIGHT = 28;
      const VIEWPORT_MARGIN = 8;

      // ---------------------------------------------------------------------
      // 纯函数（自测直接覆盖）
      // ---------------------------------------------------------------------

      /**
       * 宿主接受标题前会做同样的规范化；本地先做一遍只为一个目的：
       * 空白/纯控制字符不发起请求，也不让输入框“看起来存成功了”。
       */
      function normalizeDraft(raw) {
        return String(raw === null || raw === undefined ? '' : raw)
          .replace(CONTROL_CHARS, '')
          .replace(/\s+/gu, ' ')
          .trim();
      }

      /**
       * 从 actions 槽里的节点向上找到面包屑。
       *
       * 实测结构（不读哈希类名，只认 data-slot 与父子关系）：
       *   titleCluster > nav > span.crumbSeg > span.crumb  ← 标题
       *   titleCluster > div.headerActions > div[data-slot=…actions]  ← 本插件
       *
       * @param {Element|null} slotElement 槽位内任意节点（通常是本插件的按钮）
       * @returns {{ nav: Element } | null}
       */
      function resolveHeaderParts(slotElement) {
        const slotRoot =
          slotElement && typeof slotElement.closest === 'function' ? slotElement.closest(SLOT_SELECTOR) : null;
        let node = slotRoot ? slotRoot.parentElement : null;
        for (let depth = 0; node && depth < 3; depth += 1) {
          const nav = typeof node.querySelector === 'function' ? node.querySelector('nav') : null;
          if (nav) return { nav: nav };
          node = node.parentElement;
        }
        return null;
      }

      /**
       * 取面包屑最后一段（当前会话）的标题元素。
       *
       * - 正常：nav > span.crumbSeg > [span.crumbSep, span.crumb, div[data-slot=…lineage]]
       *   → 跳过 DIV（lineage 槽）与 `/` 分隔符，取最后一个非 DIV 直接子元素；
       * - ancestry 为空时宿主直接渲染 nav > span（会话 id），此时取该 span 本身。
       *
       * @param {Element|null} nav
       * @returns {Element|null}
       */
      function resolveTitleElement(nav) {
        if (!nav) return null;
        const last = nav.lastElementChild;
        if (!last) return null;
        const candidates = Array.prototype.filter.call(last.children, function (element) {
          return element.tagName !== 'DIV';
        });
        if (candidates.length === 0) return last;
        return candidates[candidates.length - 1];
      }

      /**
       * 双击是否落在“当前标题”上：祖先面包屑（button）与 lineage 槽都不算，
       * 它们有自己的跳转 / 切换语义。
       */
      function isTitleDoubleClickTarget(nav, target) {
        const title = resolveTitleElement(nav);
        if (!title || !target) return false;
        if (title === target) return true;
        return typeof title.contains === 'function' && title.contains(target);
      }

      /**
       * 编辑框几何：覆盖标题所在位置，宽度给到能看见长标题，同时不越过视口。
       * 纯函数便于在 jsdom 外直接断言。
       */
      function computeEditorBox(rect, viewport) {
        const width = Math.min(Math.max(rect.width + EDITOR_WIDTH_BONUS, MIN_EDITOR_WIDTH), MAX_EDITOR_WIDTH);
        const height = Math.max(rect.height, EDITOR_MIN_HEIGHT);
        const viewportWidth = viewport && typeof viewport.width === 'number' ? viewport.width : 0;
        const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN);
        const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), maxLeft);
        return { left: left, top: rect.top, width: width, height: height };
      }

      /** 从 Remote 失败结果里提取可读文案（兼容 `{message}` / `{code}` / 字符串）。 */
      function failureMessage(result) {
        if (!result) return '';
        const error = result.error;
        if (typeof error === 'string') return error;
        if (error && typeof error === 'object') {
          if (typeof error.message === 'string' && error.message.length > 0) return error.message;
          if (typeof error.code === 'string' && error.code.length > 0) return error.code;
        }
        return '';
      }

      function describeRenameFailure(t, result) {
        const message = failureMessage(result);
        return t('error.failed', { message: message || t('error.unavailable') });
      }

      // ---------------------------------------------------------------------
      // 宿主服务（只经 ctx.get 旁路，不写 inject）
      // ---------------------------------------------------------------------

      function readService(ctx, name) {
        try {
          return typeof ctx.get === 'function' ? ctx.get(name) : undefined;
        } catch (error) {
          return undefined;
        }
      }

      /**
       * 统一成 `{ok:true,value}` / `{ok:false,error}`。
       * 每次调用都重新解析：provider 晚于本插件就绪也能拿到。
       */
      function createRenameSession(ctx) {
        return async function renameSession(sessionId, title) {
          const sessions = readService(ctx, 'sessions');
          if (sessions && typeof sessions.rename === 'function') {
            try {
              return await sessions.rename(sessionId, title);
            } catch (error) {
              return { ok: false, error: error };
            }
          }
          const remote = readService(ctx, 'remote.session');
          if (remote && typeof remote.rename === 'function') {
            try {
              return await remote.rename({ sessionId: sessionId, title: title });
            } catch (error) {
              return { ok: false, error: error };
            }
          }
          return { ok: false, error: { message: 'rename service unavailable' } };
        };
      }

      // ---------------------------------------------------------------------
      // 样式（只用宿主设计 token；类名自带前缀，不碰宿主选择器）
      // ---------------------------------------------------------------------

      const CSS = [
        '.stse_trigger{border:none;background:0 0;padding:0 2px;height:20px;display:inline-flex;align-items:center;justify-content:center;border-radius:var(--dsw-radius-xs);color:var(--dsw-alias-label-tertiary);cursor:pointer}',
        '.stse_trigger:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.stse_trigger:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
        '.stse_editor{position:fixed;z-index:10000;box-sizing:border-box;margin:0;padding:4px 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px;outline:none}',
        '.stse_editor:focus{border-color:var(--dsw-alias-state-business-primary)}',
        '.stse_editor[data-invalid]{border-color:var(--dsw-alias-state-error-primary)}',
        '.stse_editor:disabled{color:var(--dsw-alias-label-dimmed)}',
        '.stse_error{position:fixed;z-index:10000;max-width:420px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;padding:0 2px;pointer-events:none}',
        '[data-session-title-edit] > span:last-child > span:last-of-type{visibility:hidden}',
        '[data-session-title-edit] > span:last-child:not(:has(*)){visibility:hidden}'
      ].join('\n');

      function injectStyles() {
        if (typeof document === 'undefined' || document === null || !document.head) return function () {};
        const existing = document.getElementById(STYLE_ID);
        if (existing) existing.remove();
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
        return function () {
          style.remove();
        };
      }

      const PENCIL_ICON = h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
          strokeWidth: 1
        },
        h('path', {
          d: 'M11.1 2.2a1.4 1.4 0 0 1 2 0l.7.7a1.4 1.4 0 0 1 0 2l-7.2 7.2-3.2.8.8-3.2 6.9-7.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round'
        }),
        h('path', {
          d: 'M3.5 12.5 11 5',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round'
        })
      );

      // ---------------------------------------------------------------------
      // 组件
      // ---------------------------------------------------------------------

      /**
       * 标题旁的铅笔 + 覆盖在标题上的输入框。
       *
       * props：宿主标准 props（sessionId / useSessions / useAccess / t）
       *        + 本插件槽位 inject 注入的 renameSession。
       *
       * 关于条件调用 hook：标准 props 集合在整个 entry 生命周期内固定，
       * 因此 `typeof useSessions === 'function'` 的判定不会在两次渲染间翻转。
       */
      function TitleRenameAction(props) {
        const sessionId = props.sessionId;
        const t = props.t;
        const renameSession = props.renameSession;
        const useSessions = props.useSessions;
        const useAccess = props.useAccess;

        const displayTitle =
          typeof useSessions === 'function'
            ? useSessions(function selectTitle(state) {
                const summary = state.byId[sessionId];
                return summary ? summary.displayTitle : '';
              })
            : '';

        const allowed =
          typeof useAccess === 'function'
            ? (function readAccess() {
                try {
                  return useAccess('session/rename') !== false;
                } catch (error) {
                  return true;
                }
              })()
            : true;

        const rootRef = React.useRef(null);
        const inputRef = React.useRef(null);
        const navRef = React.useRef(null);
        const composingRef = React.useRef(false);
        const skipBlurRef = React.useRef(false);
        /** 立即生效的去重闸门：同一 tick 里连按两次 Enter，state 还没刷新也只会发一次。 */
        const busyRef = React.useRef(false);

        const [editing, setEditing] = React.useState(false);
        const [draft, setDraft] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState(null);
        const [box, setBox] = React.useState(null);

        /** 最新标题：提交前用它判断“没改”，也避免闭包里的旧值。 */
        const titleRef = React.useRef(displayTitle);
        titleRef.current = displayTitle;

        const beginEdit = React.useCallback(
          function beginEdit() {
            if (!allowed) return;
            const titleElement = resolveTitleElement(navRef.current);
            const measured = titleElement || rootRef.current;
            if (!measured || typeof measured.getBoundingClientRect !== 'function') return;
            const rect = measured.getBoundingClientRect();
            setDraft(titleRef.current || '');
            setError(null);
            setBusy(false);
            setBox(
              computeEditorBox(rect, {
                width: window.innerWidth,
                height: window.innerHeight
              })
            );
            setEditing(true);
          },
          [allowed]
        );

        const closeEdit = React.useCallback(function closeEdit() {
          setEditing(false);
          setDraft('');
          setError(null);
          setBusy(false);
        }, []);

        const submit = React.useCallback(
          async function submit() {
            if (!editing || busyRef.current) return;
            const next = normalizeDraft(draft);
            if (next.length === 0) {
              setError(t('error.empty'));
              return;
            }
            if (next === titleRef.current) {
              closeEdit();
              return;
            }
            busyRef.current = true;
            setBusy(true);
            setError(null);
            try {
              let result;
              try {
                result = await renameSession(sessionId, next);
              } catch (reason) {
                result = { ok: false, error: reason };
              }
              if (result && result.ok === false) {
                setError(describeRenameFailure(t, result));
                return;
              }
              closeEdit();
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          },
          [editing, draft, sessionId, renameSession, t, closeEdit]
        );

        const cancel = React.useCallback(
          function cancel() {
            if (busyRef.current) return;
            skipBlurRef.current = true;
            closeEdit();
          },
          [closeEdit]
        );

        // 双击当前标题进入编辑。标题变化 / 切会话后重新绑定（nav 可能被替换）。
        React.useEffect(
          function bindDoubleClick() {
            if (!allowed) return undefined;
            const parts = resolveHeaderParts(rootRef.current);
            if (!parts) return undefined;
            const nav = parts.nav;
            navRef.current = nav;

            function onDoubleClick(event) {
              if (!isTitleDoubleClickTarget(nav, event.target)) return;
              event.preventDefault();
              event.stopPropagation();
              beginEdit();
            }

            nav.addEventListener('dblclick', onDoubleClick, true);
            return function () {
              nav.removeEventListener('dblclick', onDoubleClick, true);
            };
          },
          [allowed, beginEdit, sessionId, displayTitle]
        );

        // 编辑期间把原标题藏起来（视觉上就是“标题变成了输入框”）。
        React.useLayoutEffect(
          function hideNativeTitle() {
            if (!editing) return undefined;
            const nav = navRef.current;
            const title = resolveTitleElement(nav);
            if (!nav || !title) return undefined;
            const previous = title.style ? title.style.visibility : '';
            if (title.style) title.style.visibility = 'hidden';
            nav.setAttribute('data-session-title-edit', '');
            return function () {
              if (title.style) title.style.visibility = previous;
              nav.removeAttribute('data-session-title-edit');
            };
          },
          [editing, displayTitle]
        );

        // 进入编辑后聚焦并全选。
        React.useEffect(
          function focusEditor() {
            if (!editing) return;
            const input = inputRef.current;
            if (!input) return;
            input.focus();
            input.select();
          },
          [editing]
        );

        // 侧栏折叠 / 窗口缩放时，编辑框跟着标题走。
        React.useEffect(
          function trackGeometry() {
            if (!editing) return undefined;

            function measure() {
              const title = resolveTitleElement(navRef.current);
              const target = title || rootRef.current;
              if (!target || typeof target.getBoundingClientRect !== 'function') return;
              setBox(
                computeEditorBox(target.getBoundingClientRect(), {
                  width: window.innerWidth,
                  height: window.innerHeight
                })
              );
            }

            window.addEventListener('resize', measure);
            let observer;
            const anchor = navRef.current && navRef.current.parentElement;
            if (typeof ResizeObserver === 'function' && anchor) {
              observer = new ResizeObserver(measure);
              observer.observe(anchor);
            }
            return function () {
              window.removeEventListener('resize', measure);
              if (observer) observer.disconnect();
            };
          },
          [editing]
        );

        const editorStyle = box
          ? {
              left: box.left + 'px',
              top: box.top + 'px',
              width: box.width + 'px',
              height: box.height + 'px'
            }
          : undefined;

        return h(
          React.Fragment,
          null,
          allowed
            ? h(
                'button',
                {
                  ref: rootRef,
                  type: 'button',
                  className: 'stse_trigger',
                  'aria-label': t('action.aria'),
                  title: t('action.hint'),
                  onClick: beginEdit
                },
                PENCIL_ICON
              )
            : null,
          editing && box
            ? h('input', {
                ref: inputRef,
                className: 'stse_editor',
                style: editorStyle,
                value: draft,
                'aria-label': t('editor.label'),
                'aria-invalid': error ? 'true' : 'false',
                'data-invalid': error ? '' : undefined,
                spellCheck: false,
                autoComplete: 'off',
                disabled: busy,
                onChange: function (event) {
                  setDraft(event.target.value);
                  if (error) setError(null);
                },
                onKeyDown: function (event) {
                  if (event.key === 'Enter') {
                    if (composingRef.current || (event.nativeEvent && event.nativeEvent.isComposing)) return;
                    event.preventDefault();
                    void submit();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancel();
                  }
                },
                onBlur: function () {
                  if (skipBlurRef.current) {
                    skipBlurRef.current = false;
                    return;
                  }
                  if (busyRef.current) return;
                  void submit();
                },
                onCompositionStart: function () {
                  composingRef.current = true;
                },
                onCompositionEnd: function () {
                  composingRef.current = false;
                }
              })
            : null,
          editing && error && box
            ? h(
                'div',
                {
                  className: 'stse_error',
                  role: 'alert',
                  style: {
                    left: box.left + 'px',
                    top: box.top + box.height + 4 + 'px'
                  }
                },
                error
              )
            : null
        );
      }

      // ---------------------------------------------------------------------
      // 接线
      // ---------------------------------------------------------------------

      /**
       * 必需服务只有槽位与词典。`sessions` / `remote.session` 一律 `ctx.get()`
       * 旁路——写进 inject 会让整个 client 启动卡在激活闸门上。
       */
      const inject = ['slots', 'locale'];

      function apply(ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        }, NS + ': dictionaries');

        ctx.effect(injectStyles, NS + ': styles');

        const renameSession = createRenameSession(ctx);

        ctx.slots.inject(ACTIONS_SLOT, function () {
          return ctx.slots.register(
            {
              name: ACTIONS_SLOT,
              id: NS,
              order: ORDER,
              locale: NS,
              inject: function () {
                return { renameSession: renameSession };
              }
            },
            TitleRenameAction
          );
        });
      }

      return {
        inject: inject,
        apply: apply,
        __test: {
          NS: NS,
          ACTIONS_SLOT: ACTIONS_SLOT,
          ORDER: ORDER,
          STYLE_ID: STYLE_ID,
          zh: zh,
          en: en,
          normalizeDraft: normalizeDraft,
          resolveHeaderParts: resolveHeaderParts,
          resolveTitleElement: resolveTitleElement,
          isTitleDoubleClickTarget: isTitleDoubleClickTarget,
          computeEditorBox: computeEditorBox,
          describeRenameFailure: describeRenameFailure,
          createRenameSession: createRenameSession,
          TitleRenameAction: TitleRenameAction
        }
      };
    }
  });
})();
