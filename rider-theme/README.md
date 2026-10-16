# rider-theme（`@local/rider-theme`）

把 **JetBrains Rider Dark** 调色板（移植自 Zed 主题包 `jetbrains-rider`，缺失语义以 VS Code 移植版交叉校对）注册成 DSH 的可选主题，并在「通用设置 → 外观」下方提供一行开关。

## 做了什么

- `theme.register({ id: 'rider-dark', colorScheme: 'dark', tokens })` 注册主题；`client.js:TOKENS` 覆盖全部 116 个色彩型 `--dsw-*` 变量；
- 配色实际走**插件自有 override layer**（`theme.overrideTokens`）：不依赖设置文档，所以宿主偏好写不进去时也照样能上色；
- 通过 `settings.general.item` slot 注册设置行（zh/en 双语，含 `role="switch"` 无障碍语义）；
- 另一张 `--shiki-*` 样式表（`body[data-ds-dark-theme]` 作用域）负责代码高亮配色。

## 外观语义（v4：配色跟随基座 + 写入被拒时自维持深色 + 不覆盖你在「外观」里的最新选择）

调色板是**深色专用**的，所以它的行为围绕"基座是不是深色"展开：

| 状态 | 行为 | 行内提示 |
| :--- | :--- | :--- |
| 开关 ON，基座深色 | 挂载配色层（Rider 配色 + 深色结构 + 深色 shiki） | 无 |
| 开关 ON，你在「外观」里选了**浅色** | **自动撤层**，避免"深色 token 叠在浅色结构上"的半套状态；切回深色自动恢复 | `row.lightBase` |
| 开关 ON，你选了**跟随系统**而系统此刻是浅色 | 同上（撤层），文案区分「你选了浅色」与「系统是浅色」 | `row.systemBase` |
| 开关 ON，**设置文档写不进去**（被编辑器/agent 会话占着） | 判定被拒后，本客户端用**纯本地** `setTheme('rider-dark')` 自行维持深色基座 —— 不写文档、不重试、不与「外观」行打乒乓；**但你在「外观」里新点的浅色/跟随系统仍然算数**（见下） | `row.notSaved`（并明确告知"其它设置项仍会丢"） |
| 开关 OFF | 只在「当前偏好仍是本插件写过的值」时还原上一个偏好；你后来自己选的浅色不会被覆盖 | 无 |

**判定"写入是否被拒"的方法**（`client.js:trackWrite`）：以**设置文档回读**为准 —— 运行时切到一个文档里并不存在的 builtin 偏好后，600ms 再查文档仍未落地 ⇒ 判为被拒。该判定与"谁发起写入"无关，因此**你自己在「外观」里点「深色」被拒也能识别**，不会把你弹回「跟随系统」。

**"被拒"只锁深色基座，不锁你的新选择**（`client.js:reconcile`）：判定依据是"这个偏好值文档里本来就没有"——
用户刚点的那一下必然满足（写入没落地，文档还是旧值），而被拒写入失败后**回退成文档旧值**的那次推送不满足。
于是点「跟随系统」/「浅色」不再被判为"无效操作"而强行切回深色（那正是把用户新选择吞掉的旧行为），
而"深色被拒后又被弹回文档旧值"这条老 bug 依旧被断言住。

**深色基座按「运行时 + 渲染」保守取并**（`client.js:reconcile` / `noticeFor`）：presenter 把 `body[data-ds-dark-theme]`
打在 `theme/change` **之后一拍**，而运行时视图也可能滞后（一次没落盘的写入会让它停在文档与渲染都没接受的值上 ——
实测出现过：文档 `dark`、页面深色、运行时 `system`/浅色）。因此：

- **配色**：两者**任一**说深色就挂载（陈旧的浅色渲染绝不撤层 → 不会出现"深色 token 叠在浅色结构上"）；
- **文案**：两者**都同意**不是深色时才说"基座是浅色"，深色页面上不会出现这类自相矛盾的话；
- **自维持深色**（`assertDark`）**只由运行时决定** —— 那是"我们自己的意图"，不是"像素"；用像素判会把
  `activate()` 里 `setTheme('dark')` 的同步回调误读成"写入被拒"；
- `theme/change` 后 **250ms 再判一次**，等 presenter 落笔，把撤层/挂层纠回真实基座。

> 为什么不用"时间窗猜"或"直接写死 `body[data-ds-dark-theme]`"：前者会把"用户主动选了跟随系统"误判成失败；后者是与宿主 presenter 抢 DOM。现在的做法是"文档为准 + 注册主题 id 做纯本地切换"，既准确又不与宿主打架。

> 写入被拒的**根因**不在这层。已在 DSH 侧补了「备份 + 原地覆写」兜底（[`patches/`](../patches/README.md)）：
> 实测目标文件在 Zed 持有时**写得进去**，被拒的只是原子替换那一步，所以补丁后 Zed 开着也能保存设置，
> 上面这套兜底只在补丁未生效或文档确实不可写时才登场。

## 回归测试

```powershell
node rider-theme/design/test-persist-notice.mjs   # 47/47
node rider-theme/design/audit-tokens.mjs          # 116 covered / 0 missing / 0 unknown
```

- `test-persist-notice.mjs`：零依赖桩（自写 React/theme/**DOM**/ctx）驱动**真实 `client.js`**，覆盖判据表、开关联动、被拒后不重试文档、浅色让步、**被拒后仍尊重你的新点击**、**深色页面上不谎称浅色基座**、刷新不覆盖用户选择、双语 key 完整性；
- `audit-tokens.mjs`：把 `TOKENS` 与打包 `app.asar` 里真实的 `--dsw-*` 清单对账（默认读 `D:\Users\29580\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`，可用第一个参数覆盖）。

## 文件

| 文件 | 职责 |
| :--- | :--- |
| `client.js` | 浏览器半区：调色板、override layer、设置行、写入被拒判定（唯一有逻辑的一侧） |
| `index.js` | 宿主半区：空实现，存在只是为了让 profile patch 生效 |
| `cordis.patch.yml` | 往 profile 插入 `@local/rider-theme` 条目 |
| `design/audit-tokens.mjs` | 令牌覆盖审计（缺一个 token 就会露出"一块原生配色"） |
| `design/test-persist-notice.mjs` | 外观语义回归测试 |

## 已知边界

- 深色专用：**浅色基座下不挂载**，这是刻意设计（见上表）；
- 若 `~/.dsh/profiles/<profile>/cordis.patch.yml` 被外部程序（例如编辑器里一个把 `~/.dsh` 当上下文的 agent 会话）长期持有，本插件能自维持深色并如实提示；**该 profile 的其它设置项之所以不再静默丢失，靠的是 [`patches/`](../patches/README.md) 给 `@deepseek-ai/dsh-atomic-write` 加的「原地覆写」兜底**（未打补丁或文档确实不可写时，其它设置项仍会丢）—— 根因与完整定位见 [`docs/dsh-settings-document-lock.md`](../docs/dsh-settings-document-lock.md) 与 [`docs/dsh-web-settings-write-runbook.md`](../docs/dsh-web-settings-write-runbook.md)；
- 桌面端与 web 端共用同一份源码（各自 profile 以链接方式指向本目录）。

## 卸载

1. 删除 profile 下 `node_modules/@local/rider-theme` 链接；
2. 从该 profile 的 `package.json` 里移除 `dependencies` 与 `dsh.profile.bundles` 中的 `@local/rider-theme`；
3. 重启 DSH（设置行与配色层随插件卸载一起消失，无需手工清理）。
