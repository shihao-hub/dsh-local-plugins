/**
 * open-with-default-app —— 客户端半区。
 *
 * 职责：在「对话里出现的文件」上补一个**显式可见**的按钮——用系统默认应用打开
 * （Windows 走文件关联，等同于资源管理器里双击）。
 *
 * 为什么需要它（已核实的现状，见插件 README）：
 *   1. 内置 open-in-app 在交付卡片上只给一枚「小图标 + 下拉」，可发现性差；
 *   2. 内置的预览控件在 `canOpenWorkspacePath()` 每页只读一次的缓存值为 false 时
 *      **整体不渲染**（dsh-client-ui-open-in-app: FileOpenTarget `desktop !== true → null`）；
 *   3. 预览失败为 `workspace-file/not-regular-file` / `not-found` 时，内置根本不给任何
 *      动作（dsh-client-ui-sidebar-documentpreview: `emptyFailureRecourse() === 'none'`），
 *      界面只剩一句「该路径不是普通文件，没有可显示的内容」——这里必须有个按钮。
 *
 * 实现取向：**不新增宿主路由**。宿主侧的 OS 关联打开、路径校验与鉴权都已存在，
 * 直接复用客户端已生成的 session remote：
 *   - 交付卡片 / 变更对照页：走父级已鉴权路由 `props.onAction('open')`
 *     （宿主按 session 把相对路径解析成绝对路径再打开）；
 *   - 预览标题栏 / 预览空态：`remote.session.openWorkspacePath({ path })`
 *     （绝对路径，宿主校验后再交 OS 关联）。
 * 两条路都不经 shell，路径以 RPC 参数传递，无注入面，也不绕过宿主的路径校验边界。
 */
(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/open-with-default-app',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

      // ---------------------------------------------------------------------
      // 常量与开关（集中置顶）
      // ---------------------------------------------------------------------

      /** 槽位账本里的稳定 id：与内置 open-in-app 的 `open-in-app` 区分，避免占位冲突。 */
      const PLUGIN_ID = '@local/open-with-default-app';
      /** 词典命名空间。 */
      const NS = 'open-with-default-app';
      /** 右侧预览页签右键菜单槽：本插件在这里补「用默认应用打开」。 */
      const TAB_MENU_SLOT = 'sidebar.right.tab.menu.item';
      /** 页签菜单行的排序：排在内置布局动作之后。 */
      const TAB_MENU_ORDER = 10;
      /** 失败提示的停留时长（毫秒）。 */
      const TOAST_HOLD_MS = 3200;

      /** 简化中文词典（键集真源）。 */
      const zh = {
        'open.button': '用默认应用打开',
        'open.buttonShort': '打开',
        'open.menu': '用默认应用打开',
        'open.reveal': '在资源管理器中显示',
        'open.tooltip': '用系统默认应用打开（等同双击）',
        'open.tooltipNamed': '用系统默认应用打开 {name}',
        'open.failed': '打开失败：系统默认应用没有接受该路径',
        'open.failedDebug': '打开失败：{detail}',
        'open.revealFailed': '显示失败：{detail}',
        'open.unavailable': '当前宿主没有可用的桌面，无法用外部程序打开'
      };

      /** 英文词典，键与中文完全一致。 */
      const en = {
        'open.button': 'Open with default app',
        'open.buttonShort': 'Open',
        'open.menu': 'Open with default app',
        'open.reveal': 'Reveal in File Explorer',
        'open.tooltip': 'Open with the system default app (same as double-click)',
        'open.tooltipNamed': 'Open {name} with the system default app',
        'open.failed': 'Could not open: the system default app refused the path',
        'open.failedDebug': 'Could not open: {detail}',
        'open.revealFailed': 'Could not reveal: {detail}',
        'open.unavailable': 'This Host has no desktop available to open files externally'
      };

      // ---------------------------------------------------------------------
      // 纯逻辑（零框架依赖，self-test 直接覆盖）
      // ---------------------------------------------------------------------

      /** 组件兜底翻译器：拿不到宿主 `t` 时回显键名，绝不抛错。 */
      function fallbackT(key) {
        return key;
      }

      /** 从任意 slot props 里取翻译函数（宿主通过 `locale: NS` 注入）。 */
      function translatorIn(props) {
        return props !== null && props !== undefined && typeof props.t === 'function' ? props.t : fallbackT;
      }

      /** 取路径末段作为显示名（两种分隔符都认，忽略尾部分隔符）。 */
      function fileLabelOf(path) {
        if (typeof path !== 'string') return '';
        const trimmed = path.replace(/[\\/]+$/, '');
        const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
        return cut < 0 ? trimmed : trimmed.slice(cut + 1);
      }

      /**
       * session remote 的请求载荷：只带 `path`。
       * 刻意不带 `action` / `application` —— 不传 application 才是「OS 关联 = 默认应用」。
       */
      function openRequestPayload(path) {
        return { path };
      }

      /** 在系统文件管理器中定位该路径的请求载荷（宿主 reveal 分支：`/select,<path>`）。 */
      function revealRequestPayload(path) {
        return { path, action: 'reveal' };
      }

      /**
       * 从任意宿主失败对象里抽一条可读的诊断（RemoteError / Error / 其它一律兜底）。
       * 必须永远返回非空串：否则用户只会看到「没有接受该路径」这种无从下手的泛化文案，
       * 真正的失败码（gateway/bad-request、gateway/internal、TypeError 的 "session.openWorkspacePath
       * is not a function" 等）就全被吞掉了。
       */
      function describeFailure(reason) {
        if (typeof reason === 'string') return reason;
        if (reason === null || typeof reason !== 'object') return String(reason);
        const code = typeof reason.code === 'string' ? reason.code : '';
        const message = typeof reason.message === 'string' ? reason.message : '';
        if (code !== '' && message !== '') return code + ': ' + message;
        if (message !== '') return message;
        if (code !== '') return code;
        try {
          const json = JSON.stringify(reason);
          if (typeof json === 'string' && json !== '{}') return json;
        } catch (error) {
          /* 循环引用等，落到兜底的构造名 */
        }
        return Object.prototype.toString.call(reason);
      }

      /** 单飞闸门：同一控件在一次请求飞行期间，重复点击只发一次。 */
      function createSingleFlight() {
        let inFlight = false;
        return async function run(task) {
          if (inFlight) return false;
          inFlight = true;
          try {
            await task();
            return true;
          } finally {
            inFlight = false;
          }
        };
      }

      /**
       * 用默认应用打开一个绝对路径。
       * @param session session remote（命名空间服务；缺失时按失败处理）
       * @param path 绝对路径
       * @param onFailure 可选：把「为什么失败」交给调用方（用于把真实失败码放进提示条）
       * @returns 宿主确认打开为 true；服务缺失 / 信封 ok:false / 抛错一律 false（调用方据此提示）
       */
      async function requestDefaultOpen(session, path, onFailure) {
        const report = typeof onFailure === 'function' ? onFailure : () => {};
        if (session === null || session === undefined || typeof session.openWorkspacePath !== 'function') {
          report('session remote unavailable');
          return false;
        }
        try {
          const result = await session.openWorkspacePath(openRequestPayload(path));
          if (result === null || result === undefined) {
            report('empty RemoteResult');
            return false;
          }
          if (result.ok === true) return true;
          report(result.error === undefined ? 'RemoteResult ok:false without error' : result.error);
          return false;
        } catch (error) {
          report(error);
          return false;
        }
      }

      /**
       * 在系统文件管理器中定位该路径（宿主 reveal 分支 → Explorer `/select,`）。
       * 与 {@link requestDefaultOpen} 同构：失败把原因交给调用方，绝不静默。
       */
      async function requestReveal(session, path, onFailure) {
        const report = typeof onFailure === 'function' ? onFailure : () => {};
        if (session === null || session === undefined || typeof session.openWorkspacePath !== 'function') {
          report('session remote unavailable');
          return false;
        }
        try {
          const result = await session.openWorkspacePath(revealRequestPayload(path));
          if (result === null || result === undefined) {
            report('empty RemoteResult');
            return false;
          }
          if (result.ok === true) return true;
          report(result.error === undefined ? 'RemoteResult ok:false without error' : result.error);
          return false;
        } catch (error) {
          report(error);
          return false;
        }
      }

      // ---------------------------------------------------------------------
      // primitives 兜底：任一基座件缺失时退化成原生元素，绝不让宿主版本差异变成白屏
      // ---------------------------------------------------------------------

      const PrimButton = typeof primitives.Button === 'function' ? primitives.Button : null;
      const PrimTooltip = typeof primitives.Tooltip === 'function' ? primitives.Tooltip : null;
      const PrimToast = typeof primitives.Toast === 'function' ? primitives.Toast : null;
      const PrimMenuItemButton = typeof primitives.MenuItemButton === 'function' ? primitives.MenuItemButton : null;
      const PrimMenu = typeof primitives.Menu === 'function' ? primitives.Menu : null;
      const OpenIcon = typeof primitives.IconRightUpOutlineRegular === 'function' ? primitives.IconRightUpOutlineRegular : null;
      const FolderIcon = typeof primitives.IconFolderOpenOutlineRegular === 'function' ? primitives.IconFolderOpenOutlineRegular : null;
      const WarnIcon = typeof primitives.IconWarningOutlineRegular === 'function' ? primitives.IconWarningOutlineRegular : null;

      /** 渲染一枚按钮：有 primitives.Button 就用它（带图标/尺寸/变体），否则退化成原生 button。 */
      function renderButton(nodeProps, children) {
        if (PrimButton !== null) return h(PrimButton, nodeProps, children);
        const icon = nodeProps.icon;
        const rest = Object.assign({}, nodeProps);
        delete rest.variant;
        delete rest.size;
        delete rest.icon;
        rest.type = 'button';
        return h('button', rest, icon, children);
      }

      /** 图标节点：图标缺失时返回 null（按钮仍带文字，语义不丢）。 */
      function iconNode(Icon, size) {
        return Icon === null ? null : h(Icon, { size });
      }

      /** 用 Tooltip 包住按钮；Tooltip 缺失时直接返回按钮。 */
      function withTooltip(label, node) {
        if (PrimTooltip === null) return node;
        return h(PrimTooltip, { label, side: 'bottom', delayMs: 400, maxWidth: 260 }, node);
      }

      /** 瞬时提示条；Toast 缺失时退化成行内 role=status 文本。 */
      function toastNode(key, text, onDone) {
        if (PrimToast === null) return h('span', { key, role: 'status' }, text);
        return h(PrimToast, { key, text, icon: iconNode(WarnIcon, 16), holdMs: TOAST_HOLD_MS, onDone });
      }

      /** 失败提示的挂载状态：每次 show 都换 key 重放动画，与内置 useOpenFailureToast 同思路。 */
      function useFailureToast() {
        const [sequence, setSequence] = React.useState(0);
        const [text, setText] = React.useState('');
        const show = React.useCallback((message) => {
          setText(message);
          setSequence((value) => value + 1);
        }, []);
        const clear = React.useCallback(() => {
          setText('');
        }, []);
        return { text, sequence, show, clear };
      }

      /**
       * 从槽位 props 里安全取「该页签文件在 Host 上的绝对路径」。
       *
       * 两个来源（都来自宿主，插件自己不做任何路径拼接）：
       *   1. `useResource(tab.contentId)` —— 与预览正文读的是同一份元数据资源
       *      （宿主 ui-sidebar-documentpreview 就是 `useResource(tab.contentId).value?.absolutePath`）；
       *   2. 已注入的 `props.absolutePath`（页签动作槽的既有契约，预览标题栏/空态都靠它）。
       * 任一步缺失或抛错都返回空串，由调用方决定隐藏还是禁用。
       */
      function tabFilePathOf(props) {
        if (props === null || props === undefined) return '';
        if (typeof props.absolutePath === 'string' && props.absolutePath !== '') return props.absolutePath;
        const useResource = props.useResource;
        const tab = props.tab;
        if (typeof useResource !== 'function' || tab === null || tab === undefined || typeof tab.contentId !== 'string') return '';
        let value;
        try {
          value = useResource(tab.contentId);
        } catch (error) {
          return '';
        }
        const absolutePath = value !== null && value !== undefined && value.value !== null && value.value !== undefined ? value.value.absolutePath : undefined;
        return typeof absolutePath === 'string' ? absolutePath : '';
      }

      /**
       * 页签菜单行的失败提示中转站。
       *
       * 菜单行点完就 `dismiss()` 关菜单，行本身也随之卸载，行内 state 里的提示条会被一起
       * 卸载掉。因此提示条状态按页签存在模块级注册表里，由同槽位里**独立的** Toast 承载。
       */
      const menuFailureSpine = (() => {
        const subscribers = new Map();
        return {
          subscribe(id, listener) {
            subscribers.set(id, listener);
            return () => {
              subscribers.delete(id);
            };
          },
          publish(id, reason) {
            const message = reason === undefined ? '' : describeFailure(reason);
            for (const [key, listener] of subscribers) {
              // 只通知发起的那条行；其余行的 Toast 保持空闲
              if (key !== id) listener('', 0);
            }
            const own = subscribers.get(id);
            if (own !== undefined) own(message, Date.now());
          }
        };
      })();

      /** 订阅本页签的失败提示状态。 */
      function useMenuFailure(id) {
        const [state, setState] = React.useState({ text: '', nonce: 0 });
        React.useEffect(() => menuFailureSpine.subscribe(id, (text, nonce) => setState({ text, nonce })), [id]);
        const clear = React.useCallback(() => setState((current) => (current.text === '' ? current : { text: '', nonce: current.nonce })), []);
        return { text: state.text, nonce: state.nonce, clear };
      }

      // ---------------------------------------------------------------------
      // 组件
      // ---------------------------------------------------------------------

      /**
       * 预览**空态**（格式不支持 / 内容过大）的入口。
       *
       * 只保留空态这一个按钮：那种页面上正文区什么都没有，是整个预览里唯一的出口，值得占一块位置；
       * 标题栏按钮与交付卡片按钮已按「右键路径为准」的取向撤掉（见 README 的入口清单）。
       *
       * props 契约（宿主 ui-sidebar-documentpreview 提供）：`{ absolutePath }`；
       * 本插件经槽位 `inject` 追加 `openWithDefaultApp(path) => Promise<boolean>`，
       * 宿主未提供 session remote 时该函数缺省，组件整块不渲染（不给死按钮）。
       */
      function EmptyOpenButton(props) {
        const t = translatorIn(props);
        const path = tabFilePathOf(props);
        const open = props !== null && props !== undefined && typeof props.openWithDefaultApp === 'function' ? props.openWithDefaultApp : null;
        const gateRef = React.useRef(null);
        if (gateRef.current === null) gateRef.current = createSingleFlight();
        const [busy, setBusy] = React.useState(false);
        const failure = useFailureToast();
        if (path === '' || open === null) return null;
        const name = fileLabelOf(path);
        const tooltipLabel = name === '' ? t('open.tooltip') : t('open.tooltipNamed', { name });
        const label = t('open.button');
        const onClick = () => {
          if (busy) return;
          setBusy(true);
          gateRef
            .current(async () => {
              const ok = await open(path);
              if (!ok) failure.show(t('open.failed'));
            })
            .catch((error) => {
              // 走到这里说明 open(path) 自身抛错（例如 session remote 解析失败）：
              // 必须把真实原因写进提示条与控制台，否则只剩一句无从下手的泛化文案。
              const detail = describeFailure(error);
              console.warn('[open-with-default-app] empty-state open failed:', detail, error);
              failure.show(t('open.failedDebug', { detail }));
            })
            .finally(() => {
              setBusy(false);
            });
        };
        const button = renderButton(
          {
            variant: 'outline',
            size: 'md',
            icon: iconNode(OpenIcon, 18),
            disabled: busy,
            'data-open-with-default-app': 'empty',
            'aria-label': tooltipLabel,
            onClick
          },
          label
        );
        return h(
          React.Fragment,
          null,
          withTooltip(tooltipLabel, button),
          failure.text === '' ? null : toastNode(failure.sequence, failure.text, failure.clear)
        );
      }

      /**
       * 预览页签右键菜单里的一行：「用默认应用打开」。
       *
       * props 契约（宿主 ui-sidebar-right 的 `sidebar.right.tab.menu.item`，kind=list / scope=session）：
       *   tab      被打开菜单的页签记录（`contentId` 即该文件的资源地址）
       *   dismiss  关闭菜单——**执行动作的行必须调用**（菜单是宿主的，只有它自己的动作会自动关）
       *   其余为标准 kit：`t`（本插件词典已由 locale 绑定）、`useResource` 等
       *
       * 可见性由这一行自己判断（槽的契约就是「条目自行决定可见性」）：**不是文件资源的页签
       * （终端 / 首页 / 目录浏览等）整行不渲染**——在右键菜单里挂一条灰死项比没有更困惑；
       * 只有 opener 缺失（宿主没有 session remote）时才退化成禁用行，让「按钮在但没有桌面可用」
       * 这件事仍然可见。
       */
      function MenuOpenButton(props) {
        const t = translatorIn(props);
        const path = tabFilePathOf(props);
        const open = props !== null && props !== undefined && typeof props.openWithDefaultApp === 'function' ? props.openWithDefaultApp : null;
        const dismiss = props !== null && props !== undefined && typeof props.dismiss === 'function' ? props.dismiss : () => {};
        const tabId = props !== null && props !== undefined && props.tab !== null && props.tab !== undefined ? String(props.tab.id) : '';
        const gateRef = React.useRef(null);
        if (gateRef.current === null) gateRef.current = createSingleFlight();
        if (path === '') return null;
        const onClick = () => {
          dismiss();
          if (open === null) return;
          gateRef
            .current(async () => {
              const ok = await open(path);
              if (!ok) menuFailureSpine.publish(tabId, t('open.failed'));
            })
            .catch((error) => {
              const detail = describeFailure(error);
              console.warn('[open-with-default-app] tab menu open failed:', detail, error);
              menuFailureSpine.publish(tabId, t('open.failedDebug', { detail }));
            });
        };
        if (PrimMenuItemButton === null) {
          return h('button', { type: 'button', role: 'menuitem', disabled: open === null, onClick }, t('open.menu'));
        }
        return h(
          PrimMenuItemButton,
          {
            icon: iconNode(OpenIcon, 14),
            disabled: open === null,
            onSelect: onClick
          },
          t('open.menu')
        );
      }

      /**
       * 行失败时的提示条载体：与菜单行同槽位注册。
       *
       * 宿主对菜单行只渲染被打开的那一条，所以这里渲染的 Toast 只在**本页签的行刚失败过**
       * 才有文字；菜单行已 `dismiss()` 卸载，提示条仍留在页面上，不会跟着菜单一起消失。
       */
      function MenuFailureToast(props) {
        const id = props !== null && props !== undefined && props.tab !== null && props.tab !== undefined ? props.tab.id : '';
        const failure = useMenuFailure(id);
        if (failure.text === '') return null;
        return toastNode(failure.nonce, failure.text, failure.clear);
      }

      /** 预览头部那行路径的标记：宿主 `PathLabel` 自己带 `data-path-label`，预览头部再加 `data-textpreview-path`。 */
      const PATH_LABEL_SELECTOR = '[data-textpreview-path],[data-path-label]';
      /** 预览容器的资源地址属性（宿主 `data-textpreview-url` = `dsh-resource://file/session/<sid>/<path>`）。 */
      const PREVIEW_URL_SELECTOR = '[data-textpreview-url]';
      /** 注入样式表 id（只放 cursor / 宽度两条声明，可重复注入，宿主不认识它）。 */
      const HINT_STYLE_ID = 'open-with-default-app-path-hint';

      /**
       * 从宿主资源地址里读出 Host 路径（`title` 取不到时的兜底来源）。
       * 只认 `dsh-resource://file/session/<sid>/<path>`：去掉 query/fragment，逐段解码。
       * @returns 路径字符串，格式不认识时返回空串。
       */
      function filePathFromResourceUrl(url) {
        const prefix = 'dsh-resource://file/session/';
        if (typeof url !== 'string' || !url.startsWith(prefix)) return '';
        const end = url.search(/[?#]/);
        const segments = url.slice(prefix.length, end === -1 ? undefined : end).split('/');
        const path = segments.slice(1).join('/');
        if (path === '') return '';
        try {
          return path
            .split('/')
            .map((segment) => decodeURIComponent(segment))
            .join('/');
        } catch (error) {
          return path;
        }
      }

      /**
       * 预览头部**路径文本**的右键菜单（本插件最贴手的入口）。
       *
       * 为什么用全局监听而不是给路径元素挂 `onContextMenu`：那行路径是宿主
       * ui-sidebar-documentpreview 渲染的（`primitives.PathLabel`），插件改不了它的 JSX，
       * 也没有对应的槽位。所以这里用**捕获阶段**的 `contextmenu` 委托：命中路径元素就
       * `preventDefault()` 接管，再用 `primitives.Menu` 的 portal 模式（`getAnchorRect`）
       * 把菜单摆到指针位置——与在资源管理器里右键一个文件是同一手感。
       *
       * 路径取自被点元素的 `title`（`PathLabel` 恒设 `title = 完整路径`），所以右键哪个文件
       * 就用哪个路径，不依赖任何脆弱的跨组件状态；动作由本插件槽位 inject 提供的
       * `hostFileActions.open/reveal` 执行，返回值里的 `reason` 直接进提示条。
       * `primitives.Menu` 缺失时整个组件不渲染（宁可不给，也不给一个假菜单）。
       */
      function PathContextMenu(props) {
        const t = translatorIn(props);
        const [anchorRect, setAnchorRect] = React.useState(null);
        const [openedPath, setOpenedPath] = React.useState('');
        const actions = props !== null && props !== undefined && props.hostFileActions !== null && typeof props.hostFileActions === 'object' ? props.hostFileActions : null;
        const failure = useFailureToast();
        // 监听器只读最新的 actions：用 ref 拿，避免每次渲染重挂 document 监听
        const actionsRef = React.useRef(actions);
        actionsRef.current = actions;

        React.useEffect(() => {
          const resolvePath = (label) => {
            // 主来源：PathLabel 的 title 就是完整路径；
            // 取不到时退回预览容器的资源地址（data-textpreview-url）。
            const title = typeof label.getAttribute === 'function' ? label.getAttribute('title') : '';
            if (typeof title === 'string' && title !== '') return title;
            const preview = typeof label.closest === 'function' ? label.closest(PREVIEW_URL_SELECTOR) : null;
            return preview === null || typeof preview.getAttribute !== 'function' ? '' : filePathFromResourceUrl(preview.getAttribute('data-textpreview-url'));
          };
          const onContextMenu = (event) => {
            const target = event.target;
            if (target === null || typeof target.closest !== 'function') return;
            const label = target.closest(PATH_LABEL_SELECTOR);
            if (label === null) return;
            const path = resolvePath(label);
            if (path === '') return;
            event.preventDefault();
            event.stopPropagation();
            setOpenedPath(path);
            setAnchorRect({ left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY, width: 0, height: 0 });
          };
          document.addEventListener('contextmenu', onContextMenu, true);
          return () => document.removeEventListener('contextmenu', onContextMenu, true);
        }, []);

        if (PrimMenu === null) return null;
        const close = () => setAnchorRect(null);
        const getAnchorRect = () => anchorRect;
        const runAction = (kind, failKey) => {
          close();
          const current = actionsRef.current;
          const act = current === null ? null : current[kind];
          if (typeof act !== 'function') return;
          Promise.resolve()
            .then(() => act(openedPath))
            .then((outcome) => {
              if (outcome !== null && outcome !== undefined && outcome.ok === false) {
                failure.show(t(failKey, { detail: outcome.reason === undefined ? '' : outcome.reason }));
              }
            })
            .catch((error) => {
              const detail = describeFailure(error);
              console.warn('[open-with-default-app] path menu action failed:', detail, error);
              failure.show(t(failKey, { detail }));
            });
        };
        const canUse = actions !== null && typeof actions.open === 'function';
        const renderRow = (icon, disabled, activate, label) => {
          if (PrimMenuItemButton === null) {
            return h('button', { type: 'button', role: 'menuitem', disabled, onClick: activate }, label);
          }
          return h(PrimMenuItemButton, { icon: iconNode(icon, 14), disabled, onSelect: activate }, label);
        };

        return h(
          React.Fragment,
          null,
          h(
            PrimMenu,
            {
              open: anchorRect !== null,
              portal: true,
              autoFocus: true,
              getAnchorRect,
              onClose: close,
              className: PLUGIN_ID + '-path-menu'
            },
            renderRow(OpenIcon, !canUse, () => runAction('open', 'open.failedDebug'), t('open.menu')),
            renderRow(FolderIcon, actions === null || typeof actions.reveal !== 'function', () => runAction('reveal', 'open.revealFailed'), t('open.reveal'))
          ),
          failure.text === '' ? null : toastNode(failure.sequence, failure.text, failure.clear)
        );
      }

      // ---------------------------------------------------------------------
      // 接线
      // ---------------------------------------------------------------------

      /**
       * 槽位 / 词典的必需服务。本插件不属于「缺了服务就整体不可用」的那类，
       * 因此 inject 只有这两项，**绝不能**把 `remote` / `remote.session` 写进来。
       *
       * 2026-10-17 实测（0.2.0-rc.2 + 隔离实例）：本插件 `immediately: true`，与内置
       * ui-open-in-app 同批加载；把 `remote` / `remote.session` 加进 inject，整个 client
       * 启动会卡在 "web boot: 1 entry did not activate"，页面直接进不去。原因见
       * `sessionRemote()`：服务代理的 inject 账本可以靠**一次性**的 `ctx.get()` 旁路，
       * 但 inject 声明是激活闸门，动它会连带堵住整批启动。
       */
      const inject = ['slots', 'locale'];

      function apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), PLUGIN_ID + ': dictionaries');

        /**
         * 给预览头部那行路径挂上「可右键」的光标信号。
         *
         * 那行路径是宿主 `PathLabel` 渲染的、插件改不了它的 JSX，所以只能**注入一张样式表**：
         * 只写一条 `cursor: context-menu`。样式只命中带 `data-textpreview-path` 的路径——
         * 即预览头部那一行——不碰其它 `PathLabel` 实例（对话里的路径、卡片里的路径）。
         *
         * 随 effect 生命周期注入 / 移除，不写存储、不改 DOM 结构。
         */
        ctx.effect(() => {
          // 没有 DOM（非浏览器宿主 / 单测环境）时安静退化成「无光标提示」，绝不让 apply 崩
          if (typeof document === 'undefined' || document === null || typeof document.createElement !== 'function' || document.head === null || document.head === undefined) {
            return () => {};
          }
          const style = document.createElement('style');
          style.id = HINT_STYLE_ID;
          /**
           * **只改光标，一个布局属性都不许碰。**
           *
           * 血泪教训（2026-10-17 实测翻车）：这里一度写过
           * `width: fit-content; align-self: start`，想把光标收窄到文字宽度，结果把该元素
           * 从「撑满整行的 flex 子项」变成「内容尺寸」，**绕过了宿主的收缩 + 省略号机制**
           * （宿主 `.dhJKeW_header{display:flex;height:38px;padding:0 6px 0 16px}`；路径元素靠
           * 撑满 + 自带 `min-width:0` 才收得住、才打 `data-path-clipped` 省略号），长路径直接
           * 溢出到面板外，看起来就是「整行错位」。
           *
           * 所以这条规则里**不准出现 width / align-self / min-width / margin / padding**，
           * self-test 有回归项逐字盯着。代价只有一个：该元素仍是撑满整行的 flex 子项，
           * 右键光标覆盖整行宽度而不是只覆盖文字——这是宿主布局决定的，插件不该为它动布局。
           */
          style.textContent = '[data-textpreview-path]{cursor:context-menu}';
          document.head.appendChild(style);
          return () => {
            style.remove();
          };
        }, PLUGIN_ID + ': path cursor');

        /**
         * 每次点击时动态解析 session remote（命名空间服务，带 `openWorkspacePath`）。
         *
         * 0.2.0-rc.2 隔离实例里逐条实测出的真相（顺序就是被这个事实决定的）：
         *   - `ctx.get('remote.session')` → **拿到了**命名空间服务（点号名在 reflect 的
         *     store 里就是服务名，`ctx.get` 不查 inject 账本）；
         *   - `ctx.get('remote')` → 拿到的是 **remote 挂载对象**（只有 $mount/$on/$host），
         *     它**没有** session 成员；
         *   - 于是对挂载对象取 `.session` 会走服务代理，抛
         *     `cannot get property "remote.session" without inject`——这正是旧版
         *     「打开失败：系统默认应用没有接受该路径」的真实原因（错误被吞成了 false）。
         *   - `ctx.remote` 未 inject 时同样抛错（异常必须就地吃掉）。
         *
         * 所以：**点号名直取排第一**，其余候选按「先验证再取子属性」的顺序兜底；
         * 任何一条抛错都不得中断后面的候选。
         * **每次调用都重新解析**，provider 晚于本插件就绪也能拿到。
         */
        function sessionRemote() {
          const usable = (candidate) => candidate !== null && candidate !== undefined && typeof candidate.openWorkspacePath === 'function';
          const invoke = (run) => {
            try {
              return run();
            } catch (error) {
              return undefined;
            }
          };
          const candidates = [
            // 1. 按点号名注册的命名空间服务（实测可用路径）
            () => (typeof ctx.get === 'function' ? ctx.get('remote.session') : undefined),
            // 2. 挂载对象（宽松宿主 / 旧版）再取 `.session`
            () => {
              const mount = invoke(() => (typeof ctx.get === 'function' ? ctx.get('remote') : undefined));
              return mount === null || mount === undefined ? undefined : invoke(() => mount.session);
            },
            // 3. 严格代理下已 inject 的直读（异常就地吃掉）
            () => invoke(() => ctx.remote),
            () => {
              const declared = invoke(() => ctx.remote);
              return declared === null || declared === undefined ? undefined : invoke(() => declared.session);
            }
          ];
          for (const candidate of candidates) {
            const value = invoke(candidate);
            if (usable(value)) return value;
          }
          return undefined;
        }

        function hasSessionRemote() {
          const session = sessionRemote();
          return session !== null && session !== undefined && typeof session.openWorkspacePath === 'function';
        }

        if (!hasSessionRemote()) {
          console.warn('[open-with-default-app] session remote not resolvable yet: buttons still render and resolve it on click');
        }

        // 刻意**不**按服务可用性隐藏按钮：`inject` 的求值时机可能早于连接就绪，
        // 那时隐藏会让整页都没有入口（这正是内置控件踩过的坑）。这里始终注入 opener，
        // 点击时再解析服务；真取不到就由失败提示如实报告（含真实失败原因）。
        //
        // 解析放在 try/catch 里：严格代理下 `ctx.remote` 的**属性访问本身**可能抛错，
        // 抛在 requestDefaultOpen 之外就只会剩一句泛化文案——真实原因必须能显示出来。
        const documentInjected = () => ({
          openWithDefaultApp: (path) => {
            let session;
            try {
              session = sessionRemote();
            } catch (error) {
              // 走 async 函数的返回通道，让失败原因落进同一个提示条
              return Promise.reject(error);
            }
            return requestDefaultOpen(session, path);
          },
          /**
           * 路径右键菜单用的带原因动作面。
           *
           * 与 `openWithDefaultApp` 分开是因为**契约不同**：按钮只要布尔值（失败走提示条），
           * 而菜单要么成功要么把 `reason` 交回给调用方自己拼文案。这里把两条 session 调用
           * 都包成 `{ ok, reason }`，`session` 仍然在**点击时**解析（解析异常也折叠成 reason）。
           */
          hostFileActions: {
            open: (path) => runWithReason('open', path),
            reveal: (path) => runWithReason('reveal', path)
          }
        });

        /**
         * 执行一次宿主文件动作，并把「为什么失败」作为返回值带出（绝不吞）。
         * @param kind - `open`（OS 关联）或 `reveal`（资源管理器定位）
         */
        function runWithReason(kind, path) {
          let session;
          try {
            session = sessionRemote();
          } catch (error) {
            return Promise.resolve({ ok: false, reason: describeFailure(error) });
          }
          let reason = '';
          const capture = (value) => {
            reason = describeFailure(value);
          };
          const call = kind === 'reveal' ? requestReveal : requestDefaultOpen;
          return call(session, path, capture).then((ok) => ({ ok, reason }));
        }

        // 交付卡片 / 变更对照页的动作区**不再注册**：那里原先挂一枚带字按钮，但
        // 「右键文件路径」成为主入口后，卡片上那枚按钮只是重复噪音（用户取向已明确）。
        // 卡片自身的既有能力（面板里的「打开方式 / 显示文件位置」）不受影响。

        ctx.slots.inject('sidebar.right.tab.document.actions', () => {
          // 预览标题栏**不再放按钮**（改为右键头部那行路径）；这里只留右键菜单宿主。
          ctx.slots.register(
            {
              name: 'sidebar.right.tab.document.actions',
              id: PLUGIN_ID + ':path-menu',
              locale: NS,
              inject: documentInjected
            },
            PathContextMenu
          );
        });

        ctx.slots.inject('sidebar.right.tab.document.unpreviewable', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.tab.document.unpreviewable',
              id: PLUGIN_ID,
              locale: NS,
              inject: documentInjected
            },
            EmptyOpenButton
          )
        );

        // 页签右键菜单：一条执行行 + 一条提示条载体（两条独立注册，各占自己的 id 单元格，
        // 互不替换；宿主只渲染被打开的那条菜单行，提示条则一直挂在槽里等失败）。
        ctx.slots.inject(TAB_MENU_SLOT, () => {
          ctx.slots.register(
            {
              name: TAB_MENU_SLOT,
              id: PLUGIN_ID + ':menu',
              order: TAB_MENU_ORDER,
              locale: NS,
              inject: documentInjected
            },
            MenuOpenButton
          );
          ctx.slots.register(
            {
              name: TAB_MENU_SLOT,
              id: PLUGIN_ID + ':menu-toast',
              order: TAB_MENU_ORDER + 1,
              locale: NS
            },
            MenuFailureToast
          );
        });
      }

      return {
        /**
         * 交给宿主 `ctx.plugin` 的服务依赖声明。
         *
         * 本插件只声明槽位 / 词典所需服务，**绝不**把 `remote` / `remote.session` 写进来：
         * inject 是激活闸门（`immediately: true` 的批次里写它会直接堵死整个 client 启动，
         * 实测报 `web boot: 1 entry did not activate`），而 session remote 靠 `ctx.get()`
         * 在点击时旁路取即可（见 `sessionRemote()`）。
         */
        inject,
        apply,
        __test: {
          PLUGIN_ID,
          NS,
          TAB_MENU_SLOT,
          TAB_MENU_ORDER,
          TOAST_HOLD_MS,
          zh,
          en,
          fileLabelOf,
          openRequestPayload,
          revealRequestPayload,
          describeFailure,
          tabFilePathOf,
          filePathFromResourceUrl,
          PATH_LABEL_SELECTOR,
          createSingleFlight,
          requestDefaultOpen,
          requestReveal,
          translatorIn,
          EmptyOpenButton,
          MenuOpenButton,
          MenuFailureToast,
          PathContextMenu
        }
      };
    }
  });
})();
