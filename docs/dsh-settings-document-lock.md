# [DSH] web profile 设置写入静默丢失：设置文档被外部程序占用

- **环境**：DeepSeek Harness `0.2.0-rc.2`，`dsh web --port 11111 --no-open`，Windows 11（本机实测）
- **影响面**：`dsh web`（web profile）下**任何**设置写入都不落盘 —— 内置「外观（浅色/深色/跟随系统）」、字号、以及所有插件注册到设置面板的开关；桌面端使用同一 profile 文件时同样受影响
- **表现**：UI 无任何报错。客户端先乐观显示新值，随后被宿主推回的旧值覆盖，刷新后仍是旧值 —— 用户看到的是「点了没反应 / 一会儿自己变回去」；点「深色」还会**自动跳回「跟随系统」**
- **定位结论**：profile 的用户设置文档（`profiles/<profile>/cordis.patch.yml`）被外部程序持有（本例：**Zed 的 ACP agent 会话**，见第七节），DSH 的「临时文件 + 原子 rename」写入被系统拒绝（`EPERM`）
- **重要鉴别**：**「重启 Zed」与「关标签页」都无效** —— 触发器不是 Zed 启动、也不是可见的编辑器标签，而是 **agent 会话把它当上下文**（见第七节）

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
