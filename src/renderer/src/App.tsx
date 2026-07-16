import { useEffect } from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { ChatView } from './components/chat/ChatView'
import { KeysView } from './components/keys/KeysView'
import { VoicesView } from './components/voices/VoicesView'
import { CloneVoiceView } from './components/voices/CloneVoiceView'
import { BrowserView } from './components/browser/BrowserView'
import { StatsView } from './components/stats/StatsView'
import { SettingsView } from './components/settings/SettingsView'
import { ToastHost } from './components/common/ToastHost'
import { useUiStore } from './stores/appStore'
import { usePlayerStore } from './stores/playerStore'

export default function App(): React.JSX.Element {
  const view = useUiStore((s) => s.view)

  // глобальні шорткати
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const inField =
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')
      if (e.code === 'Space' && !inField) {
        const p = usePlayerStore.getState()
        if (p.current) {
          e.preventDefault()
          p.toggle()
        }
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        useUiStore.getState().openChat(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="shell">
      <div className="dragbar" />
      <Sidebar />
      {view === 'browser' ? (
        <main className="main" style={{ overflow: 'hidden' }}>
          <BrowserView />
        </main>
      ) : (
        <main className="main">
          <div className="main__inner">
            {view === 'chat' && <ChatView />}
            {view === 'keys' && <KeysView />}
            {view === 'voices' && <VoicesView />}
            {view === 'clone' && <CloneVoiceView />}
            {view === 'stats' && <StatsView />}
            {view === 'settings' && <SettingsView />}
          </div>
        </main>
      )}
      <ToastHost />
    </div>
  )
}
