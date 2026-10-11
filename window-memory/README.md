# @local/window-memory

记住 DeepSeek Harness 桌面主窗口的大小和位置，下次启动自动恢复。

## 背景

桌面壳（Electron 主进程）每次都按固定 `1280×820` 创建主窗口，没有窗口
状态持久化；同时 Host Service 与沙箱化的 renderer preload 都没有暴露任何
窗口控制 API。因此本插件从进程树外部解决：Host 运行时是 Electron 主进程
的直接子进程（`process.ppid` 即主进程），在 profile 组合启动时发射一个
隐藏的 PowerShell 助手来完成「恢复 + 持续记忆」。

## 工作方式

1. **宿主半区 `index.js`**：profile 组合加载时执行 `apply()`，校验
   `ELECTRON_RUN_AS_NODE=1` 且 `process.ppid > 0`，把 `helper.ps1` 复制到
   `%TEMP%` 并以 hidden 方式启动，立即返回，绝不阻塞或拖垮 Host 启动。
   状态文件位于 `%LOCALAPPDATA%\dsh-window-memory\window-state.json`。
2. **`helper.ps1`**：
   - WMI 校验父进程可执行名必须是 `DeepSeek Harness.exe`（开发态允许
     `electron.exe`）——在终端里独立运行的 Host 绝不会被触碰；
   - **恢复阶段**：轮询等待新主窗口出现，然后套用上一个会话保存的
     大小与位置（`SetWindowPos`，仅改几何，不改 Z 序、不抢焦点）；若上个
     会话结束时是最大化，则直接 `SW_MAXIMIZE`；
   - **监视阶段**：此后持续轮询直到窗口销毁，任何用户拖拽产生的大小/
     位置变化都经 1s 去抖后写回状态文件（临时文件 + 原子替换）。最大化
     /最小化不记录坐标，只记录 `zoomed` 标志，避免把最大化时的显示器
     矩形误存为普通几何；窗口隐藏（收进后台）与屏幕外/退化矩形不写入，
     防止把 Chromium 给隐藏窗口的停靠位 `(-25600,-25600)` 记成用户
     几何（否则下次启动会把主窗口恢复到屏幕外——表现为"启动无窗口"）；
     历史坏值在恢复阶段会被识别并删除；
   - 结果写入 `%TEMP%\dsh-window-memory.log`（超过 64KB 自动清空）。

## 效果范围

- 仅在 Host 启动（= 应用启动）时恢复一次；会话中途的实时重载不会把旧
  几何重新套到正在使用的窗口上。
- 记忆随会话实时更新：关掉应用前的最终大小/位置就是下次启动恢复的值。
- 仅 Windows；其他平台为空操作。
- 不重启、不改系统设置、不触碰任何其他进程的窗口。

## 排障

查看 `%TEMP%\dsh-window-memory.log` 与
`%LOCALAPPDATA%\dsh-window-memory\window-state.json`：

| 日志 | 含义 |
| :-- | :-- |
| `restored: WxH @(x,y)` | 已按保存值恢复窗口几何 |
| `restored: maximized` | 上次是最大化，本次直接最大化 |
| `no saved state` | 首次运行，无记忆可用 |
| `saved: …` | 会话中捕获到新几何并已写盘 |
| `state save skipped: off-screen …` | 捕获到隐藏/屏幕外的过渡帧几何，已跳过，保留上次有效记忆 |
| `saved state rejected: … deleted` | 上次记忆是坏值（隐藏停靠位），已拒绝并删除，本次用默认几何 |
| `parent is not the desktop shell (…)` | 宿主不在桌面壳下，已安全跳过 |
| `no window found for pid …` | 超时未等到窗口（可用 `-WaitSec` 加大） |

## 与 @local/startup-maximize 的关系

互斥使用：两者都启动时，「最大化」与「恢复记忆」会互相覆盖。使用本插件
记忆窗口时请保持 startup-maximize 关闭。
