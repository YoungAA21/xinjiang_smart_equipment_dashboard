import { telemetryApi } from './telemetry.js'
import { alarmApi } from './alarms.js'
import { analysisApi } from './analysis.js'
import { eligibleReportPoint, cleanReportSamples, reportEvents, summarizeReportSamples, reportChange } from '../charts/reportAnalysis.js'

const abort = signal => signal?.throwIfAborted()

// One bounded queue for report work; no polling or background report generation.
export async function reportPool(items, run, { signal, concurrency = 4, onProgress = () => {} } = {}) {
  const results = new Array(items.length)
  let cursor = 0, completed = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      abort(signal)
      const index = cursor++
      try { results[index] = { status: 'fulfilled', value: await run(items[index], index) } }
      catch (reason) { abort(signal); results[index] = { status: 'rejected', reason } }
      abort(signal)
      onProgress(++completed, items.length)
    }
  }))
  abort(signal)
  return results
}

export async function loadReportCatalog({ signal, api = telemetryApi } = {}) {
  const result = await api.getModules({ signal })
  abort(signal)
  if (!Array.isArray(result?.modules)) throw new Error('模块目录返回格式不正确')
  const errors = []
  const results = await reportPool(result.modules, async module => {
    if (/acoustic|audio|sound/i.test(module.protocol || '')) return []
    const data = await api.getModulePoints(module.moduleId, { signal })
    if (!Array.isArray(data?.points) || String(data.moduleId) !== String(module.moduleId)) throw new Error('参数目录身份或格式不正确')
    return data.points.map(point => ({ ...point, moduleId: module.moduleId, moduleName: module.moduleName || module.moduleId })).filter(eligibleReportPoint)
  }, { signal })
  results.forEach((row, i) => { if (row.status === 'rejected') errors.push(`${result.modules[i].moduleId}：${row.reason.message}`) })
  return { modules: result.modules.filter(module => !/acoustic|audio|sound/i.test(module.protocol || '')), points: results.flatMap(row => row.status === 'fulfilled' ? row.value : []), errors }
}

export async function generateEquipmentReport({ points, ranges, signal, onProgress, telemetry = telemetryApi, alarms = alarmApi, analysis = analysisApi }) {
  points = points.filter(eligibleReportPoint)
  if (!points.length) throw new Error('当前范围没有可汇总的振动、温度或负压 / 压力测点')
  const jobs = []
  for (const point of points) for (const period of ['current', 'baseline']) jobs.push({ kind: 'history', point, period })
  for (const kind of ['hard', 'trend']) for (const period of ['current', 'baseline']) jobs.push({ kind, period })
  const results = await reportPool(jobs, async job => {
    const range = ranges[job.period]
    if (job.kind === 'history') {
      const result = await telemetry.getHistory({ pointId: job.point.pointId, start: range.start, end: range.end, limit: 100000 }, { signal })
      if (!Array.isArray(result?.points) || (result.pointId != null && String(result.pointId) !== String(job.point.pointId))) throw new Error('历史点位返回格式不正确')
      const clean = cleanReportSamples(result.points, job.point, range)
      const truncated = result.truncated === true || result.points.length >= 100000
      return { clean, summary: summarizeReportSamples(clean, job.point, range, truncated) }
    }
    const result = await (job.kind === 'hard' ? alarms.getAlarms : analysis.getTrendAlarms)({ start: range.start, end: range.end, limit: 1000 }, { signal })
    const events = Array.isArray(result) ? result : result?.events
    if (!Array.isArray(events)) throw new Error('告警列表返回格式不正确')
    return { ...reportEvents(events, points, range), truncated: result?.truncated === true || events.length >= 1000 }
  }, { signal, onProgress })
  abort(signal)
  const rows = points.map(point => ({ point, kind: 'analog', errors: [] }))
  const sources = { hard: {}, trend: {} }
  results.forEach((result, i) => {
    const job = jobs[i]
    if (job.kind === 'history') {
      const row = rows.find(row => row.point === job.point)
      if (result.status === 'rejected') { row.errors.push(`${job.period === 'current' ? '本期' : '对比期'}：${result.reason.message}`); return }
      if (job.period === 'current') Object.assign(row, { clean: result.value.clean, current: result.value.summary })
      else Object.assign(row, { baseClean: result.value.clean, baseline: result.value.summary })
    } else {
      sources[job.kind][job.period] = result.status === 'fulfilled' ? result.value : { error: result.reason.message, events: null }
    }
  })
  for (const row of rows) {
    const comparable = row.kind === 'analog' && row.current?.count > 0 && row.baseline?.count > 0 && !row.current.truncated && !row.baseline.truncated
      && row.current.coverage >= 0.6 && row.baseline.coverage >= 0.6
    row.change = reportChange(comparable ? row.current.mean : null, comparable ? row.baseline.mean : null)
    row.attention = row.errors.length > 0 || !row.current?.count || row.current.truncated || row.current.coverage < 0.6
      || (row.current.overCount || 0) > 0 || (row.change.percent !== null && Math.abs(row.change.percent) >= 10)
    row.priority = (row.current?.overCount ? 100 : 0) + (row.attention ? 10 : 0) + Math.min(Math.abs(row.change.percent || 0), 50)
  }
  rows.sort((a, b) => b.priority - a.priority)
  return { rows, sources, ranges, generatedAt: new Date().toISOString() }
}

