import { create } from 'zustand'
import { toast } from '../stores/appStore'
import { usePlayerStore } from '../stores/playerStore'
import { t } from '../i18n/uk'

interface SamplePlayerState {
  playingVoiceId: string | null
  loadingVoiceId: string | null
  toggle: (voice: { id: string; previewUrl?: string }, language?: string) => Promise<void>
  stop: () => void
}

const audio = new Audio()
audio.addEventListener('ended', () => {
  useSamplePlayer.setState({ playingVoiceId: null })
})

/**
 * Єдиний плеєр семплів голосів (пікер + бібліотека).
 * Оригінальний семпл або згенерований (~30-40 символів, кешується назавжди) — рішення приймає main.
 */
export const useSamplePlayer = create<SamplePlayerState>((set, get) => ({
  playingVoiceId: null,
  loadingVoiceId: null,

  toggle: async (voice, language) => {
    const s = get()
    if (s.playingVoiceId === voice.id) {
      audio.pause()
      set({ playingVoiceId: null })
      return
    }
    if (s.loadingVoiceId) return
    audio.pause()
    usePlayerStore.getState().stop() // не змішуємо з плеєром чанків
    set({ loadingVoiceId: voice.id, playingVoiceId: null })
    try {
      const { file } = await window.cartelsia.voices.getPreview({
        voiceId: voice.id,
        previewUrl: voice.previewUrl,
        language
      })
      audio.src = `media://sample/${encodeURIComponent(file)}`
      await audio.play()
      set({ playingVoiceId: voice.id, loadingVoiceId: null })
    } catch (err) {
      set({ loadingVoiceId: null })
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    }
  },

  stop: () => {
    audio.pause()
    set({ playingVoiceId: null, loadingVoiceId: null })
  }
}))
