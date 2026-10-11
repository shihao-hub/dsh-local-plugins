# DeepSeek Harness 本地模组/插件库 (`dsh-local-plugins`)

> [!CAUTION]
> **重要保护目录 · 严禁删除**
> 本目录下**已注册**的插件已被 DeepSeek Harness 桌面客户端（`~/.dsh/profiles/desktop`）以符号链接/Junction 强依赖运行；`.archived/` 下是已注销的历史插件源码，不参与运行，同样请保留。
> 若日常清理 `default-workspace` 中的抓取视频、临时文档、OCR 产物或游戏资源时，**请务必保留此 `dsh-local-plugins` 目录**！

---

## 插件索引列表

| 插件目录 | 插件包名 (`id`) | 职责描述 |
| :--- | :--- | :--- |
| [`rider-theme`](./rider-theme) | `@local/rider-theme` | JetBrains Rider Dark 调色板与外观配置插件，支持在通用设置中一键切换。 |
| [`skills-panel`](./skills-panel) | `@local/skills-panel` | 左侧边栏 Skills 技能面板，展示当前会话挂载可用的 Agent 技能。 |
| [`mod-renamer`](./mod-renamer) | `@local/mod-renamer` | 将 Harness 界面所有「Plugins / 插件」文案替换为「模组 (mods)」。 |
| [`app-restart`](./app-restart) | `@local/app-restart` | 底部状态栏/快捷菜单一键平滑重启 Harness 桌面应用插件。 |
| [`window-memory`](./window-memory) | `@local/window-memory` | 记住桌面主窗口大小与位置，下次启动自动恢复（实时去抖持久化到 `%LOCALAPPDATA%\dsh-window-memory`）。 |
| [`model-favorites`](./model-favorites) | `@local/model-favorites` | Composer 模型选择器的 Zed 风格「收藏」：置顶收藏分组、行内星标切换、右侧 provider 小字标注。 |
| [`mcp-panel`](./mcp-panel) | `@local/mcp-panel` | 左侧边栏「接口」面板（MCP）：汇总已配置的 MCP 服务器（stdio/HTTP、命令或 URL、超时/重连配置）与各服务器实时注册的工具清单。 |
| [`expand-all-sessions`](./expand-all-sessions) | `@local/expand-all-sessions` | 侧边栏会话列表**默认全量加载**：定位到承载 `sessionLimits` 的 React fiber，直接 dispatch 一次把每个 Workspace 分组的 limit 写成 `Infinity`（不再逐页模拟点击、无中间态抖动）；手动折叠仍归原生语义，折叠后再点「展开其余」同样直接全量。 |
| [`pin-highlight`](./pin-highlight) | `@local/pin-highlight` | 侧边栏置顶图钉着色：把置顶图钉由 caption 灰改为琥珀色（静置与 hover 两态均覆盖），并在通用设置提供色盘（预设+自定义+复位）；纯 CSS 注入，不触碰 DOM 与原生行为。 |
| [`active-session-highlight`](./active-session-highlight) | `@local/active-session-highlight` | 侧边栏当前会话行高亮：整行 18% 同色底纹（无左条/无边框；原生把「选中」与「hover」写成同一条 token，Rider Dark 下几乎零差异），并在通用设置提供色盘（预设+自定义+复位）；纯 CSS 注入。 |
| [`settings-button`](./settings-button) | `@local/settings-button` | 把「设置」入口搬到侧栏顶部面板列表（与模组/技能/接口同排）；左下角账号菜单里原有的「设置」项仅隐藏（账号按钮、意见反馈、退出登录全部保留），点击新入口等价于点原来那一项，设置面板照旧打开。 |

---

## 已归档插件

以下插件已于 2026-10-11 从 desktop profile 注销，源码整体移入 [`.archived/`](./.archived)，git 历史保留（`git log --follow` 可追溯）：

| 归档目录 | 原包名 (`id`) | 说明 |
| :--- | :--- | :--- |
| [`.archived/startup-maximize`](./.archived/startup-maximize) | `@local/startup-maximize` | 桌面应用启动后自动最大化主窗口 |
| [`.archived/thoughtdag-companion`](./.archived/thoughtdag-companion) | `@local/thoughtdag-companion` | ThoughtDAG 伴生模组（其宿主 `dsh-thoughtdag` 一并注销） |
| [`.archived/traj-translate`](./.archived/traj-translate) | `@local/traj-translate-v4` | 轨迹检查器「AI 翻译」标签 |

恢复方式见 [`.archived/README.md`](./.archived/README.md)。

---

## 依赖关系与挂载方式

- **Profile 声明**：`~/.dsh/profiles/desktop/package.json`
- **Junction 软链**：`~/.dsh/profiles/desktop/node_modules/@local/*` $\rightarrow$ `default-workspace/dsh-local-plugins/*`
- **Cordis 装载**：通过各插件目录下的 `cordis.patch.yml` 注入，`client.js` 作为浏览器半区，`index.js` 作为宿主半区。
- **包管理归属**：desktop profile 的插件装卸由 Electron 应用负责（`dsh plugin --profile desktop` 会被拒绝）；手工注销 = 改 `package.json` 的 `dependencies` + 清理 `node_modules/@local/*` 链接。
