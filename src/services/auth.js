import { isDemoMode } from './dataMode.js'
const prefix = isDemoMode ? 'equipment_demo_' : 'equipment_dashboard_'
const TOKEN_KEY = `${prefix}token`
const USER_KEY = `${prefix}user`

export const auth = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY) || ''
  },
  setSession(token, userInfo = null) {
    localStorage.setItem(TOKEN_KEY, token)
    if (userInfo) localStorage.setItem(USER_KEY, JSON.stringify(userInfo))
  },
  getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
    } catch {
      return null
    }
  },
  clearSession() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  },
  isAuthenticated() {
    return Boolean(localStorage.getItem(TOKEN_KEY))
  },
}
