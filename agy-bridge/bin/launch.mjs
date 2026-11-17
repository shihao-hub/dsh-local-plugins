// agy-bridge launcher: direct entry point for the Python stdio MCP server.
//
// Per kb-engineering-notes 56 (DSH MCP npx/uvx wrapper-layer memory guide):
// wrapper layers hold the child's stdio for their whole lifetime, so a `uv run`
// wrapper is a permanent ~40 MB resident. The server is pure-standard-library
// (PEP 723 header, zero third-party deps), so no package resolution is needed:
// this launcher resolves a python.exe directly and spawns it, collapsing the
// chain from `node -> uv -> python -> python` to `node -> python`.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, '..', 'server', 'agy_bridge_server.py');

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function uvManagedPythons() {
  const root = join(process.env.APPDATA ?? '', 'uv', 'python');
  try {
    return readdirSync(root)
      .filter((name) => name.startsWith('cpython-'))
      .sort()
      .reverse()
      .map((name) => join(root, name, 'python.exe'));
  } catch {
    return [];
  }
}

const python =
  firstExisting([process.env.AGY_BRIDGE_PYTHON]) ??
  firstExisting(uvManagedPythons()) ??
  firstExisting([
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python312', 'python.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python311', 'python.exe'),
  ]) ??
  'python';

const child = spawn(python, [server], {
  stdio: 'inherit',
  windowsHide: true,
});

child.on('error', (error) => {
  process.stderr.write(`[agy-bridge] failed to start python (${python}): ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    // Windows 上 child.kill() 只终止直接子进程，agy 派生的 powershell/python
    // 孙进程会逃逸；taskkill /T /F 连坐回收。它与 server/win_job.py 的
    // Job Object 形成两层保护（Job 兜底崩溃，taskkill 即时响应信号）。
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    killTree(child.pid);
    process.exit(0);
  });
}

process.on('exit', () => {
  if (child.exitCode === null) killTree(child.pid);
});
