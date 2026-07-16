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
 *  media://sample/<fileName>            → кешований семпл голосу з data/previews
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
        const fileRes = await net.fetch(pathToFileURL(abs).toString(), {
          headers: req.headers
        })
        // без CORS-заголовка fetch() із renderer (file://-origin) падає; <audio> не підпадає
        const headers = new Headers(fileRes.headers)
        headers.set('Access-Control-Allow-Origin', '*')
        return new Response(fileRes.body, { status: fileRes.status, headers })
      }

      if (host === 'sample') {
        const fileName = parts[0]
        if (!fileName || fileName.includes('..')) return new Response('bad request', { status: 400 })
        const abs = normalize(voices.previewPath(fileName))
        const sampleRes = await net.fetch(pathToFileURL(abs).toString(), { headers: req.headers })
        const headers = new Headers(sampleRes.headers)
        headers.set('Access-Control-Allow-Origin', '*')
        return new Response(sampleRes.body, { status: sampleRes.status, headers })
      }

      return new Response('not found', { status: 404 })
    } catch (err) {
      console.error('[media protocol]', err)
      return new Response('error', { status: 500 })
    }
  })
}
