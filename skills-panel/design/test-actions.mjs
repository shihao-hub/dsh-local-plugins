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

let factory;
globalThis.window = {
  __ModuleLoader__: { load: ({ factory: f }) => (factory = f) },
  localStorage: {
    store: new Map(),
    getItem: (k) => globalThis.window.localStorage.store.get(k) ?? null,
    setItem: (k, v) => globalThis.window.localStorage.store.set(k, v)
  }
};

const requireShim = createRequire(import.meta.url);
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {}
};

new Function('window', 'require', source)(globalThis.window, (id) => (id === 'react' ? React : requireShim(id)));
const mod = factory((id) => (id === 'react' ? React : requireShim(id)));

// 1. Verify plugin metadata & exports
check('mod.inject includes remote.session', mod.inject.includes('remote.session'), true);
check(
  'mod.inject no longer requires sidebarRight',
  mod.inject.includes('sidebarRight'),
  false
);

// 2. Mock ctx and verify apply registration & behavior
let registeredPanelFace = null;
let openedPath = null;
let revealedPath = null;

const fakeSessionRemote = {
  canOpenWorkspacePath: () => true,
  async openWorkspacePath(req) {
    if (req.action === 'reveal') {
      revealedPath = req.path;
    } else {
      openedPath = req.path;
    }
    return { opened: true };
  }
};

const fakeSkillsRemote = {
  async list({ sessionId }) {
    return {
      ok: true,
      value: {
        skills: [
          { name: 'sh-agy-boost', path: 'C:/Users/29580/.agents/skills/sh-agy-boost/SKILL.md', description: 'desc' }
        ]
      }
    };
  }
};

const fakeCtx = {
  effect(fn) { fn(); },
  locale: {
    register() {},
    bind: () => (k) => k
  },
  remote: {
    skills: fakeSkillsRemote,
    session: fakeSessionRemote
  },
  // The panel must not depend on the right Sidebar at all: a global main
  // surface has no on-screen Session, so `sidebarRight` is irrelevant here.
  get() {
    return undefined;
  },
  slots: {
    inject(slotName, fn) { fn(); },
    register(meta, comp) {
      if (meta.name === 'main') {
        registeredPanelFace = meta.inject();
      }
    }
  }
};

mod.apply(fakeCtx);

check('plugin successfully registered and injected panelFace', registeredPanelFace !== null, true);
check('canOpenNative is available', registeredPanelFace.canOpenNative, true);

// 3. openSkillFile always hands the file to the OS default application
const skillPath = 'C:/Users/29580/.agents/skills/sh-agy-boost/SKILL.md';
registeredPanelFace.openSkillFile(skillPath);
check('openSkillFile opens SKILL.md with the default app', openedPath, skillPath);

// 3b. missing path is ignored rather than opening a directory
check('openSkillFile returns false for an undefined path', registeredPanelFace.openSkillFile(undefined), false);

// 3c. without the remote channel nothing is opened
const fakeCtxNoRemote = {
  ...fakeCtx,
  remote: {
    skills: fakeSkillsRemote,
    session: undefined
  }
};
let noRemoteFace = null;
mod.apply({
  ...fakeCtxNoRemote,
  slots: {
    inject(slotName, fn) { fn(); },
    register(meta) {
      if (meta.name === 'main') noRemoteFace = meta.inject();
    }
  }
});
check('canOpenNative is false without the remote channel', noRemoteFace.canOpenNative, false);
check('openSkillFile does not throw without the remote channel', noRemoteFace.openSkillFile(skillPath), false);

// 4. openSkillDir (opens the skill directory itself)
registeredPanelFace.openSkillDir('C:/Users/29580/.agents/skills/sh-agy-boost/SKILL.md');
check(
  'openSkillDir opens skill directory without SKILL.md filename',
  openedPath,
  'C:/Users/29580/.agents/skills/sh-agy-boost'
);

// 5. revealSkillDir (reveals the folder in the file manager)
registeredPanelFace.revealSkillDir('C:/Users/29580/.agents/skills/sh-agy-boost/SKILL.md');
check(
  'revealSkillDir reveals skill directory in explorer',
  revealedPath,
  'C:/Users/29580/.agents/skills/sh-agy-boost'
);

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  process.exit(1);
} else {
  console.log('ALL ACTION TESTS PASSED.');
}
