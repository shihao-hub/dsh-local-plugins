/**
 * Render the flat list as text, so the grouping can be reviewed without a
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
for (const section of sections) {
  total += section.skills.length;
  console.log(`\n■ ${section.label} — ${section.skills.length} 项`);
  for (const skill of section.skills) console.log(`    • ${skill.name}`);
}

console.log(`\n合计 ${total} / 输入 ${skills.length}`);
console.log('结构：来源分组 + 组内平铺（无命名空间树）');
