# agy-bridge — agy 只读调研桥（DeepSeek Harness 本地插件）

把宿主机上的 Antigravity CLI（`agy`）以 **MCP stdio 服务**形态接入 DeepSeek Harness，
让 DSH 里的模型可以把「安全调研、代码审计、Bug 诊断」类任务**只读**地委托给 agy 执行。

```
DSH 模型 ──► mcp__agy__research (MCP 工具)
                │  @deepseek-ai/dsh-mcp-client 拉起
                ▼
      agy-bridge（本目录：stdio MCP server，零第三方依赖）
                │  子进程
                ▼
  agy -p "..." --sandbox --mode plan --output-format json
```

## 只读红线（硬编码，不可从工具参数绕过）

每次 agy 调用都固定拼装：

| 参数 | 作用 |
| :--- | :--- |
| `--sandbox` | agy 终端沙箱，高危命令物理拦截 |
| `--mode plan` | Plan 模式，只读：不落盘、不改文件、不执行变更 |
| `--output-format json` | 结构化输出，桥接器无损解析后返回纯文本 |

**不**携带 `--dangerously-skip-permissions`（按设计确认：先把风险面压到最低）。
桥接器自身零写盘：不落临时文件、不写缓存、不记录 prompt。

## 工具面（2 个）

| 工具名（DSH 内完整名） | 说明 |
| :--- | :--- |
| `mcp__agy__research` | 只读委托调研/审计。参数：`prompt`（必填）、`cwd`（工作目录，默认桥接器目录）、`model`、`effort`、`add_dir`、`timeout_seconds` |
| `mcp__agy__list_models` | 列出 agy 可用模型（本地调用，零额度） |

## 文件结构

```
agy-bridge/
├── package.json                # @local/agy-bridge 包元数据（dsh.bundle.patch 指向自身 patch）
├── bin/launch.mjs              # Node 启动器：绝对路径找到 uv，转发 stdio 给 Python 桥接器
├── server/agy_bridge_server.py # 桥接器本体（PEP 723，零依赖，纯标准库）
├── cordis.patch.yml            # 相对路径版 patch（包分发形态）
├── cordis.patch.resolved.yml   # 绝对路径版 patch（装入 profile 用，见下）
└── README.md
```

## 安装（web profile）

profile 的 user patch 里加一块（与 `mcp-aoci` / `mcp-argo` 同款写法），可直接抄
`cordis.patch.resolved.yml`：

```yaml
- insert:
    - id: mcp-agy
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: agy
        transport: stdio
        command: 'D:\nvm4w\nodejs\node.exe'
        args:
          - 'D:\Users\dsh-local-plugins\agy-bridge\bin\launch.mjs'
        toolCallTimeoutMs: 240000
```

说明：
- 目标文件：`~/.dsh/profiles/web/cordis.patch.yml`；
- `toolCallTimeoutMs` 必配：mcp-client 默认单次工具调用上限仅 60s，调研不够用；
- 本机 `uv` 位于 `C:\Users\29580\.local\bin\uv.exe`，`launch.mjs` 会按候选表自动定位，
  换机时如果能路径变了，改 `bin/launch.mjs` 顶部候选表即可。

## 一键复原（100% 无残留）

删除上面那一整块 `mcp-agy`（或整行注释掉），重启 DSH 即回原生状态：

- 桥接器进程随 mcp-client 卸载自动断连退出；
- 不写任何 DSH 数据库/缓存/会话；ag子进程全部回收；
- 不触碰 `subagent` 工具与任何 DSH 原生行为。

## 验证

1. 服务起来后，侧栏「接口（MCP）」面板应出现 `agy` 服务与 `research` / `list_models` 两个工具；
2. 让模型直接说「用 mcp__agy__research 调研 XXX」，或自己发一条；
3. 手测桥接器本身（不依赖 DSH）：

```powershell
# 直接冒烟：initialize → tools/list → tools/call(list_models)
python D:\Users\dsh-local-plugins\agy-bridge\server\agy_bridge_server.py
# （stdin 按 Content-Length 帧协议喂 JSON-RPC，或直接交给任何 MCP 客户端）
```

## 故障排查

| 症状 | 排查 |
| :--- | :--- |
| 面板里没有 agy 工具 | 看 profile patch 是否写对；重启 DSH 后仍无 → 检查 node/uv 路径 |
| `agy_not_found` | 设置环境变量 `AGY_BIN` 指向 agy.exe，或写 `server/agy-bridge.config.json` 的 `agyPath` |
| `agy_failed` | 文本里带 agy stderr 摘要；常见为网络/配额/登录态问题 |
| 工具调用 60s 超时 | 给 `config.toolCallTimeoutMs` 调大 |
