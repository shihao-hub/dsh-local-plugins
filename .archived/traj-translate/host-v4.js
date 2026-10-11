/**
 * Host half of @local/traj-translate.
 *
 * Registers one same-origin HTTP route (`/dsh-traj-translate/translate`) and
 * answers it with a context-free AI translation of numbered text segments.
 * The model is resolved per request: an optional client-supplied
 * provider/model hint (read from the inspector overview when visible) is used
 * when that provider is registered, otherwise the current default model
 * selection is read fresh, so different sessions with different models are
 * honored without hardcoding anything.
 *
 * v1.1: the `webServer` route contract is Node-style — the handler receives
 * `(req, res)` and owns the whole response (`dsh-host-webserver` L235:
 * `await route.handler(req, res)`). Returning a fetch `Response` is silently
 * ignored and hangs the connection, which is exactly what v1.0 did.
 */

/** Required services: model calls + the default model selection owner. */
export const inject = ['llm', 'agentDefaultModel'];

const ROUTE_PREFIX = '/dsh-traj-translate';
const MAX_SEGMENTS = 400;
const MAX_SEGMENT_CHARS = 8000;
const MAX_BODY_BYTES = 512 * 1024;
const TIMEOUT_MS = 180000;
// v1.1: Node-style (req,res) route handler; see plan revision.


/**
 * Mount the HTTP route for the lifetime of this plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context with `llm`.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: (req, res) => handle(req, res, ctx),
        }),
      'traj-translate: translate route',
    );
  });
}

/**
 * Route one request. The handler owns the response: every path must end in
 * exactly one `sendJson`.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
async function handle(req, res, ctx) {
  let url;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    sendJson(res, 400, { ok: false, error: 'bad url' });
    return;
  }
  if (req.method !== 'POST' || !url.pathname.endsWith('/translate')) {
    sendJson(res, 404, { ok: false, error: 'not found' });
    return;
  }
  let body;
  try {
    const raw = await readBody(req);
    if (raw === null) {
      sendJson(res, 413, { ok: false, error: `请求体超过 ${MAX_BODY_BYTES} 字节上限` });
      return;
    }
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    if (res.writableEnded) return;
    const tooLarge = error?.message === 'body too large';
    sendJson(res, tooLarge ? 413 : 400, {
      ok: false,
      error: tooLarge ? `请求体超过 ${MAX_BODY_BYTES} 字节上限` : '请求体不是合法 JSON',
    });
    return;
  }
  const segments = normalizeSegments(body?.segments);
  if (!segments) {
    sendJson(res, 400, { ok: false, error: `segments 必须是 1~${MAX_SEGMENTS} 个字符串的数组` });
    return;
  }
  try {
    const translations = await translate(ctx, segments, body);
    sendJson(res, 200, { ok: true, translations });
  } catch (error) {
    sendJson(res, 502, { ok: false, error: error?.message ?? String(error) });
  }
}

/**
 * Read the whole request body; resolves `null` when the size cap is exceeded.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string|null>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} data */
function sendJson(res, status, data) {
  if (res.headersSent || res.writableEnded) return;
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Translate one batch of segments with the resolved model.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string[]} segments
 * @param {{providerHint?: unknown, modelHint?: unknown}} body
 * @returns {Promise<string[]>} one entry per segment, never null
 */
async function translate(ctx, segments, body) {
  const { provider, model } = await resolveModel(ctx, body);
  let output = '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
  }, TIMEOUT_MS);
  try {
    const stream = ctx.llm.stream({
      provider,
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt(segments) }] }],
    });
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') output += chunk.text;
      else if (chunk?.type === 'finish') break;
      if (timedOut) break;
    }
  } finally {
    clearTimeout(timer);
  }
  if (timedOut && !output) throw new Error(`翻译超时（${Math.round(TIMEOUT_MS / 1000)}s）`);
  const parsed = parseTranslationMap(output, segments.length);
  return segments.map((original, i) => parsed[i] ?? original);
}

/**
 * Pick the model for this request: validated hint first, live default second.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{providerHint?: unknown, modelHint?: unknown}} body
 * @returns {Promise<{provider: string, model: string, fromHint: boolean}>}
 */
async function resolveModel(ctx, body) {
  const hintProvider = typeof body?.providerHint === 'string' ? body.providerHint.trim() : '';
  const hintModel = typeof body?.modelHint === 'string' ? body.modelHint.trim() : '';
  if (hintProvider && hintModel) {
    try {
      const providers = await ctx.llm.listProviders();
      if (Array.isArray(providers) && providers.some((entry) => entry?.id === hintProvider)) {
        return { provider: hintProvider, model: hintModel, fromHint: true };
      }
    } catch {
      // listing failed — fall through to the default selection
    }
  }
  let detail = 'default-model service unavailable';
  try {
    const service = ctx.agentDefaultModel ?? ctx.get?.('agentDefaultModel');
    detail = `service=${service ? 'present' : 'missing'}`;
    const selection = service?.currentSelection?.();
    if (selection?.provider && selection?.model) {
      return { provider: selection.provider, model: selection.model, fromHint: false };
    }
    detail += ` selection=${JSON.stringify(selection ?? null)}`;
  } catch (error) {
    detail = `currentSelection threw: ${error?.message ?? String(error)}`;
  }
  throw new Error(`没有可用的模型（${detail}）；请求提示 provider=${hintProvider || '无'} model=${hintModel || '无'}`);
}

/**
 * Build the context-free translation prompt for one numbered batch.
 * @param {string[]} segments
 * @returns {string}
 */
function buildPrompt(segments) {
  const list = segments.map((text, i) => `[${i + 1}] ${text}`).join('\n');
  return [
    '你是翻译引擎。把编号文本片段翻译成简体中文。',
    '要求：',
    '1. 只输出一个 JSON 对象，不要解释、不要代码围栏。格式：{"t":{"<编号>":"<译文>"}}',
    '2. 编号必须与输入一一对应，不得增删、不得合并、不得改变顺序。',
    '3. 代码、命令、文件路径、URL、JSON 键名、环境变量、专有名词、产品名保留英文原样。',
    '4. 片段若已经是中文，原样返回。',
    '5. 片段可能是被截断的句子、表格单元格或界面标签，按字面直译即可，不要补充说明或添加引号。',
    '',
    '待翻译片段：',
    list,
  ].join('\n');
}

/**
 * Parse the model's `{"t":{"<n>":"..."}}` answer tolerantly.
 * @param {string} output - raw model text
 * @param {number} count - expected segment count
 * @returns {(string|null)[]} per-index translation, null when missing
 */
function parseTranslationMap(output, count) {
  let text = output.trim();
  if (!text) throw new Error('模型没有返回内容');
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('模型输出不是 JSON');
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('模型输出的 JSON 无法解析');
  }
  const map = parsed && typeof parsed === 'object' ? (parsed.t ?? parsed) : null;
  const result = new Array(count).fill(null);
  if (!map || typeof map !== 'object') return result;
  for (let i = 1; i <= count; i++) {
    const value = map[String(i)];
    if (typeof value === 'string' && value.length > 0) result[i - 1] = value;
  }
  return result;
}

/**
 * Validate and normalize the segments array.
 * @param {unknown} input
 * @returns {string[]|null}
 */
function normalizeSegments(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SEGMENTS) return null;
  const segments = [];
  for (const entry of input) {
    if (typeof entry !== 'string') return null;
    segments.push(entry.length > MAX_SEGMENT_CHARS ? entry.slice(0, MAX_SEGMENT_CHARS) : entry);
  }
  return segments;
}
