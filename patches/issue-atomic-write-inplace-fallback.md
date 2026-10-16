# Issue draft: `writeFileAtomic` loses settings silently when Windows refuses the rename replacement

> 中文摘要：Windows 上只要还有别的程序（本例是编辑器里的一个 ACP agent 会话）握着
> `~/.dsh/profiles/<profile>/cordis.patch.yml`，DSH 的每一次设置写入都会失败并静默回滚 ——
> 而实测表明**内容本身一直写得进去，被拒的只有「改名替换」这一步**。
> `@deepseek-ai/dsh-atomic-write` 现有的有限重试等不过一个整场会话都不松手的句柄，
> 重试耗尽即抛错。建议在抛错前增加一层「备份 + 原地覆写」兜底（本机已按此打补丁验证）。
> 更深的根因仍是「用户设置文档」与「交给外部编辑器打开的配置文件」是同一份。

**Package**: `@deepseek-ai/dsh-atomic-write` (`packages/util/atomic-write`, v0.2.0-rc.2)
**Callers observed**: `@deepseek-ai/dsh-config-editor` (`lib/index.js` → `writeFileAtomic`, used for the profile settings document)
**Platform**: Windows 11, Node 24.10.0
**Observed in**: DeepSeek Harness 0.2.0-rc.2, `dsh web`, web profile

## Summary

The profile settings document is also the file the settings panel hands to an external
editor ("open configuration file"). When an editor (or an agent session inside it) keeps a
handle on that file for a whole session, `writeFileAtomic` can never commit: the temp file
is written fine, the rename-replacement is refused, the bounded Windows retries
(`EACCES`/`EBUSY`/`EPERM`, 8 attempts, ~1.3 s) exhaust, and the error is rethrown. Every
settings write in that profile then fails — and the UI shows a successful-looking
optimistic update that silently reverts.

The important measurement is that **writing the target is still permitted**; only the
replacement is refused:

| Operation on the held `cordis.patch.yml` | Result |
|---|---|
| exclusive open (`FileShare.None`) | refused |
| open for read / write / delete | allowed |
| `MoveFileEx(REPLACE_EXISTING)` (what the commit does) | **Win32 5 ACCESS_DENIED**, 0/15 over a 45 s sample |
| `MoveFileEx` to a fresh name in the same directory (control) | OK |
| **rewriting the same file in place** | **OK** |

Holder, by Windows Restart Manager reverse lookup: the editor's main process
(`app="Zed"`), not the agent CLI it spawned. The editor's log is what names the trigger:

```
ERROR [crates/acp_thread/src/acp_thread.rs:1716] opening file "C:\Users\<user>\.dsh\profiles\desktop"
```

## Reproduction

1. Open `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml` in an external editor and leave
   the handle open (an editor agent session whose context contains `~/.dsh` also does it).
2. In `dsh web` → Settings → change any preference (the built-in appearance row is enough).
3. Expected: saved and retained after reload. Actual: the row moves, then the host pushes
   the durable value back; `settings/describe` still reports `revision 0`, `user {}`.

RPC layer (HTTP is 200 — the failure is inside the envelope):

```
settings/rejected: EPERM: operation not permitted, rename
'...\profiles\web\cordis.patch.yml.<hex>.tmp' -> '...\profiles\web\cordis.patch.yml'
```

## Why the current retry loop cannot recover

A bounded retry is the right answer for transient interference (indexer, AV, a writer that
lets go). It cannot help against a handle that stays open for the lifetime of an editor
session: the retry budget is spent in ~1.3 s, and the next write starts over from zero.

## API note that changes the shape of the fix

Measured on the same held document (four controlled arms, all reproduced in a lab):

| Holder | exclusive open | write open | DELETE open | `MoveFileEx(REPLACE_EXISTING)` |
|---|---|---|---|---|
| live case (editor) | refused (32) | allowed | allowed | **fails, Win32 5** |
| mapped view only (file handle closed) | free | allowed | allowed | succeeds |
| mapped view + file handle | refused (32) | allowed | allowed | fails, Win32 5 |
| plain handle, share=READ\|WRITE\|DELETE | refused (32) | allowed | allowed | **fails, Win32 5** |
| plain handle, share without DELETE | refused (32) | allowed | refused (32) | fails, Win32 5 |

So the live holder is an ordinary file handle, and `MoveFileEx(REPLACE_EXISTING)` refuses the
replacement **even though the holder shares `FILE_SHARE_DELETE`** — Node's `fs.rename` maps to
exactly that call, which is why the commit step has no way out today. `ReplaceFileW`, the API
Windows provides for replacing a file another process has open, **succeeded on the same held
document**, and so does freeing the name first (`DeleteFile` then `MoveFile`).

That means a native commit path could keep the atomic replacement instead of degrading to the
in-place fallback proposed above. A JS-only module cannot reach `ReplaceFileW`, so the fallback
below remains the practical answer for this package; if a native binding is acceptable, prefer
routing the commit through `ReplaceFileW` and keep the fallback only for holders that do not
share delete (then `DeleteFile` fails too).

## Proposal

1. **Keep the content even when the replacement is refused.** After the retries are
   exhausted — and only for the Windows replacement refusals already listed — fall back to:
   write `<file>.bak` with the previous bytes, then open the target `r+`, write at offset 0,
   `truncate` to the new length, `fsync`, and `chmod` to the caller's `mode`. Return success.
   Any step failing must rethrow the original error, so today's behaviour is unchanged where
   the file is genuinely unwritable (ACL, read-only, no directory entry).
2. **Announce the degradation.** `process.emitWarning(..., { code: 'DSH_ATOMIC_WRITE_INPLACE_FALLBACK' })`
   once per replace, naming the file: the one thing this package otherwise guarantees is the
   atomicity readers see, and that is exactly what this fallback gives up. Provide an opt-out
   via an environment variable for operators who prefer the hard failure.
3. **Fix the silent failure at the settings layer.** `settings/mutate` returning HTTP 200 with
   an error envelope, and the client optimistically applying a value it cannot persist, is why
   users read this as "the settings panel is broken" instead of "another program holds the file".
4. **Root cause, longer term.** The user settings document and the file handed to external
   editors should not be the same file (or opening it externally should be accompanied by a
   hold check). Everything above only makes the failure survivable.

A local patch implementing (1) and (2) is in `dsh-local-plugins/patches/`
(`apply-dsh-atomic-write-fallback.mjs`); it is 17/17 verified against a held document on this
machine (content preserved byte-for-byte, `.bak` written, warning emitted, and the free-file
path still using the rename with no `.bak`).

## Evidence already collected locally

Full Chinese analysis, including the Restart Manager reverse-lookup and replacement-sampling
scripts, the editor's orphan editor/`items` rows, and the non-fixes ("close the tab",
"restart the editor", "kill the agent CLI") — see `dsh-local-plugins/docs/dsh-settings-document-lock.md`
and `dsh-local-plugins/docs/dsh-web-settings-write-runbook.md`.
