# agy MCP 桥接器代码审计报告

> 审计对象：`D:\Users\dsh-local-plugins\agy-bridge`
> 审计方式：`mcp__agy__research` 双切面只读委托（服务端核心 / 进程治理与启动器）+ 宿主逐条源码抽验
> 审计时间：2026-11-08
> 审计性质：只读静态审计，未修改任何文件
> 结论状态：P0 止血已完成；P1 服务端加固已于 2026-11-08 完成（见文末「修复记录」）

---

## 一、架构链路

```
DSH → @deepseek-ai/dsh-mcp-client → node bin/launch.mjs
    → python server/agy_bridge_server.py   (stdio, NDJSON 下行 / 双模上行)
    → subprocess.run → agy.exe --sandbox --mode plan --output-format json
    → 派生 powershell / python 探针（不受 Job 约束）

并发第二轨：bin/agy-run.mjs → 直接 spawn agy.exe（绕开 Python bridge 与 MCP 超时夹具）
```

| 维度 | 事实 |
| :--- | :--- |
| 传输 | stdio；下行 NDJSON 单行帧，上行兼容 NDJSON 与 `Content-Length` 双模 |
| 依赖 | 零第三方依赖；Python >= 3.10（PEP 723 内联元数据，`dependencies = []`） |
| 启动折叠 | `node → python` 直启，规避 uv 包装层常驻约 40MB |
| 工具面 | 仅 `research` + `list_models`，均为同步阻塞工具 |
| 只读约束 | `--sandbox --mode plan --output-format json` 硬编码注入 |
| 超时契约 | 服务端上限 3600s；客户端 `toolCallTimeoutMs: 3700000` |

### 与 agy CLI 的耦合点

- 二进制探测顺序：`AGY_BIN` 环境变量 → `agy-bridge.config.json` 的 `agyPath` → PATH → `%LOCALAPPDATA%\agy\bin\agy.exe`（`server/agy_bridge_server.py:107-136`）。
- 子进程继承全量环境变量，未做剥离过滤。
- Windows 追加 `CREATE_NO_WINDOW (0x08000000)` 防控制台闪窗。

---

## 二、MCP 工具面

| 工具 | 入参 | 返回 | 限制 |
| :--- | :--- | :--- | :--- |
| `research` | `prompt`(必填, ≤200000 字符)、`cwd`、`model`、`effort`(low..max)、`add_dir[]`、`timeout_seconds`(默认 600) | `content[].text` + `structuredContent{model, effort, cwd, durationS, readOnly, planWait, continuations, text}` | 同步阻塞；timeout 钳制 [30, 3600] |
| `list_models` | 空对象 | `structuredContent{kind:"models", models[{id,label}]}` | 硬超时 120s，解析 `agy models` 制表符输出 |

> **关键判定：`research_submit` / `research_status` / `research_result` / `research_cancel` 四件套不存在。**
> 在 `plans/tasks.md:146-150` 中属尚未动工的 T9。当前无任何异步作业句柄工具。

### research 执行链路

1. **守卫注入**：`len(prompt) > 200_000` 直接拒绝（`:310-314`）；首轮在 prompt 末尾追加 `GUARDRAILS` 文本（`:62-69`, `:342`），声明非交互 `-p` 模式、禁止停在中间计划、要求同回合直出正文。
2. **命令拼装**：`agy -p "<prompt>\n<GUARDRAILS>" --sandbox --mode plan --output-format json [--model] [--effort] [--add-dir ...]`（`:331-344`）。
3. **有界续跑**：退出码 0 且文本命中 `PLAN_WAIT_PATTERN` 且有 `conversation_id` 时，追加 `--conversation <id>` 续跑一次；`MAX_CONTINUATIONS = 1`（`:79`, `:359-386`）。续跑成功才覆盖文本，否则保留首轮产物。
4. **文本提取**：`parse_envelope` 取 `conversation_id`；`_walk_for_text` 深度 ≤6，按 `response/result/output/text/content` 优先递归取首个非空字符串（`:214-239`）。
5. **错误分类**：`invalid_arguments` / `prompt_too_large` / `invalid_cwd` / `agy_not_found` / `agy_spawn_failed` / `empty_output` / `agy_failed` / `bridge_internal_error`。

---

## 三、高危发现（已逐条抽验）

### H1. `win_job.py` 是死代码，孤儿治理未闭环

- **证据**：`server/agy_bridge_server.py:34-42` 的 import 列表无 `win_job`；执行仍为裸 `subprocess.run(..., capture_output=True, timeout=timeout_s)`（`:156-160`）。
- **机理**：`win_job.py` 已实现 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`（`:50`）、Win11 144 字节结构体动态探测（`:58`, `:109`）、`create_containment_job()` 自身收容（`:289`）、`NullJob` 降级（`:162`），但从未被服务端引用。
- **后果**：超时或外部终止时仅杀 `agy.exe`，其派生的 `powershell` / `python` 探针全部逃逸为空转孤儿。
- **修复**：`main()` 入口持有 `job = win_job.create_containment_job()` 并全程不关闭。增量最小，风险最低。

### H2. 单线程阻塞 + 取消通知被吞

- **证据**：`main()`（`:630-655`）为纯单线程 `while True` 读 stdin → `handle_request` → 同步 `subprocess.run`；`threading` 仅用于 `_log_lock`（`:89`）与 `_stdout_lock`（`:540`），无分发线程。`notifications/*` 被直接 `return None`（`:597-598`）。
- **后果**：一次长 research 冻结整个服务端，期间 `ping`/`tools/list`/`list_models` 全部队头阻塞；客户端 `notifications/cancelled` 永远无法到达执行层，废弃请求会在管道里排队并被延迟执行。
- **修复**：工作线程分发 tools/call + 记录在飞 PID + 响应 cancelled 时 `taskkill /T /F`。

### H3. 200k 字符预算走 `-p` 命令行，Windows 下必然崩

- **证据**：`MAX_PROMPT_CHARS = 200_000`（`:57`），直接拼入 `["-p", f"{prompt}\n{GUARDRAILS}", ...]`（`:342`）。
- **机理**：Windows `CreateProcessW` 命令行硬上限 32767 字符，超限抛 `OSError: [WinError 206]`。
- **后果**：声明的 200k 预算形同虚设；大 prompt 报 `agy_spawn_failed` 而非优雅执行。
- **修复**：超阈值改临时文件 + stdin 或 `--prompt-file` 传参。

---

## 四、中低危发现（已核实）

| 级别 | 问题 | 位置 | 说明 |
| :---: | :--- | :--- | :--- |
| 中 | 续跑未扣减首轮耗时 | `:344`、`:370` | 二次续跑仍传原始 `timeout_s`，单次最坏 2×timeout（7200s），击穿客户端 3700s 上限 |
| 中 | 默认 cwd 回退到服务端目录 | `:319` | `cwd or Path(__file__).parent`，不传 cwd 时在 `agy-bridge\server` 内做无意义检索；`cwd` 应必填 |
| 中 | `_walk_for_text` 可能误取提问 | `:220-238` | 列表遍历无条件取首个非空字符串，遇 `messages` 历史会返回用户 prompt 或 guardrail 文本 |
| 低 | 强制 UTF-8 解码 + replace | `:184-189` | Windows 中文环境 stderr 乱码污染报告，并导致 `PLAN_WAIT_PATTERN` 失配、续跑静默失效 |
| 低 | `capture_output` 无流式上限 | `:156` | 超大输出一次性入内存，存在颠簸风险 |
| 低 | `launch.mjs` 信号处理在 Windows 形同虚设 | `bin/launch.mjs:64-68` | Windows 不投递 SIGINT/SIGTERM；即使触发，`child.kill()` 只杀 python 不杀 agy 树 |

---

## 五、后台作业通道（agy-run.mjs）评估

结论：**当前最可靠的宽面长任务通道**，与同步 MCP 通道形成两轨。

- 不经过 Python bridge、不充当 MCP 客户端，直接 `spawn(agy, argv)`（`bin/agy-run.mjs:176`）。
- 固定 `--output-format stream-json`，逐行解析 `init` / `step_update` / `result` 事件，进度落盘 jsonl。
- 超时用 `taskkill /PID <pid> /T /F` 连坐回收整棵树（`:138`），规避 `child.kill()` 缺陷。
- `--continue-once` 命中 `PLAN_WAIT_PATTERN` 时自动续跑一次（`:333-358`）。
- 退出码语义化：`EXIT_TIMEOUT=2`、`EXIT_USAGE=4`、`EXIT_PLAN_WAIT=5`。
- 终端只打印元数据摘要，报告落 `--out` 文件，避免灌满上层上下文。

---

## 六、对照 plans/ 治理方案的落地现状

| 任务 | 状态 |
| :--- | :--- |
| T0 超时配置（`toolCallTimeoutMs: 3700000`） | 已落地 |
| T2 后台作业封装 `agy-run.mjs` | 已落地 |
| T5 Windows Job Object 原语 | 原语已落地并测试，**接线未做** |
| T8/T8b 守卫注入与单次续跑 | 已落地 |
| T3 读循环多线程化 + 作业状态机 | 未实现 |
| T4 取消通道 | 未实现 |
| T6 服务端 stream-json 解析 | 未实现（仍 `--output-format json`，黑盒无进度） |
| T7 静默看门狗 / CPU 限制 | 未实现 |
| T9/T10 异步作业句柄四件套 + 长报告有界交付 | 未实现 |
| P2/T11-T12 宿主侧 TS 作业插件 | 未动工 |
| P3/T13 mcp-client 超时补丁 | 未实现 |

---

## 七、修复优先级

1. **T5 接线**：`main()` 最前端 `job = win_job.create_containment_job()`，全程持有。
2. **续跑扣减**：`remaining = timeout_s - meta["durationS"]`，不足则放弃续跑。
3. **prompt 传参改造**：超阈值写临时文件走 `--prompt-file` / stdin。
4. **T3/T4**：工作线程分发 + 响应 `notifications/cancelled`。
5. **cwd 必填化**，并把 `_walk_for_text` 改为优先取 assistant 角色的最后一条文本。
6. **路由规范**：≥3 分钟任务一律走 `bin/agy-run.mjs`，同步通道只接短任务。

---

## 八、抽验记录

agy 报告中的行号与定性已由宿主逐条核对源码，未发现虚报：

- `server/agy_bridge_server.py`：import 列表 `:34-42`、`MAX_PROMPT_CHARS` `:57`、`-p` 拼接 `:342`、`effective_cwd` `:319`、续跑 `timeout_s` `:344/:370`、`notifications/` 吞噬 `:597`、`MAX_CONTINUATIONS` `:79`、`run_agy` `:156-160`。
- `server/win_job.py`：`KILL_ON_JOB_CLOSE` `:50`、候选表 `:58`、`_probe_extended_limit_length` `:109`、`create_containment_job` `:289`、`NullJob` `:162`。
- `bin/agy-run.mjs`：`taskkill /T /F` `:138`、`spawn` `:176`、`stream-json` `:243`、`PLAN_WAIT_PATTERN` `:48`、`--continue-once` `:112`。
- 异步工具四件套不存在：由会话工具清单直接证实（仅 `research` 与 `list_models`）。

> 自证观察：本次两份委托本身走的正是 `research` 同步通道。若超过客户端超时，就会真实触发 H1/H2 描述的「单线程冻结 + 孤儿探针」风险——这也是把长任务强制路由到后台作业的意义所在。

---

## 九、修复记录（2026-11-08）

### 已修复

| 编号 | 问题 | 改动 | 验证 |
| :--- | :--- | :--- | :--- |
| H1 | `win_job` 未接线 | `main()` 启动即 `create_containment_job()` 并全程持有 | stderr 出现 `win_job containment active (kill-on-close)` |
| H2 | 单线程阻塞 + 取消被吞 | 读帧循环与 `tools/call` 执行分离（daemon 工作线程）；`notifications/cancelled` 绑定 `requestId` → `InflightTask.cancel()` → `taskkill /T /F` | research 进行中 ping 延迟 **0.00s**；取消返回 `cancelled` |
| H3 | 200k 字符走 `-p` 必然崩 | `MAX_PROMPT_CHARS` 200000 → **24000**，错误信息改为指引落盘 + `cwd`/`add_dir` | 25000 字符 prompt 返回 `prompt_too_large` |
| 中 | 续跑未扣减首轮耗时 | `remaining = timeout_s - durationS`，低于 `MIN_CONTINUATION_S=30` 放弃续跑 | 代码审查（续跑路径仅在 plan-wait 时触发） |
| 中 | 默认 cwd 回退到服务端目录 | `cwd` 改为必填，缺失返回 `invalid_cwd`；schema `required` 同步 | 缺 cwd 返回 `invalid_cwd` |
| 低 | 强制 UTF-8 解码 | `_decode` 改为 UTF-8 → GBK → replace 三级回退 | 语法/集成测试 |
| 低 | `launch.mjs` 信号处理在 Windows 无效 | 改为 `taskkill /T /F` 杀 python 树，并补 `exit` 兜底 | `node --check` 通过 |

### 未修复（仍属后续任务）

| 项 | 原因 |
| :--- | :--- |
| T6 服务端 `stream-json` 实时进度 | 需要改造 `--output-format` 与事件流解析，改动面大；当前 `json` envelope 已够用 |
| T7 静默看门狗 / CPU 限制 | 依赖 stream-json 事件流，随 T6 一起做 |
| T9/T10 异步作业句柄四件套 | 工具面从 2 个扩到 6 个，属独立设计 |
| T3 作业状态机 | 已在 H2 中做了「多线程分发」这一半，剩余的状态机与有界交付未做 |

### 一条更正

`_walk_for_text` 误取 `messages` 的担忧**不成立**：实测 agy 的 `--output-format json` envelope 是扁平的
`{conversation_id, status, response, duration_seconds, num_turns, usage}`，`response` 在顶层且是唯一文本字段，
不存在 `messages` 数组。该项从「中危」降级为「理论风险，当前不触发」，未改代码。

### 测试证据

- `test/test_win_job.py` 3/3 通过（含持有者死亡连坐、assign 不追溯、未纳入进程不受影响）。
- 端到端 9 项全 PASS：initialize、tools/list（cwd 在 required）、ping、list_models（6 个模型）、
  research 成功、**research 中 ping 0.00s**、取消返回 `cancelled`、无效 cwd、服务端正常退出。
- 边界 3 项全 PASS：oversize prompt、缺失 cwd、research 回归。
- 测试后 `agy` 残留进程：无。

> 注意：DSH 当前加载的是旧版 bridge 进程，需重启 DSH（或重载该 MCP 服务）后新代码才生效。
