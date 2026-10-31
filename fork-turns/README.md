# `@local/fork-turns` — 分叉选中轮次

DSH 内置的「分叉会话」只能复制**一段连续的历史前缀**（默认最近一个已完成轮次之前全部）。本插件补的是另一半：在**当前会话**里勾选任意几个已完成轮次，生成一个只包含这些轮次的新会话。

## 用法

**唯一入口：会话列表任意一行的「…」菜单 →「分叉选中轮次」**（空白会话没有轮次，不显示该项；不必先打开该会话）。

面板列出该会话的所有轮次：轮次号、用户消息摘要、助手回复摘要、时间、工具调用数。勾选若干轮次（进行中的轮次置灰不可选），点「创建分支」。

新会话自动创建并打开，标题形如 `原标题 · 分叉 N 个轮次`；侧栏正常工作区组里。

新会话里是**原生会话历史**，不是转录文本：用户消息、助手回复、工具调用与结果都按原样继承，模型可以直接接着聊。

## 语义与边界

| 事项 | 行为 |
| --- | --- |
| 轮次范围 | 只接受**已闭合**的轮次（有 `turn/end`）；进行中的轮次 UI 置灰，Host 也会拒绝。 |
| 轮次编号 | 保留源会话里的原编号（只选第 3、5 轮时，新会话时间线显示 #3、#5），便于对照。 |
| 事件保真 | 只复制 `turn/*`、`step/*`、`user/message`、`assistant/message`、`tool/call`、`tool/result`；`system/message`、`developer/message`、`request/*`、`assistant/attempt`、`compaction/*` 与第三方插件记录一律丢弃（新会话首次请求会重新生成系统提示与请求头）。 |
| 压缩历史 | 若源会话发生过压缩，被选中轮次的原文会以 append 方式重新可见（不再被旧的 replace 隐藏）。 |
| 模型 / 预设 | 继承源会话的 Agent 预设与当前默认模型；权限预设等「会话级设置事件」不随轮次复制，新会话用部署默认值。 |
| 血缘 | 新会话的 header 记录 `parentSession`（`isSeeded` 保持 false，因为它不是连续前缀 fork），内置的会话谱系功能可识别来源。 |
| 工作区 | 自动挂到源会话所属工作区；源会话不在任何工作区时仍会创建，但返回 warning。 |
| 范围 | 一次只处理一个会话，不支持跨会话拼轮次。 |

## 实现

Host 半边（`index.js`）注册三条同源路由，Client 半边（`client.js`）只负责 UI：

| 路由 | 作用 |
| --- | --- |
| `GET /plugins/fork-turns/turns?sessionId=` | 轮次列表（供浮层渲染） |
| `POST /plugins/fork-turns/preview` | 只构造 seed 并交给 `ctx.sessions.prepare` 做一次真实校验，不创建任何东西（调试用） |
| `POST /plugins/fork-turns/fork` | 构造 seed → `ctx.agents.create` → 挂工作区 → 命名 |

seed 构造在 `turns.js`（纯函数、零依赖）：

- 按 `turn/start` … `turn/end` 切出整轮；
- 过滤事件类型（见上表）；
- **seq 重排为 0..n-1**（`Session` 构造要求连续）；
- surface 事件的 `surfaceOp` 统一改写为 `append`，`tool/result.sourceEventSeqs` 按映射重写、映射不到就删除；
- 至少保留一条 `user/message`，否则拒绝。

路由安全沿用仓库里 `session-tag-lite` 的模式：必须带 `x-fork-turns: 1` 请求头；浏览器带 `Origin` 时必须同源；请求体上限 64 KB；方法白名单。

`inject` 只声明 `webServer`（硬依赖）。`sessionQuery` / `agents` / `agentDefaultModel` / `agentPresets` / `workspaceRegistry` / `sessionTitle` 全部通过 `ctx.get()` 可选获取，缺能力时路由返回 `501 capability-missing`，插件本身照常加载。

## 测试

```powershell
cd D:\Users\dsh-local-plugins\fork-turns
node self-test.mjs          # 22 项纯函数用例
node --check index.js
node --check client.js
```

真实会话的校验走 `preview`：

```powershell
$body = @{ sessionId='session-xxx'; turns=@(1,3,5) } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:11111/plugins/fork-turns/preview' -Method Post `
  -Headers @{ 'x-fork-turns'='1'; 'content-type'='application/json' } -Body $body
```

`validated: true` 表示新 seed 能通过 `Session` 的完整构造校验。

## 已知限制

- 只支持 Web 部署（路由依赖 `webServer`）；无 Web 半区的纯桌面/无头部署不激活。
- 修改 `index.js` 后需要 `plugin_manager set_plugin` 停用/启用一次（或重启 `dsh web`）才会加载新模块；`client.js` 改动刷新页面即可。
- 会话被压缩得很厉害时，选中轮次的原文会重新进入上下文，token 占用随之上升——这正是「我要这几轮」的代价。
- 源轮次的结束原因原样保留：曾被中断/崩溃的轮次在新会话里仍显示「任务已停止」横幅，这是历史事实，不伪造。
