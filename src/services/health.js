import { resolveProxiedServiceBase } from './endpoints.js'

// Only migrated health endpoints use this transport. Other legacy APIs stay disabled.
const HEALTH_API_BASE = resolveProxiedServiceBase(import.meta.env?.VITE_API_BASE_URL, '/_health-api')

async function requestHealth(path, { signal } = {}) {
  const response = await fetch(`${HEALTH_API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  })
  const isDetailFailure = path === '/api/health/detail' && response.status === 503
  if (!response.ok && !isDetailFailure) throw new Error(`健康接口请求失败（HTTP ${response.status}）`)
  const body = await response.json()
  // A 503 detail response is data, not a connection failure; show its failed checks.
  const valid = body && typeof body === 'object' && !Array.isArray(body) && (
    path === '/api/health/table-maintenance'
      ? body.options && body.runtimeStatus
      : typeof body.status === 'string'
  )
  if (!valid) throw new Error('健康接口返回格式不正确')
  return body
}

export const healthApi = {
  getHealth: (options) => requestHealth('/api/health', options),
  getHealthDetail: (options) => requestHealth('/api/health/detail', options),
  getTableMaintenance: (options) => requestHealth('/api/health/table-maintenance', options),
}
