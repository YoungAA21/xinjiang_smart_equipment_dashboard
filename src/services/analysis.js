import { resolveServiceBase } from './endpoints.js'

const BASE = import.meta.env?.DEV ? '/_analysis-api' : resolveServiceBase(import.meta.env?.VITE_API_BASE_URL, 5158)
const present = (value) => value !== undefined && value !== null && value !== ''

const pointIdValue = (value, required) => {
  if (!present(value)) {
    if (required) throw new Error('请选择有效 pointId')
    return undefined
  }
  const pointId = Number(value)
  if (!Number.isSafeInteger(pointId) || pointId <= 0) throw new Error('请选择有效 pointId')
  return pointId
}

const dateValue = (value, label) => {
  if (!present(value)) return undefined
  if (!Number.isFinite(Date.parse(value))) throw new Error(`请选择有效的${label}`)
  return value
}

export function validateAnalysisQuery(query = {}, options = {}) {
  const { pointRequired = true, timeRequired = false, includeStatus = false, includeBucket = false, defaultLimit = 200, maxLimit = 1000 } = options
  const result = {}
  const pointId = pointIdValue(query.pointId, pointRequired)
  if (pointId !== undefined) result.pointId = pointId

  if (includeStatus && present(query.isActive)) {
    if (![true, false, 'true', 'false'].includes(query.isActive)) throw new Error('报警状态无效')
    result.isActive = query.isActive === true || query.isActive === 'true'
  }

  const start = dateValue(query.start, '开始时间')
  const end = dateValue(query.end, '结束时间')
  if (timeRequired && (!start || !end)) throw new Error('请选择完整的开始和结束时间')
  if (start !== undefined) result.start = start
  if (end !== undefined) result.end = end
  if (start && end && Date.parse(start) >= Date.parse(end)) throw new Error('结束时间必须晚于开始时间')

  if (includeBucket && present(query.bucketMinutes)) {
    const bucketMinutes = Number(query.bucketMinutes)
    if (!Number.isInteger(bucketMinutes) || bucketMinutes <= 0 || 1440 % bucketMinutes !== 0) throw new Error('聚合分钟必须是 1440 的正整数因数')
    result.bucketMinutes = bucketMinutes
  }

  const limit = Number(query.limit ?? defaultLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) throw new Error(`查询上限必须为 1–${maxLimit} 的整数`)
  result.limit = limit
  return result
}

async function request(path, { query, method = 'GET', body, signal } = {}) {
  const search = new URLSearchParams(Object.entries(query || {}).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))
  const response = await fetch(`${BASE}${path}${search.size ? `?${search}` : ''}`, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  })
  const contentType = response.headers.get('content-type') || ''
  const result = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    const message = typeof result === 'object' ? result.message || result.detail || JSON.stringify(result) : result
    throw new Error(message || `分析接口请求失败（HTTP ${response.status}）`)
  }
  return result
}

export const analysisApi = {
  getDailyLimitTrends: (query, options = {}) => request('/api/analysis/daily-limit-trends', { query: validateAnalysisQuery(query, { timeRequired: true, includeBucket: true, defaultLimit: 366, maxLimit: 3660 }), signal: options.signal }),
  getTrendInsights: (query, options = {}) => request('/api/analysis/trend-insights', { query: validateAnalysisQuery(query, { timeRequired: true, includeBucket: true, defaultLimit: 100000, maxLimit: 100000 }), signal: options.signal }),
  getTrendAlarms: (query = {}, options = {}) => request('/api/analysis/trend-alarms', { query: validateAnalysisQuery(query, { pointRequired: false, includeStatus: true }), signal: options.signal }),
}
