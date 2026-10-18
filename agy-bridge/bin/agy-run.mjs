#!/usr/bin/env node
/**
 * agy-run：agy 只读调研的「后台作业」封装入口（P0 止血用，见 agy-bridge/plans/tasks.md T2）。
 *
 * 为什么需要它：同步 MCP 工具调用有客户端超时上限，宽面调研必然被掐断，而掐断后服务端会留下
 * 孤儿进程树。本脚本把「跑 agy」变成一条可交给 DSH 后台作业（`pwsh run_in_background`）的原子命令：
 * 进度边跑边落盘，报告最后落盘，超时则连整棵进程树一起回收。
 *
 * 用法：
 *   node bin/agy-run.mjs --prompt-file <文件> --cwd <目录> [选项]
 *   node bin/agy-run.mjs --prompt "<文本>"  --cwd <目录> [选项]
 *
 * 选项：
 *   --cwd <dir>            工作区根目录（agy 的读取根），默认当前目录
 *   --out <file>           报告落盘路径，默认 %TEMP%\agy-report-<时间戳>.md
 *   --progress <file>      进度 NDJSON 落盘路径，默认 %TEMP%\agy-progress-<时间戳>.jsonl
 *   --model <id>           透传 --model
 *   --effort <level>       low|medium|high|xhigh|max，透传 --effort
 *   --add-dir <dir>        额外暴露目录（可重复）
 *   --timeout <seconds>    本脚本自身的硬超时，默认 900；到点连整棵进程树一起杀
 *   --print-timeout <dur>  透传 agy --print-timeout（如 900s；0 表示直到回合结束）
 *   --mode <name>          默认 plan（只读）；候选 accept-edits|auto|plan
 *   --no-sandbox           关闭 --sandbox（默认开启，只读红线的一部分）
 *   --no-slash-commands    透传 --disable-slash-commands（实验旋钮，**实测无差异**：中性守卫段下
 *                          开/关该开关均未改变 plan-and-wait 行为，见 plans/01-… 方案 §3.6；
 *                          保留仅为后续 A/B，不作为修复手段）
 *   --continue-once        命中「plan-and-wait（等人点 Proceed）」时自动续跑一次（硬上限 1 次）
 *   --guardrails <file>    外部守卫段文本，追加到 prompt 末尾（默认内置一段）
 *
 * 退出码：
 *   0  成功（报告已落盘）
 *   2  本脚本硬超时（进程树已回收）
 *   3  agy 非零退出或无有效输出
 *   4  参数或环境错误（如找不到 agy、cwd 不存在、prompt 为空）
 *   5  命中 plan-and-wait 且未开启 --continue-once（报告位置仍会打印）
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// 常量与开关（集中置顶）
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_S = 900;
/** 命中即认为 agy 停下来等人批准（非交互调用无人可点）。 */
const PLAN_WAIT_PATTERN = /(待确认|请审阅|Proceed|确认无误后|等待您的批准)/;
/** 自动续跑时追加的指令。 */
const RESUME_PROMPT = '继续：直接在同一回合内输出最终交付物（报告正文即最终回答），不要再征求任何批准或生成计划文档。';
/** 默认守卫段：没有它时 agy 在 plan 模式下会停下来等人点 Proceed。 */
const GUARDRAILS = [
  '',
  '【本次调用为 -p 非交互 print 模式，没有人能点击 Proceed 或回复确认】',
  '1. 必须在同一回合内直接产出最终交付物（报告正文即最终回答），禁止生成"待确认/请审阅"的计划文档；',
  '2. 文件枚举优先使用 git ls-files；禁止 Path.rglob / os.walk 全盘裸扫；目录遍历必须限深、限条数；',
  '3. 严禁把探针脚本托管为长时间后台任务；单条命令超过 60 秒即视为设计错误，应缩减范围；',
  '4. 预算内先出完整结构，再补关键细节，不要为细枝末节反复往返。',
].join('\n');

const EXIT_OK = 0;
const EXIT_TIMEOUT = 2;
const EXIT_AGY_FAILED = 3;
const EXIT_USAGE = 4;
const EXIT_PLAN_WAIT = 5;

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    prompt: undefined,
    promptFile: undefined,
    cwd: process.cwd(),
    out: undefined,
    progress: undefined,
    model: undefined,
    effort: undefined,
    addDirs: [],
    timeoutS: DEFAULT_TIMEOUT_S,
    printTimeout: undefined,
    mode: 'plan',
    sandbox: true,
    noSlashCommands: false,
    conversationId: undefined,
    continueOnce: false,
    guardrailsFile: undefined,
  };
  const repeatable = { '--add-dir': 'addDirs' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`缺少取值：${token}`);
      return argv[index];
    };
    switch (token) {
      case '--prompt': options.prompt = next(); break;
      case '--prompt-file': options.promptFile = next(); break;
      case '--cwd': options.cwd = next(); break;
      case '--out': options.out = next(); break;
      case '--progress': options.progress = next(); break;
      case '--model': options.model = next(); break;
      case '--effort': options.effort = next(); break;
      case '--timeout': options.timeoutS = Number(next()); break;
      case '--print-timeout': options.printTimeout = next(); break;
      case '--mode': options.mode = next(); break;
      case '--guardrails': options.guardrailsFile = next(); break;
      case '--no-sandbox': options.sandbox = false; break;
      case '--no-slash-commands': options.noSlashCommands = true; break;
      case '--continue-once': options.continueOnce = true; break;
      default:
        if (repeatable[token] !== undefined) options[repeatable[token]].push(next());
        else throw new Error(`未知参数：${token}`);
    }
  }
  return options;
}

function findAgy() {
  const explicit = process.env.AGY_BIN;
  if (explicit && existsSync(explicit)) return explicit;
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const fallback = join(local, 'agy', 'bin', 'agy.exe');
    if (existsSync(fallback)) return fallback;
  }
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['agy'], { encoding: 'utf8' });
  const first = (which.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
  return first ?? null;
}

/** Windows 的 kill() 只杀直接子进程；用 taskkill /T 连坐回收整棵树。 */
function killTree(child) {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

// ---------------------------------------------------------------------------
// 单次 agy 运行
// ---------------------------------------------------------------------------

/**
 * 跑一次 agy，把进度与报告落到指定文件。
 * @returns {Promise<{state: object, code: number}>} 解析出的事件状态与终态码
 */
function runOnce({ agy, argv, cwd, timeoutS, progressPath, label }) {
  return new Promise((done) => {
    const started = Date.now();
    const state = {
      conversationId: null,
      stepIndex: -1,
      stepType: '',
      turns: 0,
      response: null,
      status: null,
      exitCode: null,
      timedOut: false,
      lastEventAt: Date.now(),
    };
    const note = (event) => appendFileSync(
      progressPath,
      `${JSON.stringify({ at: new Date().toISOString(), run: label, elapsedS: Math.round((Date.now() - started) / 100) / 10, ...event })}\n`,
      'utf8',
    );

    const child = spawn(agy, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line.length === 0) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          note({ kind: 'unparsed', raw: line.slice(0, 200) });
          continue;
        }
        state.lastEventAt = Date.now();
        if (event.event === 'init') {
          state.conversationId = event.init?.conversation_id ?? event.conversation_id ?? null;
          note({ kind: 'init', conversationId: state.conversationId });
        } else if (event.event === 'step_update') {
          const step = event.step_update ?? {};
          state.stepIndex = Math.max(state.stepIndex, step.step_index ?? -1);
          state.stepType = step.step_type ?? state.stepType;
          note({ kind: 'step', stepIndex: step.step_index, state: step.state, stepType: step.step_type, tokens: step.usage?.total_tokens });
        } else if (event.event === 'result') {
          state.response = event.result?.response ?? null;
          state.status = event.result?.status ?? null;
          state.turns = event.result?.num_turns ?? 0;
          state.conversationId = event.result?.conversation_id ?? state.conversationId;
          note({ kind: 'result', status: state.status, turns: state.turns, durationS: event.result?.duration_seconds });
        } else {
          note({ kind: 'other', event: event.event ?? 'unknown' });
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text.length > 0) note({ kind: 'stderr', text: text.slice(0, 400) });
    });

    const timer = setTimeout(() => {
      state.timedOut = true;
      note({ kind: 'timeout', afterS: timeoutS });
      killTree(child);
    }, Math.max(1, timeoutS) * 1000);
    timer.unref();

    child.on('error', (error) => {
      note({ kind: 'spawn-error', message: error.message });
      done({ state, code: EXIT_USAGE });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      state.exitCode = code;
      state.durationS = Math.round((Date.now() - started) / 100) / 10;
      if (state.timedOut) done({ state, code: EXIT_TIMEOUT });
      else if (code === 0 && state.response !== null) done({ state, code: EXIT_OK });
      else {
        note({ kind: 'agy-failed', code, signal });
        done({ state, code: EXIT_AGY_FAILED });
      }
    });
  });
}

function buildArgv(options, prompt) {
  const argv = ['-p', prompt, '--output-format', 'stream-json', '--mode', options.mode];
  if (options.sandbox) argv.push('--sandbox');
  // 实验旋钮：--mode plan 会把用户请求展开成 /plan 斜杠命令，该命令自带「先出计划取得批准」
  // 的指令，一度被认为是 plan-and-wait 的结构性来源。实测（同一 prompt 开/关该开关各 1 次、
  // 中性守卫段）**未观察到差异**，且 plan-and-wait 本身不可稳定复现 → 判定为概率性失败模式，
  // 修复手段是下面的「检测 + 有界自动续跑」，不是这个开关。
  if (options.noSlashCommands) argv.push('--disable-slash-commands');
  if (options.conversationId !== undefined && options.conversationId !== null) argv.push('--conversation', options.conversationId);
  if (options.model !== undefined) argv.push('--model', options.model);
  if (options.effort !== undefined) argv.push('--effort', options.effort);
  if (options.printTimeout !== undefined) argv.push('--print-timeout', options.printTimeout);
  for (const directory of options.addDirs) argv.push('--add-dir', directory);
  return argv;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`参数错误：${error.message}`);
    return EXIT_USAGE;
  }

  const cwd = resolve(options.cwd);
  if (!existsSync(cwd)) {
    console.error(`cwd 不存在：${cwd}`);
    return EXIT_USAGE;
  }

  let prompt = options.prompt ?? '';
  if (options.promptFile !== undefined) {
    if (!existsSync(options.promptFile)) {
      console.error(`prompt 文件不存在：${options.promptFile}`);
      return EXIT_USAGE;
    }
    prompt = readFileSync(options.promptFile, 'utf8');
  }
  prompt = prompt.trim();
  if (prompt.length === 0) {
    console.error('缺少 prompt：用 --prompt 或 --prompt-file 提供');
    return EXIT_USAGE;
  }

  const agy = findAgy();
  if (agy === null) {
    console.error('找不到 agy：设置 AGY_BIN 或确认 %LOCALAPPDATA%\\agy\\bin\\agy.exe 存在');
    return EXIT_USAGE;
  }

  // 显式指定的守卫段文件缺失时必须报错：静默回退会让调用方以为"约束已关闭"，
  // 从而误判 plan-and-wait 的观测结果（实测踩过一次）。
  let guardrails = GUARDRAILS;
  if (options.guardrailsFile !== undefined) {
    if (!existsSync(options.guardrailsFile)) {
      console.error(`guardrails 文件不存在：${options.guardrailsFile}（拒绝静默回退到内置守卫段）`);
      return EXIT_USAGE;
    }
    guardrails = readFileSync(options.guardrailsFile, 'utf8');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = resolve(options.out ?? join(tmpdir(), `agy-report-${stamp}.md`));
  const progressPath = resolve(options.progress ?? join(tmpdir(), `agy-progress-${stamp}.jsonl`));
  mkdirSync(dirname(outPath), { recursive: true });
  mkdirSync(dirname(progressPath), { recursive: true });

  console.log(`agy      : ${agy}`);
  console.log(`cwd      : ${cwd}`);
  console.log(`report   : ${outPath}`);
  console.log(`progress : ${progressPath}`);
  console.log(`timeout  : ${options.timeoutS}s`);

  const first = await runOnce({
    agy,
    argv: buildArgv(options, `${prompt}\n${guardrails}`),
    cwd,
    timeoutS: options.timeoutS,
    progressPath,
    label: 'run1',
  });

  let state = first.state;
  let code = first.code;
  let continuation = 0;

  const isPlanWait = () => state.response !== null && PLAN_WAIT_PATTERN.test(state.response);
  if (code === EXIT_OK && isPlanWait() && options.continueOnce) {
    continuation = 1;
    console.log('');
    console.log(`检测到 plan-and-wait（agy 停下来等人确认），自动续跑一次：conversation=${state.conversationId ?? 'n/a'}`);
    appendFileSync(progressPath, `${JSON.stringify({ at: new Date().toISOString(), kind: 'auto-continue', conversationId: state.conversationId })}\n`, 'utf8');
    const resumed = await runOnce({
      agy,
      // 显式用 --conversation 续跑上一轮会话；不能依赖 agy 自己去读上一轮的 transcript
      // （实测它会那样做，但那是隐式行为，不可依赖）。
      argv: buildArgv({ ...options, printTimeout: undefined, conversationId: state.conversationId }, RESUME_PROMPT),
      cwd,
      timeoutS: options.timeoutS,
      progressPath,
      label: 'run2',
    });
    // 续跑成功才覆盖；失败保留首轮产物，避免把已有内容弄丢。
    if (resumed.state.response !== null && !PLAN_WAIT_PATTERN.test(resumed.state.response)) {
      state = { ...resumed.state, conversationId: state.conversationId, stepIndex: state.stepIndex + resumed.state.stepIndex + 1 };
      code = resumed.code;
    } else {
      console.log('续跑仍未产出最终交付物：保留首轮产物，job 置为 needs_attention。');
      state = { ...state, needsAttention: true };
      code = EXIT_PLAN_WAIT;
    }
  }

  if (state.response !== null) writeFileSync(outPath, state.response, 'utf8');
  const planWait = isPlanWait();
  console.log('');
  console.log(`exit     : ${code}`);
  console.log(`elapsed  : ${(state.durationS ?? 0)}s`);
  console.log(`steps    : ${state.stepIndex + 1} (last type: ${state.stepType || 'n/a'})   turns=${state.turns}`);
  console.log(`planWait : ${planWait ? 'YES（命中 plan-and-wait）' : 'no'}   continuations=${continuation}`);
  if (state.response !== null) console.log(`report   : ${outPath}`);
  if (planWait && continuation === 0) {
    console.log('提示：加 --continue-once 可自动续跑一次，或手工续跑：');
    console.log(`      agy -p "<继续指令>" --sandbox --mode ${options.mode} --output-format stream-json --conversation ${state.conversationId ?? '<id>'}`);
  }
  return code;
}

process.exitCode = await main();
