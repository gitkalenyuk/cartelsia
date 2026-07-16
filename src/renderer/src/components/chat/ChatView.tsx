import { useEffect } from 'react'
import { useChatsStore, useUiStore } from '../../stores/appStore'
import { Composer } from './Composer'
import { GenerationView } from './GenerationView'

export function ChatView(): React.JSX.Element {
  const activeChatId = useUiStore((s) => s.activeChatId)
  const chat = useChatsStore((s) => (activeChatId ? s.byId[activeChatId] : undefined))

  useEffect(() => {
    if (activeChatId && !chat) void useChatsStore.getState().loadChat(activeChatId)
  }, [activeChatId, chat])

  if (!activeChatId) return <Composer />
  if (!chat)
    return (
      <div className="row" style={{ justifyContent: 'center', paddingTop: '20vh' }}>
        <span className="spinner" />
      </div>
    )
  return <GenerationView chat={chat} />
}
