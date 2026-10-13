# @local/window-memory

记住 DeepSeek Harness 桌面主窗口的大小和位置，下次启动自动恢复。

## 背景

桌面壳（Electron 主进程）每次都按固定 `1280×820` 创建主窗口，没有窗口
状态持久化；同时 Host Service 与沙箱化的 renderer preload 都没有暴露任何
窗口控制 API。因此本插件从进程树外部解决：Host 运行时是 Electron 主进程
的直接子进程（`process.ppid` 即主进程），在 profile 组合启动时发射一个
隐藏的 helper 来完成「恢复 + 持续记忆」。

## 工作方式

1. **宿主半区 `index.js`**：profile 组合加载时执行 `apply()`，校验
   `ELECTRON_RUN_AS_NODE=1` 且 `process.ppid > 0`，然后用 `ensureHelper()`
   取到已编译的 helper 并启动，立即返回，绝不阻塞或拖垮 Host 启动。
   状态文件位于 `%LOCALAPPDATA%\dsh-window-memory\window-state.json`。
2. **`helper.cs`（原生小程序）**：
   - 用 `Process.MainModule` 校验父进程可执行名必须是 `DeepSeek Harness.exe`
     （开发态允许 `electron.exe`）——在终端里独立运行的 Host 绝不会被触碰；
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

## 为什么是原生程序而不是 PowerShell

helper 原先是一个常驻的 `powershell.exe`。代价实测如下（同一台机器）：

| 形态 | 工作集 | conhost | CPU |
| :-- | :-- | :-- | :-- |
| 旧：常驻 PowerShell + `Add-Type` | 106.0 MB（私有 81.4 MB） | +8.3 MB | **4.05%** 单核（28 分钟累计 91.8s） |
| 现：原生 helper.exe | **19.7 MB**（私有 12.5 MB） | 无 | **≈0%**（8 秒采样测不出） |

差额的来源不是"要不要常驻"，而是"用什么运行时去常驻"：裸
`powershell.exe -NoProfile` 空跑就有 76.6 MB 工作集，叠上 CIM 与 `Add-Type`
到 106 MB；而它每 250ms 一次的轮询里，每次 `New-Object` / `Get-Process` 这类
cmdlet 与反射调用约 10ms，与窗口有没有变过无关。原生实现每次 tick 只剩几次
P/Invoke，父进程存活检测也改成缓存同步句柄（`OpenProcess` + 
`WaitForSingleObject`）而不是每 tick 新建 `Process` 对象。

## 编译与缓存

`helper.exe` 不存在或与 `helper.cs` 的 SHA-256 不符时，`index.js` 会用
`.NET Framework` 自带的 `csc.exe`（`Framework64\v4.0.30319`，缺失则退
`Framework`）编译一次并缓存：

- 产物：`%LOCALAPPDATA%\dsh-window-memory\helper.exe`（约 18 KB）
- 指纹：`%LOCALAPPDATA%\dsh-window-memory\helper.sha256`
- 关键编译开关：`/target:winexe` —— GUI 子系统不分配控制台。用
  `/target:exe` 时 Node 的 `windowsHide` 只做 `SW_HIDE`，控制台仍会被
  分配，于是多出一个约 8 MB 的 `conhost.exe` 子进程。
- 强制重建：`DSH_WINDOW_MEMORY_REBUILD=1`
- 编译失败只记 `helper compile failed: …; window memory disabled` 并放行
  Host 启动（窗口几何是化妆品，任何失败都不得影响启动）。

源码约束：该 csc 只支持 **C# 5**，`helper.cs` 里不能出现字符串插值、
表达式体成员、`?.`、`nameof`、自动属性初始化器。

**刻意不加 DPI awareness manifest，也不调用 `SetProcessDpiAwareness`**：
旧 PowerShell 宿主同样不是 DPI-aware，Windows 因此对它虚拟化坐标
（本机 2560×1600 @125%，进程视角是 2048×1280）。一旦变成 DPI-aware，
同一个 `x/y` 会被解释到另一个坐标空间，恢复位置在缩放屏上会明显错位。

## 效果范围

- 仅在 Host 启动（= 应用启动）时恢复一次；会话中途的实时重载不会把旧
  几何重新套到正在使用的窗口上。
- 记忆随会话实时更新：关掉应用前的最终大小/位置就是下次启动恢复的值。
- 仅 Windows；其他平台为空操作。
- 不重启、不改系统设置、不触碰任何其他进程的窗口。

## 测试

零依赖、`node` 直跑（与仓库其他插件一致）：

```powershell
node window-memory/test/self-test.mjs     # 纯逻辑自检：屏幕外守卫、坏值拒绝、状态文件字节格式
node window-memory/test/window-test.mjs   # 真窗口回归：恢复/写回/坏值/屏幕外/最大化/窗口销毁
```

`window-test.mjs` 会用 `test/test-window.cs` 编译一个夹具窗口，而不是拿
记事本之类的系统程序当靶子——Windows 11 上 `notepad.exe` 只是壳，真正持有
窗口的是商店包进程，会让测试变成对系统版本的隐式依赖。夹具把自身真实几何
打到 stdout，断言因此看的是"窗口真的在哪"，而不是 helper 自己声称做了什么。

## 排障

查看 `%TEMP%\dsh-window-memory.log` 与
`%LOCALAPPDATA%\dsh-window-memory\window-state.json`：

| 日志 | 含义 |
| :-- | :-- |
| `helper compiled: …` | 首次（或源码变更后）编译并缓存成功 |
| `helper compile failed: …` | 编译失败，窗口记忆停用，Host 启动不受影响 |
| `restored: WxH @(x,y) (actual …)` | 已按保存值恢复窗口几何，括号内为回读结果 |
| `restored: maximized` | 上次是最大化，本次直接最大化 |
| `no saved state` | 首次运行，无记忆可用 |
| `saved: …` | 会话中捕获到新几何并已写盘 |
| `state save skipped: off-screen …` | 捕获到隐藏/屏幕外的过渡帧几何，已跳过，保留上次有效记忆 |
| `saved state rejected: … deleted` | 上次记忆是坏值（隐藏停靠位），已拒绝并删除，本次用默认几何 |
| `parent is not the desktop shell (…)` | 宿主不在桌面壳下，已安全跳过 |
| `no window found for pid …` | 超时未等到窗口（如主窗口当时处于最小化/停靠态） |
| `window destroyed; watcher exits` | 窗口关闭，watcher 正常退出 |
| `skip: host already running …` | 实时重载触发，按设计不重新套用旧几何 |

## 与 @local/startup-maximize 的关系

`startup-maximize` 已于 2026-10-11 注销并移入 `.archived/`；两者当年互斥
（「最大化」与「恢复记忆」会互相覆盖）。若将来恢复该插件，需重新确认互斥。
