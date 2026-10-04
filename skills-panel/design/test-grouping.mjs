import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, '..', 'client.js');

const source = readFileSync(clientPath, 'utf8');
let factory;
globalThis.window = {
  __ModuleLoader__: {
    load({ factory: captured }) {
      factory = captured;
    }
  },
  localStorage: {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null;
    },
    setItem(key, value) {
      this.store.set(key, value);
    }
  }
};
if (typeof globalThis.process === 'undefined') globalThis.process = { env: {} };

const requireShim = createRequire(import.meta.url);
const inert = () => null;
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, inert],
  useRef: () => ({ current: null }),
  useEffect: inert
};
new Function('window', 'require', source)(globalThis.window, (id) => (id === 'react' ? React : requireShim(id)));
const mod = factory((id) => (id === 'react' ? React : requireShim(id)));
const T = mod.__test;

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual) ?? String(actual);
  const e = JSON.stringify(expected) ?? String(expected);
  const ok = a === e;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${a}\n  expected ${e}`);
  } else {
    console.log(`ok   ${label}  ${a.length > 96 ? a.slice(0, 93) + '...' : a}`);
  }
}

const t = (key) => key;

// 1. Root recovery is derived from the paths themselves
const roots = T.skillRootsFor(
  [
    { name: 'a', path: 'C:/Users/me/.agents/skills/a/SKILL.md' },
    { name: 'b', path: 'C:/work/proj/.agents/skills/b/SKILL.md' },
    { name: 'c', path: 'C:/Users/me/.dsh/skills/c/SKILL.md' },
    { name: 'office-docx', path: 'D:/app/resources/runtime/office-skills/office-docx/SKILL.md' }
  ],
  'C:/work/proj'
);
check(
  'roots: user, project and bundled are all recovered from paths',
  ['bundled', 'projectAgents', 'projectDsh', 'userAgents', 'userDsh'].every((id) =>
    roots.some((root) => root.id === id)
  ),
  true
);
check('source: a user root path reads as user', T.sourceOf('C:/Users/me/.agents/skills/a/SKILL.md', roots), 'user');
check('source: the user DSH root also reads as user', T.sourceOf('C:/Users/me/.dsh/skills/a/SKILL.md', roots), 'user');
check('source: a project root path reads as workspace', T.sourceOf('C:/work/proj/.agents/skills/b/SKILL.md', roots), 'workspace');
check('source: the app resources path reads as builtin', T.sourceOf('D:/app/resources/runtime/office-skills/office-docx/SKILL.md', roots), 'builtin');
check('source: an undefined path reads as builtin', T.sourceOf(undefined, roots), 'builtin');
check('source: backslashes and case fold', T.sourceOf('C:\\Users\\ME\\.agents\\skills\\a\\SKILL.md', roots), 'user');

// Robustness: when cwd is user home itself, ~/.agents/skills must NOT be usurped as workspace!
const rootsWhenCwdIsHome = T.skillRootsFor(
  [{ name: 'a', path: 'C:/Users/29580/.agents/skills/a/SKILL.md' }],
  'C:/Users/29580'
);
check('roots: cwd as user home does not register project roots', rootsWhenCwdIsHome.some((r) => r.id === 'projectAgents'), false);
check('source: global skill remains user even when cwd is home', T.sourceOf('C:/Users/29580/.agents/skills/a/SKILL.md', rootsWhenCwdIsHome), 'user');

// 2. Segment tree recursive walk
const fixture = [
  'lark-doc',
  'lark-sheets',
  'zed-lsp-config',
  'zed-lsp-install',
  'solo-one',
  'solo-two'
];
const tree = T.buildSegmentTree(fixture.map((name) => ({ name, path: 'x' })), 0, 'user');
const collect = (nodes, acc) => {
  for (const node of nodes) {
    for (const skill of node.skills) acc.add(skill.name);
    collect(node.children, acc);
  }
  return acc;
};
const inTree = collect(tree.children, new Set());
for (const skill of tree.remainder) inTree.add(skill.name);
check('tree: every name survives the walk', inTree.size, fixture.length);
check(
  'tree: a name whose segments end at the parent stays a leaf there',
  tree.children.find((c) => c.id === 'user/lark').skills.map((s) => s.name).sort(),
  ['lark-doc', 'lark-sheets']
);
check(
  'tree: a shared deeper segment nests one level further',
  tree.children.find((c) => c.id === 'user/zed').children.map((c) => c.id.split('/').pop() + ':' + c.skills.length),
  ['lsp:2']
);
check('tree: two names sharing a segment do form a branch', tree.children.some((c) => c.id === 'user/solo'), true);
check('label: an unknown abbreviation is title-cased', T.segmentLabel('wibble'), 'Wibble');
check('label: a known abbreviation expands', T.segmentLabel('agy'), 'Antigravity');
check('label: Zed abbreviation expands', T.segmentLabel('zed'), 'Zed');

// 3. filterSkills
const sample = [
  { name: 'alpha', description: 'Nothing here', whenToUse: undefined },
  { name: 'beta', description: 'Mentions Zed editor', whenToUse: undefined },
  { name: 'gamma', description: 'plain', whenToUse: 'Use for ZED projects' }
];
check('filter: empty query keeps everything', T.filterSkills(sample, '   ').length, 3);
check(
  'filter: matches description and whenToUse, case-insensitive',
  T.filterSkills(sample, 'zed').map((s) => s.name),
  ['beta', 'gamma']
);
check('filter: no match', T.filterSkills(sample, 'nope').length, 0);

// 4. fileAddressFor protocol correctness (aligns with DSH official specification)
check(
  'fileAddress: adheres to dsh-resource://file/session/<id>/<path>',
  T.fileAddressFor('s1', 'C:/work/proj', 'C:/Users/29580/.agents/skills/sh-test/SKILL.md'),
  'dsh-resource://file/session/s1/C:/Users/29580/.agents/skills/sh-test/SKILL.md'
);
check(
  'fileAddress: strips workspace prefix for relative session path',
  T.fileAddressFor('s1', 'C:/work/proj', 'C:/work/proj/.agents/skills/local/SKILL.md'),
  'dsh-resource://file/session/s1/.agents/skills/local/SKILL.md'
);

// 5. getSkillDir
check(
  'getSkillDir: strips SKILL.md to return parent directory',
  T.getSkillDir('C:/Users/29580/.agents/skills/sh-test/SKILL.md'),
  'C:/Users/29580/.agents/skills/sh-test'
);
check(
  'getSkillDir: preserves plain directory path',
  T.getSkillDir('C:/Users/29580/.agents/skills/sh-test'),
  'C:/Users/29580/.agents/skills/sh-test'
);

// 6. Resilient global cache merge across sessions
T.globalSkillsCache.clear();
const initialSkills = [
  { name: 'user-skill-1', path: 'C:/Users/29580/.agents/skills/user-skill-1/SKILL.md' },
  { name: 'builtin-1', path: 'C:/app/resources/runtime/office-skills/builtin-1/SKILL.md' }
];
T.mergeWithGlobalCache(initialSkills, 'C:/work/projectA');
check('cache: global skills cached', T.globalSkillsCache.size, 2);

// Switch to a new session that returns empty or workspace-only skills
const emptySessionSkills = [
  { name: 'ws-skill', path: 'C:/work/projectB/.agents/skills/ws-skill/SKILL.md' }
];
const merged = T.mergeWithGlobalCache(emptySessionSkills, 'C:/work/projectB');
check('cache: user-installed skill survives empty/different session', merged.some((s) => s.name === 'user-skill-1'), true);
check('cache: total count includes workspace and cached global', merged.length, 3);

// 7. Live directory pass
const liveRoot = process.env.DSH_TEST_SKILLS_ROOT ?? join(homedir(), '.agents', 'skills');
let realNames = [];
try {
  realNames = readdirSync(liveRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  console.log('(live pass: ' + realNames.length + ' skills read from ' + liveRoot + ')');
} catch (error) {
  console.log('(skipping live pass: ' + error.message + ')');
}

if (realNames.length > 0) {
  const liveBase = liveRoot.replace(/\\/g, '/');
  const skills = realNames.map((name) => ({
    name,
    description: 'd',
    path: liveBase + '/' + name + '/SKILL.md'
  }));
  const bundled = [
    { name: 'office-docx', description: 'd', path: 'D:/app/resources/runtime/office-skills/office-docx/SKILL.md' },
    { name: 'office-pptx', description: 'd', path: 'D:/app/resources/runtime/office-skills/office-pptx/SKILL.md' },
    { name: 'office-xlsx', description: 'd', path: 'D:/app/resources/runtime/office-skills/office-xlsx/SKILL.md' },
    { name: 'dsh-badge', description: 'd', path: undefined }
  ];
  const all = [...skills, ...bundled];

  const sections = T.groupedSkills(all, 'C:/work/proj', t);
  check('live: user and bundled produce two sections', sections.length, 2);
  check('live: the user section leads', sections[0].id, 'user');
  check('live: the bundled section follows', sections[1].id, 'builtin');

  const walked = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      for (const skill of node.skills) walked.push(skill.name);
      walk(node.children);
    }
  };
  for (const section of sections) {
    for (const child of section.children) {
      for (const skill of child.skills) walked.push(skill.name);
      walk(child.children);
    }
  }
  check('live: every skill is accounted for', walked.length, all.length);
  check('live: no skill appears twice', new Set(walked).size, all.length);
  check('live: no skill is missing', all.filter((s) => !walked.includes(s.name)).length, 0);

  const inBuiltin = [];
  const gather = (nodes) => {
    for (const node of nodes) {
      for (const skill of node.skills) inBuiltin.push(skill.name);
      gather(node.children);
    }
  };
  for (const child of sections[1].children) {
    for (const skill of child.skills) inBuiltin.push(skill.name);
    gather(child.children);
  }
  check(
    'live: the office skills are classified as builtin',
    inBuiltin.filter((name) => name.startsWith('office-')).sort(),
    ['office-docx', 'office-pptx', 'office-xlsx']
  );
}

if (failures > 0) {
  console.log(failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED.');
}
