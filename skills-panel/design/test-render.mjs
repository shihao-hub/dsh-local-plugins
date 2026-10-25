/**
 * Render the panel's element tree in Node, with a stateful React mock, and
 * assert the flat layout: one collapsible section per source, one row per
 * skill, no nested namespace branches.
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

  const heads = () => all(tree, 'button').filter((b) => b.props.className?.includes('skp_groupHead'));

  return { render, tree: () => tree, all, text, store, Panel, heads };
}

const names = ['lark-doc', 'lark-sheets', 'sh-agy-boost', 'code-review', 'tdd', 'research'];
const skills = names.map((name) => ({ name, description: 'd', path: `C:/Users/me/.agents/skills/${name}/SKILL.md` }));

// --- 1. Default state: flat rows under a single source section ---------------
let h = harness(skills);
h.render();
check('default: exactly one source section', h.heads().length, 1);
check('default: that section is expanded', h.heads()[0].props['aria-expanded'], 'true');
check('default: every skill row is rendered', names.every((n) => h.text(h.tree()).includes(n)), true);
check(
  'default: no nested namespace sections (only one skp_group)',
  h.all(h.tree(), 'section').filter((s) => s.props.className === 'skp_group').length,
  1
);
check(
  'default: rows live in a single flat list',
  h.all(h.tree(), 'ul').filter((u) => u.props.className === 'skp_list').length,
  1
);
check(
  'default: rows are rendered in name order',
  h.all(h.tree(), 'summary').map((s) => h.text(s.children[0])),
  ['code-review', 'lark-doc', 'lark-sheets', 'research', 'sh-agy-boost', 'tdd']
);

// --- 2. Clicking the source header collapses it ------------------------------
h.heads()[0].props.onClick();
check('click: source section is collapsed', h.heads()[0].props['aria-expanded'], 'false');
check('click: its rows are hidden', names.some((n) => h.text(h.tree()).includes(n)), false);

// --- 3. Clicking again re-expands it ----------------------------------------
h.heads()[0].props.onClick();
check('click again: source section is expanded', h.heads()[0].props['aria-expanded'], 'true');
check('click again: rows are visible again', h.text(h.tree()).includes('lark-doc'), true);

// --- 4. User + builtin sections are independent ------------------------------
h = harness([
  ...skills,
  { name: 'office-docx', description: 'd', path: 'D:/app/resources/runtime/office-skills/office-docx/SKILL.md' },
  { name: 'office-pptx', description: 'd', path: 'D:/app/resources/runtime/office-skills/office-pptx/SKILL.md' }
]);
h.render();
check('sources: user and builtin sections both rendered', h.heads().length, 2);
check('sources: user section leads and is expanded', h.heads()[0].props['aria-expanded'], 'true');
check('sources: builtin section follows and is expanded', h.heads()[1].props['aria-expanded'], 'true');

h.heads()[1].props.onClick();
check('sources: builtin collapsed', h.heads()[1].props['aria-expanded'], 'false');
check('sources: builtin rows hidden', h.text(h.tree()).includes('office-docx'), false);
check('sources: user rows remain', h.text(h.tree()).includes('lark-doc'), true);
check('sources: user section still expanded', h.heads()[0].props['aria-expanded'], 'true');

// --- 5. Workspace section appears only in the "all" view ---------------------
h = harness([
  { name: 'ws-local', description: 'd', path: 'C:/work/proj/.agents/skills/ws-local/SKILL.md' },
  ...skills
]);
h.render();
check('workspace: default view hides workspace-only skills', h.heads().length, 1);

const viewBtn = h.all(h.tree(), 'button').find((b) => String(b.props.className).includes('skp_viewBtn'));
check('workspace: the view switch is present', viewBtn !== undefined, true);
viewBtn.props.onClick();
check('workspace: switching to all reveals the workspace section', h.heads().length, 2);
check('workspace: workspace section leads', h.text(h.heads()[0]).includes('sourceWorkspace'), true);
check(
  'workspace: its flat row is present',
  h.all(h.tree(), 'summary').some((s) => h.text(s.children[0]) === 'ws-local'),
  true
);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll render checks passed.');
}
