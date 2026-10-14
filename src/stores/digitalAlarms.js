import { defineStore } from 'pinia'
import { telemetryApi } from '../services/telemetry.js'
import { pointKey } from '../charts/telemetry.js'
import { digitalModules, isDigitalSignal, updateDigitalAlarms } from '../charts/digitalAlarms.js'

let timer, controller, generation = 0, busy = false
export const useDigitalAlarmStore = defineStore('digitalAlarms', {
  state: () => ({ events: [], states: {}, metadata: {}, pending: [], storageKey: '', error: '', cacheError: '', updatedAt: null }),
  getters: { notifications: state => state.pending.map(id => state.events.find(row => row.alarmId === id)).filter(Boolean) },
  actions: {
    save() {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify({ version: 1, events: this.events, states: this.states }))
        this.cacheError = ''
      } catch { this.cacheError = '浏览器缓存写入失败，DI 告警暂保留在当前页面内存中' }
    },
    ingest(samples) {
      const result = updateDigitalAlarms(this, samples, this.metadata)
      if (!result.changed) return
      this.events = result.events
      this.states = result.states
      // Automatic alarm prompts are paused until they move to alarm configuration.
      this.pending = []
      this.save()
    },
    async refresh() {
      if (busy || !controller || controller.signal.aborted) return
      busy = true
      const version = generation, signal = controller.signal
      try {
        const samples = await telemetryApi.getLatest({ signal })
        if (signal.aborted || version !== generation) return
        if (!Array.isArray(samples)) throw new Error('实时接口返回格式不正确')
        this.ingest(samples)
        this.updatedAt = new Date().toISOString()
        this.error = ''
      } catch (error) { if (!signal.aborted && version === generation) this.error = error.message || 'DI 实时信号获取失败' }
      finally { if (version === generation) busy = false }
    },
    async loadMetadata(signal, version) {
      await Promise.all(digitalModules.map(async moduleId => {
        try {
          const data = await telemetryApi.getModulePoints(moduleId, { signal })
          if (signal.aborted || version !== generation) return
          for (const point of data.points || []) if (isDigitalSignal(point)) this.metadata[pointKey(point)] = point
        } catch { /* Signals are still recorded by their complete tuple if metadata is unavailable. */ }
      }))
      if (signal.aborted || version !== generation) return
      for (const row of this.events) row.pointId = this.metadata[pointKey(row)]?.pointId ?? row.pointId
      this.save()
    },
    start(userId = 'default') {
      this.stop()
      this.$reset()
      this.storageKey = `equipment_dashboard_di_alarms_v1:${encodeURIComponent(String(userId))}`
      try {
        const cached = JSON.parse(localStorage.getItem(this.storageKey) || 'null')
        if (cached?.version === 1 && Array.isArray(cached.events) && cached.states && typeof cached.states === 'object') {
          this.events = cached.events.filter(row => isDigitalSignal(row) && Number.isFinite(Date.parse(row.startedAt)))
          this.states = cached.states
        }
      } catch { this.cacheError = 'DI 告警缓存读取失败' }
      controller = new AbortController()
      const version = generation
      this.loadMetadata(controller.signal, version)
      this.refresh()
      timer = setInterval(() => this.refresh(), 2000)
    },
    dismiss() {
      const pending = new Set(this.pending)
      for (const row of this.events) if (pending.has(row.alarmId)) row.acknowledgedAt = new Date().toISOString()
      this.pending = []
      this.save()
    },
    stop() {
      generation++
      controller?.abort()
      clearInterval(timer)
      busy = false
      this.pending = []
    },
  },
})
