# dsh-window-memory helper.
#
# Remembers and restores the DeepSeek Harness desktop main window geometry
# from outside the app: the Host runtime plugin half (a plain Node child)
# cannot call Electron, so it launches this hidden helper. The helper:
#
#   phase 1 (restore): load the state file written by the previous session,
#     wait for the fresh main window, then apply the saved size/position
#     (or maximize, if the previous session ended maximized).
#   phase 2 (watch): keep polling until the window is destroyed and persist
#     every user-driven change (debounced). Maximized/minimized states are
#     recorded as a zoomed flag, not as raw coordinates, so a maximized
#     session restores maximized and a normal session restores its exact
#     last rectangle.
#
# It never touches windows of any other process.
param(
	[Parameter(Mandatory = $true)][int]$MainPid,
	[Parameter(Mandatory = $true)][string]$StateFile,
	[int]$WaitSec = 180,
	[int]$PollMs = 250,
	[int]$SaveDebounceMs = 1000
)
$ErrorActionPreference = 'Continue'
$log = Join-Path $env:TEMP 'dsh-window-memory.log'
function WLog([string]$m) {
	try {
		if ((Test-Path -LiteralPath $log) -and ((Get-Item -LiteralPath $log).Length -gt 65536)) { Clear-Content -LiteralPath $log }
		Add-Content -LiteralPath $log -Value ('[{0}] {1}' -f (Get-Date -Format o), $m)
	} catch { }
}

if ($MainPid -le 0) { WLog 'invalid MainPid'; exit 1 }
if ([string]::IsNullOrWhiteSpace($StateFile)) { WLog 'invalid StateFile'; exit 1 }

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
public static class DshWindowMemory {
	private delegate bool EnumProc(IntPtr h, IntPtr lp);
	[DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr lp);
	[DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll")] private static extern bool IsIconic(IntPtr h);
	[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
	[DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
	[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
	[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, System.Text.StringBuilder sb, int max);
	public static IntPtr FindLargestWindow(uint pid) {
		return FindLargestWindow(pid, null);
	}
	public static IntPtr FindLargestWindow(uint pid, string titleSubstring) {
		IntPtr best = IntPtr.Zero;
		long bestArea = 0;
		EnumProc cb = delegate(IntPtr h, IntPtr lp) {
			uint wpid;
			GetWindowThreadProcessId(h, out wpid);
			bool pidOk = (pid == 0) || (wpid == pid);
			if (pidOk && IsWindowVisible(h) && !IsIconic(h)) {
				if (!string.IsNullOrEmpty(titleSubstring)) {
					var sb = new System.Text.StringBuilder(512);
					GetWindowText(h, sb, 512);
					if (sb.ToString().IndexOf(titleSubstring, StringComparison.OrdinalIgnoreCase) < 0) return true;
				}
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

function Read-State {
	try {
		if (-not (Test-Path -LiteralPath $StateFile)) { return $null }
		$raw = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
		if ($null -eq $raw) { return $null }
		return @{
			x = [int]$raw.x; y = [int]$raw.y; w = [int]$raw.w; h = [int]$raw.h
			zoomed = [bool]$raw.zoomed
		}
	} catch { WLog ('state read failed: ' + $_.Exception.Message); return $null }
}

function Save-State([int]$x, [int]$y, [int]$w, [int]$h, [bool]$zoomed) {
	try {
		$tmp = "$StateFile.tmp"
		@{ x = $x; y = $y; w = $w; h = $h; zoomed = $zoomed; at = (Get-Date -Format o) } |
			ConvertTo-Json -Compress | Set-Content -LiteralPath $tmp -Encoding UTF8
		Move-Item -LiteralPath $tmp -Destination $StateFile -Force
	} catch { WLog ('state save failed: ' + $_.Exception.Message) }
}

# ---- phase 1: wait for the main window, then restore saved geometry ----
WLog ('begin mainPid={0} exe={1} state={2}' -f $MainPid, $exeName, $StateFile)
$saved = Read-State
$hwnd = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds($WaitSec)
while ((Get-Date) -lt $deadline) {
	$hwnd = [DshWindowMemory]::FindLargestWindow([uint32]$MainPid)
	if ($hwnd -eq [IntPtr]::Zero) {
		# Fallback: the shell may hand the main window to a sibling electron
		# process. Match any visible top-level window titled like the app.
		$hwnd = [DshWindowMemory]::FindLargestWindow([uint32]0, 'DeepSeek Harness')
	}
	if ($hwnd -ne [IntPtr]::Zero) { break }
	Start-Sleep -Milliseconds $PollMs
}
if ($hwnd -eq [IntPtr]::Zero) {
	WLog ('no window found for pid {0} within {1}s' -f $MainPid, $WaitSec)
	exit 1
}
WLog ('window found hwnd={0}' -f $hwnd)

if ($null -ne $saved) {
	if ($saved.zoomed) {
		[void][DshWindowMemory]::ShowWindow($hwnd, 3) # SW_MAXIMIZE
		WLog 'restored: maximized (per saved state)'
	} elseif ($saved.w -gt 0 -and $saved.h -gt 0) {
		# SWP_NOZORDER (0x4) | SWP_NOACTIVATE (0x10): geometry only.
		[void][DshWindowMemory]::SetWindowPos($hwnd, [IntPtr]::Zero, $saved.x, $saved.y, $saved.w, $saved.h, 0x14)
		$r = New-Object DshWindowMemory+RECT
		[void][DshWindowMemory]::GetWindowRect($hwnd, [ref]$r)
		WLog ('restored: {0}x{1} @({2},{3}) (actual {4}x{5} @({6},{7}))' -f $saved.w, $saved.h, $saved.x, $saved.y, ($r.R - $r.L), ($r.B - $r.T), $r.L, $r.T)
	} else {
		WLog 'saved state had no usable geometry; skipped restore'
	}
} else {
	WLog 'no saved state; first run, keeping default geometry'
}

# ---- phase 2: watch and persist every user-driven change (debounced) ----
$last = @{ x = [int]::MinValue; y = 0; w = 0; h = 0; zoomed = $false }
$dirtySince = $null
while ($true) {
	Start-Sleep -Milliseconds $PollMs
	if (-not [DshWindowMemory]::IsWindow($hwnd)) { WLog 'window destroyed; watcher exits'; exit 0 }
	$parentAlive = Get-Process -Id $MainPid -ErrorAction SilentlyContinue
	if ($null -eq $parentAlive) { WLog 'parent exited; watcher exits'; exit 0 }
	if ([DshWindowMemory]::IsIconic($hwnd)) { continue } # minimized: keep last state

	if ([DshWindowMemory]::IsZoomed($hwnd)) {
		if (-not $last.zoomed) {
			$last.zoomed = $true
			Save-State $last.x $last.y $last.w $last.h $true
			WLog 'saved: maximized'
		}
		$dirtySince = $null
		continue
	}

	$r = New-Object DshWindowMemory+RECT
	if (-not [DshWindowMemory]::GetWindowRect($hwnd, [ref]$r)) { continue }
	$x = $r.L; $y = $r.T; $w = $r.R - $r.L; $h = $r.B - $r.T
	if ($w -le 0 -or $h -le 0) { continue }
	$changed = ($x -ne $last.x) -or ($y -ne $last.y) -or ($w -ne $last.w) -or ($h -ne $last.h) -or $last.zoomed
	if ($changed) {
		$last = @{ x = $x; y = $y; w = $w; h = $h; zoomed = $false }
		if ($null -eq $dirtySince) { $dirtySince = Get-Date }
	}
	if ($null -ne $dirtySince -and ((Get-Date) - $dirtySince).TotalMilliseconds -ge $SaveDebounceMs) {
		Save-State $last.x $last.y $last.w $last.h $false
		$dirtySince = $null
		WLog ('saved: {0}x{1} @({2},{3})' -f $last.w, $last.h, $last.x, $last.y)
	}
}
