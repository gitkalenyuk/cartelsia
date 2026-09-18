/**
 * Cartelsia Native Go IPC & Protocol Bridge
 * Simulates Electron contextBridge cartelsia API with full nested namespaces
 * and transparent media:// redirection.
 */
(function () {
  "use strict";

  // 1. Transparent rewrite of media:// URLs for audio elements & fetch
  const rewriteMediaUrl = function(url) {
    if (typeof url !== "string") return url;
    if (url.startsWith("media://chunk/")) {
      return "/media/chunk/" + url.slice("media://chunk/".length);
    }
    if (url.startsWith("media://sample/")) {
      return "/media/sample/" + url.slice("media://sample/".length);
    }
    if (url.startsWith("media://")) {
      return "/media/" + url.slice("media://".length);
    }
    return url;
  };

  // Monkey-patch HTMLMediaElement.prototype.src
  const origSrcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
  if (origSrcDesc && origSrcDesc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      set: function(val) {
        return origSrcDesc.set.call(this, rewriteMediaUrl(val));
      },
      get: function() {
        return origSrcDesc.get.call(this);
      },
      configurable: true,
      enumerable: true
    });
  }

  // Monkey-patch setAttribute for audio elements
  const origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if ((name === "src" || name === "SRC") && (this instanceof HTMLMediaElement)) {
      value = rewriteMediaUrl(value);
    }
    return origSetAttribute.call(this, name, value);
  };

  // Monkey-patch fetch for media://
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === "string") {
      input = rewriteMediaUrl(input);
    } else if (input && typeof input.url === "string") {
      const rewritten = rewriteMediaUrl(input.url);
      if (rewritten !== input.url) {
        input = new Request(rewritten, input);
      }
    }
    return origFetch.call(this, input, init);
  };

  // 2. Generic IPC caller
  async function invoke(channel, payload) {
    const res = await origFetch("/api/ipc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: channel, args: payload !== undefined ? [payload] : [] })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
  }

  // 3. Server-Sent Events listener
  const eventListeners = new Set();
  const es = new EventSource("/api/events");
  es.onmessage = function (e) {
    try {
      const msg = JSON.parse(e.data);
      const evt = msg.payload || msg;
      for (const cb of eventListeners) {
        try { cb(evt); } catch (err) { console.error("[Cartelsia Bridge Event Error]", err); }
      }
    } catch (err) {
      console.warn("[Cartelsia SSE parse error]", err);
    }
  };

  // 4. Expose window.cartelsia
  window.cartelsia = {
    keys: {
      list: () => invoke("keys:list"),
      add: (keys, label, role) => invoke("keys:add", { keys, label, role }),
      importTxt: () => invoke("keys:importTxt"),
      update: (id, patch) => invoke("keys:update", { id, patch }),
      remove: (id) => invoke("keys:remove", { id }),
      probe: (id, quotaProbe) => invoke("keys:probe", { id, quotaProbe })
    },
    chats: {
      list: () => invoke("chats:list"),
      get: (id) => invoke("chats:get", { id }),
      create: (text, settings) => invoke("chats:create", { text, settings }),
      delete: (id) => invoke("chats:delete", { id }),
      rename: (id, title) => invoke("chats:rename", { id, title }),
      updateChunkText: (chatId, chunkId, text) =>
        invoke("chats:updateChunkText", { chatId, chunkId, text }),
      selectVersion: (chatId, chunkId, versionId) =>
        invoke("chats:selectVersion", { chatId, chunkId, versionId })
    },
    tts: {
      estimate: (text, settings) => invoke("tts:estimate", { text, settings }),
      start: (chatId) => invoke("tts:start", { chatId }),
      pause: (chatId) => invoke("tts:pause", { chatId }),
      resume: (chatId) => invoke("tts:resume", { chatId }),
      cancel: (chatId) => invoke("tts:cancel", { chatId }),
      retryChunk: (chatId, chunkId) => invoke("tts:retryChunk", { chatId, chunkId }),
      revoiceChunk: (chatId, chunkId, overrides) =>
        invoke("tts:revoiceChunk", { chatId, chunkId, overrides })
    },
    audio: {
      saveMerged: async (chatId, data, format, suggestedName) => {
        let base64 = "";
        if (data) {
          const bytes = new Uint8Array(data);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          base64 = btoa(binary);
        }
        return invoke("audio:saveMerged", { chatId, dataBase64: base64, format, suggestedName });
      },
      saveChunk: (chatId, file) => invoke("audio:saveChunk", { chatId, file }),
      readChunk: async (chatId, file) => {
        const url = "/media/chunk/" + encodeURIComponent(chatId) + "/" + encodeURIComponent(file);
        const res = await origFetch(url);
        return res.arrayBuffer();
      },
      reveal: (path) => invoke("audio:revealInFolder", { path })
    },
    voices: {
      list: (opts) => invoke("voices:list", opts || {}),
      clone: (opts) => invoke("voices:clone", opts),
      localize: (opts) => invoke("voices:localize", opts),
      deleteClone: (voiceId) => invoke("voices:deleteClone", { voiceId }),
      favoritesList: () => invoke("voices:favorites:list"),
      favoritesToggle: (voice) => invoke("voices:favorites:toggle", voice),
      clonesList: () => invoke("voices:clones:list"),
      getPreview: (opts) => invoke("voices:getPreview", opts),
      scanClones: () => invoke("voices:scanClones")
    },
    master: {
      status: () => invoke("master:status"),
      clone: (opts) => invoke("master:clone", opts),
      togglePublic: (voiceId) => invoke("master:togglePublic", { voiceId }),
      list: (existingClones) => invoke("master:list", { existingClones })
    },
    shared: {
      list: () => invoke("shared:list"),
      add: (voiceId, alias) => invoke("shared:add", { voiceId, alias }),
      remove: (alias) => invoke("shared:remove", { alias }),
      check: (alias) => invoke("shared:check", { alias })
    },
    settings: {
      get: () => invoke("settings:get"),
      set: (patch) => invoke("settings:set", { patch })
    },
    email: {
      testImap: (config) => invoke("email:testImap", { config }),
      checkVerification: (email, sinceMs) => invoke("email:checkVerification", { email, sinceMs }),
      saveAccountFile: (email, pass, key) => invoke("email:saveAccountFile", { email, pass, key }),
      runAutoReg: (count, catchAllDomain, imapConfig, opts) =>
        invoke("autoreg:run", { count, catchAllDomain, imapConfig, ...(opts || {}) }),
      getAutoRegStatus: () => invoke("autoreg:status"),
      stopAutoReg: () => invoke("autoreg:stop"),
      runAutoRegContinue: () => invoke("autoreg:continue"),
      runAutoRegCancel: () => invoke("autoreg:cancel")
    },
    proxy: {
      grab: (url) => invoke("proxy:grab", { url }),
      importText: (text) => invoke("proxy:import", { text }),
      check: () => invoke("proxy:check"),
      list: () => invoke("proxy:list"),
      remove: (url) => invoke("proxy:remove", { url }),
      checkStart: (opts) => invoke("proxy:checkStart", opts || {}),
      checkStop: () => invoke("proxy:checkStop"),
      importFile: () => invoke("proxy:importFile"),
      export: (masked) => invoke("proxy:export", { masked }),
      clear: (onlyDead) => invoke("proxy:clear", { onlyDead })
    },
    paths: {
      get: () => invoke("paths:get")
    },
    stats: {
      get: () => invoke("stats:get")
    },
    subtitles: {
      export: (chatId, format) => invoke("subtitles:export", { chatId, format })
    },
    debug: {
      setKeyUsage: (keyId, usedChars) => invoke("debug:setKeyUsage", { keyId, usedChars })
    },
    env: {
      e2e: false
    },
    onEvent: (cb) => {
      eventListeners.add(cb);
      return () => {
        eventListeners.delete(cb);
      };
    }
  };

  console.log("[Cartelsia Bridge] Native Go API initialized successfully.");
})();
