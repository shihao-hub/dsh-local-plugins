# dsh-startup-maximize helper.
#
# Maximizes the DeepSeek Harness desktop main window from outside the app:
# the Host runtime plugin half (a plain Node child) cannot call Electron, so
# it launches this hidden helper. The helper guards, polls, maximizes once,
# re-asserts, and exits. It never touches windows of any other process.
param(
	[Parameter(Mandatory = $true)][int]$MainPid,
	[int]$WaitSec = 30,
	[int]$PollMs = 250,
	[int]$VerifyMs = 2000,
	[int]$ReassertMs = 2000
)
$ErrorActionPreference = 'Continue'
$log = Join-Path $env:TEMP 'dsh-startup-maximize.log'
function WLog([string]$m) {
	try {
		if ((Test-Path -LiteralPath $log) -and ((Get-Item -LiteralPath $log).Length -gt 65536)) { Clear-Content -LiteralPath $log }
		Add-Content -LiteralPath $log -Value ('[{0}] {1}' -f (Get-Date -Format o), $m)
	} catch { }
}

if ($MainPid -le 0) { WLog 'invalid MainPid'; exit 1 }

# Only run under the desktop shell: the parent must be the packaged app exe
# (or electron.exe in development). A terminal-launched standalone Host has a
# console/shell parent and must never be touched.
$parent = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $MainPid" | Select-Object -First 1
if ($null -eq $parent) { WLog ('parent process not found: {0}' -f $MainPid); exit 1 }
$exeName = [System.IO.Path]::GetFileName([string]$parent.ExecutablePath)
if ($exeName -notmatch '^(?:DeepSeek Harness|electron)\.exe$') {
	WLog ('parent is not the desktop shell ({0}); exiting without touching anything' -f $exeName)
	exit 1
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshStartupMaximize {
	private delegate bool EnumProc(IntPtr h, IntPtr lp);
	[DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr lp);
	[DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll")] private static extern bool IsIconic(IntPtr h);
	[DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
	[StructLayout(LayoutKind.Sequential)] private struct RECT { public int L, T, R, B; }
	[DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr h, out RECT r);
	public static IntPtr FindLargestWindow(uint pid) {
		IntPtr best = IntPtr.Zero;
		long bestArea = 0;
		EnumProc cb = delegate(IntPtr h, IntPtr lp) {
			uint wpid;
			GetWindowThreadProcessId(h, out wpid);
			if (wpid == pid && IsWindowVisible(h) && !IsIconic(h)) {
				RECT r;
				GetWindowRect(h, out r);
				long area = (long)(r.R - r.L) * (long)(r.B - r.T);
				if (area > bestArea) { bestArea = area; best = h; }
			}
			return true;
		};
		EnumWindows(cb, IntPtr.Zero);
		GC.KeepAlive(cb);
		return best;
	}
}
'@

WLog ('begin mainPid={0} exe={1}' -f $MainPid, $exeName)
$deadline = (Get-Date).AddSeconds($WaitSec)
while ((Get-Date) -lt $deadline) {
	$h = [DshStartupMaximize]::FindLargestWindow([uint32]$MainPid)
	if ($h -ne [IntPtr]::Zero) {
		if ([DshStartupMaximize]::IsZoomed($h)) { WLog ('window already maximized hwnd={0}' -f $h); exit 0 }
		[void][DshStartupMaximize]::ShowWindow($h, 3) # SW_MAXIMIZE
		$verifyDeadline = (Get-Date).AddMilliseconds($VerifyMs)
		while ((Get-Date) -lt $verifyDeadline) {
			if ([DshStartupMaximize]::IsZoomed($h)) {
				WLog ('maximized hwnd={0}' -f $h)
				Start-Sleep -Milliseconds $ReassertMs
				if (-not [DshStartupMaximize]::IsZoomed($h)) {
					[void][DshStartupMaximize]::ShowWindow($h, 3)
					WLog ('re-asserted hwnd={0}' -f $h)
				}
				exit 0
			}
			Start-Sleep -Milliseconds 150
		}
		WLog ('show sent but not zoomed yet hwnd={0}; will retry' -f $h)
	}
	Start-Sleep -Milliseconds $PollMs
}
WLog ('no window found for pid {0} within {1}s' -f $MainPid, $WaitSec)
exit 1
