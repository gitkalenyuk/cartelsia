/// <reference types="vite/client" />

declare module '*?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module '*.wav?url' {
  const url: string
  export default url
}

declare module '*.png' {
  const url: string
  export default url
}

declare module '@breezystack/lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number)
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array
    flush(): Int8Array
  }
}
