/**
 * Host half of the fork-turns bundle.
 *
 * The stock fork (`ctx.sessions.fork`) only copies one contiguous event
 * prefix, so "keep turns 1, 3 and 5" needs its own seed. This module reads one
 * Session log, hands the selection to `turns.js`, and creates the child through
 * the same Agent factory the stock fork uses, then attaches it to the source
 * Workspace and gives it a recognizable title.
 *
 * Transport: three same-origin routes on the Host web server. `turns` feeds the
 * picker, `preview` constructs and validates a seed without publishing
 * anything, and `fork` creates the child. Every route requires the custom
 * `x-fork-turns` header and a same-origin `Origin` when the browser sends one.
 *
 * Only `webServer` is a hard dependency. Session/agent capabilities are read
 * through `ctx.get()` so a deployment without them loads this bundle and
 * answers `capability-missing` instead of failing activation.
 */
import { randomUUID } from 'node:crypto';

import { ForkTurnsError, buildSelectedSeed, summarizeTurns } from './turns.js';

const ROUTE_PREFIX = '/plugins/fork-turns';
const GUARD_HEADER = 'x-fork-turns';
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {unknown} payload - JSON value.
 * @returns {void}
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Whether a request may reach this plugin's routes. The custom header blocks
 * cross-site form posts; a browser `Origin` must match the serving host.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {boolean} admission decision.
 */
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

/**
 * Read a bounded request body.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {Promise<string>} UTF-8 body.
 * @throws {ForkTurnsError} when the body is too large or unreadable.
 */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ForkTurnsError('invalid-json', '请求体过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Parse a JSON object body.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {Promise<Record<string, unknown>>} parsed body.
 * @throws {ForkTurnsError} on malformed JSON or a non-object payload.
 */
async function readJson(req) {
  const raw = await readBody(req);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ForkTurnsError('invalid-json', '请求体不是合法 JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ForkTurnsError('invalid-json', '请求体必须是 JSON 对象');
  }
  return parsed;
}

/**
 * Map one error to its HTTP status.
 * @param {ForkTurnsError} error - failure.
 * @returns {number} status code.
 */
function statusOf(error) {
  switch (error.code) {
    case 'invalid-json':
    case 'invalid-turns':
    case 'invalid-session':
      return 400;
    case 'session-not-found':
    case 'turn-not-found':
      return 404;
    case 'turn-open':
    case 'no-user-message':
    case 'no-completed-turn':
      return 409;
    case 'capability-missing':
      return 501;
    default:
      return 500;
  }
}

/**
 * Report one failure without leaking a stack.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {unknown} error - failure.
 * @returns {void}
 */
function fail(res, error) {
  const known = error instanceof ForkTurnsError
    ? error
    : new ForkTurnsError('internal', error instanceof Error ? error.message : String(error));
  sendJson(res, statusOf(known), { ok: false, error: { code: known.code, message: known.message } });
}

/**
 * Require one Host service or fail with `capability-missing`.
 * @param {any} ctx - plugin context.
 * @param {string} name - Service key.
 * @returns {any} live service.
 * @throws {ForkTurnsError} when the service is absent.
 */
function requireService(ctx, name) {
  const service = ctx.get(name);
  if (service === undefined || service === null) {
    throw new ForkTurnsError('capability-missing', `当前部署没有 ${name} 服务`);
  }
  return service;
}

/**
 * Read one complete Session log and release the observation lease.
 * @param {any} ctx - plugin context.
 * @param {unknown} sessionId - caller-supplied identity.
 * @returns {Promise<{ header: any, events: readonly any[], projections: any }>} log view.
 */
async function readSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new ForkTurnsError('invalid-session', '缺少 sessionId');
  }
  const query = requireService(ctx, 'sessionQuery');
  let observation;
  try {
    observation = await query.observeSession(sessionId, { projectionMode: 'all' });
  } catch (error) {
    if (error instanceof ForkTurnsError) throw error;
    if (error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
      throw new ForkTurnsError('session-not-found', `会话 ${sessionId} 不存在`);
    }
    throw new ForkTurnsError('internal', `读取会话失败：${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return {
      header: observation.header,
      events: observation.events,
      projections: observation.projections,
    };
  } finally {
    try {
      observation[Symbol.dispose]();
    } catch {
      /* the lease is already released */
    }
  }
}

/**
 * Read the latest title of one Session, or an empty string.
 * @param {any} ctx - plugin context.
 * @param {string} sessionId - Session identity.
 * @returns {Promise<string>} title text.
 */
async function readTitle(ctx, sessionId) {
  const query = ctx.get('sessionQuery');
  if (query === undefined || typeof query.readTitle !== 'function') return '';
  try {
    const snapshot = await query.readTitle(sessionId);
    return typeof snapshot?.title === 'string' ? snapshot.title : '';
  } catch {
    return '';
  }
}

/**
 * Find the Workspace that owns the source Session (or its nearest ancestor).
 * @param {any} ctx - plugin context.
 * @param {any} header - source Session header.
 * @returns {Promise<any | undefined>} owning Workspace.
 */
async function resolveWorkspace(ctx, header) {
  const registry = ctx.get('workspaceRegistry');
  if (registry === undefined || typeof registry.list !== 'function') return undefined;
  const workspaces = registry.list();
  const direct = workspaces.find((workspace) => workspace.sessionIds.includes(header.id));
  if (direct !== undefined || header.origin !== 'subagent') return direct;
  const query = ctx.get('sessionQuery');
  if (query === undefined || typeof query.traceSession !== 'function') return undefined;
  try {
    const lineage = await query.traceSession(header.id);
    for (const ancestor of lineage.ancestors) {
      const workspace = workspaces.find((candidate) => candidate.sessionIds.includes(ancestor.header.id));
      if (workspace !== undefined) return workspace;
    }
  } catch {
    /* lineage is best-effort */
  }
  return undefined;
}

/**
 * Compose the Agent preset the source Session runs.
 * @param {any} ctx - plugin context.
 * @param {string | undefined} presetId - projected preset id.
 * @returns {Promise<((agentCtx: any) => Promise<void>) | undefined>} setup callback.
 */
async function composeSetup(ctx, presetId) {
  const presets = ctx.get('agentPresets');
  if (presets === undefined || typeof presets.resolve !== 'function' || typeof presets.mount !== 'function') {
    return undefined;
  }
  try {
    const resolved = await presets.resolve(presetId);
    const id = resolved?.id;
    if (typeof id !== 'string' || id === '') return undefined;
    return async (agentCtx) => {
      await presets.mount(agentCtx, id);
    };
  } catch {
    return undefined;
  }
}

/**
 * Rename the child after creation; a failure here never fails the fork.
 * @param {any} ctx - plugin context.
 * @param {any} handle - Agent handle returned by the factory.
 * @param {string} sourceTitle - source Session title.
 * @param {number[]} turns - selected Turn numbers.
 * @returns {void}
 */
function renameChild(ctx, handle, sourceTitle, turns) {
  const titles = ctx.get('sessionTitle');
  const session = handle?.agent?.session;
  if (titles === undefined || typeof titles.rename !== 'function' || session === undefined) return;
  const base = sourceTitle.trim() === '' ? '会话' : sourceTitle.trim();
  const suffix = turns.length === 1 ? `轮次 ${turns[0]}` : `${turns.length} 个轮次`;
  try {
    titles.rename(session, `${base} · 分叉 ${suffix}`);
  } catch {
    /* title is cosmetic */
  }
}

/**
 * `GET /plugins/fork-turns/turns?sessionId=...`
 * @param {any} ctx - plugin context.
 * @returns {(req: any, res: any) => Promise<void>} handler.
 */
function turnsHandler(ctx) {
  return async (req, res) => {
    try {
      if (!admitted(req)) return sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '拒绝跨站请求' } });
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' });
        return res.end();
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const { header, events } = await readSession(ctx, sessionId);
      const turns = summarizeTurns(events);
      const title = await readTitle(ctx, sessionId);
      sendJson(res, 200, { ok: true, sessionId: header.id, title, turns });
    } catch (error) {
      fail(res, error);
    }
  };
}

/**
 * `POST /plugins/fork-turns/preview` — build and validate a seed without
 * publishing an Agent or a Session.
 * @param {any} ctx - plugin context.
 * @returns {(req: any, res: any) => Promise<void>} handler.
 */
function previewHandler(ctx) {
  return async (req, res) => {
    try {
      if (!admitted(req)) return sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '拒绝跨站请求' } });
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' });
        return res.end();
      }
      const body = await readJson(req);
      const { header, events } = await readSession(ctx, body.sessionId);
      const built = buildSelectedSeed(events, body.turns);
      let validated = false;
      let validationError;
      try {
        const sessions = requireService(ctx, 'sessions');
        sessions.prepare(`session-${randomUUID()}`, {
          seed: built.seed,
          ...(header.cwd === undefined ? {} : { meta: { cwd: header.cwd, parentSession: header.id } }),
        });
        validated = true;
      } catch (error) {
        validationError = error instanceof Error ? error.message : String(error);
      }
      sendJson(res, 200, {
        ok: true,
        turns: built.turns,
        stats: built.stats,
        validated,
        ...(validationError === undefined ? {} : { validationError }),
      });
    } catch (error) {
      fail(res, error);
    }
  };
}

/**
 * `POST /plugins/fork-turns/fork` — create the child Session.
 * @param {any} ctx - plugin context.
 * @returns {(req: any, res: any) => Promise<void>} handler.
 */
function forkHandler(ctx) {
  return async (req, res) => {
    try {
      if (!admitted(req)) return sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '拒绝跨站请求' } });
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' });
        return res.end();
      }
      const body = await readJson(req);
      const agents = requireService(ctx, 'agents');
      const { header, events, projections } = await readSession(ctx, body.sessionId);
      const built = buildSelectedSeed(events, body.turns);
      const presetId = projections?.values?.agentPreset;
      const setup = await composeSetup(ctx, presetId);
      const selectionService = ctx.get('agentDefaultModel');
      const selection = selectionService?.currentSelection?.();
      const childId = `session-${randomUUID()}`;
      let handle;
      try {
        handle = await agents.create({
          sessionId: childId,
          seed: built.seed,
          meta: {
            ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
            parentSession: header.id,
            ...(typeof presetId === 'string' && presetId !== '' ? { agentPreset: presetId } : {}),
          },
          ...(selection === undefined ? {} : { agentOptions: selection }),
          ...(setup === undefined ? {} : { setup }),
        });
      } catch (error) {
        throw new ForkTurnsError('internal', `创建分支失败：${error instanceof Error ? error.message : String(error)}`);
      }
      let warning;
      try {
        const workspace = await resolveWorkspace(ctx, header);
        if (workspace !== undefined && typeof workspace.attachSession === 'function') {
          await workspace.attachSession(childId);
        } else {
          warning = '源会话不在任何工作区，新会话未挂载到工作区';
        }
      } catch (error) {
        warning = `新会话已创建，但挂载工作区失败：${error instanceof Error ? error.message : String(error)}`;
      }
      renameChild(ctx, handle, await readTitle(ctx, header.id), built.turns);
      sendJson(res, 200, {
        ok: true,
        childId,
        turns: built.turns,
        stats: built.stats,
        ...(warning === undefined ? {} : { warning }),
      });
    } catch (error) {
      fail(res, error);
    }
  };
}

export const inject = ['webServer'];

/**
 * Install the three same-origin routes.
 * @param {any} ctx - plugin context.
 * @returns {void}
 */
export function apply(ctx) {
  ctx.effect(
    () => {
      const disposeTurns = ctx.webServer.register({ kind: 'exact', path: `${ROUTE_PREFIX}/turns`, handler: turnsHandler(ctx) });
      const disposePreview = ctx.webServer.register({ kind: 'exact', path: `${ROUTE_PREFIX}/preview`, handler: previewHandler(ctx) });
      const disposeFork = ctx.webServer.register({ kind: 'exact', path: `${ROUTE_PREFIX}/fork`, handler: forkHandler(ctx) });
      return () => {
        for (const dispose of [disposeTurns, disposePreview, disposeFork]) {
          try {
            dispose();
          } catch {
            /* route table already gone */
          }
        }
      };
    },
    'fork-turns: routes',
  );
}
