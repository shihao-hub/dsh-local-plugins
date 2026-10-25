/**
 * Host half of the session-tag-lite bundle: durable tag state behind one
 * same-origin route.
 *
 * The Client keeps its localStorage copy for instant rendering and falls back to
 * it when this route is absent (desktop builds without a web server). When the
 * route exists it is the source of truth: the Client pulls once at boot and
 * pushes after every change, so tags survive a browser switch, cleared site
 * data, or another browser profile.
 *
 * The store is one JSON document under `$DSH_HOME/session-tag-lite/state.json`
 * (defaults to `~/.dsh/session-tag-lite/state.json`). Writes go through a
 * temp-file rename, so a crash mid-write never leaves a half document.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROUTE_PATH = '/plugins/session-tag-lite/state';
const GUARD_HEADER = 'x-session-tag-lite';
const MAX_BODY_BYTES = 1024 * 1024;
const STORE_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'session-tag-lite');
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

/** Serialize writes: one persist at a time, temp file then rename. */
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

/** Same-origin requests only; the custom header also blocks cross-site form posts. */
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
    'session-tag-lite: durable state route'
  );
}
