/**
 * @local/expand-all-sessions —— 浏览器半区。
 *
 * 目标：侧栏每个 Workspace 分组的「展开其余 N 个会话」一次点到全量，且首屏就全量，
 * 不再出现「点一次 +5 条」的中间态；用户自己收起后仍然能一次点回全量。
 *
 * 宿主事实（@deepseek-ai/dsh-client-ui-workspace 已构建产物，逐行核对过）：
 *  - 常量 `COLLAPSED_SESSION_LIMIT = 5`；`collapsedSessionRows(sessions, limit = 5)`
 *    只把 blank / running / 有运行中子代理的行排除在配额之外；`hiddenCount` 是
 *    **隐藏条数**（= 总条数 − 可显示条数），不是总条数；
 *  - `SessionTree` 内 `const [sessionLimits, setSessionLimits] = React.useState({})`，
 *    **初值是空对象**，只有用户点过溢出按钮、或点过分组标题收起之后，该分组的 key
 *    才会出现；Ungrouped 分组的 key 是空串；
 *  - 溢出按钮 `button[data-row-key="overflow:<groupKey>"]` 带
 *    `aria-expanded={visible.hiddenCount === 0}`，文案是「展开其余 {n} 个会话」/「收起」；
 *  - 它的 onClick 是函数式更新：`sessionsExpanded ? 5 : hidden <= 5 ? Infinity
 *    : (limits[key] ?? 5) + 5` —— `sessionsExpanded` / `hidden` 都来自**该次渲染的闭包**，
 *    所以 `Infinity + 5 === Infinity` 使我们的全量更新不会被它顶掉；
 *  - 分组标题折叠（onToggle）会把该组 limit 重置为 5；
 *  - 全量后按钮不会消失（`collapsed.hiddenCount > 0` 与 limit 无关），文案变「收起」。
 *
 * 实现要点（每条都对应一个真实踩过的坑）：
 *  1. DOM → `__reactFiber$` → 沿 `fiber.return` 向上 → `hook.queue.dispatch(action)`
 *     一次把该组写成 Infinity（React 公开的更新入口，不 patch React 模块）；
 *  2. **hook 定位不依赖「该组 key 已存在」**：`sessionLimits` 初值是 `{}`，凡要求
 *     「状态里已有本组 key」的判据都会让首屏与第一次点击必然失手（此前的 bug 根因）。
 *     判据 = 最近的「纯对象、值全是数字、带 queue.dispatch」的 useState；同一个 fiber
 *     内优先带本组 key 的那条，**不跨 fiber 往上找**（往上只会误伤别人的状态）；
 *  3. **读状态前把 fiber 归一到当前树**：DOM 上的 `__reactFiber$` 只在创建时写入，
 *     React 双缓冲会让它一半时间指向上一棵树，直接读 `memoizedState` 会读到旧 limit；
 *  4. **方向判据取按钮自己的渲染事实**：`aria-expanded === "true"` 即宿主的「收起」，
 *     交还宿主自己收起；否则一次全量。不再拿「隐藏条数」当总条数比大小；
 *  5. 点击路由挂 **document 捕获阶段**（React 会替换按钮节点），且**不阻断**宿主：
 *     展开方向上它那一下是等价空操作，收起方向本来就归它；
 *  6. **写完必须核对，核对不过才兜底**：真实宿主环境里 fiber 路径仍可能因未知结构差异
 *     静默失效（首屏扫描能用、点击时用不了），用户要的结果不能被实现细节赌掉。每次由
 *     我们写完全量后延时重新按 key 取按钮，仍未全量则改用**驱动宿主自己的按钮**
 *     （等价于用户手动连点：+5 或直接 Infinity；有次数上限与卡死检测），并把这次降级
 *     打成一条 warn。兜底点击带 synthetic 标记，不会被自己的 document 路由当成新点击
 *     而自喂；用户中途再点这颗按钮会取消核对，不会把「收起」弹回去。
 *
 * 幂等：已自动全量过的分组记在 `autoExpanded`；用户随后主动折叠（标题 onToggle 或点
 * 「收起」）不会被反弹回全量。若该组的 key 从状态里彻底消失（SessionTree 重挂、状态
 * 被重置），则视为新的首屏，重新自动全量。
 */
(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/expand-all-sessions',
    meta: {},
    factory: function (require) {
      // 仅用于与宿主共享同一个 React 模块实例；本实现不调用任何 React API。
      try {
        require('react');
      } catch (error) {
        /* 缺少 react 也不影响 DOM/fiber 路径 */
      }

      // ---------------------------------------------------------------
      // 常量
      // ---------------------------------------------------------------

      const LOG_PREFIX = '[expand-all-sessions]';
      const OVERFLOW_SELECTOR = 'button[data-row-key^="overflow:"]';
      const OVERFLOW_KEY_PREFIX = 'overflow:';
      const DEFAULT_COLLAPSED_LIMIT = 5; // 与宿主 COLLAPSED_SESSION_LIMIT 镜像
      /** 主路径失败时的重试上限（每轮扫描算一次），超过就放弃并留 warn。 */
      const MAX_DISPATCH_ATTEMPTS = 8;
      const MARKED_ATTRIBUTE = 'data-expand-all-sessions';
      /** fiber / hook 链的遍历上限，防御异常结构导致死循环。 */
      const MAX_FIBER_DEPTH = 200;
      const MAX_HOOK_WALK = 200;
      /** 文案里出现数字 = 宿主的「展开其余 {n} 个会话」；「收起」永远不带数字。 */
      const COUNT_PATTERN = /\d/;
      /** 写完多久之后核对 DOM（给 React 一次提交 + 一帧渲染的时间）。 */
      const VERIFY_DELAY_MS = 150;
      /** 兜底路径每个分组最多驱动宿主按钮多少次（每次 +5，足够覆盖任意长度列表）。 */
      const FALLBACK_MAX_CLICKS = 40;
      /** 连续多少次点击后按钮外观毫无变化就认为没救，停手。 */
      const FALLBACK_STUCK_LIMIT = 3;

      // ---------------------------------------------------------------
      // 模块级状态（由 start() 创建，cleanup() 释放）
      // ---------------------------------------------------------------

      /** 已自动全量过的分组键：用户折叠后不再弹回。 */
      const autoExpanded = new Set();
      /** 每个分组已经尝试过几次 dispatch（主路径失败时的重试预算）。 */
      const attempts = new Map();
      /** 兜底路径每个分组已经点过多少次宿主按钮。 */
      const fallbackClicks = new Map();
      /** 兜底路径每个分组连续多少次点击后外观毫无变化。 */
      const stuckClicks = new Map();
      /** 已报到过的故障 key（避免刷屏）。 */
      const warned = new Set();
      /** 正在等待的核对任务：groupKey → timer。 */
      const pendingVerifies = new Map();
      /** 待清理的帧回调（rAF 或 setTimeout）。 */
      const pendingFrames = new Set();

      let observer = null;
      let scheduled = false;
      let notified = false;
      /** 兜底点击期间为 true：拦掉自己的 document 路由，避免自喂。 */
      let syntheticClick = false;

      // ---------------------------------------------------------------
      // 小工具
      // ---------------------------------------------------------------

      function warnOnce(key, message, detail) {
        if (warned.has(key)) return;
        warned.add(key);
        console.warn(LOG_PREFIX + ' ' + message, detail === undefined ? '' : detail);
      }

      function scheduleFrame(handler) {
        if (typeof requestAnimationFrame === 'function') {
          const id = requestAnimationFrame(() => {
            dropFrame('raf', id);
            handler();
          });
          pendingFrames.add({ kind: 'raf', id: id });
          return;
        }
        const id = setTimeout(() => {
          dropFrame('timeout', id);
          handler();
        }, 16);
        pendingFrames.add({ kind: 'timeout', id: id });
      }

      function dropFrame(kind, id) {
        for (const entry of pendingFrames) {
          if (entry.kind === kind && entry.id === id) {
            pendingFrames.delete(entry);
            return;
          }
        }
      }

      function cancelPendingWork() {
        for (const entry of pendingFrames) {
          if (entry.kind === 'raf') {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(entry.id);
          } else {
            clearTimeout(entry.id);
          }
        }
        pendingFrames.clear();
        for (const timer of pendingVerifies.values()) clearTimeout(timer);
        pendingVerifies.clear();
      }

      function hasOwn(state, key) {
        return state !== null &&
          typeof state === 'object' &&
          Object.prototype.hasOwnProperty.call(state, key);
      }

      // ---------------------------------------------------------------
      // fiber 遍历
      // ---------------------------------------------------------------

      /** 取一个 DOM 节点上的 React fiber 内部键（非枚举属性）。 */
      function fiberKeyOf(node) {
        if (node === null || typeof node !== 'object') return null;
        const names = Object.getOwnPropertyNames(node);
        for (let at = 0; at < names.length; at += 1) {
          const name = names[at];
          if (name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$')) {
            return name;
          }
        }
        return null;
      }

      function fiberOf(node) {
        const key = fiberKeyOf(node);
        if (key === null) return null;
        const fiber = node[key];
        return fiber && typeof fiber === 'object' ? fiber : null;
      }

      /**
       * 把 DOM 指针上的 fiber 归一到「当前树」。
       *
       * 宿主事实（真实 React 18.3.1 实测）：React 只在 createInstance 时把
       * `__reactFiber$` 写进 DOM 节点，之后 current / alternate 双缓冲逐次交替，
       * 指针有一半时间停在**上一棵树**上。直接读 `hook.memoizedState` 就会读到上一次
       * 提交的旧 limit，于是「这一帧是否已全量」的判断会随机判错一次 —— 表现就是
       * 点了没反应 / 只 +5 / 收起后弹不回来。FiberRoot.current 指向当前 HostRoot，
       * 用它判定并切到 alternate 即可（queue.dispatch 两棵树共享，写不受影响）。
       */
      function currentFiber(fiber) {
        let top = fiber;
        let depth = 0;
        while (top.return !== null && top.return !== undefined && depth < MAX_FIBER_DEPTH) {
          top = top.return;
          depth += 1;
        }
        const root = top.stateNode;
        if (root === null || root === undefined || typeof root !== 'object') return fiber;
        if (root.current === top) return fiber;
        const alternate = fiber.alternate;
        return alternate === null || alternate === undefined ? fiber : alternate;
      }

      /** 判断是否是「React 元素树」上的 fiber（而非 hook 对象）。 */
      function isFiber(value) {
        return (
          value !== null &&
          typeof value === 'object' &&
          typeof value.tag === 'number' &&
          'memoizedState' in value
        );
      }

      /** 判断是否是 hook 链上的节点。 */
      function isHook(value) {
        return (
          value !== null &&
          typeof value === 'object' &&
          typeof value.tag !== 'number' &&
          'next' in value &&
          'memoizedState' in value
        );
      }

      /** 纯对象（排除数组、Map、DOM 节点、ref/effect 之类）。 */
      function isPlainObject(value) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
        const proto = Object.getPrototypeOf(value);
        return proto === Object.prototype || proto === null;
      }

      /**
       * 状态是否「像 sessionLimits」：普通对象，且每个值都是数字（含 Infinity）。
       *
       * 空对象 `{}` 也算——**这正是首屏的初始状态**，必须命中，否则首屏与第一次点击
       * 都找不到 hook。宿主其它候选状态都会被这一条排除：
       *  - `useSessionStatus(s => s)` 的 snapshot 值是对象/字符串；
       *  - 面板信息 snapshot 的 `activePanelId` 是 string|null；
       *  - `useRef` 没有 queue.dispatch、`useEffect`/`useMemo` 的 memoizedState 是数组或
       *    带 create/destroy 的对象且没有 dispatch；
       *  - class 组件（如 AnimatedRows）的 state 链 queue.dispatch 为 null。
       */
      function looksLikeLimitsMap(state) {
        if (!isPlainObject(state)) return false;
        const keys = Object.keys(state);
        for (let at = 0; at < keys.length; at += 1) {
          if (typeof state[keys[at]] !== 'number') return false;
        }
        return true;
      }

      /**
       * 在**一条** hook 链上找 limits map：同一条链内优先带本组 key 的那条。
       * @returns {{ hook: object, keyed: boolean } | null}
       */
      function findLimitsHookInChain(startHook, groupKey) {
        let hook = startHook;
        let fallback = null;
        let walked = 0;
        while (isHook(hook) && walked < MAX_HOOK_WALK) {
          const state = hook.memoizedState;
          const queue = hook.queue;
          const dispatch = queue === null || queue === undefined ? null : queue.dispatch;
          if (typeof dispatch === 'function' && looksLikeLimitsMap(state)) {
            if (hasOwn(state, groupKey)) return { hook: hook, keyed: true };
            if (fallback === null) fallback = { hook: hook, keyed: false };
          }
          hook = hook.next;
          walked += 1;
        }
        return fallback;
      }

      /**
       * 从溢出按钮出发向上找持有 sessionLimits 的 fiber。
       *
       * 只认**离按钮最近**的那个 limits map fiber：`sessionLimits` 就是按钮最近的对象型
       * useState 祖先，继续往上找只会误伤别人的状态。因为不要求状态里已有本组 key，
       * 首屏 `sessionLimits === {}` 时同样命中。
       * @returns {{ hook: object, fiber: object } | null}
       */
      function findLimitsHookFromFiber(start, groupKey) {
        let fiber = start;
        let depth = 0;
        while (fiber !== null && fiber !== undefined && depth < MAX_FIBER_DEPTH) {
          if (isFiber(fiber) && fiber.memoizedState !== null && fiber.memoizedState !== undefined) {
            const found = findLimitsHookInChain(fiber.memoizedState, groupKey);
            if (found !== null) return { hook: found.hook, fiber: fiber };
          }
          fiber = fiber.return;
          depth += 1;
        }
        return null;
      }

      function findLimitsHook(node, groupKey) {
        const fiber = fiberOf(node);
        if (fiber === null) return null;
        return findLimitsHookFromFiber(currentFiber(fiber), groupKey);
      }

      // ---------------------------------------------------------------
      // 状态读写
      // ---------------------------------------------------------------

      /** 用宿主的折叠语义计算新状态：全部展开，或「收起」写回默认配额。 */
      function mappedLimits(previous, groupKey, limit) {
        const current = previous === null || typeof previous !== 'object' ? {} : previous;
        const next = Object.assign({}, current);
        next[groupKey] = limit;
        return next;
      }

      /**
       * 该按钮此刻是不是宿主的「收起」（这一帧已经全量）。
       *
       * 判据优先级：
       *  1. `aria-expanded`——宿主自己渲染的 `visible.hiddenCount === 0`，最权威且与
       *     语言无关；
       *  2. 文案里有没有数字——「收起」/「Show less」永远不带数字，展开文案必带隐藏条数；
       *  3. 兜底只认 Infinity（**不能**拿隐藏条数当总条数比大小：limit=10、隐藏 6 的组
       *     会被 `10 >= 6` 误判成「已全量」，点击就变成只 +5）。
       */
      function isFullyExpanded(button, state, groupKey) {
        if (button === null || button === undefined) return true; // 按钮没了 = 没有隐藏行
        const aria = typeof button.getAttribute === 'function'
          ? button.getAttribute('aria-expanded')
          : null;
        if (aria === 'true') return true;
        if (aria === 'false') return false;
        const text = typeof button.textContent === 'string' ? button.textContent : '';
        if (!COUNT_PATTERN.test(text)) return true;
        return hasOwn(state, groupKey) && state[groupKey] === Infinity;
      }

      /**
       * 一次 dispatch 把某分组 limit 写成给定值。
       * @returns {boolean} 是否成功排入更新。
       */
      function dispatchLimit(located, groupKey, limit) {
        try {
          located.hook.queue.dispatch((previous) => mappedLimits(previous, groupKey, limit));
          attempts.delete(groupKey); // 成功即清零重试预算
          return true;
        } catch (error) {
          warnOnce('dispatch:' + groupKey, 'dispatch 失败', error);
          return false;
        }
      }

      // ---------------------------------------------------------------
      // DOM 查询 / 兜底
      // ---------------------------------------------------------------

      /** 按分组 key 重新查当前 DOM 里的溢出按钮（React 可能已经换过节点）。 */
      function findOverflowButton(groupKey) {
        if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
          return null;
        }
        try {
          const buttons = document.querySelectorAll(OVERFLOW_SELECTOR);
          for (let at = 0; at < buttons.length; at += 1) {
            if (groupKeyOf(buttons[at]) === groupKey) return buttons[at];
          }
        } catch (error) {
          warnOnce('query', '查询溢出按钮失败', error);
        }
        return null;
      }

      /** 按钮的可见外观特征，用于兜底路径的卡死检测。 */
      function buttonSignature(button) {
        if (button === null || button === undefined) return '(none)';
        const aria = typeof button.getAttribute === 'function'
          ? button.getAttribute('aria-expanded')
          : null;
        const text = typeof button.textContent === 'string' ? button.textContent : '';
        return String(aria) + '|' + text;
      }

      /** 驱动宿主自己的按钮一次（先立 synthetic 标记，避免自己的路由自喂）。 */
      function clickHostButton(button) {
        try {
          syntheticClick = true;
          button.click();
        } catch (error) {
          warnOnce('host-click', '驱动宿主按钮失败', error);
        } finally {
          syntheticClick = false;
        }
      }

      /**
       * 兜底：主路径写完却没生效时，逐帧驱动宿主自己的溢出按钮。
       *
       * 每一次点击都走宿主自己的 onClick（+5，或隐藏数 ≤5 时直接 Infinity），所以结果
       * 一定与用户手动连点一致。必须是**逐帧**而不是同步 while：React 18 对离散事件用
       * 微任务刷新，同步连点看不到 DOM 进度，会误判成卡死。次数上限 + 卡死检测保证
       * 不会无限点；宿主按钮消失（该组没有隐藏行了）即视为达成。
       */
      function driveHostExpand(groupKey) {
        scheduleFrame(() => stepHostExpand(groupKey));
      }

      function stepHostExpand(groupKey) {
        const button = findOverflowButton(groupKey);
        if (button === null) return; // 没有溢出按钮 = 该组已无隐藏行
        if (isFullyExpanded(button, null, groupKey)) return; // 达成
        const spent = fallbackClicks.get(groupKey) ?? 0;
        if (spent >= FALLBACK_MAX_CLICKS) {
          warnOnce('fallback-exhausted:' + groupKey, '兜底点击已达上限，停止驱动', groupKey);
          return;
        }
        const before = buttonSignature(button);
        fallbackClicks.set(groupKey, spent + 1);
        warnOnce(
          'fallback:' + groupKey,
          'fiber 主路径未生效，已改用驱动宿主按钮完成展开',
          groupKey
        );
        clickHostButton(button);
        scheduleFrame(() => {
          const next = findOverflowButton(groupKey);
          if (next === null || isFullyExpanded(next, null, groupKey)) return;
          if (buttonSignature(next) === before) {
            const stuck = (stuckClicks.get(groupKey) ?? 0) + 1;
            stuckClicks.set(groupKey, stuck);
            if (stuck >= FALLBACK_STUCK_LIMIT) {
              warnOnce('fallback-stuck:' + groupKey, '驱动宿主按钮后外观无变化，停止兜底', groupKey);
              return;
            }
          } else {
            stuckClicks.set(groupKey, 0);
          }
          stepHostExpand(groupKey);
        });
      }

      /**
       * 写完之后的核对：延时重新按 key 取按钮，仍未全量才走兜底。
       *
       * 这一步是「真实环境里 fiber 路径可能静默失效」的保险：宿主结构变化、双缓冲交错、
       * 或别的插件同时改状态时，用户要的结果（全部展开）不能被一个内部实现细节赌掉。
       * 核对期间用户再点这颗按钮（例如点「收起」）会取消核对，不会把收起弹回去。
       */
      function verifyExpanded(groupKey) {
        if (typeof setTimeout !== 'function') return;
        cancelVerify(groupKey);
        const timer = setTimeout(() => {
          pendingVerifies.delete(groupKey);
          const button = findOverflowButton(groupKey);
          if (button === null) return; // 没有溢出按钮 = 该组已无隐藏行
          if (isFullyExpanded(button, null, groupKey)) return;
          driveHostExpand(groupKey);
        }, VERIFY_DELAY_MS);
        pendingVerifies.set(groupKey, timer);
      }

      function cancelVerify(groupKey) {
        const timer = pendingVerifies.get(groupKey);
        if (timer === undefined) return;
        clearTimeout(timer);
        pendingVerifies.delete(groupKey);
      }

      // ---------------------------------------------------------------
      // 点击路由
      // ---------------------------------------------------------------

      /** 取该节点（或它最多两层祖先）上的溢出按钮；兼容文案被包进子节点。 */
      function overflowButtonOf(node) {
        let current = node;
        for (let up = 0; up < 3; up += 1) {
          if (isOverflowButton(current)) return current;
          current = current === null || current === undefined ? null : current.parentElement;
          if (current === null || current === undefined) return null;
        }
        return null;
      }

      /** 该节点是否是我们关心的溢出按钮（兼容元素被替换后的新节点）。 */
      function isOverflowButton(node) {
        if (node === null || node === undefined || typeof node.getAttribute !== 'function') {
          return false;
        }
        const key = node.getAttribute('data-row-key');
        return key !== null && key.indexOf(OVERFLOW_KEY_PREFIX) === 0;
      }

      function groupKeyOf(button) {
        const key = button.getAttribute('data-row-key');
        if (key === null || key.indexOf(OVERFLOW_KEY_PREFIX) !== 0) return null;
        return key.slice(OVERFLOW_KEY_PREFIX.length);
      }

      /**
       * document 级捕获阶段的点击入口。
       *
       * 挂在 document 而不是按钮元素上：React re-render 时会替换 overflow 按钮的 DOM
       * 节点，挂在旧节点上的监听器会随节点一起消失，而宿主的 onClick 是挂在根容器上的
       * 委托监听（不受节点替换影响）。挂在 document 上则列表怎么重挂都不会丢。
       *
       * 捕获阶段先于宿主根容器上的 onClick；不调用 preventDefault / stopPropagation，
       * 宿主的 onClick 随后照常运行：对我们写成的 Infinity 而言它是等价空操作
       * （`Infinity + 5 === Infinity`），而它自己那一下「收起」仍归它。
       */
      function onDocumentClick(event) {
        if (syntheticClick) return; // 兜底点击自己产生的，不能再当成用户点击处理
        try {
          const button = overflowButtonOf(event.target);
          if (button === null) return;
          const groupKey = groupKeyOf(button);
          if (groupKey === null) return;
          cancelVerify(groupKey); // 用户又动了这颗按钮：先撤掉上一轮的核对/兜底
          const located = findLimitsHook(button, groupKey);
          // 当前这一帧已全量 = 宿主的「收起」，交还它自己的 onClick（写回默认配额）。
          const state = located === null ? null : located.hook.memoizedState;
          if (isFullyExpanded(button, state, groupKey)) return;
          if (located === null) {
            // fiber 路径不可用（宿主换了状态容器 / React 内部结构变化）时，用户这次点击
            // 的意图仍然必须被满足：改用驱动宿主自身的按钮，等价于用户手动连点。
            warnOnce(
              'dispatch-miss:' + groupKey,
              '找不到该分组的 limit 状态，改用驱动宿主按钮展开',
              groupKey
            );
            driveHostExpand(groupKey);
            return;
          }
          if (!dispatchLimit(located, groupKey, Infinity)) return;
          autoExpanded.add(groupKey);
          verifyExpanded(groupKey);
          scheduleSweep();
        } catch (error) {
          warnOnce('click', '点击处理失败', error);
        }
      }

      // ---------------------------------------------------------------
      // DOM 扫描（首屏自动全量）
      // ---------------------------------------------------------------

      /**
       * 每颗溢出按钮在扫描时只做两件事：打标记 + 决定要不要自动全量。
       *
       * 重试预算只在「确实找不到 hook」时消耗；一旦成功立刻清零。找不到 hook 时不做
       * 合成点击（没有 hook 就没有可核对的目标），耗尽后留一条 warn 便停手，按钮本身
       * 仍归宿主可用。
       */
      function interceptButton(button) {
        const groupKey = groupKeyOf(button);
        if (groupKey === null) return;
        if (typeof button.setAttribute === 'function') {
          button.setAttribute(MARKED_ATTRIBUTE, '1');
        }
        const located = findLimitsHook(button, groupKey);
        if (located === null) {
          consumeAttempt(groupKey);
          return;
        }
        const state = located.hook.memoizedState;
        // 状态里连 key 都没有 = 该组从未被触碰，或 SessionTree 重挂后状态被重置：
        // 两种都属于「首屏」，重新自动全量，而不是继续吃 autoExpanded 的老账。
        if (!hasOwn(state, groupKey)) autoExpanded.delete(groupKey);
        if (autoExpanded.has(groupKey)) return; // 已自动全量过，尊重用户后续折叠
        if (isFullyExpanded(button, state, groupKey)) {
          autoExpanded.add(groupKey); // 宿主本来就已经全量，无需再写
          return;
        }
        if (!dispatchLimit(located, groupKey, Infinity)) return;
        autoExpanded.add(groupKey);
        verifyExpanded(groupKey);
        if (!notified) {
          notified = true;
          console.debug(
            LOG_PREFIX + ' 已全量展开首组会话（' + groupKey + '），后续分组同路径静默处理'
          );
        }
      }

      function consumeAttempt(groupKey) {
        const used = attempts.get(groupKey) ?? 0;
        if (used >= MAX_DISPATCH_ATTEMPTS) {
          warnOnce(
            'exhausted:' + groupKey,
            '多次重试仍没找到该分组的 limit 状态，已放弃自动全量（按钮本身仍可用）',
            groupKey
          );
          return;
        }
        attempts.set(groupKey, used + 1);
      }

      function sweep() {
        if (typeof document === 'undefined') return;
        try {
          const buttons = document.querySelectorAll(OVERFLOW_SELECTOR);
          for (let at = 0; at < buttons.length; at += 1) interceptButton(buttons[at]);
        } catch (error) {
          warnOnce('sweep', '扫描溢出按钮失败', error);
        }
      }

      function scheduleSweep() {
        if (scheduled) return;
        scheduled = true;
        scheduleFrame(() => {
          scheduled = false;
          sweep();
        });
      }

      // ---------------------------------------------------------------
      // 生命周期
      // ---------------------------------------------------------------

      function start() {
        if (typeof document === 'undefined') return () => {};
        const attach = () => {
          // 点击路由挂在 document 的捕获阶段：React 替换按钮节点后依然有效。
          document.addEventListener('click', onDocumentClick, true);
          scheduleSweep();
          observer = new MutationObserver(scheduleSweep);
          const target = document.body || document.documentElement;
          if (target) observer.observe(target, { childList: true, subtree: true });
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', attach, { once: true });
        } else {
          attach();
        }
        return () => {
          if (typeof document.removeEventListener === 'function') {
            document.removeEventListener('click', onDocumentClick, true);
          }
          if (observer !== null) {
            observer.disconnect();
            observer = null;
          }
          cancelPendingWork();
          autoExpanded.clear();
          attempts.clear();
          fallbackClicks.clear();
          stuckClicks.clear();
          warned.clear();
          scheduled = false;
          notified = false;
          syntheticClick = false;
        };
      }

      function apply(ctx) {
        ctx.effect(start, 'expand-all-sessions: session-limit bypass');
      }

      /** 仅供 self-test 复位模块级状态。 */
      function resetForTest() {
        autoExpanded.clear();
        attempts.clear();
        fallbackClicks.clear();
        stuckClicks.clear();
        warned.clear();
        cancelPendingWork();
        scheduled = false;
        notified = false;
        syntheticClick = false;
      }

      return {
        inject: [],
        apply: apply,
        __test: {
          LOG_PREFIX: LOG_PREFIX,
          OVERFLOW_SELECTOR: OVERFLOW_SELECTOR,
          OVERFLOW_KEY_PREFIX: OVERFLOW_KEY_PREFIX,
          DEFAULT_COLLAPSED_LIMIT: DEFAULT_COLLAPSED_LIMIT,
          MAX_DISPATCH_ATTEMPTS: MAX_DISPATCH_ATTEMPTS,
          MARKED_ATTRIBUTE: MARKED_ATTRIBUTE,
          VERIFY_DELAY_MS: VERIFY_DELAY_MS,
          FALLBACK_MAX_CLICKS: FALLBACK_MAX_CLICKS,
          autoExpanded: autoExpanded,
          attempts: attempts,
          fallbackClicks: fallbackClicks,
          stuckClicks: stuckClicks,
          warned: warned,
          pendingVerifies: pendingVerifies,
          fiberKeyOf: fiberKeyOf,
          fiberOf: fiberOf,
          currentFiber: currentFiber,
          isFiber: isFiber,
          isHook: isHook,
          isPlainObject: isPlainObject,
          looksLikeLimitsMap: looksLikeLimitsMap,
          findLimitsHookInChain: findLimitsHookInChain,
          findLimitsHookFromFiber: findLimitsHookFromFiber,
          findLimitsHook: findLimitsHook,
          mappedLimits: mappedLimits,
          isFullyExpanded: isFullyExpanded,
          isOverflowButton: isOverflowButton,
          overflowButtonOf: overflowButtonOf,
          groupKeyOf: groupKeyOf,
          findOverflowButton: findOverflowButton,
          buttonSignature: buttonSignature,
          clickHostButton: clickHostButton,
          driveHostExpand: driveHostExpand,
          verifyExpanded: verifyExpanded,
          cancelVerify: cancelVerify,
          onDocumentClick: onDocumentClick,
          dispatchLimit: dispatchLimit,
          interceptButton: interceptButton,
          sweep: sweep,
          scheduleSweep: scheduleSweep,
          start: start,
          resetForTest: resetForTest
        }
      };
    }
  });
})();
