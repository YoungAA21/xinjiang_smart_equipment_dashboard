const DEFAULT_BACKEND_HOST = '66.66.66.4'

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '')

export function resolveProxiedServiceBase(configuredUrl, proxyBase) {
  return normalizeBaseUrl(configuredUrl) || proxyBase
}

export function resolveServiceBase(configuredUrl, port, { development = false, developmentUrl = '', sameOrigin = false } = {}) {
  const configured = normalizeBaseUrl(configuredUrl)
  if (configured) return configured

  if (sameOrigin && /^https?:\/\//.test(globalThis.location?.origin || '')) return globalThis.location.origin

  const configuredDevelopment = normalizeBaseUrl(developmentUrl)
  if (development && configuredDevelopment) return configuredDevelopment
  if (development) return `http://${DEFAULT_BACKEND_HOST}:${port}`

  return `http://${DEFAULT_BACKEND_HOST}:${port}`
}
