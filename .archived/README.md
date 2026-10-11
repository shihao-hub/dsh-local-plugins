# 已归档插件（不再注册）

> 归档日期：2026-10-11
> 归档动作：从 desktop profile（`~/.dsh/profiles/desktop`）注销后，源码整体迁入本目录，git 历史完整保留（`git log --follow` 可追溯）。

本目录下的插件**不再被任何 profile 加载**，仅作为历史源码留存。当前运行中的插件仍在上层目录，其注册真源是 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 与 `dsh.profile.bundles`。

## 归档清单

| 目录 | 原包名 (`id`) | 职责 | 注销时状态 |
| :--- | :--- | :--- | :--- |
| [`startup-maximize`](./startup-maximize) | `@local/startup-maximize` | 桌面应用启动后自动最大化主窗口（Win32 层触发，仅桌面壳生效）。 | 已从 profile 依赖与 `node_modules` 链接中移除 |
| [`thoughtdag-companion`](./thoughtdag-companion) | `@local/thoughtdag-companion` | ThoughtDAG 伴生模组：隐匿悬浮胶囊，把画布纳管为会话头部「思维图」tab。 | 同上；其宿主插件 `dsh-thoughtdag` 也一并注销 |
| [`traj-translate`](./traj-translate) | `@local/traj-translate-v4` | 轨迹检查器「AI 翻译」标签，为思考过程与原始内容提供 1:1 中文翻译面板。 | 同上（含陈旧的 `@local/traj-translate` 链接一并清理） |

同时注销的第三方包：`dsh-thoughtdag`（npm `^0.5.15`）。它不是本仓库源码，故未归档；需要时可在侧栏「插件」页 **添加插件** 中输入 `dsh-thoughtdag` 重新安装。

## 恢复某个插件

1. 迁回原位：`git mv .archived/<目录名> <目录名>`（例如 `.archived/startup-maximize startup-maximize`）。
2. 在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 中补回 `"<包名>": "link:D:/Users/dsh-local-plugins/<目录名>"`。
3. 重启 DSH 桌面应用，或在侧栏「插件」页找到对应组合包并**开启**（开启会把包名追加进 `dsh.profile.bundles`）。
4. 若恢复的是 `thoughtdag-companion`，需先安装并启用 `dsh-thoughtdag`。

## 备注

- desktop profile 的包管理由 Electron 应用负责，`dsh plugin --profile desktop` 会被拒绝（`profile "desktop" is managed exclusively by the Electron application`），因此本目录的注销是直接编辑 profile 文件 + 清理 `node_modules` 链接完成的。
- profile 的 `pnpm-lock.yaml` 在本轮未刷新：该文件在此次改动前已缺少多个既有依赖条目，下次 Electron 侧的包操作会自动收敛。
