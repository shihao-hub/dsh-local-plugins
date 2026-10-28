/**
 * Zero-dependency regression tests for the pure half of fork-turns.
 *
 * Run with: node self-test.mjs
 * Covers Turn grouping, previews, selection normalization, seed slicing,
 * surface rewriting, cross-Turn tool-result references, and every rejection.
 */
import assert from 'node:assert/strict';

import {
  ForkTurnsError,
  buildSelectedSeed,
  groupTurns,
  normalizeTurns,
  seedStats,
  summarizeTurns,
} from './turns.js';

let passed = 0;
const failures = [];

/**
 * Run one named assertion group.
 * @param {string} name - case name.
 * @param {() => void} body - assertions.
 */
function test(name, body) {
  try {
    body();
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}

/**
 * Build a four-Turn contiguous log: 1 and 3 are plain, 2 is synthetic-only,
 * 4 stays open, and request/system/plugin records sit outside every Turn.
 * @returns {any[]} contiguous log.
 */
function fixture() {
  const raw = [];
  const add = (type, data) => {
    raw.push({ type, data });
    return raw.length - 1;
  };
  const calls = new Map();

  add('session/title', { title: '旧标题', messageSeqs: [], source: { kind: 'fallback' } });
  add('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' });
  add('system/message', {
    turn: 0,
    step: 0,
    message: { role: 'system', content: [{ type: 'text', text: 'sys' }], source: { kind: 'system-prompt' } },
  });

  const pushTurn = ({ turn, userText, assistantText, syntheticUser = false, tool = false, close = true }) => {
    add('turn/start', { turn });
    add('step/start', { turn, step: 0 });
    add('user/message', {
      role: 'user',
      content: [{ type: 'text', text: userText }],
      source: syntheticUser ? { kind: 'injected', reason: 'test' } : { kind: 'user' },
    });
    if (tool) {
      const callId = `call-${turn}`;
      calls.set(callId, add('tool/call', { turn, step: 0, callId, name: 'read', arguments: '{}' }));
      add('tool/result', {
        turn,
        step: 0,
        message: {
          role: 'tool',
          content: [{ type: 'text', text: 'file body' }],
          source: { kind: 'tool', callId },
          toolCallId: callId,
        },
      });
    }
    add('assistant/message', {
      turn,
      step: 0,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
      stream: [],
    });
    add('step/end', { turn, step: 0 });
    if (close) add('turn/end', { turn, reason: { kind: 'completed' } });
  };

  pushTurn({ turn: 1, userText: '帮我重构解析器', assistantText: '已拆出 lexer', tool: true });
  pushTurn({ turn: 2, userText: '自动注入的上下文', assistantText: '确认', syntheticUser: true });
  pushTurn({ turn: 3, userText: '再补测试', assistantText: '测试已补', tool: true });
  pushTurn({ turn: 4, userText: '还在跑的轮次', assistantText: '中间态', close: false });

  return raw.map((item, index) => {
    const event = { seq: index, type: item.type, time: 1000 + index, data: item.data };
    if (item.type === 'user/message' || item.type === 'assistant/message' || item.type === 'tool/result') {
      event.surfaceOp = 'append';
    }
    if (item.type === 'tool/result') {
      event.sourceEventSeqs = [calls.get(item.data.message.toolCallId)];
    }
    return event;
  });
}

test('groupTurns maps completed and open ranges', () => {
  const turns = groupTurns(fixture());
  assert.equal(turns.size, 4);
  assert.equal(turns.get(1).endSeq !== undefined, true);
  assert.equal(turns.get(4).endSeq, undefined);
  assert.equal(turns.get(1).startSeq < turns.get(3).startSeq, true);
});

test('groupTurns rejects non-contiguous logs', () => {
  assert.throws(() => groupTurns([{ seq: 1, type: 'turn/start', data: { turn: 1 } }]), ForkTurnsError);
});

test('summarizeTurns shows every Turn in start order', () => {
  const turns = summarizeTurns(fixture());
  assert.deepEqual(turns.map((item) => item.turn), [1, 2, 3, 4]);
  assert.equal(turns[0].completed, true);
  assert.equal(turns[3].completed, false);
});

test('summarizeTurns prefers direct human prompts and skips injected ones', () => {
  const turns = summarizeTurns(fixture());
  assert.equal(turns[0].userPreview, '帮我重构解析器');
  assert.equal(turns[1].userPreview, '');
  assert.equal(turns[0].assistantPreview, '已拆出 lexer');
  assert.equal(turns[0].toolCalls, 1);
  assert.equal(turns[2].toolCalls, 1);
});

test('normalizeTurns deduplicates and sorts', () => {
  assert.deepEqual(normalizeTurns([3, 1, 3, 2]), [1, 2, 3]);
});

test('normalizeTurns rejects empty and malformed input', () => {
  assert.throws(() => normalizeTurns([]), ForkTurnsError);
  assert.throws(() => normalizeTurns(['1']), ForkTurnsError);
  assert.throws(() => normalizeTurns([-1]), ForkTurnsError);
  assert.throws(() => normalizeTurns([1.5]), ForkTurnsError);
});

test('buildSelectedSeed keeps only the chosen Turns', () => {
  const { seed, turns } = buildSelectedSeed(fixture(), [1, 3]);
  assert.deepEqual(turns, [1, 3]);
  const turnNumbers = seed.filter((item) => item.type === 'turn/start').map((item) => item.data.turn);
  assert.deepEqual(turnNumbers, [1, 3]);
});

test('buildSelectedSeed renumbers every seq contiguously from zero', () => {
  const { seed } = buildSelectedSeed(fixture(), [1, 3]);
  for (let index = 0; index < seed.length; index += 1) assert.equal(seed[index].seq, index);
  assert.equal(seed.length > 0, true);
});

test('buildSelectedSeed drops request lifecycle, system, and plugin records', () => {
  const { seed } = buildSelectedSeed(fixture(), [1, 2, 3]);
  const types = new Set(seed.map((item) => item.type));
  assert.equal(types.has('request/header'), false);
  assert.equal(types.has('system/message'), false);
  assert.equal(types.has('session/title'), false);
  assert.equal(types.has('session/end-seed'), false);
});

test('buildSelectedSeed keeps closed Turn and Step boundaries', () => {
  const { seed } = buildSelectedSeed(fixture(), [1]);
  assert.equal(seed[0].type, 'turn/start');
  assert.equal(seed.at(-1).type, 'turn/end');
  assert.equal(seed.some((item) => item.type === 'step/start'), true);
  assert.equal(seed.some((item) => item.type === 'step/end'), true);
});

test('every surface event becomes an append', () => {
  const { seed } = buildSelectedSeed(fixture(), [1, 3]);
  for (const item of seed) {
    if (item.type === 'user/message' || item.type === 'assistant/message' || item.type === 'tool/result') {
      assert.equal(item.surfaceOp, 'append');
    }
  }
});

test('assistant messages never carry source references', () => {
  const { seed } = buildSelectedSeed(fixture(), [1, 3]);
  for (const item of seed) {
    if (item.type === 'assistant/message') assert.equal('sourceEventSeqs' in item, false);
  }
});

test('tool results keep a rewritten reference to their own call', () => {
  const { seed } = buildSelectedSeed(fixture(), [3]);
  const result = seed.find((item) => item.type === 'tool/result');
  const call = seed.find((item) => item.type === 'tool/call');
  assert.equal(Array.isArray(result.sourceEventSeqs), true);
  assert.deepEqual(result.sourceEventSeqs, [call.seq]);
  assert.equal(result.sourceEventSeqs[0] < result.seq, true);
});

test('a tool result citing a dropped Turn loses the reference', () => {
  const log = fixture();
  const firstCall = log.find((item) => item.type === 'tool/call' && item.data.turn === 1);
  const result = log.find((item) => item.type === 'tool/result' && item.data.turn === 3);
  result.sourceEventSeqs = [firstCall.seq];
  const { seed } = buildSelectedSeed(log, [3]);
  const kept = seed.find((item) => item.type === 'tool/result');
  assert.equal('sourceEventSeqs' in kept, false);
});

test('buildSelectedSeed preserves the original Turn and Step numbers', () => {
  const { seed } = buildSelectedSeed(fixture(), [3]);
  assert.equal(seed.find((item) => item.type === 'turn/start').data.turn, 3);
  assert.equal(seed.find((item) => item.type === 'step/start').data.step, 0);
});

test('buildSelectedSeed clones, never aliases, the source log', () => {
  const log = fixture();
  const { seed } = buildSelectedSeed(log, [1]);
  seed[0].data.turn = 99;
  assert.equal(log.find((item) => item.type === 'turn/start').data.turn, 1);
});

test('an open Turn is rejected', () => {
  assert.throws(() => buildSelectedSeed(fixture(), [4]), (error) => {
    assert.equal(error instanceof ForkTurnsError, true);
    assert.equal(error.code, 'turn-open');
    return true;
  });
});

test('an unknown Turn is rejected', () => {
  assert.throws(() => buildSelectedSeed(fixture(), [9]), (error) => {
    assert.equal(error.code, 'turn-not-found');
    return true;
  });
});

test('injected user messages still count as conversation history', () => {
  const { seed } = buildSelectedSeed(fixture(), [2]);
  assert.equal(seed.filter((item) => item.type === 'user/message').length, 1);
});

test('a Turn with no user message at all produces no-user-message', () => {
  const log = [
    { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
    { seq: 1, type: 'step/start', time: 2, data: { turn: 1, step: 0 } },
    {
      seq: 2,
      type: 'assistant/message',
      time: 3,
      data: {
        turn: 1,
        step: 0,
        message: { role: 'assistant', content: [{ type: 'text', text: 'only answer' }], source: { kind: 'model', provider: 'p', model: 'm' } },
        stream: [],
      },
      surfaceOp: 'append',
    },
    { seq: 3, type: 'step/end', time: 4, data: { turn: 1, step: 0 } },
    { seq: 4, type: 'turn/end', time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  assert.throws(() => buildSelectedSeed(log, [1]), (error) => {
    assert.equal(error.code, 'no-user-message');
    return true;
  });
});

test('seedStats reports composition', () => {
  const { seed, stats } = buildSelectedSeed(fixture(), [1, 3]);
  assert.equal(stats.events, seed.length);
  assert.deepEqual(stats.turns, [1, 3]);
  assert.equal(stats.types['user/message'], 2);
  assert.equal(stats.types['tool/call'], 2);
});

test('a log with no Turn but valid seqs summarizes to empty', () => {
  assert.deepEqual(summarizeTurns([{ seq: 0, type: 'session/title', time: 1, data: { title: 'x' } }]), []);
});

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`not ok - ${failure.name}`);
    console.error(failure.error);
  }
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`ok - ${passed} passed`);
}
