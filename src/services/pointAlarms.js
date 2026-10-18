import { telemetryApi } from './telemetry.js'
import { validateAlarmQuery } from './alarms.js'
import { alarmEventPoint } from '../charts/alarmPoints.js'

// Bound both metadata reads and per-point alarm queries to three concurrent requests.
async function pointPool(items, run, signal) {
  const results = new Array(items.length)
  let cursor = 0, failed = false
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (cursor < items.length && !failed) {
      signal?.throwIfAborted()
      const index = cursor++
      try { results[index] = await run(items[index]) }
      catch (error) { failed = true; throw error }
    }
  }))
  signal?.throwIfAborted()
  return results
}

export async function loadAlarmPointMetadata(moduleIds, { signal, api = telemetryApi } = {}) {
  const rows = await pointPool([...new Set(moduleIds)], async moduleId => {
    try {
      const result = await api.getModulePoints(moduleId, { signal })
      if (String(result?.moduleId) !== String(moduleId) || !Array.isArray(result?.points)) throw new Error('点位目录身份或格式不正确')
      return { moduleId, points: result.points }
    } catch (error) {
      signal?.throwIfAborted()
      return { moduleId, points: [], error: error.message || '点位目录读取失败' }
    }
  }, signal)
  return { metadata: Object.fromEntries(rows.map(row => [row.moduleId, row.points])),
    errors: rows.filter(row => row.error).map(row => `${row.moduleId}：${row.error}`) }
}

export async function queryPointAlarms(points, filters, { fetchEvents, signal } = {}) {
  const query = validateAlarmQuery(filters)
  if (!points.length) return { events: [], truncated: false, pointCount: 0 }
  const unavailable = points.filter(point => !Number.isSafeInteger(Number(point.pointId)) || Number(point.pointId) <= 0)
  if (unavailable.length) throw new Error(`${unavailable.map(point => point.name).join('、')} 未取得当前有效点位，请刷新点位或检查参数配置`)
  const rows = await pointPool(points, async point => {
    let result
    try { result = await fetchEvents({ ...query, pointId: Number(point.pointId) }, { signal }) }
    catch (error) { signal?.throwIfAborted(); throw new Error(`${point.name}：${error.message || '告警查询失败'}`, { cause: error }) }
    const events = Array.isArray(result) ? result : result?.events
    if (!Array.isArray(events) || events.some(event => !event || typeof event !== 'object')) throw new Error(`${point.name} 的告警响应格式不正确`)
    const mapped = events.map(event => alarmEventPoint(event, point))
    if (mapped.some(event => !event)) throw new Error(`${point.name} 的告警响应包含不匹配或无法识别的点位`)
    return { events: mapped, truncated: result?.truncated === true || events.length >= query.limit }
  }, signal)
  const unique = new Map()
  for (const event of rows.flatMap(row => row.events)) {
    const id = event.alarmId ?? event.trendAlarmId ?? event.eventId ?? event.id
    const key = JSON.stringify([event.configurationKey, id ?? [event.startedAt, event.endedAt, event.reason, event.alarmValue]])
    if (!unique.has(key)) unique.set(key, event)
  }
  const events = [...unique.values()].sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0))
  return { events: events.slice(0, query.limit), pointCount: points.length,
    truncated: rows.some(row => row.truncated) || events.length > query.limit }
}
