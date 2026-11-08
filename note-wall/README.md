# 便签墙（`@local/note-wall`）

左侧边栏「便签」入口 + 主区便签墙：随时把冒出来的灵感贴上去，之后再整理。数据存在本机浏览器，零宿主路由、零依赖、零构建。

## 交互

| 操作 | 方式 |
| :--- | :--- |
| 新增 | 顶部输入框，`Enter` 保存、`Shift+Enter` 换行，或点「贴上去」；提交后纸色自动轮转到下一种 |
| 换纸色 | 输入框左下 5 个色点（琥珀 / 薄荷 / 天空 / 樱粉 / 丁香） |
| 编辑 | 悬停卡片 → 铅笔按钮，或双击正文；`Ctrl/⌘+Enter` 保存、`Esc` 取消、失焦也保存；清空文本保存等于删除 |
| 置顶 | 悬停卡片 → 图钉按钮；置顶卡片固定在最前，其余按创建时间倒序 |
| 换色 | 悬停卡片 → 调色盘按钮，点一个色点 |
| 搜索 | 顶栏搜索框，命中片段用琥珀底纹标出；`Esc` 清空 |
| 删除 | 悬停卡片 → 垃圾桶按钮；底部弹出 6 秒「撤销」条 |
| 长文本 | 超过 9 行或 420 字自动折叠，点「展开全文 / 收起」 |
| 滚动 | 输入区固定在顶部，只有便签墙滚动；新贴的便签总会滚回可见位置 |

## 数据位置与边界

```text
localStorage['note-wall.v1']
{ version: 1, notes: [{ id, text, color, createdAt, updatedAt, pinned }] }
```

- 存在当前 origin（`http://127.0.0.1:11111`）的 localStorage：**换浏览器 profile、清站点数据或换端口就看不到旧便签**。
- 同源多标签页会同步：另一页写入后本页自动刷新列表（监听 `storage`）。
- 写入失败（配额满、隐私模式）时输入区边框转红并给出提示，不会静默丢改动。
- 单条上限 4000 字，整面上限 500 条；读取时逐条校验，坏记录与重复 id 会被丢弃/重编，不会整墙报错。

## 实现要点

- 纯 Client 插件：`client.js` 是 IIFE + `window.__ModuleLoader__.load`，宿主只解析 `index.js` 的 `apply()`。
- 座位：`main`（keyed，`key = note-wall`）+ `sidebar.panellist`（`id = note-wall`，`order = 26`）。两处同名，侧栏点击即派发主区面板。
- 样式全部走 `--dsw-alias-*` 主题 token：纸色用 `color-mix(in srgb, var(--nw-tint) 13%, var(--dsw-alias-bg-layer-1))` 与 token 混合，明暗主题自动跟随；不支持 `color-mix` 的浏览器退回 `bg-layer-1`（`@supports` 渐进增强）。
- 主按钮用 `--dsw-alias-button-primary-fill` + `--dsw-alias-label-primary-inverted`（Rider Dark 下 `--dsw-alias-brand-primary` 是近白色，白字会隐形，这是踩过的坑）。
- 布局用 CSS 多列瀑布流（`column-width: 246px`），卡片 `break-inside: avoid`；窄屏降为 210px 并隐藏快捷键提示。
- `prefers-reduced-motion` 下关闭抬升与缩放动效。

## 自测

零依赖，用 `node:vm` 跑真实 `client.js`：

```powershell
cd D:\Users\dsh-local-plugins\note-wall
node self-test.mjs
```

覆盖 109 项：模块/注册契约（两处座位、key/id 对齐、order、label）、中英字典键集一致、存储解析与重复 id 修正、排序规则、相对时间六档、搜索高亮、CSS 关键选择器与 token 使用。

## 安装与卸载

- 安装：`plugin_manager` 的 `install_bundle` 指向本目录（已装于 `web` profile）。
- 卸载：`plugin_manager` 的 `remove_bundle`；或在 profile 的 `package.json` 里删掉 `@local/note-wall` 依赖与 `dsh.profile.bundles` 条目，并清理 `node_modules/@local/note-wall` 链接。
- 数据：卸载不会删除 `localStorage['note-wall.v1']`，重装后便签仍在；要彻底清除需在浏览器站点数据里删掉该 key。
