// agy-bridge launcher: direct entry point for the Python stdio MCP server.
//
// Per kb-engineering-notes 56 (DSH MCP npx/uvx wrapper-layer memory guide):
// wrapper layers hold the child's stdio for their whole lifetime, so a `uv run`
// wrapper is a permanent ~40 MB resident. The server is pure-standard-library
// (PEP 723 header, zero third-party deps), so no package resolution is needed:
// this launcher resolves a python.exe directly and spawns it, collapsing the
// chain from `node -> uv -> python -> python` to `node -> python`.
import { spawn } from 'node:child_process';
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

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill();
  });
}
