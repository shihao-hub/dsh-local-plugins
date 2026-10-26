# `@local/session-title-edit` — 会话标题就地重命名

主区顶部的会话标题不再只能回左侧栏改名：**双击标题**（或点标题右侧的铅笔按钮），原地变成输入框；`Enter` 保存、`Esc` 取消、点别处自动保存。

```
┌ 对话 ─────────────────────────────────────────────┐
│  排查疑似 bug 原因 ✎        [标准模式] …          │  ← 双击标题 / 点 ✎
│  ┌──────────────────────────┐                     │
│  │ 排查疑似 bug 原因        │  ← 输入框覆盖标题   │
│  └──────────────────────────┘                     │
└───────────────────────────────────────────────────┘
```

数据走宿主自带的 `session/rename` 契约，因此主区标题、左侧栏会话行、窗口标题三处天然同源；刷新/重启后仍是新名字。

---

## 为什么这样做

### 只占一个座位，不接管标题栏

宿主的主区标题是 `conversation.session.header`（**single** 槽），由 `dsh-client-ui-conversation` 自己渲染。整块 shadow 会丢掉「对话 / 轨迹」标签——`useConversationViews` 不在标准 props 里，插件拿不到视图账本。

所以本插件只注册 `conversation.session.header.actions`（**list** 槽，`id` 必填），拿到宿主给的标准 props：`sessionId`、`useSessions`、`useAccess`、`t`。

### 不复刻左侧会话行

宿主侧栏行组件（`dsh-client-ui-workspace` 的 Rows）没有导出、也没有「整行」复用座位，插件无法把它渲染到主区。仿制一份只能靠手写样式，宿主改版就漂移；而且会与标签类插件的私有数据脱节。

因此本插件：

- 主区元素**不带** `data-row-key`，`pin-highlight` / `running-session-highlight` / `active-session-highlight` 的选择器不会误命中标题；
- 不读宿主 CSS Module 哈希类名，只用 `data-slot` 与父子结构；
- 只共享一件事：标题数据（同一个 `displayTitle` 投影）。

### 不自己改标题文本

提交成功后由宿主的 `title` 投影推送刷新主区与侧栏；插件不在 DOM 上写标题，避免与 React 抢同一块文本。

---

## 定位原理（宿主结构契约）

```
titleRow
└ titleCluster
  ├ nav                         ← 面包屑（aria-label=会话层级）
  │ └ span.crumbSeg             ← 最后一段 = 当前会话
  │   ├ span.crumbSep           ← 多级时的 "/"
  │   ├ span.crumb / button     ← 标题
  │   └ div[data-slot=…lineage] ← 子会话切换器（跳过 DIV）
  └ div.headerActions
    └ div[data-slot=conversation.session.header.actions]   ← 本插件
```

- 从铅笔按钮 `closest('[data-slot="conversation.session.header.actions"]')` 向上最多三层找到 `nav`；
- 标题 = 末段内**最后一个非 DIV 直接子元素**（跳过 `/` 与 lineage 槽）；
- `ancestry` 为空时宿主把会话 id 直接渲染成 `nav > span`，此时取该 span 自身；
- 找不到标题（子会话、结构变化）→ 双击不生效，铅笔仍可用，编辑框退化为贴着按钮定位。

---

## 交互细节

| 操作 | 行为 |
| :--- | :--- |
| 双击标题 / 点铅笔 | 进入编辑，输入框覆盖标题并全选 |
| `Enter` | 保存（IME 组合态下不提交） |
| `Esc` | 取消，不发请求 |
| 失焦 | 保存；草稿为空时等价取消 |
| 标题没改 | 直接退出，不发请求 |
| 空白 / 纯控制字符 | 不提交，红框 + 提示「标题不能为空」 |
| 服务端失败 | 保持编辑态、草稿不丢、错误行显示宿主返回的原因 |
| 连按 `Enter` | 同一 tick 只发一次请求（ref 闸门，不等 state 刷新） |
| 侧栏折叠 / 窗口缩放 | `ResizeObserver` + `resize` 重算编辑框位置 |
| 无 `session/rename` 权限 | 不渲染铅笔，双击也不响应 |
| 新建空白会话 | 宿主不渲染标题栏，插件天然没有入口 |

标题上限沿用宿主：`maxTitleBytes = 80`（UTF-8 字节），超长由宿主 normalize 截断，界面以返回值为准。

---

## 注册位置（本机实际跑的是 web profile）

`dsh web` 不带 `--profile` 时默认加载 `~/.dsh/profiles/web`。本机 11111 端口就是这种启动方式（命令行只有 `... bin.js web --port 11111 --no-open`），**只改 desktop profile 不会生效**——desktop 只给 Electron 桌面应用用。

要注册到 `~/.dsh/profiles/web`：

- `package.json` 的 `dependencies` 加 `"@local/session-title-edit": "link:D:/Users/dsh-local-plugins/session-title-edit"`
- `package.json` 的 `dsh.profile.bundles` 末尾加 `@local/session-title-edit`
- `node_modules/@local/session-title-edit` 建 junction 指向本目录
- 用 `dsh --profile web --dump-config` 确认树里出现 `- id: session-title-edit`

排查是否真的加载：用认证 cookie 请求 `http://127.0.0.1:11111/`，在返回 HTML 的 `window.__DSH_BOOT__.entries` 里搜 `@local/session-title-edit`；搜不到就是 profile 选错或服务没重启（刷新页面不算重启）。

## 卸载

插件是纯客户端 + 一个空 Host 行：

1. 从当前实际使用的 profile（本机是 `~/.dsh/profiles/web`，桌面应用是 `~/.dsh/profiles/desktop`）的 `dependencies` 与 `dsh.profile.bundles` 移除 `@local/session-title-edit`；
2. 删除对应 `node_modules/@local/session-title-edit` junction；
3. 重启该 profile 的宿主（web：重启服务；desktop：重启应用）。

宿主侧零残留：不写 localStorage、不写会话日志、不加持久化偏好。

---

## 测试

```powershell
cd D:\Users\dsh-local-plugins\session-title-edit
node self-test.mjs        # 39 项：定位 / 双击判定 / 几何 / 草稿 / 错误 / 服务回退 / 注册契约 / 解耦
```

组件行为（真 React + jsdom，依赖不随插件发布）：

```powershell
mkdir $env:TEMP\stse-test; cd $env:TEMP\stse-test
npm init -y; npm i jsdom@24 react@18.3.1 react-dom@18.3.1
$env:SESSION_TITLE_EDIT_TEST_MODULES="$env:TEMP\stse-test"
node D:\Users\dsh-local-plugins\session-title-edit\dom-test.mjs   # 38 项
```

浏览器人工验收见仓库根 `AGENTS.md` 的 cookie 自愈流程：重启应用 → 双击标题改名 → 主区/侧栏/窗口标题三处同步 → 刷新后仍在 → 验证 Esc、空值、超长截断、侧栏折叠跟随。
