(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/running-session-highlight',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      /**
       * 侧栏「正在运行」的会话行。
       *
       * 宿主实际给出的信息量（从 dsh-client-ui-workspace / dsh-client-ui-primitives 反编译核实）：
       *
       *   div[data-row-key^="session:"]        (.…_sessionRow, role="treeitem")
       *     span.…_slot                       16×20 行首槽位
       *       └ svg[data-state="ongoing"]     仅当 node.running 为真（或子 agent 在跑）
       *     span.…_title / span.…_time / …
       *
       *   - client.js:1623  running 时槽位渲染 SessionStatusDots，**不**走
       *                     renderSlot('sidebar.session.row.leading')——插件拿不到这个位置，
       *                     只能从 CSS 侧命中宿主已经渲染出来的那枚状态点；
       *   - client.js:1437  「进行中」(status.running) 只写进 visuallyHidden，
       *                     屏幕阅读器能读，肉眼看不到；
       *   - StateDot.module.css:37-62  ongoing 是 14px SVG 环，color 取
       *                     --dsw-alias-label-tertiary（Rider Dark 下 #858585），
       *                     轨道 opacity .25，弧长 12/150 ≈ 圆周 8%。
       *
       * 结果：一条正在跑的会话，在 #2b2b2b 侧栏上只有一枚几乎看不见的灰转圈。
       *
       * 本插件开两条通道（纯 CSS 注入，零 DOM 改动、零 MutationObserver）：
       *   ① 转圈换成主题强调色，加粗（stroke-width 2 → 2.6）放大（14 → 16px）；
       *   ② 整行一层 2.6s 的呼吸底纹（9% ⇄ 24%）。
       *
       * 刻意不加左侧竖条：会话行的 border-radius 会把 inset 阴影弯成游离的 "("，
       * 这是 active-session-highlight v1 已经踩过的坑（见其 README）。
       *
       * 行脉动只动画 background-color —— CSS 动画的优先级高于一切普通声明，所以
       * 「运行中」且同时是「当前打开」的行由本插件接管，不会被 active-session-highlight
       * 的静态 18% 底纹压掉；两者默认同色，观感连贯。
       *
       * DOM 契约（App 更新若改版需回来对照）：
       *   - div[data-row-key^="session:"]  会话行宿主；blank / 归档行不渲染槽位，天然不受影响
       *   - svg[data-state="ongoing"]      运行中状态点：ongoing 态在 DOM 上是 <svg>，
       *                                    实心态（done/warning/error/idle）是 <span>，选择器不误伤
       * 任一条失效即静默退化为无效果，绝不报错。
       *
       * 颜色管线：
       *   --dsh-running-accent > --dsh-active-row-accent（active-session-highlight 的自定义色）
       *   > --dsw-alias-state-business-primary > #4176e6
       * 默认与「当前会话高亮」同色，改任一侧都各自即时生效。
       */

      const NS = 'running-session-highlight';
      const STORE_KEY = 'running-session-highlight.accent';
      const STYLE_TAG_ID = '@local/running-session-highlight/rows.css';
      const DEFAULT_HEX = '#4176e6';
      /**
       * 设置行来源标注：通用设置里的这一行由本插件注册，而不是 DSH 内置项。
       * `data-plugin-*` 是给统一识别与自动化验收用的稳定钩子；徽章文案走 locale。
       */
      const ROW_ID = 'running-session-highlight';
      const PLUGIN_PACKAGE = '@local/running-session-highlight';

      /** 与 pin-highlight / active-session-highlight 同一套色值，跨插件配色语言统一。 */
      const PRESETS = [
        { hex: '#5b9dd9', key: 'preset.blue' },
        { hex: '#e2b341', key: 'preset.amber' },
        { hex: '#57ab5a', key: 'preset.green' },
        { hex: '#db61a2', key: 'preset.magenta' },
        { hex: '#56d4dd', key: 'preset.cyan' }
      ];

      const ACCENT =
        'var(--dsh-running-accent, var(--dsh-active-row-accent, var(--dsw-alias-state-business-primary, ' +
        DEFAULT_HEX +
        ')))';

      /** 运行中的会话行；:has() 让「行」跟着「行内那枚 ongoing 状态点」走。 */
      const ROW_SELECTOR = 'div[data-row-key^="session:"]:has(svg[data-state="ongoing"])';
      /** 行首槽位里那枚转圈。 */
      const SPINNER_SELECTOR = 'div[data-row-key^="session:"] svg[data-state="ongoing"]';

      const CSS = [
        '/* ── 运行中的会话行 ──────────────────────────────────────────',
        '   ① 转圈：tertiary 灰 → 主题强调色，加粗并放大；',
        '   ② 整行：缓慢呼吸的强调色底纹（9% ⇄ 24%）。',
        '   刻意不加左条：行圆角会把 inset 阴影弯成游离的 "(" 。 */',
        SPINNER_SELECTOR + ' {',
        '  color: ' + ACCENT + ';',
        '  width: 16px;',
        '  height: 16px;',
        '}',
        SPINNER_SELECTOR + ' circle { stroke-width: 2.6; }',
        SPINNER_SELECTOR + ' circle:first-of-type { opacity: 0.34; }',
        '',
        ROW_SELECTOR + ' {',
        '  /* 无 color-mix() 引擎的兜底：原生「active nav item」填充色。 */',
        '  background-color: var(--dsw-specific-sidebar-nav-item-active, #43454a);',
        '  background-color: color-mix(in srgb, ' + ACCENT + ' 16%, transparent);',
        '  animation: rsh-breathe 2.6s ease-in-out infinite;',
        '}',
        '',
        '@keyframes rsh-breathe {',
        '  0%, 100% { background-color: color-mix(in srgb, ' + ACCENT + ' 9%, transparent); }',
        '  50%      { background-color: color-mix(in srgb, ' + ACCENT + ' 24%, transparent); }',
        '}',
        '',
        '@media (prefers-reduced-motion: reduce) {',
        '  ' + ROW_SELECTOR + ' {',
        '    animation: none;',
        '    background-color: color-mix(in srgb, ' + ACCENT + ' 18%, transparent);',
        '  }',
        '}',
        '',
        '/* ---- 通用设置行 (rsh_*) ---- */',
        '.rsh_group{border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:8px;padding:16px 0}',
        '.rsh_head{display:flex;align-items:center;justify-content:space-between;gap:16px}',
        '.rsh_text{display:flex;flex-direction:column;gap:2px;min-width:0}',
        '.rsh_title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}',
        '.rsh_badge{display:inline-flex;align-items:center;flex:none;margin-left:8px;padding:0 6px;height:18px;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-weight:400;letter-spacing:.02em;white-space:nowrap;vertical-align:middle}',
        '.rsh_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
        '.rsh_controls{display:flex;align-items:center;gap:8px;flex:none}',
        '.rsh_swatch{box-sizing:border-box;flex:none;width:22px;height:22px;padding:0;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;cursor:pointer}',
        '.rsh_swatch:hover{border-color:var(--dsw-alias-border-l4)}',
        '.rsh_swatch.rsh_active{outline:2px solid var(--dsw-focus-ring-color,#3574f0);outline-offset:1px}',
        '.rsh_custom{position:relative;box-sizing:border-box;flex:none;width:22px;height:22px;border:1px dashed var(--dsw-alias-border-l4);border-radius:6px;overflow:hidden;cursor:pointer;background:conic-gradient(#ff5757,#ffb657,#f5f563,#63f573,#63c5f5,#a563f5,#ff5757)}',
        '.rsh_custom:hover{border-color:var(--dsw-alias-label-tertiary)}',
        '.rsh_custom input{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;opacity:0;cursor:pointer}',
        '.rsh_reset{flex:none;padding:2px 4px;border:0;background:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer}',
        '.rsh_reset:hover{color:var(--dsw-alias-label-primary)}',
        ''
      ].join('\n');

      // ---- 持久化与应用 -----------------------------------------------------

      function storedAccent() {
        try {
          return window.localStorage.getItem(STORE_KEY);
        } catch {
          return null;
        }
      }

      function writeStored(hex) {
        try {
          if (hex === null) window.localStorage.removeItem(STORE_KEY);
          else window.localStorage.setItem(STORE_KEY, hex);
        } catch {
          /* 存储不可用：本次会话内仍然生效 */
        }
      }

      /** 自定义色挂在 <html> 的行内属性上：优先级高于样式表，无需重新注入。 */
      function applyAccent(hex) {
        if (typeof document === 'undefined') return;
        if (hex) document.documentElement.style.setProperty('--dsh-running-accent', hex);
        else document.documentElement.style.removeProperty('--dsh-running-accent');
      }

      /** 展示为「当前」的颜色：自定义优先，其次读主题 business 色。 */
      function effectiveAccent() {
        const stored = storedAccent();
        if (stored) return stored;
        try {
          const raw = getComputedStyle(document.documentElement)
            .getPropertyValue('--dsw-alias-state-business-primary')
            .trim();
          if (/^#[0-9a-fA-F]{6}/.test(raw)) return raw.slice(0, 7);
        } catch {
          /* 取不到计算样式：退回常量 */
        }
        return DEFAULT_HEX;
      }

      // ---- 设置行 -----------------------------------------------------------

      function RunningRowColorRow() {
        const [accent, setAccent] = React.useState(storedAccent() || '');

        const choose = (hex) => {
          if (hex) {
            writeStored(hex);
            applyAccent(hex);
            setAccent(hex);
          } else {
            writeStored(null);
            applyAccent(null);
            setAccent('');
          }
        };

        return h(
          'div',
          {
            className: 'rsh_group',
            'data-plugin-setting': ROW_ID,
            'data-plugin-package': PLUGIN_PACKAGE
          },
          h(
            'div',
            { className: 'rsh_head' },
            h(
              'div',
              { className: 'rsh_text' },
              h(
                'div',
                { className: 'rsh_title' },
                t('row.title'),
                h(
                  'span',
                  {
                    className: 'rsh_badge',
                    title: t('row.badgeTitle', { package: PLUGIN_PACKAGE })
                  },
                  t('row.badge')
                )
              ),
              h('div', { className: 'rsh_desc' }, t('row.description'))
            ),
            h(
              'div',
              { className: 'rsh_controls' },
              PRESETS.map((p) =>
                h('button', {
                  key: p.hex,
                  type: 'button',
                  className: 'rsh_swatch' + (accent === p.hex ? ' rsh_active' : ''),
                  style: { background: p.hex },
                  title: t(p.key),
                  'aria-label': t(p.key),
                  onClick: () => choose(p.hex)
                })
              ),
              h(
                'label',
                { className: 'rsh_custom', title: t('custom') },
                h('input', {
                  type: 'color',
                  value: effectiveAccent(),
                  'aria-label': t('custom'),
                  onChange: (e) => choose(e.target.value)
                })
              ),
              accent
                ? h('button', { type: 'button', className: 'rsh_reset', onClick: () => choose('') }, t('reset'))
                : null
            )
          )
        );
      }

      const zh = {
        'row.title': '运行中会话高亮颜色',
        'row.badge': '插件',
        'row.badgeTitle': '由插件 {package} 提供',
        'row.description': '侧栏正在运行的会话：呼吸底纹与转圈颜色，改动即时生效',
        custom: '自定义颜色',
        reset: '默认',
        'preset.blue': '蓝色',
        'preset.amber': '琥珀',
        'preset.green': '绿色',
        'preset.magenta': '玫红',
        'preset.cyan': '青色'
      };
      const en = {
        'row.title': 'Running-session highlight color',
        'row.badge': 'Plugin',
        'row.badgeTitle': 'Provided by plugin {package}',
        'row.description': 'Breathing tint and spinner color for sessions that are running; applies instantly',
        custom: 'Custom color',
        reset: 'Default',
        'preset.blue': 'Blue',
        'preset.amber': 'Amber',
        'preset.green': 'Green',
        'preset.magenta': 'Magenta',
        'preset.cyan': 'Cyan'
      };

      // ---- 接线 -------------------------------------------------------------

      const STYLE_MOUNTED = 'running-session-highlight: row stylesheet';

      function start() {
        if (typeof document === 'undefined') return () => {};
        if (document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]') !== null) {
          return () => {};
        }
        const tag = document.createElement('style');
        tag.dataset.plugin = '@local/running-session-highlight';
        tag.dataset.pluginCss = STYLE_TAG_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }

      const inject = ['slots', 'locale'];
      let t = (key) => key;

      function apply(ctx) {
        ctx.effect(start, STYLE_MOUNTED);
        ctx.effect(() => {
          applyAccent(storedAccent());
          return () => applyAccent(null);
        }, 'running-session-highlight: applied accent');
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'running-session-highlight: dictionaries');
        t = ctx.locale.bind(NS);
        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'running-session-highlight',
              order: 15,
              locale: NS
            },
            RunningRowColorRow
          )
        );
      }

      return {
        inject,
        apply,
        __test: {
          CSS,
          STYLE_TAG_ID,
          STORE_KEY,
          DEFAULT_HEX,
          ACCENT,
          PRESETS,
          ROW_SELECTOR,
          SPINNER_SELECTOR,
          storedAccent,
          applyAccent,
          effectiveAccent
        }
      };
    }
  });
})();
