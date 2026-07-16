export interface RecorderHandle {
  stop: () => void
  cancel: () => void
}

/**
 * Запис із мікрофона для клонування: MediaRecorder (webm/opus),
 * жорсткий стоп на maxSeconds, рівень сигналу через AnalyserNode.
 */
export async function startRecording(opts: {
  maxSeconds: number
  onLevel: (level: number) => void
  onTick: (elapsedSec: number) => void
  onDone: (blob: Blob) => void
}): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
  const recorder = new MediaRecorder(stream, { mimeType })
  const chunks: Blob[] = []
  let cancelled = false

  // рівень сигналу
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  source.connect(analyser)
  const buf = new Uint8Array(analyser.frequencyBinCount)
  let rafId = 0
  const meter = (): void => {
    analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += (v - 128) ** 2
    opts.onLevel(Math.min(1, Math.sqrt(sum / buf.length) / 40))
    rafId = requestAnimationFrame(meter)
  }
  rafId = requestAnimationFrame(meter)

  const startedAt = Date.now()
  const tickTimer = setInterval(() => {
    opts.onTick(Math.floor((Date.now() - startedAt) / 1000))
  }, 250)

  const cleanup = (): void => {
    cancelAnimationFrame(rafId)
    clearInterval(tickTimer)
    clearTimeout(hardStop)
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }

  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  recorder.onstop = () => {
    cleanup()
    if (!cancelled) opts.onDone(new Blob(chunks, { type: mimeType }))
  }

  const hardStop = setTimeout(() => {
    if (recorder.state === 'recording') recorder.stop()
  }, opts.maxSeconds * 1000)

  recorder.start(250)

  return {
    stop: () => {
      if (recorder.state === 'recording') recorder.stop()
    },
    cancel: () => {
      cancelled = true
      if (recorder.state === 'recording') recorder.stop()
      else cleanup()
    }
  }
}
