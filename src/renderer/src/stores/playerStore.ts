import { create } from 'zustand'

export interface PlayerTrack {
  chatId: string
  chunkId: string
  versionId: string
  url: string
}

interface PlayerState {
  current: PlayerTrack | null
  playing: boolean
  currentTime: number
  duration: number
  playlist: PlayerTrack[] | null
  playlistIndex: number
  play: (track: PlayerTrack) => void
  toggle: () => void
  seek: (t: number) => void
  playAll: (tracks: PlayerTrack[]) => void
  stop: () => void
  next: () => void
  prev: () => void
}

/** Єдиний спільний аудіоелемент: гарантія одного відтворення + плейліст */
const audio = new Audio()
let rafId = 0

function tickTime(): void {
  usePlayerStore.setState({
    currentTime: audio.currentTime,
    duration: isFinite(audio.duration) ? audio.duration : 0
  })
  rafId = requestAnimationFrame(tickTime)
}

audio.addEventListener('play', () => {
  usePlayerStore.setState({ playing: true })
  cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(tickTime)
})
audio.addEventListener('pause', () => {
  usePlayerStore.setState({ playing: false })
  cancelAnimationFrame(rafId)
})
audio.addEventListener('ended', () => {
  const s = usePlayerStore.getState()
  if (s.playlist && s.playlistIndex < s.playlist.length - 1) {
    s.next()
  } else {
    usePlayerStore.setState({ playing: false, playlist: null, current: s.playlist ? null : s.current })
  }
})
audio.addEventListener('loadedmetadata', () => {
  usePlayerStore.setState({ duration: isFinite(audio.duration) ? audio.duration : 0 })
})
audio.addEventListener('durationchange', () => {
  if (isFinite(audio.duration) && audio.duration > 0) {
    usePlayerStore.setState({ duration: audio.duration })
  }
})

function load(track: PlayerTrack): void {
  audio.src = track.url
  usePlayerStore.setState({ current: track, currentTime: 0, duration: 0 })
  void audio.play().catch((err) => console.error('[player]', err))
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  current: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  playlist: null,
  playlistIndex: 0,

  play: (track) => {
    const s = get()
    if (s.current?.versionId === track.versionId && s.current?.chunkId === track.chunkId) {
      if (audio.paused) void audio.play()
      return
    }
    set({ playlist: null, playlistIndex: 0 })
    load(track)
  },

  toggle: () => {
    if (audio.paused) void audio.play()
    else audio.pause()
  },

  seek: (t) => {
    audio.currentTime = t
  },

  playAll: (tracks) => {
    if (!tracks.length) return
    set({ playlist: tracks, playlistIndex: 0 })
    load(tracks[0])
  },

  stop: () => {
    audio.pause()
    audio.src = ''
    set({ current: null, playing: false, playlist: null, currentTime: 0, duration: 0 })
  },

  next: () => {
    const s = get()
    if (!s.playlist) return
    const idx = Math.min(s.playlistIndex + 1, s.playlist.length - 1)
    set({ playlistIndex: idx })
    load(s.playlist[idx])
  },

  prev: () => {
    const s = get()
    if (!s.playlist) return
    const idx = Math.max(s.playlistIndex - 1, 0)
    set({ playlistIndex: idx })
    load(s.playlist[idx])
  }
}))

export function mediaUrl(chatId: string, file: string): string {
  return `media://chunk/${chatId}/${file.split('/').map(encodeURIComponent).join('/')}`
}
