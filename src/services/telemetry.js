import { resolveProxiedServiceBase } from './endpoints.js'

// This migration is scoped to monitoring and history. It never uses the 18080 token.
const BASE = resolveProxiedServiceBase(import.meta.env?.VITE_API_BASE_URL, '/_telemetry-api')

async function get(path, params = {}, { signal } = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))
  const response = await fetch(`${BASE}${path}${query.size ? `?${query}` : ''}`, {
    headers: { Accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`采集接口请求失败（HTTP ${response.status}）`)
  return response.json()
}

async function getModulePoints(moduleId, options = {}) {
  const path = `/api/configuration/modules/${encodeURIComponent(moduleId)}/points`
  try {
    return await get(path, { includeLatest: false }, options)
  } catch (error) {
    // Retry transient connection failures once; navigation and HTTP errors must not retry.
    if (options.signal?.aborted || !['TimeoutError', 'TypeError'].includes(error.name)) throw error
    return get(path, { includeLatest: false }, options)
  }
}

export function validateHistoryQuery({ pointId, start, end, limit = 5000 }) {
  if (!Number.isSafeInteger(Number(pointId)) || Number(pointId) <= 0) throw new Error('请选择有效 pointId')
  if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) throw new Error('请选择有效的起止时间')
  if (Date.parse(start) >= Date.parse(end)) throw new Error('结束时间必须晚于开始时间')
  if (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100000) throw new Error('查询上限必须为 1–100000 的整数')
  return { pointId: Number(pointId), start, end, limit: Number(limit) }
}

export const telemetryApi = {
  getModules: (options) => get('/api/configuration/modules', {}, options),
  getModulePoints,
  getLatest: (options) => get('/api/realtime/latest', {}, options),
  getHistory: (query, options) => get('/api/telemetry/history', validateHistoryQuery(query), options),
}
