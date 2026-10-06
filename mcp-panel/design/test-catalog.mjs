/**
 * Offline checks for the mcp-panel bundle: host-half catalog collection
 * (through a fake ctx + captured route handler) and the client-half pure
 * helpers (through a stubbed module loader). Run: node design/test-catalog.mjs
 */
import assert from 'node:assert/strict';

process.exitCode = 1;

//#region host half
const { apply, __test: hostTest } = await import('../index.js');
assert.ok(hostTest, 'host __test exports present');

let route;
const ctx = {
  effect(fn) { fn(); },
  webServer: { register: (r) => { route = r; return () => {}; } },
  loader: {
    entries: () => [
      { options: { id: 'mcp-argo', name: '@deepseek-ai/dsh-mcp-client', config: {
        serverName: 'argo', transport: 'stdio', command: 'npx', args: ['-y', 'github:taxueseek/argo'],
        env: { A: '1', B: '2' }, toolCallTimeoutMs: 60000
      } } },
      { options: { id: 'mcp-everything', name: '@deepseek-ai/dsh-mcp-client', config: {
        serverName: 'everything', transport: 'stdio', command: 'uvx', args: ['everything-mcp'], reconnect: { enabled: false }
      } } },
      { options: { id: 'unrelated', name: '@deepseek-ai/dsh-web', config: {} } }
    ]
  },
  tools: {
    schemas: () => [
      { name: 'mcp__argo__argo_search', description: '统一网络搜索', parameters: { type: 'object', properties: { query: { type: 'string' }, depth: { type: 'string' } }, required: ['query'] } },
      { name: 'mcp__argo__argo_fetch', description: '智能页面抓取', parameters: { type: 'object', properties: { url: { type: 'string' } } } },
      { name: 'read', description: 'not mcp', parameters: {} }
    ]
  }
};

apply(ctx);
assert.equal(route.path, '/plugin/mcp-panel/catalog');
assert.equal(route.kind, 'exact');

/** Node-style response capture. */
function fakeRes() {
  return new Promise((resolve) => {
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(payload) { this.writableEnded = true; resolve({ status: this.status, payload: JSON.parse(payload) }); }
    };
    resolve.res = res;
  });
}

let settle;
const done = new Promise((resolve) => { settle = resolve; });
const res = {
  headersSent: false,
  writableEnded: false,
  writeHead(status) { this.status = status; },
  end(payload) { this.writableEnded = true; settle({ status: this.status, payload: JSON.parse(payload) }); }
};
await route.handler({ method: 'GET' }, res);
const { status, payload } = await done;
assert.equal(status, 200);
assert.equal(payload.ok, true);
assert.equal(typeof payload.hostPid, 'number');
assert.equal(typeof payload.memoryProbed, 'boolean');
assert.equal(payload.servers.length, 2);

const argo = payload.servers.find((s) => s.serverName === 'argo');
assert.equal(argo.transport, 'stdio');
assert.equal(argo.command, 'npx');
assert.equal(argo.envCount, 2);
assert.equal(argo.toolCallTimeoutMs, 60000);
assert.equal(argo.reconnect.enabled, true);
assert.equal(argo.reconnect.maxAttempts, 10);
assert.deepEqual(argo.tools.map((t) => t.name), ['mcp__argo__argo_fetch', 'mcp__argo__argo_search']);
assert.equal(argo.tools[1].params, 2);
assert.equal(argo.tools[1].required, 1);

const everything = payload.servers.find((s) => s.serverName === 'everything');
assert.equal(everything.tools.length, 0);
assert.equal(everything.reconnect.enabled, false);
assert.ok(payload.servers.indexOf(argo) < payload.servers.indexOf(everything), 'tools-bearing servers sort first');

// POST is refused
const post = await new Promise((resolve) => {
  const r2 = { headersSent: false, writableEnded: false, writeHead(s) { this.status = s; }, end(p) { resolve({ status: this.status, body: p }); } };
  route.handler({ method: 'POST' }, r2);
});
assert.equal(post.status, 405);
console.log('host half OK');
//#endregion

//#region client half pure helpers
const captured = [];
globalThis.window = { __ModuleLoader__: { load(reg) { captured.push(reg); } } };
await import('../client.js');
const registration = captured[0];
assert.equal(registration.id, '@local/mcp-panel');
const plugin = registration.factory((spec) => {
  assert.equal(spec, 'react');
  return { createElement: (...args) => args };
});
assert.deepEqual(plugin.inject, ['slots', 'locale']);
assert.equal(typeof plugin.apply, 'function');

const t = plugin.__test;
const server = {
  serverName: 'argo', entryId: 'mcp-argo', transport: 'stdio',
  command: 'npx', args: ['-y', 'github:taxueseek/argo'], url: undefined,
  tools: [
    { name: 'mcp__argo__argo_search', description: '统一网络搜索', params: 4, required: 1 },
    { name: 'mcp__argo__argo_fetch', description: '智能页面抓取', params: 1, required: 1 }
  ]
};
assert.equal(t.endpointOf(server), 'npx -y github:taxueseek/argo');
assert.equal(t.endpointOf({ ...server, transport: 'streamable-http', url: 'http://x/y' }), 'http://x/y');
assert.equal(t.shortToolName('mcp__argo__argo_search', 'argo'), 'argo_search');
assert.equal(t.matchesQuery(server, 'argo_fetch'), true);
assert.equal(t.matchesQuery(server, '页面抓取'), true);
assert.equal(t.matchesQuery(server, 'zzz'), false);
assert.equal(t.filterServerTools(server, 'fetch').length, 1);
assert.equal(t.filterServerTools(server, '').length, 2);
assert.equal(t.formatBytes(46.6 * 1024 * 1024), '46.6 MB');
assert.equal(t.formatBytes(96 * 1024 * 1024), '96.0 MB');
assert.equal(t.formatBytes(1.5 * 1024 * 1024 * 1024), '1.50 GB');
assert.equal(t.formatBytes(512 * 1024), '512 KB');
assert.equal(t.formatBytes(undefined), undefined);
console.log('client half OK');
//#endregion

//#region process footprint matching
// Synthetic tree mirroring a real desktop: the Host runtime (pid 100) owns
// our MCP children; an unrelated opencode.exe (pid 999) owns SAME-NAMED
// copies that must never count.
const MB = 1024 * 1024;
const procs = [
  { ProcessId: 100, ParentProcessId: 1, WorkingSetSize: 500 * MB, ExecutablePath: 'C:\\x\\node.exe', CommandLine: 'node host-runtime.js' },
  // our aoci server (direct child of the host)
  { ProcessId: 200, ParentProcessId: 100, WorkingSetSize: 39.6 * MB, ExecutablePath: 'C:\\Users\\x\\aoci\\aoci.exe', CommandLine: '"C:\\Users\\x\\aoci\\aoci.exe" --repo D:\\Users\\language_projects mcp' },
  // opencode's copy of aoci — different tree, must be excluded
  { ProcessId: 300, ParentProcessId: 999, WorkingSetSize: 40 * MB, ExecutablePath: 'C:\\Users\\x\\aoci\\aoci.exe', CommandLine: 'aoci.exe --repo D:\\Users\\language_projects mcp' },
  // our uvx launcher + its python child
  { ProcessId: 400, ParentProcessId: 100, WorkingSetSize: 96 * MB, ExecutablePath: 'C:\\x\\uvx.exe', CommandLine: 'uvx everything-mcp' },
  { ProcessId: 500, ParentProcessId: 400, WorkingSetSize: 30 * MB, ExecutablePath: 'C:\\x\\venv\\python.exe', CommandLine: 'python -c "everything"' },
  // our argo chain: npx → cmd → node → node
  { ProcessId: 600, ParentProcessId: 100, WorkingSetSize: 8 * MB, ExecutablePath: 'C:\\Windows\\cmd.exe', CommandLine: 'cmd.exe /c npx -y github:taxueseek/argo' },
  { ProcessId: 601, ParentProcessId: 600, WorkingSetSize: 20 * MB, ExecutablePath: 'C:\\x\\node.exe', CommandLine: 'node npx-cli.js -y github:taxueseek/argo' },
  { ProcessId: 602, ParentProcessId: 601, WorkingSetSize: 25 * MB, ExecutablePath: 'C:\\x\\node.exe', CommandLine: 'node argo.js' },
  // unrelated host child (some other tool of the runtime)
  { ProcessId: 700, ParentProcessId: 100, WorkingSetSize: 10 * MB, ExecutablePath: 'C:\\x\\other.exe', CommandLine: 'other.exe --everything-mcp-lookalike' }
];
const descendants = hostTest.descendantProcesses(procs, 100);
assert.deepEqual(
  descendants.map((p) => p.ProcessId).sort((a, b) => a - b),
  [200, 400, 500, 600, 601, 602, 700]
);

const aociMem = hostTest.serverMemoryFootprint(descendants, { command: 'C:\\Users\\x\\aoci\\aoci.exe', args: ['--repo', 'D:\\Users\\language_projects', 'mcp'] });
assert.equal(aociMem.processes, 1, 'opencode aoci excluded');
assert.equal(aociMem.bytes, 39.6 * MB);

const everythingMem = hostTest.serverMemoryFootprint(descendants, { command: 'uvx', args: ['everything-mcp'] });
assert.equal(everythingMem.processes, 2, 'uvx + python subtree');
assert.equal(everythingMem.bytes, 126 * MB);

const argoMem = hostTest.serverMemoryFootprint(descendants, { command: 'npx', args: ['-y', 'github:taxueseek/argo'] });
assert.equal(argoMem.processes, 3, 'npx chain');
assert.equal(argoMem.bytes, 53 * MB);

assert.equal(hostTest.serverMemoryFootprint(descendants, { command: 'missing-tool.exe', args: [] }), undefined);
assert.equal(hostTest.basenameOf('C:\\A\\B\\tool.EXE'), 'tool.exe');
console.log('process footprint OK');
//#endregion

process.exitCode = 0;
