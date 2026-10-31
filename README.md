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
| [`excalidraw-panel`](./excalidraw-panel) | `@local/excalidraw-panel` | 左侧边栏「画板」入口 + 右侧栏「开始」页「Excalidraw 画板」卡片：主区以 `<iframe>` 嵌入 [excalidraw.cn](https://excalidraw.cn/) 手绘白板（官方中文镜像，无 `X-Frame-Options`/`frame-ancestors`，可安全内嵌）；右栏卡片走 `sidebarRightTabs` 注册 `kind: excalidraw` 标签页，与对话同屏（`keepMounted` 切走不重载）。顶栏提供刷新与「浏览器打开」；画作由 Excalidraw 自身 localStorage 自动保存。零依赖、无宿主路由、无构建步骤；自测 `self-test.mjs`（`node:vm` 里跑 `client.js`，19 项：slot/标签类型/站点/字典/CSS）。 |
| [`mod-renamer`](./mod-renamer) | `@local/mod-renamer` | 将 Harness 界面所有「Plugins / 插件」文案替换为「模组 (mods)」。 |
| [`app-restart`](./app-restart) | `@local/app-restart` | 底部状态栏/快捷菜单一键平滑重启 Harness 桌面应用插件。 |
| [`window-memory`](./window-memory) | `@local/window-memory` | 记住桌面主窗口大小与位置，下次启动自动恢复（实时去抖持久化到 `%LOCALAPPDATA%\dsh-window-memory`）。helper 为原生小程序（`helper.cs` 由 `csc` 首次运行编译缓存，`/target:winexe` 不分配控制台），常驻成本 19.7MB/≈0% CPU，取代原先 106MB/4.05% CPU 的常驻 PowerShell；回归测试 `test/self-test.mjs`（纯逻辑）+ [`test/window-test.mjs`](./window-memory/test/window-test.mjs)（真窗口 6 场景 27 项，夹具自建窗口、不依赖系统应用）。 |
| [`model-favorites`](./model-favorites) | `@local/model-favorites` | Composer 模型选择器的 Zed 风格「收藏」：置顶收藏分组、行内星标切换、右侧 provider 小字标注；收起菜单后模型名与推理等级之间挂一枚 **≤3 字母小写 ASCII 上标**（`acc`/`off`/`ocg`/`zai`，8.5px，水平居中槽位、垂直抬到字身上方），解决「关了菜单就不知道选的是哪个组织下的模型」。 |
| [`mcp-panel`](./mcp-panel) | `@local/mcp-panel` | 左侧边栏「接口」面板（MCP）：汇总已配置的 MCP 服务器（stdio/HTTP、命令或 URL、超时/重连配置）与各服务器实时注册的工具清单；支持在每个 MCP 卡片上**单独开启/停用**（内存秒级归还系统并同步持久化 patch）、**单项就地热重启**，并在面板顶栏提供全局平滑重启入口。 |
| [`expand-all-sessions`](./expand-all-sessions) | `@local/expand-all-sessions` | 侧边栏会话列表**默认全量加载**：定位承载 `sessionLimits` 的 React fiber，一次 dispatch 把每个 Workspace 分组的 limit 写成 `Infinity`（不逐页模拟点击、无中间态抖动）。关键实现细节：① hook 定位**不要求状态里已有本组 key**（宿主初值是 `{}`，旧实现因此首屏与第一次点击必然失手，只 +5），且只认离按钮最近的那个 limits map；② 读状态前用 `FiberRoot.current` 把 DOM 上的 `__reactFiber$` 指针归一到当前树（React 双缓冲会让它一半时间指向上一棵树，导致方向判错、收起后弹不回来）；③ 方向判据取按钮自身的 `aria-expanded`（不再拿「隐藏条数」当总条数比大小）；④ 点击路由挂 `document` 捕获阶段且不阻断宿主（`Infinity + 5 === Infinity`），折叠仍归原生语义；⑤ **写完必须核对，核对不过才兜底**：150ms 后按 `data-row-key` 重查按钮，仍未全量（或压根找不到 hook）就逐帧驱动宿主自己的按钮（上限 40 次 + 卡死检测 + `synthetic` 标记防自喂），因此无论宿主内部结构怎么变，用户这次点击的意图都能落地。回归测试：`self-test.mjs`（零依赖桩，79 项）+ [`dom-test.mjs`](./expand-all-sessions/dom-test.mjs)（真 React 18.3.1 + jsdom，32 项，含「宿主状态换成 Map 导致 fiber 路径失效」对照）。 |
| [`pin-highlight`](./pin-highlight) | `@local/pin-highlight` | 侧边栏置顶图钉着色：把置顶图钉由 caption 灰改为琥珀色（静置与 hover 两态均覆盖），并在通用设置提供色盘（预设+自定义+复位）；纯 CSS 注入，不触碰 DOM 与原生行为。 |
| [`active-session-highlight`](./active-session-highlight) | `@local/active-session-highlight` | 侧边栏当前会话行高亮：整行 18% 同色底纹（无左条/无边框；原生把「选中」与「hover」写成同一条 token，Rider Dark 下几乎零差异），并在通用设置提供色盘（预设+自定义+复位）；纯 CSS 注入。 |
| [`running-session-highlight`](./running-session-highlight) | `@local/running-session-highlight` | 侧边栏「**正在运行**」会话行强化：宿主那枚 14px、tertiary 灰（Rider Dark `#858585` on 侧栏 `#2b2b2b`，轨道 25% 透明、弧长仅 8% 圆周）的 running 转圈换成强调色并加粗放大到 16px，整行再叠一层 2.6s 呼吸底纹（9% ⇄ 24%）。刻意不加左条（行圆角会把 inset 阴影弯成游离的 `(`，ash v1 的坑）。宿主 running 时**不开放** `sidebar.session.row.leading`（槽位被状态点占用），故纯 CSS 命中 `div[data-row-key^="session:"]:has(svg[data-state="ongoing"])`；只动画 `background-color`，借 CSS 动画优先级接管「运行中且当前打开」的行。与 pin-highlight(13)/active-session-highlight(14) 同套色盘（本插件 `order: 15`），色链默认同色、改哪侧哪侧生效。对照图见插件 README（宿主真实 CSS 重建渲染）。 |
| [`settings-button`](./settings-button) | `@local/settings-button` | 把「设置」入口搬到侧栏顶部面板列表（与模组/技能/接口同排）。两种底部形态自动识别：账号菜单形态（desktop）仅隐藏菜单里的「设置」项，账号按钮、意见反馈、退出登录全部保留；回退形态（web，无账号菜单）则隐藏底部原生「设置」按钮本身，同行连接状态指示器保留。点击新入口等价于点原来那一项，设置面板照旧打开。回归测试 [`dom-test.mjs`](./settings-button/dom-test.mjs)（jsdom，三种形态隐藏/还原/委托，20 项）。 |
| [`agy-bridge`](./agy-bridge) | `@local/agy-bridge` | agy 只读调研桥（MCP stdio 服务）：把「安全调研/代码审计/Bug 诊断」委托给宿主机 Antigravity CLI 执行，全部调用固定 `agy -p ... --sandbox --mode plan --output-format json`（物理禁写、高危命令拦截，不带 skip-permissions），暴露 `research` 与 `list_models` 两个工具；桥接器零写盘，删 profile 里对应 patch 行即 100% 复原。 |
| [`open-with-default-app`](./open-with-default-app) | `@local/open-with-default-app` | 对话与右侧预览里每个文件/目录上的**显式「用默认应用打开」按钮**：交付卡片与变更对照页注册进 `deliverables.file.actions` / `deliverables.review.file.actions`（走父级已鉴权交付路由，相对路径由宿主按 session 解析），预览标题栏与空态注册进 `sidebar.right.tab.document.actions` / `.unpreviewable`（走 `remote.session.openWorkspacePath({path})`，不传 application 才是 OS 关联）。补的两个缺口：① 内置预览控件依赖「每页只读一次」的桌面探测，该值为假时整页控件消失，本插件不依赖它；② 预览失败为 `not-regular-file`/`not-found` 时内置判定「无任何动作」（界面只剩「该路径不是普通文件」的死胡同），本插件标题栏按钮仍可用。纯客户端插件、零宿主路由、无 CSS 注入、无存储；回归测试 `test/self-test.mjs`（零依赖，84 项）+ [`test/dom-test.mjs`](./open-with-default-app/test/dom-test.mjs)（真 React 18 + jsdom，28 项）。注意一条宿主陷阱：cordis ctx 代理对**未 inject 的服务属性直读会抛错**（`ctx.remote` → `cannot get property "remote" without inject`，不是 undefined），旧版把它裸读进 `apply` 导致 fiber FAILED（`web boot: 1 entry did not activate`）；现改为 `ctx.get(name)` 为主 + 属性探测 try/catch。 |
| [`sidebar-label-alias`](./sidebar-label-alias) | `@local/sidebar-label-alias` | 把侧栏官方项「自动化任务」显示为「任务」，与其它两字面板名（模组/技能/接口/画板/设置/标签）对齐。该项由 `ui-schedule` 的 `sidebar.panellist` slot 注册、label 取自它自己的 locale 命名空间（同 namespace 同语言重复注册会直接抛错），slot 注册项又只读，插件层没有可写的覆盖点，所以只改渲染结果：限定 `<nav>` 内面板行的 `aria-label` 与标题 span，折叠态连 tooltip 一起改；页面标题、空状态、搜索框、任务卡片一律保持官方原文。换词只改 `client.js` 顶部两个常量。 |
| [`session-tag-lite`](./session-tag-lite) | `@local/session-tag-lite` | 会话**轻量前端标签**：不接管左侧栏，只在宿主开放座位上打标签——行尾「色盘」按钮（`conic-gradient` 把该会话多标签颜色合成一个圆盘：1 色纯色圆、≥2 色等分扇区、无标签空心圆，不再平铺彩色小点，可在「设置 → 通用设置 → 会话行尾标签按钮」关掉这颗按钮）、「…」菜单「编辑标签」、悬停卡片标签 chip + 截止徽章；**刻意不碰行首 `sidebar.session.row.leading`**（那是宿主放未读/待回答状态点的位置，塞色点会被误读成状态）。浮层「会话标签」弹窗 = 自由标签 pills + 全库标签池 chips + 新建输入（Enter/逗号，**自动分配未被使用过的颜色**）+ **点 pill 色点改色**（7 色板）+ 截止日期；浮层「标签总览」面板按 `待办 / 归档 / 自定义标签 / 未打标` 浏览，搜索同时匹配标签名与会话标题。面板做出两级视觉（组头 30px/600 字重 + `bg-layer-2` 底条 + 计数 pill；子项 26px/11px + 13px 缩进 + 1px 引导线），保留组浏览态常显（空也留骨架），「未打标」默认折叠、展开先露 15 条 +「显示全部 N 个」；**最上方另有非标签的「最近 N 小时」置顶分区**（`updatedAt` 落在窗口内的会话，运行中无条件纳入；**宿主已归档的会话整块不上架**——归档集读 `ctx.workspaces.list` 的 `archivedSessionIds`，否则点进去只有空白主面板；默认 24h，头部「最近 24 ▾」下拉可切 6/12/24/48/72/168 或自定义 1–720，存 `options.recentHours`，窗口为空时该分区不出现）；面板会话行 hover 出 **+** 可就地展开标签编辑条（chips 点一下即加/取消、输入回车新建），不用开大弹窗；面板放大到 **760px / 最高 82vh**，字号与行高按宿主左栏比例提到 **13px / 30px**，会话行右侧**常显相对时间**（`刚刚 / N分钟 / N小时 / N天 / N个月 / N年`，与左栏同一套分桶），hover 时时间淡出、`+` 按钮出现在同一位置。**持久化**：Host 半区 `inject: ['webServer']` 注册 `GET/PUT /plugins/session-tag-lite/state`（自定义头 + 同源 Origin 校验，临时文件 + rename 原子写）落盘 `~/.dsh/session-tag-lite/state.json`；Client 本地优先同步——本地为空才用远端恢复（新浏览器/清站点数据不丢），本地有数据则推上去覆盖，路由不存在时静默退回纯 `localStorage`（`session-tag-lite.v1`，含 `colors` 映射）。Host 代码改动后需 `plugin_manager set_plugin` 停用/启用一次（或重启 `dsh web`）才加载新模块。`node self-test.mjs` 69 项零依赖用例。 |
| [`session-title-edit`](./session-title-edit) | `@local/session-title-edit` | 主区**会话标题就地重命名**：双击标题（或点标题右侧铅笔）原地变输入框，`Enter` 保存、`Esc` 取消、失焦保存；走宿主自带 `session/rename` 契约（`sessions.rename` → `remote.session.rename` 回退），主区/侧栏/窗口标题三处天然同源。**只占 `conversation.session.header.actions` 一个座位**：不 shadow 标题栏（会丢「对话 / 轨迹」标签），不复刻左侧会话行（宿主行组件不导出、无复用座位），主区元素不带 `data-row-key`、不读哈希类名，因此 pin/running/active 高亮插件的样式不会误套到标题。细节：编辑框 `position:fixed` 覆盖标题 rect 并隐藏原标题（inline style + `data-session-title-edit` CSS 兜底）、`ResizeObserver`+`resize` 跟随侧栏折叠、IME 组合态不提交、`busyRef` 闸门保证连按 Enter 只发一次、空白不提交、失败保留草稿并显示宿主原因、无 `session/rename` 权限不渲染入口、空白会话宿主不渲染标题栏故无死按钮。回归测试：`self-test.mjs`（零依赖，39 项）+ [`dom-test.mjs`](./session-title-edit/dom-test.mjs)（真 React 18 + jsdom，38 项）。 |
| [`session-workspace-label`](./session-workspace-label) | `@local/session-workspace-label` | 会话行**工作区副标题**：每条会话标题下方补一行 11px 灰字（文件夹图标 + 工作区名，参考 agy 会话列表），解决单列表模式下多工作区会话混在一起无法区分的问题。宿主没有行副标题座位（`sidebar.session.row.leading` 只有 16px 且状态点存在时**不渲染**，hover 座位只在悬停卡里），故走 DOM 注入：在行节点**末尾追加** `span[data-swl-label]`，CSS 把行高 32→46px（标题内容区仍 32px、下方留 14px，`border-box` 锁总高）；React reconciliation 只按 index 管自己的子节点，末尾节点不会被清掉（实测切会话/切视图/时间刷新后 102/102 保留），行重建时由 `MutationObserver` 比对补回（不自喂循环）。数据读 `ctx.get('sessions').list` 与 `ctx.get('workspaces').list` 两个只读快照（不 retain、不激活 Session），名称按 Workspace 标题 → 会话 `cwd` basename → 「未分组」降级；**`inject` 必须声明 `sessions`/`workspaces`**——cordis 的 `ctx.get` 对未 inject 的服务返回 `undefined` 而非抛错，漏写会静默不工作（实测踩到）。通用设置三选一：**仅单列表（默认）** / 所有视图 / 关闭（`localStorage`）——分组视图下自动隐藏并把行高还原 32px。只认宿主自己的行（必须带 `class$="_title"` 直接子 span），被其它插件接管后的异形行自动跳过。`node self-test.mjs` 36 项零依赖用例。 |
| [`fork-turns`](./fork-turns) | `@local/fork-turns` | 会话**按轮次挑选分叉**：入口是会话行「…」菜单的「分叉选中轮次」（空白会话不显示；不必先打开该会话）。浮层列出全部轮次（用户/助手摘要、时间、工具调用数），勾选任意几个**已完成**轮次即生成只含它们的新会话；不是转录，是原生历史（工具调用与结果成对保留），模型可直接接着聊，已用真实 21 轮会话端到端验证（新会话里追问「最早两个问题」，模型准确复述被选轮次）。实现绕开内置 `sessions.fork` 的「连续前缀」限制：Host 读事件日志，`turns.js` 纯函数按 `turn/start`…`turn/end` 切整轮、只保留 `turn/*`·`step/*`·四类消息与 `tool/*`、**seq 重排 0..n-1**（`Session` 构造要求连续）、surface 统一改 `append` 并按映射重写/丢弃 `sourceEventSeqs`，再走 `ctx.agents.create({seed})`；新会话继承源 preset 与当前默认模型、自动挂源工作区、命名「原标题 · 分叉 N 个轮次」，header 记 `parentSession`（`isSeeded` 保持 false）。三条同源路由 `turns` / `preview` / `fork`（`x-fork-turns` guard header + 同源 Origin + 64KB 上限），`preview` 用 `ctx.sessions.prepare` 做真实构造校验而不落库。已知边界：进行中轮次不可选；压缩过的原文会重新可见；会话级权限预设不随轮次复制。`self-test.mjs` 22 项零依赖用例。 |
| [`panellist-reorder`](./panellist-reorder) | `@local/panellist-reorder` | 侧栏面板行（模组/技能/任务/接口/画板/设置/标签）**拖拽自定义排序**：按住任意行上下拖动，松手顺序即写入 `localStorage`，刷新、切换语言、插件启停后都保持。宿主的 `sidebar.panellist` 只认注册期声明一次的 `order`（注册表只读，`ctx.layout` 也没有排序入口），所以顺序落在渲染结果上：拖动时行 `position:fixed` 抬起、原位置用虚线占位块顶住，指针越过某行中线就把占位块插到该行前；松手把行插回占位块并落盘。行键取自 `PanelRow` 的 React fiber key（`plugins`/`skills-panel`/`schedules`/`mcp-panel`/`excalidraw-panel`/`settings-button`/`session-tag-lite`），与插件注册 id 同源，切语言不丢；fiber 取不到退回 `aria-label`。移动不足 4px 仍按点击处理，拖动结束会吞掉紧随的 click（`settings-button` 在行捕获阶段拦 click 打开设置，本插件在 `document` 捕获阶段先一步拦截，两者不冲突）。`MutationObserver` + rAF 在宿主重渲染后校正，顺序已正确时不动 DOM。 |
| [`plugin-source-tabs`](./plugin-source-tabs) | `@local/plugin-source-tabs` | 插件页「已安装插件」分组**按来源分栏**：把「本地 / 下载」两段分栏挂进**分组标题行**（标题在左、切换器在右，与卡片开关同一条右对齐线，不额外占一行；默认本地，选择存 `localStorage`），本地 = 包名以 `@local/` 开头的 profile 包（`link:` 到本工作区），其余（npm / GitHub 下载）归「下载」，标签带实时计数、空分类给一句提示。宿主没给这份列表留渲染座位（`plugins.tab` 只能**整块替换**分组，拿不到宿主自己的卡片/开关/跳转），所以锚定宿主自己的稳定 DOM：`section[data-plugin-group="bundles"]` + `li[data-plugin-package]`——插自己的分栏条，卡片只加 `data-plugin-source-hidden` 属性（**不写 style/className**，那两项归 React，刷新时会被覆盖），每次刷新先比对再写，`MutationObserver` 不会被自己的写入反复唤醒；插件卸载时移除分栏条/空态/样式表并还原全部隐藏属性。文案走 `ctx.locale` 命名空间字典（zh/en），语言切换即时跟随。分栏条做成**文字级页签**而不是分段控件：无容器底色、13px 文字 + 2px 下划线指示，选中只换颜色不改字重（500→600 会让中文标签变宽、切换时文字抖动），计数是 11px 小字而非 pill（pill 与选中块同色时等于隐形，两个 tab 结构不一致）——它挂在分组标题行右侧、与卡片开关同一条右对齐线，任何带底色的胶囊都会和蓝色开关抢视觉重量，也容易被误读成「整页模式开关」；切换时新列表 160ms 淡入；**收缩不乱跳**：切到短列表时先把宿主 `ul` 的高度冻结在旧值、把 `scrollTop` 还原，再让高度 220ms 连续缩到新值——页面高度连续变化，浏览器只能连续钳制 `scrollTop`，观感是页面顺着收上去而不是瞬移（冻结与还原和 `refresh()` 在同一个同步任务里，浏览器画不出中间帧）；展开时页面变长、`scrollTop` 不受影响，按「每个分栏各自记住上次离开处」恢复（切回来不丢阅读位置），没有记忆则把分栏条钉在点击前的屏幕位置。注意宿主把滚动放在 `section.X_2TxG_page` 上而不是 window（`window.scrollY` 恒为 0，`window.scrollBy` 无效），必须沿祖先链找滚动容器；`prefers-reduced-motion` 时跳过高度动画直接落位。已用真机验证：默认本地 22 条 / 下载 4 条、卡片详情往返、宿主刷新按钮后过滤仍在、`<html lang>` 改成 en 后文案仍走字典。`node self-test.mjs` 7 项零依赖用例（模块声明、来源分类前缀语义、中英字典对齐）。 |
| [`rightbar-width`](./rightbar-width) | `@local/rightbar-width` | 右侧栏宽度**固定**：宿主把 `layoutInfo.rightbar` 当瞬时状态（首次打开 `??= viewport * 45%`、刷新即重置），所以每次都是「占一半」。本插件只补持久层——从未设置时落到 480px，启动时把保存值写回 layout store（经 `ctx.layout` 内部的 `panels.setRightbar` 私有绑定 action；宿主升级改名则取不到、整体静默 no-op），拖动分隔条结束两帧后按 `[data-rightbar-col]` 的渲染宽度记录（不自己算位移，避开 300～70% clamp），通用设置提供 360/420/480/560 预设、自定义 px 与「跟随宿主 45%」（存 `auto`，之后启动不干预）。`self-test.mjs` 覆盖 480 默认落地、保存恢复、auto 不干预与拖拽持久化。 |

---

## DSH Web GUI 的浏览器认证（给 agent 的 chrome-devtools 用）

现象：`chrome-devtools` 直接打开 `http://127.0.0.1:11111` 只会拿到
`dsh web authentication required; reopen the URL printed by dsh web.`。该端口只认两样东西：

| 凭证 | 生命周期 | 能否事后取得 |
| :--- | :--- | :--- |
| `?token=` 启动令牌 | 每个 `dsh web` 进程随机一份 | 不能。只打印在该进程 stdout，父进程退出即丢 |
| `dsh-auth-*` 会话 cookie | 30 天（`cookieMaxAgeDays` 默认 30） | **能**。签名密钥持久化在 `~/.dsh/.credentials.yaml` 的 `client-connection/browser-session` |

所以既不用重启服务、也不用杀宿主进程：拿持久 secret 自签一个 cookie 就行。

```powershell
cd D:\Users\dsh-local-plugins
.\tools\dsh-gui-auth.ps1 -Verify   # 只校验，打印 HTTP 状态（200/303 = 通过，401 = secret 已换）
.\tools\dsh-gui-auth.ps1           # 生成 %TEMP%\dsh-gui-cookie.txt，cookie 值不打印
```

把该文件交给 `chrome-devtools` 的 `upload_file`（先在 401 页面上放一个 `input[type=file]`），
页面里执行：

```js
const t = (await input.files[0].text()).trim();
document.cookie = t + '; path=/; SameSite=Strict';
```

刷新一次即登录成功，此后 30 天内同一浏览器 profile 直接可用；`dsh web` 重启也不失效
（secret 是持久的），到期再跑一次脚本即可。临时文件用完立即删除，不要把 cookie 写进日志或提交。

边界说明：服务端下发的是 HttpOnly cookie，但校验只读 Cookie header，所以页面 JS 写入的同名
cookie 同样有效。这条通道只用于本机同一用户的自测——能读出 `.credentials.yaml` 的人本来就
已经拥有这台机器上的会话数据，不构成新的越权面。

> 脚本保持纯 ASCII：Windows PowerShell 5.1 按 ANSI(GBK) 解析 `.ps1`，UTF-8 无 BOM 的中文会
> 吞掉字符串结束引号（`（401）` 直接导致 ParseException）。

---

## 插件设置行来源标注约定

「设置 → 通用设置」里的行来自两类注册方：DSH 内置包，以及本目录的本地插件。slot 账本里其实记着 `registrant`（谁注册的），但它只存在于渲染宿主内部、**不会落到 DOM**，所以由插件在自己那一行显式声明来源：

| 要求 | 写法 |
| :--- | :--- |
| 行根节点标来源 | `'data-plugin-setting': '<行注册 id>'`、`'data-plugin-package': '@local/<包名>'` |
| 标题后徽章 | `<span class="<前缀>_badge" title="…">插件</span>`（英文 `Plugin`） |
| 文案 | 字典键 `row.badge` / `row.badgeTitle`（`{package}` 插值），zh、en 各一条 |
| 样式 | 11px / 18px 高 / `1px solid var(--dsw-alias-border-l3)` / `border-radius:999px` / `--dsw-alias-label-tertiary` / `margin-left:8px` |

已接入：`rider-theme`、`pin-highlight`、`active-session-highlight`、`running-session-highlight`、`model-favorites`、`rightbar-width`（六行的注册 id 依次为 `rider-theme`、`pin-highlight`、`active-session-highlight`、`running-session-highlight`、`model-favorites-status`、`rightbar-width`）。

新插件接入时复制上面四行即可；不接入也不会报错，只是该行不会带来源徽章。`mod-renamer` 生效时「插件」会被它按全局术语精确替换成「模组」，属预期。

校验（零依赖，逐文件断言属性、类名与中英字典）：

```powershell
cd D:\Users\dsh-local-plugins
node tools\verify-settings-badges.mjs
```

---

## 插件显示名与简介（locale 元数据）约定

设置页「已安装插件」里的标题与简介来自宿主的 `readPluginMeta`：**读得到 `locale` 字典就用本地化文案，读不到就回退成包名**（`@local/xxx`）。宿主不读 `package.json` 的 `name` 做展示名，也没有 `displayName` 字段——这就是「有的插件显示中文名、有的显示英文 ID」的唯一原因（2026-10 一次性补齐 21 个插件才让全站统一）。

### 三件套（缺一不可）

| # | 文件 | 内容 |
| :--- | :--- | :--- |
| 1 | `locale/en.json` | **入口**。宿主先解析 `<包名>/locale/en.json`，解析不到就整条链跳过——此时只有 `zh.json` 也不生效 |
| 2 | `locale/zh.json` | `meta.title`（中文名）+ `meta.description`（中文简介） |
| 3 | `package.json` | `exports` 增加 `"./locale/*.json": "./locale/*.json"`；`files` 增加 `"locale/*.json"` |

```json
// locale/en.json —— 只写 title；description 自动回退 package.json 的英文 description
{ "meta": { "title": "Excalidraw panel" } }
```

```json
// locale/zh.json
{
  "meta": {
    "title": "Excalidraw 画板",
    "description": "侧栏「画板」入口 + 主区 Excalidraw 白板，内嵌 excalidraw.cn，不离开界面即可手绘架构图与草图。"
  }
}
```

```json
// package.json 片段
"exports": {
  ".": "./index.js",
  "./client": "./client.js",
  "./locale/*.json": "./locale/*.json",
  "./package.json": "./package.json"
}
```

### 回退矩阵（写错时的界面表现，全部**不报错**）

| 情况 | 中文界面 | 英文界面 |
| :--- | :--- | :--- |
| 只有 `en.json`，没有 `zh.json` | 英文 title | 英文 title |
| `en.json` 存在但缺 `meta.title` | `@local/<包名>` | `@local/<包名>` |
| 缺 `en.json`（只写了 `zh.json`） | `@local/<包名>` | `@local/<包名>` |
| `exports` 少 `"./locale/*.json"` | `@local/<包名>` | `@local/<包名>` |
| locale JSON 带 BOM / 语法错误 | `@local/<包名>` | `@local/<包名>` |

静默降级意味着**不能靠界面发现漏配**，必须跑下面的校验。

### 生效时机

| 改动 | 是否重载 |
| :--- | :--- |
| 新增 `locale/` 目录、改 `exports` | **必须重启** `dsh web`（或桌面端）：Node 在宿主进程内缓存了包 manifest 的 exports，只刷页面无效 |
| 只改 `locale/*.json` 的文案 | 刷新设置页即可：`readPluginMeta` 每次调用都重新读文件 |

### 校验（零依赖，克隆后随时可跑）

```powershell
cd D:\Users\dsh-local-plugins
node tools\verify-plugin-locale.mjs
```

覆盖每个插件目录的 `en.json` / `zh.json` 存在性、JSON 合法性、`meta.title`（`zh` 另需 `meta.description`）、`exports` 与 `files` 声明、UTF-8 BOM。退出码非 0 即漏配。

### 新插件 checklist

- [ ] `locale/en.json`（`meta.title`）
- [ ] `locale/zh.json`（`meta.title` + `meta.description`）
- [ ] `package.json` 的 `exports` 含 `"./locale/*.json"`
- [ ] `package.json` 的 `files` 含 `"locale/*.json"`
- [ ] `node tools\verify-plugin-locale.mjs` 通过
- [ ] 重启宿主后，在「设置 → 模组 → 已安装插件 → 本地」确认显示中文名

> 纯 host 插件（如 `agy-bridge`、`window-memory`）同样适用：它们也会出现在插件清单里，没有 locale 一样显示英文包名。

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