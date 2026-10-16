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

    command_args = ["-p", prompt, *READ_ONLY_FLAGS, JSON_FLAG, "json"]
    if model:
        command_args.extend(["--model", model])
    if effort:
        command_args.extend(["--effort", effort])
    for directory in add_dirs:
        command_args.extend(["--add-dir", directory])

    try:
        meta = run_agy(command_args, cwd=effective_cwd, timeout_s=timeout_s)
    except FileNotFoundError:
        return _error_result("agy_not_found", "agy executable not found; set AGY_BIN")
    except OSError as exc:
        return _error_result("agy_spawn_failed", str(exc))

    exit_code = meta["exitCode"]
    text = extract_response_text(meta["stdout"])

    if exit_code == 0 and text:
        structured = {
            "kind": "research",
            "text": text,
            "model": model or "default",
            "effort": effort or "default",
            "cwd": effective_cwd,
            "durationS": meta["durationS"],
            "readOnly": True,
        }
        return _text_result(text, structured)

    if exit_code == 0 and not text:
        raw = meta["stdout"].strip()
        if raw:
            structured = {
                "kind": "research",
                "text": raw,
                "model": model or "default",
                "effort": effort or "default",
                "cwd": effective_cwd,
                "durationS": meta["durationS"],
                "readOnly": True,
                "parsed": False,
            }
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
            "mutating commands, or change system state. Use it for deep dives that "
            "should not consume the calling agent's context."
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
