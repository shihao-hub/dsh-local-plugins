# 工作区隐藏（`@local/workspace-hide`）

把不常用的 Workspace 从侧栏**隐藏**，而不是删除。工作区注册、会话日志、项目目录都不动；隐藏项随时可以从视图选项菜单、设置页或撤销提示恢复。

## 为什么需要它

宿主的「工作区 …」菜单只有「重命名 / 删除工作区」两项，删除虽然不删目录，但会移除工作区注册、组内会话掉进「未分组」，恢复成本很高。本插件补的正是「暂时不想看到、但也不想删」这一档。

## 怎么用

| 动作 | 入口 |
| :--- | :--- |
| 隐藏 | 工作区行 `…` → 隐藏工作区（位于「重命名」与「删除工作区」之间） |
| 恢复 | 视图选项（筛选）菜单 → 工作区 → 管理已隐藏工作区（N）… |
| 恢复 | 设置 → 通用设置 → 工作区隐藏 → 管理已隐藏工作区（N） |
| 撤销 | 隐藏后 3 秒内点底部提示的「撤销」 |

管理浮层列出每个隐藏工作区的名称、路径与会话数，支持单项恢复与全部恢复。隐藏一个工作区会连同它的组头、子工作区（按工作区树）和会话一起从侧栏收起；单列表模式下则隐藏归属它的会话行。搜索、最近会话、新会话工作区选择器**不受影响**，仍然可以正常打开隐藏工作区的会话。

## 宿主没有扩展点，所以走渲染层

宿主 `dsh-client-ui-workspace` 0.2.1-rc.2 只给**会话行**开放 `sidebar.workspaces.session.menu.item` / `.row.action` 两个列表 slot；工作区行的菜单项（`rename` / `delete`）与「视图选项」菜单项都是组件内部写死的数组，`WorkspaceView` 也没有 hidden/archived 字段。因此本插件不改宿主数据，只在渲染结果上做三层处理：

1. **菜单增强**：`mousedown` 捕获阶段记录锚点（工作区行内按钮 / 视图选项按钮），`MutationObserver` 发现新 `role="menu"` 后，克隆已有菜单项的 DOM 结构追加新项（工作区菜单插在删除之前；视图菜单追加「工作区」分组）。点击注入项后派发 `Escape` 关闭宿主菜单（实测宿主菜单会响应文档级 Escape）。
2. **行过滤**：工作区行 → `span`（行包装）→ `groupSection`（组容器）的结构是稳定的；组容器加 `data-wh-group-hidden`（CSS `display:none !important`）即整组收起。单列表模式没有工作区行，按 `workspaces.list` 的 `sessionIds`（`sessions.list.cwd` 兜底）给会话行加 `data-wh-row-hidden`。
3. **状态**：只存 workspaceId 集合。localStorage 负责首屏即时渲染，Host 半区路由负责跨浏览器持久化（`$DSH_HOME/workspace-hide/state.json`，临时文件 + rename 原子写）。桌面构建没有 webServer 时静默退回 localStorage。

所有注入都包 `try/catch`：宿主结构变化时最多退化成「菜单不注入」，设置行与管理浮层仍然可用，界面不报错。

## 数据与持久化

- `localStorage['workspace-hide.v1']`：`{ hidden: ["<workspaceId>", ...] }`
- Host：`GET/PUT /plugins/workspace-hide/state`（`x-workspace-hide` guard、同源 Origin 校验、1MB 上限）
- 落盘：`$DSH_HOME/workspace-hide/state.json` → 默认 `~/.dsh/workspace-hide/state.json`
- 工作区快照就绪后会清理已不存在工作区的 id；删除工作区不会留下幽灵隐藏项。

## 已知边界

- 隐藏只在**侧栏浏览层**生效：搜索结果、最近会话、新会话工作区选择器仍会列出隐藏工作区。
- 隐藏当前会话所在工作区时，主区对话不受影响，只是侧栏不再显示该会话行。
- 菜单注入项是克隆出来的原生按钮，不是 React 节点：点击与聚焦正常，宿主菜单的键盘漫游行为以宿主实现为准。
- 视图菜单注入依赖「项数 ≥ 5」与「视图选项」按钮的 aria-label；宿主若改文案/结构，注入会静默跳过，设置行仍可管理。

## 文件

| 文件 | 职责 |
| :--- | :--- |
| `client.js` | 客户端半区：菜单注入、组/行过滤、管理浮层、toast、设置行、状态与持久化 |
| `index.js` | Host 半区：`$DSH_HOME` 状态文件 + 同源路由 |
| `cordis.patch.yml` | 把插件插进 profile 的 loader |
| `locale/en.json`、`locale/zh.json` | 设置页插件显示名与简介 |
| `self-test.mjs` | 零依赖用例（`node self-test.mjs`，56 项） |

## 自测

```powershell
cd D:\Users\dsh-local-plugins
node workspace-hide\self-test.mjs
```

## 恢复方式

- 从视图选项菜单 / 设置行恢复被隐藏的工作区；
- 卸载插件后，侧栏立即恢复全部工作区（插件只在 DOM 上加属性/样式，不写宿主数据）；
- 如需清空本插件状态：删除 `~/.dsh/workspace-hide/state.json` 与浏览器上的 `workspace-hide.v1`。
