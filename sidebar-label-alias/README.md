# sidebar-label-alias

把侧栏全局面板里的官方项「自动化任务」显示为「任务」，让这一列回到和其它项一致的两字节奏
（模组 / 技能 / 任务 / 接口 / 画板 / 设置 / 标签）。

## 为什么是 DOM 层

这一项由 `@deepseek-ai/dsh-client-ui-schedule` 通过 `sidebar.panellist` slot 注册，
label 来自它自己的 locale 命名空间 `schedule.catalog` 的 `panel` 键。插件层没有可写的覆盖点：

| 思路 | 结果 |
| :--- | :--- |
| `ctx.locale.register('schedule.catalog', { zh, en })` | 同一命名空间同一语言重复注册会直接抛错（`locale namespace "x" already has locale "zh"`），拿不到宿主注册的 disposer |
| 改 `ctx.slots.entriesOfSlot('sidebar.panellist')` 里那一项的 `options.label` | 注册项只读；宿主在 `syncPanels` 里把解析后的 label 落进自己的 snapshot store，改 options 不会触发重渲染 |
| 直接改 `node_modules` 里的 `zh.json` / `client.js` | 升级即丢，且污染官方包 |

所以本插件只改渲染结果，并用 MutationObserver 兜住 React 回写。

## 边界

- **只动 `<nav>` 内的面板行**：`aria-label` 与承载标题的 `<span>`。
- 页面标题（h1）、空状态（"还没有自动化任务…"）、搜索占位符、任务卡片、提醒 aria
  等其它同名文案保持官方原文。
- 折叠态没有标题 span，此时唯一可见的是悬停提示，脚本改的是 `[role="tooltip"]` 里的文本节点，
  不重建节点、不碰定位。

## 换词

改 `client.js` 顶部的两个常量（当前用 `\u` 转义书写，注释里是中文原文）：

```js
const FROM = '\u81EA\u52A8\u5316\u4EFB\u52A1'; // 自动化任务
const TO   = '\u4EFB\u52A1';                    // 任务
```

两字候选：`任务`、`定时`、`计划`、`提醒`、`日程`。改完刷新页面即可（已挂载的字典/observer 不需要重装）。

## 注册

本目录按本地插件惯例挂在 profile 上：

1. `~/.dsh/profiles/<profile>/package.json`
   - `dependencies` 增加 `"@local/sidebar-label-alias": "link:D:/Users/dsh-local-plugins/sidebar-label-alias"`
   - `dsh.profile.bundles` 增加 `"@local/sidebar-label-alias"`
2. `~/.dsh/profiles/<profile>/node_modules/@local/sidebar-label-alias` 建 Junction 指向本目录
3. 重启该 profile 的宿主（`dsh web` / 桌面应用）后生效

## 验证

```powershell
# 页面里应能看到 7 个面板项，其中第 3 项文本为「任务」且 aria-label 同为「任务」
# 页面 h1 仍是「自动化任务」
```
