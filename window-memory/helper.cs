// dsh-window-memory helper（原生半区）。
//
// 本文件是已退役的 helper.ps1 的 1:1 语义移植：同样从进程树外部记住并恢复
// DeepSeek Harness 桌面主窗口的几何。改用原生程序的原因只有成本——
// Windows PowerShell 空跑就是 76.6MB 工作集，叠上 CIM 与 Add-Type 达 106MB，
// 且每 250ms 一次的 cmdlet/反射调用约 10ms（实测稳定占约 4~5% 单核）；
// 同样的常驻逻辑在这里只要几 MB，且每次 tick 只剩几微秒的 P/Invoke。
//
// 编译约束：本机用 .NET Framework 4.0.30319 自带的 csc.exe 编译，
// 该编译器只支持 C# 5 —— 禁止字符串插值、表达式体成员、空条件运算符 ?. 、
// nameof、自动属性初始化器。改动本文件后必须能通过该 csc 编译。
//
// 行为契约（与旧 PowerShell 版逐条对齐，勿轻改）：
//   相位 1（恢复）：读上次会话状态，等新主窗口出现，套用保存的大小/位置
//     （上次是最大化则直接 SW_MAXIMIZE）；仅改几何，不改 Z 序、不抢焦点。
//   相位 2（监视）：持续轮询直到窗口销毁或宿主退出，用户产生的每次大小/
//     位置变化经 1s 去抖后原子写回。最大化/最小化只记 zoomed 标志，不记
//     原始坐标——否则会把最大化时的显示器矩形误存成普通几何。隐藏窗口
//     （收进后台）与屏幕外/退化矩形一律不写：Chromium 会把隐藏窗口停靠到
//     (-25600,-25600)，一旦落盘，下次启动就会把主窗口恢复到屏幕外，表现
//     为"启动没有窗口"。恢复阶段识别到这种历史坏值则删除而非套用。
//
// 刻意不做的事：不调用 SetProcessDpiAwareness、也不带任何 DPI manifest。
// 旧 PowerShell 宿主同样不是 DPI-aware，Windows 因此对它虚拟化坐标
// （本机 2560×1600 @125% 在进程视角是 2048×1280）；一旦变成 DPI-aware，
// 同一个 x/y 会被解释到另一个坐标空间，恢复位置在缩放屏上会明显错位。
//
// 绝不触碰其他进程的窗口；任何失败都只写日志，不影响宿主启动。

using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public static class DshWindowMemory
{
	// ---------------- Win32 ----------------

	private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

	[DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
	[DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
	[DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
	[DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr hWnd);
	[DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int cmd);
	[DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
	[DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
	[DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int pid);
	[DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
	[DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

	private const uint PROCESS_SYNCHRONIZE = 0x00100000;
	private const uint WAIT_OBJECT_0 = 0;

	private const uint SWP_NOZORDER = 0x0004;
	private const uint SWP_NOACTIVATE = 0x0010;
	private const int SW_MAXIMIZE = 3;

	// SM_XVIRTUALSCREEN(76) / SM_YVIRTUALSCREEN(77) / SM_CXVIRTUALSCREEN(78) / SM_CYVIRTUALSCREEN(79)
	private const int SM_XVIRTUALSCREEN = 76;
	private const int SM_YVIRTUALSCREEN = 77;
	private const int SM_CXVIRTUALSCREEN = 78;
	private const int SM_CYVIRTUALSCREEN = 79;

	private const int MIN_W = 120;
	private const int MIN_H = 80;
	private const int MIN_OVERLAP_X = 120;
	private const int MIN_OVERLAP_Y = 40;

	[StructLayout(LayoutKind.Sequential)]
	internal struct RECT { public int Left, Top, Right, Bottom; }

	private const string DEFAULT_PARENT_PATTERN = @"^(?:DeepSeek Harness|electron)\.exe$";
	private const string DEFAULT_LOG_NAME = "dsh-window-memory.log";
	private const long LOG_MAX_BYTES = 65536;
	private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);
	private static readonly UTF8Encoding Utf8Bom = new UTF8Encoding(true);

	// ---------------- 会话参数 ----------------

	private sealed class Options
	{
		public int MainPid;
		public string StateFile;
		public int WaitSec = 180;
		public int PollMs = 250;
		public int SaveDebounceMs = 1000;
		/** 测试专用：替换父进程可执行名判据；生产路径必须留空。 */
		public string AllowExeName;
		/** 测试/排障专用：覆盖日志路径。 */
		public string LogFile;
		public bool SelfTest;

		public static Options Parse(string[] args)
		{
			Options o = new Options();
			for (int i = 0; i < args.Length; i++)
			{
				string a = args[i].ToLowerInvariant();
				string v = (i + 1 < args.Length) ? args[i + 1] : null;
				switch (a)
				{
					case "-mainpid":
						if (v == null) return null;
						o.MainPid = int.Parse(v, CultureInfo.InvariantCulture);
						i++;
						break;
					case "-statefile":
						if (v == null) return null;
						o.StateFile = v;
						i++;
						break;
					case "-waitsec":
						if (v == null) return null;
						o.WaitSec = int.Parse(v, CultureInfo.InvariantCulture);
						i++;
						break;
					case "-pollms":
						if (v == null) return null;
						o.PollMs = int.Parse(v, CultureInfo.InvariantCulture);
						i++;
						break;
					case "-savedebouncems":
						if (v == null) return null;
						o.SaveDebounceMs = int.Parse(v, CultureInfo.InvariantCulture);
						i++;
						break;
					case "-allowexename":
						if (v == null) return null;
						o.AllowExeName = v;
						i++;
						break;
					case "-logfile":
						if (v == null) return null;
						o.LogFile = v;
						i++;
						break;
					case "-selftest":
						o.SelfTest = true;
						break;
					default:
						break; // 未知参数忽略：宿主侧只传已知项
				}
			}
			return o;
		}
	}

	// ---------------- 日志 ----------------

	internal static string logFile;

	internal static void Log(string message)
	{
		try
		{
			string line = DateTimeOffset.Now.ToString("o", CultureInfo.InvariantCulture) + " " + message;
			if (File.Exists(logFile) && new FileInfo(logFile).Length > LOG_MAX_BYTES) File.WriteAllText(logFile, string.Empty, Utf8NoBom);
			File.AppendAllText(logFile, line + "\r\n", Utf8NoBom);
		}
		catch
		{
			// 只做诊断，绝不因日志失败影响主流程
		}
	}

	// ---------------- 窗口查找与几何判据 ----------------

	private static IntPtr FindLargestWindow(uint pid, string titleSubstring)
	{
		IntPtr best = IntPtr.Zero;
		long bestArea = 0;
		EnumProc cb = delegate(IntPtr h, IntPtr lp)
		{
			uint wpid;
			GetWindowThreadProcessId(h, out wpid);
			bool pidOk = (pid == 0) || (wpid == pid);
			if (pidOk && IsWindowVisible(h) && !IsIconic(h))
			{
				if (!string.IsNullOrEmpty(titleSubstring))
				{
					StringBuilder sb = new StringBuilder(512);
					GetWindowText(h, sb, 512);
					if (sb.ToString().IndexOf(titleSubstring, StringComparison.OrdinalIgnoreCase) < 0) return true;
				}
				RECT r;
				GetWindowRect(h, out r);
				long area = (long)(r.Right - r.Left) * (long)(r.Bottom - r.Top);
				if (area > bestArea) { bestArea = area; best = h; }
			}
			return true;
		};
		EnumWindows(cb, IntPtr.Zero);
		GC.KeepAlive(cb);
		return best;
	}

	/** 几何是否合理：尺寸达标，且与所有显示器包围盒有足够交集（挡掉隐藏停靠位）。 */
	internal static bool IsSaneRect(int x, int y, int w, int h)
	{
		if (w < MIN_W || h < MIN_H) return false;
		int vx = GetSystemMetrics(SM_XVIRTUALSCREEN), vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
		int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN), vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
		int ix = Math.Min(x + w, vx + vw) - Math.Max(x, vx);
		int iy = Math.Min(y + h, vy + vh) - Math.Max(y, vy);
		return ix >= MIN_OVERLAP_X && iy >= MIN_OVERLAP_Y;
	}

	// ---------------- 状态文件 ----------------

	internal sealed class SavedState
	{
		public int X, Y, W, H;
		public bool Zoomed;
	}

	private static int? JsonInt(string text, string key)
	{
		Match m = Regex.Match(text, "\"" + key + "\"\\s*:\\s*(-?\\d+)");
		if (!m.Success) return null;
		return int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
	}

	/** 读取上次会话状态；文件缺失返回 null（不记日志），解析失败记日志后返回 null。 */
	internal static SavedState ReadState(string stateFile)
	{
		try
		{
			if (!File.Exists(stateFile)) return null;
			string raw = File.ReadAllText(stateFile, Utf8NoBom); // 自动识别并剥离 BOM
			if (raw == null || raw.Trim().Length == 0) return null;
			SavedState s = new SavedState();
			int? x = JsonInt(raw, "x"), y = JsonInt(raw, "y"), w = JsonInt(raw, "w"), h = JsonInt(raw, "h");
			if (x == null && y == null && w == null && h == null) throw new FormatException("no numeric geometry fields");
			s.X = x.HasValue ? x.Value : 0;
			s.Y = y.HasValue ? y.Value : 0;
			s.W = w.HasValue ? w.Value : 0;
			s.H = h.HasValue ? h.Value : 0;
			Match z = Regex.Match(raw, "\"zoomed\"\\s*:\\s*(true|false)", RegexOptions.IgnoreCase);
			s.Zoomed = z.Success && string.Equals(z.Groups[1].Value, "true", StringComparison.OrdinalIgnoreCase);
			return s;
		}
		catch (Exception ex)
		{
			Log("state read failed: " + ex.Message);
			return null;
		}
	}

	/** 落盘（临时文件 + 原子替换）。返回是否真的写入。 */
	internal static bool SaveState(string stateFile, int x, int y, int w, int h, bool zoomed)
	{
		if (!zoomed && !IsSaneRect(x, y, w, h))
		{
			Log(string.Format(CultureInfo.InvariantCulture,
				"state save skipped: off-screen or degenerate rect {0}x{1} @({2},{3})", w, h, x, y));
			return false;
		}
		try
		{
			string tmp = stateFile + ".tmp";
			// 与旧 PowerShell 产物保持字节一致：UTF-8 带 BOM、CRLF 行尾、末尾一个换行。
			string json = "{\"x\":" + x.ToString(CultureInfo.InvariantCulture)
				+ ",\"y\":" + y.ToString(CultureInfo.InvariantCulture)
				+ ",\"w\":" + w.ToString(CultureInfo.InvariantCulture)
				+ ",\"h\":" + h.ToString(CultureInfo.InvariantCulture)
				+ ",\"zoomed\":" + (zoomed ? "true" : "false")
				+ ",\"at\":\"" + DateTimeOffset.Now.ToString("o", CultureInfo.InvariantCulture) + "\"}";
			File.WriteAllText(tmp, json + "\r\n", Utf8Bom);
			if (File.Exists(stateFile)) File.Replace(tmp, stateFile, null);
			else File.Move(tmp, stateFile);
			return true;
		}
		catch (Exception ex)
		{
			Log("state save failed: " + ex.Message);
			return false;
		}
	}

	// ---------------- 主流程 ----------------

	private static string ParentExeName(int pid)
	{
		try
		{
			using (Process p = Process.GetProcessById(pid))
			{
				string path = p.MainModule.FileName;
				return Path.GetFileName(path);
			}
		}
		catch
		{
			return null;
		}
	}

	private static bool ParentAlive(int pid)
	{
		try
		{
			using (Process p = Process.GetProcessById(pid)) { return !p.HasExited; }
		}
		catch
		{
			return false;
		}
	}

	public static int Main(string[] args)
	{
		Options o;
		try
		{
			o = Options.Parse(args);
		}
		catch (Exception ex)
		{
			Console.Error.WriteLine("bad arguments: " + ex.Message);
			return 2;
		}
		if (o == null) { Console.Error.WriteLine("bad arguments"); return 2; }
		if (o.SelfTest) return SelfTest.Run();

		logFile = string.IsNullOrEmpty(o.LogFile) ? Path.Combine(Path.GetTempPath(), DEFAULT_LOG_NAME) : o.LogFile;

		if (o.MainPid <= 0) { Log("invalid MainPid"); return 1; }
		if (string.IsNullOrEmpty(o.StateFile) || o.StateFile.Trim().Length == 0) { Log("invalid StateFile"); return 1; }

		// 仅在桌面壳下工作：终端里独立运行的 Host 父进程是 shell，绝不能被触碰。
		string exeName = ParentExeName(o.MainPid);
		if (exeName == null) { Log(string.Format(CultureInfo.InvariantCulture, "parent process not found: {0}", o.MainPid)); return 1; }
		string pattern = string.IsNullOrEmpty(o.AllowExeName) ? DEFAULT_PARENT_PATTERN : o.AllowExeName;
		if (!Regex.IsMatch(exeName, pattern, RegexOptions.IgnoreCase))
		{
			Log(string.Format(CultureInfo.InvariantCulture,
				"parent is not the desktop shell ({0}); exiting without touching anything", exeName));
			return 1;
		}

		// 父进程存活检测只在监视阶段用到：拿一个同步句柄缓存着，比每 tick 新建
		// Process 对象便宜两个数量级（旧实现 4.05% 单核主要就花在这类调用上）。
		IntPtr parentHandle = OpenProcess(PROCESS_SYNCHRONIZE, false, o.MainPid);

		// ---- 相位 1：等待主窗口，然后套用保存的几何 ----
		Log(string.Format(CultureInfo.InvariantCulture, "begin mainPid={0} exe={1} state={2}", o.MainPid, exeName, o.StateFile));
		SavedState saved = ReadState(o.StateFile);
		IntPtr hwnd = IntPtr.Zero;
		DateTime deadline = DateTime.UtcNow.AddSeconds(o.WaitSec);
		while (DateTime.UtcNow < deadline)
		{
			hwnd = FindLargestWindow((uint)o.MainPid, null);
			if (hwnd == IntPtr.Zero)
			{
				// 回退：壳可能把主窗口交给了同族 electron 进程，按标题匹配。
				hwnd = FindLargestWindow(0, "DeepSeek Harness");
			}
			if (hwnd != IntPtr.Zero) break;
			Thread.Sleep(o.PollMs);
		}
		if (hwnd == IntPtr.Zero)
		{
			Log(string.Format(CultureInfo.InvariantCulture, "no window found for pid {0} within {1}s", o.MainPid, o.WaitSec));
			return 1;
		}
		Log(string.Format(CultureInfo.InvariantCulture, "window found hwnd={0}", hwnd.ToInt64()));

		if (saved != null)
		{
			if (saved.Zoomed)
			{
				ShowWindow(hwnd, SW_MAXIMIZE);
				Log("restored: maximized (per saved state)");
			}
			else if (saved.W > 0 && saved.H > 0)
			{
				if (!IsSaneRect(saved.X, saved.Y, saved.W, saved.H))
				{
					// 被旧构建毒化：隐藏窗口的停靠位被写进了状态。删掉它，而不是把
					// 新主窗口挪到屏幕外；下面的监视循环很快会写回当前正常几何。
					Log(string.Format(CultureInfo.InvariantCulture,
						"saved state rejected: off-screen or degenerate rect {0}x{1} @({2},{3}); deleted, keeping default geometry",
						saved.W, saved.H, saved.X, saved.Y));
					try { File.Delete(o.StateFile); } catch { }
				}
				else
				{
					SetWindowPos(hwnd, IntPtr.Zero, saved.X, saved.Y, saved.W, saved.H, SWP_NOZORDER | SWP_NOACTIVATE);
					RECT r;
					GetWindowRect(hwnd, out r);
					Log(string.Format(CultureInfo.InvariantCulture,
						"restored: {0}x{1} @({2},{3}) (actual {4}x{5} @({6},{7}))",
						saved.W, saved.H, saved.X, saved.Y, r.Right - r.Left, r.Bottom - r.Top, r.Left, r.Top));
				}
			}
			else
			{
				Log("saved state had no usable geometry; skipped restore");
			}
		}
		else
		{
			Log("no saved state; first run, keeping default geometry");
		}

		// ---- 相位 2：监视并去抖持久化每一次用户改动 ----
		int lastX = int.MinValue, lastY = 0, lastW = 0, lastH = 0;
		bool lastZoomed = false;
		bool dirty = false;
		DateTime dirtySince = DateTime.UtcNow;
		int parentTicks = 0;
		try
		{
			while (true)
			{
				Thread.Sleep(o.PollMs);
				if (!IsWindow(hwnd)) { Log("window destroyed; watcher exits"); return 0; }
				// 窗口销毁每 tick 都查（便宜）；父进程存活每 ~2s 查一次即可
				parentTicks++;
				if (parentTicks >= 8)
				{
					parentTicks = 0;
					bool parentAlive = parentHandle != IntPtr.Zero
						? WaitForSingleObject(parentHandle, 0) != WAIT_OBJECT_0
						: ParentAlive(o.MainPid);
					if (!parentAlive) { Log("parent exited; watcher exits"); return 0; }
				}
				if (IsIconic(hwnd)) continue;              // 最小化：保留上次状态
				if (!IsWindowVisible(hwnd)) continue;      // 隐藏（收进后台）：保留上次状态

				if (IsZoomed(hwnd))
				{
					if (!lastZoomed)
					{
						lastZoomed = true;
						if (SaveState(o.StateFile, lastX, lastY, lastW, lastH, true)) Log("saved: maximized");
					}
					dirty = false;
					continue;
				}

				RECT r;
				if (!GetWindowRect(hwnd, out r)) continue;
				int x = r.Left, y = r.Top, w = r.Right - r.Left, h = r.Bottom - r.Top;
				if (w <= 0 || h <= 0) continue;
				bool changed = (x != lastX) || (y != lastY) || (w != lastW) || (h != lastH) || lastZoomed;
				if (changed)
				{
					lastX = x; lastY = y; lastW = w; lastH = h; lastZoomed = false;
					if (!dirty) { dirty = true; dirtySince = DateTime.UtcNow; }
				}
				if (dirty && (DateTime.UtcNow - dirtySince).TotalMilliseconds >= o.SaveDebounceMs)
				{
					if (SaveState(o.StateFile, lastX, lastY, lastW, lastH, false))
					{
						Log(string.Format(CultureInfo.InvariantCulture, "saved: {0}x{1} @({2},{3})", lastW, lastH, lastX, lastY));
					}
					dirty = false;
				}
			}
		}
		finally
		{
			if (parentHandle != IntPtr.Zero) CloseHandle(parentHandle);
		}
	}
}

// 纯逻辑自检：不创建窗口、不接触真实状态文件，供 test/self-test.mjs 调用。
// 覆盖两类曾经在生产出过事的判据：屏幕外守卫与坏值拒绝，外加状态文件的
// 往返与字节格式（BOM + CRLF）。
internal static class SelfTest
{
	private static int failures;
	private static int checks;

	private static void Check(bool ok, string label, string detail)
	{
		checks++;
		if (ok) Console.WriteLine("PASS " + label);
		else
		{
			failures++;
			Console.WriteLine("FAIL " + label + " -- " + detail);
		}
	}

	public static int Run()
	{
		Console.WriteLine("dsh-window-memory self-test");

		string dir = Path.Combine(Path.GetTempPath(), "dsh-window-memory-selftest-" + Guid.NewGuid().ToString("N"));
		Directory.CreateDirectory(dir);
		DshWindowMemory.logFile = Path.Combine(dir, "log.txt");
		try
		{
			// 1) 屏幕外 / 退化几何必须判为不合理
			Check(!DshWindowMemory.IsSaneRect(-25600, -25600, 159, 27), "reject hidden parking rect (-25600)", "hidden park rect accepted");
			Check(!DshWindowMemory.IsSaneRect(-32000, -32000, 199, 34), "reject hidden parking rect (-32000)", "hidden park rect accepted");
			Check(!DshWindowMemory.IsSaneRect(100, 100, 100, 80), "reject width below 120", "narrow rect accepted");
			Check(!DshWindowMemory.IsSaneRect(100, 100, 200, 79), "reject height below 80", "short rect accepted");
			Check(!DshWindowMemory.IsSaneRect(0, 0, 0, 0), "reject zero rect", "zero rect accepted");
			Check(!DshWindowMemory.IsSaneRect(99999, 99999, 400, 300), "reject far off-screen rect", "far rect accepted");

			// 2) 正常几何必须判为合理
			Check(DshWindowMemory.IsSaneRect(408, 139, 1294, 985), "accept typical window rect", "typical rect rejected");
			Check(DshWindowMemory.IsSaneRect(0, 0, 1600, 1000), "accept large desktop rect", "desktop rect rejected");
			Check(DshWindowMemory.IsSaneRect(120, 40, 120, 80), "accept minimum allowed rect", "minimum rect rejected");
			Check(DshWindowMemory.IsSaneRect(-200, 60, 800, 600), "accept negative-origin multi-monitor rect", "negative-origin rect rejected");

			// 3) 落盘守卫：屏幕外必须跳过，正常几何必须写入
			string state = Path.Combine(dir, "state.json");
			Check(!DshWindowMemory.SaveState(state, -25600, -25600, 159, 27, false), "save skipped for hidden parking rect", "hidden rect was persisted");
			Check(!File.Exists(state), "skipped save left no state file", "state file was created despite skip");
			Check(DshWindowMemory.SaveState(state, 408, 139, 1294, 985, false), "save allowed for sane rect", "sane rect was skipped");

			// 4) 落盘字节格式：UTF-8 BOM + CRLF（与旧 PowerShell 产物一致）
			byte[] bytes = File.ReadAllBytes(state);
			Check(bytes.Length > 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF,
				"state file is UTF-8 with BOM", "no BOM found");
			Check(bytes[bytes.Length - 2] == 0x0D && bytes[bytes.Length - 1] == 0x0A,
				"state file ends with CRLF", "missing CRLF");

			// 5) 往返读取
			DshWindowMemory.SavedState read = DshWindowMemory.ReadState(state);
			Check(read != null, "state readable back", "ReadState returned null");
			if (read != null)
			{
				Check(read.X == 408 && read.Y == 139 && read.W == 1294 && read.H == 985 && !read.Zoomed,
					"state round-trip preserves geometry",
					string.Format(CultureInfo.InvariantCulture, "got {0},{1} {2}x{3} zoomed={4}", read.X, read.Y, read.W, read.H, read.Zoomed));
			}

			// 6) 覆盖已有文件（原子替换路径）+ 临时文件清理
			Check(DshWindowMemory.SaveState(state, 10, 20, 800, 600, false), "state replaced over existing file", "second SaveState returned false");
			Check(!File.Exists(state + ".tmp"), "temporary file cleaned up", "state.json.tmp left behind");
			DshWindowMemory.SavedState replaced = DshWindowMemory.ReadState(state);
			Check(replaced != null && replaced.X == 10 && replaced.W == 800, "replaced geometry is what is read back", "replacement not visible");

			// 7) 容忍无 BOM / 无末尾换行的等价 JSON
			File.WriteAllText(state, "{\"x\":1,\"y\":2,\"w\":300,\"h\":400,\"zoomed\":true}", new UTF8Encoding(false));
			DshWindowMemory.SavedState noBom = DshWindowMemory.ReadState(state);
			Check(noBom != null && noBom.Zoomed && noBom.W == 300, "read tolerates BOM-less state and zoomed flag", "BOM-less read failed");

			// 8) 坏 JSON 只记日志、返回 null，绝不抛异常
			File.WriteAllText(state, "not json at all", new UTF8Encoding(false));
			Check(DshWindowMemory.ReadState(state) == null, "malformed state yields no saved state", "malformed state was accepted");

			// 9) 状态文件缺失时静默返回 null
			Check(DshWindowMemory.ReadState(Path.Combine(dir, "missing.json")) == null, "missing state yields null", "missing state returned a value");
		}
		finally
		{
			try { Directory.Delete(dir, true); } catch { }
		}

		Console.WriteLine(string.Format(CultureInfo.InvariantCulture, "self-test: {0} checks, {1} failures", checks, failures));
		return failures == 0 ? 0 : 1;
	}
}
