/**
 * Host 半区：把「会话标识」（sessionId → 短代号）落盘到
 * `$DSH_HOME/session-workspace-label/state.json`，只暴露一条同源路由。
 *
 * Client 半区仍以 localStorage 为首屏数据源；这条路由存在时它才是权威：
 * 启动拉取一次、每次改动后整份推送。这样换浏览器、清站点数据都不会丢标识。
 * 路由不可用（桌面构建没有 webServer，或 GET 非 2xx）时 Client 静默退回
 * localStorage 单机模式，行为不变。
 *
 * 写入走临时文件 + rename，崩在写一半也不会留下半截文档。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROUTE_PATH = '/plugins/session-workspace-label/state';
const GUARD_HEADER = 'x-session-workspace-label';
const MAX_BODY_BYTES = 1024 * 1024;
const STORE_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'session-workspace-label');
const STORE_FILE = join(STORE_DIR, 'state.json');

let loaded = false;
let snapshot = null;
let revision = 0;
let queue = Promise.resolve();

async function ensureLoaded() {
  if (loaded) return snapshot;
  loaded = true;
  try {
    const parsed = JSON.parse(await readFile(STORE_FILE, 'utf8'));
    if (parsed !== null && typeof parsed === 'object' && parsed.data !== undefined) {
      snapshot = parsed.data;
      revision = Number(parsed.revision) || 0;
    }
  } catch {
    snapshot = null;
  }
  return snapshot;
}

/** 串行写入：同一时刻只有一个 persist，先写临时文件再 rename。 */
function persist(next) {
  queue = queue.then(async function () {
    await mkdir(STORE_DIR, { recursive: true });
    const body = JSON.stringify({ revision: revision + 1, data: next });
    const temp = STORE_FILE + '.tmp';
    await writeFile(temp, body, 'utf8');
    await rename(temp, STORE_FILE);
    revision += 1;
    snapshot = next;
  });
  return queue;
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

/** 只接受同源请求；自定义头顺带挡住跨站表单提交。 */
function admitted(req) {
  if (req.headers[GUARD_HEADER] === undefined) return false;
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '') return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handle(req, res) {
  try {
    if (!admitted(req)) {
      send(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    if (req.method === 'GET') {
      const data = await ensureLoaded();
      send(res, 200, { ok: true, revision: revision, data: data });
      return;
    }
    if (req.method === 'PUT') {
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        send(res, 400, { ok: false, error: 'invalid-json' });
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || parsed.data === undefined) {
        send(res, 400, { ok: false, error: 'invalid-payload' });
        return;
      }
      await persist(parsed.data);
      send(res, 200, { ok: true, revision: revision });
      return;
    }
    res.writeHead(405, { allow: 'GET, PUT' });
    res.end();
  } catch (error) {
    send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

export const inject = ['webServer'];

export function apply(ctx) {
  void ensureLoaded();
  ctx.effect(
    function () {
      return ctx.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler: handle });
    },
    'session-workspace-label: durable alias route'
  );
}
