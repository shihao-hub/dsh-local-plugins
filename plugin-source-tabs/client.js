/**
 * Client half of the plugin-source-tabs bundle.
 *
 * 插件管理器页面的「已安装插件」分组把两类来源混在同一个列表里：本地插件
 * （profile 用 `link:` 指向工作区、本仓库一律以 `@local/` 发布的包）和从
 * 注册表 / GitHub 下载的插件。本插件在分组标题与卡片列表之间插入一个两段
 * 分栏（本地 / 下载），默认选中本地，只显示对应来源的卡片；选择会记住，下次
 * 打开页面沿用。
 *
 * 实现取向：宿主没有为这份列表开放可扩展的渲染座位（`plugins.tab` 只允许
 * 第三方**整块替换**分组，拿不到宿主自己的卡片、开关与跳转），因此这里沿用
 * 本仓库既有的做法——以宿主提供的稳定 DOM 锚点（`section[data-plugin-group=
 * "bundles"]` 与 `li[data-plugin-package]`）做就地增强：不改宿主代码、不复制
 * 宿主组件，只加自己的分栏条、自己的样式，以及卡片上的一个隐藏属性。
 *
 * 与宿主共存的约定：
 *   - 隐藏用 `data-plugin-source-hidden` 属性 + 一条 `display:none!important`
 *     规则，**不写 style/className**（那两项归 React 管，刷新时会被它覆盖）；
 *   - 每次刷新都先比对再写（属性相同就不 setAttribute），MutationObserver 因此
 *     不会被自己的写入反复唤醒；
 *   - 所有自有节点（分栏条、空态、样式表）在插件卸载时移除，卡片上的隐藏属性
 *     一并还原，宿主页面回到原样。
 */
(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/plugin-source-tabs',
    meta: {},
    factory: function () {
      const PLUGIN_ID = '@local/plugin-source-tabs';
      const NS = 'plugin-source-tabs';
      const STORAGE_KEY = 'plugin-source-tabs.v1';

      /** 宿主「已安装插件」分组的锚点（插件管理器页面 renderGroup('bundles')）。 */
      const GROUP_SELECTOR = 'section[data-plugin-group="bundles"]';
      /** 分组里的组合包卡片；宿主把包名写在 data-plugin-package 上。 */
      const CARD_SELECTOR = 'li[data-plugin-package]';

      /**
       * 本地插件的判定：本仓库的本地插件一律以 `@local/` 发布，profile 用
       * `link:` 指向工作区目录；从注册表 / GitHub 安装的插件不使用这个 scope。
       */
      const LOCAL_SCOPES = ['@local/'];

      const TAB_LOCAL = 'local';
      const TAB_DOWNLOADED = 'downloaded';

      const TAB_ATTR = 'data-plugin-source-tab';
      const BAR_ATTR = 'data-plugin-source-bar';
      const HIDDEN_ATTR = 'data-plugin-source-hidden';
      const EMPTY_ATTR = 'data-plugin-source-empty';
      const STYLE_ID = 'plugin-source-tabs-style';

      const zh = {
        'tabs.label': '插件来源',
        'tab.local': '本地',
        'tab.downloaded': '下载',
        'empty.local': '暂无本地插件',
        'empty.downloaded': '暂无下载插件'
      };

      const en = {
        'tabs.label': 'Plugin source',
        'tab.local': 'Local',
        'tab.downloaded': 'Downloaded',
        'empty.local': 'No local plugins yet',
        'empty.downloaded': 'No downloaded plugins yet'
      };

      /**
       * 分栏条做成「页签」而不是分段控件：不给整块容器、不给选中块垫底，
       * 只有文字 + 一枚 2px 下划线。理由是这个控件挂在分组标题行右侧、
       * 与卡片上的蓝色开关同一条竖线，任何带底色的胶囊都会和开关抢视觉重量，
       * 也会被误读成「整页模式开关」；文字级页签与左侧标题同级，切换语义明确。
       *
       * 三条刻意的取舍：
       *   - 两层灰叠在一起会发脏（底 4% 白、选中块 8% 白、0.5px 边框 16% 白），
       *     所以这里只留一种明度对比：文字从 secondary 提到 primary；
       *   - 选中态不再改字重（500 → 600 会让中文标签变宽、切换时文字抖动），
       *     只改颜色 + 下划线；
       *   - 计数不再做成 pill：pill 与选中块同色时等于隐形，两个 tab 结构不一致。
       * 每个颜色都带主题变量 + 兜底值，主题变量缺失时仍能读出层级。
       */
      const CSS = [
        '.pst-bar{position:relative;display:inline-flex;align-items:center;gap:4px;flex:none;margin:0 -8px 0 auto;}',
        '.pst-tab{position:relative;appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;margin:0;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#cfd3d6);font-family:inherit;font-size:13px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:color .15s,background-color .15s;}',
        '.pst-tab:hover{color:var(--dsw-alias-label-primary,#f9fafb);background:var(--dsw-alias-interactive-bg-hover,#ffffff0d);}',
        '.pst-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary,#f9fafb);}',
        '.pst-tab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#7aaaff));outline-offset:-2px;}',
        '.pst-tab::after{content:"";position:absolute;left:8px;right:8px;bottom:4px;height:2px;border-radius:1px;background:currentColor;opacity:0;transform:scaleX(.5);transform-origin:center;transition:opacity .16s ease-out,transform .22s cubic-bezier(.2,0,0,1);}',
        '.pst-tab[aria-selected="true"]::after{opacity:1;transform:scaleX(1);}',
        '.pst-count{font-size:11px;font-weight:500;line-height:1;color:var(--dsw-alias-label-tertiary,#adb2b8);font-variant-numeric:tabular-nums;transform:translateY(-.5px);transition:color .15s;}',
        '.pst-tab[aria-selected="true"] .pst-count{color:var(--dsw-alias-label-secondary,#cfd3d6);}',
        '.pst-empty{margin:6px 8px 2px;color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:13px;line-height:20px;}',
        '[' + HIDDEN_ATTR + ']{display:none!important;}',
        '.pst-fade{animation:pst-fade .16s ease-out;}',
        '@keyframes pst-fade{from{opacity:0;}to{opacity:1;}}',
        '@media (prefers-reduced-motion:reduce){.pst-tab::after{transition:none;}.pst-fade{animation:none;}}'
      ].join('\n');

      /** 当前分类；首次使用默认本地，之后沿用上次选择。 */
      let active = TAB_LOCAL;
      /** 每个分类离开时的滚动位置：切回来时恢复，避免「来回切两次就找不到刚才那条」。 */
      const scrollPositions = { [TAB_LOCAL]: null, [TAB_DOWNLOADED]: null };
      /** 翻译函数：有 locale 服务时用它的命名空间字典，否则用按 <html lang> 选的兜底表。 */
      let translate = fallbackTranslate;

      function fallbackTranslate(key) {
        const lang = String((typeof document !== 'undefined' && document.documentElement.lang) || '').toLowerCase();
        const table = lang.indexOf('zh') === 0 ? zh : en;
        return table[key] !== undefined ? table[key] : key;
      }

      function readActive() {
        try {
          const stored = window.localStorage.getItem(STORAGE_KEY);
          return stored === TAB_DOWNLOADED ? TAB_DOWNLOADED : TAB_LOCAL;
        } catch (error) {
          return TAB_LOCAL;
        }
      }

      function saveActive(value) {
        try {
          window.localStorage.setItem(STORAGE_KEY, value);
        } catch (error) {
          // 无痕 / 禁用存储：只在本次会话内生效。
        }
      }

      /** 包名 → 分类。本地判据见 LOCAL_SCOPES。 */
      function classify(name) {
        for (const scope of LOCAL_SCOPES) {
          if (name.indexOf(scope) === 0) return TAB_LOCAL;
        }
        return TAB_DOWNLOADED;
      }

      function labelKey(value) {
        return value === TAB_DOWNLOADED ? 'tab.downloaded' : 'tab.local';
      }

      function emptyKey(value) {
        return value === TAB_DOWNLOADED ? 'empty.downloaded' : 'empty.local';
      }

      function ensureStyle() {
        if (document.getElementById(STYLE_ID) !== null) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.append(style);
      }

      function createBar() {
        const bar = document.createElement('div');
        bar.className = 'pst-bar';
        bar.setAttribute(BAR_ATTR, '');
        bar.setAttribute('role', 'tablist');
        // 只做状态存档（调试与阅读器看得见当前分类），样式不再依赖它。
        bar.dataset.active = active;

        for (const value of [TAB_LOCAL, TAB_DOWNLOADED]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'pst-tab';
          button.setAttribute('role', 'tab');
          button.setAttribute(TAB_ATTR, value);

          const label = document.createElement('span');
          label.className = 'pst-label';
          label.setAttribute('data-pst-part', 'label');

          const count = document.createElement('span');
          count.className = 'pst-count';
          count.setAttribute('data-pst-part', 'count');

          button.append(label, count);
          bar.append(button);
        }

        bar.addEventListener('click', (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const button = target.closest('button[' + TAB_ATTR + ']');
          if (button === null) return;
          pick(button.getAttribute(TAB_ATTR));
        });

        // ARIA tab 的漫游焦点：左右方向键在两项之间切换。
        bar.addEventListener('keydown', (event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          pick(active === TAB_LOCAL ? TAB_DOWNLOADED : TAB_LOCAL);
          const next = bar.querySelector('button[' + TAB_ATTR + '="' + active + '"]');
          if (next !== null) next.focus();
        });

        return bar;
      }

      /**
       * 切换分类。宿主列表是整组过滤：切过去内容会变短，页面高度骤减，浏览器
       * 把 scrollTop 一次性钳到新的上界，视图「啪」地跳走一段——列表越长跳得
       * 越远，靠事后补偿是补不回来的（新的上界就摆在那里）。所以收缩时反过来
       * 做：先把列表高度冻结在旧值、把滚动位置还原，再让高度在 220ms 内连续
       * 缩到新值——页面高度连续变化，浏览器就只能连续钳制，视图跟着平滑上移。
       * 展开时页面变长、scrollTop 不受影响，直接恢复到该分栏上次的位置。
       */
      function pick(value) {
        const next = value === TAB_DOWNLOADED ? TAB_DOWNLOADED : TAB_LOCAL;
        if (next === active) return;

        const group = document.querySelector(GROUP_SELECTOR);
        const list = group === null ? null : group.querySelector('ul');
        const bar = document.querySelector('[' + BAR_ATTR + ']');
        const scroller = bar === null ? null : scrollParentOf(bar);
        const anchorTop = bar === null ? null : bar.getBoundingClientRect().top;
        const leavingScroll = scroller === null ? 0 : scroller.scrollTop;
        if (scroller !== null) scrollPositions[active] = leavingScroll;

        const from = list === null ? 0 : list.offsetHeight;
        clearListAnimation(list);

        active = next;
        saveActive(next);
        refresh();
        fadeList();

        const to = list === null ? 0 : list.offsetHeight;
        if (list !== null && scroller !== null && from > to + 1 && !reducedMotion()) {
          animateShrink(list, scroller, from, to, leavingScroll);
          return;
        }
        settleScroll(anchorTop, scrollPositions[next]);
      }

      /** 清掉上一次收缩动画残留的固定高度 / 裁切 / 过渡（连点时先归位）。 */
      function clearListAnimation(list) {
        if (list === null) return;
        list.style.height = '';
        list.style.overflow = '';
        list.style.transition = '';
      }

      /**
       * 列表高度 from → to 的平滑收缩。第一行（冻结高度 + 还原滚动位置）和
       * `refresh()` 处在同一个同步任务里，浏览器不会画出中间帧，所以用户看不到
       * 「先跳回去再动」；随后高度连续变化，滚动位置被连续钳制，观感是页面顺着
       * 收上去，而不是瞬移。
       */
      function animateShrink(list, scroller, from, to, scrollTop) {
        list.style.height = from + 'px';
        list.style.overflow = 'hidden';
        void list.offsetHeight; // 先让冻结高度落实，否则下面还原 scrollTop 会被旧上界钳掉
        scroller.scrollTop = scrollTop;
        list.style.transition = 'height 220ms cubic-bezier(.2,0,0,1)';
        list.style.height = to + 'px';

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          list.style.height = '';
          list.style.overflow = '';
          list.style.transition = '';
        };
        list.addEventListener('transitionend', (event) => {
          if (event.target === list && event.propertyName === 'height') finish();
        }, { once: true });
        window.setTimeout(finish, 320); // 兜底：过渡被系统取消时也要收尾
      }

      /** 切换后让卡片列表淡入一次；动画结束就摘掉类，避免影响后续样式。 */
      function fadeList() {
        const group = document.querySelector(GROUP_SELECTOR);
        const list = group === null ? null : group.querySelector('ul');
        if (list === null) return;
        list.classList.remove('pst-fade');
        void list.offsetWidth; // 强制回流，让动画能从这一帧重新开始
        list.classList.add('pst-fade');
        list.addEventListener('animationend', () => list.classList.remove('pst-fade'), { once: true });
      }

      /** 最近的可纵向滚动祖先。宿主把滚动放在 `section.X_2TxG_page` 上而不是
       * window（`window.scrollY` 恒为 0），所以 window.scrollBy 无效。 */
      function scrollParentOf(element) {
        for (let node = element.parentElement; node !== null; node = node.parentElement) {
          const overflowY = getComputedStyle(node).overflowY;
          if (/(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
        }
        return document.scrollingElement || document.documentElement;
      }

      /**
       * 展开（页面变长）时的滚动落点：
       *   1. 这个分类上次离开时的位置——来回切不丢阅读位置；
       *   2. 没有记忆就把分栏条钉在点击前的屏幕位置（页面没变长时等于什么都不动）；
       * 都按容器的可滚范围 clamp，用平滑滚动收尾。
       */
      function settleScroll(anchorTop, remembered) {
        const bar = document.querySelector('[' + BAR_ATTR + ']');
        if (bar === null) return;
        const scroller = scrollParentOf(bar);
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);

        let top;
        if (remembered !== null && remembered !== undefined) {
          top = Math.min(remembered, max);
        } else if (anchorTop !== null) {
          const docTop = scroller.scrollTop + bar.getBoundingClientRect().top;
          top = Math.max(0, Math.min(docTop - anchorTop, max));
        } else {
          return;
        }

        if (Math.abs(top - scroller.scrollTop) < 2) return;
        scroller.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
      }

      function reducedMotion() {
        return typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }

      /**
       * 找到（必要时创建）分栏条，并把它挂进分组标题行：标题在左、切换器在右，
       * 与下方卡片的开关同一条右对齐线上，不再单独占一行、也不把列表往下推。
       * groupHead 是宿主的 `display:flex; align-items:center`，标题 h3 带 `flex:1`，
       * 所以追加进去就自然贴右、垂直居中。
       */
      function ensureBar(group) {
        let bar = group.querySelector('[' + BAR_ATTR + ']');
        if (bar === null) bar = createBar();

        const head = group.firstElementChild;
        if (head === null) {
          if (bar.parentElement !== group) group.append(bar);
        } else if (bar.parentElement !== head) {
          head.append(bar);
        }
        return bar;
      }

      /** 更新分栏条：文案、计数、选中态与漫游焦点；值没变就不写 DOM。 */
      function updateBar(bar, counts) {
        const name = translate('tabs.label');
        if (bar.getAttribute('aria-label') !== name) bar.setAttribute('aria-label', name);
        if (bar.dataset.active !== active) bar.dataset.active = active;

        for (const button of bar.querySelectorAll('button[' + TAB_ATTR + ']')) {
          const value = button.getAttribute(TAB_ATTR) === TAB_DOWNLOADED ? TAB_DOWNLOADED : TAB_LOCAL;
          const selected = value === active;
          const label = translate(labelKey(value));
          const count = String(value === TAB_DOWNLOADED ? counts.downloaded : counts.local);

          const labelNode = button.querySelector('[data-pst-part="label"]');
          const countNode = button.querySelector('[data-pst-part="count"]');
          if (labelNode !== null && labelNode.textContent !== label) labelNode.textContent = label;
          if (countNode !== null && countNode.textContent !== count) countNode.textContent = count;

          const selectedAttr = selected ? 'true' : 'false';
          if (button.getAttribute('aria-selected') !== selectedAttr) button.setAttribute('aria-selected', selectedAttr);
          const tabIndex = selected ? 0 : -1;
          if (button.tabIndex !== tabIndex) button.tabIndex = tabIndex;
          if (button.getAttribute('aria-label') !== label + ' ' + count) {
            button.setAttribute('aria-label', label + ' ' + count);
          }
        }
      }

      /** 当前分类为空时，在卡片列表下面补一句说明（宿主自己的空态只覆盖整组为空）。 */
      function updateEmpty(group, counts) {
        const isEmpty = counts[active] === 0;
        let note = group.querySelector('[' + EMPTY_ATTR + ']');
        if (!isEmpty) {
          if (note !== null) note.remove();
          return;
        }

        if (note === null) {
          note = document.createElement('p');
          note.className = 'pst-empty';
          note.setAttribute(EMPTY_ATTR, '');
          note.setAttribute('role', 'status');
        }

        const text = translate(emptyKey(active));
        if (note.textContent !== text) note.textContent = text;

        const list = group.querySelector('ul');
        if (list !== null) {
          if (note.previousElementSibling !== list) list.after(note);
        } else if (note.parentElement !== group) {
          group.append(note);
        }
      }

      /**
       * 对当前分组的全量卡片重新分类并应用过滤；宿主每渲染一次列表，
       * MutationObserver 就再来一遍，所以这里必须是幂等的。
       */
      function refresh() {
        const group = document.querySelector(GROUP_SELECTOR);
        if (group === null) return;

        ensureStyle();

        const bar = ensureBar(group);
        const counts = { local: 0, downloaded: 0 };

        for (const card of group.querySelectorAll(CARD_SELECTOR)) {
          const name = card.getAttribute('data-plugin-package') || '';
          const kind = classify(name);
          counts[kind] += 1;

          const hide = kind !== active;
          if (card.hasAttribute(HIDDEN_ATTR) !== hide) {
            if (hide) card.setAttribute(HIDDEN_ATTR, '');
            else card.removeAttribute(HIDDEN_ATTR);
          }
        }

        updateBar(bar, counts);
        updateEmpty(group, counts);
      }

      function start(ctx) {
        if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};

        let frame = 0;
        const schedule = () => {
          if (frame !== 0) return;
          frame = window.requestAnimationFrame(() => {
            frame = 0;
            refresh();
          });
        };

        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true });

        // 语言切换不会改变列表结构，单独订阅一次，让分栏文案跟着走。
        let unsubscribe = null;
        try {
          if (ctx.locale && typeof ctx.locale.subscribe === 'function') unsubscribe = ctx.locale.subscribe(schedule);
        } catch (error) {
          unsubscribe = null;
        }

        refresh();

        return () => {
          observer.disconnect();
          if (frame !== 0) {
            window.cancelAnimationFrame(frame);
            frame = 0;
          }
          if (unsubscribe !== null) unsubscribe();

          for (const bar of document.querySelectorAll('[' + BAR_ATTR + ']')) bar.remove();
          for (const note of document.querySelectorAll('[' + EMPTY_ATTR + ']')) note.remove();
          for (const card of document.querySelectorAll('[' + HIDDEN_ATTR + ']')) card.removeAttribute(HIDDEN_ATTR);

          // 收缩动画中途卸载：把宿主 ul 上的临时高度/裁切/过渡还原。
          for (const group of document.querySelectorAll(GROUP_SELECTOR)) {
            for (const list of group.querySelectorAll('ul')) clearListAnimation(list);
          }

          const style = document.getElementById(STYLE_ID);
          if (style !== null) style.remove();
        };
      }

      function apply(ctx) {
        try {
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), PLUGIN_ID + ': dictionaries');
          if (ctx.locale && typeof ctx.locale.bind === 'function') translate = ctx.locale.bind(NS);
        } catch (error) {
          translate = fallbackTranslate;
        }

        active = readActive();
        ctx.effect(() => start(ctx), PLUGIN_ID + ': installed-plugin source tabs');
      }

      const inject = ['locale'];

      return {
        inject,
        apply,
        __test: { classify, zh, en, readActive, active: () => active }
      };
    }
  });
})();
