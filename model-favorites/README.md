# @local/model-favorites

Composer 模型选择器的 Zed 风格「收藏」增强插件（纯客户端模组）。

## 功能

- **置顶收藏分组**：模型列表顶部固定「收藏 / Favorites」分组，跨 provider 收藏；列表为空时自动隐藏。
- **行内星标**：每个模型行 hover / 键盘聚焦时右侧出现星标，点击切换收藏（`stopPropagation`，不会误选模型，菜单保持打开）；已收藏的行常显金色实心星。
- **右侧 provider 小字**：每个模型行右端以 caption 色调显示所属 provider（`DeepSeek 账号` / `DeepSeek` / `zai-coding-cn` …），解决同名模型歧义（如 DeepSeek-V4.1-Flash 同时存在于账号与官方分组）与收藏区丢失分组上下文的问题。
- **搜索/键盘兼容**：收藏分组作为第一个分组参与模糊搜索过滤、↑/↓ 高亮、Enter/Tab 选中、粘性分组标题。
- **持久化**：`localStorage` 键 `@local/model-favorites:favorites:v1`（`provider/model` id 数组，插入顺序即展示顺序），重启保留、多标签同步。

## 实现原理（重要）

- 内置模型选择器由 `@deepseek-ai/dsh-client-ui-model-selection` 以默认 `priority: 0` 注册到 `conversation.input.model` 单席位插槽；插槽核心按「**最低 priority 渲染**」投影。本插件以 **`priority: -1`** 注册同席位实现无破坏遮蔽——停用/卸载本插件后原版选择器自动回归。
- 组件是内置 `ModelSelect` 的忠实拷贝 + 收藏扩展，数据与动作完全复用内置 `ctx.modelDirectories` 服务（每会话 `ModelDirectory`：目录加载、`select()` 提交、pending、错误 toast、子代理不可用判断全部原生行为）。
- 视觉复用 `@deepseek-ai/dsh-client-ui-primitives`（MenuSurface / MenuGroup / rankByName / observeStickyMenuGroups / 图标），CSS 为内置规则 `mfs_` 前缀重写 + caption/star 扩展。
- 触发按钮、根面板（模型/推理等级）、Effort 面板、`/model` 命令弹窗保持内置行为（弹窗未加收藏，后续可选）。

## 挂载方式

与其他本地模组一致：

1. `~/.dsh/profiles/desktop/package.json` → `dependencies` 加 `"@local/model-favorites": "link:D:/Users/dsh-local-plugins/model-favorites"`，`dsh.profile.bundles` 加 `"@local/model-favorites"`。
2. Junction：`~/.dsh/profiles/desktop/node_modules/@local/model-favorites` → 本目录。
3. 重启 Harness（或刷新 Web GUI）生效。

## 文件

| 文件 | 职责 |
| :--- | :--- |
| `client.js` | 浏览器半区：收藏存储、样式、`ModelSelect` 拷贝与席位注册 |
| `index.js` | 宿主半区占位（`apply() {}`），仅使 patch 可解析 |
| `cordis.patch.yml` | 插件装载声明（insert entry） |
| `icon.svg` | 插件图标（金星） |

## 已知边界

- 星标仅鼠标可点（`tabIndex: -1`），键盘路径保持内置模型（Enter 选中行）。
- 目录未加载的收藏项会被隐藏，目录恢复后自动重现；收藏 id 永不清理。
- 若内置 `ModelSelect` 大改版，需同步本拷贝（`priority -1` 遮蔽关系不受影响）。
