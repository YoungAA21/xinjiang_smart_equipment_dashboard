import { defineStore } from 'pinia'
import { healthApi } from '../services/health.js'
import { telemetryApi } from '../services/telemetry.js'
import { alarmApi } from '../services/alarms.js'
import { analysisApi } from '../services/analysis.js'
import { appendSamples } from '../charts/telemetry.js'

export const collectionModules = (rows = []) => rows.filter((row) => String(row.protocol || '').toLowerCase().includes('modbus'))
export const collectionRows = (rows = [], modules = []) => {
  const ids = new Set(modules.map((module) => String(module.moduleId)))
  return rows.filter((row) => ids.has(String(row.moduleId)))
}
export function collectionDetail(value, modules) {
  if (Array.isArray(value)) return value.filter((row) => {
    if (!row || typeof row !== 'object') return true
    if (/acoustic|sound|voice/i.test(`${row.protocol || ''} ${row.name || ''}`)) return false
    return row.moduleId == null || modules.some((module) => String(module.moduleId) === String(row.moduleId))
  }).map((row) => collectionDetail(row, modules))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/acoustic|sound|voice/i.test(key)).map(([key, item]) => [key, collectionDetail(item, modules)]))
}
const array = (body, key) => {
  const rows = Array.isArray(body) ? body : body?.[key]
  if (!Array.isArray(rows)) throw new Error('接口数据格式不正确')
  return rows
}

export const useDataScreenStore = defineStore('dataScreen', {
  state: () => ({ data: {}, errors: {}, times: {}, loading: {}, buffers: {}, generation: 0, selectionVersion: 0 }),
  actions: {
    async read(key, request, signal, transform = (value) => value) {
      if (signal?.aborted || this.loading[key]) return
      const generation = this.generation
      this.loading[key] = true
      try {
        const value = transform(await request({ signal }))
        if (signal?.aborted || generation !== this.generation) return
        this.data[key] = value
        this.times[key] = new Date().toISOString()
        delete this.errors[key]
      } catch (error) {
        if (!signal?.aborted && generation === this.generation) this.errors[key] = error.message || '请求失败'
      } finally {
        if (generation === this.generation) this.loading[key] = false
      }
    },
    async refreshOverview(signal) {
      await this.read('modules', telemetryApi.getModules, signal, (body) => collectionModules(array(body, 'modules')))
      if (signal?.aborted) return
      const modules = this.data.modules || []
      await Promise.all([
        this.read('heartbeat', healthApi.getHealth, signal),
        this.read('health', healthApi.getHealthDetail, signal, (body) => collectionDetail(body, modules)),
        this.read('maintenance', healthApi.getTableMaintenance, signal, (body) => collectionDetail(body, modules)),
        this.read('worker', alarmApi.getStatus, signal, (body) => collectionDetail(body, modules)),
        this.read('alarms', (options) => alarmApi.getAlarms({ limit: 1000 }, options), signal, (body) => collectionRows(array(body, 'events'), modules)),
        this.read('trendAlarms', (options) => analysisApi.getTrendAlarms({ limit: 1000 }, options), signal, (body) => collectionRows(array(body, 'events'), modules)),
      ])
      // Limit metadata concurrency for installations with many modules.
      let index = 0
      await Promise.all(Array.from({ length: Math.min(4, modules.length) }, async () => {
        while (index < modules.length && !signal?.aborted) {
          const module = modules[index++]
          await this.read(`points:${module.moduleId}`, (options) => telemetryApi.getModulePoints(module.moduleId, options), signal, (body) => array(body, 'points').map((point) => ({ ...point, moduleId: module.moduleId })))
        }
      }))
    },
    async refreshLatest(signal) {
      await this.read('latest', telemetryApi.getLatest, signal, (body) => collectionRows(array(body), this.data.modules || []))
      if (!signal?.aborted && !this.errors.latest) this.buffers = appendSamples(this.buffers, this.data.latest || [])
    },
    async loadPoint(point, signal) {
      const version = ++this.selectionVersion
      for (const key of ['history', 'days', 'insight']) { delete this.data[key]; delete this.errors[key]; delete this.times[key] }
      if (!point?.pointId) return
      const end = new Date().toISOString()
      const query = { pointId: point.pointId, start: new Date(Date.now() - 30 * 86400000).toISOString(), end, bucketMinutes: 5 }
      await Promise.all([
        ['history', (options) => telemetryApi.getHistory({ pointId: point.pointId, start: new Date(Date.now() - 600000).toISOString(), end, limit: 5000 }, options), (body) => array(body, 'points')],
        ['days', (options) => analysisApi.getDailyLimitTrends({ ...query, limit: 366 }, options), (body) => array(body, 'days')],
        ['insight', (options) => analysisApi.getTrendInsights({ ...query, limit: 100000 }, options), (body) => body.insight],
      ].map(async ([key, request, transform]) => {
        try {
          const body = transform(await request({ signal }))
          if (signal?.aborted || version !== this.selectionVersion) return
          this.data[key] = body
          this.times[key] = new Date().toISOString()
        } catch (error) {
          if (!signal?.aborted && version === this.selectionVersion) this.errors[key] = error.message || '请求失败'
        }
      }))
    },
    clear() {
      const generation = this.generation + 1
      const selectionVersion = this.selectionVersion + 1
      this.$reset()
      Object.assign(this, { generation, selectionVersion })
    },
  },
})
