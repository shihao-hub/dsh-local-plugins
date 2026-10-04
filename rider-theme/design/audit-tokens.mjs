#!/usr/bin/env node
/**
 * Token coverage audit for the rider-theme plugin.
 *
 * The upstream theme package validates nothing about a third-party token set
 * ("注册主题意味着覆盖同名别名变量；目前不会验证一组覆盖是否完整"), so a missed
 * token shows up as a patch of stock colour rather than as an error. This script
 * closes that gap by diffing the plugin's override map against the real
 * `--dsw-*` inventory extracted from the running DSH bundle.
 *
 * Usage:
 *   node rider-theme/design/audit-tokens.mjs [path/to/app.asar]
 *
 * Exit code 0 when every colour-carrying token is covered and no override names
 * an unknown token; 1 otherwise.
 */
import { openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(HERE, '..', 'client.js');
const DEFAULT_ASAR = 'D:\\Users\\29580\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';
const ASAR_PATH = process.argv[2] ?? DEFAULT_ASAR;
const THEME_ENTRY = 'dsh-client-ui-theme/lib/client.js';

/** Token families that carry no colour, so the theme must not override them. */
const NON_COLOUR = [
  /^--dsw-font-/,
  /^--dsw-radius-/,
  /^--dsw-shadow-/,
  /^--dsw-elevation-(panel|prominent|soft|stroke)$/,
  /^--dsw-gradient-/,
  /^--dsw-linear-/,
  /^--dsw-mask-blur$/,
  /^--dsw-corner-shape$/,
  /^--dsw-focus-ring-width$/,
  /^--dsw-menu-backdrop-filter$/,
  /^--dsw-static-/
];

/**
 * Colour tokens deliberately left at their stock value: the modal/skeleton
 * scrims are black overlays that read correctly on any dark palette.
 */
const STOCK_ON_PURPOSE = new Set([
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-bg-mask-2',
  '--dsw-alias-bg-mask-3',
  '--dsw-alias-bg-mask-drop',
  '--dsw-alias-bg-mask-photo'
]);

/** Load client.js in a sandbox and capture the module it registers. */
const loadPlugin = () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  const react = {
    createElement: () => null,
    useState: (initial) => [initial, () => {}],
    useEffect: () => {}
  };
  const require = (id) => {
    if (id === 'react') return react;
    throw new Error(`unexpected require("${id}") while auditing client.js`);
  };
  let captured;
  const sandboxWindow = {
    __ModuleLoader__: {
      load: (mod) => {
        captured = mod.factory(require);
      }
    }
  };
  new Function('window', source)(sandboxWindow);
  if (captured === undefined) throw new Error('client.js did not call window.__ModuleLoader__.load');
  return captured;
};

/** Read the live `--dsw-*` inventory out of the packaged theme bundle. */
const readInventory = (asarPath) => {
  const fd = openSync(asarPath, 'r');
  try {
    const sizeBuf = Buffer.alloc(8);
    readSync(fd, sizeBuf, 0, 8, 0);
    const headerSize = sizeBuf.readUInt32LE(4);
    const headerBuf = Buffer.alloc(headerSize);
    readSync(fd, headerBuf, 0, headerSize, 8);
    const jsonLen = headerBuf.readUInt32LE(4);
    const header = JSON.parse(headerBuf.toString('utf8', 8, 8 + jsonLen));

    let entry;
    (function walk(node, prefix) {
      if (!node.files) return;
      for (const [name, child] of Object.entries(node.files)) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (child.files) walk(child, path);
        else if (path.includes(THEME_ENTRY)) entry = { path, size: child.size, offset: Number(child.offset) };
      }
    })(header, '');
    if (entry === undefined) throw new Error(`${THEME_ENTRY} not found in ${asarPath}`);

    const buf = Buffer.alloc(entry.size);
    let read = 0;
    while (read < entry.size) {
      const n = readSync(fd, buf, read, entry.size - read, 8 + headerSize + entry.offset + read);
      if (n <= 0) break;
      read += n;
    }
    const names = new Set(buf.toString('utf8').match(/--dsw-[a-z0-9-]+/g) ?? []);
    return { path: entry.path, names: [...names].sort() };
  } finally {
    closeSync(fd);
  }
};

const plugin = loadPlugin();
const overrides = new Set(Object.keys(plugin.__test.TOKENS));
const shikiOverrides = new Set(plugin.__test.SHIKI_CSS.match(/--shiki-[a-z-]+(?=:)/g) ?? []);
const inventory = readInventory(ASAR_PATH);

const covered = [];
const missing = [];
const exempt = [];
const nonColour = [];

for (const name of inventory.names) {
  if (STOCK_ON_PURPOSE.has(name)) exempt.push(name);
  else if (NON_COLOUR.some((re) => re.test(name))) nonColour.push(name);
  else if (overrides.has(name)) covered.push(name);
  else missing.push(name);
}

const unknown = [...overrides].filter((name) => !inventory.names.includes(name)).sort();

const line = (label, value) => console.log(`${label.padEnd(34)}${value}`);

console.log(`inventory source                  ${ASAR_PATH}`);
console.log(`  entry                           ${inventory.path}`);
line('--dsw-* tokens in bundle', inventory.names.length);
line('  non-colour families', nonColour.length);
line('  stock on purpose', exempt.length);
line('colour tokens to cover', covered.length + missing.length);
line('  covered by rider-theme', covered.length);
line('  MISSING', missing.length);
line('override names not in bundle', unknown.length);
line('--shiki-* tokens overridden', shikiOverrides.size);

if (missing.length > 0) {
  console.log('\nmissing colour tokens:');
  for (const name of missing) console.log(`  ${name}`);
}
if (unknown.length > 0) {
  console.log('\noverride names the bundle does not define (silent no-ops):');
  for (const name of unknown) console.log(`  ${name}`);
}
if (exempt.length > 0) {
  console.log('\nleft at stock value on purpose:');
  for (const name of exempt) console.log(`  ${name}`);
}

const failed = missing.length > 0 || unknown.length > 0;
console.log(`\n${failed ? 'FAIL' : 'OK'}: ${covered.length} covered, ${missing.length} missing, ${unknown.length} unknown`);
process.exit(failed ? 1 : 0);
