/**
 * Pure turn selection and seed construction for the fork-turns bundle.
 *
 * The Host half reads one Session event log (contiguous seqs from zero) and
 * must turn an arbitrary set of completed Turns into a brand-new Session seed.
 * `Session` validation is strict: seqs must be contiguous from 0, every event
 * payload is re-validated, and surface metadata may only reference earlier
 * events. This module therefore:
 *
 *   - slices only whole completed Turns,
 *   - keeps the small event vocabulary that rebuilds conversation and tool
 *     history while dropping log-only / plugin / request-lifecycle events,
 *   - renumbers seqs to 0..n-1 and rewrites or drops surface references,
 *   - turns every replace operation into an append.
 *
 * No I/O, no Session import: everything here is testable with plain arrays.
 */

/** A selection or construction failure that maps to one HTTP status. */
export class ForkTurnsError extends Error {
  /**
   * @param {string} code - stable machine code returned by the Host route.
   * @param {string} message - user-facing reason.
   */
  constructor(code, message) {
    super(message);
    this.name = 'ForkTurnsError';
    this.code = code;
  }
}

/**
 * Event types retained in a seed. Everything else is log-only, request
 * lifecycle, compaction bookkeeping, or a plugin record whose projection may
 * be absent; none of them is needed to rebuild the selected conversation.
 */
export const KEPT_EVENT_TYPES = Object.freeze([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'user/message',
  'assistant/message',
  'tool/call',
  'tool/result',
]);

const KEPT = new Set(KEPT_EVENT_TYPES);

/** Event types that must carry a surface marker (`append` after renumbering). */
export const SURFACE_EVENT_TYPES = Object.freeze([
  'user/message',
  'assistant/message',
  'tool/result',
]);

const SURFACE = new Set(SURFACE_EVENT_TYPES);

/** Preview text is truncated to this many code units. */
const PREVIEW_LIMIT = 100;

/**
 * Assert the log is an in-memory contiguous log starting at seq 0.
 * @param {readonly any[]} events - candidate log.
 * @returns {void}
 * @throws {ForkTurnsError} when any event is missing or misnumbered.
 */
function assertContiguous(events) {
  if (!Array.isArray(events)) throw new ForkTurnsError('invalid-session', '会话事件不可读');
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.seq !== index) {
      throw new ForkTurnsError('invalid-session', `会话事件序号不连续（位置 ${index}）`);
    }
  }
}

/**
 * Group a log into Turn ranges.
 * @param {readonly any[]} events - contiguous log.
 * @returns {Map<number, { turn: number, startSeq: number, endSeq: number | undefined, time: number }>} ranges keyed by Turn number, in start order.
 * @throws {ForkTurnsError} when the log is not contiguous.
 */
export function groupTurns(events) {
  assertContiguous(events);
  const ranges = new Map();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === 'turn/start') {
      const turn = event.data?.turn;
      if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 0) continue;
      if (ranges.has(turn)) continue;
      ranges.set(turn, {
        turn,
        startSeq: index,
        endSeq: undefined,
        time: typeof event.time === 'number' ? event.time : 0,
      });
    } else if (event.type === 'turn/end') {
      const turn = event.data?.turn;
      const range = ranges.get(turn);
      if (range !== undefined && range.endSeq === undefined) range.endSeq = index;
    }
  }
  return ranges;
}

/**
 * Join the text blocks of one message payload.
 * @param {any} message - message object carrying a `content` array.
 * @returns {string} joined text.
 */
function messageText(message) {
  const blocks = message?.content;
  if (!Array.isArray(blocks)) return '';
  let text = '';
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') text += block.text;
  }
  return text;
}

/**
 * Truncate preview text on one line.
 * @param {string} text - raw text.
 * @returns {string} single-line preview.
 */
function preview(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LIMIT ? flat.slice(0, PREVIEW_LIMIT) + '…' : flat;
}

/**
 * Describe every Turn for the picker UI. Only direct human prompts count as the
 * user preview; injected context and goal rounds are skipped.
 * @param {readonly any[]} events - contiguous log.
 * @returns {Array<{ turn: number, completed: boolean, time: number, userPreview: string, assistantPreview: string, toolCalls: number }>} turns in start order.
 * @throws {ForkTurnsError} when the log is not contiguous.
 */
export function summarizeTurns(events) {
  const ranges = groupTurns(events);
  const ordered = [...ranges.values()].sort((left, right) => left.startSeq - right.startSeq);
  const result = [];
  for (const range of ordered) {
    const endSeq = range.endSeq ?? events.length - 1;
    let userPreview = '';
    let assistantPreview = '';
    let toolCalls = 0;
    for (let index = range.startSeq; index <= endSeq; index += 1) {
      const event = events[index];
      if (event.type === 'tool/call') {
        toolCalls += 1;
        continue;
      }
      if (event.type === 'user/message') {
        if (userPreview !== '') continue;
        if (event.data?.source?.kind !== 'user') continue;
        userPreview = preview(messageText(event.data));
        continue;
      }
      if (event.type === 'assistant/message') {
        const text = preview(messageText(event.data?.message));
        if (text !== '') assistantPreview = text;
      }
    }
    result.push({
      turn: range.turn,
      completed: range.endSeq !== undefined,
      time: range.time,
      userPreview,
      assistantPreview,
      toolCalls,
    });
  }
  return result;
}

/**
 * Normalize a requested Turn set: safe non-negative integers, deduplicated, ascending.
 * @param {unknown} selected - caller value.
 * @returns {number[]} normalized Turn numbers.
 * @throws {ForkTurnsError} when nothing valid was requested.
 */
export function normalizeTurns(selected) {
  if (!Array.isArray(selected)) throw new ForkTurnsError('invalid-turns', '轮次参数必须是数组');
  const unique = new Set();
  for (const value of selected) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new ForkTurnsError('invalid-turns', '轮次编号必须是非负整数');
    }
    unique.add(value);
  }
  if (unique.size === 0) throw new ForkTurnsError('invalid-turns', '至少选择一个轮次');
  return [...unique].sort((left, right) => left - right);
}

/**
 * Clone one kept event at its new seq, rewriting surface references.
 * @param {any} event - source event.
 * @param {number} seq - new contiguous seq.
 * @param {Map<number, number>} mapping - old seq to new seq.
 * @returns {any} detached seed event.
 */
function cloneSeedEvent(event, seq, mapping) {
  const copy = JSON.parse(JSON.stringify(event));
  copy.seq = seq;
  if (SURFACE.has(copy.type)) {
    copy.surfaceOp = 'append';
    if (copy.type === 'tool/result' && Array.isArray(copy.sourceEventSeqs)) {
      const mapped = [];
      let complete = true;
      for (const source of copy.sourceEventSeqs) {
        const next = mapping.get(source);
        if (next === undefined || next >= seq) {
          complete = false;
          break;
        }
        mapped.push(next);
      }
      if (complete && mapped.length > 0) copy.sourceEventSeqs = mapped;
      else delete copy.sourceEventSeqs;
    } else {
      delete copy.sourceEventSeqs;
    }
  }
  return copy;
}

/**
 * Count seed composition for diagnostics.
 * @param {readonly any[]} seed - constructed seed events.
 * @returns {{ events: number, types: Record<string, number>, turns: number[] }} composition.
 */
export function seedStats(seed) {
  const types = {};
  const turns = [];
  for (const event of seed) {
    types[event.type] = (types[event.type] ?? 0) + 1;
    if (event.type === 'turn/start' && !turns.includes(event.data.turn)) turns.push(event.data.turn);
  }
  return { events: seed.length, types, turns };
}

/**
 * Build one seed containing exactly the selected completed Turns.
 * @param {readonly any[]} events - contiguous source log.
 * @param {readonly number[]} selected - Turn numbers requested by the caller.
 * @returns {{ seed: any[], turns: number[], stats: { events: number, types: Record<string, number>, turns: number[] } }} constructed seed and composition.
 * @throws {ForkTurnsError} when a Turn is missing, open, or yields no human prompt.
 */
export function buildSelectedSeed(events, selected) {
  assertContiguous(events);
  const ranges = groupTurns(events);
  const wanted = normalizeTurns(selected);
  for (const turn of wanted) {
    const range = ranges.get(turn);
    if (range === undefined) throw new ForkTurnsError('turn-not-found', `轮次 ${turn} 不存在`);
    if (range.endSeq === undefined) {
      throw new ForkTurnsError('turn-open', `轮次 ${turn} 仍在进行中，只有已完成的轮次可以分叉`);
    }
  }
  const picked = [];
  for (const turn of wanted) {
    const range = ranges.get(turn);
    for (let index = range.startSeq; index <= range.endSeq; index += 1) picked.push(events[index]);
  }
  const kept = picked.filter((event) => KEPT.has(event.type));
  const mapping = new Map();
  for (let index = 0; index < kept.length; index += 1) mapping.set(kept[index].seq, index);
  const seed = kept.map((event, index) => cloneSeedEvent(event, index, mapping));
  if (!seed.some((event) => event.type === 'user/message')) {
    throw new ForkTurnsError('no-user-message', '选中的轮次里没有可以直接继承的用户消息');
  }
  return { seed, turns: wanted, stats: seedStats(seed) };
}
