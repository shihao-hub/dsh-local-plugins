/**
 * Client half of @local/traj-translate.
 * Safe & robust implementation.
 */

window.__ModuleLoader__.load({
  id: '@local/traj-translate-v4',
  factory() {
    const ROUTE = '/dsh-traj-translate/translate';
    const TAB_ID = 'trajectory-detail-translate';
    const TAB_FLAG = 'data-traj-translate-tab';
    const PANEL_ID = 'trajectory-detail-translate-panel';

    const MAX_BATCH_SEGMENTS = 20;
    const MAX_BATCH_CHARS = 4000;

    function apply(ctx) {
      ctx.effect(() => startController(), 'traj-translate: inspector controller');
    }

    function nativeButtons(tablist) {
      return [...tablist.querySelectorAll('button[id^="trajectory-detail-"]')].filter(
        (btn) => !btn.hasAttribute(TAB_FLAG),
      );
    }

    function startController() {
      if (typeof document === 'undefined' || !document.body) return () => {};

      let timer = null;
      let isMutatingSelf = false;

      // Translation state
      let currentActiveTablist = null;
      let isTranslateActive = false;
      let translationCache = new Map(); // contentHash -> cloneNode
      let abortCtrl = null;

      function scheduleCheck() {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          checkTablist();
        }, 120);
      }

      function checkTablist() {
        if (isMutatingSelf) return;

        const tablists = document.querySelectorAll('[role="tablist"]');
        for (const tablist of tablists) {
          const natives = nativeButtons(tablist);
          if (natives.length === 0) continue;

          // Check if "raw" (原始内容) tab exists in this inspector
          const rawBtn = tablist.querySelector('#trajectory-detail-raw');
          let btn = tablist.querySelector(`button#${TAB_ID}`);

          // If there is NO "原始内容" tab (such as tool-call records), DO NOT show translate tab
          if (!rawBtn) {
            if (btn) {
              if (isTranslateActive && currentActiveTablist === tablist) {
                deactivateTranslation(tablist);
              }
              isMutatingSelf = true;
              try {
                btn.remove();
              } finally {
                isMutatingSelf = false;
              }
            }
            continue;
          }

          // Check if translate button exists in tablist
          if (!btn) {
            isMutatingSelf = true;
            try {
              const model = natives[natives.length - 1];
              btn = model.cloneNode(false);
              btn.id = TAB_ID;
              btn.setAttribute(TAB_FLAG, '');
              btn.setAttribute('role', 'tab');
              btn.setAttribute('aria-selected', 'false');
              btn.textContent = '翻译';
              btn.title = '将原始内容翻译为简体中文（新标签）';

              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                handleTranslateClick(tablist, btn);
              });

              tablist.appendChild(btn);
            } finally {
              isMutatingSelf = false;
            }
          } else {
            // Keep at end if native buttons reordered
            if (tablist.lastElementChild !== btn) {
              isMutatingSelf = true;
              try {
                tablist.appendChild(btn);
              } finally {
                isMutatingSelf = false;
              }
            }
          }
        }
      }

      function deactivateTranslation(tablist) {
        if (!isTranslateActive) return;
        isTranslateActive = false;
        currentActiveTablist = null;

        if (abortCtrl) {
          abortCtrl.abort();
          abortCtrl = null;
        }

        const btn = tablist?.querySelector(`button#${TAB_ID}`);
        if (btn) {
          btn.setAttribute('aria-selected', 'false');
          btn.textContent = '翻译';
          // Match unselected native tab style
          const natives = nativeButtons(tablist);
          if (natives.length > 0) {
            const sample = natives.find((b) => b.getAttribute('aria-selected') !== 'true') || natives[0];
            btn.className = sample.className;
          }
        }

        const aside = tablist?.closest('aside') || tablist?.parentElement;
        const nativePanel = aside?.querySelector('#trajectory-detail-panel');
        const translatePanel = aside?.querySelector(`#${PANEL_ID}`);

        if (nativePanel) {
          nativePanel.style.display = '';
        }
        if (translatePanel) {
          translatePanel.style.display = 'none';
        }
      }

      async function handleTranslateClick(tablist, translateBtn) {
        const aside = tablist.closest('aside') || tablist.parentElement;
        const nativePanel = aside?.querySelector('#trajectory-detail-panel');
        if (!nativePanel) return;

        // If already active and clicked again, do nothing
        if (isTranslateActive && currentActiveTablist === tablist) return;

        currentActiveTablist = tablist;
        isTranslateActive = true;

        // Visual highlight for translate tab
        const natives = nativeButtons(tablist);
        const activeNative = natives.find((b) => b.getAttribute('aria-selected') === 'true');
        let activeClass = '';
        if (activeNative) {
          for (const c of activeNative.classList) {
            if (c.toLowerCase().includes('active')) {
              activeClass = c;
              break;
            }
          }
          if (!activeClass) {
            const diff = [...activeNative.classList].filter((c) => !natives[natives.length - 1].classList.contains(c));
            activeClass = diff[0] || '';
          }
          activeNative.setAttribute('aria-selected', 'false');
          if (activeClass) activeNative.classList.remove(activeClass);
        }

        translateBtn.setAttribute('aria-selected', 'true');
        if (activeClass) translateBtn.classList.add(activeClass);

        // Ensure translatePanel exists inside aside
        let translatePanel = aside.querySelector(`#${PANEL_ID}`);
        if (!translatePanel) {
          translatePanel = document.createElement('div');
          translatePanel.id = PANEL_ID;
          translatePanel.setAttribute('role', 'tabpanel');
          aside.appendChild(translatePanel);
        }

        translatePanel.className = nativePanel.className;
        nativePanel.style.display = 'none';
        translatePanel.style.display = '';

        // If currently not on "raw" tab, click raw tab to ensure content is available
        const rawBtn = tablist.querySelector('#trajectory-detail-raw');
        if (rawBtn && rawBtn !== activeNative) {
          isMutatingSelf = true;
          try {
            rawBtn.click();
            await new Promise((r) => setTimeout(r, 200));
          } finally {
            isMutatingSelf = false;
          }
          rawBtn.setAttribute('aria-selected', 'false');
          if (activeClass) rawBtn.classList.remove(activeClass);
        }

        // Get raw content to translate
        const rawContent = nativePanel.cloneNode(true);
        rawContent.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));

        const fullText = rawContent.textContent || '';
        const contentHash = hash(fullText);

        // If cache hit, show cached translation instantly
        if (translationCache.has(contentHash)) {
          translatePanel.innerHTML = '';
          translatePanel.appendChild(translationCache.get(contentHash).cloneNode(true));
          translateBtn.textContent = '翻译';
          return;
        }

        // Show working clone
        translatePanel.innerHTML = '';
        const working = rawContent.cloneNode(true);
        translatePanel.appendChild(working);

        // Collect text nodes
        splitLongText(working);
        const textNodes = collectTextNodes(working);

        if (textNodes.length === 0) {
          translateBtn.textContent = '翻译';
          translationCache.set(contentHash, working.cloneNode(true));
          return;
        }

        translateBtn.textContent = '翻译中…';
        abortCtrl = new AbortController();
        const signal = abortCtrl.signal;

        const batches = batchNodes(textNodes);
        let done = 0;

        for (let i = 0; i < batches.length; i++) {
          if (signal.aborted || !isTranslateActive) return;
          const batch = batches[i];
          const texts = batch.map((n) => n.nodeValue);

          try {
            const translations = await requestTranslate(texts, signal);
            batch.forEach((node, idx) => {
              if (translations[idx]) {
                node.nodeValue = translations[idx];
              }
            });
            done += batch.length;
            if (isTranslateActive) {
              translateBtn.textContent = `翻译中 (${Math.min(done, textNodes.length)}/${textNodes.length})…`;
            }
          } catch (e) {
            if (signal.aborted || !isTranslateActive) return;
            console.error('[traj-translate] batch error:', e);
            translateBtn.textContent = '翻译失败·重试';
            return;
          }
        }

        if (signal.aborted || !isTranslateActive) return;
        translationCache.set(contentHash, working.cloneNode(true));
        translateBtn.textContent = '翻译';
      }

      const observer = new MutationObserver(() => scheduleCheck());
      observer.observe(document.body, { childList: true, subtree: true });

      // ONLY exit translation when user explicitly clicks a native tab
      const handleGlobalClick = (e) => {
        const btn = e.target.closest('button[id^="trajectory-detail-"]');
        if (!btn) return;
        if (btn.id === TAB_ID) return; // user clicked our translate tab

        // User clicked a native tab button (overview, rendered, raw, etc.)
        if (isTranslateActive) {
          const tablist = btn.closest('[role="tablist"]');
          deactivateTranslation(tablist);
        }
      };
      document.addEventListener('click', handleGlobalClick, true);

      scheduleCheck();

      return () => {
        observer.disconnect();
        document.removeEventListener('click', handleGlobalClick, true);
        if (timer) clearTimeout(timer);
      };
    }

    async function requestTranslate(texts, signal) {
      let url = ROUTE;
      // In electron (dsh-app://), fallback to local webserver if needed
      if (typeof window !== 'undefined' && window.location?.protocol === 'dsh-app:') {
        url = `http://127.0.0.1:19387${ROUTE}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ segments: texts }),
        signal,
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }
      return data.translations;
    }

    function splitLongText(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const longNodes = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeValue && node.nodeValue.length > 2500) {
          longNodes.push(node);
        }
      }
      for (const node of longNodes) {
        const text = node.nodeValue;
        const parts = text.split(/(?<=\n\n|\n)/);
        if (parts.length <= 1) continue;

        const chunks = [];
        let cur = '';
        for (const p of parts) {
          if (cur.length + p.length > 2000 && cur.length > 0) {
            chunks.push(cur);
            cur = '';
          }
          cur += p;
        }
        if (cur) chunks.push(cur);

        if (chunks.length > 1) {
          const parent = node.parentNode;
          if (!parent) continue;
          const frag = document.createDocumentFragment();
          for (const chunk of chunks) {
            frag.appendChild(document.createTextNode(chunk));
          }
          parent.replaceChild(frag, node);
        }
      }
    }

    function collectTextNodes(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          if (
            parent.closest('button, script, style, .katex, [aria-hidden="true"], [data-traj-translate-ignore]')
          ) {
            return NodeFilter.FILTER_REJECT;
          }

          const val = node.nodeValue?.trim();
          if (!val) return NodeFilter.FILTER_REJECT;
          if (!/[a-zA-Z]/.test(val)) return NodeFilter.FILTER_REJECT;

          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      return nodes;
    }

    function batchNodes(nodes) {
      const batches = [];
      let current = [];
      let chars = 0;
      for (const node of nodes) {
        const length = node.nodeValue.length;
        if (current.length >= MAX_BATCH_SEGMENTS || (current.length > 0 && chars + length > MAX_BATCH_CHARS)) {
          batches.push(current);
          current = [];
          chars = 0;
        }
        current.push(node);
        chars += length;
      }
      if (current.length > 0) batches.push(current);
      return batches;
    }

    function hash(text) {
      let h = 0x811c9dc5;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return (h >>> 0).toString(36);
    }

    return { inject: [], apply };
  },
});
