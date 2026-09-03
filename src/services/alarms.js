import { resolveServiceBase } from './endpoints.js'

// Dedicated read-only 5158 transport. Never attach the 18080 authentication token.
const BASE = import.meta.env?.DEV ? '/_alarm-api' : resolveServiceBase(import.meta.env?.VITE_API_BASE_URL, 5158)
const present = (value) => value !== undefined && value !== null && value !== ''

export function validateAlarmQuery(query = {}) {
  const result = {}
  if (present(query.pointId)) {
    if (!Number.isSafeInteger(Number(query.pointId)) || Number(query.pointId) <= 0) throw new Error('请选择有效的 pointId')
    result.pointId = Number(query.pointId)
  }
  if (present(query.isActive)) {
    if (![true, false, 'true', 'false'].includes(query.isActive)) throw new Error('告警状态无效')
    result.isActive = query.isActive === true || query.isActive === 'true'
  }
  for (const key of ['start', 'end']) {
    if (present(query[key])) {
      if (!Number.isFinite(Date.parse(query[key]))) throw new Error('请选择有效的查询时间')
      result[key] = query[key]
    }
  }
  if (result.start && result.end && Date.parse(result.start) >= Date.parse(result.end)) throw new Error('结束时间必须晚于开始时间')
  result.limit = Number(query.limit ?? 200)
  if (!Number.isInteger(result.limit) || result.limit < 1 || result.limit > 1000) throw new Error('告警查询上限必须为 1–1000 的整数')
  return result
}

async function get(path, query, { signal } = {}) {
  const search = new URLSearchParams(query)
  const response = await fetch(`${BASE}${path}${search.size ? `?${search}` : ''}`, {
    headers: { Accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`采集报警接口请求失败（HTTP ${response.status}）`)
  return response.json()
}

export const alarmApi = {
  getAlarms: (query, options) => get('/api/analysis/alarms', validateAlarmQuery(query), options),
  getStatus: (options) => get('/api/analysis/status', {}, options),
}
