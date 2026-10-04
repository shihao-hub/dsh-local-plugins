/**
 * Render the namespace tree as text, so the grouping can be reviewed without a
 * browser. Uses the same pure helpers the panel does, loaded from ../client.js.
 *
 * Run: node design/preview-tree.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');
let factory;
globalThis.window = { __ModuleLoader__: { load: ({ factory: f }) => (factory = f) }, localStorage: { getItem: () => null, setItem() {} } };
const inert = () => null;
const React = { createElement: () => null, useState: (v) => [v, inert], useRef: () => ({}), useEffect: inert };
new Function('window', 'require', source)(globalThis.window, (id) => (id === 'react' ? React : createRequire(import.meta.url)(id)));
const T = factory((id) => (id === 'react' ? React : createRequire(import.meta.url)(id))).__test;

const labels = {
  groupOther: '其他',
  sourceBuiltin: '系统内置',
  sourceUser: '用户安装',
  sourceWorkspace: '当前工作区'
};
const t = (key) => labels[key] ?? key;

const root = process.env.DSH_TEST_SKILLS_ROOT ?? join(homedir(), '.agents', 'skills');
const names = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  .map((e) => e.name)
  .sort();

const skills = names.map((name) => ({ name, path: `${root.replace(/\\/g, '/')}/${name}/SKILL.md` }));
for (const name of ['office-docx', 'office-pptx', 'office-xlsx']) {
  skills.push({ name, path: `D:/app/resources/runtime/office-skills/${name}/SKILL.md` });
}
skills.push({ name: 'dsh-badge', path: 'dsh-resource://asset/dsh-badge' });

const sections = T.groupedSkills(skills, process.cwd(), t);

let total = 0;
const render = (nodes, depth) => {
  for (const node of nodes) {
    const pad = '  '.repeat(depth);
    if (node.prefix === '') {
      total += node.skills.length;
      console.log(`${pad}▸ ${node.label} (${node.skills.length})   ← 兜底，永远显示`);
      for (const skill of node.skills) console.log(`${pad}    • ${skill.name}`);
      continue;
    }
    const size = T.countSkills(node);
    total += node.skills.length;
    console.log(`${pad}▾ ${node.label} (${size})`);
    for (const skill of node.skills) console.log(`${pad}    • ${skill.name}`);
    render(node.children, depth + 1);
  }
};

for (const section of sections) {
  const size = section.children.reduce((sum, child) => sum + T.countSkills(child), 0);
  console.log(`\n■ ${section.label} — ${size} 项`);
  render(section.children, 1);
}

console.log(`\n合计 ${total} / 输入 ${skills.length}`);
console.log('默认行为：全部树形节点默认展开 (All expanded by default)');
