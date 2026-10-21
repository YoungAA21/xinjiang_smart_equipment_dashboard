const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '')

export function resolveProxiedServiceBase(configuredUrl, proxyBase) {
  return normalizeBaseUrl(configuredUrl) || proxyBase
}

export function resolveServiceBase(configuredUrl) {
  const configured = normalizeBaseUrl(configuredUrl)
  if (configured) return configured

  return /^https?:\/\//.test(globalThis.location?.origin || '') ? globalThis.location.origin : ''
}
