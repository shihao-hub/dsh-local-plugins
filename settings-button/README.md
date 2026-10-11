# settings-button（`@local/settings-button`）

把「设置」入口搬到侧栏顶部；左下角账号菜单里那条原有的「设置」只隐藏，其余一律不动。

- **新增**：侧栏顶部面板列表（与「模组 / 技能 / 接口」同排，`order = 30`，排在「接口」之后）新增一行 **设置**（齿轮图标 + 文字，rail 折叠时自动变纯图标 + Tooltip）。
- **只隐藏那一项**：左下角账号按钮点开的菜单里，**仅「设置」这一行**被隐藏；账号按钮本身、「意见反馈」「退出登录 / 登录」以及账号头像/昵称全部原样保留、可正常点击。`Ctrl+,` 快捷键同样照旧。
- **点击新行 = 点原来的「设置」**：程序化点一次账号按钮 → 命中菜单里的「设置」项 → 设置面板打开（同一套原生 `openSettings`，不是复制实现）。
- **不切换主面板**：点击新行不会把中央对话顶掉、不报错。

## 原理

| 环节 | 做法 |
| :--- | :--- |
| 新行 | 注册进 `sidebar.panellist`（官方增量列表槽，`replaceRisk: none`），复用原生 `PanelRow` 的样式、Tooltip、rail 形态 |
| 拦截 | 该槽语义是「主面板切换」（行点击走 `layout.selectPanel(id)`，未注册会抛错），故在**捕获阶段**对行按钮监听 `click`：`stopPropagation()` 拦下原生选择动作，再执行本插件逻辑；键盘 Enter/Space 触发的合成 click 走同一条路 |
| 隐藏 | Menu 的列表是 portal 到 `body` 的。用 `MutationObserver` 盯 `body` 的 childList：菜单一挂载就在**渲染前**（微任务）处理——把「设置」项 `display:none` + `disabled`（Menu 的键盘走位 / Tab / autoFocus 都走 `button:not(:disabled)`，置灰后方向键直接跳过，不留死键位）。识别条件是「同一个菜单面里含『意见反馈』」，因此绝不会误伤其他菜单 |
| 委托 | 点击时实时查取账号入口按钮（`aria-haspopup="menu"`，兼容 `settings-general` 原生回退的 `"dialog"`）并 `click()`，再命中菜单里的「设置」项（命中前先解除 `disabled`——disabled 按钮不派发 click）。找不到入口时只告警、不抛错 |
| 兜底 | 额外注册 `main` 键位 `settings-button`（渲染 `null`）：万一拦截失效，主面板被切到该键位时立刻回到对话并打开设置，把「卡在空白主面板」降级为一次瞬时闪动 |

菜单是 React 在同一个事件里挂载的，命中通常在 `.click()` 返回前就完成；万一没就绪会在两帧内重试，重试期间用户看到的也只是那个原生菜单。

## 依赖的 DOM 契约（App 更新若改版需回来对照）

| 契约 | 说明 |
| :--- | :--- |
| `[class$="_settingsArea"]` | 侧栏底部的设置座位（`sidebar.settings` 槽） |
| `[class$="_settingsArea"] button[aria-haspopup="menu"]` | 账号入口按钮（settings-account 的 `AccountMenu`）；该插件缺席时回退按钮为 `aria-haspopup="dialog"` |
| `[data-menu-material] button[role="menuitem"]` | Menu 的列表面与菜单项（列表 portal 到 `body`） |

CSS Module 类名恒为 `<hash>_<localName>`（hash 随构建变化、localName 稳定，与 pin-highlight 同一依据）。任一契约失配时退化为「设置项不再被隐藏 + 新行点击无动作 + 控制台告警」，不抛错、不影响其他界面。

## 可调项（`client.js` 顶部）

| 常量 | 含义 |
| :--- | :--- |
| `PANEL_ORDER` | 新行位置（默认 30，即「接口」之后；面板列表按 order 升序） |
| `SETTINGS_ITEM_LABELS` | 要隐藏的那一项的文案（默认 `设置` / `settings`，比较时统一小写并做前缀匹配，因为项文本后面还跟着快捷键） |
| `ACCOUNT_MENU_MARKERS` | 账号菜单的识别文案（默认 `意见反馈` / `feedback`）；只在这类菜单里动手 |

> 目前只覆盖内置的 zh / en 文案。若切到其他语言，把对应译文补进上面两个常量即可（找不到就什么也不隐藏，不会出错）。

## 卸载

1. 用插件管理器停用/卸载 `@local/settings-button`（或删除 `~/.dsh/profiles/desktop/node_modules/@local/settings-button` Junction）
2. 从 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 移除 `@local/settings-button`
3. 重启 DSH（或「应用 → 重启应用与 Host」）

停用后：新行消失、账号菜单里的「设置」项恢复、其他界面不变。
