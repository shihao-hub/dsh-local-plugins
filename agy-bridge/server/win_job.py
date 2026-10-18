#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""win_job: 用 Windows Job Object 保证「持有者一死，整棵子孙树连坐终止」（零第三方依赖）。

为什么需要它（见 plans/01-长任务断连与孤儿进程治理方案.md 方案 B2）
--------------------------------------------------------------------
Windows 上 `Popen.kill()` 只结束**直接子进程**；`agy.exe` 派生出的 powershell/python
孙进程会逃逸成孤儿（事故实测：`check_ptrs.py` 在 agy 被杀后仍空转 20 余分钟）。
Job Object 的 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 由内核保证：持有 Job 句柄的进程
一死（正常退出、被 taskkill、崩溃），Job 内**所有**进程立即终止。

本机实测得来的三条关键事实（2026-10-18，Windows 11 10.0.26200 / CPython 3.12.5）
--------------------------------------------------------------------------------
1. **结构体长度必须恰好等于系统期望值**：`SetInformationJobObject(class=9)` 在本机
   只接受 **144 字节**（文档布局是 112），传 112 稳定返回 `ERROR_BAD_LENGTH(24)`。
   长度用「候选表探测」而非硬编码，见 `_probe_extended_limit_length`。
2. **`AssignProcessToJobObject` 不追溯**：只能覆盖「入 Job 之后」新建的进程。实测
   先让子进程派生孙进程、再 assign 子进程，关闭 Job 后**子死孙活**——正好是要消灭的
   孤儿。因此**正确的收容姿势是把持有者自己放进 Job**（`create_containment_job()`），
   后代在创建时自动继承成员资格，无竞态。
3. **Job 记账的 `ActiveProcesses` 可用于「停稳证明」**：class=1 期望长度 48，字段偏移
   40（见 `_OFFSET_ACTIVE_PROCESSES`）。收容场景下它能看到全部后代（实测孙进程计入）。

能力边界
--------
- 单次任务级的 CPU/进程数上限（需要为每个子进程单独建 Job + 挂起态创建以避免竞态）
  **不在本模块范围**；纯 CPU 灾难由上层「无进度事件看门狗 + 墙钟超时」兜住。
- 按需取消单个子进程树请用 `taskkill /PID <pid> /T /F`（不依赖 Job 成员资格，无竞态）。
"""

from __future__ import annotations

import ctypes
import os
import sys
from typing import Any

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

IS_WINDOWS = os.name == "nt"

JobObjectBasicAccountingInformation = 1
JobObjectExtendedLimitInformation = 9

JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000

PROCESS_TERMINATE = 0x0001
PROCESS_SET_QUOTA = 0x0100
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

# JOBOBJECT_EXTENDED_LIMIT_INFORMATION 的总长度候选：文档布局（x64）为 112，
# 本机 Win11 实测只接受 144；按顺序探测，取第一个被接受的并缓存。
EXTENDED_LIMIT_LENGTH_CANDIDATES = (112, 144)

# 与 ctypes 结构体无关的字段偏移（x64，均为文档布局，已实测生效）
_OFFSET_LIMIT_FLAGS = 16
_OFFSET_ACTIVE_PROCESS_LIMIT = 40
_OFFSET_ACTIVE_PROCESSES = 40  # class=1 记账结构里的同数字段

ERROR_BAD_LENGTH = 24

_accounting_length_cache: int | None = None
_extended_limit_length_cache: int | None = None


# ---------------------------------------------------------------------------
# kernel32 绑定
# ---------------------------------------------------------------------------


def _load_kernel32() -> Any | None:
    """加载并声明 kernel32 原型；非 Windows 返回 None。"""
    if not IS_WINDOWS:
        return None
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    prototypes = {
        "CreateJobObjectW": ([ctypes.c_void_p, wintypes.LPCWSTR], wintypes.HANDLE),
        "SetInformationJobObject": (
            [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD],
            wintypes.BOOL,
        ),
        "QueryInformationJobObject": (
            [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)],
            wintypes.BOOL,
        ),
        "AssignProcessToJobObject": ([wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
        "OpenProcess": ([wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE),
        "GetCurrentProcess": ([], wintypes.HANDLE),
        "CloseHandle": ([wintypes.HANDLE], wintypes.BOOL),
        "TerminateJobObject": ([wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
    }
    for name, (argtypes, restype) in prototypes.items():
        function = getattr(kernel32, name)
        function.argtypes = argtypes
        function.restype = restype
    return kernel32


_KERNEL32 = _load_kernel32()


def _probe_extended_limit_length() -> int | None:
    """探测本机接受的 ExtendedLimit 结构长度（结果缓存）。"""
    global _extended_limit_length_cache
    if _extended_limit_length_cache is not None:
        return _extended_limit_length_cache
    if _KERNEL32 is None:
        return None
    for length in EXTENDED_LIMIT_LENGTH_CANDIDATES:
        handle = _KERNEL32.CreateJobObjectW(None, None)
        if not handle:
            continue
        try:
            buffer = ctypes.create_string_buffer(length)
            ctypes.c_uint32.from_buffer(buffer, _OFFSET_LIMIT_FLAGS).value = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if _KERNEL32.SetInformationJobObject(
                handle, JobObjectExtendedLimitInformation, ctypes.byref(buffer), length
            ):
                _extended_limit_length_cache = length
                return length
        finally:
            _KERNEL32.CloseHandle(handle)
    return None


def _probe_accounting_length() -> int | None:
    """探测本机接受的记账结构长度（结果缓存）。"""
    global _accounting_length_cache
    if _accounting_length_cache is not None:
        return _accounting_length_cache
    if _KERNEL32 is None:
        return None
    for length in (48, 64, 56, 80):
        handle = _KERNEL32.CreateJobObjectW(None, None)
        if not handle:
            continue
        try:
            buffer = ctypes.create_string_buffer(length)
            needed = ctypes.c_uint32(0)
            if _KERNEL32.QueryInformationJobObject(
                handle, JobObjectBasicAccountingInformation, ctypes.byref(buffer), length, ctypes.byref(needed)
            ):
                _accounting_length_cache = length
                return length
        finally:
            _KERNEL32.CloseHandle(handle)
    return None


# ---------------------------------------------------------------------------
# Job 对象
# ---------------------------------------------------------------------------


class NullJob:
    """非 Windows（或 Job 不可用）的占位实现：调用方无需分支。"""

    available = False
    reason = "not-windows-or-job-unavailable"

    def assign(self, pid: int) -> bool:
        return False

    def terminate(self) -> None:
        return None

    def active_processes(self) -> int | None:
        return None

    def close(self) -> None:
        return None

    def __enter__(self) -> "NullJob":
        return self

    def __exit__(self, *_exc: object) -> None:
        return None


class WinJob:
    """kill-on-close 的 Windows Job Object；句柄由本对象独占持有。"""

    available = True
    reason = "ok"

    def __init__(self, handle: int, extended_limit_length: int, accounting_length: int | None) -> None:
        self._handle = handle
        self._extended_limit_length = extended_limit_length
        self._accounting_length = accounting_length
        self._closed = False

    # -- 成员管理 ---------------------------------------------------------

    def assign(self, pid: int) -> bool:
        """把已启动的进程纳入 Job。

        注意：**只对该进程此后新建的后代生效**（Windows 不做追溯）。要收容整棵树，
        请在启动任何子进程之前用 `create_containment_job()` 把持有者自己放进 Job。
        """
        if self._closed or _KERNEL32 is None:
            return False
        access = PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION
        process = _KERNEL32.OpenProcess(access, False, pid)
        if not process:
            return False
        try:
            return bool(_KERNEL32.AssignProcessToJobObject(self._handle, process))
        finally:
            _KERNEL32.CloseHandle(process)

    def assign_current_process(self) -> bool:
        """把当前进程纳入 Job，使其此后派生的所有后代自动继承成员资格（无竞态）。"""
        if self._closed or _KERNEL32 is None:
            return False
        return bool(_KERNEL32.AssignProcessToJobObject(self._handle, _KERNEL32.GetCurrentProcess()))

    # -- 观测与终止 -------------------------------------------------------

    def active_processes(self) -> int | None:
        """Job 内仍在运行的进程数（用于「停稳证明」）；不可得时返回 None。"""
        if self._closed or _KERNEL32 is None or self._accounting_length is None:
            return None
        buffer = ctypes.create_string_buffer(self._accounting_length)
        needed = ctypes.c_uint32(0)
        ok = _KERNEL32.QueryInformationJobObject(
            self._handle,
            JobObjectBasicAccountingInformation,
            ctypes.byref(buffer),
            self._accounting_length,
            ctypes.byref(needed),
        )
        if not ok:
            return None
        return int(ctypes.c_uint32.from_buffer(buffer, _OFFSET_ACTIVE_PROCESSES).value)

    def terminate(self) -> None:
        """立即终止 Job 内所有进程（含持有者自身，故仅在收尾时使用）。"""
        if self._closed or _KERNEL32 is None:
            return
        _KERNEL32.TerminateJobObject(self._handle, 1)

    def close(self) -> None:
        """关闭句柄：KILL_ON_JOB_CLOSE 生效，Job 内全部进程被内核终止。"""
        if self._closed:
            return
        self._closed = True
        if _KERNEL32 is not None:
            _KERNEL32.CloseHandle(self._handle)

    def __enter__(self) -> "WinJob":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


# ---------------------------------------------------------------------------
# 工厂
# ---------------------------------------------------------------------------


def create_job() -> WinJob | NullJob:
    """建一个 kill-on-close 的 Job（**不**收容任何进程，需自行 assign）。"""
    if _KERNEL32 is None:
        return NullJob()
    length = _probe_extended_limit_length()
    if length is None:
        return NullJob()
    handle = _KERNEL32.CreateJobObjectW(None, None)
    if not handle:
        return NullJob()
    buffer = ctypes.create_string_buffer(length)
    ctypes.c_uint32.from_buffer(buffer, _OFFSET_LIMIT_FLAGS).value = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not _KERNEL32.SetInformationJobObject(
        handle, JobObjectExtendedLimitInformation, ctypes.byref(buffer), length
    ):
        _KERNEL32.CloseHandle(handle)
        return NullJob()
    return WinJob(handle, length, _probe_accounting_length())


def create_containment_job() -> WinJob | NullJob:
    """推荐入口：建 Job 并**把当前进程放进去**，使全部后代自动被收容。

    用法：在 `main()` 最开头取得并长期持有（模块级或 main 局部变量均可），
    绝不要提前 `close()`；桥接器进程一死，内核自动连坐终止所有 agy 子树。
    """
    job = create_job()
    if isinstance(job, WinJob):
        if not job.assign_current_process():
            job.close()
            return NullJob()
    return job


if __name__ == "__main__":  # pragma: no cover - 仅供手工冒烟
    probe = create_job()
    sys.stderr.write(
        f"job available={probe.available} "
        f"extendedLen={_extended_limit_length_cache} accountingLen={_accounting_length_cache} "
        f"active={probe.active_processes()}\n"
    )
    probe.close()
