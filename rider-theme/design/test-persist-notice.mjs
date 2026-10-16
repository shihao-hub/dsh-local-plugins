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
  /**
   * Minimal DOM. The row paints nothing itself, but the base it judges is the one the
   * presenter stamped, so `document.body` stays null (⇒ judge by the snapshot) until a
   * test attaches a body and flips `dom.dark`.
   */
  const dom = { dark: false, styles: new Map(), style: new Map() };
  const documentStub = {
    querySelector: (selector) => {
      const match = /data-plugin-css="([^"]+)"/.exec(selector);
      return match !== null && dom.styles.has(match[1]) ? { dataset: {} } : null;
    },
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    head: {
      appendChild: (tag) => {
        dom.styles.set(tag.dataset.pluginCss, tag);
      }
    },
    body: null
  };
  /**
   * The presenter's stamp plus the inline token variables it applies, in the shape
   * `renderedDarkBase()` and `palettePaintedWithoutLayer()` read them.
   */
  const attachedBody = () => ({
    hasAttribute: (name) => name === 'data-ds-dark-theme' && dom.dark,
    style: {
      getPropertyValue: (name) => dom.style.get(name) ?? '',
      removeProperty: (name) => {
        dom.style.delete(name);
      }
    }
  });
  const sandboxWindow = {
    document: documentStub,
    localStorage: {
      getItem: (key) => (localStorage.has(key) ? localStorage.get(key) : null),
      setItem: (key, value) => localStorage.set(key, String(value)),
      removeItem: (key) => localStorage.delete(key)
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle),
    __ModuleLoader__: { load: (mod) => (module = mod.factory(require)) }
  };
  const require = (id) => {
    if (id === 'react') return React;
    throw new Error(`unexpected require("${id}") while testing client.js`);
  };
  let module;
  // `document` is a bare global in client.js, so it has to be a parameter of the sandbox
  // function rather than a property of the fake window.
  new Function('window', 'document', source)(sandboxWindow, documentStub);
  if (module === undefined) throw new Error('client.js did not call window.__ModuleLoader__.load');
  return { module, React, localStorage, documentStub, dom, attachedBody };
};

/** Theme service facsimile: registry, override layers, snapshot, writes and change events. */
const createTheme = (THEME_ID, dom) => {
  const listeners = new Set();
  const registered = new Set(['light', 'dark']);
  const writes = [];
  const hostWrites = [];
  // The settings document as the Host would report it: the only place a preference
  // can actually be stored, so it decides whether a write landed or was refused.
  const document = { preference: 'system' };
  const state = { snapshot: { preference: 'system', active: { id: 'light', colorScheme: 'light' } }, layers: 0, overrideCalls: 0, overrides: new Map() };
  return {
    get layers() {
      return state.layers;
    },
    get overrideCalls() {
      return state.overrideCalls;
    },
    /** The Host's override registry, keyed by source — what `leftoverLayer()` inspects. */
    get overrides() {
      return state.overrides;
    },
    get writes() {
      return writes;
    },
    /** Writes that would reach the settings document (builtin preferences only). */
    get hostWrites() {
      return hostWrites;
    },
    get documentPreference() {
      return document.preference;
    },
    /** Simulate the Host storing (or refusing to store) a preference. */
    store(preference) {
      document.preference = preference;
    },
    getSnapshot: () => ({ value: { preference: document.preference, fontSize: 14 } }),
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
    /**
     * Stack a layer the way the Host does, and mirror both of its halves: the layer's token
     * values land in the body's inline variables (the presenter), and an older layer's
     * disposer is a no-op once the same source was re-overridden (the registry).
     */
    overrideTokens(source, tokens) {
      const entry = { tokens };
      state.overrides.set(source, entry);
      state.layers += 1;
      state.overrideCalls += 1;
      const applied = Object.entries(tokens ?? {});
      for (const [name, value] of applied) dom.style.set(name, typeof value === 'string' ? value : value.light);
      // The Host republishes synchronously on every override change, which is what makes the
      // leftover-layer replacement re-enter the row's own theme/change handler.
      for (const notify of listeners) notify(state.snapshot);
      return () => {
        if (state.overrides.get(source) !== entry) return;
        state.overrides.delete(source);
        state.layers -= 1;
        // The presenter is what retracts the variables, and it does so on its *next* apply —
        // which a late or re-entrant apply can push after the layer is gone. Leaving them
        // painted here is what the row's own scrub has to answer for.
        for (const notify of listeners) notify(state.snapshot);
      };
    },
    setTheme(id) {
      if (id !== 'system' && !registered.has(id)) throw new Error(`theme "${id}" is not registered`);
      writes.push(id);
      // Only builtin preferences reach the Host settings document; a registered
      // theme id is a client-only switch (that is what keeps `assertDark` loop-free).
      if (id === 'light' || id === 'dark' || id === 'system') hostWrites.push(id);
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
  const services = { theme, configForms: { get: () => theme } };
  const ctx = {
    theme,
    get: (name) => services[name],
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
/** Text of the first rendered warning line, or null when the row renders none. */
const warningText = (node) => {
  if (node === null || typeof node !== 'object') return null;
  if (!Array.isArray(node) && isWarning(node)) return node.children[0];
  for (const child of Array.isArray(node) ? node : node.children ?? []) {
    const found = warningText(child);
    if (found !== null) return found;
  }
  return null;
};
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
const settle = (ms = 750) => new Promise((resolve) => setTimeout(resolve, ms));

const { module, React, localStorage, documentStub, dom, attachedBody } = loadPlugin();
const { noticeFor, NOTICE_KEYS, THEME_ID, ENABLED_KEY, TOKENS, LAYER_SOURCE } = module.__test;

// 1. Verdict table: only "switch on and not painting" states carry a notice, and
//    the notice depends on whether a write was actually observed to fail.
const snapshot = (colorScheme, preference) => ({ preference, active: { colorScheme } });
check('off + light base -> no notice', noticeFor(false, false, snapshot('light', 'light')) === null);
check('on + dark base -> no notice', noticeFor(true, false, snapshot('dark', 'dark')) === null);
check('on + light base, nothing refused -> light-base', noticeFor(true, false, snapshot('light', 'light')) === 'light-base');
check('on + light base from Follow system -> system-base', noticeFor(true, false, snapshot('light', 'system')) === 'system-base');
check('on + dark base after a refusal -> not-saved', noticeFor(true, true, snapshot('dark', 'dark')) === 'not-saved');
check('on + light base after a refusal -> persist-failed', noticeFor(true, true, snapshot('light', 'system')) === 'persist-failed');
// The painted base outranks the runtime snapshot: a refused write leaves the runtime on
// a value neither the document nor the render ever took.
check('a dark page silences the light-base notice', noticeFor(true, false, snapshot('light', 'system'), true) === null);
check('a dark page keeps the refusal wording', noticeFor(true, true, snapshot('light', 'system'), true) === 'not-saved');
check('a light page still announces the base', noticeFor(true, false, snapshot('light', 'system'), false) === 'system-base');
check('every notice key has row copy', Object.values(NOTICE_KEYS).every((key) => typeof key === 'string'));

// 2. Wiring: the layer follows the base scheme, so Light/Dark/System can never
//    leave a dark palette under light structural rules — and a write the document
//    refuses must not bounce the user off the dark base.
const theme = createTheme(THEME_ID, dom);
const { ctx, captured, dictionaries, missingKeys } = createContext(theme);
module.apply(ctx);
if (captured.row === null) throw new Error('the row was not registered into settings.general.item');
const row = React.mount(captured.row);
const zhTable = (dictionaries.get('rider-theme') ?? {}).zh ?? {};
check('row starts without a warning', !treeHas(row.tree, isWarning));

// The presenter stamps the base one render behind the runtime, so attach a body still
// reporting the *previous* scheme: flipping the switch must be judged by the runtime and
// must not read as a refused write just because the pixels have not caught up yet.
documentStub.body = attachedBody();
dom.dark = false;

switchOf(row.tree).props.onClick();
check('switch on mounts the layer on the dark base', theme.layers === 1);
check('applied preference targets rider-dark', theme.preference === THEME_ID);
check('no warning while the base is dark', !treeHas(row.tree, isWarning));
check('a stale light render is not read as a refused write', !treeHas(row.tree, isWarning));

// The Host accepted the write: the document holds `dark`, which confirms it.
theme.store('dark');
theme.adopt('dark', 'dark');
await settle();
check('a confirmed write is not mistaken for a refusal', !treeHas(row.tree, isWarning));

// The user then picks Light in the built-in Appearance row: newer intent wins.
theme.store('light');
theme.adopt('light', 'light');
check('picking Light withdraws the layer', theme.layers === 0);
check('picking Light announces why the palette is off', warningText(row.tree) === zhTable['row.lightBase']);
check(
  'the notice is announced as a live status',
  treeHas(row.tree, (node) => isWarning(node) && node.props.role === 'status')
);
check('the user keeps their enable setting', localStorage.get(ENABLED_KEY) === '1');
check('picking Light does not fight the user preference', theme.preference === 'light');

// Switching back to Dark brings the palette back with no extra interaction.
theme.store('dark');
theme.adopt('dark', 'dark');
check('picking Dark re-mounts the layer', theme.layers === 1);
check('picking Dark clears the notice', !treeHas(row.tree, isWarning));

// The base the presenter painted can also be *ahead* of a snapshot that never landed: a
// refused preference write leaves the runtime on a value neither the document nor the
// render took. The row must follow the pixels there too — never claim a light base, and
// never withdraw the palette, on a dark page.
dom.dark = true;
theme.adopt('system', 'light'); // snapshot: light · page: dark
check('a dark page keeps the palette despite a light snapshot', theme.layers === 1);
check('a dark page says nothing about a light base', !treeHas(row.tree, isWarning));
check('a dark page is not read as a refused write', !treeHas(row.tree, isWarning));
dom.dark = false;
theme.adopt('system', 'light'); // snapshot: light · page: light
check('a light page withdraws the palette', theme.layers === 0);
check('a light page names the follow-system base', warningText(row.tree) === zhTable['row.systemBase']);

// A layer can outlive the disposer we kept: the Host documents an older layer's disposer as
// a no-op once the same source was re-overridden, so its registry can still hold our source
// while this instance owns no handle for it. That survivor keeps painting dark aliases under
// the light scheme the row just reported — the half-applied state this row exists to prevent.
const LEFTOVER_WITNESSES = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-border-l4', '--dsw-alias-label-primary'];
theme.overrides.set(LAYER_SOURCE, { stale: true });
for (const name of LEFTOVER_WITNESSES) dom.style.set(name, TOKENS[name].light);
check('a leftover palette is painted without a live disposer', dom.style.get('--dsw-alias-bg-base') === TOKENS['--dsw-alias-bg-base'].light);
const overrideCallsBefore = theme.overrideCalls;
theme.adopt('light', 'light'); // any base move the row must answer
check('a leftover layer of ours is taken off the registry', !theme.overrides.has(LAYER_SOURCE));
check('a leftover layer costs exactly one replacement', theme.overrideCalls === overrideCallsBefore + 1);
check('a leftover layer leaves no layer mounted', theme.layers === 0);
check('a leftover palette stops painting', LEFTOVER_WITNESSES.every((name) => dom.style.get(name) === undefined));

dom.dark = true;
theme.adopt('dark', 'dark'); // snapshot: dark · page: dark
check('a dark page restores the palette', theme.layers === 1);
documentStub.body = null;

// Now the settings document stops accepting writes (another program holds the
// file). Flipping the switch asks for the dark base, the runtime falls back to the
// stale durable value, and the plugin must assert the dark base in this client
// instead of bouncing the user there.
switchOf(row.tree).props.onClick();
theme.store('system');
switchOf(row.tree).props.onClick();
const hostWritesBeforeRefusal = theme.hostWrites.length;
theme.adopt('system', 'light');
await settle();
check('a refused write ends up on the dark base', theme.colorScheme === 'dark' && theme.preference === THEME_ID);
check('a refused write keeps the palette mounted', theme.layers === 1);
check('a refused write does not retry the unwritable document', theme.hostWrites.length === hostWritesBeforeRefusal);
check('a refused write explains that nothing can be saved', warningText(row.tree) === zhTable['row.notSaved']);

// A newer Appearance click survives the refusal: the document cannot store it, but the
// row must not override what the user just picked — it says the save failed and steps
// aside. The document still holding `system` here is exactly what makes the click read
// as fresh rather than as a durable value coming back.
theme.adopt('light', 'light');
await settle();
check('a fresh Appearance click is honoured after a refusal', theme.colorScheme === 'light');
check('a fresh Appearance click steps the palette aside', theme.layers === 0);
check('a fresh Appearance click names the failed save', warningText(row.tree) === zhTable['row.persistFailed']);

// What the document brings back is not a choice: the dark base the user asked for
// stays, instead of the palette riding a value nothing can write.
theme.adopt('system', 'light');
await settle();
check('the durable value coming back re-asserts the dark base', theme.colorScheme === 'dark');
check('the durable value coming back keeps the palette mounted', theme.layers === 1);

// Switching off stops writing a preference the user has since chosen.
const hostWritesBeforeOff = theme.hostWrites.length;
switchOf(row.tree).props.onClick();
check('switching off keeps the layer off', theme.layers === 0);
check('switching off removes any warning', !treeHas(row.tree, isWarning));
check('switching off leaves a user-chosen preference alone', theme.hostWrites.length === hostWritesBeforeOff);

// 3. Loading the page with the switch remembered as ON must not overrule a Light
//    the user picked since — the palette simply stays off until Dark is chosen.
const lightTheme = createTheme(THEME_ID, dom);
lightTheme.store('light');
lightTheme.adopt('light', 'light');
localStorage.set(ENABLED_KEY, '1');
const second = createContext(lightTheme);
module.apply(second.ctx);
const secondRow = React.mount(second.captured.row);
check('reload with Light adopted writes no preference', lightTheme.writes.length === 0);
check('reload with Light adopted mounts no layer', lightTheme.layers === 0);
check('reload with Light adopted explains the state', warningText(secondRow.tree) === zhTable['row.lightBase']);
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
