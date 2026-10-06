(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/expand-all-sessions',
    meta: {},
    factory: function () {
      /**
       * The sidebar's WorkspaceBrowser renders each session group with a
       * per-group visible limit (default 5) and one overflow button:
       *
       *   button[data-row-key^="overflow:"]
       *
       * Every click raises the group's limit by 5 (or straight to Infinity
       * once at most one batch remains), and the button unmounts once the
       * group is fully expanded ("����" resets it back to 5).
       *
       * Flicker fix: AnimatedRows keys its reset on `sessionLimits`, so
       * every stepwise click used to remount the whole list. Instead we
       * click in one synchronous burst �� React 18 batches the queued
       * functional `setSessionLimits` updates into a single commit, so the
       * list resets exactly once. Groups the user collapses later are
       * never re-expanded because their data-row-key is already recorded.
       */

      const BUTTON_SELECTOR = 'button[data-row-key^="overflow:"]';
      const MAX_CLICKS_PER_BURST = 400; // safety bound; 5-per-click �� 2000 sessions
      const MAX_RETRIES = 10; // frames to keep bursting if the button survives
      const handledGroups = new Set();
      const pending = new Set();
      let scheduled = false;

      function cssEscape(value) {
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
          return CSS.escape(value);
        }
        return value.replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, function (ch) {
          return '\\' + ch;
        });
      }

      function burst(key) {
        for (let i = 0; i < MAX_CLICKS_PER_BURST; i += 1) {
          const button = document.querySelector('button[data-row-key="' + cssEscape(key) + '"]');
          if (button === null || !button.isConnected) return true; // fully expanded
          button.click();
        }
        return false;
      }

      async function expandGroup(key) {
        if (handledGroups.has(key) || pending.has(key)) return;
        handledGroups.add(key);
        pending.add(key);
        try {
          for (let retry = 0; retry < MAX_RETRIES; retry += 1) {
            if (burst(key)) return;
            // The burst should have been batched into one commit; if the
            // button somehow survived, yield a frame and try again rather
            // than spinning forever.
            await new Promise(function (resolve) { requestAnimationFrame(resolve); });
          }
        } finally {
          pending.delete(key);
        }
      }

      function sweep() {
        scheduled = false;
        for (const button of document.querySelectorAll(BUTTON_SELECTOR)) {
          const key = button.getAttribute('data-row-key');
          if (key !== null) void expandGroup(key);
        }
      }

      function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(sweep);
      }

      function start() {
        if (typeof document === 'undefined') return () => {};
        let observer = null;
        const attach = () => {
          schedule();
          observer = new MutationObserver(schedule);
          const target = document.body || document.documentElement;
          if (target) {
            observer.observe(target, { childList: true, subtree: true });
          }
        };

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', attach, { once: true });
        } else {
          attach();
        }

        return () => {
          if (observer) observer.disconnect();
        };
      }

      const inject = [];

      function apply(ctx) {
        ctx.effect(start, 'expand-all-sessions: auto-expand observer');
      }

      return {
        inject,
        apply,
        __test: {
          handledGroups,
          pending,
          burst,
          expandGroup,
          sweep
        }
      };
    }
  });
})();
