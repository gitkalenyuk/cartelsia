import { create } from 'zustand'
import type {
  ApiKeyPublic,
  AppPaths,
  Chat,
  ChatSummary,
  Chunk,
  ClonedVoiceMeta,
  QueueStateSnapshot,
  Settings,
  VoiceFavorite
} from '@shared/types'

export type ViewId = 'chat' | 'keys' | 'voices' | 'clone' | 'stats' | 'settings'

interface UiState {
  view: ViewId
  activeChatId: string | null
  setView: (view: ViewId) => void
  openChat: (chatId: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  view: 'chat',
  activeChatId: null,
  setView: (view) => set({ view }),
  openChat: (activeChatId) => set({ view: 'chat', activeChatId })
}))

// ---------- Ключі ----------
interface KeysState {
  keys: ApiKeyPublic[]
  loaded: boolean
  load: () => Promise<void>
  applyUpdate: (key: ApiKeyPublic) => void
  replaceAll: (keys: ApiKeyPublic[]) => void
}

export const useKeysStore = create<KeysState>((set) => ({
  keys: [],
  loaded: false,
  load: async () => {
    const keys = await window.cartelsia.keys.list()
    set({ keys, loaded: true })
  },
  applyUpdate: (key) =>
    set((s) => ({
      keys: s.keys.some((k) => k.id === key.id)
        ? s.keys.map((k) => (k.id === key.id ? key : k))
        : [...s.keys, key]
    })),
  replaceAll: (keys) => set({ keys })
}))

/** Доступний залишок ЗАГАЛЬНОГО пулу (клон-ключі окремо — вони лише для своїх голосів) */
export const totalRemaining = (keys: ApiKeyPublic[]): number =>
  keys
    .filter((k) => k.status === 'active' && k.role !== 'clone')
    .reduce((s, k) => s + k.remaining, 0)

// ---------- Чати ----------
interface ChatsState {
  summaries: ChatSummary[]
  byId: Record<string, Chat>
  loadList: () => Promise<void>
  loadChat: (id: string) => Promise<Chat | null>
  setChat: (chat: Chat) => void
  applyChunk: (chatId: string, chunk: Chunk) => void
  removeChat: (id: string) => void
}

export const useChatsStore = create<ChatsState>((set, get) => ({
  summaries: [],
  byId: {},
  loadList: async () => {
    const summaries = await window.cartelsia.chats.list()
    set({ summaries })
  },
  loadChat: async (id) => {
    const chat = await window.cartelsia.chats.get(id)
    if (chat) set((s) => ({ byId: { ...s.byId, [id]: chat } }))
    return chat
  },
  setChat: (chat) => {
    set((s) => ({ byId: { ...s.byId, [chat.id]: chat } }))
    void get().loadList()
  },
  applyChunk: (chatId, chunk) =>
    set((s) => {
      const chat = s.byId[chatId]
      if (!chat) return s
      const chunks = chat.chunks.map((c) => (c.id === chunk.id ? chunk : c))
      return { byId: { ...s.byId, [chatId]: { ...chat, chunks } } }
    }),
  removeChat: (id) =>
    set((s) => {
      const byId = { ...s.byId }
      delete byId[id]
      return { byId, summaries: s.summaries.filter((c) => c.id !== id) }
    })
}))

// ---------- Черга ----------
interface QueueState {
  byChatId: Record<string, QueueStateSnapshot>
  pausedInfo: Record<string, { reason: string; resumeAt?: string }>
  apply: (snapshot: QueueStateSnapshot) => void
  setPaused: (chatId: string, info: { reason: string; resumeAt?: string } | null) => void
}

export const useQueueStore = create<QueueState>((set) => ({
  byChatId: {},
  pausedInfo: {},
  apply: (snapshot) =>
    set((s) => ({ byChatId: { ...s.byChatId, [snapshot.chatId]: snapshot } })),
  setPaused: (chatId, info) =>
    set((s) => {
      const pausedInfo = { ...s.pausedInfo }
      if (info) pausedInfo[chatId] = info
      else delete pausedInfo[chatId]
      return { pausedInfo }
    })
}))

// ---------- Налаштування ----------
interface SettingsState {
  settings: Settings | null
  paths: AppPaths | null
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  paths: null,
  load: async () => {
    const [settings, paths] = await Promise.all([
      window.cartelsia.settings.get(),
      window.cartelsia.paths.get()
    ])
    set({ settings, paths })
  },
  update: async (patch) => {
    const settings = await window.cartelsia.settings.set(patch)
    set({ settings })
  }
}))

// ---------- Голоси (вибране + клони) ----------
interface VoicesLocalState {
  favorites: VoiceFavorite[]
  clones: ClonedVoiceMeta[]
  load: () => Promise<void>
  setFavorites: (f: VoiceFavorite[]) => void
  setClones: (c: ClonedVoiceMeta[]) => void
}

export const useVoicesLocalStore = create<VoicesLocalState>((set) => ({
  favorites: [],
  clones: [],
  load: async () => {
    const [favorites, clones] = await Promise.all([
      window.cartelsia.voices.favoritesList(),
      window.cartelsia.voices.clonesList()
    ])
    set({ favorites, clones })
  },
  setFavorites: (favorites) => set({ favorites }),
  setClones: (clones) => set({ clones })
}))

// ---------- Тости ----------
export interface Toast {
  id: number
  tone: 'success' | 'danger' | 'info'
  message: string
  action?: { label: string; onClick: () => void }
}

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

let toastId = 0
export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }))
    setTimeout(() => get().dismiss(id), 4500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
}))

export const toast = (
  tone: Toast['tone'],
  message: string,
  action?: Toast['action']
): void => useToastStore.getState().push({ tone, message, action })
