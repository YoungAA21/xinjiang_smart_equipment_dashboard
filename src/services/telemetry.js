import { resolveProxiedServiceBase } from './endpoints.js'

// This migration is scoped to monitoring and history. It never uses the 18080 token.
const BASE = resolveProxiedServiceBase(import.meta.env?.VITE_API_BASE_URL, '/_telemetry-api')
let historyReader

// Installed by the application lifecycle; the transport stays usable on its own.
export function configureHistoryReader(createReader) {
  historyReader = createReader?.((query, options) => get('/api/telemetry/history', query, options))
}

async function get(path, params = {}, { signal } = {}) {
  const history = path.startsWith('/api/telemetry/history')
  const timeout = AbortSignal.timeout(history ? 120000 : 10000)
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))
  try {
    const response = await fetch(`${BASE}${path}${query.size ? `?${query}` : ''}`, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok) throw new Error(`采集接口请求失败（HTTP ${response.status}）`)
    try { return await response.json() }
    catch (error) {
      if (error.name === 'SyntaxError') throw new Error('采集接口未返回有效 JSON，请检查后端响应与代理配置', { cause: error })
      throw error
    }
  } catch (error) {
    if (history && error.name === 'TimeoutError') throw new Error('历史查询超时（120 秒），请缩短时间范围后重试', { cause: error })
    throw error
  }
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
  async updatePointLimits(pointId, limits, { signal } = {}) {
    if (!Number.isSafeInteger(Number(pointId)) || Number(pointId) <= 0) throw new Error('请选择有效测点')
    const parse = (value) => {
      if (value === '' || value == null) return null
      const result = Number(value)
      if (!Number.isFinite(result)) throw new Error('上下限必须为有效数字')
      return result
    }
    const body = { minimumValue: parse(limits.minimumValue), maximumValue: parse(limits.maximumValue) }
    if (body.minimumValue != null && body.maximumValue != null && body.minimumValue > body.maximumValue) throw new Error('下限不能大于上限')
    const response = await fetch(`${BASE}/api/configuration/points/${encodeURIComponent(pointId)}/limits`, {
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(result?.detail || result?.message || `上下限保存失败（HTTP ${response.status}）`)
    if (result?.saved !== true || Number(result.pointId) !== Number(pointId)) throw new Error('上下限保存结果不正确，请重新读取配置确认')
    return result
  },
  getModules: (options) => get('/api/configuration/modules', {}, options),
  getModulePoints,
  getLatest: (options) => get('/api/realtime/latest', {}, options),
  getStoredAggregate: (query, options) => {
    const validated = validateHistoryQuery(query)
    const bucketMinutes = Number(query.bucketMinutes ?? 5)
    if (!Number.isInteger(bucketMinutes) || bucketMinutes <= 0 || 1440 % bucketMinutes !== 0) throw new Error('聚合分钟数必须为 1440 的正整数因数')
    return get('/api/telemetry/history/aggregate-stored', { ...validated, bucketMinutes }, options)
  },
  getHistory: (query, options) => {
    const validated = validateHistoryQuery(query)
    return historyReader ? historyReader(validated, options) : get('/api/telemetry/history', validated, options)
  },
}
