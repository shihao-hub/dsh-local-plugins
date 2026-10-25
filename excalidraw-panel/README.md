# `@local/excalidraw-panel`

左侧边栏「**画板**」入口 + 主区 **Excalidraw 白板**面板。面板把
[excalidraw.cn](https://excalidraw.cn/) 以 `<iframe>` 直接嵌进 DeepSeek Harness，
不必离开当前界面即可手绘架构图、流程图与草图。

## 行为

| 位置 | 内容 |
| :--- | :--- |
| 侧栏面板列表 | 位于「接口」与「设置」之间的「画板」行（`order: 25`） |
| 主区面板 | 顶栏：标题、自动保存提示、「刷新」、「浏览器打开」；下方为嵌入的 Excalidraw |
| 右栏「开始」页 | 「Excalidraw 画板」卡片（与「工作区文件」「新建终端」同排，`guide order: 25`）；点击后在右栏打开画板标签页，与对话同屏，不替换主区 |
| 数据保存 | Excalidraw 自身的 localStorage 自动保存（iframe 独立 origin），刷新面板或重启应用都不丢 |
| 加载反馈 | iframe `load` 前显示加载遮罩；12 秒仍未完成时提示检查网络 |

右栏标签页通过 `ctx.sidebarRightTabs.register` 注册一个 `kind: 'excalidraw'`、`id:
'excalidraw-panel'` 的类型，并带 `keepMounted: true`：从画板切到别的标签再切回来，iframe
不会重载。标签内容与标题分别注册在 `sidebar.right.pane.tab` / `.title`，其 `key` 必须等于
**类型 id**（`excalidraw-panel`）——宿主 `TabSlot` 的 `entryKey` 取的是定义 id，不是 kind。

「浏览器打开」调用 `window.open`，在系统默认浏览器中打开同一个站点；宿主若拦截弹窗，
面板本身不受影响。

## 站点为何用 iframe

- `excalidraw.cn` 是官方 Excalidraw 的中文镜像，响应头没有 `X-Frame-Options`，也没有
  `frame-ancestors` CSP，可以安全嵌入。
- 不引入 `@excalidraw/excalidraw` 依赖，因此不需要构建步骤，插件本身就是可读的
  `client.js`。
- 不加 `sandbox` 属性：Excalidraw 需要 localStorage、IndexedDB、剪贴板与下载能力；
  加沙箱会让画板无法保存。

## 注册

本插件与仓库内其他本地插件一致，走 profile 的 bundle 列表：

1. `~/.dsh/profiles/<profile>/node_modules/@local/excalidraw-panel` 指向本目录；
2. profile `package.json` 的 `dependencies` 声明 `link:D:/Users/dsh-local-plugins/excalidraw-panel`；
3. profile `package.json` 的 `dsh.profile.bundles` 加入 `@local/excalidraw-panel`
   （本插件自带 `cordis.patch.yml`，插入 id 为 `excalidraw-panel`）。

宿主启用 HMR 时会监听 profile 清单与 patch，改动 `bundles` 后自动重组；浏览器端
Client HMR 会推送新的插件图。若页面未出现入口，刷新页面（F5）即可；仍未出现再重启应用。

## 自测

```powershell
node D:\Users\dsh-local-plugins\excalidraw-panel\self-test.mjs
```

零依赖：在 `node:vm` 中执行 `client.js`，校验 slot 注册（`main` key 与侧栏 id 一致、
`order: 25`）、右侧栏标签类型（`kind`/`id`/`guide`/`keepMounted` 与 pane.tab 的 key 对齐）、
站点常量、中英字典键一致与关键 CSS。

## 文件

| 文件 | 职责 |
| :--- | :--- |
| `client.js` | 浏览器半区：侧栏图标、主面板、iframe、i18n 与样式 |
| `index.js` | 宿主半区：空 `apply`，只需能被 profile patch 解析 |
| `cordis.patch.yml` | bundle 的插入行（`id: excalidraw-panel`） |
| `icon.svg` | 插件图标（铅笔 + 画板，品牌蓝） |
| `self-test.mjs` | 零依赖结构自测 |
