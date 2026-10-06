(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: '@local/mcp-panel',
    meta: {},
    factory: function (require) {
      const React = require('react');
      const h = React.createElement;

      const PANEL_ID = 'mcp-panel';
      const CSS_TAG_ID = 'mcp-panel-styles';
      const NS = 'mcp-panel';
      const ROUTE = '/plugin/mcp-panel/catalog';

      const CSS = [
        '.mcpx_root,.mcpx_root *{box-sizing:border-box}',
        '.mcpx_root{display:flex;flex-direction:column;height:100%;color:var(--dsw-alias-label-primary);font-family:var(--dsh-font-family-base,sans-serif);background:var(--dsw-alias-bg-base)}',
        '.mcpx_header{display:flex;align-items:center;gap:8px;padding:12px 14px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}',
        '.mcpx_title{margin:0;font-size:14px;font-weight:600;letter-spacing:-.01em}',
        '.mcpx_protocol{border:.5px solid var(--dsw-alias-border-l2);border-radius:4px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;padding:0 5px;letter-spacing:.05em;flex:none}',
        '.mcpx_spacer{flex:1}',
        '.mcpx_refresh{border:0;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:4px;border-radius:6px;line-height:1;display:inline-flex;align-items:center;justify-content:center}',
        '.mcpx_refresh:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
        '.mcpx_refresh:disabled{opacity:.4;cursor:default}',
        '.mcpx_body{flex:1;overflow-y:auto;overflow-x:hidden;padding:12px 14px 16px;display:flex;flex-direction:column;gap:10px}',
        '.mcpx_stats{display:flex;gap:8px;flex:none}',
        '.mcpx_stat{flex:1;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px 7px}',
        '.mcpx_statValue{font-size:17px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.2}',
        '.mcpx_statLabel{color:var(--dsw-alias-label-tertiary);font-size:10.5px;margin-top:2px}',
        '.mcpx_search{display:flex;align-items:center;gap:6px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 9px;flex:none}',
        '.mcpx_search:focus-within{border-color:var(--dsw-alias-brand-primary)}',
        '.mcpx_searchIcon{color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;flex:none}',
        '.mcpx_searchInput{border:0;background:0 0;color:var(--dsw-alias-label-primary);font-size:12px;outline:0;width:100%;min-width:0}',
        '.mcpx_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}',
        '.mcpx_server{background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
        '.mcpx_serverHead{display:flex;align-items:center;gap:7px;min-width:0}',
        '.mcpx_dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-warn-primary)}',
        '.mcpx_dot[data-online="true"]{background:var(--dsw-alias-state-success-primary)}',
        '.mcpx_name{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;font-weight:650;flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.mcpx_transport{border:.5px solid var(--dsw-alias-border-l2);border-radius:4px;color:var(--dsw-alias-label-tertiary);font-size:9.5px;line-height:14px;padding:0 5px;letter-spacing:.06em;flex:none}',
        '.mcpx_toolCount{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:10.5px;font-variant-numeric:tabular-nums;flex:none}',
        '.mcpx_endpoint{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:5px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.mcpx_tools{border-top:.5px solid var(--dsw-alias-border-l1);padding-top:6px}',
        '.mcpx_toolsSummary{display:flex;align-items:center;gap:5px;cursor:pointer;list-style:none;color:var(--dsw-alias-label-secondary);font-size:11.5px;padding:2px 0;user-select:none}',
        '.mcpx_toolsSummary::-webkit-details-marker{display:none}',
        '.mcpx_toolsSummary:hover{color:var(--dsw-alias-label-primary)}',
        '.mcpx_chev{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}',
        '.mcpx_tools[open] .mcpx_chev{transform:rotate(90deg)}',
        '.mcpx_toolList{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column}',
        '.mcpx_tool{display:flex;align-items:baseline;gap:8px;padding:4px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
        '.mcpx_tool:last-child{border-bottom:0}',
        '.mcpx_toolName{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;font-weight:600;flex:none;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.mcpx_toolDesc{color:var(--dsw-alias-label-tertiary);font-size:11.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.mcpx_toolParams{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));font-size:10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 4px;flex:none;font-variant-numeric:tabular-nums}',
        '.mcpx_meta{display:flex;flex-wrap:wrap;gap:4px 10px;color:var(--dsw-alias-label-tertiary);font-size:10.5px}',
        '.mcpx_metaItem{white-space:nowrap}',
        '.mcpx_metaKey{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));margin-right:3px}',
        '.mcpx_metaValue{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px}',
        '.mcpx_hint{color:var(--dsw-alias-label-tertiary);padding:18px 14px;font-size:13px;line-height:1.7}',
        '.mcpx_hintCode{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;padding:1px 6px}',
        '.mcpx_error{color:var(--dsw-alias-state-error-primary)}',
        '.mcpx_errorDetail{display:block;color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:12px;word-break:break-word}',
        '.mcpx_emptyIcon{display:block;margin:26px auto 12px;color:var(--dsw-alias-label-tertiary);opacity:.75}',
        '.mcpx_footer{flex:none;border-top:.5px solid var(--dsw-alias-border-l1);padding:8px 14px;color:var(--dsw-alias-label-tertiary);font-size:10.5px;letter-spacing:.01em}',
        '.mcpx_visuallyHidden{clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}'
      ].join('');

      /** Simplified Chinese dictionary; the key-set source of truth. */
      const zh = {
        'panel': '\u63a5\u53e3',
        'title': '\u63a5\u53e3',
        'protocol': 'MCP',
        'refresh': '\u5237\u65b0\u63a5\u53e3',
        'loading': '\u6b63\u5728\u52a0\u8f7d MCP \u670d\u52a1\u5668\u2026',
        'failed': '\u63a5\u53e3\u5217\u8868\u52a0\u8f7d\u5931\u8d25',
        'empty': '\u5c1a\u672a\u914d\u7f6e\u4efb\u4f55 MCP \u670d\u52a1\u5668',
        'emptyHint1': '\u5728 cordis \u8865\u4e01\u4e2d\u63d2\u5165\u4e00\u6761 ',
        'emptyHintLead': '@deepseek-ai/dsh-mcp-client',
        'emptyHint2': ' \u914d\u7f6e\u5373\u53ef\u63a5\u5165\u5916\u90e8\u5de5\u5177\u3002',
        'statServers': '\u670d\u52a1\u5668',
        'statOnline': '\u5728\u7ebf',
        'statTools': '\u5de5\u5177',
        'online': '\u5728\u7ebf',
        'idle': '\u65e0\u5de5\u5177',
        'idleHint': '\u5df2\u914d\u7f6e\u4f46\u5f53\u524d\u6ca1\u6709\u6ce8\u518c\u4efb\u4f55\u5de5\u5177\uff1a\u53ef\u80fd\u4ecd\u5728\u8fde\u63a5\u3001\u542f\u52a8\u5931\u8d25\uff0c\u6216\u670d\u52a1\u5668\u672a\u63d0\u4f9b\u5de5\u5177\u3002',
        'stdio': 'STDIO',
        'http': 'HTTP',
        'toolList': '\u5de5\u5177\u5217\u8868',
        'noTools': '\u8be5\u670d\u52a1\u5668\u672a\u6ce8\u518c\u4efb\u4f55\u5de5\u5177',
        'metaEntry': '\u914d\u7f6e\u9879',
        'metaMemory': '\u5185\u5b58',
        'metaTimeout': '\u8d85\u65f6',
        'metaReconnect': '\u91cd\u8fde',
        'metaReconnectOff': '\u5df2\u7981\u7528',
        'metaEnv': '\u73af\u5883\u53d8\u91cf',
        'metaFailFast': '\u542f\u52a8\u5931\u8d25\u5373\u4e2d\u65ad',
        'searchPlaceholder': '\u641c\u7d22\u5de5\u5177\u540d\u6216\u63cf\u8ff0\u2026',
        'noMatch': '\u6ca1\u6709\u5339\u914d\u7684\u670d\u52a1\u5668\u6216\u5de5\u5177',
        'paramsShort': '\u53c2',
        'footer': 'MCP \u00b7 Model Context Protocol \u2014 \u5de5\u5177\u4ee5 mcp__\u670d\u52a1\u5668__\u540d\u79f0 \u6ce8\u5165\u4f1a\u8bdd'
      };

      /** English dictionary, checked complete against the zh key set. */
      const en = {
        'panel': 'MCP',
        'title': 'MCP',
        'protocol': 'MCP',
        'refresh': 'Refresh MCP',
        'loading': 'Loading MCP servers\u2026',
        'failed': 'Could not load MCP servers',
        'empty': 'No MCP servers configured',
        'emptyHint1': 'Insert an ',
        'emptyHintLead': '@deepseek-ai/dsh-mcp-client',
        'emptyHint2': ' entry in the cordis patch to connect external tools.',
        'statServers': 'Servers',
        'statOnline': 'Online',
        'statTools': 'Tools',
        'online': 'Online',
        'idle': 'No tools',
        'idleHint': 'Configured, but no tools registered right now: still connecting, failed to start, or the server publishes no tools.',
        'stdio': 'STDIO',
        'http': 'HTTP',
        'toolList': 'Tools',
        'noTools': 'This server registered no tools',
        'metaEntry': 'Entry',
        'metaMemory': 'Memory',
        'metaTimeout': 'Timeout',
        'metaReconnect': 'Reconnect',
        'metaReconnectOff': 'Off',
        'metaEnv': 'env',
        'metaFailFast': 'Fail fast on startup',
        'searchPlaceholder': 'Search tools by name or description\u2026',
        'noMatch': 'No matching servers or tools',
        'paramsShort': 'p',
        'footer': 'MCP \u00b7 Model Context Protocol \u2014 tools join sessions as mcp__server__name'
      };

      //#region data access
      async function loadCatalog(signal) {
        const res = await fetch(ROUTE, { method: 'GET', headers: { accept: 'application/json' }, signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data === null || typeof data !== 'object' || data.ok !== true || !Array.isArray(data.servers)) {
          throw new Error('unexpected catalog payload');
        }
        return data;
      }

      /** `command args…` for stdio, the URL for streamable-http; undefined when unknown. */
      function endpointOf(server) {
        if (server.transport === 'streamable-http') return typeof server.url === 'string' ? server.url : undefined;
        const command = typeof server.command === 'string' ? server.command : '';
        if (command === '') return undefined;
        const args = Array.isArray(server.args) ? server.args.join(' ') : '';
        return (command + (args !== '' ? ' ' + args : '')).trim();
      }

      /** Tool short name: the raw name after the `mcp__<server>__` prefix. */
      function shortToolName(publicName, serverName) {
        const prefix = 'mcp__' + serverName + '__';
        return publicName.startsWith(prefix) ? publicName.slice(prefix.length) : publicName;
      }

      /** Human byte size: KB below 1 MB, one decimal for MB, two for GB. */
      function formatBytes(bytes) {
        if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return undefined;
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
      }

      function matchesQuery(server, query) {
        const needle = query.trim().toLowerCase();
        if (needle === '') return true;
        const haystack = [
          server.serverName,
          server.entryId,
          server.transport,
          endpointOf(server),
          ...server.tools.flatMap((tool) => [tool.name, tool.description])
        ]
          .filter((value) => typeof value === 'string')
          .some((value) => value.toLowerCase().includes(needle));
        return haystack;
      }

      function filterServerTools(server, query) {
        const needle = query.trim().toLowerCase();
        if (needle === '') return server.tools;
        return server.tools.filter((tool) =>
          [tool.name, tool.description]
            .filter((value) => typeof value === 'string')
            .some((value) => value.toLowerCase().includes(needle))
        );
      }
      //#endregion

      /** Sidebar icon glyph: a power plug meeting a port — the 接口 mark. */
      function McpGlyph(props) {
        const size = typeof props.size === 'number' ? props.size : 18;
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 16 16',
            fill: 'none',
            focusable: 'false',
            'aria-hidden': 'true',
            style: { display: 'block' }
          },
          h('path', {
            d: 'M5.8 1.6v2.4M10.2 1.6v2.4',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinecap: 'round'
          }),
          h('path', {
            d: 'M4.5 4h7a1.1 1.1 0 0 1 1.1 1.1v1.3a4.6 4.6 0 0 1-9.2 0V5.1A1.1 1.1 0 0 1 4.5 4z',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinejoin: 'round'
          }),
          h('path', {
            d: 'M8 11v3.4',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinecap: 'round'
          })
        );
      }

      /** Chevron used by the tools disclosure. */
      function Chevron() {
        return h(
          'svg',
          {
            className: 'mcpx_chev',
            width: '9',
            height: '9',
            viewBox: '0 0 10 10',
            fill: 'none',
            'aria-hidden': 'true'
          },
          h('path', {
            d: 'M3.4 2l3.2 3-3.2 3',
            stroke: 'currentColor',
            strokeWidth: 1.3,
            strokeLinecap: 'round',
            strokeLinejoin: 'round'
          })
        );
      }

      /** One configured MCP server: identity, endpoint, live tools, config facts. */
      function ServerCard(props) {
        const server = props.server;
        const t = props.t;
        const searching = props.searching === true;
        const online = server.tools.length > 0;
        const endpoint = endpointOf(server);
        const memory = server.memory;
        const memoryText = formatBytes(memory?.bytes);
        const meta = [];
        if (memoryText !== undefined) {
          meta.push({
            key: t('metaMemory'),
            value: memoryText + (memory.processes > 1 ? ' \u00d7' + memory.processes : '')
          });
        }
        if (server.entryId !== undefined) {
          meta.push({ key: t('metaEntry'), value: server.entryId });
        }
        if (typeof server.toolCallTimeoutMs === 'number') {
          meta.push({ key: t('metaTimeout'), value: Math.round(server.toolCallTimeoutMs / 1000) + 's' });
        }
        meta.push({
          key: t('metaReconnect'),
          value: server.reconnect !== undefined && server.reconnect.enabled === false
            ? t('metaReconnectOff')
            : '\u2264' + String((server.reconnect ?? {}).maxAttempts ?? 10)
        });
        if (typeof server.envCount === 'number' && server.envCount > 0) {
          meta.push({ key: t('metaEnv'), value: String(server.envCount) });
        }
        if (server.failOnStartupError === true) {
          meta.push({ key: '', value: t('metaFailFast') });
        }

        return h(
          'section',
          { className: 'mcpx_server', 'aria-label': server.serverName },
          h(
            'div',
            { className: 'mcpx_serverHead' },
            h('span', {
              className: 'mcpx_dot',
              'data-online': online ? 'true' : 'false',
              role: 'img',
              'aria-label': online ? t('online') : t('idle')
            }),
            h('span', { className: 'mcpx_name', title: server.serverName }, server.serverName),
            h('span', { className: 'mcpx_transport' }, server.transport === 'streamable-http' ? t('http') : t('stdio')),
            h('span', { className: 'mcpx_toolCount' }, String(server.tools.length))
          ),
          endpoint !== undefined
            ? h('div', { className: 'mcpx_endpoint', title: endpoint }, endpoint)
            : null,
          online === false
            ? h('div', { className: 'mcpx_meta' }, h('span', { className: 'mcpx_metaItem' }, t('idleHint')))
            : null,
          server.tools.length > 0
            ? h(
                'details',
                { className: 'mcpx_tools' },
                h(
                  'summary',
                  { className: 'mcpx_toolsSummary' },
                  h(Chevron),
                  h('span', null, t('toolList')),
                  h('span', { className: 'mcpx_toolCount' }, String(props.tools.length))
                ),
                props.tools.length > 0
                  ? h(
                      'ul',
                      { className: 'mcpx_toolList' },
                      props.tools.map((tool) =>
                        h(
                          'li',
                          { className: 'mcpx_tool', key: tool.name },
                          h('span', { className: 'mcpx_toolName', title: tool.name }, shortToolName(tool.name, server.serverName)),
                          h('span', { className: 'mcpx_toolDesc', title: tool.description || undefined }, tool.description),
                          tool.params > 0
                            ? h('span', { className: 'mcpx_toolParams', title: tool.params + ' params' }, tool.params + t('paramsShort'))
                            : null
                        )
                      )
                    )
                  : searching
                    ? null
                    : h('div', { className: 'mcpx_meta' }, h('span', { className: 'mcpx_metaItem' }, t('noTools')))
              )
            : null,
          h(
            'div',
            { className: 'mcpx_meta' },
            meta.map((item, index) =>
              h(
                'span',
                { className: 'mcpx_metaItem', key: index },
                item.key !== '' ? h('span', { className: 'mcpx_metaKey' }, item.key) : null,
                h('span', { className: 'mcpx_metaValue' }, item.value)
              )
            )
          )
        );
      }

      /** The 接口 (MCP) panel: server catalog joined with live tool facts. */
      function McpPanel(props) {
        const t = props.t;
        const loadCatalogFace = props.loadCatalog;

        const [reload, setReload] = React.useState(0);
        const [query, setQuery] = React.useState('');
        const [state, setState] = React.useState({ status: 'loading', data: undefined, error: undefined });
        const [busy, setBusy] = React.useState(false);

        React.useEffect(() => {
          const controller = new AbortController();
          setBusy(true);
          loadCatalogFace(controller.signal).then(
            (data) => {
              if (controller.signal.aborted) return;
              setState({ status: 'ready', data, error: undefined });
              setBusy(false);
            },
            (error) => {
              if (controller.signal.aborted) return;
              setState((prev) => ({
                status: prev.data !== undefined ? prev.status : 'error',
                data: prev.data,
                error: error instanceof Error ? error.message : String(error)
              }));
              setBusy(false);
            }
          );
          return () => {
            controller.abort();
          };
        }, [reload, loadCatalogFace]);

        const servers = state.data !== undefined ? state.data.servers : [];
        const visible = servers.filter((server) => matchesQuery(server, query));
        const totalTools = servers.reduce((sum, server) => sum + server.tools.length, 0);
        const onlineCount = servers.filter((server) => server.tools.length > 0).length;
        const searching = query.trim() !== '';

        let body;
        if (state.status === 'loading' && state.data === undefined) {
          body = h('p', { className: 'mcpx_hint' }, t('loading'));
        } else if (state.status === 'error' && state.data === undefined) {
          body = h(
            'p',
            { className: 'mcpx_hint mcpx_error' },
            t('failed'),
            h('span', { className: 'mcpx_errorDetail' }, state.error ?? '')
          );
        } else if (servers.length === 0) {
          body = h(
            'div',
            { className: 'mcpx_hint' },
            h(McpGlyph, { size: 34 }),
            h('p', { style: { textAlign: 'center', margin: '0 0 6px' } }, t('empty')),
            h(
              'p',
              { style: { textAlign: 'center', margin: 0, fontSize: 12 } },
              t('emptyHint1'),
              h('span', { className: 'mcpx_hintCode' }, t('emptyHintLead')),
              t('emptyHint2')
            )
          );
        } else if (visible.length === 0) {
          body = h('p', { className: 'mcpx_hint' }, t('noMatch'));
        } else {
          body = visible.map((server) =>
            h(ServerCard, {
              key: server.serverName + '\u0000' + (server.entryId ?? ''),
              server,
              tools: filterServerTools(server, query),
              searching,
              t
            })
          );
        }

        const showStats = state.data !== undefined && servers.length > 0;
        const showSearch = state.data !== undefined && totalTools > 0;

        return h(
          'section',
          { className: 'mcpx_root', 'aria-label': t('title') },
          h(
            'header',
            { className: 'mcpx_header' },
            h('h1', { className: 'mcpx_title' }, t('title')),
            h('span', { className: 'mcpx_protocol' }, t('protocol')),
            h('span', { className: 'mcpx_spacer' }),
            h(
              'button',
              {
                type: 'button',
                className: 'mcpx_refresh',
                onClick: () => setReload((value) => value + 1),
                disabled: busy,
                'aria-label': t('refresh')
              },
              h('span', { 'aria-hidden': 'true', style: { display: 'block', lineHeight: 1 } }, '\u21bb'),
              h('span', { className: 'mcpx_visuallyHidden' }, t('refresh'))
            )
          ),
          h(
            'div',
            { className: 'mcpx_body' },
            showStats
              ? h(
                  'div',
                  { className: 'mcpx_stats' },
                  h('div', { className: 'mcpx_stat' }, h('div', { className: 'mcpx_statValue' }, String(servers.length)), h('div', { className: 'mcpx_statLabel' }, t('statServers'))),
                  h('div', { className: 'mcpx_stat' }, h('div', { className: 'mcpx_statValue' }, String(onlineCount)), h('div', { className: 'mcpx_statLabel' }, t('statOnline'))),
                  h('div', { className: 'mcpx_stat' }, h('div', { className: 'mcpx_statValue' }, String(totalTools)), h('div', { className: 'mcpx_statLabel' }, t('statTools')))
                )
              : null,
            showSearch
              ? h(
                  'label',
                  { className: 'mcpx_search' },
                  h(
                    'span',
                    { className: 'mcpx_searchIcon', 'aria-hidden': 'true' },
                    h(
                      'svg',
                      { width: '12', height: '12', viewBox: '0 0 16 16', fill: 'none' },
                      h('circle', { cx: '7', cy: '7', r: '5', stroke: 'currentColor', strokeWidth: 1.4 }),
                      h('path', { d: 'M11 11l3 3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })
                    )
                  ),
                  h('input', {
                    className: 'mcpx_searchInput',
                    type: 'search',
                    value: query,
                    placeholder: t('searchPlaceholder'),
                    'aria-label': t('searchPlaceholder'),
                    onChange: (event) => setQuery(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Escape') setQuery('');
                    }
                  })
                )
              : null,
            body
          ),
          h('footer', { className: 'mcpx_footer' }, t('footer'))
        );
      }

      const inject = ['slots', 'locale'];

      function apply(ctx) {
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {};
          if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') !== null) return () => {};
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/mcp-panel';
          tag.dataset.pluginCss = CSS_TAG_ID;
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'mcp-panel: stylesheet');

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mcp-panel: dictionaries');
        const t = ctx.locale.bind(NS);

        const face = { loadCatalog };

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => face
            },
            McpPanel
          )
        );

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              label: () => t('panel'),
              locale: NS
            },
            McpGlyph
          )
        );
      }

      return {
        inject,
        apply,
        __test: {
          Panel: McpPanel,
          Glyph: McpGlyph,
          endpointOf,
          shortToolName,
          formatBytes,
          matchesQuery,
          filterServerTools,
          loadCatalog
        }
      };
    }
  });
})();
