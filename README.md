# DeepSeek Harness 本地模组/插件库 (`dsh-local-plugins`)

> [!CAUTION]
> **重要保护目录 · 严禁删除**
> 本目录下的所有插件已被 DeepSeek Harness 桌面客户端（`~/.dsh/profiles/desktop`）以符号链接/Junction 强依赖运行。
> 若日常清理 `default-workspace` 中的抓取视频、临时文档、OCR 产物或游戏资源时，**请务必保留此 `dsh-local-plugins` 目录**！

---

## 插件索引列表

| 插件目录 | 插件包名 (`id`) | 职责描述 |
| :--- | :--- | :--- |
| [`rider-theme`](./rider-theme) | `@local/rider-theme` | JetBrains Rider Dark 调色板与外观配置插件，支持在通用设置中一键切换。 |
| [`skills-panel`](./skills-panel) | `@local/skills-panel` | 左侧边栏 Skills 技能面板，展示当前会话挂载可用的 Agent 技能。 |
| [`traj-translate`](./traj-translate) | `@local/traj-translate-v4` | 轨迹检查器「AI 翻译」标签，为思考过程与原始内容提供 1:1 独立中文翻译面板。 |
| [`mod-renamer`](./mod-renamer) | `@local/mod-renamer` | 将 Harness 界面所有「Plugins / 插件」文案替换为「模组 (mods)」。 |
| [`app-restart`](./app-restart) | `@local/app-restart` | 底部状态栏/快捷菜单一键平滑重启 Harness 桌面应用插件。 |
| [`startup-maximize`](./startup-maximize) | `@local/startup-maximize` | 桌面应用启动后自动将主窗口最大化（Win32 层安全触发，仅限桌面壳运行时生效）。 |

---

## 依赖关系与挂载方式

- **Profile 声明**：`~/.dsh/profiles/desktop/package.json`
- **Junction 软链**：`~/.dsh/profiles/desktop/node_modules/@local/*` $\rightarrow$ `default-workspace/dsh-local-plugins/*`
- **Cordis 装载**：通过各插件目录下的 `cordis.patch.yml` 注入，`client.js` 作为浏览器半区，`index.js` 作为宿主半区。
