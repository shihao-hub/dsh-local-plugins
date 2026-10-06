/**
 * Client half of @local/model-favorites.
 *
 * Shadows the shipped composer model seat (`conversation.input.model`,
 * registered by @deepseek-ai/dsh-client-ui-model-selection at default
 * priority 0) with a Favorites-enabled selector at priority -1: the slot
 * core projects the lowest-priority live entry, so this component renders
 * in its place and the shipped one comes back untouched when this plugin
 * is disabled.
 *
 * The selector is a faithful copy of the shipped ModelSelect over the same
 * per-session ModelDirectory service (`ctx.modelDirectories`), extended with:
 *  - a pinned "Favorites" group (hidden while empty) fed from a
 *    localStorage-backed star list keyed by `provider/model`;
 *  - a hover star toggle on every model row (clicking never selects);
 *  - a right-side caption showing each row's provider, so same-named
 *    models from different providers and favorites rows stay distinguishable.
 *
 * Search, keyboard navigation, pending spinners, effort selection, error
 * and toast handling keep the shipped behavior because the component and
 * the data flow are the same.
 */
(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/model-favorites',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const reactDom = require('react-dom');
      const jsxRuntime = require('react/jsx-runtime');
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

      const PLUGIN_ID = '@local/model-favorites';
      const NS = 'model-favorites';
      const CSS_TAG_ID = '@local/model-favorites/ModelSelect.module.css';
      const STORAGE_KEY = '@local/model-favorites:favorites:v1';
      const FAVORITES_GROUP_ID = '@favorites';
      const SEAT = 'conversation.input.model';

      /** Minimal className joiner (the runtime exposes no clsx). */
      function clsx() {
        const out = [];
        for (let at = 0; at < arguments.length; at += 1) {
          const value = arguments[at];
          if (typeof value === 'string' && value !== '') out.push(value);
        }
        return out.join(' ');
      }

      // ---------------------------------------------------------------------
      // Favorites store (localStorage-backed, cross-tab via `storage`).
      // Entries are `provider/model` id strings; insertion order is display
      // order. The array identity changes on every write so it can serve as
      // a useSyncExternalStore snapshot directly.
      // ---------------------------------------------------------------------

      function readFavorites() {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          const parsed = raw === null ? [] : JSON.parse(raw);
          if (!Array.isArray(parsed)) return [];
          return parsed.filter((id) => typeof id === 'string');
        } catch {
          return [];
        }
      }

      let favorites = readFavorites();
      const favoriteListeners = new Set();

      function subscribeFavorites(listener) {
        favoriteListeners.add(listener);
        const onStorage = (event) => {
          if (event.key !== STORAGE_KEY) return;
          favorites = readFavorites();
          listener();
        };
        window.addEventListener('storage', onStorage);
        return () => {
          favoriteListeners.delete(listener);
          window.removeEventListener('storage', onStorage);
        };
      }

      function writeFavorites(next) {
        favorites = next;
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* private mode: keep the in-memory list */
        }
        favoriteListeners.forEach((listener) => listener());
      }

      function isFavorite(providerId, modelId) {
        return favorites.includes(providerId + '/' + modelId);
      }

      function toggleFavorite(providerId, modelId) {
        const id = providerId + '/' + modelId;
        writeFavorites(
          favorites.includes(id) ? favorites.filter((entry) => entry !== id) : [...favorites, id]
        );
      }

      function useFavorites() {
        return React.useSyncExternalStore(subscribeFavorites, () => favorites);
      }

      /**
       * Diagnosis: the lifecycle stage the client half reached. Mirrored in
       * the General-settings status row and the console markers:
       * `loaded` → module applied, `seat` → seat shadow registered,
       * `register-failed` → the registration threw (see console).
       */
      const statusRef = { phase: 'loaded' };

      // ---------------------------------------------------------------------
      // Locale: every key the seat renders, copied from the shipped `model`
      // namespace plus the favorites additions (zh is the key-set source).
      // ---------------------------------------------------------------------

      const zh = {
        'favorites': '收藏',
        'favorite.add': '收藏该模型',
        'favorite.remove': '取消收藏',
        'settings.title': '模型收藏',
        'settings.seatTaken': '已接管模型选择器（星标 + provider 标注已启用）',
        'settings.waiting': '已加载，等待接管模型选择器…',
        'settings.registerFailed': '注册失败，请查看控制台日志',
        'provider.account': 'DeepSeek 账号',
        'trigger.fallback': '请选择模型',
        'trigger.loading': '正在加载模型…',
        'trigger.selectAria': '请选择模型',
        'trigger.aria': '选择模型，当前 {model}',
        'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
        'menu.aria': '模型与推理等级',
        'menu.model': '模型',
        'menu.effort': '推理等级',
        'effort.providerDefault': 'Default',
        'status.loading': '正在刷新模型列表…',
        'error.action': '模型操作失败：{message}',
        'error.sessionInUse': '当前会话已被占用，可能是其他正在运行的 DSH 导致的（如其他 dsh web、桌面端），请退出其他正在运行的 DSH 后重试。',
        'action.reload': '重新加载',
        'warning.groupLoad': '{name} 加载失败：{message}',
        'search.placeholder': '搜索模型…',
        'search.clear': '清除搜索',
        'search.empty': '没有匹配的模型。',
        'empty.models': '没有可用的模型。',
        'empty.efforts': '当前模型未提供推理等级。',
        'retry': '重试'
      };

      const en = {
        'favorites': 'Favorites',
        'favorite.add': 'Favorite this model',
        'favorite.remove': 'Remove from favorites',
        'settings.title': 'Model favorites',
        'settings.seatTaken': 'Selector taken over (stars + provider captions enabled)',
        'settings.waiting': 'Loaded, waiting to take over the model selector…',
        'settings.registerFailed': 'Registration failed, see the console log',
        'provider.account': 'DeepSeek Account',
        'trigger.fallback': 'Select model',
        'trigger.loading': 'Loading models…',
        'trigger.selectAria': 'Select model',
        'trigger.aria': 'Select model, current {model}',
        'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
        'menu.aria': 'Model and reasoning effort',
        'menu.model': 'Model',
        'menu.effort': 'Effort',
        'effort.providerDefault': 'Default',
        'status.loading': 'Refreshing model list…',
        'error.action': 'Model operation failed: {message}',
        'error.sessionInUse': 'This session is already in use, possibly by another running DSH instance (such as dsh web or the desktop app). Quit other running DSH instances and try again.',
        'action.reload': 'Reload',
        'warning.groupLoad': '{name} failed to load: {message}',
        'search.placeholder': 'Search models…',
        'search.clear': 'Clear search',
        'search.empty': 'No matching models.',
        'empty.models': 'No models available.',
        'empty.efforts': 'This model provides no reasoning effort levels.',
        'retry': 'Retry'
      };

      // ---------------------------------------------------------------------
      // Styles: the shipped ModelSelect.module.css rules renamed to an
      // `mfs_` prefix, plus the caption and star additions.
      // ---------------------------------------------------------------------

      const CSS = [
        '.mfs_root{min-width:0;position:relative}',
        '.mfs_trigger{border-radius:var(--dsw-radius-sm);min-width:0;max-width:min(360px,45cqw);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px;display:flex}',
        '.mfs_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
        '.mfs_trigger:focus-visible:not([data-selection-focus]){box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
        '.mfs_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
        '.mfs_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
        '.mfs_triggerEffort{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption);flex-shrink:1000;overflow:hidden}',
        '.mfs_triggerIcon{display:var(--dsh-composer-model-icon-display,none);flex:none}',
        '.mfs_triggerLabel,.mfs_triggerEffort{display:var(--dsh-composer-model-text-display,block)}',
        '.mfs_chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}',
        '.mfs_chevronOpen{transform:rotate(180deg)}',
        '.mfs_menu{z-index:1100;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden}',
        '.mfs_status,.mfs_empty{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:12px;line-height:18px}',
        '.mfs_error,.mfs_warning{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:3px;padding:6px 7px;font-size:11px;line-height:16px;display:flex}',
        '.mfs_warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}',
        '.mfs_retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}',
        '.mfs_searchRow{flex-shrink:0;margin:2px 0 3px;position:relative}',
        '.mfs_searchRow .mfs_search{border-radius:var(--dsw-radius-md);background:0 0;border:0 solid #0000;height:auto;padding:5px 7px;display:flex}',
        '.mfs_searchRow .mfs_searchWithQuery{padding-right:34px}',
        '.mfs_searchClear{corner-shape:round;width:24px;height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:50%;justify-content:center;align-items:center;padding:0;display:inline-flex;position:absolute;top:50%;right:4px;transform:translateY(-50%)}',
        '.mfs_searchClear:hover,.mfs_searchClear:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}',
        '.mfs_searchRow .mfs_search:focus-within{border-color:#0000}',
        '.mfs_searchRow .mfs_search input{padding:0;font-size:12px;line-height:normal}',
        '.mfs_searchRow .mfs_search input::placeholder{color:var(--dsw-alias-label-caption)}',
        '.mfs_groups{min-height:0;overflow-y:auto}',
        '.mfs_option{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;min-height:34px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:5px 7px;display:flex}',
        '.mfs_option:not(.mfs_modelOption):hover:not(:disabled),.mfs_option:focus-visible,.mfs_optionActive:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
        '.mfs_selected{background:0 0}',
        '.mfs_option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
        '.mfs_optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}',
        '.mfs_modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400;line-height:18px;overflow:hidden}',
        '.mfs_caption{flex:0 1 auto;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}',
        '.mfs_star{flex:0 0 auto;width:22px;height:22px;display:grid;place-items:center;padding:0;border:0;background:0 0;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:0;transition:opacity .12s,color .12s,background-color .12s}',
        '.mfs_option:hover .mfs_star,.mfs_option:focus-visible .mfs_star,.mfs_optionActive .mfs_star,.mfs_star[data-starred="true"]{opacity:1}',
        '.mfs_star:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-warn-label)}',
        '.mfs_star[data-starred="true"]{color:var(--dsw-alias-state-warn-label)}',
        '.mfs_option:disabled .mfs_star{pointer-events:none}',
        '.mfs_option:disabled .mfs_star[data-starred="true"]{opacity:.55}',
        '.mfs_star svg{width:14px;height:14px;display:block}',
        '.mfs_check{color:var(--dsw-alias-label-primary);flex:0 0 14px;place-items:center;display:grid}',
        '.mfs_check svg{width:14px;height:14px}',
        '.mfs_cell{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;line-height:20px;display:flex}',
        '.mfs_cell:hover,.mfs_cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}',
        '.mfs_cellLabel{white-space:nowrap;flex:none}',
        '.mfs_cellValue{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}',
        '.mfs_cellChevron{width:12px;height:12px;color:var(--dsw-alias-menu-icon);flex:none}',
        '.mfs_statusRow{align-items:baseline;gap:8px;padding:2px 0;display:flex}',
        '.mfs_statusTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}',
        '.mfs_statusValue{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}'
      ].join('');

      const css = {
        root: 'mfs_root',
        trigger: 'mfs_trigger',
        triggerLabel: 'mfs_triggerLabel',
        triggerEffort: 'mfs_triggerEffort',
        triggerIcon: 'mfs_triggerIcon',
        chevron: 'mfs_chevron',
        chevronOpen: 'mfs_chevronOpen',
        menu: 'mfs_menu',
        status: 'mfs_status',
        empty: 'mfs_empty',
        error: 'mfs_error',
        warning: 'mfs_warning',
        retry: 'mfs_retry',
        searchRow: 'mfs_searchRow',
        search: 'mfs_search',
        searchWithQuery: 'mfs_searchWithQuery',
        searchClear: 'mfs_searchClear',
        groups: 'mfs_groups',
        option: 'mfs_option',
        optionActive: 'mfs_optionActive',
        selected: 'mfs_selected',
        modelOption: 'mfs_modelOption',
        optionCopy: 'mfs_optionCopy',
        modelName: 'mfs_modelName',
        caption: 'mfs_caption',
        star: 'mfs_star',
        check: 'mfs_check',
        cell: 'mfs_cell',
        cellLabel: 'mfs_cellLabel',
        cellValue: 'mfs_cellValue',
        cellChevron: 'mfs_cellChevron',
        statusRow: 'mfs_statusRow',
        statusTitle: 'mfs_statusTitle',
        statusValue: 'mfs_statusValue'
      };

      /** Filled/outline star drawn inline; the theme ships no matching glyph. */
      function StarIcon({ filled }) {
        return jsxRuntime.jsx('svg', {
          viewBox: '0 0 16 16',
          'aria-hidden': true,
          children: jsxRuntime.jsx('path', {
            d: 'M8 1.75 9.87 5.54l4.19.6-3.03 2.95.72 4.18L8 11.3l-3.75 1.97.72-4.18L1.94 6.14l4.19-.6Z',
            fill: filled ? 'currentColor' : 'none',
            stroke: 'currentColor',
            strokeWidth: 1.1,
            strokeLinejoin: 'round'
          })
        });
      }

      // ---------------------------------------------------------------------
      // Shared catalog helpers (copied from the shipped provider-order).
      // ---------------------------------------------------------------------

      function orderModelProviders(groups) {
        return groups.toSorted(
          (left, right) =>
            (left.id === 'deepseek-account' ? 0 : left.id === 'deepseek-official' ? 1 : 2) -
            (right.id === 'deepseek-account' ? 0 : right.id === 'deepseek-official' ? 1 : 2)
        );
      }

      /** Display name of one provider group (account alias localized). */
      function groupLabel(group, t) {
        return group.id === 'deepseek-account' ? t('provider.account') : group.name;
      }

      /**
       * Resolve the stored favorite ids against the live catalog: unknown or
       * unloaded models are skipped (they reappear when the catalog does).
       * Returns provider-group shaped data so it flows through the same
       * rank/filter/render path, with each model carrying its real provider
       * id (`favoriteOf`) and caption (`favoriteProviderLabel`).
       */
      function buildFavoriteGroups(orderedGroups, favoriteIds, t) {
        if (favoriteIds.length === 0) return [];
        const byKey = new Map();
        for (const group of orderedGroups) {
          const label = groupLabel(group, t);
          for (const model of group.models) byKey.set(group.id + '/' + model.id, { group, model, label });
        }
        const models = [];
        for (const id of favoriteIds) {
          const hit = byKey.get(id);
          if (hit === undefined) continue;
          models.push({ ...hit.model, favoriteOf: hit.group.id, favoriteProviderLabel: hit.label });
        }
        if (models.length === 0) return [];
        return [{ id: FAVORITES_GROUP_ID, name: t('favorites'), models }];
      }

      // ---------------------------------------------------------------------
      // The seat. A copy of the shipped ModelSelect; favorites/caption/star
      // additions are marked with "favorites:" comments.
      // ---------------------------------------------------------------------

      const MEASURE_STYLE = {
        visibility: 'hidden',
        left: 0,
        top: 0
      };

      function ModelSelect({ locked, available, directory, load, select, t }) {
        const state = React.useSyncExternalStore((fn) => directory.subscribe(fn), () => directory.getSnapshot());
        const favoriteIds = useFavorites(); // favorites: star list snapshot
        const [open, setOpen] = React.useState(false);
        const [pane, setPane] = React.useState('root');
        const [query, setQuery] = React.useState('');
        const [highlightedIndex, setHighlightedIndex] = React.useState(null);
        const [selectionFocus, setSelectionFocus] = React.useState(false);
        const lastActionRef = React.useRef('load');
        const [toast, setToast] = React.useState(null);
        const toastSeq = React.useRef(0);
        const rootRef = React.useRef(null);
        const triggerRef = React.useRef(null);
        const searchRef = React.useRef(null);
        const menuRef = React.useRef(null);
        const groupsRef = React.useRef(null);
        const [menuPos, setMenuPos] = React.useState(null);
        const itemRefs = React.useRef([]);
        const id = React.useId();

        const orderedGroups = React.useMemo(() => orderModelProviders(state.groups), [state.groups]);
        // favorites: pinned Favorites group first, hidden while empty.
        const menuGroups = React.useMemo(
          () => [...buildFavoriteGroups(orderedGroups, favoriteIds, t), ...orderedGroups],
          [orderedGroups, favoriteIds, t]
        );
        const choices = React.useMemo(
          () =>
            menuGroups.flatMap((group) =>
              group.models.map((model) => ({
                group,
                model,
                selection: {
                  provider: model.favoriteOf ?? group.id,
                  model: model.id,
                  ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort })
                }
              }))
            ),
          [menuGroups]
        );
        const showSearch = choices.length > 4;
        const filteredGroups = React.useMemo(
          () =>
            menuGroups
              .map((group) => ({
                ...group,
                models: primitives.rankByName(group.models, showSearch ? query.trim() : '')
              }))
              .filter((group) => group.models.length > 0),
          [menuGroups, query, showSearch]
        );
        const visibleModels = React.useMemo(
          () =>
            filteredGroups.flatMap((group) =>
              group.models.map((model) => ({
                provider: model.favoriteOf ?? group.id,
                model: model.id
              }))
            ),
          [filteredGroups]
        );
        const currentVisibleIndex = visibleModels.findIndex(
          (model) => model.provider === state.current?.provider && model.model === state.current.model
        );
        const activeModelIndex = Math.min(highlightedIndex ?? Math.max(0, currentVisibleIndex), visibleModels.length - 1);
        const currentChoice =
          state.current === null
            ? undefined
            : choices.find((c) => c.selection.provider === state.current?.provider && c.selection.model === state.current.model);
        const reasoning = currentChoice?.model.reasoning;
        const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
        const effortLabel =
          reasoning === undefined
            ? state.retainedEffort
            : effectiveEffort === undefined
              ? t('effort.providerDefault')
              : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort;
        const effortChoices = React.useMemo(
          () =>
            reasoning === undefined
              ? []
              : [
                  ...(reasoning.defaultEffort === undefined
                    ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
                    : []),
                  ...reasoning.efforts.map((effort) => ({
                    key: `effort:${effort.id}`,
                    effort: effort.id,
                    label: effort.name
                  }))
                ],
          [reasoning, t]
        );
        const { pending } = state;
        const busy = pending !== null;
        const reload = () => {
          lastActionRef.current = 'load';
          load();
        };
        React.useEffect(() => {
          if (!open) return;
          const closeOutside = (event) => {
            if (rootRef.current?.contains(event.target) === true) return;
            if (menuRef.current?.contains(event.target) === true) return;
            setOpen(false);
          };
          document.addEventListener('mousedown', closeOutside);
          return () => {
            document.removeEventListener('mousedown', closeOutside);
          };
        }, [open]);
        React.useLayoutEffect(() => {
          if (!showSearch) {
            setQuery('');
            setHighlightedIndex(null);
          }
        }, [showSearch]);
        const paneFocus = React.useRef(null);
        const previousShowSearch = React.useRef(showSearch);
        React.useEffect(() => {
          const changedSearchMode = previousShowSearch.current !== showSearch;
          previousShowSearch.current = showSearch;
          const intent = paneFocus.current ?? (changedSearchMode && pane === 'model' ? 'drill' : null);
          paneFocus.current = null;
          if (!open || intent === null) return;
          if (intent === 'drill') {
            if (pane === 'model' && showSearch) {
              searchRef.current?.focus();
              return;
            }
            (
              menuRef.current?.querySelector('[role="menuitemradio"][aria-checked="true"]:not([disabled])') ??
              itemRefs.current.find((item) => item !== null && !item.disabled) ??
              triggerRef.current
            )?.focus();
            return;
          }
          const cell = itemRefs.current[intent === 'effort' ? 1 : 0];
          (cell !== null && cell !== undefined && !cell.disabled ? cell : triggerRef.current)?.focus();
        }, [open, pane, showSearch]);
        React.useEffect(() => {
          const viewport = groupsRef.current;
          if (viewport === null) return;
          return primitives.observeStickyMenuGroups(viewport);
        }, [available, open, pane, filteredGroups]);
        React.useLayoutEffect(() => {
          if (open && pane === 'model' && activeModelIndex >= 0) itemRefs.current[activeModelIndex]?.scrollIntoView({ block: 'nearest' });
        }, [open, pane, activeModelIndex, visibleModels]);
        React.useLayoutEffect(() => {
          if (!open) {
            setMenuPos(null);
            return;
          }
          const place = () => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect === undefined) return;
            const MARGIN = 12;
            const lw = menuRef.current?.offsetWidth ?? 0;
            const lh = menuRef.current?.offsetHeight ?? 0;
            let x = rect.right - lw;
            let y = rect.top - 8 - lh;
            if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - lw - MARGIN);
            if (lh > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - lh - MARGIN);
            setMenuPos({ left: x, top: y });
          };
          place();
          window.addEventListener('scroll', place, true);
          window.addEventListener('resize', place);
          return () => {
            window.removeEventListener('scroll', place, true);
            window.removeEventListener('resize', place);
          };
        }, [open, pane, state, query]);
        if (!available) return null;
        const show = () => {
          setSelectionFocus(false);
          triggerRef.current?.focus();
          setQuery('');
          setHighlightedIndex(null);
          if (state.current === null) paneFocus.current = 'drill';
          setPane(state.current === null ? 'model' : 'root');
          setOpen(true);
          reload();
        };
        const changeQuery = (next) => {
          setQuery(next);
          setHighlightedIndex(0);
        };
        const close = (restoreFocus = false) => {
          setOpen(false);
          setPane('root');
          if (restoreFocus)
            queueMicrotask(() => {
              triggerRef.current?.focus();
            });
        };
        const closeAfterSelection = () => {
          setSelectionFocus(true);
          close(true);
        };
        const drill = (next) => {
          setQuery('');
          setHighlightedIndex(null);
          paneFocus.current = 'drill';
          setPane(next);
        };
        const back = (from) => {
          paneFocus.current = from;
          setPane('root');
        };
        const moveFocus = (offset) => {
          const items = itemRefs.current.filter((item) => item !== null);
          if (items.length === 0) return;
          const active = items.findIndex((item) => item === document.activeElement);
          items[active === -1 ? (offset > 0 ? 0 : items.length - 1) : (active + offset + items.length) % items.length]?.focus();
        };
        const onRootKeyDown = (event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            if (pane !== 'root' && state.current !== null) back(pane);
            else close(true);
            return;
          }
          if (!open) return;
          if (pane === 'model' && showSearch && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            if (!busy && visibleModels.length > 0) {
              setHighlightedIndex((activeModelIndex + (event.key === 'ArrowDown' ? 1 : -1) + visibleModels.length) % visibleModels.length);
              searchRef.current?.focus();
            }
            return;
          }
          if (pane === 'model' && showSearch && event.target instanceof HTMLInputElement && (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) {
            if (event.key === 'Tab' && visibleModels.length === 0) return;
            event.preventDefault();
            const highlighted = visibleModels[activeModelIndex];
            if (!busy && highlighted !== undefined) choose(highlighted);
            return;
          }
          if (event.key === 'Tab') {
            if (event.shiftKey) {
              event.preventDefault();
              if (pane !== 'root' && state.current !== null) back(pane);
              else close(true);
              return;
            }
            const focused = document.activeElement;
            const rows = itemRefs.current.filter((item) => item !== null);
            if (focused instanceof HTMLButtonElement && rows.includes(focused)) {
              event.preventDefault();
              focused.click();
              return;
            }
            if (focused !== triggerRef.current) return;
            event.preventDefault();
            if (pane === 'model' && showSearch) {
              setHighlightedIndex(null);
              searchRef.current?.focus();
              return;
            }
            (
              menuRef.current?.querySelector('[role="menuitemradio"][aria-checked="true"]:not([disabled])') ??
              rows.find((item) => !item.disabled)
            )?.focus();
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveFocus(event.key === 'ArrowDown' ? 1 : -1);
          }
        };
        const onBlur = (event) => {
          if (event.relatedTarget instanceof Node && (rootRef.current?.contains(event.relatedTarget) === true || menuRef.current?.contains(event.relatedTarget) === true)) return;
          close();
        };
        const settleSelection = (result) => {
          if (result === undefined) return;
          if (result.ok) {
            if (rootRef.current !== null) closeAfterSelection();
            return;
          }
          const { error } = result;
          toastSeq.current += 1;
          setToast({
            seq: toastSeq.current,
            text: error.code === 'session/writer-held' ? t('error.sessionInUse') : t('error.action', { message: `${error.code}: ${error.message}` })
          });
        };
        const submit = (selection) => {
          lastActionRef.current = 'select';
          setSelectionFocus(true);
          triggerRef.current?.focus();
          select(selection).then(settleSelection);
        };
        const choose = (selection) => {
          if (state.current?.provider === selection.provider && state.current.model === selection.model) {
            closeAfterSelection();
            return;
          }
          submit(selection);
        };
        const chooseEffort = (effort) => {
          if (state.current === null) return;
          if (effectiveEffort === effort) {
            closeAfterSelection();
            return;
          }
          submit({
            provider: state.current.provider,
            model: state.current.model,
            ...(effort === undefined ? {} : { reasoningEffort: effort })
          });
        };
        // favorites: star toggle; never selects, never closes the menu.
        const toggleStar = (providerId, modelId) => {
          if (busy) return;
          toggleFavorite(providerId, modelId);
        };
        const waiting = state.current === null && state.status === 'loading';
        const modelLabel =
          waiting ? t('trigger.loading') : currentChoice?.model.name ?? (state.current === null ? t('trigger.fallback') : `${state.current.provider}/${state.current.model}`);
        const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`;
        const triggerAria = waiting
          ? t('trigger.loading')
          : state.current === null
            ? t('trigger.selectAria')
            : effortLabel === undefined
              ? t('trigger.aria', { model: modelLabel })
              : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel });
        itemRefs.current = [];
        let itemIndex = 0;
        let modelIndex = 0;
        const itemRef = () => {
          const at = itemIndex++;
          return (node) => {
            itemRefs.current[at] = node;
          };
        };
        return jsxRuntime.jsxs('div', {
          ref: rootRef,
          className: css.root,
          onKeyDown: onRootKeyDown,
          onBlur,
          onMouseDown: (event) => {
            if (event.target instanceof Element && event.target.closest('button') !== null) event.preventDefault();
          },
          children: [
            jsxRuntime.jsxs('button', {
              ref: triggerRef,
              type: 'button',
              className: css.trigger,
              'aria-label': triggerAria,
              'aria-haspopup': 'menu',
              'aria-expanded': open,
              'aria-controls': open ? `${id}-menu` : undefined,
              title: triggerLabel,
              'aria-busy': busy,
              'data-selection-focus': selectionFocus ? '' : undefined,
              onBlur: () => {
                setSelectionFocus(false);
              },
              disabled: locked,
              onClick: () => {
                if (open) close(true);
                else show();
              },
              children: [
                jsxRuntime.jsx(primitives.IconDataOutlineRegular, {
                  className: css.triggerIcon,
                  size: 16
                }),
                jsxRuntime.jsx('span', {
                  className: css.triggerLabel,
                  children: modelLabel
                }),
                effortLabel !== undefined &&
                  jsxRuntime.jsx('span', {
                    className: css.triggerEffort,
                    children: effortLabel
                  }),
                busy
                  ? jsxRuntime.jsx(primitives.StateDot, { state: 'ongoing' })
                  : jsxRuntime.jsx(primitives.IconChevronDownOutlineRegular, {
                      className: clsx(css.chevron, open && css.chevronOpen)
                    })
              ]
            }),
            open &&
              reactDom.createPortal(
                jsxRuntime.jsxs(
                  primitives.MenuSurface,
                  {
                    ref: menuRef,
                    id: `${id}-menu`,
                    className: css.menu,
                    style: menuPos ?? MEASURE_STYLE,
                    role: pane === 'model' ? 'group' : 'menu',
                    'aria-label': t('menu.aria'),
                    'aria-busy': state.status === 'loading' || busy,
                    children: [
                      pane === 'root' &&
                        jsxRuntime.jsxs(jsxRuntime.Fragment, {
                          children: [
                            jsxRuntime.jsxs(
                              'button',
                              {
                                ref: itemRef(),
                                type: 'button',
                                role: 'menuitem',
                                className: css.cell,
                                onClick: () => {
                                  drill('model');
                                },
                                children: [
                                  jsxRuntime.jsx('span', {
                                    className: css.cellLabel,
                                    children: t('menu.model')
                                  }),
                                  jsxRuntime.jsx('span', {
                                    className: css.cellValue,
                                    children: modelLabel
                                  }),
                                  jsxRuntime.jsx(primitives.IconChevronRightOutlineRegular, { className: css.cellChevron })
                                ]
                              }
                            ),
                            reasoning !== undefined &&
                              jsxRuntime.jsxs(
                                'button',
                                {
                                  ref: itemRef(),
                                  type: 'button',
                                  role: 'menuitem',
                                  className: css.cell,
                                  onClick: () => {
                                    drill('effort');
                                  },
                                  children: [
                                    jsxRuntime.jsx('span', {
                                      className: css.cellLabel,
                                      children: t('menu.effort')
                                    }),
                                    jsxRuntime.jsx('span', {
                                      className: css.cellValue,
                                      children: effortLabel
                                    }),
                                    jsxRuntime.jsx(primitives.IconChevronRightOutlineRegular, { className: css.cellChevron })
                                  ]
                                }
                              )
                          ]
                        }),
                      pane === 'model' &&
                        jsxRuntime.jsxs(jsxRuntime.Fragment, {
                          children: [
                            showSearch &&
                              jsxRuntime.jsxs('div', {
                                className: css.searchRow,
                                children: [
                                  jsxRuntime.jsx(primitives.Input, {
                                    ref: searchRef,
                                    className: clsx(css.search, query !== '' && css.searchWithQuery),
                                    type: 'text',
                                    role: 'searchbox',
                                    'aria-label': t('search.placeholder'),
                                    'aria-controls': `${id}-models`,
                                    'aria-activedescendant': activeModelIndex < 0 ? undefined : `${id}-model-${activeModelIndex}`,
                                    placeholder: t('search.placeholder'),
                                    value: query,
                                    readOnly: busy,
                                    onChange: (event) => {
                                      changeQuery(event.target.value);
                                    }
                                  }),
                                  query !== '' &&
                                    jsxRuntime.jsx(
                                      'button',
                                      {
                                        type: 'button',
                                        className: css.searchClear,
                                        'aria-label': t('search.clear'),
                                        disabled: busy,
                                        onClick: () => {
                                          changeQuery('');
                                          searchRef.current?.focus();
                                        },
                                        children: jsxRuntime.jsx(primitives.IconCloseFillRegular, {})
                                      }
                                    )
                                ]
                              }),
                            state.status === 'loading' &&
                              jsxRuntime.jsx('div', {
                                className: css.status,
                                children: t('status.loading')
                              }),
                            state.error !== null &&
                              lastActionRef.current === 'load' &&
                              jsxRuntime.jsxs('div', {
                                className: css.error,
                                children: [
                                  jsxRuntime.jsx('span', { children: t('error.action', { message: state.error }) }),
                                  jsxRuntime.jsx(
                                    'button',
                                    {
                                      type: 'button',
                                      className: css.retry,
                                      onClick: reload,
                                      children: t('retry')
                                    }
                                  )
                                ]
                              }),
                            state.failures.map((failure) =>
                              jsxRuntime.jsxs(
                                'div',
                                {
                                  className: css.warning,
                                  children: [
                                    jsxRuntime.jsx('span', {
                                      children: t('warning.groupLoad', {
                                        name: failure.id === 'deepseek-account' ? t('provider.account') : failure.name,
                                        message: failure.message
                                      })
                                    }),
                                    jsxRuntime.jsx(
                                      'button',
                                      {
                                        type: 'button',
                                        className: css.retry,
                                        onClick: reload,
                                        children: t('retry')
                                      }
                                    )
                                  ]
                                },
                                failure.id
                              )
                            ),
                            jsxRuntime.jsx('div', {
                              ref: groupsRef,
                              id: `${id}-models`,
                              className: clsx(css.groups, 'scrollable'),
                              role: 'menu',
                              'aria-label': t('menu.model'),
                              hidden: filteredGroups.length === 0,
                              children: filteredGroups.map((group) =>
                                jsxRuntime.jsx(
                                  primitives.MenuGroup,
                                  {
                                    label: groupLabel(group, t),
                                    children: group.models.map((model) => {
                                      const index = modelIndex++;
                                      // favorites: rows resolve their real provider,
                                      // not the virtual favorites group id.
                                      const providerId = model.favoriteOf ?? group.id;
                                      const providerText = model.favoriteProviderLabel ?? groupLabel(group, t);
                                      const starred = isFavorite(providerId, model.id);
                                      const selected = state.current?.provider === providerId && state.current.model === model.id;
                                      return jsxRuntime.jsxs(
                                        'button',
                                        {
                                          ref: itemRef(),
                                          type: 'button',
                                          role: 'menuitemradio',
                                          'aria-checked': selected,
                                          id: `${id}-model-${index}`,
                                          tabIndex: showSearch ? -1 : 0,
                                          onFocus: () => {
                                            setHighlightedIndex(index);
                                          },
                                          'data-highlighted': index === activeModelIndex ? '' : undefined,
                                          className: clsx(
                                            css.option,
                                            css.modelOption,
                                            selected && css.selected,
                                            index === activeModelIndex && css.optionActive
                                          ),
                                          onMouseMove:
                                            busy || index === activeModelIndex
                                              ? undefined
                                              : () => {
                                                  if (showSearch) setHighlightedIndex(index);
                                                  else itemRefs.current[index]?.focus();
                                                },
                                          title: model.name,
                                          disabled: busy,
                                          onClick: () => {
                                            choose({
                                              provider: providerId,
                                              model: model.id
                                            });
                                          },
                                          children: [
                                            jsxRuntime.jsx('span', {
                                              className: css.optionCopy,
                                              children: jsxRuntime.jsx('span', {
                                                className: css.modelName,
                                                children: model.name
                                              })
                                            }),
                                            jsxRuntime.jsx('span', {
                                              className: css.caption,
                                              children: providerText
                                            }),
                                            jsxRuntime.jsx('span', {
                                              role: 'button',
                                              className: css.star,
                                              'data-starred': starred ? 'true' : 'false',
                                              'aria-label': starred ? t('favorite.remove') : t('favorite.add'),
                                              'aria-pressed': starred,
                                              tabIndex: -1,
                                              onMouseDown: (event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                              },
                                              onClick: (event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                toggleStar(providerId, model.id);
                                              },
                                              children: jsxRuntime.jsx(StarIcon, { filled: starred })
                                            }),
                                            jsxRuntime.jsx('span', {
                                              className: css.check,
                                              children:
                                                pending?.provider === providerId && pending.model === model.id
                                                  ? jsxRuntime.jsx(primitives.StateDot, { state: 'ongoing' })
                                                  : selected
                                                    ? jsxRuntime.jsx(primitives.IconCheckOutlineRegular, {})
                                                    : null
                                            })
                                          ]
                                        },
                                        `${providerId}/${model.id}`
                                      );
                                    })
                                  },
                                  group.id
                                )
                              )
                            }),
                            state.status === 'ready' &&
                              filteredGroups.length === 0 &&
                              jsxRuntime.jsx('div', {
                                className: css.empty,
                                role: 'status',
                                children: t(choices.length === 0 ? 'empty.models' : 'search.empty')
                              })
                          ]
                        }),
                      pane === 'effort' &&
                        jsxRuntime.jsxs(jsxRuntime.Fragment, {
                          children: [
                            state.error !== null &&
                              lastActionRef.current === 'load' &&
                              jsxRuntime.jsxs('div', {
                                className: css.error,
                                children: [
                                  jsxRuntime.jsx('span', { children: t('error.action', { message: state.error }) }),
                                  jsxRuntime.jsx(
                                    'button',
                                    {
                                      type: 'button',
                                      className: css.retry,
                                      onClick: reload,
                                      children: t('action.reload')
                                    }
                                  )
                                ]
                              }),
                            effortChoices.length === 0
                              ? jsxRuntime.jsx('div', {
                                  className: css.empty,
                                  children: t('empty.efforts')
                                })
                              : effortChoices.map((level) =>
                                  jsxRuntime.jsxs(
                                    'button',
                                    {
                                      ref: itemRef(),
                                      type: 'button',
                                      role: 'menuitemradio',
                                      'aria-checked': effectiveEffort === level.effort,
                                      className: clsx(css.option, effectiveEffort === level.effort && css.selected),
                                      disabled: busy,
                                      onClick: () => {
                                        chooseEffort(level.effort);
                                      },
                                      children: [
                                        jsxRuntime.jsx('span', {
                                          className: css.optionCopy,
                                          children: jsxRuntime.jsx('span', {
                                            className: css.modelName,
                                            children: level.label
                                          })
                                        }),
                                        jsxRuntime.jsx('span', {
                                          className: css.check,
                                          children:
                                            pending !== null &&
                                            pending.provider === state.current?.provider &&
                                            pending.model === state.current.model &&
                                            pending.reasoningEffort === level.effort
                                              ? jsxRuntime.jsx(primitives.StateDot, { state: 'ongoing' })
                                              : effectiveEffort === level.effort
                                                ? jsxRuntime.jsx(primitives.IconCheckOutlineRegular, {})
                                                : null
                                        })
                                      ]
                                    },
                                    level.key
                                  )
                                )
                          ]
                        })
                    ]
                  }
                ),
                document.body
              ),
            toast !== null &&
              jsxRuntime.jsx(
                primitives.Toast,
                {
                  text: toast.text,
                  icon: jsxRuntime.jsx(primitives.IconWarningOutlineRegular, {}),
                  anchor: rootRef.current?.closest('[data-composer-card]') ?? null,
                  onDone: () => {
                    setToast(null);
                  }
                },
                toast.seq
              )
          ]
        });
      }

      // ---------------------------------------------------------------------
      // Plugin body: styles + dictionaries + a General-settings status row,
      // then shadow the composer seat.
      // ---------------------------------------------------------------------

      const inject = ['slots', 'locale', 'sessions'];

      /** Status row shown in Settings → General while the plugin is enabled. */
      function StatusRow({ t }) {
        return jsxRuntime.jsxs('div', {
          className: css.statusRow,
          children: [
            jsxRuntime.jsx('span', {
              className: css.statusTitle,
              children: t('settings.title')
            }),
            jsxRuntime.jsx('span', {
              className: css.statusValue,
              children:
                statusRef.phase === 'seat'
                  ? t('settings.seatTaken')
                  : statusRef.phase === 'register-failed'
                    ? t('settings.registerFailed')
                    : t('settings.waiting')
            })
          ]
        });
      }

      function apply(ctx) {
        console.log('[model-favorites] apply: client half running');
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {};
          if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') !== null) return () => {};
          const tag = document.createElement('style');
          tag.dataset.plugin = PLUGIN_ID;
          tag.dataset.pluginCss = CSS_TAG_ID;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'model-favorites: stylesheet');

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-favorites: dictionaries');

        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'model-favorites-status',
              order: 90,
              locale: NS
            },
            StatusRow
          )
        );

        ctx.inject(['slots', 'modelDirectories'], (scope) => {
          const models = scope.modelDirectories;
          const sessions = scope.sessions;
          scope.slots.inject(SEAT, () => {
            try {
              const disposer = scope.slots.register(
                {
                  name: SEAT,
                  // Shadow the shipped occupant (priority 0): lowest renders.
                  priority: -1,
                  locale: NS,
                  inject: (sessionId) => {
                    const directory = models.directoryFor(sessionId);
                    const available = sessions.subagentAddress(sessionId) === undefined;
                    return {
                      available,
                      directory: directory.store,
                      load: () => {
                        if (available) directory.load().catch(() => {});
                      },
                      select: (selection) => (available ? directory.select(selection) : Promise.resolve(undefined))
                    };
                  }
                },
                ModelSelect
              );
              statusRef.phase = 'seat';
              console.log('[model-favorites] seat shadow registered on conversation.input.model (priority -1)');
              return disposer;
            } catch (error) {
              statusRef.phase = 'register-failed';
              console.error('[model-favorites] seat registration failed:', error);
              return () => {};
            }
          });
        });
      }

      return {
        inject,
        apply,
        __test: {
          buildFavoriteGroups,
          groupLabel,
          orderModelProviders,
          isFavorite,
          toggleFavorite,
          StarIcon,
          ModelSelect
        }
      };
    }
  });
})();
