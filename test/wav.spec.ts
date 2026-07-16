import { describe, expect, it } from 'vitest'
import { concatPcmWithSilence, pcmDurationSec, silencePcm, wrapWav } from '../src/main/audio/wav'

const OPTS = { sampleRate: 44100, channels: 1, bitsPerSample: 16 as const }

describe('wav', () => {
  it('wrapWav пише коректний заголовок', () => {
    const pcm = Buffer.alloc(1000)
    const wav = wrapWav(pcm, OPTS)
    expect(wav.length).toBe(1044)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt32LE(24)).toBe(44100) // sample rate
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt32LE(40)).toBe(1000) // data size
  })

  it('silencePcm генерує правильну довжину', () => {
    const silence = silencePcm(500, OPTS) // 0.5 c
    expect(silence.length).toBe(44100) // 22050 семплів × 2 байти
    expect(silence.every((b) => b === 0)).toBe(true)
  })

  it('pcmDurationSec обчислює тривалість', () => {
    expect(pcmDurationSec(88200, OPTS)).toBeCloseTo(1.0)
  })

  it('concatPcmWithSilence вставляє тишу між частинами', () => {
    const a = Buffer.alloc(100, 1)
    const b = Buffer.alloc(100, 2)
    const joined = concatPcmWithSilence([a, b], 500, OPTS)
    expect(joined.length).toBe(100 + 44100 + 100)
    expect(joined[0]).toBe(1)
    expect(joined[150]).toBe(0) // тиша
    expect(joined[joined.length - 1]).toBe(2)
  })
})
