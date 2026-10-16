#!/usr/bin/env node
/**
 * Regression test for the half-applied-palette notice in the rider-theme row.
 *
 * The palette rides a plugin-owned override layer, so it paints even when the
 * durable appearance preference cannot be written (the Host settings document is
 * unwritable while an editor holds the file). The base scheme then stays light
 * and only half the theme shows, which is what the row has to announce instead
 * of looking silently broken.
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

/** Theme service facsimile: registry, override layers, snapshot and change events. */
const createTheme = (THEME_ID) => {
  const listeners = new Set();
  const registered = new Set(['light', 'dark']);
  const state = { snapshot: { preference: 'system', active: { id: 'light', colorScheme: 'light' } }, layers: 0 };
  return {
    get layers() {
      return state.layers;
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
      state.snapshot = { preference: id, active: { id, colorScheme: id === THEME_ID || id === 'dark' ? 'dark' : 'light' } };
      for (const notify of listeners) notify(state.snapshot);
    },
    /** Simulate ThemeRuntime.adopt() re-reading a durable preference that never moved. */
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

const { module, React } = loadPlugin();
const { persistNotice, THEME_ID } = module.__test;

// 1. Verdict table: only "switch on + light base" is a defect.
check('off + light base -> no notice', persistNotice(false, { active: { colorScheme: 'light' } }) === null);
check('on + dark base -> no notice', persistNotice(true, { active: { colorScheme: 'dark' } }) === null);
check(
  'on + light base -> persist-failed',
  persistNotice(true, { active: { colorScheme: 'light' } }) === 'persist-failed'
);

// 2. Wiring: a rejected preference write must surface the warning, and switching
//    off (or a base that ends up dark) must take it back.
const theme = createTheme(THEME_ID);
const { ctx, captured, dictionaries, missingKeys } = createContext(theme);
module.apply(ctx);
if (captured.row === null) throw new Error('the row was not registered into settings.general.item');
const row = React.mount(captured.row);
check('row starts without a warning', !treeHas(row.tree, isWarning));

switchOf(row.tree).props.onClick();
check('switch on keeps the layer applied', theme.layers === 1);
check('applied preference targets rider-dark', theme.preference === THEME_ID);
check('no warning while the base is dark', !treeHas(row.tree, isWarning));

// The durable write is refused, so the runtime adopts the old preference again.
theme.adopt('system', 'light');
check('warning appears once the base falls back to light', treeHas(row.tree, isWarning));
check(
  'warning is announced as a live status',
  treeHas(row.tree, (node) => isWarning(node) && node.props.role === 'status')
);
check('palette layer still applied in the half-applied state', theme.layers === 1);

// A later write that does land must clear the warning again.
theme.adopt('dark', 'dark');
check('warning clears when the base becomes dark again', !treeHas(row.tree, isWarning));

switchOf(row.tree).props.onClick();
check('switching off removes the override layer', theme.layers === 0);
check('switching off removes any warning', !treeHas(row.tree, isWarning));

// 3. Every key the row actually asked for must exist, in both languages.
check('every rendered row key resolves', missingKeys.length === 0);
const tables = dictionaries.get('rider-theme') ?? {};
const zhKeys = Object.keys(tables.zh ?? {}).sort();
const enKeys = Object.keys(tables.en ?? {}).sort();
check('zh and en dictionaries expose the same keys', zhKeys.join(',') === enKeys.join(','));

const failed = checks.filter((entry) => !entry.pass).length;
console.log(`\n${failed === 0 ? 'OK' : 'FAIL'}: ${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
