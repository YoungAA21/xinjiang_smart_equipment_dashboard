import { resolveProxiedServiceBase } from './endpoints.js'

const BASE = resolveProxiedServiceBase(import.meta.env?.VITE_API_BASE_URL, '/_runtime-api')

export async function getRuntimeInfo({ signal } = {}) {
  const timeout = AbortSignal.timeout(10000)
  const response = await fetch(`${BASE}/api/runtime-info/latest`, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!response.ok) throw new Error(`运行信息请求失败（HTTP ${response.status}）`)
  const body = await response.json()
  if (!body || typeof body.status !== 'string' || !body.summary || typeof body.summary !== 'object' || Array.isArray(body.summary)) {
    throw new Error('运行信息返回格式不正确')
  }
  return body
}
