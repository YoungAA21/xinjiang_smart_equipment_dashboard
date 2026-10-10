const MODE_KEY = 'equipment_development_data_mode'

export function resolveDemoMode({ development = false, configured, saved } = {}) {
  // Published builds only use demo data when explicitly built in demo mode.
  if (!development) return configured === 'true'
  if (saved === 'demo' || saved === 'backend') return saved === 'demo'
  return configured !== 'false'
}

const environment = import.meta.env || {}
export const canSwitchDataMode = Boolean(environment.DEV) && environment.MODE !== 'demo'
export const isDemoMode = resolveDemoMode({
  development: canSwitchDataMode,
  configured: environment.VITE_DEMO_MODE,
  saved: canSwitchDataMode ? globalThis.localStorage?.getItem(MODE_KEY) : null,
})

export function setDemoMode(enabled) {
  if (!canSwitchDataMode) return
  localStorage.setItem(MODE_KEY, enabled ? 'demo' : 'backend')
  // A fresh page closes active streams and gives each mode its own login session.
  window.location.reload()
}
