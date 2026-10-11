// ThoughtDAG Native Tab Companion Mod
// Suppresses the floating switch/bar and embeds ThoughtDAG into conversation.view slot.

window.__ModuleLoader__.load({
  id: '@local/thoughtdag-companion',
  factory: require => {
    const React = require('react')
    const module = { exports: {} }

    module.exports.inject = ['slots', 'uiConversation', 'sessions', 'uiWorkspace']
    module.exports.apply = ctx => {
      // 1. Suppress the floating switch pill and title bar, define embedded view styling
      const style = document.createElement('style')
      style.textContent = [
        '.dsh-td-switch, .dsh-td-bar { display: none !important; }',
        '.dsh-td-view { position: relative; flex: 1; min-height: 0; height: 100%; width: 100%; }',
        '.dsh-td-overlay.dsh-td-embedded { position: absolute; inset: 0 !important; z-index: 1 !important; }'
      ].join('\n')
      document.head.append(style)

      const currentSession = () => {
        try {
          const snapshot = ctx.sessions?.list?.getSnapshot?.()
          if (!snapshot) return null
          const id = snapshot.current
          if (id === undefined) return null
          const session = snapshot.byId?.[id]
          return session === undefined ? null : { id, title: session.displayTitle ?? null, cwd: session.cwd ?? null }
        } catch {
          return null
        }
      }

      const desktop = () => document.documentElement.dataset.platform !== undefined || document.documentElement.hasAttribute('data-windows-titlebar')

      const sendToFrame = (frame, type, payload) => {
        try {
          frame?.contentWindow?.postMessage({ source: 'dsh-thoughtdag', type, ...payload }, location.origin)
        } catch {}
      }

      const syncCurrent = frame => {
        const session = currentSession()
        sendToFrame(frame, 'td:current-session', { session })
      }

      const getOverlay = () => document.querySelector('.dsh-td-overlay')

      const activateChat = () => {
        try {
          const session = currentSession()
          const binding = session !== null && typeof ctx.uiConversation?.binding === 'function'
            ? ctx.uiConversation.binding(session.id)
            : null
          if (binding && typeof binding.activate === 'function') {
            binding.activate('chat')
            return
          }
        } catch {}
        try {
          const chip = [...document.querySelectorAll('header button, [class*="header"] button')]
            .find(b => (b.textContent || '').trim() === '对话' && !b.closest('.dsh-td-switch'))
          if (chip) chip.click()
        } catch {}
      }

      // 2. MapView component registered to conversation.view slot
      const MapView = () => {
        const ref = React.useRef(null)
        React.useEffect(() => {
          const el = ref.current
          if (!el) return undefined

          let overlay = getOverlay()
          let mounted = true
          let pollTimer = null
          let laterTimer = null

          const setupOverlay = targetOverlay => {
            if (!targetOverlay || !mounted) return
            const frame = targetOverlay.querySelector('iframe')
            targetOverlay.classList.add('dsh-td-embedded')
            el.appendChild(targetOverlay)
            targetOverlay.hidden = false

            if (frame && !frame.src) {
              frame.src = frame.dataset.src || '/thoughtdag/'
            }

            syncCurrent(frame)
            sendToFrame(frame, 'td:view', { shown: true, bar: false, desktop: desktop() })
            laterTimer = window.setTimeout(() => {
              syncCurrent(frame)
              sendToFrame(frame, 'td:view', { shown: true, bar: false, desktop: desktop() })
            }, 350)
          }

          if (overlay) {
            setupOverlay(overlay)
          } else {
            pollTimer = window.setInterval(() => {
              overlay = getOverlay()
              if (overlay) {
                window.clearInterval(pollTimer)
                pollTimer = null
                setupOverlay(overlay)
              }
            }, 100)
          }

          return () => {
            mounted = false
            if (pollTimer) window.clearInterval(pollTimer)
            if (laterTimer) window.clearTimeout(laterTimer)
            const currentOverlay = getOverlay()
            if (currentOverlay) {
              const frame = currentOverlay.querySelector('iframe')
              sendToFrame(frame, 'td:view', { shown: false, bar: false, desktop: desktop() })
              currentOverlay.classList.remove('dsh-td-embedded')
              currentOverlay.hidden = true
              document.body.appendChild(currentOverlay)
            }
          }
        }, [])

        return React.createElement('div', { ref, className: 'dsh-td-view' })
      }

      if (ctx.slots && typeof ctx.slots.inject === 'function') {
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'thoughtdag',
          order: 20,
          label: () => '思维图'
        }, MapView))
      }

      // 3. Listen to canvas actions
      window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.data?.source !== 'dsh-thoughtdag') return
        if (event.data.type === 'td:close') {
          activateChat()
        }
      })
    }

    return module.exports
  }
})
