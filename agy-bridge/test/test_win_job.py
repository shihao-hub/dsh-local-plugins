#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ============================================================================
# win_job 回归测试：证明「持有者一死，整棵子孙树连坐终止」由内核生效，
# 并把「AssignProcessToJobObject 不追溯」这一实测行为固定成防误用用例。
#
# 验收判据（不看"好像没进程了"，只看内核可查事实）：
#   ① 收容用例：持有者被 taskkill **不带 /T** 杀掉后，孙进程仍必须死（只有 Job 能做到）；
#   ② 记账用例：收容后 ActiveProcesses 必须看到孙进程（证明继承生效）；
#   ③ 防误用用例：事后 assign 的子进程，其**已存在**的孙进程不受 Job 约束（记录既有行为）；
#   ④ 隔离用例：未入 Job 的进程不受影响（不会误杀无辜）。
#
# 用法：python test/test_win_job.py [--keep]
# 退出码：0 全绿；1 有失败；2 非 Windows（走 NullJob 分支，跳过内核用例）
# ============================================================================
"""win_job 回归测试。"""

from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
sys.path.insert(0, str(SERVER_DIR))

from win_job import create_containment_job, create_job  # noqa: E402

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

SLEEP_CODE = "import time; time.sleep(600)"
WAIT_DEAD_S = 6.0
KEEP_ON_FAILURE = "--keep" in sys.argv

# 持有者脚本：先收容自己，再派生孙进程，然后打印全局事实并长睡。
HOLDER_CODE = (
    "import subprocess, sys, time\n"
    f"sys.path.insert(0, {str(SERVER_DIR)!r})\n"
    "from win_job import create_containment_job\n"
    "job = create_containment_job()\n"
    "print('JOB', job.available, flush=True)\n"
    f"grandchild = subprocess.Popen([sys.executable, '-c', {SLEEP_CODE!r}])\n"
    "print('GRANDCHILD', grandchild.pid, flush=True)\n"
    "time.sleep(1.5)\n"
    "print('ACTIVE', job.active_processes(), flush=True)\n"
    "time.sleep(600)\n"
)

# 事后 assign 用例用：子进程自己派生孙进程后再打印
SPAWNER_CODE = (
    "import subprocess, sys, time\n"
    f"grandchild = subprocess.Popen([sys.executable, '-c', {SLEEP_CODE!r}])\n"
    "print('GRANDCHILD', grandchild.pid, flush=True)\n"
    "time.sleep(600)\n"
)

# ---------------------------------------------------------------------------
# 进程事实查询
# ---------------------------------------------------------------------------

KERNEL32 = ctypes.WinDLL("kernel32", use_last_error=True)
KERNEL32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_bool, ctypes.c_uint32]
KERNEL32.OpenProcess.restype = ctypes.c_void_p
KERNEL32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
KERNEL32.WaitForSingleObject.restype = ctypes.c_uint32
KERNEL32.CloseHandle.argtypes = [ctypes.c_void_p]
KERNEL32.CloseHandle.restype = ctypes.c_bool

SYNCHRONIZE = 0x00100000
WAIT_TIMEOUT = 258


def process_alive(pid: int) -> bool:
    handle = KERNEL32.OpenProcess(SYNCHRONIZE, False, pid)
    if not handle:
        return False
    try:
        return KERNEL32.WaitForSingleObject(handle, 0) == WAIT_TIMEOUT
    finally:
        KERNEL32.CloseHandle(handle)


def wait_until_dead(pid: int, timeout_s: float = WAIT_DEAD_S) -> float:
    started = time.monotonic()
    while time.monotonic() - started < timeout_s:
        if not process_alive(pid):
            return time.monotonic() - started
        time.sleep(0.1)
    return -1.0


def kill_quietly(pid: int, tree: bool = True) -> None:
    command = ["taskkill", "/PID", str(pid), "/F"]
    if tree:
        command.insert(3, "/T")
    subprocess.run(command, capture_output=True)


class LineReader:
    """后台读取子进程 stdout，避免断言失败时卡在 readline 上。"""

    def __init__(self, stream) -> None:
        self._lines: list[str] = []
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._pump, args=(stream,), daemon=True)
        self._thread.start()

    def _pump(self, stream) -> None:
        for line in stream:
            with self._lock:
                self._lines.append(line.strip())

    def take(self, prefix: str, timeout_s: float = 15.0) -> str | None:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            with self._lock:
                for line in self._lines:
                    if line.startswith(prefix):
                        return line
            time.sleep(0.1)
        return None


# ---------------------------------------------------------------------------
# 用例
# ---------------------------------------------------------------------------


def test_containment_survives_holder_death() -> None:
    """核心用例：只杀持有者（不带 /T），孙进程仍必须死——只有 Job 能做到。"""
    holder = subprocess.Popen(
        [sys.executable, "-c", HOLDER_CODE], stdout=subprocess.PIPE, text=True
    )
    reader = LineReader(holder.stdout)
    try:
        job_line = reader.take("JOB")
        assert job_line == "JOB True", f"持有者未能建立收容 Job：{job_line}"
        grandchild_line = reader.take("GRANDCHILD")
        assert grandchild_line, "未取得孙进程 pid"
        grandchild_pid = int(grandchild_line.split()[1])
        active_line = reader.take("ACTIVE")
        assert active_line, "未取得 Job 记账"
        active = int(active_line.split()[1])
        assert active >= 2, f"收容后记账应看到持有者与孙进程（>=2），实际 {active}"
        print(f"    Job 记账 ActiveProcesses={active}（含孙进程 → 继承生效）")

        # 关键：不带 /T，只杀持有者本身，孙进程失去父链
        kill_quietly(holder.pid, tree=False)
        assert wait_until_dead(holder.pid) >= 0, "持有者未被杀掉"
        elapsed = wait_until_dead(grandchild_pid)
        if elapsed < 0 and not KEEP_ON_FAILURE:
            kill_quietly(grandchild_pid)
        assert elapsed >= 0, "持有者死后孙进程仍存活（Job 连坐失效，孤儿防线未建立）"
        print(f"    持有者死后孙进程 {elapsed:.1f}s 内被内核终止")
    finally:
        if holder.poll() is None:
            kill_quietly(holder.pid)


def test_assign_is_not_retroactive() -> None:
    """防误用用例：事后 assign 覆盖不到已存在的孙进程（把实测行为固定下来）。"""
    job = create_job()
    assert job.available, "Job 创建失败"
    spawner = subprocess.Popen([sys.executable, "-c", SPAWNER_CODE], stdout=subprocess.PIPE, text=True)
    reader = LineReader(spawner.stdout)
    try:
        line = reader.take("GRANDCHILD")
        assert line, "未取得孙进程 pid"
        grandchild_pid = int(line.split()[1])
        assert job.assign(spawner.pid), "assign 失败"

        job.close()
        assert wait_until_dead(spawner.pid) >= 0, "assign 过的子进程未被终止"
        survived = process_alive(grandchild_pid)
        if not KEEP_ON_FAILURE:
            kill_quietly(grandchild_pid)
        assert survived, "孙进程竟然被终止了：说明本机行为与文档假设不符，需重新设计收容策略"
        print("    事后 assign 的孙进程逃逸（如文档所述）→ 必须用 create_containment_job()")
    finally:
        if spawner.poll() is None:
            kill_quietly(spawner.pid)


def test_unassigned_processes_unaffected() -> None:
    """隔离用例：未入 Job 的进程不受影响（不误杀无关进程）。"""
    job = create_job()
    assert job.available
    innocent = subprocess.Popen([sys.executable, "-c", SLEEP_CODE])
    try:
        assert process_alive(innocent.pid), "无辜进程未启动"
        job.close()
        time.sleep(1.0)
        assert process_alive(innocent.pid), "未入 Job 的进程被误杀"
        print("    未纳入 Job 的进程未被误杀")
    finally:
        kill_quietly(innocent.pid)


CASES = [
    ("containment_survives_holder_death", test_containment_survives_holder_death),
    ("assign_is_not_retroactive", test_assign_is_not_retroactive),
    ("unassigned_processes_unaffected", test_unassigned_processes_unaffected),
]


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if os.name != "nt":
        print("非 Windows 宿主：win_job 走 NullJob 分支，跳过内核用例")
        return 2

    failed: list[str] = []
    for name, case in CASES:
        print(f"[case] {name}")
        try:
            case()
            print("  PASS")
        except AssertionError as error:
            failed.append(name)
            print(f"  FAIL: {error}")
        except Exception as error:  # noqa: BLE001 - 测试脚本需如实报告任何异常
            failed.append(name)
            print(f"  ERROR: {type(error).__name__}: {error}")

    print(f"\n{len(CASES) - len(failed)}/{len(CASES)} 通过")
    if failed:
        print("失败用例：" + ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
