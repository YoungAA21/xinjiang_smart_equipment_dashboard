const TOKEN_KEY = 'equipment_dashboard_token'
const USER_KEY = 'equipment_dashboard_user'

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
