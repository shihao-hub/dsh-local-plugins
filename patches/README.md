# patches —— 给已安装的 DSH 打的一处兜底补丁

只做一件事：让**设置能存进去，即使此刻有别的程序（Zed）握着设置文档的句柄**。

## 为什么（都是实测数据，不是推断）

现象：`dsh web` 里改设置点了没反应、刷新还原、点「深色」自己跳回「系统」。RPC 层原文是
`settings/rejected: EPERM ... rename '...cordis.patch.yml.<hex>.tmp' -> '...cordis.patch.yml'`。

对 `~/.dsh/profiles/{web,desktop}/cordis.patch.yml` 实测（持有者：Zed 主进程）：

| 操作 | 结果 |
|---|---|
| 独占打开 | 拒绝 |
| 以 read / write / delete 权限打开 | 都允许 |
| `MoveFileEx(REPLACE_EXISTING)`（等价于 DSH 保存的最后一步） | **Win32 5 Access denied**，45 秒采样 0/15 |
| 同目录 rename 到一个新名字（对照） | OK |
| **原地覆写同一文件** | **OK** |

结论：**被禁的不是「写」，只是「改名替换」**。所以不需要关 Zed、不需要删会话，也能把设置存住。

DSH 的写入只有一个咽喉：`@deepseek-ai/dsh-atomic-write` 的 `writeFileAtomic`（由
`dsh-config-editor` 的配置保存调用）。上游已经会对 Windows 瞬时干扰
（`EACCES/EBUSY/EPERM`，20→200ms 共 8 次 ≈ 1.3s）做有限重试，但重试耗尽就抛错——对一个整场
会话都不松手的句柄，重试永远等不到。补丁就是在「重试耗尽」之后再补一步。

## 补了什么

在 `dsh-atomic-write/lib/index.js` 末尾追加一段打了 `dsh-local-patch` 标记的代码，并把原来的
`export { withFileLock, writeFileAtomic }` 换成导出包装函数：

```text
writeFileAtomic → 上游原逻辑
                  失败且是 Windows 的 EACCES/EBUSY/EPERM（重试已耗尽）
                  → 先写 <文件>.bak 备份原文
                  → 打开目标 r+、原地写入、truncate、fsync、按上游约定 chmod
                  → 成功即返回；任一步失败则抛出原来的错误（保持原行为）
```

## 代价（必须知道）

- **这一次替换不再原子**：写入过程中读方可能读到半份文件。窗口是几 KB 的写入时间；有
  `<文件>.bak` 兜底，且该文件是 YAML 设置文档，不是数据库。
- 只在 Windows 生效；非 Windows 完全不动。
- 每次退化都会 `process.emitWarning`（code `DSH_ATOMIC_WRITE_INPLACE_FALLBACK`），日志里看得见。
- 想彻底关掉兜底：设环境变量 `DSH_ATOMIC_WRITE_NO_INPLACE_FALLBACK=1` 后再启动 `dsh`。
- 这是**改全局安装包**：`npm i -g` 升级 DSH 后补丁消失，需重跑一次重打脚本。

## 用法

```powershell
cd D:\Users\dsh-local-plugins

# 看状态（不改文件）
node patches\apply-dsh-atomic-write-fallback.mjs --check

# 打补丁（幂等；上游结构变了会拒绝下手并说明原因）
node patches\apply-dsh-atomic-write-fallback.mjs

# 回退到备份的上游原文
node patches\apply-dsh-atomic-write-fallback.mjs --revert
```

默认自己找安装位置（`npm root -g`、PATH 里的 `dsh`）。找不到时显式指定：

```powershell
node patches\apply-dsh-atomic-write-fallback.mjs --dsh-root "D:\Users\29580\AppData\Local\nvm\v24.10.0\node_modules\@deepseek-ai\dsh"
```

**生效时机**：补丁改的是磁盘上的模块，当前正在跑的 `dsh web` 已经把旧模块读进内存了，
**下次启动 `dsh` 才生效**。重启后即可在 Zed 开着的情况下保存设置。

## 验证（缺一不可）

```text
[ ] node patches\apply-dsh-atomic-write-fallback.mjs --check   → 已打补丁
[ ] 独立进程 import 该模块成功（语法与导出都正常）
[ ] 无人占用的文件：仍走 rename 路径，且不产生 .bak
[ ] 被 Zed 占用的两份 cordis.patch.yml：writeFileAtomic 成功（退化路径），内容不变、出现 .bak
[ ] 重启 dsh 后，设置面板改「深色」，刷新保持
```

## 上游

这类问题应该由上游解决，补丁只是让本机先能用。issue 草稿：
[issue-atomic-write-inplace-fallback.md](./issue-atomic-write-inplace-fallback.md)。
更深的根因（用户设置和「交给外部编辑器打开的配置文件」是同一份）见
[../docs/dsh-settings-document-lock.md](../docs/dsh-settings-document-lock.md)。
