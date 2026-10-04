/**
 * Render the panel's element tree in Node, with a stateful React mock, and
 * report what each branch header says versus what is actually rendered under
 * it. Tests the multi-level segment tree and all-expanded TreeView interactions.
 *
 * Run: node design/test-render.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual) ?? String(actual);
  const e = JSON.stringify(expected) ?? String(expected);
  if (a !== e) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${a}\n  expected ${e}`);
  } else {
    console.log(`ok   ${label}  ${a.length > 88 ? a.slice(0, 85) + '...' : a}`);
  }
}

function harness(skills) {
  const store = new Map();
  const hooks = [];
  let cursor = 0;
  let rerender;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState(initial) {
      const index = cursor++;
      if (hooks.length <= index) {
        hooks[index] = typeof initial === 'function' ? initial() : initial;
      }
      const set = (next) => {
        hooks[index] = typeof next === 'function' ? next(hooks[index]) : next;
        rerender?.();
      };
      return [hooks[index], set];
    },
    useRef: () => ({ current: null }),
    useEffect: () => {}
  };
  const t = (key) => key;
  let tree;

  const Panel = (() => {
    let factory;
    globalThis.window = {
      __ModuleLoader__: { load: ({ factory: f }) => (factory = f) },
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, v)
      }
    };
    new Function('window', 'require', source)(globalThis.window, (id) =>
      id === 'react' ? React : createRequire(import.meta.url)(id)
    );
    const mod = factory((id) => (id === 'react' ? React : createRequire(import.meta.url)(id)));
    return mod.__test.Panel;
  })();

  const useSessions = (selector) => selector({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 }, cwd: 'C:/work/proj' } } });

  const render = () => {
    cursor = 0;
    const realUseState = React.useState;
    React.useState = (initial) => {
      const initVal = typeof initial === 'function' ? initial() : initial;
      if (typeof initVal === 'object' && initVal !== null && 'status' in initVal) {
        const index = cursor++;
        hooks[index] = { status: 'ready', skills, error: null };
        return [hooks[index], (next) => { hooks[index] = next; }];
      }
      return realUseState(initial);
    };
    tree = Panel({
      t,
      useSessions,
      loadSkills: async () => skills,
      openSkillFile: () => true,
      canOpenResource: true
    });
    React.useState = realUseState;
    return tree;
  };

  rerender = () => render();

  const all = (node, type, acc = []) => {
    if (node === null || node === undefined) return acc;
    if (Array.isArray(node)) {
      for (const child of node) all(child, type, acc);
      return acc;
    }
    if (typeof node === 'string' || typeof node === 'number') return acc;
    if (typeof node !== 'object') return acc;
    if (node.type === type) acc.push(node);
    if (typeof node.type === 'function') {
      all(node.type(node.props ?? {}), type, acc);
      return acc;
    }
    for (const child of node.children ?? []) all(child, type, acc);
    return acc;
  };

  const text = (node) => {
    if (node === null || node === undefined || node === false) return '';
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(text).join('');
    if (typeof node !== 'object') return '';
    if (typeof node.type === 'function') return text(node.type(node.props ?? {}));
    return (node.children ?? []).map(text).join('');
  };

  return { render, tree: () => tree, all, text, store, Panel };
}

const names = [
  'lark-doc', 'lark-sheets', 'lark-im', 'lark-base',
  'lark-workflow-summary', 'lark-workflow-standup',
  'sh-agy-boost', 'sh-agy-goal', 'sh-agy-plan',
  'sh-zed-lsp-config', 'sh-zed-lsp-install',
  'redis-core', 'redis-search', 'redis-security',
  'code-review', 'tdd', 'research'
];
const skills = names.map((name) => ({ name, description: 'd', path: `C:/Users/me/.agents/skills/${name}/SKILL.md` }));

// --- 1. Default state: ALL branches open -------------------------------------
let h = harness(skills);
h.render();
let buttons = h.all(h.tree(), 'button').filter((b) => b.props.className?.includes('skp_groupHead'));
const expanded = buttons.filter((b) => b.props['aria-expanded'] === 'true');
check('default: all branch headers read as expanded', expanded.length, buttons.length);
check('default: every skill row is rendered', names.every((n) => h.text(h.tree()).includes(n)), true);

// --- 2. Clicking a branch collapses it independently -------------------------
const lark = buttons.find((b) => h.text(b).startsWith('Lark'));
lark.props.onClick();
buttons = h.all(h.tree(), 'button').filter((b) => b.props.className?.includes('skp_groupHead'));
const larkAfter = buttons.find((b) => h.text(b).startsWith('Lark'));
check('click branch: Lark is collapsed', larkAfter.props['aria-expanded'], 'false');
check('click branch: Lark rows are hidden', h.text(h.tree()).includes('lark-doc'), false);
check('click branch: Sh branches remain expanded', h.text(h.tree()).includes('sh-agy-boost'), true);
check('click branch: Redis branches remain expanded', h.text(h.tree()).includes('redis-core'), true);

// --- 3. Clicking the branch again re-expands it -----------------------------
larkAfter.props.onClick();
buttons = h.all(h.tree(), 'button').filter((b) => b.props.className?.includes('skp_groupHead'));
const larkReopened = buttons.find((b) => h.text(b).startsWith('Lark'));
check('click again: Lark is re-expanded', larkReopened.props['aria-expanded'], 'true');
check('click again: Lark rows are visible again', h.text(h.tree()).includes('lark-doc'), true);

// --- 4. Sub-branch collapsing (Lark -> Workflow) -----------------------------
const wf = buttons.find((b) => h.text(b).startsWith('Workflow'));
check('sub-branch: Workflow is found', wf !== undefined, true);
wf.props.onClick();
buttons = h.all(h.tree(), 'button').filter((b) => b.props.className?.includes('skp_groupHead'));
const wfAfter = buttons.find((b) => h.text(b).startsWith('Workflow'));
check('sub-branch: Workflow is collapsed', wfAfter.props['aria-expanded'], 'false');
check('sub-branch: Lark parent remains expanded', buttons.find((b) => h.text(b).startsWith('Lark')).props['aria-expanded'], 'true');
check('sub-branch: Lark direct leaves still visible', h.text(h.tree()).includes('lark-doc'), true);
check('sub-branch: Workflow children are hidden', h.text(h.tree()).includes('lark-workflow-summary'), false);

// --- 5. Multiple sources (User + Builtin) ------------------------------------
h = harness([
  ...skills,
  { name: 'office-docx', description: 'd', path: 'D:/app/resources/runtime/office-skills/office-docx/SKILL.md' },
  { name: 'office-pptx', description: 'd', path: 'D:/app/resources/runtime/office-skills/office-pptx/SKILL.md' }
]);
h.render();
const heads = () => h.all(h.tree(), 'button').filter((b) => b.props.className?.includes('skp_groupHead'));
const sourceUser = heads().find((b) => h.text(b).startsWith('sourceUser'));
const sourceBuiltin = heads().find((b) => h.text(b).startsWith('sourceBuiltin'));
check('sources: user section rendered and expanded', sourceUser?.props['aria-expanded'], 'true');
check('sources: builtin section rendered and expanded', sourceBuiltin?.props['aria-expanded'], 'true');

// Collapse builtin section
sourceBuiltin.props.onClick();
const builtinAfter = heads().find((b) => h.text(b).startsWith('sourceBuiltin'));
check('sources: builtin collapsed', builtinAfter?.props['aria-expanded'], 'false');
check('sources: user remains expanded', heads().find((b) => h.text(b).startsWith('sourceUser'))?.props['aria-expanded'], 'true');

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll render checks passed.');
}
