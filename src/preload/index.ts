import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipcContract'
import type {
  AddKeysResult,
  ApiKeyPublic,
  AppPaths,
  CartesiaVoice,
  Chat,
  ChatSummary,
  Chunk,
  ClonedVoiceMeta,
  GenerationSettings,
  MainEvent,
  PreflightEstimate,
  Settings,
  StatsSummary,
  VoiceFavorite
} from '../shared/types'

const api = {
  keys: {
    list: (): Promise<ApiKeyPublic[]> => ipcRenderer.invoke(IPC.KEYS_LIST),
    add: (keys: string[], label?: string): Promise<AddKeysResult> =>
      ipcRenderer.invoke(IPC.KEYS_ADD, { keys, label }),
    importTxt: (): Promise<AddKeysResult> => ipcRenderer.invoke(IPC.KEYS_IMPORT_TXT),
    update: (id: string, patch: { label?: string; limit?: number }): Promise<ApiKeyPublic> =>
      ipcRenderer.invoke(IPC.KEYS_UPDATE, { id, patch }),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.KEYS_REMOVE, { id }),
    probe: (
      id: string,
      quotaProbe?: boolean
    ): Promise<{ authValid: boolean; quotaOk?: boolean; key: ApiKeyPublic }> =>
      ipcRenderer.invoke(IPC.KEYS_PROBE, { id, quotaProbe })
  },
  chats: {
    list: (): Promise<ChatSummary[]> => ipcRenderer.invoke(IPC.CHATS_LIST),
    get: (id: string): Promise<Chat | null> => ipcRenderer.invoke(IPC.CHATS_GET, { id }),
    create: (
      text: string,
      settings: GenerationSettings
    ): Promise<{ chat: Chat; estimate: PreflightEstimate }> =>
      ipcRenderer.invoke(IPC.CHATS_CREATE, { text, settings }),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.CHATS_DELETE, { id }),
    rename: (id: string, title: string): Promise<void> =>
      ipcRenderer.invoke(IPC.CHATS_RENAME, { id, title }),
    updateChunkText: (chatId: string, chunkId: string, text: string): Promise<Chunk | null> =>
      ipcRenderer.invoke(IPC.CHATS_UPDATE_CHUNK_TEXT, { chatId, chunkId, text }),
    selectVersion: (chatId: string, chunkId: string, versionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.CHATS_SELECT_VERSION, { chatId, chunkId, versionId })
  },
  tts: {
    estimate: (text: string, settings: GenerationSettings): Promise<PreflightEstimate> =>
      ipcRenderer.invoke(IPC.TTS_ESTIMATE, { text, settings }),
    start: (chatId: string): Promise<void> => ipcRenderer.invoke(IPC.TTS_START, { chatId }),
    pause: (chatId: string): Promise<void> => ipcRenderer.invoke(IPC.TTS_PAUSE, { chatId }),
    resume: (chatId: string): Promise<void> => ipcRenderer.invoke(IPC.TTS_RESUME, { chatId }),
    cancel: (chatId: string): Promise<void> => ipcRenderer.invoke(IPC.TTS_CANCEL, { chatId }),
    retryChunk: (chatId: string, chunkId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.TTS_RETRY_CHUNK, { chatId, chunkId }),
    revoiceChunk: (
      chatId: string,
      chunkId: string,
      overrides?: Partial<GenerationSettings>
    ): Promise<void> => ipcRenderer.invoke(IPC.TTS_REVOICE_CHUNK, { chatId, chunkId, overrides })
  },
  audio: {
    saveMerged: (
      chatId: string,
      data: ArrayBuffer,
      format: 'mp3' | 'wav',
      suggestedName: string
    ): Promise<{ path: string | null }> =>
      ipcRenderer.invoke(IPC.AUDIO_SAVE_MERGED, { chatId, data, format, suggestedName }),
    saveChunk: (chatId: string, file: string): Promise<{ path: string | null }> =>
      ipcRenderer.invoke(IPC.AUDIO_SAVE_CHUNK, { chatId, file }),
    readChunk: (chatId: string, file: string): Promise<ArrayBuffer> =>
      ipcRenderer.invoke(IPC.AUDIO_READ_CHUNK, { chatId, file }),
    reveal: (path: string): Promise<void> => ipcRenderer.invoke(IPC.AUDIO_REVEAL, { path })
  },
  voices: {
    list: (opts?: {
      keyId?: string
      q?: string
      gender?: string
      language?: string
      isOwner?: boolean
      cursor?: string
    }): Promise<{ data: CartesiaVoice[]; hasMore: boolean; nextCursor?: string }> =>
      ipcRenderer.invoke(IPC.VOICES_LIST, opts),
    clone: (opts: {
      keyId?: string
      name: string
      language: string
      description?: string
      clip: ArrayBuffer
      mimeType: string
    }): Promise<ClonedVoiceMeta> => ipcRenderer.invoke(IPC.VOICES_CLONE, opts),
    localize: (opts: {
      voiceId: string
      name: string
      language: string
      originalSpeakerGender: 'male' | 'female'
    }): Promise<ClonedVoiceMeta> => ipcRenderer.invoke(IPC.VOICES_LOCALIZE, opts),
    deleteClone: (voiceId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.VOICES_DELETE_CLONE, { voiceId }),
    favoritesList: (): Promise<VoiceFavorite[]> => ipcRenderer.invoke(IPC.VOICES_FAVORITES_LIST),
    favoritesToggle: (voice: Omit<VoiceFavorite, 'addedAt'>): Promise<VoiceFavorite[]> =>
      ipcRenderer.invoke(IPC.VOICES_FAVORITES_TOGGLE, voice),
    clonesList: (): Promise<ClonedVoiceMeta[]> => ipcRenderer.invoke(IPC.VOICES_CLONES_LIST)
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (patch: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke(IPC.SETTINGS_SET, { patch })
  },
  paths: {
    get: (): Promise<AppPaths> => ipcRenderer.invoke(IPC.PATHS_GET)
  },
  stats: {
    get: (): Promise<StatsSummary> => ipcRenderer.invoke(IPC.STATS_GET)
  },
  subtitles: {
    export: (chatId: string, format: 'srt' | 'vtt'): Promise<{ path: string | null; error?: string }> =>
      ipcRenderer.invoke(IPC.SUBTITLES_EXPORT, { chatId, format })
  },
  debug: {
    setKeyUsage: (keyId: string, usedChars: number): Promise<ApiKeyPublic> =>
      ipcRenderer.invoke(IPC.DEBUG_SET_KEY_USAGE, { keyId, usedChars })
  },
  onEvent: (cb: (event: MainEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: MainEvent): void => cb(event)
    ipcRenderer.on(IPC.EVENT, listener)
    return () => ipcRenderer.removeListener(IPC.EVENT, listener)
  }
}

export type CartelsiaApi = typeof api

contextBridge.exposeInMainWorld('cartelsia', api)
