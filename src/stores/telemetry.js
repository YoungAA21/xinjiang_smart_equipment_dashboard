import { defineStore } from 'pinia'
import { telemetryApi } from '../services/telemetry.js'
import { appendSamples, pointKey, localInputTime } from '../charts/telemetry.js'

const message = (error) => error.name === 'TimeoutError' ? '请求超时（10 秒）' : error.message || '请求失败'
export const useTelemetryStore = defineStore('telemetryMonitor', {
  state: () => ({ modules: null, moduleTime: null, latest: [], latestTime: null, buffers: {}, points: [], pointModuleId: '', history: null, errors: {}, loadingModules: false, loadingLatest: false, loadingPoints: false, loadingHistory: false, pointVersion: 0, historyVersion: 0, generation: 0 }),
  actions: {
    async seedRecentPoints(point, { signal } = {}) {
      const generation = this.generation
      const end = new Date()
      const result = await telemetryApi.getHistory({ pointId: point.pointId, start: localInputTime(new Date(end.getTime() - 600000)), end: localInputTime(end), limit: 10000 }, { signal })
      if (signal?.aborted || generation !== this.generation) return
      if (!Array.isArray(result?.points) || (result.pointId != null && Number(result.pointId) !== Number(point.pointId))) throw new Error('历史点位返回格式不正确')
      const key = pointKey(point)
      const byTime = new Map()
      for (const sample of result.points) {
        if (sample.moduleId != null && pointKey(sample) !== key) continue
        if (!Number.isFinite(Date.parse(sample.collectedAt))) continue
        byTime.set(Date.parse(sample.collectedAt), { ...sample, moduleId: point.moduleId, channelId: point.channelId, pointCode: point.pointCode, unit: point.unit })
      }
      // Live samples received during the history request take precedence.
      for (const sample of this.buffers[key] || []) byTime.set(Date.parse(sample.collectedAt), sample)
      this.buffers = { ...this.buffers, [key]: [...byTime.values()].sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt)).slice(-300) }
    },
    async refreshModules({ signal } = {}) {
      if (this.loadingModules || signal?.aborted) return
      const generation = this.generation
      this.loadingModules = true
      try {
        const value = await telemetryApi.getModules({ signal })
        if (signal?.aborted || generation !== this.generation) return
        if (!Array.isArray(value?.modules)) throw new Error('模块接口返回格式不正确')
        this.modules = value.modules
        this.moduleTime = value.generatedAt || new Date().toISOString()
        delete this.errors.modules
      } catch (error) { if (!signal?.aborted && generation === this.generation) this.errors.modules = message(error) }
      finally { if (generation === this.generation) this.loadingModules = false }
    },
    async refreshLatest({ signal } = {}) {
      if (this.loadingLatest || signal?.aborted) return
      const generation = this.generation
      this.loadingLatest = true
      try {
        const samples = await telemetryApi.getLatest({ signal })
        if (signal?.aborted || generation !== this.generation) return
        if (!Array.isArray(samples)) throw new Error('实时接口返回格式不正确')
        this.latest = samples
        // A temporarily absent latest point must not erase its loaded history.
        this.buffers = { ...this.buffers, ...appendSamples(this.buffers, samples) }
        this.latestTime = new Date().toISOString()
        delete this.errors.latest
      } catch (error) { if (!signal?.aborted && generation === this.generation) this.errors.latest = message(error) }
      finally { if (generation === this.generation) this.loadingLatest = false }
    },
    async loadPoints(moduleId, { signal } = {}) {
      const version = ++this.pointVersion
      this.points = []
      this.pointModuleId = moduleId
      this.loadingPoints = true
      delete this.errors.points
      try {
        const result = await telemetryApi.getModulePoints(moduleId, { signal })
        if (signal?.aborted || version !== this.pointVersion) return
        if (!Array.isArray(result?.points) || result.moduleId !== moduleId) throw new Error('点位接口返回格式不正确')
        this.points = result.points
      } catch (error) { if (!signal?.aborted && version === this.pointVersion) this.errors.points = message(error) }
      finally { if (version === this.pointVersion) this.loadingPoints = false }
    },
    clearHistory() {
      this.historyVersion += 1
      this.history = null
      this.loadingHistory = false
      delete this.errors.history
    },
    async loadHistory(query, { signal } = {}) {
      const version = ++this.historyVersion
      this.history = null
      this.loadingHistory = true
      delete this.errors.history
      try {
        const result = await telemetryApi.getHistory(query, { signal })
        if (signal?.aborted || version !== this.historyVersion) return
        if (!Array.isArray(result?.points)) throw new Error('历史接口返回格式不正确')
        this.history = { ...result, requested: { ...query } }
      } catch (error) { if (!signal?.aborted && version === this.historyVersion) this.errors.history = message(error) }
      finally { if (version === this.historyVersion) this.loadingHistory = false }
    },
    clear() {
      const versions = { generation: this.generation + 1, pointVersion: this.pointVersion + 1, historyVersion: this.historyVersion + 1 }
      this.$reset()
      Object.assign(this, versions)
    },
  },
})
