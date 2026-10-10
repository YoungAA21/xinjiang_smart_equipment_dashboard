import { signalFrame } from './data.js'

// Local stand-in for the two monitor streams; never opens a network connection.
export class DemoSocket {
  constructor(url) {
    this.closed = false
    this.phase = Array.from(url).reduce((seed, character) => seed + character.charCodeAt(0), 0) % 31
    this.timer = setInterval(() => {
      if (this.closed) return
      if (!this.opened) { this.opened = true; this.onopen?.() }
      this.phase += .2
      if (url.includes('/monitor/audio/')) {
        const pcm = new Int16Array(2200)
        for (let i = 0; i < pcm.length; i++) pcm[i] = 900 * Math.sin((i + this.phase * 11000) * Math.PI * 2 * 220 / 22000)
        this.onmessage?.({ data: pcm.buffer })
      } else {
        this.onmessage?.({ data: JSON.stringify(signalFrame(this.phase)) })
      }
    }, 100)
  }
  close() {
    this.closed = true
    clearInterval(this.timer)
    this.onclose?.()
  }
}
