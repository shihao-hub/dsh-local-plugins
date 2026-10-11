# @local/startup-maximize

启动后自动最大化 DeepSeek Harness 桌面窗口。

## 背景

桌面壳（Electron 主进程）创建主窗口时使用固定尺寸 `1280×820`，既没有
`maximize: true`，也没有窗口状态持久化；同时 Host Service 与沙箱化的
renderer preload 都没有暴露任何窗口控制 API。因此本插件从进程树外部
解决：Host 运行时是 Electron 主进程的直接子进程（`process.ppid` 即主进程），
可以在 profile 组合启动时发射一个分离的 PowerShell 助手去最大化它。

## 工作方式

1. **宿主半区 `index.js`**：profile 组合加载时执行 `apply()`，校验
   `ELECTRON_RUN_AS_NODE=1` 且 `process.ppid > 0`，把 `helper.ps1` 复制到
   `%TEMP%\dsh-startup-maximize-helper.ps1`，以 detached + hidden 方式启动
   后立即返回，绝不阻塞或拖垮 Host 启动。
2. **`helper.ps1`**：
   - WMI 校验父进程可执行名必须是 `DeepSeek Harness.exe`（开发态允许
     `electron.exe`）——在终端里独立运行的 Host（父进程是 shell/终端）会被
     直接拒绝，绝不会误最大化终端窗口；
   - 轮询（默认最长 30s，250ms 间隔）等待主窗口出现（壳要等 Web 客户端
     引导完才 `show()`）；
   - 在同 PID 的可见顶层窗口中取面积最大者（即 1280×820 主窗口，天然排除
     tooltip / 隐藏辅助窗口 / 更小的欢迎窗）；
   - 已最大化则直接退出（幂等）；否则 `ShowWindow(SW_MAXIMIZE)`，2s 内确认
     `IsZoomed`，成功后再延时 2s 复核一次，被还原则补一次最大化；
   - 结果写入 `%TEMP%\dsh-startup-maximize.log`（超过 64KB 自动清空）。

## 效果范围

- 仅在 Host 启动（= 应用启动）时执行一次；会话中途用户手动还原窗口不会
  被再次最大化。
- 仅 Windows；其他平台为空操作。
- 不重启、不改系统设置、不触碰任何其他进程的窗口。

## 排障

查看 `%TEMP%\dsh-startup-maximize.log`：

| 日志 | 含义 |
| :-- | :-- |
| `window already maximized` | 窗口本已最大化，正常 |
| `maximized hwnd=…` | 成功最大化 |
| `re-asserted hwnd=…` | 最大化后被还原过，已补齐 |
| `parent is not the desktop shell (…) ` | 宿主不在桌面壳下，已安全跳过 |
| `no window found for pid …` | 超时未等到窗口（可用 `-WaitSec` 加大） |
