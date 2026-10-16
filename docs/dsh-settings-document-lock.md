# [DSH] web profile 设置写入静默丢失：设置文档被外部程序占用

- **环境**：DeepSeek Harness `0.2.0-rc.2`，`dsh web --port 11111 --no-open`，Windows 11（本机实测）
- **影响面**：`dsh web`（web profile）下**任何**设置写入都不落盘 —— 内置「外观（浅色/深色/跟随系统）」、字号、以及所有插件注册到设置面板的开关；桌面端使用同一 profile 文件时同样受影响
- **表现**：UI 无任何报错。客户端先乐观显示新值，随后被宿主推回的旧值覆盖，刷新后仍是旧值 —— 用户看到的是「点了没反应 / 一会儿自己变回去」；点「深色」还会**自动跳回「跟随系统」**
- **定位结论**：profile 的用户设置文档（`profiles/<profile>/cordis.patch.yml`）被外部程序持有（本例：**Zed 的 ACP agent 会话**，见第七节），DSH 的「临时文件 + 原子 rename」写入被系统拒绝（`EPERM`）
- **重要鉴别**：**「重启 Zed」与「关标签页」都无效** —— 触发器不是 Zed 启动、也不是可见的编辑器标签，而是 **agent 会话把它当上下文**（见第七节）
- **修复状态**：**已解决"必须关 Zed"** —— 实测被禁的不是「写」而是「替换」，已给 `@deepseek-ai/dsh-atomic-write` 加「备份 + 原地覆写」兜底（见第八节）；根因（用户设置文档与外部编辑器对象是同一份）仍需上游处理

---

## 一、最小复现

1. 用一个外部程序打开 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`（本例是 Zed；设置面板右上角的「打开配置文件」就是把它交给编辑器的入口）
2. 在该 `dsh web` 实例里打开「设置 → 通用设置」，点「深色」（或任意插件开关）
3. **预期**：偏好保存，刷新后保持
   **实际**：界面短暂变化后自行跳回原值，刷新后仍是旧值；控制台、UI 均无提示

## 二、证据

### 1) RPC 层直接报 EPERM（连续 4 次全失败）

```
POST /api/settings/mutate -> 200（HTTP 层 200，RPC 层失败）

settings/rejected: EPERM: operation not permitted, rename
'C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml.8c69325781ba.tmp' ->
'C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml'
```

### 2) 设置文档根本没被改动

写入前后各查一次 `settings/describe`：

```
before      value{preference:"system",fontSize:14}  user{}  revision 0
after set   value{preference:"system",fontSize:14}  user{}  revision 0
```

### 3) 隔离实验：同目录的未占用文件替换成功，被占用的失败

| 操作 | 结果 |
|---|---|
| 同目录下 temp → rename 覆盖一个**无人占用**的文件 | ✅ `rename OK` |
| 同目录下 temp → rename 覆盖 `cordis.patch.yml` | ❌ `Win32 5 Access is denied` |

同时 `CreateFileW(DELETE)` 探测可以拿到 DELETE 权限、独占打开失败 —— 即「句柄存在但删除被拒」的特征（内存映射持有）。

### 4) 占用者（Windows Restart Manager 按文件反查）

```
=== C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml
  exclusive-open: held
  holder pid=43628 app="Zed"
=== C:\Users\<user>\.dsh\profiles\desktop\cordis.patch.yml
  exclusive-open: held
  holder pid=43628 app="Zed"
```

关闭 Zed 后同一操作立刻成功（同一脚本、同一数据集）：

```
before      value{preference:"system"}  user{}                  revision 0
set         ok:true                                             revision 1
after set   value{preference:"dark"}    user{preference:"dark"} revision 1
unset       ok:true                                             revision 2
after unset value{preference:"system"}  user{}                  revision 2
```

## 三、根因

1. web/desktop profile 的**用户设置文档**就是 `profiles/<profile>/cordis.patch.yml`（同一文件既是用户设置载体，又是「打开配置文件」交给编辑器的对象）。
2. 设置写入走「同目录临时文件 + 原子 rename」。
3. Windows 上若目标文件正被其它进程持有（Zed 的映射/句柄），rename 返回 `ACCESS_DENIED`，libuv 映射为 `EPERM`。
4. 客户端 config form 先**本地乐观更新**（`ThemeRuntime.setTheme` 立即 publish），失败后的回滚依赖宿主推送时 `adopt()` 重读持久值 —— 于是表现为「先变、再自己变回去」。

## 四、建议修复方向

1. **失败可见**：把 `settings/rejected` 冒泡到设置面板（行内提示或 toast），不要静默回滚。
2. **写入退化**：rename 遇 `EPERM/EACCES` 时退化为「直接覆写 + 写前备份」，或做有限重试后给出明确错误码。
3. **存储分离**：用户设置（随时被 UI 改写）与「交给外部编辑器打开的配置文件」不应是同一份；若必须共用，至少在被外部占用时探测并提示。
4. **可选**：`settings/openSettingsDocument` 之后对文档做一次「外部占用」探测，避免后续所有写入静默失效。

## 五、下游案例（本机实际触发的现象）

自研插件 `@local/rider-theme`（JetBrains Rider Dark 调色板）最初把配色挂在**插件自有 override layer** 上（不依赖设置文档，所以调色板总能生效），而「深色基座」依赖持久化偏好、必然失败 —— 结果就是 **深色 alias token 叠在浅色基座上**：`body[data-ds-dark-theme]` 缺失，代码高亮（`--shiki-*`）与结构性样式仍是浅色，看起来像「主题只应用了一半」。

插件侧已改成**配色跟随基座 + 写入被拒时自行维持深色基座**：

- 只有 `active.colorScheme === 'dark'` 时才挂 override layer，点「浅色」自动撤层，不再出现深浅混搭。
- 写入是否被拒**直接以设置文档为准**（`configForms.get('ui-theme')` 的当前值）：运行时切到一个文档里并不存在的偏好，600ms 后回查仍未落地，即判定被拒。
- 判定被拒后，本客户端用**纯本地**的 `setTheme('rider-dark')` 维持深色基座（注册主题 id 不写设置文档，因此不会反复重试那个写不进去的文件），用户点「深色」不会再被弹回「系统」。
- 设置行内据此给出三种提示：`row.lightBase`（你确实选了浅色）、`row.notSaved`（写不进去，本页自行维持深色，其它设置项仍会丢）、`row.persistFailed`（连基座都没保住）。

实现见 `rider-theme/client.js` 的 `trackWrite` / `assertDark` / `noticeFor`，回归用例 `rider-theme/design/test-persist-notice.mjs`（32 项，含"被拒后不重复写文档""被拒不弹回系统"等断言）。

需要强调的是：这是**插件侧的兜底**，不是修复 —— 只要 DSH 仍把用户设置存在「又会交给外部编辑器」的同一个文件里，该 profile 的**其它**设置项依旧会继续静默失败，根因仍在 DSH 侧。

## 六、定位手法（可复用）

- 占用者反查：Windows Restart Manager（`RmStartSession` / `RmRegisterResources` / `RmGetList`），比 `handle.exe` 免安装。**注意它给出的是持有句柄的进程**（本例是编辑器/IDE 主进程），不是"触发原因"（触发原因是它里面的 agent 会话）。
- 影响确认：同目录「未占用文件 vs 目标文件」的 rename 对照实验，即可区分「目录/ACL 问题」与「文件被持有」。
- 持续 vs 间歇：每 3 秒做一次与上层完全相同的替换操作，采样 45 秒 —— 15/15 失败=持续占用；时好时坏=对方在做扫描/索引，考虑有限重试。
- 端到端确认：直接打 `/api/settings/describe` 与 `/api/settings/mutate`，看 `revision` 是否递增、`user` 是否出现字段；**HTTP 200 不代表成功**，要看响应信封里的 `ok/error`。
- 日志指纹：编辑器/IDE 日志里搜被占路径，能直接看到是谁在开它（本例 `ERROR [crates/acp_thread/src/acp_thread.rs:1716] opening file "<配置文件路径>"`）。
- 持久化核查：SQLite 只读核查（**先复制 `.db`+`-wal`+`-shm` 再打开**，别去锁活库）——查"孤儿编辑器行"（有 editor 记录、`items` 表里却没有对应条目 = 有句柄无标签）；agent 侧查 opencode 的 `session/message/part` 表即可定位到具体会话。
- 处置顺序：**先查触发者，再决定动不动配置**（本例里"改 `restore_on_startup`"只是权宜，真正原因是 agent 上下文；用户也明确不接受改编辑器配置）。

## 七、触发者定位（追加：不是 Zed 启动、也不是 opencode 进程）

### 1) 三条证据链

| 证据 | 内容 |
|---|---|
| 持有者 | Restart Manager 恒报 **Zed 主进程**（`app="Zed"`，PID 随重启变化），**不是**它拉起的 `opencode.exe`（opencode 以 `acp` 模式运行，父进程是 Zed 的子 PowerShell） |
| 触发者 | `Zed.log` 反复出现 ACP 线程在开这些路径：<br>`ERROR [crates/acp_thread/src/acp_thread.rs:1716] opening file "C:\Users\<user>\.dsh\profiles\desktop"`（16:50:51 ×2、16:50:58、16:56:42、17:10:03、17:27:43） |
| 残留状态 | Zed 的 `db.sqlite` 里 `editors` 表仍有该文件的 **2 行孤儿记录**（`workspace_id=66`、`contents=NULL`），而同一 workspace 的 `items` 表**为空** → 解释了"有句柄、界面上却没有标签页" |

### 2) 对照实验（决定性）

| 场景 | 结果 |
|---|---|
| Zed 重启、opencode 也在跑，但**没有恢复那个 agent 会话** | 两份 `cordis.patch.yml` 均 `free`，替换探测 **3/3 + 3/3 成功** |
| 恢复/使用那个引用了 `.dsh` 路径的 agent 会话 | 45 秒采样 **0/15 成功**，holder 恒为 Zed |

⇒ 因此：**关标签页无效**（没有标签页可关）、**重启 Zed 无效**（会话/线程状态会被恢复）、**杀 opencode 无效**（句柄在 Zed 主进程上）。唯一对症的动作是：**在 Zed 的 Agent 面板删掉那个会话**（本例会话 id `ses_ebcd5c7e3ffe…`，标题「dsh web 配置 deepseek harness desktop 插件」，目录 `D:/Users/dsh-local-plugins`），然后重启 Zed 复查仍为 `free`。

### 3) 给使用者的两条经验

1. **别把 `~/.dsh`、`~/.config` 这类"活配置目录"交给 AI agent 当上下文/工作目录** —— 一旦收进上下文，对方就会长期持有这些文件，让所有依赖原子替换的写入全部失败；
2. 会话是**按项目持久化**的，用完就删；"关窗口/关标签页"不等于删会话。

---

## 八、追加：被禁的不是「写」，是「替换」—— 于是可以不改编辑器就修好

第七节给的处置（删掉那个 agent 会话 / 关掉编辑器）在**使用者体验上是不可接受的**：
要求"每次改设置前先关 Zed"本身就是一个 bug。于是回头测了「到底哪个权限被挡」。

### 1) 2026-10-16 18:13 复测（两份文档均被 Zed 主进程持有）

| 操作 | `profiles/web/cordis.patch.yml` | `profiles/desktop/cordis.patch.yml` |
|---|---|---|
| 独占打开（`FileShare.None`） | 拒绝 | 拒绝 |
| 以 read / write / delete 权限打开 | **都允许** | **都允许** |
| `MoveFileEx(REPLACE_EXISTING)`（= DSH 保存的最后一步） | **Win32 5 Access denied** | **Win32 5 Access denied** |
| 同目录 rename 到新名字（对照） | OK | OK |
| **原地覆写同一文件（同字节重写）** | **OK** | **OK** |

同刻 45 秒采样（每 3 秒一次替换探测）：**0/15**，holder 恒为 `app="Zed"`（PID 随重启变化）；
`Zed.log` 18:11:28 仍在 `acp_thread … opening file "…\.dsh\profiles\desktop"`。

⇒ 结论：**句柄挡的是"改名替换"这个元数据操作，不是文件内容本身。** 所以只要写入路径肯退化，
就**不需要**删会话、不需要关编辑器、不需要改编辑器配置。

### 2) DSH 侧的写入咽喉与它现有的重试

```text
dsh-config-editor/lib/index.js:123   writeFileAtomic(path, document, { mode: 0o600 })
  └─ @deepseek-ai/dsh-atomic-write   lib/index.js
       writeFileAtomic → <file>.<hex>.tmp (wx) → renameAtomicTemp()
       renameAtomicTemp: Windows EACCES/EBUSY/EPERM 重试 8 次（20→200ms，约 1.3s）
       重试耗尽 → rm(temp) → throw      ← 设置就在这里丢
```

重试是对付**瞬时**干扰（索引器、杀软）的正确设计；对一个**整场会话**都不松手的句柄，
重试预算 1.3 秒就花完了，下一次写入再从零开始 —— 永远等不到。

### 3) 已落地的兜底（本机已验证，等同第四节第 2 条建议）

`D:\Users\dsh-local-plugins\patches\apply-dsh-atomic-write-fallback.mjs` 给该模块追加一段
`dsh-local-patch` 标记的代码，把导出换成包装函数：上游逻辑照旧；**只在 Windows 的
`EACCES/EBUSY/EPERM` 且重试已耗尽时**，退化为「写 `<文件>.bak` → 打开目标 `r+` → 写入 →
`truncate` → `fsync` → 按上游约定 `chmod`」，成功即返回；任一步失败仍抛出原错误（保持原行为）。

- 验证：**17/17** —— 无人占用时仍走 rename 且**不产生 `.bak`**；被 Zed 持有的两份文档写入成功、
  字节不变、`.bak` 与原文一致、退化为 `process.emitWarning`
  （`DSH_ATOMIC_WRITE_INPLACE_FALLBACK`）；测试用临时文件与 `.bak` 均已清理。
- 生效时机：**需重启 `dsh`**（正在跑的进程已经把旧模块读进内存）。
- 代价：**这一次替换不再原子**（读方可能在几 KB 的写入窗口内看到半份文件），有 `.bak` 兜底；
  只想 Windows 生效；可设 `DSH_ATOMIC_WRITE_NO_INPLACE_FALLBACK=1` 关掉；**升级 DSH 后需重跑重打脚本**。
- 上游 issue 草稿：`patches/issue-atomic-write-inplace-fallback.md`。

### 4) 顺带修掉的插件副作用

上一版插件把"被拒"当成"`外观` 行此后一律无效"，于是**你新点「跟随系统」会被强行切回深色**，
且行内文案把「跟随系统（系统是浅色）」说成"你在「外观」里选了浅色"。现已改为：
只要某个 builtin 偏好**文档里本来就没有**（= 你刚点的那一下），即使处于被拒状态也尊重它；
而被拒写入失败后"回退成文档旧值"的那次推送不满足该条件，深色基座照样被断言住（老 bug 不复发）。
文案拆出 `row.systemBase`，回归测试 37/37（`rider-theme/design/test-persist-notice.mjs`）。

---

## 九、追加：占用本身可以被摘掉 —— 换文件对象，而不是动对方句柄（Zed 全程未关）

第八节证明"被占着也能存"。这一节回答更狠的一问：**能不能让占用本身消失，且不关编辑器、不动它任何配置？**
能，实测如下（Zed pid 22612 与 opencode 全程在跑）。

### 1) 先把"到底被什么挡着"量干净（受控对照，四臂）

| 持有方式 | 独占打开 | 写权限 | delete 权限 | `MoveFileEx(REPLACE_EXISTING)` |
|---|---|---|---|---|
| 线上实际（Zed） | 拒绝(32) | 允许 | 允许 | **失败 5** |
| 臂A 只有内存映射（文件句柄已关） | free | 允许 | 允许 | **成功** |
| 臂B 映射 + 文件句柄 | 拒绝(32) | 允许 | 允许 | 失败 5 |
| 臂C 普通句柄 share=读\|写\|删 | 拒绝(32) | 允许 | 允许 | **失败 5** |
| 臂D 普通句柄 share 不含删 | 拒绝(32) | 允许 | 拒绝(32) | 失败 5 |

两条结论：

- 线上就是**普通文件句柄**（臂C 完整复现其签名），不是内存映射 —— 第二节"内存映射持有"的猜测据此修正；
- **即使对方共享了 `DELETE`，`MoveFileEx(REPLACE_EXISTING)` 依旧返回 5**。所以"共享模式"不是判据，
  这个 API 的脾气就是"目标必须没人开着"，而 Node 的 `fs.rename` 正是它 —— 这就是保存路径无路可走的真正原因。

### 2) 两个绕开它的原语（都在被持有的同一份文件上成功）

| 原语 | 结果 |
|---|---|
| `ReplaceFileW(target, staged, NULL, REPLACEFILE_IGNORE_MERGE_ERRORS, 0, 0)` | **OK** |
| `DeleteFile(target)` → `MoveFile(staged, target)`（先摘名、再落名） | **OK** |

两者都会**换掉路径指向的文件对象**：对方那个句柄退化为"指向一个已无名的旧文件"，不再占住这个路径。
解锁后立刻复测：路径 `free`，普通原子 rename 也恢复；20 秒采样（每 5 秒一次）**4/4 保持 free**。

### 3) 本机已落地

- 两份设置文档均已解开（内容逐字节一致：web 4342 字节 / 133 行 / `preference: dark` 仍在；desktop hash 不变），
  **Zed 全程没有关闭、没有重启、没有改配置**；
- 工具：`patches/unlock-settings-document.mjs`（`--check` / `--target` / `--settle`）；端到端测试：
  受控持有 → 检测 `held` → 解锁 → hash 不变 → `free`；
- 边界：对方**没有**共享删除权限时 `rm` 会被拒 —— 脚本只报告、不改动，写入仍由第八节的原地覆写兜底；
  这是"路径级解锁"而不是"让对方松手"，那个 agent 会话下次重新打开该路径时占用会回来，再跑一次即可。

### 4) 处置顺序

**① 先摘占用（无需打扰任何人、不动编辑器）→ ② 摘不掉就靠补丁写入 → ③ 都不管时，上游把用户设置与
「交给外部编辑器打开的文件」分开（第七节的根因）。** "关掉编辑器"从来不是必须项 —— 本次全程没有关过 Zed。
