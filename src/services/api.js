import { auth } from './auth'
import { healthApi } from './health'

const LEGACY_API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const NEW_API_BASE = import.meta.env.VITE_NEW_API_BASE_URL || 'http://192.168.31.158:18080'
const LEGACY_API_DISABLED = import.meta.env.VITE_LEGACY_API_DISABLED !== 'false'

const toQuery = (params = {}) => {
  const search = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value)
    }
  })

  const query = search.toString()
  return query ? `?${query}` : ''
}

const authHeaderValue = (token) => {
  if (!token) return ''
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`
}

async function request(path, params, options = {}) {
  const headers = { ...(options.headers || {}) }
  const token = auth.getToken()
  const baseUrl = options.baseUrl ?? LEGACY_API_BASE

  if (LEGACY_API_DISABLED && baseUrl === LEGACY_API_BASE && path.startsWith('/api/')) {
    throw new Error('原接口请求已停止')
  }

  if (token && !options.skipAuth) {
    headers.Authorization = authHeaderValue(token)
  }

  if (!headers.accept && !headers.Accept) {
    headers.accept = 'application/json'
  }

  const response = await fetch(`${baseUrl}${path}${toQuery(params)}`, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok && !options.allowErrorBody) {
    const message = typeof body === 'object' ? body.message || body.detail || JSON.stringify(body) : body
    throw new Error(message || `API request failed: ${response.status}`)
  }

  return body
}

const unwrapApiResponse = (body) => {
  if (!body || typeof body !== 'object' || !('code' in body)) return body
  if (body.code !== 200 || body.success === false) {
    throw new Error(body.message || `API business error: ${body.code}`)
  }
  return body.data
}

const newApiRequest = async (path, params, options = {}) => {
  const body = await request(path, params, {
    ...options,
    baseUrl: NEW_API_BASE,
  })
  return unwrapApiResponse(body)
}

const tokenQueryValue = () => auth.getToken().replace(/^Bearer\s+/i, '')

const newApiUrl = (path, params = {}) => {
  const url = new URL(path, NEW_API_BASE)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
  })
  return url.toString()
}

const normalizeLoginResponse = (body) => {
  if (typeof body === 'string') return { token: body, userInfo: null }

  const data = body?.data || body
  const token = data?.token || data?.access_token || data?.accessToken
  const userInfo = data?.userInfo || data?.user || null

  if (!token) throw new Error(body?.message || '登录响应中未返回令牌')
  return { token, userInfo }
}

export const api = {
  login: async ({ username, password }) => {
    const form = new URLSearchParams()
    form.set('username', username)
    form.set('password', password)

    const body = await request('/auth/login', undefined, {
      method: 'POST',
      baseUrl: NEW_API_BASE,
      skipAuth: true,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    })

    return normalizeLoginResponse(body)
  },
  getHealth: healthApi.getHealth,
  getHealthDetail: healthApi.getHealthDetail,
  getTableMaintenance: healthApi.getTableMaintenance,
  getModules: () => request('/api/configuration/modules'),
  getEnabledModules: (recentCount = 60) => request('/api/configuration/enabled-modules', { recentCount }),
  getModulePoints: (moduleId, includeLatest = true) =>
    request(`/api/configuration/modules/${encodeURIComponent(moduleId)}/points`, { includeLatest }),
  getLatest: () => request('/api/realtime/latest'),
  getLatestPoint: ({ moduleId, channelId, pointCode }) =>
    request(`/api/realtime/latest/${encodeURIComponent(moduleId)}/${encodeURIComponent(channelId)}/${encodeURIComponent(pointCode)}`),
  getRecent: ({ moduleId, channelId, pointCode, count = 300 }) =>
    request('/api/realtime/recent', { moduleId, channelId, pointCode, count }),
  getPipeline: () => request('/api/realtime/pipeline'),
  getAlarms: (params = {}) => request('/api/analysis/alarms', params),
  getSpectrum: (params) => request('/api/acoustic/spectrum', params),
  getWaveform: (params) => request('/api/acoustic/realtime-waveform', params),
  getAlarmSegments: (params = {}) => request('/api/acoustic/alarm-segments', params),
  getMonitorDevices: (options = {}) => newApiRequest('/monitor/devices', undefined, { signal: options.signal }),
  createMonitorSession: (payload) => newApiRequest('/monitor/sessions', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  closeMonitorSession: (sessionId) => newApiRequest(`/monitor/sessions/${encodeURIComponent(sessionId)}`, undefined, {
    method: 'DELETE',
  }),
  getNewApiBaseUrl: () => NEW_API_BASE,
  getExternalAlarmPage: (payload) => newApiRequest('/alarm/page', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  getExternalAlarmAudioFiles: (payload) => newApiRequest('/alarm/audioFiles', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  getExternalAlarmAudioFileSampleTypes: (fileId) =>
    newApiRequest(`/alarm/audioFileSampleTypes/${encodeURIComponent(fileId)}`),
  getExternalAlarmChartByDay: (day) => newApiRequest('/alarm/chatByDay', { day }),
  getCollectorStatuses: () => newApiRequest('/collectorManagement/status'),
  getCollectorStatus: (collectorId) =>
    newApiRequest(`/collectorManagement/${encodeURIComponent(collectorId)}/status`),
  getCollectorStatusHistory: (params = {}) => newApiRequest('/collectorManagement/status-history', params),
  getCollectorStatusEvents: (params = {}) => newApiRequest('/collectorManagement/status-events', params),
  getRecordings: (params = {}) => newApiRequest('/recordings', params),
  getRecording: (recordingId) => newApiRequest(`/recordings/${encodeURIComponent(recordingId)}`),
  getRecordingVisualization: (recordingId, params = {}) =>
    newApiRequest(`/recordings/${encodeURIComponent(recordingId)}/visualization`, params),
  getRecordingContentUrl: (recordingId, { download = false } = {}) =>
    newApiUrl(`/recordings/${encodeURIComponent(recordingId)}/content`, {
      token: tokenQueryValue(),
      download: download ? 'true' : '',
    }),
}
