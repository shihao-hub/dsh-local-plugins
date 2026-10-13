// window-memory 回归测试夹具窗口。
//
// 为什么自己造窗口：拿 notepad/charmap 之类系统程序当靶子会踩坑——Windows 11 上
// notepad.exe 只是壳，真正持有窗口的是 WindowsApps 里的商店包进程，helper 按
// pid 找不到窗口，测试会变成对系统版本的隐式依赖。本夹具创建一个必然由自己
// 持有的顶层窗口，并把自身的真实几何打到 stdout，作为独立于 helper 的第三方证据。
//
// 编译（测试脚本自动完成，与 helper 同一个 csc）：
//   csc /nologo /target:exe /platform:x64 /out:test-window.exe test-window.cs
// 运行：
//   test-window.exe [--x N] [--y N] [--w N] [--h N] [--maximize]
//
// 必须由测试以 windowsHide:true（CREATE_NO_WINDOW）启动：本程序是控制台子系统，
// 若分配到控制台窗口，那个窗口也可能被 helper 的"最大可见窗口"判据选中。
// 关掉控制台后 stdout 仍走重定向管道，报告不受影响。
//
// stdout 事件（每行一条，遇变化即刷出）：
//   ready hwnd=<十进制句柄>
//   rect <x> <y> <w> <h>

using System;
using System.Globalization;
using System.Runtime.InteropServices;

internal static class TestWindow
{
	private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
	private struct WNDCLASS
	{
		public uint style;
		public WndProcDelegate lpfnWndProc;
		public int cbClsExtra;
		public int cbWndExtra;
		public IntPtr hInstance;
		public IntPtr hIcon;
		public IntPtr hCursor;
		public IntPtr hbrBackground;
		public string lpszMenuName;
		public string lpszClassName;
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct RECT { public int Left, Top, Right, Bottom; }

	[StructLayout(LayoutKind.Sequential)]
	private struct MSG
	{
		public IntPtr hwnd;
		public uint message;
		public IntPtr wParam;
		public IntPtr lParam;
		public uint time;
		public int ptX;
		public int ptY;
	}

	[DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern ushort RegisterClassW(ref WNDCLASS wc);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateWindowExW(uint exStyle, string className, string windowName, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
	[DllImport("user32.dll")] private static extern bool GetMessageW(out MSG msg, IntPtr hWnd, uint filterMin, uint filterMax);
	[DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG msg);
	[DllImport("user32.dll")] private static extern IntPtr DispatchMessageW(ref MSG msg);
	[DllImport("user32.dll")] private static extern void PostQuitMessage(int exitCode);
	[DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
	[DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int cmd);
	[DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr hWnd);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr DefWindowProcW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
	[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandleW(string name);

	private const uint WM_DESTROY = 0x0002;
	private const uint WM_CLOSE = 0x0010;
	private const uint WM_MOVE = 0x0003;
	private const uint WM_SIZE = 0x0005;
	private const uint WS_OVERLAPPEDWINDOW = 0x00CF0000;
	private const uint WS_VISIBLE = 0x10000000;
	private const int SW_MAXIMIZE = 3;
	private const int SW_SHOWNA = 8;
	private const int COLOR_WINDOW = 5;
	private const string CLASS_NAME = "DshWindowMemoryTestWindow";

	private static void Report(IntPtr hWnd)
	{
		RECT r;
		if (!GetWindowRect(hWnd, out r)) return;
		Console.WriteLine(string.Format(CultureInfo.InvariantCulture, "rect {0} {1} {2} {3}",
			r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top));
		Console.Out.Flush();
	}

	private static IntPtr Proc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
	{
		if (msg == WM_MOVE || msg == WM_SIZE) Report(hWnd);
		if (msg == WM_CLOSE) { DestroyWindow(hWnd); return IntPtr.Zero; }
		if (msg == WM_DESTROY) { PostQuitMessage(0); return IntPtr.Zero; }
		return DefWindowProcW(hWnd, msg, wParam, lParam);
	}

	public static int Main(string[] args)
	{
		int x = 100, y = 100, w = 800, h = 600;
		bool maximize = false;
		for (int i = 0; i < args.Length; i++)
		{
			string a = args[i].ToLowerInvariant();
			string v = (i + 1 < args.Length) ? args[i + 1] : null;
			switch (a)
			{
				case "--x": if (v == null) return 2; x = int.Parse(v, CultureInfo.InvariantCulture); i++; break;
				case "--y": if (v == null) return 2; y = int.Parse(v, CultureInfo.InvariantCulture); i++; break;
				case "--w": if (v == null) return 2; w = int.Parse(v, CultureInfo.InvariantCulture); i++; break;
				case "--h": if (v == null) return 2; h = int.Parse(v, CultureInfo.InvariantCulture); i++; break;
				case "--maximize": maximize = true; break;
				default: break;
			}
		}

		WNDCLASS wc = new WNDCLASS();
		wc.lpfnWndProc = new WndProcDelegate(Proc); // 必须保持强引用，否则委托被回收后消息循环崩溃
		wc.lpszClassName = CLASS_NAME;
		wc.hInstance = GetModuleHandleW(null);
		wc.hbrBackground = (IntPtr)(COLOR_WINDOW + 1);
		RegisterClassW(ref wc);

		IntPtr hwnd = CreateWindowExW(0, CLASS_NAME, "dsh-window-memory test window",
			WS_OVERLAPPEDWINDOW | WS_VISIBLE, x, y, w, h, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
		if (hwnd == IntPtr.Zero)
		{
			Console.WriteLine("error create " + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture));
			return 2;
		}
		Console.WriteLine("ready hwnd=" + hwnd.ToInt64().ToString(CultureInfo.InvariantCulture));
		Console.Out.Flush();
		ShowWindow(hwnd, SW_SHOWNA);
		Report(hwnd);
		if (maximize) ShowWindow(hwnd, SW_MAXIMIZE);

		MSG msg;
		while (GetMessageW(out msg, IntPtr.Zero, 0, 0))
		{
			TranslateMessage(ref msg);
			DispatchMessageW(ref msg);
		}
		return 0;
	}
}
