// Same PCM16 buffering policy as the reference realtime-monitor page.
export const AUDIO_PREBUFFER_SECONDS = 1
export const AUDIO_MAX_BUFFER_SECONDS = 10

export class PcmStreamPlayer {
  constructor(context, output, onBuffering = () => {}) {
    this.context = context
    this.output = output
    this.onBuffering = onBuffering
    this.pending = []
    this.pendingSeconds = 0
    this.scheduledAt = 0
    this.inputRate = 0
    this.sources = new Set()
    this.buffering = true
    this.disposed = false
  }

  get bufferedSeconds() { return this.pendingSeconds + Math.max(0, this.scheduledAt - this.context.currentTime) }

  enqueue(pcm, sampleRate) {
    if (this.disposed || !pcm.byteLength) return
    if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 384000) throw new Error('音频采样率无效')
    if (pcm.byteLength % 2) throw new Error('PCM16 音频块长度无效')
    if (this.inputRate && this.inputRate !== sampleRate) this.clear()
    this.inputRate = sampleRate
    if (!this.buffering && this.scheduledAt <= this.context.currentTime) {
      this.buffering = true
      this.scheduledAt = 0
      this.onBuffering(true)
    }
    const length = pcm.byteLength / 2
    if (this.bufferedSeconds + length / sampleRate > AUDIO_MAX_BUFFER_SECONDS) throw new Error('音频积压超过 10 秒，监听已停止')
    const buffer = this.context.createBuffer(1, length, sampleRate)
    const target = buffer.getChannelData(0)
    const samples = new DataView(pcm)
    for (let i = 0; i < length; i++) target[i] = samples.getInt16(i * 2, true) / 32768
    this.pending.push(buffer)
    this.pendingSeconds += buffer.duration
    if (this.buffering) {
      if (this.pendingSeconds + 1e-9 < AUDIO_PREBUFFER_SECONDS) return
      this.scheduledAt = this.context.currentTime + 0.02
      this.buffering = false
      this.onBuffering(false)
    }
    for (const block of this.pending) {
      const source = this.context.createBufferSource()
      source.buffer = block
      source.connect(this.output)
      source.onended = () => {
        this.sources.delete(source)
        source.disconnect()
        if (!this.disposed && !this.sources.size && this.context.currentTime >= this.scheduledAt) {
          this.buffering = true
          this.scheduledAt = 0
          this.onBuffering(true)
        }
      }
      this.sources.add(source)
      source.start(this.scheduledAt)
      this.scheduledAt += block.duration
    }
    this.pending = []
    this.pendingSeconds = 0
  }

  clear() {
    for (const source of this.sources) {
      source.onended = null
      try { source.stop() } catch { /* Already ended. */ }
      source.disconnect()
    }
    this.sources.clear()
    this.pending = []
    this.pendingSeconds = 0
    this.scheduledAt = 0
    this.buffering = true
    this.onBuffering(true)
  }

  stop() { this.disposed = true; this.clear() }
}
