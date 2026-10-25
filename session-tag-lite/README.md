# `@local/session-tag-lite` — 会话标签（轻量，不接管侧栏）

给会话打标签的前端插件，形态参考 typeai WebUI 的「添加标签」：固定 `待办 / 归档` 语义、自由标签 + 全库标签池、截止日期，并在浮层面板里按标签浏览会话。

**左侧会话列表原样保留**——只占用宿主开放的座位（行尾按钮、`…` 菜单项、悬停卡片、浮层、顶部面板列表），不 shadow `sidebar.workspaces`。标签由 **Host 半区持久化**到 `~/.dsh/session-tag-lite/state.json`，浏览器 localStorage 只作即时渲染的缓存：换浏览器、清站点数据都不丢。

---

## 入口

| 位置 | 行为 |
| :--- | :--- |
| 会话行 hover → **色盘**按钮 | 打开「会话标签」弹窗；色盘是该会话标签颜色的合成（1 个=纯色圆，≥2 个=等分扇区，无标签=空心圆） |
| 会话行 `…` → **标签…** | 同一弹窗（排在 `fork` 之后、`archive` 之前），glyph 也是同款小色盘 |
| 会话行悬停卡片 | 标签 chip（点击打开标签面板并预填搜索）+ 截止日期徽章（过期变红）+「编辑标签」 |
| 左栏顶部面板列表 → **标签** 图标 | 打开标签总览面板 |

> 刻意**不**在会话行行首（`sidebar.session.row.leading`）放色点：那个位置是宿主表达「未读 / 待回答 / 运行中」的状态点，再塞一个彩色圆点会被误读成状态。标签只出现在行尾色盘、悬停卡片、菜单与面板里。

弹窗里可以：新建标签（Enter，逗号分隔批量）、勾选/取消池中标签、删除本会话标签、设/清截止日期。改动即时保存，没有「保存/取消」两态。

## 标签总览面板

```
会话标签                                    ×
[ 搜索标签或会话 ]                          ← 同时匹配标签名与会话标题

▾ ● 待办        2      ← 组头：底色条 + 字重 600 + 计数 pill
   ├ 面试问答           ← 缩进 + 左侧 1px 引导线
   └ 为 typeai 添加…
▸ ○ 归档        0      ← 保留组始终显示，空组也留骨架
▸ ● 读书        5
▸ ○ 未打标      225    ← 默认折叠；展开先露 15 条 +「显示全部 225 个」
```

- 组头与会话行是**两级视觉**：组头 30px / 12px / 600 字重 / `bg-layer-2` 底；会话行 26px / 11px / secondary，hover 才升 primary。
- 子项缩进 13px + 1px 引导线（`--dsw-alias-border-l1`），和组头形成明确父子关系。
- `待办 / 归档` 在浏览态**始终存在**（哪怕 0 项），避免空组消失导致「看起来只剩两组」。
- `未打标` 默认折叠；点开后最多先显示最近 15 条，底部「显示全部 N 个」展开。搜索态下该组强制展开且显示全部命中。
- 搜索态只显示有命中的组，不出现一堆 0 计数。
- 点任一会话行 → 打开该会话并关闭面板。

## 数据模型

```js
// localStorage["session-tag-lite.v1"]
{ version: 1,
  tags: ['待办', '归档', '读书'],        // 全库标签池；保留名永远在最前
  marks: { '<sessionId>': ['待办', '读书'] },
  due:   { '<sessionId>': '2026-11-01' },  // 严格 YYYY-MM-DD，脏值读取时丢弃
  collapsed: { '待办': true, '__untagged__': false },  // true=折叠，false=显式展开
  colors: { '读书': '#7fc4bd' } }          // 自定义标签的颜色；缺省回退名字哈希
```

- 标签名读取时 trim、截断到 24 字符、去重；`marks` 引用到的名字自动回填标签池。
- **孤儿标签自动清理**：池里已无任何会话使用、且不是 `待办/归档` 的名字，在下次写入时消失（typeai 也没有"删除标签"界面）。
- 同一份数据也由 Host 落盘（见下节），localStorage 是它的本地镜像。

## 持久化（跨浏览器）

Host 半区注册一条同源路由，读写 `$DSH_HOME/session-tag-lite/state.json`（默认 `~/.dsh/session-tag-lite/state.json`，临时文件 + rename 原子替换）：

| 请求 | 行为 |
| :--- | :--- |
| `GET /plugins/session-tag-lite/state` | `{ ok, revision, data }`；无存档时 `data: null` |
| `PUT /plugins/session-tag-lite/state` | body `{ data }`，持久化后返回 `{ ok, revision }` |

两条请求都必须带 `x-session-tag-lite: 1` 头（跨站表单拼不出来），且只接受同源 `Origin`。

Client 的同步策略是**本地优先**：

1. 启动时先渲染 localStorage（瞬时），再 `GET` 远端。
2. **本地为空、远端有数据**（新浏览器 / 清过站点数据）→ 用远端恢复。
3. **本地有数据** → 保持本地并 `PUT` 覆盖远端。这样另一个客户端的空状态或旧状态不会把本机标签抹掉。
4. 之后每次改动（含新建/删除标签、改色、截止日期）都在 300 ms 防抖后 `PUT` 整份状态。

路由不可用（desktop 构建没有 `webServer`，或 `GET` 非 2xx）→ 整个插件静默退回纯 `localStorage` 单机模式，行为不变。

边界：两个浏览器同时编辑同一会话时是「最后写赢」；跨设备需要自行同步 `~/.dsh` 数据目录。路由只在本机 loopback 上、靠自定义头挡住跨站请求，不做额外的用户认证。

## 颜色

- `待办` = 琥珀 `#d9a441`，`归档` = 灰 `#9a9ca0`，固定不可改。
- 其余 7 色环：雾蓝 / 灰绿 / 藕紫 / 陶红 / 青碧 / 沙棕 / 蓝紫灰。
- **新建标签自动选色**：优先完全没被用过的颜色，其次用得最少的（并列取环内靠前），所以连着建三个标签不会撞色。
- **改色**：编辑器里点标签 pill 上的小色点 → 展开 7 色板 → 选一个；改的是该标签的全局颜色，行尾色盘立即跟着变。
- 旧数据没有 `colors` 字段时按名字哈希取色（升级后观感不变）；标签从池里消失时它的颜色记录一并清理。

## 与 `session-tags` 的区别

| | `session-tag-lite`（本插件） | `@local/session-tags` |
| :--- | :--- | :--- |
| 左侧栏 | **不接管**，原生列表不动 | 整块接管 `sidebar.workspaces`，渲染标签树 |
| 标签模型 | 扁平字符串 + 固定状态语义 | 标签实体 + 父子层级 + 7 色板 |
| 打标签 | 行按钮 / `…` 菜单 / 悬停卡片 | 另有拖拽打标、标签树拖放 |
| 浏览 | 浮层面板（可搜索、可折叠、未打标收敛） | 右栏标签树页 + 左栏多种分组方式 |
| 适用 | 想保留原生侧栏、只要"贴标签 + 按标签找" | 想把标签当主浏览结构 |

两者 id / order / localStorage 键完全独立，**可以并存**（会各出一组按钮）。

## 已知限制

- 「搜索命中标签」实现在插件面板内：宿主左栏搜索框由 `ui-workspace` 内部持有，没有注册点，插件无法让宿主搜索结果包含标签。
- 标签是扁平字符串，没有父子层级；真层级留给后续「路径式标签」方案。
- 「显示全部 N 个」是一次性渲染（实测 223 行 ≈ 6200px 滚动区）；会话数上千前够用，没有做虚拟化。
- 多浏览器同时编辑同一会话时最后写赢（本地优先，不会互相清空）；跨设备需同步 `~/.dsh`。
- 删标签无撤销。
- 面板打开时宿主会话行被虚拟列表卸载也不影响：所有读写只按 `sessionId`，不持有 DOM。

## 回归测试

```powershell
cd D:\Users\dsh-local-plugins\session-tag-lite
node self-test.mjs        # 48 项零依赖用例
node --check client.js    # 语法
```

覆盖：存储规范化与脏数据兜底、孤儿标签清理、保留名保护、mark 自愈、标签读写、`isCollapsed` 默认折叠语义、取色（固定语义色 / 显式颜色优先 / 非法色回退哈希）、新建标签自动配色、`setTagColor` 落盘与保留名不可改、`colors` 只保留池内合法值、截止文案与过期判定、面板模型（跳过 blank/缺失 id、保留组骨架、搜索态过滤、标题与标签名命中、组内倒序）、订阅通知、localStorage 抛错退化。DOM / React 座位交互不在测试范围内。

## 宿主契约依赖

- `ctx.slots.inject/register`：`sidebar.workspaces.session.row.action`、`sidebar.workspaces.session.menu.item`、`sidebar.session.row.hover`、`shell.overlay`×2、`sidebar.panellist`、`main`（**不注册** `sidebar.session.row.leading`）。
- `ctx.sessions.list`（`SnapshotStore<SessionListState>`）：只读会话快照，读取不激活任何 Session。
- `ctx.uiWorkspace.openSession(id)`：从面板打开会话。
- `ctx.layout.selectPanel(null)`：`main` 兜底重定向（防止键盘把主面板切到空白键位）。
- Host 半区 `inject: ['webServer']` + `ctx.webServer.register({ kind: 'exact', path: '/plugins/session-tag-lite/state' })`；`webServer` 不存在时插件不激活，Client 自动退回 localStorage。
- 颜色只用 `--dsw-alias-*` token + `color-mix`；不依赖宿主 CSS Module 类名，不写 `data-*`。
