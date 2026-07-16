import { Mp3Encoder } from '@breezystack/lamejs'

interface EncodeRequest {
  samples: Int16Array
  sampleRate: number
  kbps: number
}

self.onmessage = (e: MessageEvent<EncodeRequest>) => {
  try {
    const { samples, sampleRate, kbps } = e.data
    const encoder = new Mp3Encoder(1, sampleRate, kbps)
    const blockSize = 1152
    const chunks: Uint8Array[] = []

    for (let i = 0; i < samples.length; i += blockSize) {
      const block = samples.subarray(i, i + blockSize)
      const encoded = encoder.encodeBuffer(block)
      if (encoded.length) chunks.push(new Uint8Array(encoded))
    }
    const final = encoder.flush()
    if (final.length) chunks.push(new Uint8Array(final))

    const total = chunks.reduce((s, c) => s + c.length, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      out.set(c, off)
      off += c.length
    }
    ;(self as unknown as Worker).postMessage({ ok: true, data: out.buffer }, [out.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
