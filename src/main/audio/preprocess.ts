import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'

export interface PreprocessResult {
  /** Оброблений WAV (mono 44100 s16le, ≤10 c, loudnorm) */
  buffer: Buffer
  mimeType: 'audio/wav'
  fileName: string
  durationSec: number
}

/** Знайти ffmpeg: спочатку поруч із exe (app.getPath('exe')) / local bin, далі PATH */
function findFfmpeg(): string | null {
  // 1) ffmpeg.exe поруч із запущеним бінарем (portable)
  try {
    const exe = process.execPath
    if (exe) {
      const beside = join(exe, '..', 'ffmpeg.exe')
      if (existsSync(beside)) return beside
      const resources = join(exe, '..', 'resources', 'ffmpeg.exe')
      if (existsSync(resources)) return resources
    }
  } catch { /* ignore */ }
  // 2) у PATH — spawn сам знайде
  return null
}

/**
 * ffmpeg-препроцесинг кліпу для клонування:
 *  - silence trim на початку/кінці + видалення внутрішніх пауз >1.2 c
 *  - loudness normalization: I=-16 LUFS, TP=-1.5 dB, LRA=11
 *  - mono 44100 Hz PCM s16
 *  - жорсткий cap 10 с (-t)
 * Повертає WAV у памʼяті; тимчасові файли видаляються.
 */
export async function preprocessAudio(
  input: Buffer,
  opts: { maxDurationSec?: number } = {}
): Promise<PreprocessResult> {
  const maxDur = Math.min(opts.maxDurationSec ?? 10, 10)
  const dir = mkdtempSync(join(tmpdir(), 'cartelsia-audio-'))
  const inPath = join(dir, 'input.raw')
  const outPath = join(dir, 'out.wav')
  writeFileSync(inPath, input)

  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-y',
    '-i', inPath,
    '-t', String(maxDur),
    '-af', [
      'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15',
      'areverse',
      'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05',
      'areverse',
      // внутрішні паузи коротшають до ~0.35 c
      'silencedetect=noise=-40dB:d=1.2', // діагностика (не впливає, дешево)
      'loudnorm=I=-16:TP=-1.5:LRA=11',
      'aresample=44100'
    ].join(','),
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    outPath
  ]

  try {
    await runFfmpeg(args)
    const buffer = readFileSync(outPath)
    if (buffer.length <= 44) throw new Error('ffmpeg повернув порожній файл')
    // тривалість: байти - header → сек
    const pcmBytes = buffer.length - 44
    const durationSec = pcmBytes / (44100 * 2) // mono s16 = 2 bytes/frame @44100
    return { buffer, mimeType: 'audio/wav', fileName: 'clip.wav', durationSec }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = findFfmpeg() ?? 'ffmpeg'
    const proc = spawn(bin, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new Error(
          'FFmpeg не знайдено. Встановіть його (https://www.gyan.dev/ffmpeg/builds/) або покладіть ffmpeg.exe поруч із Cartelsia.exe'
        ))
      } else reject(err)
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg завершився з кодом ${code}: ${stderr.trim().slice(0, 500)}`))
    })
  })
}

/** SHA-256 від буфера (WebCrypto у main доступний з Node 18+ як globalThis.crypto.subtle) */
export async function sha256Hex(buf: Buffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(buf))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
