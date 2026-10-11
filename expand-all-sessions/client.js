/**
 * @local/expand-all-sessions —— 浏览器半区。
 *
 * 目标：侧栏每个 Workspace 分组的「展开其余 N 个会话」分页在首屏就被一次性跳过，
 * 直接全量渲染，不再出现「点一次 +5 条」的过程体验。
 *
 * 宿主事实（@deepseek-ai/dsh-client-ui-workspace 的已构建产物）：
 *  - 常量 `COLLAPSED_SESSION_LIMIT = 5`；`collapsedSessionRows(sessions, limit)`
 *    只把 blank / running 行排除在配额之外；
 *  - `SessionTree` 内 `const [sessionLimits, setSessionLimits] = React.useState({})`，
 *    key 为分组的 `group.key`（Ungrouped 分组的 key 是**空串**，也是合法 key）；
 *  - 溢出按钮 `button[data-row-key="overflow:<groupKey>"]` 的 onClick 只做
 *    函数式 setSessionLimits：+5，或隐藏数 ≤5 时写成 Infinity；全量后按钮文案
 *    变为「收起」（写回 5）；
 *  - 分组标题折叠（onToggle）会把该组 limit 重置为 5。
 *
 * 因此本插件不走「模拟点击」，而是：
 *  1. DOM → `__reactFiber$` → 沿 `fiber.return` 向上找到持有 sessionLimits 那个
 *     `useState` hook 的 fiber，直接 `hook.queue.dispatch(action)`，一次提交把
 *     该组写成 Infinity（React 公开的更新入口，不直接改 fiber，不 patch React 模块）；
 *  2. 捕获阶段接管溢出按钮的 click：我们的「展开其余」= 全量，原生 onClick 仍
 *     照常运行（它顺带维护 aria-expanded / 文案），随后我们的全量 dispatch 覆盖它；
 *  3. 只有 fiber 结构失效时才降级为「有限次原生点击」，并留一条 warn，绝不抛错。
 *
 * 幂等：已自动全量过的分组记在 `expandedGroups`；用户随后主动折叠（标题 onToggle
 * 或点「收起」）不会被反弹回全量。
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
      const FALLBACK_CLICK_LIMIT = 60; // 降级路径每分组最大点击次数

      // ---------------------------------------------------------------
      // 模块级状态（由 start() 创建，cleanup() 释放）
      // ---------------------------------------------------------------

      /** 已自动全量过的分组键：折叠后不再弹回。 */
      const expandedGroups = new Set();
      /** 已接管 click 的按钮元素。 */
      const interceptedButtons = new WeakSet();
      /** 每个分组在降级路径里已经点过多少次。 */
      const fallbackClicks = new Map();
      /** 已报到过的故障 key（避免刷屏）。 */
      const warned = new Set();

      let observer = null;
      let scheduled = false;
      let notified = false;
      const rafTimers = new Set();

      // ---------------------------------------------------------------
      // 小工具
      // ---------------------------------------------------------------

      function warnOnce(key, message, detail) {
        if (warned.has(key)) return;
        warned.add(key);
        console.warn(LOG_PREFIX + ' ' + message, detail === undefined ? '' : detail);
      }

      function scheduleFrame(handler) {
        if (typeof requestAnimationFrame !== 'function') {
          const timer = setTimeout(handler, 16);
          rafTimers.add(timer);
          return;
        }
        const id = requestAnimationFrame(() => {
          rafTimers.delete(id);
          handler();
        });
        rafTimers.add(id);
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

      /**
       * 在一次渲染里该分组是否已经全量。
       *
       * 判据是「宿主自己的全量投影」，对任何分组键（含 Ungrouped / 单列表的空串）都成立：
       *  - 该组 limit 是 Infinity；
       *  - 该组 limit 比自己最终能显示的条数还大（宿主在「最多剩一批」时会自己写 Infinity，
       *    手动排序之类的路径也可能写成一个大数）。
       *
       * 注意：**不能**用「空对象」判定空串分组。sessionLimits 的初值就是 {}，而空串正是
       * Ungrouped 的合法分组键（groupByWorkspace 的 `buildGroup("", …)`），把 {} 当成
       * 「已全量」会让 Ungrouped 分组的每一次点击都被误判成宿主的「收起」而静默失效。
       */
      function isExpandedState(state, groupKey, totalSessions) {
        if (state === null || typeof state !== 'object') return false;
        const limit = state[groupKey];
        if (limit === Infinity) return true;
        if (typeof limit !== 'number' || typeof totalSessions !== 'number') return false;
        return limit >= totalSessions;
      }

      /** 该按钮此刻是不是宿主的「收起」（已经全量）。 */
      function isExpandedButton(button, groupKey) {
        const target = findLimitsHook(button, groupKey);
        if (target === null) return false;
        return isExpandedState(
          target.hook.memoizedState,
          groupKey,
          sessionCountFromButton(button)
        );
      }

      /**
       * 从溢出按钮的文案里读该分组总条数（「展开其余 N 个会话」/「收起」）。
       * 读不到就返回 undefined，此时只认 Infinity 这一条判据。
       */
      function sessionCountFromButton(button) {
        try {
          const text = button.textContent;
          if (typeof text !== 'string') return undefined;
          const match = /(\d+)/.exec(text);
          if (match === null) return undefined;
          const hidden = Number(match[1]);
          return Number.isFinite(hidden) ? hidden : undefined;
        } catch (error) {
          return undefined;
        }
      }

      /**
       * 在一条 hook 链上找 sessionLimits。
       * 命中条件：状态是普通对象、有可调用的 queue.dispatch、且**已经带着本组 key**
       * （hasOwnProperty 对空串同样成立，所以空串分组也能走到这里）。
       */
      function findHook(fiber, groupKey) {
        let hook = fiber.memoizedState;
        let walked = 0;
        while (isHook(hook) && walked < 200) {
          const state = hook.memoizedState;
          const queue = hook.queue;
          const dispatch = queue === null || queue === undefined ? null : queue.dispatch;
          if (
            state !== null &&
            typeof state === 'object' &&
            typeof dispatch === 'function' &&
            Object.prototype.hasOwnProperty.call(state, groupKey)
          ) {
            return hook;
          }
          hook = hook.next;
          walked += 1;
        }
        return null;
      }

      /**
       * 从溢出按钮出发向上找持有 sessionLimits 的 fiber。
       *
       * 不按 fiber.tag 过滤：`findHook` 的命中条件（对象状态 + 可调用 dispatch +
       * 本组 key）已经足够特异，扫过非函数组件（host / class fiber）只会命中不了。
       * @returns {{ hook: object, fiber: object } | null}
       */
      function findLimitsHook(node, groupKey) {
        let fiber = fiberOf(node);
        if (fiber === null) return null;
        let depth = 0;
        while (fiber !== null && fiber !== undefined && depth < 200) {
          if (isFiber(fiber) && fiber.memoizedState !== null && fiber.memoizedState !== undefined) {
            const hook = findHook(fiber, groupKey);
            if (hook !== null) return { hook: hook, fiber: fiber };
          }
          fiber = fiber.return;
          depth += 1;
        }
        return null;
      }

      // ---------------------------------------------------------------
      // 状态更新
      // ---------------------------------------------------------------

      /** 用宿主的折叠语义计算新状态：全部展开，或「收起」写回默认配额。 */
      function mappedLimits(previous, groupKey, expanded) {
        const current = previous === null || typeof previous !== 'object' ? {} : previous;
        const next = Object.assign({}, current);
        next[groupKey] = expanded ? Infinity : DEFAULT_COLLAPSED_LIMIT;
        return next;
      }

      /**
       * 捕获阶段的点击入口。
       *
       * 宿主自己的 React onClick 挂在根容器上（冒泡阶段），本监听器挂在按钮本身
       * 且为捕获阶段，因此必然先执行：非「收起」态时直接把该组写成 Infinity。
       * 不调用 preventDefault / stopPropagation，宿主的 onClick 随后照常运行，
       * 由它维护 aria-expanded 与按钮文案——对我们全量后的状态而言是等价的空操作。
       */
      function handleOverflowClick(event, groupKey) {
        try {
          // 只认「当前这一帧已经全量」：那说明这颗按钮是宿主的「收起」，交还给它的原生
          // onClick（写回默认配额）。expandedGroups 不参与判定——用户折叠之后它仍是 true，
          // 此时这次点击应当是「展开」。
          if (isExpandedButton(event.currentTarget, groupKey)) return;
          if (!dispatchGroup(groupKey, event.currentTarget)) {
            fallbackClick(event.currentTarget, groupKey);
          }
          scheduleSweep();
        } catch (error) {
          warnOnce('click:' + groupKey, '点击处理失败', error);
        }
      }

      /**
       * 一次 dispatch 把某分组 limit 写成 Infinity。
       * @returns {boolean} 是否成功排入更新。
       */
      function dispatchGroup(groupKey, button) {
        try {
          const target = findLimitsHook(button, groupKey);
          if (target === null) return false;
          target.hook.queue.dispatch((previous) => mappedLimits(previous, groupKey, true));
          return true;
        } catch (error) {
          warnOnce('dispatch:' + groupKey, 'dispatch 失败，改用降级路径', error);
          return false;
        }
      }

      // ---------------------------------------------------------------
      // 降级路径：有限次原生点击（每次扫描一帧，让 React 在两次点击之间提交）
      // ---------------------------------------------------------------

      function fallbackClick(button, groupKey) {
        const used = fallbackClicks.get(groupKey) ?? 0;
        if (used >= FALLBACK_CLICK_LIMIT) {
          warnOnce(
            'fallback-limit:' + groupKey,
            '原生点击已达上限，放弃该分组（fiber 结构可能已变化）',
            groupKey
          );
          return false;
        }
        fallbackClicks.set(groupKey, used + 1);
        try {
          button.click();
        } catch (error) {
          warnOnce('fallback-click:' + groupKey, '原生点击失败', error);
          return false;
        }
        return true;
      }

      // ---------------------------------------------------------------
      // DOM 扫描
      // ---------------------------------------------------------------

      function interceptButton(button) {
        const key = button.getAttribute('data-row-key');
        if (key === null || key.indexOf(OVERFLOW_KEY_PREFIX) !== 0) return;
        const groupKey = key.slice(OVERFLOW_KEY_PREFIX.length);
        if (interceptedButtons.has(button)) return;
        interceptedButtons.add(button);
        button.addEventListener(
          'click',
          function (event) {
            handleOverflowClick(event, groupKey);
          },
          true
        );
        if (expandedGroups.has(groupKey)) return; // 已自动全量过，尊重用户后续折叠
        if (fallbackClicks.has(groupKey)) return; // 降级推进交给 sweep()
        if (dispatchGroup(groupKey, button)) {
          expandedGroups.add(groupKey);
          if (!notified) {
            notified = true;
            console.debug(
              LOG_PREFIX + ' 已全量展开首组会话（' + groupKey + '），后续分组同路径静默处理'
            );
          }
          return;
        }
        fallbackClicks.set(groupKey, 0);
        fallbackClick(button, groupKey);
      }

      function sweep() {
        if (typeof document === 'undefined') return;
        try {
          const buttons = document.querySelectorAll(OVERFLOW_SELECTOR);
          for (let at = 0; at < buttons.length; at += 1) {
            const button = buttons[at];
            interceptButton(button);
            const key = button.getAttribute('data-row-key');
            if (key === null || key.indexOf(OVERFLOW_KEY_PREFIX) !== 0) continue;
            // 主路径不可用的分组：每轮扫描推进一次原生点击，让 React 在两次之间提交。
            if (fallbackClicks.has(key.slice(OVERFLOW_KEY_PREFIX.length))) {
              fallbackClick(button, key.slice(OVERFLOW_KEY_PREFIX.length));
            }
          }
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
          if (observer !== null) {
            observer.disconnect();
            observer = null;
          }
          for (const timer of rafTimers) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(timer);
            else clearTimeout(timer);
          }
          rafTimers.clear();
          fallbackClicks.clear();
          warned.clear();
          notified = false;
        };
      }

      function apply(ctx) {
        ctx.effect(start, 'expand-all-sessions: session-limit bypass');
      }

      /** 仅供 self-test 复位模块级状态。 */
      function resetForTest() {
        expandedGroups.clear();
        fallbackClicks.clear();
        warned.clear();
        scheduled = false;
        notified = false;
      }

      return {
        inject: [],
        apply: apply,
        __test: {
          LOG_PREFIX: LOG_PREFIX,
          OVERFLOW_SELECTOR: OVERFLOW_SELECTOR,
          OVERFLOW_KEY_PREFIX: OVERFLOW_KEY_PREFIX,
          DEFAULT_COLLAPSED_LIMIT: DEFAULT_COLLAPSED_LIMIT,
          FALLBACK_CLICK_LIMIT: FALLBACK_CLICK_LIMIT,
          expandedGroups: expandedGroups,
          fallbackClicks: fallbackClicks,
          warned: warned,
          fiberKeyOf: fiberKeyOf,
          fiberOf: fiberOf,
          isFiber: isFiber,
          isHook: isHook,
          findHook: findHook,
          findLimitsHook: findLimitsHook,
          mappedLimits: mappedLimits,
          isExpandedState: isExpandedState,
          isExpandedButton: isExpandedButton,
          sessionCountFromButton: sessionCountFromButton,
          dispatchGroup: dispatchGroup,
          fallbackClick: fallbackClick,
          handleOverflowClick: handleOverflowClick,
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
