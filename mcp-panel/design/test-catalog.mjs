/**
 * Offline checks for the mcp-panel bundle: host-half catalog collection
 * (through a fake ctx + captured route handler) and the client-half pure
 * helpers (through a stubbed module loader). Run: node design/test-catalog.mjs
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.exitCode = 1;

//#region host half
const { apply, __test: hostTest } = await import('../index.js');
assert.ok(hostTest, 'host __test exports present');

const routes = new Map();
const mockEntries = [
  {
    options: {
      id: 'mcp-argo',
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        serverName: 'argo',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'github:taxueseek/argo'],
        env: { A: '1', B: '2' },
        toolCallTimeoutMs: 60000
      }
    },
    disabled: false,
    updateCalls: [],
    async update(opts) {
      this.updateCalls.push(opts);
      if (typeof opts.disabled === 'boolean') this.disabled = opts.disabled;
    }
  },
  {
    options: {
      id: 'mcp-everything',
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        serverName: 'everything',
        transport: 'stdio',
        command: 'uvx',
        args: ['everything-mcp'],
        reconnect: { enabled: false }
      }
    },
    disabled: false,
    updateCalls: [],
    async update(opts) {
      this.updateCalls.push(opts);
      if (typeof opts.disabled === 'boolean') this.disabled = opts.disabled;
    }
  },
  {
    options: { id: 'unrelated', name: '@deepseek-ai/dsh-web', config: {} },
    disabled: false,
    async update() {}
  }
];

const ctx = {
  effect(fn) { fn(); },
  webServer: {
    register: (r) => {
      routes.set(r.path, r);
      return () => { routes.delete(r.path); };
    }
  },
  loader: {
    entries: () => mockEntries
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
assert.equal(routes.has('/plugin/mcp-panel/catalog'), true);
assert.equal(routes.has('/plugin/mcp-panel/toggle'), true);
assert.equal(routes.has('/plugin/mcp-panel/restart-server'), true);

const catalogRoute = routes.get('/plugin/mcp-panel/catalog');
assert.equal(catalogRoute.kind, 'exact');

/** Node-style response capture helper. */
function callHandler(handler, req) {
  return new Promise((resolve) => {
    let resolved = false;
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(payload) {
        this.writableEnded = true;
        if (!resolved) {
          resolved = true;
          let parsed = payload;
          try { parsed = JSON.parse(payload); } catch {}
          resolve({ status: this.status, payload: parsed });
        }
      }
    };
    handler(req, res).catch((err) => {
      if (!resolved) {
        resolved = true;
        resolve({ status: 500, error: err });
      }
    });
  });
}

function createStreamReq(method, headers, bodyObj) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers || {};
  process.nextTick(() => {
    if (bodyObj !== undefined) {
      req.emit('data', JSON.stringify(bodyObj));
    }
    req.emit('end');
  });
  return req;
}

// 1. GET catalog
const catRes = await callHandler(catalogRoute.handler, { method: 'GET' });
assert.equal(catRes.status, 200);
assert.equal(catRes.payload.ok, true);
assert.equal(typeof catRes.payload.hostPid, 'number');
assert.equal(typeof catRes.payload.memoryProbed, 'boolean');
assert.equal(catRes.payload.servers.length, 2);

const argo = catRes.payload.servers.find((s) => s.serverName === 'argo');
assert.equal(argo.transport, 'stdio');
assert.equal(argo.command, 'npx');
assert.equal(argo.disabled, false);
assert.equal(argo.envCount, 2);
assert.equal(argo.toolCallTimeoutMs, 60000);
assert.equal(argo.reconnect.enabled, true);
assert.equal(argo.reconnect.maxAttempts, 10);
assert.deepEqual(argo.tools.map((t) => t.name), ['mcp__argo__argo_fetch', 'mcp__argo__argo_search']);
assert.equal(argo.tools[1].params, 2);
assert.equal(argo.tools[1].required, 1);

const everything = catRes.payload.servers.find((s) => s.serverName === 'everything');
assert.equal(everything.tools.length, 0);
assert.equal(everything.disabled, false);
assert.equal(everything.reconnect.enabled, false);
assert.ok(catRes.payload.servers.indexOf(argo) < catRes.payload.servers.indexOf(everything), 'tools-bearing servers sort first');

// Method guard
const postCat = await callHandler(catalogRoute.handler, { method: 'POST' });
assert.equal(postCat.status, 405);

// 2. POST toggle route
const toggleRoute = routes.get('/plugin/mcp-panel/toggle');
const toggleRes = await callHandler(
  toggleRoute.handler,
  createStreamReq('POST', {}, { entryId: 'mcp-argo', enabled: false })
);
assert.equal(toggleRes.status, 200);
assert.equal(toggleRes.payload.ok, true);
assert.equal(toggleRes.payload.entryId, 'mcp-argo');
assert.equal(toggleRes.payload.enabled, false);
assert.equal(mockEntries[0].disabled, true);

// 3. POST restart-server route
const restartRoute = routes.get('/plugin/mcp-panel/restart-server');
const restartRes = await callHandler(
  restartRoute.handler,
  createStreamReq('POST', {}, { entryId: 'mcp-argo' })
);
assert.equal(restartRes.status, 200);
assert.equal(restartRes.payload.ok, true);
assert.equal(restartRes.payload.status, 'restarted');
assert.equal(mockEntries[0].disabled, false);

// 4. YAML persistence helper unit test
const sampleYaml = [
  '# comment 1',
  '- insert:',
  '    - id: mcp-test',
  '      name: \'@deepseek-ai/dsh-mcp-client\'',
  '      config:',
  '        serverName: test',
  '        command: node'
].join('\n');
const patched1 = hostTest.updateYamlEntryDisabled(sampleYaml, 'mcp-test', true);
assert.equal(patched1.changed, true);
assert.ok(patched1.content.includes('disabled: true'));
const patched2 = hostTest.updateYamlEntryDisabled(patched1.content, 'mcp-test', false);
assert.equal(patched2.changed, true);
assert.ok(!patched2.content.includes('disabled: true'));

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
  return {
    createElement: (...args) => args,
    useState: (v) => [v, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn
  };
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

// Regression: servers sharing one command (`node.exe`) must not sum one
// another's subtrees — each row counts only its own wrapper chain.
const procs2 = [
  { ProcessId: 100, ParentProcessId: 1, WorkingSetSize: 500 * MB, ExecutablePath: 'C:\\x\\node.exe', CommandLine: 'node host-runtime.js' },
  { ProcessId: 210, ParentProcessId: 100, WorkingSetSize: 140 * MB, ExecutablePath: 'C:\\x\\node.exe', CommandLine: 'D:\\x\\node.exe D:\\x\\chrome-devtools-mcp\\build\\bin\\chrome-devtools-mcp.js' },
  { ProcessId: 220, ParentProcessId: 100, WorkingSetSize: 60 * MB, ExecutablePath: 'C:\\x\\node.exe', CommandLine: 'D:\\x\\node.exe D:\\Users\\dsh-local-plugins\\agy-bridge\\bin\\launch.mjs' },
  { ProcessId: 221, ParentProcessId: 220, WorkingSetSize: 17 * MB, ExecutablePath: 'C:\\x\\python.exe', CommandLine: 'python agy_bridge_server.py' },
  { ProcessId: 230, ParentProcessId: 100, WorkingSetSize: 66 * MB, ExecutablePath: 'C:\\x\\node.exe', CommandLine: 'node unrelated-service.js' }
];
const descendants2 = hostTest.descendantProcesses(procs2, 100);
const cdMem = hostTest.serverMemoryFootprint(descendants2, { command: 'D:\\x\\node.exe', args: ['D:\\x\\chrome-devtools-mcp\\build\\bin\\chrome-devtools-mcp.js'] });
assert.equal(cdMem.processes, 1, 'chrome-devtools counts only its own wrapper');
assert.equal(cdMem.bytes, 140 * MB);
const agyMem = hostTest.serverMemoryFootprint(descendants2, { command: 'D:\\x\\node.exe', args: ['D:\\Users\\dsh-local-plugins\\agy-bridge\\bin\\launch.mjs'] });
assert.equal(agyMem.processes, 2, 'agy wrapper + its python child');
assert.equal(agyMem.bytes, 77 * MB);
assert.notEqual(cdMem.bytes, agyMem.bytes, 'same-command servers never share one union');

assert.equal(hostTest.serverMemoryFootprint(descendants, { command: 'missing-tool.exe', args: [] }), undefined);
assert.equal(hostTest.basenameOf('C:\\A\\B\\tool.EXE'), 'tool.exe');
console.log('process footprint OK');
//#endregion

process.exitCode = 0;
