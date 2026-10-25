# `@local/session-tags` — 会话标签（纯前端，左侧标签分组）

左侧栏仍是宿主那套浏览区：段头（标题 + 搜索 + 滑块菜单 + 新建工作区）、34px 工作区分组行、
32px 会话行、hover 时时间让位给动作按钮。**唯一的差别是「分组方式」里多了标签**：

| 分组方式 | 结果 |
| :--- | :--- |
| 按工作区 | ≈ 宿主原生默认 |
| **按工作区 + 标签**（默认） | 工作区 → 标签 → 会话；没打标的会话落在该工作区下的「未打标」 |
| 按标签 | 标签树（支持父子标签）→ 会话 |
| 单列表 | 不分组的平铺 |

排序：最近更新 / 手动（工作区原顺序）。筛选：隐藏已归档 / 全部对话 / 仅显示已归档。

菜单入口跟原生**同一处**：段头右侧那枚滑块图标。切换分组/排序/筛选都在那里，
最后一项是「切换到原生列表」（随时回宿主原版；侧栏底部的 ▤ 也能双向切）。

标签只写浏览器 `localStorage`，不落宿主、不碰会话日志、不改宿主偏好。卸掉插件宿主侧零残留。

---

## 为什么必须接管整块，而不是"在原生树里加一层标签"

- 会话列表是 `dsh-client-ui-workspace` 内部组件渲的；你看到的分组方式（按工作区 / 按工作区树 /
  单列表）是它内部的枚举，**没有对外注册点**，插件加不进第四项。
- 它对插件开放的只有 5 个座位：行首 16px 装饰、行尾 hover 按钮、「…」菜单项、悬停卡片段落、
  以及**整块替换** `sidebar.workspaces`。没有"改顺序 / 插分组标题"的钩子。
- 所以要么只做行内装饰（结构不动，左侧不会出现标签树），要么整块替换。本插件选后者，
  并把替换后的渲染做得跟原生同构——同一套行高、hover 行为、段头控件位置。

接管机制：`sidebar.workspaces` 是 `single` 槽位，规则是「同一格位里**优先级最低**的活项渲染」，
宿主浏览区在 `priority 0`，本插件用 `priority: -1`。切换是运行时的：撤掉登记，宿主立刻复活。

## 打标签的入口

- **左栏会话行 hover** → 标签按钮（打开勾选弹窗）；在标签分组下还有「从该标签移除」。
- **拖拽**：把会话行拖到任意标签行上即打标，拖到「未打标」即清空。
- **原生列表模式下**：行「…」→「标签…」、行悬停卡片里的标签 chip。
- 标签本身在同一个弹窗里新建：名字 + 7 色色板 + 父标签（支持任意层级）。

## 数据模型

```js
// localStorage["session-tags.v1"]
{ seeded: true,
  tags: [{ id: 't…', name: '待办', color: 'amber', parentId: null }],
  marks: { '<sessionId>': ['t…'] } }

// localStorage["session-tags.view.v1"]      分组 / 排序 / 筛选
// localStorage["session-tags.collapsed.v1"] 折叠状态
// localStorage["session-tags.sidebar.mode.v2"] 'tags' | 'native'
```

- 色板固定 7 色（amber/blue/green/red/purple/teal/gray），脏值读取时回落 `blue`。
- 指向已删除标签的 `marks` 不报错：读时按现存标签过滤，会话自动进「未打标」。
- 删除父标签时子标签**上提一级**，不会连带删掉整棵子树。

## 已知限制

- 「按工作区树」（目录树）模式没做；工作区重命名/删除、会话拖拽排序仍在原生列表里做。
- 会话行只有「打开 / 打标签 / 移除标签」；重命名、派生、归档走原生列表。
- 收起成图标栏（`wide === false`）时只渲染一个展开按钮。
- 标签只存在本机浏览器，不跨设备同步；删标签无撤销。

## 回归测试

```powershell
cd D:\dsh-local-plugins\session-tags
node self-test.mjs
```

23 项零依赖用例：存储规范化与坏数据兜底、快照未就绪、空白会话/缺失 id 跳过、跨工作区去重、
已删标签过滤进「未打标」、归档/运行态/更新时间带出、标题筛选、父子标签与孤儿标签升格、
多标签重复归属、左栏模式读写与切换。DOM 与 React 座位交互不在测试范围内。

## 宿主契约依赖

- `ctx.sessions.list` / `ctx.workspaces.list`：只读快照，读取不激活任何 Session。
- `ctx.slots.register({ name: 'sidebar.workspaces', priority: -1 })`：单值座的影子登记（最低优先级渲染）。
- `ctx.sidebarRight.mounted`：当前屏幕上的 Session（行高亮）。
- `ctx.uiWorkspace.openSession` / `startSession(workspaceId)` / `pickDirectory`。
- `ctx.workspaces.create({ path })`：新建工作区。
- 宿主类名是 CSS Module 哈希，本插件**不**依赖任何宿主类名、不写 `data-*`、不改内联样式。
