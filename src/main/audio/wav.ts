export interface WavOptions {
  sampleRate: number
  channels: number
  bitsPerSample: 16
}

/** Обгортає raw PCM (s16le) у WAV-контейнер */
export function wrapWav(pcm: Buffer, opts: WavOptions): Buffer {
  const { sampleRate, channels, bitsPerSample } = opts
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8
  const header = Buffer.alloc(44)

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)

  return Buffer.concat([header, pcm])
}

export function pcmDurationSec(byteLength: number, opts: WavOptions): number {
  const byteRate = (opts.sampleRate * opts.channels * opts.bitsPerSample) / 8
  return byteLength / byteRate
}

/** Генерує тишу заданої довжини як PCM s16le */
export function silencePcm(ms: number, opts: WavOptions): Buffer {
  const byteRate = (opts.sampleRate * opts.channels * opts.bitsPerSample) / 8
  let bytes = Math.round((byteRate * ms) / 1000)
  bytes -= bytes % ((opts.channels * opts.bitsPerSample) / 8) // вирівнювання по фрейму
  return Buffer.alloc(Math.max(0, bytes))
}

/** Конкатенація PCM-буферів із тишею між ними */
export function concatPcmWithSilence(parts: Buffer[], silenceMs: number, opts: WavOptions): Buffer {
  if (!parts.length) return Buffer.alloc(0)
  const gap = silenceMs > 0 ? silencePcm(silenceMs, opts) : Buffer.alloc(0)
  const out: Buffer[] = []
  parts.forEach((p, i) => {
    if (i > 0 && gap.length) out.push(gap)
    out.push(p)
  })
  return Buffer.concat(out)
}
