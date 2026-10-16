#!/usr/bin/env node
/**
 * Regression test for the rider-theme row's appearance semantics.
 *
 * The palette is dark-only and rides a plugin-owned override layer, so it may
 * only paint while the base scheme is dark: the layer is mounted and withdrawn
 * with `active.colorScheme`, which keeps Light/Dark/System coherent instead of
 * leaving dark alias tokens under light structural rules. A light base while the
 * switch is on has two causes the row must tell apart — the user picked Light
 * (their newer intent wins, nothing is written), or the durable preference write
 * was refused because the Host settings document is unwritable while another
 * program holds the file open.
 *
 * The test drives the real client.js with hand-rolled React/theme/ctx stubs:
 * no DOM, no jsdom, no dependencies.
 *
 * Usage: node rider-theme/design/test-persist-notice.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(HERE, '..', 'client.js');

/** Inline React stub: one mounted instance, state setter re-renders, effects run once. */
const createReactStub = () => {
  let mounting = null;
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const instance = mounting;
      const index = instance.hook;
      instance.hook += 1;
      if (instance.states.length <= index) instance.states[index] = initial;
      return [
        instance.states[index],
        (next) => {
          instance.states[index] = typeof next === 'function' ? next(instance.states[index]) : next;
          instance.render();
        }
      ];
    },
    useEffect(effect) {
      // Every declaration in client.js uses `[]` deps, so effects run once, after
      // the first render — collecting them only on the first pass keeps the list
      // stable while a setState from inside an effect re-renders the component.
      if (mounting.firstPass) mounting.effects.push(effect);
    },
    /** Mount one component and return its instance. */
    mount(Component) {
      const instance = { hook: 0, states: [], effects: [], firstPass: true, tree: null };
      instance.render = () => {
        mounting = instance;
        instance.hook = 0;
        instance.tree = Component();
        mounting = null;
        if (!instance.firstPass) return;
        instance.firstPass = false;
        for (const effect of [...instance.effects]) effect();
      };
      instance.render();
      return instance;
    }
  };
};

/** Collect the client module plus the ctx facsimile it was applied to. */
const loadPlugin = () => {
  const React = createReactStub();
  const source = readFileSync(CLIENT_PATH, 'utf8');
  const localStorage = new Map();
  const sandboxWindow = {
    localStorage: {
      getItem: (key) => (localStorage.has(key) ? localStorage.get(key) : null),
      setItem: (key, value) => localStorage.set(key, String(value)),
      removeItem: (key) => localStorage.delete(key)
    },
    __ModuleLoader__: { load: (mod) => (module = mod.factory(require)) }
  };
  const require = (id) => {
    if (id === 'react') return React;
    throw new Error(`unexpected require("${id}") while testing client.js`);
  };
  let module;
  new Function('window', source)(sandboxWindow);
  if (module === undefined) throw new Error('client.js did not call window.__ModuleLoader__.load');
  return { module, React, localStorage };
};

/** Theme service facsimile: registry, override layers, snapshot, writes and change events. */
const createTheme = (THEME_ID) => {
  const listeners = new Set();
  const registered = new Set(['light', 'dark']);
  const writes = [];
  const state = { snapshot: { preference: 'system', active: { id: 'light', colorScheme: 'light' } }, layers: 0 };
  return {
    get layers() {
      return state.layers;
    },
    get writes() {
      return writes;
    },
    get preference() {
      return state.snapshot.preference;
    },
    get colorScheme() {
      return state.snapshot.active.colorScheme;
    },
    getTheme: () => state.snapshot,
    register(definition) {
      if (registered.has(definition.id)) throw new Error(`theme "${definition.id}" is already registered`);
      registered.add(definition.id);
      return () => registered.delete(definition.id);
    },
    overrideTokens() {
      state.layers += 1;
      return () => {
        state.layers -= 1;
      };
    },
    setTheme(id) {
      if (id !== 'system' && !registered.has(id)) throw new Error(`theme "${id}" is not registered`);
      writes.push(id);
      state.snapshot = { preference: id, active: { id, colorScheme: id === THEME_ID || id === 'dark' ? 'dark' : 'light' } };
      for (const notify of listeners) notify(state.snapshot);
    },
    /** Simulate ThemeRuntime.adopt() re-reading whatever the durable preference is. */
    adopt(preference, colorScheme) {
      state.snapshot = { preference, active: { id: preference, colorScheme } };
      for (const notify of listeners) notify(state.snapshot);
    },
    onThemeChange(handler) {
      listeners.add(handler);
    }
  };
};

/** ctx facsimile: effects run eagerly, slots/on are captured, locale misses are recorded. */
const createContext = (theme) => {
  const captured = { row: null };
  const dictionaries = new Map();
  const missingKeys = [];
  const ctx = {
    theme,
    slots: {
      inject: (_slot, register) => register(),
      register: (_options, component) => {
        captured.row = component;
        return () => {
          captured.row = null;
        };
      }
    },
    locale: {
      register: (ns, tables) => {
        dictionaries.set(ns, tables);
        return () => {};
      },
      bind: (ns) => (key) => {
        const tables = dictionaries.get(ns) ?? {};
        const value = tables.zh?.[key] ?? tables.en?.[key];
        if (value === undefined) missingKeys.push(key);
        return value ?? key;
      }
    },
    on: (event, handler) => {
      if (event === 'theme/change') theme.onThemeChange(handler);
      return () => {};
    },
    effect: (callback) => {
      const cleanup = callback();
      return typeof cleanup === 'function' ? cleanup : () => {};
    }
  };
  return { ctx, captured, dictionaries, missingKeys };
};

const treeHas = (node, predicate) => {
  if (node === null || node === undefined || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((child) => treeHas(child, predicate));
  if (predicate(node)) return true;
  return (node.children ?? []).some((child) => treeHas(child, predicate));
};

const isWarning = (node) => typeof node.props?.className === 'string' && node.props.className.includes('rdt_warn');
const switchOf = (node) => {
  if (node === null || typeof node !== 'object') return null;
  if (!Array.isArray(node) && node.props?.role === 'switch') return node;
  for (const child of Array.isArray(node) ? node : node.children ?? []) {
    const found = switchOf(child);
    if (found !== null) return found;
  }
  return null;
};

const checks = [];
const check = (label, pass) => {
  checks.push({ label, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
};

const { module, React, localStorage } = loadPlugin();
const { noticeFor, THEME_ID, ENABLED_KEY } = module.__test;

// 1. Verdict table: a light base while enabled is reported, and the two causes
//    (the user picked Light vs. the preference write did not stick) stay apart.
const snapshot = (colorScheme, preference) => ({ preference, active: { colorScheme } });
check('off + light base -> no notice', noticeFor(false, snapshot('light', 'light')) === null);
check('on + dark base -> no notice', noticeFor(true, snapshot('dark', 'dark')) === null);
check('on + light base picked by the user -> light-base', noticeFor(true, snapshot('light', 'light')) === 'light-base');
check(
  'on + light base after a refused write -> persist-failed',
  noticeFor(true, snapshot('light', 'system')) === 'persist-failed'
);
check(
  'on + dark base after adoption -> no notice',
  noticeFor(true, snapshot('dark', 'dark')) === null
);

// 2. Wiring: the layer follows the base scheme, so Light/Dark/System can never
//    leave a dark palette under light structural rules.
const theme = createTheme(THEME_ID);
const { ctx, captured, dictionaries, missingKeys } = createContext(theme);
module.apply(ctx);
if (captured.row === null) throw new Error('the row was not registered into settings.general.item');
const row = React.mount(captured.row);
check('row starts without a warning', !treeHas(row.tree, isWarning));

switchOf(row.tree).props.onClick();
check('switch on mounts the layer on the dark base', theme.layers === 1);
check('applied preference targets rider-dark', theme.preference === THEME_ID);
check('no warning while the base is dark', !treeHas(row.tree, isWarning));

// The user then picks Light in the built-in Appearance row: newer intent wins.
theme.adopt('light', 'light');
check('picking Light withdraws the layer', theme.layers === 0);
check('picking Light announces why the palette is off', treeHas(row.tree, isWarning));
check(
  'the notice is announced as a live status',
  treeHas(row.tree, (node) => isWarning(node) && node.props.role === 'status')
);
check('the user keeps their enable setting', localStorage.get(ENABLED_KEY) === '1');
check('picking Light does not fight the user preference', theme.preference === 'light');

// Switching back to Dark brings the palette back with no extra interaction.
theme.adopt('dark', 'dark');
check('picking Dark re-mounts the layer', theme.layers === 1);
check('picking Dark clears the notice', !treeHas(row.tree, isWarning));

// A refused preference write: the runtime adopts the old durable preference, the
// layer must come off rather than paint dark tokens on a light base.
theme.adopt('system', 'light');
check('a refused write withdraws the layer', theme.layers === 0);
check('a refused write shows the persist-failed notice', treeHas(row.tree, isWarning));

// Switching off stops writing a preference the user has since chosen.
const writesBefore = theme.writes.length;
theme.adopt('light', 'light');
switchOf(row.tree).props.onClick();
check('switching off keeps the layer off', theme.layers === 0);
check('switching off removes any warning', !treeHas(row.tree, isWarning));
check('switching off leaves a user-chosen preference alone', theme.writes.length === writesBefore);

// 3. Loading the page with the switch remembered as ON must not overrule a Light
//    the user picked since — the palette simply stays off until Dark is chosen.
const lightTheme = createTheme(THEME_ID);
lightTheme.adopt('light', 'light');
localStorage.set(ENABLED_KEY, '1');
const second = createContext(lightTheme);
module.apply(second.ctx);
const secondRow = React.mount(second.captured.row);
check('reload with Light adopted writes no preference', lightTheme.writes.length === 0);
check('reload with Light adopted mounts no layer', lightTheme.layers === 0);
check('reload with Light adopted explains the state', treeHas(secondRow.tree, isWarning));
switchOf(secondRow.tree).props.onClick();
switchOf(secondRow.tree).props.onClick();
check('flipping the switch on asks for the dark base', lightTheme.writes.includes('dark'));

// 4. Every key the row actually asked for must exist, in both languages.
check('every rendered row key resolves', missingKeys.length === 0);
const tables = dictionaries.get('rider-theme') ?? {};
const zhKeys = Object.keys(tables.zh ?? {}).sort();
const enKeys = Object.keys(tables.en ?? {}).sort();
check('zh and en dictionaries expose the same keys', zhKeys.join(',') === enKeys.join(','));

const failed = checks.filter((entry) => !entry.pass).length;
console.log(`\n${failed === 0 ? 'OK' : 'FAIL'}: ${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
