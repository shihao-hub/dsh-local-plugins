#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""agy-bridge: a minimal stdio MCP server for read-only DeepSeek Harness research delegation.

Purpose
-------
Expose the host's Antigravity CLI (``agy``) to DeepSeek Harness (and any other
MCP client) as a strictly read-only research/audit tool. Every agy invocation
is pinned to the safe read-only shape:

    agy -p <prompt> --sandbox --mode plan --output-format json

There is deliberately no destructive mode: no filesystem writes, and high-risk
terminal commands are physically blocked by agy's own sandbox plus plan mode.

Lifecycle / cleanliness
-----------------------
- Stateless: nothing is written to disk by this server (no temp files, no cache);
- stdout carries JSON-RPC frames only; diagnostics go to stderr;
- killing the parent disposes this server and any in-flight agy child.

Protocol
--------
Newline-delimited JSON-RPC 2.0 over stdio, with an LSP-style Content-Length
framing reader that also accepts raw JSON lines. Implements initialize,
notifications/initialized, ping, tools/list, and tools/call.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# constants
# ---------------------------------------------------------------------------

PROTOCOL_VERSION_FALLBACK = "2025-06-18"
SERVER_NAME = "agy-bridge"
SERVER_VERSION = "0.1.0"

READ_ONLY_FLAGS = ["--sandbox", "--mode", "plan"]
JSON_FLAG = "--output-format"
DEFAULT_TIMEOUT_S = 600
MAX_TIMEOUT_S = 3600
MAX_PROMPT_CHARS = 200_000

# 非交互守卫段。没有它时，agy 在 plan 模式下会把委托理解成「先出计划、等人点 Proceed」，
# 而非交互的 print 调用根本没有人能点，结果就是返回一份计划文档而不是答案。
# 与 bin/agy-run.mjs 的 GUARDRAILS 保持同源，避免两条委托路径行为分叉。
GUARDRAILS = (
    "\n"
    "【本次调用为 -p 非交互 print 模式，没有人能点击 Proceed 或回复确认】\n"
    "1. 必须在同一回合内直接产出最终交付物（报告正文即最终回答），禁止生成「待确认/请审阅」的计划文档；\n"
    "2. 文件枚举优先使用 git ls-files；禁止 Path.rglob / os.walk 全盘裸扫；目录遍历必须限深、限条数；\n"
    "3. 严禁把探针脚本托管为长时间后台任务；单条命令超过 60 秒即视为设计错误，应缩减范围；\n"
    "4. 预算内先出完整结构，再补关键细节，不要为细枝末节反复往返。"
)

# 命中即认为 agy 停下来等人批准（非交互调用无人可点）。
PLAN_WAIT_PATTERN = re.compile(r"(待确认|请审阅|Proceed|确认无误后|等待您的批准)")
# 自动续跑时追加的指令。
RESUME_PROMPT = (
    "继续：直接在同一回合内输出最终交付物（报告正文即最终回答），"
    "不要再征求任何批准或生成计划文档。"
)
# 续跑硬上限：只允许一次，避免在 agy 顽固进入 plan 模式时无限循环烧额度。
MAX_CONTINUATIONS = 1

IS_WINDOWS = os.name == "nt"
CREATE_NO_WINDOW = 0x08000000  # Windows process creation flag, harmless elsewhere


# ---------------------------------------------------------------------------
# stderr diagnostics
# ---------------------------------------------------------------------------

_log_lock = threading.Lock()


def log(message: str) -> None:
    """Best-effort stderr diagnostics; never allowed to break the server."""
    try:
        with _log_lock:
            sys.stderr.write(f"[{SERVER_NAME}] {message}\n")
            sys.stderr.flush()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# agy executable resolution
# ---------------------------------------------------------------------------


def find_agy() -> str | None:
    """Resolve the agy executable: explicit env, config file, PATH, then known spots."""
    env = os.environ.get("AGY_BIN")
    if env and Path(env).is_file():
        return env

    config_candidates = [
        Path(__file__).resolve().parent / "agy-bridge.config.json",
        Path.home() / ".dsh" / "agy-bridge.config.json",
    ]
    for candidate in config_candidates:
        try:
            if candidate.is_file():
                data = json.loads(candidate.read_text(encoding="utf-8"))
                configured = data.get("agyPath")
                if configured and Path(configured).is_file():
                    return configured
        except Exception as exc:
            log(f"config probe failed for {candidate}: {exc}")

    found = shutil.which("agy") or shutil.which("agy.exe")
    if found:
        return found

    local = os.environ.get("LOCALAPPDATA")
    if local:
        fallback = Path(local) / "agy" / "bin" / "agy.exe"
        if fallback.is_file():
            return str(fallback)
    return None


# ---------------------------------------------------------------------------
# subprocess plumbing
# ---------------------------------------------------------------------------


def run_agy(args: list[str], cwd: str, timeout_s: int) -> dict[str, Any]:
    """Run one agy invocation and return captured output plus timing.

    Raises FileNotFoundError when the binary vanished between probe and run.
    """
    agy = find_agy()
    if not agy:
        raise FileNotFoundError("agy executable not found")

    started = time.monotonic()
    creationflags = CREATE_NO_WINDOW if IS_WINDOWS else 0
    try:
        proc = subprocess.run(
            [agy, *args],
            cwd=cwd,
            capture_output=True,
            timeout=timeout_s,
            creationflags=creationflags,
        )
    except subprocess.TimeoutExpired as exc:
        elapsed = time.monotonic() - started
        out = _decode(exc.stdout)
        err = _decode(exc.stderr)
        return {
            "stdout": out,
            "stderr": err,
            "exitCode": None,
            "timedOut": True,
            "durationS": round(elapsed, 2),
        }
    elapsed = time.monotonic() - started
    return {
        "stdout": _decode(proc.stdout),
        "stderr": _decode(proc.stderr),
        "exitCode": proc.returncode,
        "timedOut": False,
        "durationS": round(elapsed, 2),
    }


def _decode(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace")
    return str(raw)


# ---------------------------------------------------------------------------
# agy JSON response parsing
# ---------------------------------------------------------------------------


def extract_response_text(stdout: str) -> str | None:
    """Best-effort extraction of the final answer text from agy JSON output.

    Supports both the plain-prompt envelope and the slash-command envelope
    (``{status, response, command:{name,data}}``). Returns None when the payload
    cannot be recognised, so callers can fall back to raw text.
    """
    text = stdout.strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return _walk_for_text(parsed)


def _walk_for_text(node: Any, depth: int = 0) -> str | None:
    if depth > 6 or node is None:
        return None
    if isinstance(node, str):
        return node if node.strip() else None
    if isinstance(node, list):
        for item in node:
            found = _walk_for_text(item, depth + 1)
            if found:
                return found
        return None
    if not isinstance(node, dict):
        return None

    for key in ("response", "result", "output", "text", "content"):
        if key in node:
            found = _walk_for_text(node[key], depth + 1)
            if found:
                return found
    for key in ("command", "messages", "data"):
        if key in node:
            found = _walk_for_text(node[key], depth + 1)
            if found:
                return found
    return None


def short_failure(meta: dict[str, Any]) -> str:
    """Compose a compact, prompt-free failure description for the model."""
    parts: list[str] = []
    if meta.get("timedOut"):
        parts.append(f"agy timed out after {meta.get('durationS')}s")
    elif meta.get("exitCode") is not None:
        parts.append(f"agy exited with code {meta['exitCode']}")
    stderr = (meta.get("stderr") or "").strip()
    if stderr:
        parts.append(stderr[:2000])
    stdout = (meta.get("stdout") or "").strip()
    if stdout and not stderr:
        parts.append(stdout[:1000])
    return "; ".join(parts) or "agy produced no output"


# ---------------------------------------------------------------------------
# plan-and-wait detection
# ---------------------------------------------------------------------------


def parse_envelope(stdout: str) -> dict[str, Any]:
    """Parse agy's ``--output-format json`` envelope; {} when unrecognised.

    The envelope is flat (``conversation_id`` / ``status`` / ``response`` /
    ``duration_seconds`` / ``num_turns`` / ``usage``), so a shallow read is
    enough and ``conversation_id`` is directly usable for a continuation run.
    """
    text = (stdout or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def looks_like_plan_wait(text: str | None) -> bool:
    """True when agy stopped to ask for approval instead of delivering."""
    return bool(text) and PLAN_WAIT_PATTERN.search(text) is not None


# ---------------------------------------------------------------------------
# tool implementations
# ---------------------------------------------------------------------------


def _normalize_cwd(raw: Any) -> tuple[str | None, str | None]:
    """Validate an optional working directory; returns (cwd, error)."""
    if raw in (None, ""):
        return None, None
    candidate = Path(str(raw)).expanduser()
    if not candidate.is_dir():
        return None, f"cwd does not exist or is not a directory: {candidate}"
    return str(candidate), None


def _normalize_extra_args(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw if str(item).strip()]


def tool_research(args: dict[str, Any]) -> dict[str, Any]:
    """Read-only research/audit delegation to agy (sandbox + plan mode pinned)."""
    prompt = str(args.get("prompt") or "").strip()
    if not prompt:
        return _error_result("invalid_arguments", "prompt is required and must be non-empty")
    if len(prompt) > MAX_PROMPT_CHARS:
        return _error_result(
            "prompt_too_large",
            f"prompt exceeds {MAX_PROMPT_CHARS} characters; split the task",
        )

    cwd, cwd_error = _normalize_cwd(args.get("cwd"))
    if cwd_error:
        return _error_result("invalid_cwd", cwd_error)
    effective_cwd = cwd or str(Path(__file__).resolve().parent)

    try:
        timeout_s = int(args.get("timeout_seconds") or DEFAULT_TIMEOUT_S)
    except (TypeError, ValueError):
        return _error_result("invalid_arguments", "timeout_seconds must be an integer")
    timeout_s = max(30, min(timeout_s, MAX_TIMEOUT_S))

    model = str(args.get("model") or "").strip()
    effort = str(args.get("effort") or "").strip()
    add_dirs = _normalize_extra_args(args.get("add_dir"))

    base_args = [*READ_ONLY_FLAGS, JSON_FLAG, "json"]
    if model:
        base_args.extend(["--model", model])
    if effort:
        base_args.extend(["--effort", effort])
    for directory in add_dirs:
        base_args.extend(["--add-dir", directory])

    # 守卫段随首轮 prompt 一起下发，明确告知「非交互调用没有人能点 Proceed」。
    try:
        meta = run_agy(
            ["-p", f"{prompt}\n{GUARDRAILS}", *base_args],
            cwd=effective_cwd,
            timeout_s=timeout_s,
        )
    except FileNotFoundError:
        return _error_result("agy_not_found", "agy executable not found; set AGY_BIN")
    except OSError as exc:
        return _error_result("agy_spawn_failed", str(exc))

    exit_code = meta["exitCode"]
    envelope = parse_envelope(meta["stdout"])
    conversation_id = str(envelope.get("conversation_id") or "").strip() or None
    text = extract_response_text(meta["stdout"])
    continuations = 0

    # plan-and-wait 兜底：即便带了守卫段，agy 仍可能概率性地停下来等人批准。
    # 用同一个 conversation 有界续跑一次；成功才覆盖首轮产物，失败保留原文。
    if (
        exit_code == 0
        and looks_like_plan_wait(text)
        and conversation_id is not None
        and MAX_CONTINUATIONS > 0
    ):
        log(f"plan-and-wait detected; resuming conversation={conversation_id}")
        try:
            resumed = run_agy(
                ["-p", RESUME_PROMPT, *base_args, "--conversation", conversation_id],
                cwd=effective_cwd,
                timeout_s=timeout_s,
            )
        except (FileNotFoundError, OSError) as exc:
            log(f"continuation spawn failed: {exc}")
            resumed = None
        if resumed is not None and resumed["exitCode"] == 0:
            resumed_text = extract_response_text(resumed["stdout"])
            if resumed_text and not looks_like_plan_wait(resumed_text):
                text = resumed_text
                meta = {
                    **resumed,
                    "durationS": round(meta["durationS"] + resumed["durationS"], 2),
                }
                exit_code = 0
                continuations = 1
        if continuations == 0:
            log("continuation did not yield a final deliverable; keeping first-round text")

    plan_wait = looks_like_plan_wait(text)
    context: dict[str, Any] = {
        "kind": "research",
        "model": model or "default",
        "effort": effort or "default",
        "cwd": effective_cwd,
        "durationS": meta["durationS"],
        "readOnly": True,
        "planWait": plan_wait,
        "continuations": continuations,
    }

    if exit_code == 0 and text:
        structured = {**context, "text": text}
        return _text_result(text, structured)

    if exit_code == 0 and not text:
        raw = meta["stdout"].strip()
        if raw:
            structured = {**context, "text": raw, "parsed": False}
            return _text_result(raw, structured)
        return _error_result("empty_output", "agy completed with no output")

    return _error_result("agy_failed", short_failure(meta))


def tool_list_models(_args: dict[str, Any]) -> dict[str, Any]:
    """List agy's available models (local call, no quota consumed)."""
    try:
        meta = run_agy(["models"], cwd=str(Path(__file__).resolve().parent), timeout_s=120)
    except FileNotFoundError:
        return _error_result("agy_not_found", "agy executable not found; set AGY_BIN")
    except OSError as exc:
        return _error_result("agy_spawn_failed", str(exc))

    if meta["exitCode"] != 0:
        return _error_result("agy_failed", short_failure(meta))

    lines = [
        line.strip()
        for line in meta["stdout"].splitlines()
        if line.strip() and not line.lower().startswith("fetching")
    ]
    if not lines:
        return _error_result("empty_output", "agy models produced no output")
    models: list[dict[str, str]] = []
    for line in lines:
        if "\t" in line:
            model_id, _, label = line.partition("\t")
            models.append({"id": model_id.strip(), "label": label.strip()})
        else:
            models.append({"id": line, "label": line})
    body = "\n".join(f"{m['id']} - {m['label']}" for m in models)
    return _text_result(body, {"kind": "models", "models": models})


# ---------------------------------------------------------------------------
# MCP result helpers
# ---------------------------------------------------------------------------


def _text_result(text: str, structured: dict[str, Any]) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": text}],
        "structuredContent": structured,
        "isError": False,
    }


def _error_result(code: str, message: str) -> dict[str, Any]:
    payload = {"error": code, "message": message[:4000]}
    return {
        "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
        "structuredContent": payload,
        "isError": True,
    }


# ---------------------------------------------------------------------------
# MCP tool catalog
# ---------------------------------------------------------------------------

TOOLS: list[dict[str, Any]] = [
    {
        "name": "research",
        "description": (
            "Delegate a read-only research, code-audit, or bug-diagnosis task to the "
            "host's Antigravity (agy) agent and return its final analysis text. The "
            "delegation is pinned to a safe read-only shape: agy --sandbox --mode plan; "
            "it can read files and inspect the workspace but cannot write, edit, run "
            "mutating commands, or change system state. A non-interactive guardrail is "
            "appended automatically so agy delivers the answer in the same turn instead "
            "of waiting for plan approval, plus one bounded continuation if it still "
            "stops to ask. Use it for deep dives that should not consume the calling "
            "agent's context."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "The full task, question, or audit request for agy.",
                },
                "cwd": {
                    "type": "string",
                    "description": (
                        "Absolute working directory for the agy run (its workspace root "
                        "for file reading). Defaults to the bridge's directory."
                    ),
                },
                "model": {
                    "type": "string",
                    "description": "Optional agy model id; omit to use agy's default.",
                },
                "effort": {
                    "type": "string",
                    "enum": ["low", "medium", "high", "xhigh", "max"],
                    "description": "Optional reasoning effort; omit to use agy's default.",
                },
                "add_dir": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional extra directories to expose to agy (repeatable).",
                },
                "timeout_seconds": {
                    "type": "integer",
                    "description": (
                        f"Hard timeout for this run (default {DEFAULT_TIMEOUT_S}s, "
                        f"max {MAX_TIMEOUT_S}s)."
                    ),
                },
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "list_models",
        "description": (
            "List the model ids currently available to the host's agy installation. "
            "Useful for choosing the optional 'model' argument of the research tool."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
]

TOOL_HANDLERS = {"research": tool_research, "list_models": tool_list_models}


# ---------------------------------------------------------------------------
# JSON-RPC / MCP stdio loop
# ---------------------------------------------------------------------------

_stdout_lock = threading.Lock()


def send_message(message: dict[str, Any]) -> None:
    """Write one NDJSON frame (one JSON object per line).

    The official MCP SDK v2 stdio transport serializes with
    ``JSON.stringify(message) + "\\n"`` and parses by splitting on newlines, so
    newline delimiting is the contract; Content-Length headers are NOT read.
    """
    line = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with _stdout_lock:
        sys.stdout.buffer.write(line + b"\n")
        sys.stdout.buffer.flush()


def read_message(stream: Any) -> bytes | None:
    """Read one framed message: Content-Length headers or a raw JSON line."""
    line = stream.readline()
    if not line:
        return None
    stripped = line.strip()
    if not stripped:
        return read_message(stream)

    if stripped.lower().startswith(b"content-length:"):
        try:
            length = int(stripped.split(b":", 1)[1].strip())
        except ValueError:
            return read_message(stream)
        while True:
            header = stream.readline()
            if not header or header.strip() == b"":
                break
        body = stream.read(length)
        return body

    return stripped


def handle_request(message: dict[str, Any]) -> dict[str, Any] | None:
    method = message.get("method")
    request_id = message.get("id")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION_FALLBACK,
                "capabilities": {"tools": {"listChanged": False}, "logging": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            },
        }

    if method in ("notifications/initialized", "initialized"):
        return None
    if method and method.startswith("notifications/"):
        return None

    if method == "ping":
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}}

    if method == "tools/call":
        params = message.get("params") or {}
        name = params.get("name")
        arguments = params.get("arguments") or {}
        handler = TOOL_HANDLERS.get(str(name))
        if handler is None:
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32602, "message": f"unknown tool: {name}"},
            }
        try:
            result = handler(arguments if isinstance(arguments, dict) else {})
        except Exception as exc:
            result = _error_result("bridge_internal_error", f"{type(exc).__name__}: {exc}")
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": -32601, "message": f"method not found: {method}"},
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass

    agy = find_agy()
    log(f"starting {SERVER_NAME} {SERVER_VERSION}; agy={'found' if agy else 'NOT FOUND'}")

    stream = sys.stdin.buffer
    while True:
        body = read_message(stream)
        if body is None:
            log("stdin closed; shutting down")
            return 0
        try:
            message = json.loads(body.decode("utf-8"))
        except Exception as exc:
            log(f"invalid frame: {exc}")
            continue
        response = handle_request(message)
        if response is not None:
            send_message(response)


if __name__ == "__main__":
    raise SystemExit(main())
