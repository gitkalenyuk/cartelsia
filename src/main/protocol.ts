import { protocol, net } from 'electron'
import { pathToFileURL } from 'url'
import { join, normalize } from 'path'
import { dataDir } from './paths'
import type { VoicesService } from './voices/voicesService'

/** ДО app.whenReady(): привілеї схеми media:// (stream → Range-запити для перемотки) */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * ПІСЛЯ app.whenReady():
 *  media://chunk/<chatId>/<relPath...>  → файл із data/chats/<chatId>/<relPath>
 *  media://preview/<base64url(url)>     → проксі превʼю голосу через main-fetch (CORS)
 */
export function handleMediaProtocol(voices: VoicesService): void {
  protocol.handle('media', async (req) => {
    try {
      const url = new URL(req.url)
      const host = url.host
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

      if (host === 'chunk') {
        const [chatId, ...rel] = parts
        if (!chatId || !rel.length) return new Response('bad request', { status: 400 })
        const root = normalize(join(dataDir(), 'chats', chatId))
        const abs = normalize(join(root, ...rel))
        if (!abs.startsWith(root)) return new Response('forbidden', { status: 403 })
        // net.fetch по file:// нативно обробляє Range-заголовки
        return net.fetch(pathToFileURL(abs).toString(), {
          headers: req.headers
        })
      }

      if (host === 'preview') {
        const encoded = parts[0]
        if (!encoded) return new Response('bad request', { status: 400 })
        const remote = Buffer.from(encoded, 'base64url').toString('utf8')
        if (!/^https:\/\//.test(remote)) return new Response('forbidden', { status: 403 })
        const { data, contentType } = await voices.fetchPreview(remote)
        return new Response(new Uint8Array(data), { headers: { 'Content-Type': contentType } })
      }

      return new Response('not found', { status: 404 })
    } catch (err) {
      console.error('[media protocol]', err)
      return new Response('error', { status: 500 })
    }
  })
}
