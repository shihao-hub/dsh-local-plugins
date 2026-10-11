# active-session-highlight（`@local/active-session-highlight`）

让侧栏「工作区」列表里的**当前打开会话**一眼可辨。

## 为什么需要它（根因，均从 `app.asar` 反编译核实）

原生把「当前会话行」和「鼠标悬停行」写成了**同一条声明**（`dsh-client-ui-workspace/lib/client.js`，内联 `Rows.module.css`）：

```css
.hIlkoa_projectRow:hover, .hIlkoa_sessionRow:hover, .hIlkoa_sessionRow.hIlkoa_selected {
  background: var(--dsw-alias-interactive-bg-hover);
}
```

- 该 token 实测值（`dsh-client-ui-theme/lib/client.js`）：原生深色 `#ffffff14`（≈8% 白）、原生浅色 `#2631480f`（≈6% 深蓝）。
- **JetBrains Rider Dark（rider-theme）覆写为 `#2a2d2e`，而侧栏底色 `--dsw-specific-sidebar-fill` 是 `#2b2b2b`** → 两者只差 (-1,+2,+3)，选中态客观不可辨。
- 由于 hover 与 selected 共用同一 token，**任何 token 数值都无法让两者分开**：把值调亮只能让「悬停可见」，仍然分不清「我在哪个会话」。

所以本插件另开一条颜色通道，且**刻意不消费 `--dsw-alias-interactive-bg-hover`** —— 主题侧对 hover 的修正与本高亮互不影响。

## 做法

对唯一一个满足条件的行加装饰：

```css
div[data-row-key^="session:"][aria-selected="true"] {
  background: var(--dsw-specific-sidebar-nav-item-active, #43454a);  /* color-mix 兜底 */
  background: color-mix(in srgb, var(--dsh-active-row-accent, var(--dsw-alias-state-business-primary, #4176e6)) 18%, transparent);
  color: var(--dsw-alias-label-primary);
}
```

- **只上一档 18% 同色底纹，不加左条/边框**（主家决定）：条是 VSCode/Rider 的惯例，用于底纹很淡时指出「是哪一行」；这里 18% 已经把整行托出来了，条没有承担信息量。
- v1 曾用 `box-shadow: inset 3px 0 0 0 …`——会话行的 `border-radius: var(--dsw-radius-md)` **会把 inset 阴影一起弯**，3px 条渲染成游离的 `(` 括号，观感是错的，故撤掉。若日后要恢复"行首竖线"，需用 `::before` 画方头直条，不要再走 inset 阴影。
- 选择器特异度 (0,2,1) > 原生 `:hover` / `.selected` / `.menuOpen` 的 (0,2,0)：悬停或展开右键菜单时高亮不会掉回弱底色，也不依赖样式表插入顺序。
- 只改 `background`，不碰任何原生几何（无 `box-shadow`、无 `border`、无 `transition`）。

### 合成底色实测（按上述 token 值计算）

| 主题 | 未选中（侧栏底色） | 默认强调色 | 选中行合成后 | ΔRGB |
| :--- | :--- | :--- | :--- | :--- |
| JetBrains Rider Dark | `#2b2b2b` | `#75beff` | `#384551` | (+13,+26,+38) |
| 原生深色 | `#1b1b1c` | `#7aaaff` | `#2c3545` | (+17,+26,+41) |
| 原生浅色 | `#f9fafb` | `#4176e6` | `#d8e2f7` | (-33,-24,-4) |

（原生 hover 仅 6%~8% 透明度；本方案 18%，静态下即可辨。上表是纯底纹合成值，不含任何描边。）

### 通用设置色盘

在「通用设置」页新增一行「当前会话高亮颜色」（`settings.general.item` slot，`order: 14`，紧邻 pin-highlight 的「置顶图钉颜色」）：

- **5 个预设色块**（与 pin-highlight 同一套色值，跨插件配色语言统一）：蓝 `#5b9dd9` / 琥珀 `#e2b341` / 绿 `#57ab5a` / 玫红 `#db61a2` / 青 `#56d4dd`
- **彩虹自定义块**：Chromium 原生色盘（HSV 面板 + 色相条 + 吸管 + HEX）
- **「默认」按钮**：仅在自定义后出现，一键回到主题 business 色（Rider Dark `#75beff` / 原生深色 `#7aaaff` / 浅色 `#4176e6`）
- 选择持久化到 `localStorage`（`active-session-highlight.accent`），启动自动恢复；改动通过 `<html>` 内联 `--dsh-active-row-accent` 即时生效，无需刷新

## 依赖的 DOM 契约（App 更新若改版需回来对照）

| 契约 | 出处 | 说明 |
| :--- | :--- | :--- |
| `div[data-row-key^="session:"]` | `Rows.module.css` / `SessionNodeItem` | 会话行宿主 |
| `aria-selected="true"` | `SessionNodeItem`：`aria-selected={selected}`，`const selected = node.id === currentId` | 唯一标记「当前打开会话」，不经过 CSS-module hash |

搜索结果卡片 `SearchResultItem` 同样有 `aria-selected`，但**没有 `data-row-key`** → 不在选择器范围内（本次刻意不覆盖）。

契约失效时插件静默退化为无效果，不报错。

## 与 pin-highlight 的关系

两者独立：置顶且当前打开的行会同时得到「琥珀图钉」+「本插件的左条/底纹」，是两个互不覆盖的语义通道。CSS 类前缀分别为 `.ash_*` 与 `.php_*`，无命名冲突。

## 验证方式

1. 静态：读 `client.js` 后 `new Function` 执行（纯 IIFE 脚本），桩 `window.__ModuleLoader__.load`，断言 `__test.CSS` 含 `[aria-selected="true"]`、`color-mix`、`18%`、`STORE_KEY`，且**不含** `box-shadow`／`--dsw-alias-interactive-bg-hover`。
2. 契约复核：从 `app.asar` 解包 `dsh-client-ui-workspace/lib/client.js`，确认 `data-row-key: \`session:${node.id}\``、`"aria-selected": selected`、`const selected = node.id === currentId` 仍在，且 `Rows.module.css` 仍无 `box-shadow`。
3. 运行期：重启后确认当前会话行出现左条+底纹、点击切换会话高亮跟随、悬停其它行只出现（较弱的）hover 底色从而与选中行可分、主题切换后默认色跟随、设置行选色即时生效且重启保持。

## 卸载

1. 删除 `~/.dsh/profiles/desktop/node_modules/@local/active-session-highlight` Junction
2. 从 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 移除 `@local/active-session-highlight`
3. 从同文件 `dsh.profile.bundles` 移除 `@local/active-session-highlight`（**只删依赖不删 bundles 项会在启动时解析失败**）
4. 重启 DSH
