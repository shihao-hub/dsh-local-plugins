# open-with-default-app（`@local/open-with-default-app`）

把「用系统默认应用打开」补在右侧预览里，**主入口是「右键那行路径」**。

- **预览头部那行路径**（`D:\Users\...\README.md`）：**右键出菜单**——「用默认应用打开」+「在资源管理器中显示」。这是主入口（鼠标本来就在路径上），可点信号只有一个：鼠标移到**路径文字**上时变右键光标（`cursor: context-menu`，且路径元素收窄到文字宽度，空白处不变光标）。**不加底色、不加额外 tooltip**（视觉上完全不动，避免观感噪音）。
- **右侧预览页签右键菜单**：一行「用默认应用打开」（`primitives.MenuItemButton`，与内置菜单行同款）；给「不是在预览文件、而是想从页签直接打开」的场合兜底。
- **预览空态**（格式不支持 / 内容过大）：放大形态的带字按钮「用默认应用打开」（整页唯一出口，保留文字）。

> **已撤掉的入口（2026-10-17，按用户取向）**：交付卡片 / 变更对照页的动作区按钮（`deliverables.file.actions` / `deliverables.review.file.actions`）与预览标题栏图标按钮。右键路径能覆盖同样的场景后，这两处只是重复噪音。卡片自身的既有能力（内置「打开方式 / 显示文件位置」）不受影响。

## 为什么需要它（现状空白，逐条可核）

内置 `ui-open-in-app` 已经能做「用默认应用打开」，但在预览侧有两个缺口：

| 缺口 | 依据（`@deepseek-ai/dsh-*`，0.2.0-rc.2） |
| :--- | :--- |
| 预览控件在 `desktop !== true` 时**整体不渲染**，而该值每页只读一次（首读时机不佳就整页没有控件） | `dsh-client-ui-open-in-app/lib/client.js:412-476, 564-591` |
| 预览失败为 `not-regular-file` / `not-found` 时，内置判定 `recourse === 'none'`，**一个动作都不给** —— 界面只剩「该路径不是普通文件，没有可显示的内容」这句死胡同 | `dsh-client-ui-sidebar-documentpreview/lib/client.js:173-183, 1009` |
| 预览头部那行路径**自身没有任何动作**（`primitives.PathLabel` 只是个 `title` 带全路径的 `span`），想「打开这个文件」只能去别处找按钮 | `dsh-client-ui-primitives/lib/index.js:3344-3380` |

本插件**不新增宿主路由**，只把宿主已有的能力接到这些位置上。

## 原理

| 环节 | 做法 |
| :--- | :--- |
| 预览头部**路径文本**右键菜单（主入口） | 那行路径是宿主 `PathLabel` 渲染的（插件改不了它的 JSX，也没有对应槽位），所以用**捕获阶段**的 `contextmenu` 委托：`closest('[data-textpreview-path],[data-path-label]')` 命中就 `preventDefault()` 接管，再用 `primitives.Menu` 的 **portal 模式**（`getAnchorRect` 直接给指针坐标）把菜单摆到鼠标处。路径取自该元素的 `title`（`PathLabel` 恒设 `title = 完整路径`），取不到时退回解析容器的 `data-textpreview-url` 资源地址；解析前先从 `data-owda-title` 还原被本插件改过的 `title` |
| hover 可点信号（**只改光标，禁碰布局**） | 注入一张样式表（`#open-with-default-app-path-hint`），**只含一条声明**：`cursor: context-menu`。另外**不加 hover 底色、不改 `title`、不加任何 tooltip**（用户 2026-10-17 明确否掉）；样式只命中 `data-textpreview-path`，不碰其它 `PathLabel` 实例。<br>⚠️ **布局红线**：一度写过 `width: fit-content; align-self: start` 想把光标收窄到文字宽度，结果把该元素从「撑满整行的 flex 子项」变成「内容尺寸」，**绕过了宿主的收缩 + 省略号机制**（宿主 `.dhJKeW_header{display:flex;height:38px;padding:0 6px 0 16px}`，路径元素靠撑满 + 自带 `min-width:0` 才收得住、才打 `data-path-clipped` 省略号），长路径直接溢出到面板外，看起来就是「整行错位」。**这条规则里永远不准出现 width / align-self / min-width / margin / padding**——self-test 有回归项逐字盯着。代价：右键光标覆盖整行宽度而非只覆盖文字，这是宿主布局决定的，插件不该为它动布局 |
| 预览空态 | 注册进 `sidebar.right.tab.document.unpreviewable`，props 里的 `absolutePath` 交给 `remote.session.openWorkspacePath({ path })` |
| 预览页签右键菜单 | 注册进 `sidebar.right.tab.menu.item`（`kind: list` / `scope: session`），**两条独立 id**：`…:menu`（动作行，`primitives.MenuItemButton`，点击先 `dismiss()` 再打开）+ `…:menu-toast`（提示条载体）。路径优先取 props 的 `absolutePath`，否则 `useResource(tab.contentId)?.value?.absolutePath`——与预览正文读的**同一份元数据资源**；不是文件资源就整行不渲染 |
| 为什么不用自己的宿主路由 | 宿主侧「OS 关联打开 + 路径校验 + 家庭/来源鉴权」都已存在；自建路由等于复制鉴权并绕过宿主的路径校验边界 |
| 为什么按钮不因 `available === false` 隐藏 | 该值是宿主每页读一次的缓存快照，可能因首读时机变成假值（见上表第 2 条）；真正的失败由父卡片既有文案与本次点击结果呈现 |
| 单飞 | 每个控件实例持一把 `createSingleFlight()` 闸门，飞行中重复点击只发一次请求 |
| 反馈 | 预览侧失败弹 `primitives.Toast`（3.2s，按 `key` 重放），文案带**真实失败原因**（`open.failedDebug: 打开失败：{detail}`）；卡片侧沿用父卡片的 `presented.*` 状态文案，不叠加提示 |
| 兜底 | `primitives` 的 `Button`/`Tooltip`/`Toast`/图标任一缺失就退化成原生元素；session remote 在点击时按候选表动态解析（见下条），任一取到即可；解析不到也**不隐藏按钮**（只留一条 warn），由失败提示如实报告 |
| session remote 的正确取法（**2026-10-17 实测定案**） | 唯一可靠入口是 **`ctx.get('remote.session')`**（reflect 的 store 里服务名就是点号名，`ctx.get` 不查 inject 账本，直接返回命名空间服务）；`ctx.get('remote')` 给的是 **remote 挂载对象**（只有 `$mount`/`$on`/`$host`，**没有** session 成员），对它取 `.session` 会走服务代理抛 `cannot get property "remote.session" without inject`——**这就是本插件「打开失败：系统默认应用没有接受该路径」的真正根因**（旧版把挂载对象排在第一位，第一步就抛，错误又被吞成 `false`）。`ctx.remote` 未 inject 时同样抛错，只能作为已 inject 宿主的兜底候选 |
| inject 声明是**启动闸门**，不是访问许可 | 本插件 `immediately: true`，与内置 `ui-open-in-app` 同批加载。实测把 `remote` / `remote.session` 写进 `inject` 会让整个 client 启动卡在 `web boot: 1 entry did not activate`（**页面直接进不去**）。所以 inject 保持 `['slots','locale']`，remote 只能在**点击时**用 `ctx.get(...)` 旁路取 |

## 依赖的宿主契约（App 更新若改版需回来对照）

| 契约 | 说明 |
| :--- | :--- |
| 槽 `deliverables.file.actions` / `deliverables.review.file.actions` | props：`{ actionUrl, available, pending, onAction(action, application?) }` |
| 槽 `sidebar.right.tab.document.actions` / `.unpreviewable` | props：`{ absolutePath }`（路径未被宿主映射时为空，此时不渲染） |
| 槽 `sidebar.right.tab.menu.item` | `kind: list` / `scope: session`；props：`{ tab, dismiss }` + 标准 kit（含 `useResource`）。**执行动作的行必须调 `dismiss()`** |
| `primitives.MenuItemButton` | `{ children, icon, disabled, onSelect }`；缺失时退化成 `role="menuitem"` 的原生按钮 |
| `primitives.Menu`（portal 模式） | `{ open, portal, getAnchorRect, onClose, autoFocus }`；`getAnchorRect` 直接返回指针坐标即可，不需要真实锚点参与布局。**缺失时整块不渲染**（不给假菜单） |
| `remote.session.openWorkspacePath({ path, action: 'reveal' })` | 与不传 action 同信封；宿主走 Explorer `/select,<path>`（定位并选中） |
| `remote.session.openWorkspacePath({ path })` | 返回信封 `{ ok, value:{ opened } }`；宿主校验路径后交 OS 文件关联 |
| `ctx.slots.inject(name, register)` + `locale: NS` | 槽位声明后才注册、并注入绑定了本插件词典的 `t` |

契约失配时的退化：控件不渲染或点击后弹失败提示，**不抛错、不影响其它界面**（控制台留 warn，且提示条直接带失败码/错误消息）。

> **根因复盘（2026-10-17，隔离实例 + 真实 0.2.0-rc.2 宿主实测）**：预览标题栏点「打开」→ 弹「打开失败：系统默认应用没有接受该路径」，**不是 Windows 关联坏了**，而是 `sessionRemote()` 第一步抛错被吞成 `false`：真实 ctx 上 `ctx.get('remote')` 给的是挂载对象，取它的 `.session` 会抛 `cannot get property "remote.session" without inject`；唯一可行入口从一开始就是 `ctx.get('remote.session')`。修好接线后同一按钮当场把 `AGENTS.md` 用 Typora 打开（宿主 `openWorkspacePath` → `explorer.exe` 全链路正常）。**教训**：把 Remote 失败降级成布尔的 `catch` 必须同时把原因报出来，否则一个接线错误会伪装成「系统关联问题」，排查方向会被带偏一整天。

> **与内置控件的关键差异（本机实测）**：内置的文件控件要先向宿主查「这个文件有哪些关联应用」，那条查询走 Windows Shell 的 `SHAssocEnumHandlers`；本机该 COM 调用对任意扩展名都返回 `E_FAIL`（`.js/.md/.txt/.png/.mp4` 全试过），于是内置菜单显示「无法获取应用列表」，主按钮退化成「显示文件位置（默认）」，**永远给不出"用默认应用打开"**。本插件不查列表，直接 `openWorkspacePath({ path })`（不传 `application`）→ 宿主 `openNativeAssociatedPath` → 交给 Explorer 做关联解析（等同双击），本机实测可用（临时 `.txt` 成功拉起记事本，`.md` 拉起 Typora）。注意区分：**目录**（工作区/文件树）那份「用 XX 打开」菜单来自固定目录表（编辑器/Git GUI/终端/文件管理器），走注册表探测，不受这个故障影响——两者菜单里出现的东西完全不同。

## 可调项（`client.js` 顶部常量）

| 常量 | 含义 |
| :--- | :--- |
| `TAB_MENU_ORDER` | 页签右键菜单里的排序（默认 `10`，排在内置布局动作之后） |
| `PATH_LABEL_SELECTOR` | 认定为「预览头部路径」的选择器（默认 `[data-textpreview-path],[data-path-label]`；宿主改标记时改这里） |
| `HINT_STYLE_ID` | 注入样式表 id（`open-with-default-app-path-hint`；**只含 `cursor:context-menu` 一条声明**，任何布局属性都不准加） |
| `TOAST_HOLD_MS` | 失败提示停留时长（默认 `3200` ms） |
| `zh` / `en` | 词典；目前只覆盖 zh / en，切到其它语言时按 zh 键集补齐即可 |

## 测试

```powershell
# 零依赖：槽位注册契约 + 纯逻辑（信封映射 / 请求载荷 / 单飞 / 可见性）
node D:\Users\dsh-local-plugins\open-with-default-app\test\self-test.mjs

# 可选：真 React + jsdom 的组件行为（依赖不在插件里，缺失即 SKIP）
#   mkdir $env:TEMP\owda-test; cd $env:TEMP\owda-test; npm init -y; npm i jsdom@24 react@18.3.1 react-dom@18.3.1
$env:OPEN_WITH_APP_TEST_MODULES = "$env:TEMP\owda-test"
node D:\Users\dsh-local-plugins\open-with-default-app\test\dom-test.mjs
```

两份测试覆盖的边界不同：`self-test.mjs` 证明**注册给宿主的槽位数据**与**纯逻辑**（含三条回归项：宿主严格代理下 `ctx.remote` 抛错不许把 apply 带崩；**真实宿主形态**——挂载对象取 `.session` 必抛时仍须解析出 session remote 并打开成功；**已撤入口**不许再出现在交付卡片槽里）；`dom-test.mjs` 用桩化的 `primitives` 证明**组件行为**（右键路径被接管、菜单摆位、点击即关菜单、禁用态、空路径不渲染、失败文案）。两者都不证明宿主真实渲染形状——那部分靠人工验收（见下）。实测全绿：self-test 123 项、dom-test 21 项（Node v24.10.0；dom-test 依赖装在 `%TEMP%\owda-test`：jsdom@24 + react@18.3.1 + react-dom@18.3.1）。

## 人工验收（缺一不可）

```text
[ ] 启动日志（~/.dsh/logs/startup-*.log）无本插件的激活失败/等待服务条目
[ ] 页面硬刷新后**不出现**「Failed to load plugins / web entry did not activate」
[ ] 鼠标移到预览头部那行路径上 → 光标变右键样式；**没有**底色、**没有**额外 tooltip（宿主自带的 title 提示仍在）
[ ] 路径行的排版与本插件无关：长路径仍被宿主收住并打省略号，**不溢出面板**（这一条是布局回归的看门项）
[ ] **右键那行路径** → 出现「用默认应用打开 / 在资源管理器中显示」→ 各自生效，菜单自行关闭、Esc 也能关
[ ] 右键预览页签 → 菜单末尾出现「用默认应用打开」→ 点击 → 打开，且菜单自行关闭
[ ] 预览头部**不再有**本插件的图标按钮；交付卡片动作区**不再有**本插件的按钮（内置能力不变）
[ ] 预览一个格式不支持的文件 → 空态出现放大按钮 → 点击生效
[ ] 预览一个已被删除的文件 → 出现失败提示（带失败原因，不是静默、不是泛化文案）
[ ] 控制台无 error；内置 open-in-app 的「Open In...」与会话头行为不变
```

## 挂载

- profile `package.json`：`dependencies` 加 `"@local/open-with-default-app": "link:D:/Users/dsh-local-plugins/open-with-default-app"`，`dsh.profile.bundles` 加 `"@local/open-with-default-app"`。
- `node_modules\@local\open-with-default-app` → 指向本目录的 Junction。
- **改 `client.js` 后不必重启宿主**：客户端 bundle 每次页面加载现读磁盘，**硬刷新页面**（`Ctrl+Shift+R`）即可生效。改 `index.js` / `package.json` / `cordis.patch.yml` 才需要重启宿主。

## 卸载

1. 从 profile `package.json` 的 `dsh.profile.bundles` 与 `dependencies` 移除本插件；
2. 删除 `~/.dsh/profiles/*/node_modules/@local/open-with-default-app` 链接；
3. 重启宿主。

卸载后：右键菜单与空态按钮消失，内置 open-in-app 与其它界面完全不变。本插件**只注入一张按 id 命名的样式表**（`ctx.effect` 生命周期内存在，卸载即随 effect 移除），不改 DOM 结构、不写任何存储；悬停提示只临时改动路径元素的 `title`（原始值存 `data-owda-title`，`pointerout` 时还原）。
