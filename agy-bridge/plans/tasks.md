# tasks.md：agy-bridge 长任务断连与孤儿进程治理 · 实施任务清单

> 配套方案：[`01-长任务断连与孤儿进程治理方案.md`](./01-长任务断连与孤儿进程治理方案.md)
> 执行纪律：按 Task 编号顺序执行；每完成一项在本文件勾选 `[x]`；涉及 `language_projects` 侧规范
> 文档（T1）改动时，收尾须补一次 `aoci_maintain`。
> 命名约定：本文件中的"桥接器"= `agy-bridge/server/agy_bridge_server.py`（下称 `server.py`）。

## 验收标准（Definition of Done）

一份改造只有在下列 5 条同时成立时才算完成，且每条都有可执行判据（禁止"看起来没进程了"式验收）：

| # | 判据 | 验收命令/证据 |
| :-- | :--- | :--- |
| D1 | **取消/超时后进程树真正归零** | kill 后 3 s 内 `agy.exe` + 其 `python`/`powershell` 孙进程计数为 0 |
| D2 | **主 Agent 不再长挂** | 提交类工具调用 < 5 s 返回 `{job_id}` |
| D3 | **进度可观测** | `status` 返回的 `step_index` 在运行期单调递增 |
| D4 | **CPU 有上限** | 受控 CPU 燃烧 stub 触发 Job CPU 上限后被杀 |
| D5 | **不再产生"无人等待的运行"** | 测试窗口内新建 agy brainstorm 会话数 == 提交的 job 数（多一个即为延迟执行废弃请求） |

---

## P0 · 止血（分钟级，先让重型任务不再命中同步通道）

- [x] **T0 收尾当前未提交的超时配置改动**（2026-10-18 完成，Q8 取「先单独提交」）
  - 文件：`agy-bridge/cordis.patch.yml`、`agy-bridge/cordis.patch.resolved.yml`、`agy-bridge/README.md`、
    `agy-bridge/plans/01-长任务断连与孤儿进程治理方案.md`、`agy-bridge/plans/tasks.md`
  - 实现：把三处 `toolCallTimeoutMs: 240000 → 3700000` 与 README 说明**单独提交**；本计划两文件
    按"计划独占提交"纪律另起一次提交（Q8 待确认）
  - 验证：`git status --short` 仅剩预期文件；`git log --oneline -3` 可见两次独立提交
  - Demo：`git show --stat HEAD` 只含计划文件，不含业务代码

- [ ] **T1 修正全局子任务委托路由（GLOBAL.md）**
  - 文件：`~/.dsh/AGENTS.md` 的**真身**（该路径是软链，先 `Resolve-Path`/`Get-Item ... | Select-Object LinkTarget`
    取真身，真身由 `language_projects` 仓托管）
  - 实现：在「八、子任务委托路由」补一条硬约束与可执行入口：*同步 MCP 通道只用于"预期 < 3 分钟"的
    窄委托；宽面调研/全仓审计一律走后台作业或作业句柄通道*；并给出 T2 的封装脚本入口；
    同时把 3.4 的两条"走不通的路"（progress 通知、MCP Tasks）写成一句提醒，避免后续重复设计
  - 验证：`Get-Item ~/.dsh/AGENTS.md` 真身文件字节数 < 24 000（agy 规则文件硬上限）；该节 grep 得到新条目
  - Demo：下次模型接到"全仓架构审计"时，路由表直接把它推向后台作业通道

- [x] **T2 沉淀统一封装脚本（后台作业模式入口）**（2026-10-18 完成并实测）
  - 产物：`agy-bridge/bin/agy-run.mjs`（含守卫段注入、stream-json 进度落盘、报告落盘、
    超时连整棵进程树回收、plan-and-wait 检测与 `--continue-once` 有界自动续跑）
  - 实测记录（6 次运行）：快乐路径 exit 0 / 14.3 s / `planWait=no`；确定性诱发 + `--continue-once`
    → 命中并自动续跑，`continuations=1`、`turns=2`、exit 0、报告为真实交付物；
    守卫段文件缺失时 fail-fast（exit 4），不静默回退
  - 文件：新增 `agy-bridge/bin/agy-run.mjs`
  - 实现：`node bin/agy-run.mjs --prompt-file <f> --cwd <dir> [--out <report>] [--progress <log>] [--print-timeout 900s]`；
    固定拼装 `--sandbox --mode plan --output-format stream-json`；逐事件追加进度行到 `--progress`；
    结束时把 `result.response` 落 `--out`（默认 `$env:TEMP`）；退出码语义化（0 成功 / 2 超时 / 3 agy 失败）
  - 验证：`node agy-bridge/bin/agy-run.mjs --prompt-file <含"只回答两个字：收到">的临时文件 --cwd D:\Users\language_projects`
    预期：`--out` 文件含"收到"，`--progress` 至少 4 行（`init` / `step_update`×n / `result`），退出码 0
  - Demo：把这条命令塞进 `pwsh run_in_background`，主 Agent 立即拿回 job id，完成时收到会话内通知

---

## P1 · 桥接器加固（消除孤儿 + 消除延迟执行废弃请求）

- [ ] **T3 读循环线程化 + 作业状态机**
  - 文件：`agy-bridge/server/agy_bridge_server.py`
  - 实现：主循环只负责读帧并分发；`tools/call` 的耗时工作搬到 worker 线程（每 job 一线程，
    全局并发上限见 Q4，超限时排队并回报 `queued`）；新增 job 表
    `{job_id, state: queued|running|stalled|completed|failed|cancelled, progress, result, created_at}`；
    结算后按 TTL 保留（默认 30 分钟）再回收；`stdout` 写仍走既有 `_stdout_lock`
  - 验证：脚本化并发 2 个 job（第 2 个为 `list_models` 级别短任务），断言第 2 个在**第 1 个未结束时**
    即返回——即证明不再 head-of-line 阻塞
  - Demo：`mcp__agy__list_models` 在长调研进行中依然秒回

- [ ] **T4 取消通道（`notifications/cancelled` → kill tree）**
  - 文件：`agy-bridge/server/agy_bridge_server.py`
  - 实现：收到 `notifications/cancelled{requestId}` 时：若该 request 已转成 job，则对 job 执行
    `cancel(reason)`；`requestId → job` 映射在分发时登记、结算时清理；同时支持显式工具
    `research_cancel(job_id)`
  - 验证：手工向桥发 NDJSON：`tools/call` → 等 2 s → `notifications/cancelled`；
    断言 3 s 内（见 D1）进程树计数为 0，且 job 终态为 `cancelled`
  - Demo：DSH 客户端 240 s 超时时，服务端**当秒收手**，不再"超时后还在跑"

- [ ] **T5 Windows Job Object 连坐回收（+ CPU/进程数上限）**
  - 文件：`agy-bridge/server/agy_bridge_server.py`（新增 `ctypes` 段：`jobobject.py` 或同文件内私有区）
  - 实现：`CreateJobObjectW` → `SetInformationJobObject(JobObjectExtendedLimitInformation)` 设
    `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`、`ActiveProcessLimit`、`PerJobUserTimeLimit`（Q3 取值）→
    `Popen` 后立即 `AssignProcessToJobObject`（用 `Popen._handle` 或 `OpenProcess`）；
    **Job 只装 agy 子树，绝不装桥接器自身**；非 Windows 回退进程组 + 树杀
  - 验证（受控、可重复，不依赖 agy 行为）：`AGY_BIN` 指向 stub（stub 自己再拉起一个 CPU 燃烧
    孙进程）→ 断言 (a) 桥接器进程被 `taskkill /F` 后 3 s 内 stub 与孙进程计数为 0（D1），
    (b) 孙进程触发 `PerJobUserTimeLimit` 后被杀（D4）
  - Demo：任务管理器里再也看不到"agy 死了但 python 还在 100%"的场面

- [ ] **T6 改用 `--output-format stream-json` 做真实进度**
  - 文件：`agy-bridge/server/agy_bridge_server.py`
  - 实现：`Popen(..., stdout=PIPE)` 逐行解析 NDJSON：`init`（取 `conversation_id`）/`step_update`
    （取 `step_index`、`state`、`step_type`、`usage`）/`result`（终态）；未知事件只计数不报错；
    job.progress 暴露 `{step_index, step_type, elapsed_s, tokens, last_event_at, conversation_id}`；
    保留 `--output-format json` 回退开关（若 stream-json 不可用）
  - 验证：把本方案 3.5 的 5 行事件存为 fixture，断言解析出 `step_index=5`、`turns=1`、
    `conversation_id` 非空；真实跑一次断言 `status` 的 `step_index` 单调递增（D3）
  - Demo：模型/用户能实时看到"第 37 步 · tool · 已跑 5 分 12 秒"，而不是黑盒盲等

- [ ] **T7 静默看门狗与总时长上限**
  - 文件：`agy-bridge/server/agy_bridge_server.py`
  - 实现：后台守护线程每 5 s 检查：距 `last_event_at` 超过静默阈值（Q3，建议 180 s）或无 `step_index`
    推进 → 置 `stalled` 并 kill job；总时长上限沿用 `timeout_seconds`（默认 600，上限 3600）
  - 验证：stub 事件流故意停在 `tool` 步不再吐事件 → 断言到点后被杀且终态 `stalled`，
    且返回文本含 `step_index`/静默秒数（可诊断）
  - Demo：复现 3.3 的 `task-63`（0 字节后台任务永久等待）时，桥接器自己收手

- [ ] **T8 只读探针守卫（prompt 注入）**
  - 文件：`agy-bridge/server/agy_bridge_server.py`（常量集中置顶）、`agy-bridge/README.md`
  - 实现：每次调用在 prompt 末尾追加固定守卫段：① 文件枚举一律用 `git ls-files`（无 git 时用受限
    单层列举）；② **禁止** `Path.rglob` / `os.walk` 全盘裸扫；③ 目录遍历限深、限条数、限时；
    ④ 8 分钟预算内"先出结构，再补细节"；⑤ 禁止把探针脚本托管为长时间后台任务；
    ⑥ **非交互声明（关键）**：本调用为 `-p` print 模式、无人可点击 Proceed，必须在同一回合内直接
    产出最终交付物，禁止生成"待确认 / 请审阅"的计划文档；
    并给出可审计标记（如守卫段带固定前缀，便于日志核对）
  - 验证：对桥接器发一次调用，抓取构造出的 argv（新增 `--debug-argv` 或日志打印），断言守卫段存在且**只追加一次**；
    再跑一次真实窄调用，断言 agy 的事件流里不再出现 `rglob`（可 grep 事件文本）
  - Demo：`%TEMP%\check_ptrs.py` 这类脚本不再被生成

- [ ] **T8b 非交互 plan-mode 兜底（plan-and-wait 检测 + 有界自动续跑）**
  - 文件：`agy-bridge/server/agy_bridge_server.py`、`agy-bridge/test/`（夹具）
  - 前置结论（2026-10-18 实测，勿重复走弯路）：plan-and-wait **不可稳定复现**，属概率性失败模式；
    `--disable-slash-commands` 实测**无可观测影响**，不作为修复手段（详见方案 §3.6）。因此本任务
    的目标不是"让它不出现"，而是"它出现时自动消化"
  - 参考实现：`agy-bridge/bin/agy-run.mjs` 的 `--continue-once`（CLI 侧已落地并验证：
    `continuations=1`、`turns=2`、exit 0、产出真实交付物）；桥接器侧把同一机制搬进 job 状态机
  - 实现：识别「plan-and-wait 终态」——`result.status == SUCCESS` 但响应命中
    `待确认|请审阅|Proceed|确认无误后|等待您的批准` → 用 `agy --conversation <conversation_id>` 追加
    「继续：直接输出最终交付物，不要再征求批准」**自动续跑一次（硬上限 1 次，防死循环）**，
    续跑计入同一 job 的进度与时长；续跑仍命中则保留首轮产物并把 job 置为 `needs_attention`
  - 验证：① 用「先输出你打算怎么完成任务的计划，等我确认后再执行：<任务>」这一**确定性诱发 prompt**
    （实测 100% 命中）跑一次，断言 job 终态 `completed`、结果含实际交付物、`continuations == 1`；
    ② 统计法：同一中性 prompt 跑 5 次，记录自然命中率与守卫段⑥的效果（**不得**用单次"未复现"当作
    守卫有效的证据）；③ **负向写盘测试（仅在评估 `--mode auto` 时才做）**：要求 agy「把结果写进
    `.\_probe_write.md`」，断言该文件不存在，否则禁止切换模式
  - Demo：模型再也不会拿到「请点击 Proceed」这种没人能执行的答复

- [ ] **T9 工具面定型（短任务快捷路径 + 作业句柄四件套）**
  - 文件：`agy-bridge/server/agy_bridge_server.py`、`agy-bridge/README.md`
  - 实现：新增 `research_submit` / `research_status` / `research_cancel` / `research_result`；
    保留 `research` 作为兼容快捷路径（内部 = submit + 有界等待，默认上限 120 s，超时即返回 job_id
    而不是报错）；`cwd` 取值问题按 Q6 决策（建议必填）；`list_models` 不变
  - 验证：`tools/list` 返回 6 个工具名；`research` 在 120 s 内完成时行为与今日一致（回归），
    超时则返回 `{job_id, state:"running"}` 而非 `isError`
  - Demo：GLOBAL.md 委托路由里既有调用方式不破，同时多出异步通道

- [ ] **T10 结果交付有界化**
  - 文件：`agy-bridge/server/agy_bridge_server.py`（按 Q1 决策落地）
  - 实现：`research_result` 默认返回 head+tail 有界预览 + `omitted` 字节数 + 恢复指引
    （与宿主 spill 语义对齐）；仅当 Q1 选定"允许落盘"时才写 `%APPDATA%\language_projects\agy-bridge\jobs\<job_id>.md`
  - 验证：用超长 stub 输出断言返回长度受上限约束且 `omitted` 计数与真实丢失字节一致
  - Demo：一份 200 KB 的架构报告不会一次灌爆主上下文

---

## P2 · 宿主侧作业化（目标态：让"超时"这一类别消失）

- [ ] **T11 新增宿主侧作业插件 `@local/agy-job`**
  - 文件：新增 `dsh-local-plugins/agy-job/`（`package.json`、`index.js`、`cordis.patch.yml`、`README.md`）
  - 实现：作为 `ctx.jobs` 生产者注册 `kind: agy`；用宿主子进程层 spawn agy（直接继承 Windows
    kill-on-close Job 与输出 spill）；解析 stream-json 调 `updateProgress`；结算时把报告作为 job
    result 交付（超限走宿主 spill）；实现 `cancel` 钩子
  - 验证：`job_list` 能看到 `agy-N`；`job_output agy-1` 在完成前读到实时进度、完成后读到报告；
    **断言期间没有任何 `mcp__agy__*` 工具调用超时报错**（D2/D3）
  - Demo：主 Agent 提交一次 6 板块宽面调研后立刻继续干别的，完成时收到会话内通知

- [ ] **T12 装机与面板核验**
  - 文件：`~/.dsh/profiles/web/cordis.patch.yml`（与 desktop 同步）、`agy-job/cordis.patch.yml`
  - 实现：按 `cordis.patch.resolved.yml` 同款写法插入条目；**注意用绝对路径**（相对路径在 patch 行内
    无法解析）；同步更新 `dsh-local-plugins/README.md` 插件索引表
  - 验证：重启后侧栏「接口」面板出现 `agy-job`；`Get-ChildItem ~/.dsh/profiles/*/cordis.patch.yml`
    两份配置一致
  - Demo：一键可复原（删该块即 100% 回原生）

---

## P3 · 可选：宿主侧超时回收（仅在 P1 落地后仍观察到底层泄漏时做）

- [ ] **T13 `patches/apply-mcp-client-timeout-teardown.mjs`**
  - 文件：新增 `dsh-local-plugins/patches/apply-mcp-client-timeout-teardown.mjs`（结构照抄
    `patches/apply-dsh-atomic-write-fallback.mjs`）
  - 实现：给 `@deepseek-ai/dsh-mcp-client` 补两件事：① 工具调用超时后**回收该 server 的 generation**
    （transport `close()` → 杀直接子进程并触发桥接器连坐）；② 把 SDK 的 `Request timed out` 换写成
    含 server 名与预算的结构化错误（模型可据此决策）。要求：`//#region dsh-local-patch:` 标记、
    形状探针（`DEFAULT_TOOL_CALL_TIMEOUT_MS`、`toolCallTimeoutMs`、`export { Config, apply, ... }`）、
    备份记录、`--check/--revert`、打前 `import` 自检
  - 验证：`node patches/apply-dsh-mcp-client-timeout-teardown.mjs --check` → `已打补丁`；
    `--revert` 后 sha256 与备份一致；把 `toolCallTimeoutMs` 临时调回 20 s 触发一次超时，
    断言 3 s 内 `node/python/agy.exe` 三层计数为 0
  - Demo：即便桥接器不加固，宿主侧也保证"超时即断链"

---

## P4 · 回归与收尾

- [ ] **T14 端到端回归（含负向用例）**
  - 文件：新增 `agy-bridge/test/`（fixtures + 驱动脚本；fixture 复用 3.5 的事件样本）
  - 实现：四类用例：① 短任务同步路径不回归；② 长任务作业路径（提交→进度→取结果）；
    ③ 取消路径（D1）；④ CPU 上限路径（D4）；⑤ 废弃请求不延迟执行（D5，比对
    `~/.gemini/antigravity-cli/brain` 新建目录计数）
  - 验证：一条命令跑完全部用例，输出通过/失败表；失败即视为改造未完成
  - Demo：`node agy-bridge/test/run.mjs` 全绿

- [ ] **T15 文档与收尾提交**
  - 文件：`agy-bridge/README.md`（新增工具说明、故障排查表补 `stalled` / `cancelled` /
    Job CPU 上限三行）、`dsh-local-plugins/README.md`、「接口」面板说明
  - 实现：更新只读红线、工具面（2 → 6）、装机参数（超时契约改为"桥接器权威"）；
    清理 `%TEMP%` 历史探针残留；按仓库提交纪律分范围提交（插件 / patches / profile 各自独立）
  - 验证：`git status --short` 干净；README 中"零写盘"承诺与 Q1 决策一致（不一致即文档事故）
  - Demo：新人照 README 能在 10 分钟内复现整套链路
