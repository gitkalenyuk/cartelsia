import {
  useChatsStore,
  useKeysStore,
  useQueueStore,
  toast
} from '../stores/appStore'
import { t } from '../i18n/uk'
import { runAutoMerge } from '../audio/mergeService'
import doneSound from '../assets/done.wav?url'

let bound = false

/** Одноразова підписка: IPC-події пишуть у стори ПОЗА React */
export function bindMainEvents(): void {
  if (bound) return
  bound = true

  window.cartelsia.onEvent((event) => {
    switch (event.type) {
      case 'key-updated':
        useKeysStore.getState().applyUpdate(event.key)
        break
      case 'keys-replaced':
        useKeysStore.getState().replaceAll(event.keys)
        break
      case 'queue-state':
        useQueueStore.getState().apply(event.snapshot)
        if (event.snapshot.state === 'running') {
          useQueueStore.getState().setPaused(event.snapshot.chatId, null)
        }
        break
      case 'chunk-status':
        useChatsStore.getState().applyChunk(event.chatId, event.chunk)
        break
      case 'scheduler-paused':
        if (event.reason !== 'user') {
          useQueueStore
            .getState()
            .setPaused(event.chatId, { reason: event.reason, resumeAt: event.resumeAt })
        }
        break
      case 'queue-finished': {
        void useChatsStore.getState().loadChat(event.chatId)
        void useChatsStore.getState().loadList()
        const settings = window.cartelsia.settings.get()
        void settings.then((s) => {
          if (s.notifySound) {
            const audio = new Audio(doneSound)
            audio.volume = 0.5
            void audio.play().catch(() => undefined)
          }
        })
        toast(
          event.failed > 0 ? 'info' : 'success',
          `${t.generationDone}: ${event.ok} ✓${event.failed ? ` · ${event.failed} ✗` : ''}`
        )
        break
      }
      case 'merge-requested':
        void runAutoMerge(event.chatId)
        break
      case 'chat-updated':
        useChatsStore.getState().setChat(event.chat)
        break
      case 'shared-voice-revoked':
        toast('danger', t.sharedVoiceRevokedAbort(event.alias))
        void useChatsStore.getState().loadChat(event.chatId)
        break
    }
  })
}
