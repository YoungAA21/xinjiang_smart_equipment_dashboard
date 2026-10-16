import { reactive } from 'vue'
import { telemetryApi, configureHistoryReader } from './telemetry.js'
import { resolveProxiedServiceBase } from './endpoints.js'
import { createShiftHistoryCache } from './shiftHistoryCache.js'
import { createHistoryCacheStorage } from './historyCacheStorage.js'
import { shiftRange } from '../charts/shiftRange.js'
import { parameterKey } from '../charts/pointConfiguration.js'
import { pointConfiguration } from '../stores/pointConfiguration.js'

export const historyCacheStatus = reactive({ running: false, completed: 0, total: 0, shift: '', errors: [], warning: '', updatedAt: null })
let controller, timer, cache, cycling = false, version = 0

async function cycle() {
  if (cycling || !controller || controller.signal.aborted) return
  cycling = true
  const currentVersion = version, signal = controller.signal
  const range = shiftRange()
  Object.assign(historyCacheStatus, { running: true, completed: 0, total: 0, shift: `${range.start.replace('T', ' ')} → ${range.end.replace('T', ' ')}`, errors: [] })
  try {
    await cache.prune()
    const configured = new Set(Object.keys(pointConfiguration.parameters))
    const modules = [...new Set([...configured].map(key => JSON.parse(key)).filter(identity => identity[0] === 'legacy').map(identity => identity[1]))]
    const points = []
    for (const moduleId of modules) {
      if (signal.aborted) return
      try {
        const result = await telemetryApi.getModulePoints(moduleId, { signal })
        if (!Array.isArray(result?.points) || result.moduleId !== moduleId) throw new Error('点位配置格式不正确')
        points.push(...result.points.map(point => ({ ...point, moduleId })).filter(point => configured.has(parameterKey(point))
          && !['DigitalInput', 'AlarmStatus', 'SelfTestResult'].includes(point.metricType)
          && Number.isSafeInteger(Number(point.pointId)) && Number(point.pointId) > 0))
      } catch (error) { if (!signal.aborted) historyCacheStatus.errors.push(`${moduleId}：${error.message}`) }
    }
    if (signal.aborted) return
    historyCacheStatus.total = points.length
    // One point at a time; foreground reads can use the cache's second network slot.
    for (const point of points) {
      if (signal.aborted) return
      if (shiftRange().start !== range.start) return
      try {
        await cache.read({ pointId: point.pointId, start: range.start, end: range.end, limit: 100000 }, { signal, background: true, warmOnly: true })
        if (signal.aborted) return
        historyCacheStatus.completed++
      } catch (error) { if (!signal.aborted) historyCacheStatus.errors.push(`${point.moduleId}/${point.pointCode}：${error.message}`) }
    }
    if (!signal.aborted) historyCacheStatus.updatedAt = new Date().toISOString()
  } finally {
    if (currentVersion === version) {
      cycling = false
      historyCacheStatus.running = false
      if (!signal.aborted) timer = setTimeout(cycle, 60000)
    }
  }
}

export const historyWarmup = {
  start(account) {
    this.stop()
    controller = new AbortController()
    const signal = controller.signal
    Object.assign(historyCacheStatus, { running: false, completed: 0, total: 0, errors: [], warning: '', updatedAt: null })
    configureHistoryReader(load => {
      cache = createShiftHistoryCache({ load, signal, storage: createHistoryCacheStorage(),
        scope: JSON.stringify([resolveProxiedServiceBase(import.meta.env?.VITE_API_BASE_URL, '/_telemetry-api'), String(account)]),
        onWarning: warning => { if (!signal.aborted) historyCacheStatus.warning = warning },
      })
      return (query, options) => cache.read(query, options)
    })
    timer = setTimeout(cycle, 1000)
  },
  retry() { clearTimeout(timer); return cycle() },
  stop() {
    version++
    controller?.abort()
    clearTimeout(timer)
    cycling = false
    historyCacheStatus.running = false
    configureHistoryReader(null)
  },
}
