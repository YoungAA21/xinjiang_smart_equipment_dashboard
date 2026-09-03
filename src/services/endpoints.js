const DEFAULT_BACKEND_HOST = '192.168.31.158'

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '')

export function resolveServiceBase(configuredUrl, port, { development = false, developmentUrl = '' } = {}) {
  const configured = normalizeBaseUrl(configuredUrl)
  if (configured) return configured

  const configuredDevelopment = normalizeBaseUrl(developmentUrl)
  if (development && configuredDevelopment) return configuredDevelopment
  if (development) return `http://${DEFAULT_BACKEND_HOST}:${port}`

  try {
    const pageUrl = new URL(globalThis.location?.origin)
    if (pageUrl.protocol === 'http:' || pageUrl.protocol === 'https:') {
      pageUrl.port = String(port)
      return pageUrl.origin
    }
  } catch {
    // Node-based tests and non-browser tooling have no page origin.
  }

  return `http://${DEFAULT_BACKEND_HOST}:${port}`
}
