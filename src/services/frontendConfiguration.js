import { resolveProxiedServiceBase } from './endpoints.js'

export const configurationFileName = '监测参数配置.json'
const base = resolveProxiedServiceBase(import.meta.env?.VITE_API_BASE_URL, '/_configuration-api')
const fileUrl = `${base}/api/frontend-files/${encodeURIComponent(configurationFileName)}`

async function request(method, { signal, configuration } = {}) {
  const response = await fetch(fileUrl, {
    method,
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(method === 'PUT' ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
    ...(method === 'PUT' ? { body: JSON.stringify(configuration) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`配置${method === 'GET' ? '读取' : '上传'}失败（HTTP ${response.status}）`)
  return response
}

export const frontendConfigurationApi = {
  async read(options) {
    const response = await request('GET', options)
    if (response.status === 204) return null
    return JSON.parse((await response.text()).replace(/^\uFEFF/, ''))
  },
  async upload(configuration, options = {}) {
    await request('PUT', { ...options, configuration })
  },
}
