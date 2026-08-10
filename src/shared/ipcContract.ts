// Імена IPC-каналів — єдине джерело правди для preload/main/renderer
export const IPC = {
  // ключі
  KEYS_LIST: 'keys:list',
  KEYS_ADD: 'keys:add',
  KEYS_IMPORT_TXT: 'keys:importTxt',
  KEYS_UPDATE: 'keys:update',
  KEYS_REMOVE: 'keys:remove',
  KEYS_PROBE: 'keys:probe',
  // чати
  CHATS_LIST: 'chats:list',
  CHATS_GET: 'chats:get',
  CHATS_CREATE: 'chats:create',
  CHATS_DELETE: 'chats:delete',
  CHATS_RENAME: 'chats:rename',
  CHATS_UPDATE_CHUNK_TEXT: 'chats:updateChunkText',
  CHATS_SELECT_VERSION: 'chats:selectVersion',
  // генерація
  TTS_ESTIMATE: 'tts:estimate',
  TTS_START: 'tts:start',
  TTS_PAUSE: 'tts:pause',
  TTS_RESUME: 'tts:resume',
  TTS_CANCEL: 'tts:cancel',
  TTS_RETRY_CHUNK: 'tts:retryChunk',
  TTS_REVOICE_CHUNK: 'tts:revoiceChunk',
  // аудіо
  AUDIO_SAVE_MERGED: 'audio:saveMerged',
  AUDIO_SAVE_CHUNK: 'audio:saveChunk',
  AUDIO_READ_CHUNK: 'audio:readChunk',
  AUDIO_REVEAL: 'audio:revealInFolder',
  // голоси
  VOICES_LIST: 'voices:list',
  VOICES_CLONE: 'voices:clone',
  VOICES_LOCALIZE: 'voices:localize',
  VOICES_DELETE_CLONE: 'voices:deleteClone',
  VOICES_FAVORITES_LIST: 'voices:favorites:list',
  VOICES_FAVORITES_TOGGLE: 'voices:favorites:toggle',
  VOICES_CLONES_LIST: 'voices:clones:list',
  VOICES_GET_PREVIEW: 'voices:getPreview',
  VOICES_SCAN_CLONES: 'voices:scanClones',
  // налаштування / статистика / субтитри
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  PATHS_GET: 'paths:get',
  STATS_GET: 'stats:get',
  SUBTITLES_EXPORT: 'subtitles:export',
  // imap / автореєстрація
  EMAIL_TEST_IMAP: 'email:testImap',
  EMAIL_CHECK_VERIFICATION: 'email:checkVerification',
  EMAIL_SAVE_ACCOUNT_FILE: 'email:saveAccountFile',
  AUTOREG_RUN: 'autoreg:run',
  AUTOREG_CONTINUE: 'autoreg:continue',
  AUTOREG_CANCEL: 'autoreg:cancel',
  AUTOREG_STATUS: 'autoreg:status',
  AUTOREG_STOP: 'autoreg:stop',
  // debug (тільки dev)
  DEBUG_SET_KEY_USAGE: 'debug:setKeyUsage',
  // події
  EVENT: 'cartelsia:event'
} as const
