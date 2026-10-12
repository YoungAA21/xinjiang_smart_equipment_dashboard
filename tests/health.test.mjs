import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test, afterEach } from 'node:test'
import vm from 'node:vm'
import { createPinia, setActivePinia } from 'pinia'
import { useHealthStore } from '../src/stores/health.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
const healthy = {
  status: 'Healthy', generatedAt: '2026-08-28T10:14:13+08:00',
  runtimeModules: { enabledModbusCount: 10, enabledAcousticCount: 0, statusCount: 10,
    statuses: Array.from({ length: 10 }, (_, i) => ({ moduleId: `M${i}`, isOnline: i < 8 })) },
  checks: [{ name: 'database.connection', status: 'Healthy', message: 'OK' }],
}
const heartbeat = { status: 'ok', service: 'WorkshopConditionMonitor' }
const maintenance = { options: { futurePartitionMonths: 3, dataRetentionMonths: 12, checkIntervalHours: 24 }, runtimeStatus: { lastResults: [] } }
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const sampleFetch = async (url) => reply(url.endsWith('/detail') ? healthy : url.endsWith('/table-maintenance') ? maintenance : heartbeat)

async function loadApi(fetch, env = {}, location) {
  const context = vm.createContext({ fetch, AbortSignal, URL, URLSearchParams, ...(location ? { location } : {}) })
  const makeModule = async (file) => new vm.SourceTextModule(await readFile(new URL(file, import.meta.url), 'utf8'), { context, initializeImportMeta(meta) { meta.env = env } })
  const endpoints = await makeModule('../src/services/endpoints.js')
  const health = await makeModule('../src/services/health.js')
  await endpoints.link(() => { throw new Error('Unexpected endpoint dependency') })
  await health.link((specifier) => specifier === './endpoints.js' ? endpoints : Promise.reject(new Error(`Unexpected health dependency: ${specifier}`)))
  const auth = new vm.SyntheticModule(['auth'], function () { this.setExport('auth', { getToken: () => 'test-token' }) }, { context })
  const api = await makeModule('../src/services/api.js')
  await api.link((specifier) => specifier === './auth' ? auth : specifier === './health' ? health : endpoints)
  await api.evaluate()
  return api.namespace.api
}

test('only three migrated health routes are enabled; no 18080 token is sent', async () => {
  const calls = []
  const api = await loadApi(async (url, options) => { calls.push({ url, options }); return sampleFetch(url) })
  await api.getHealth(); await api.getHealthDetail(); await api.getTableMaintenance()
  assert.deepEqual(calls.map((c) => c.url), [
    '/_health-api/api/health', '/_health-api/api/health/detail', '/_health-api/api/health/table-maintenance',
  ])
  for (const { options } of calls) {
    assert.equal(options.headers.Authorization, undefined)
    assert.ok(options.signal instanceof AbortSignal)
  }
  for (const call of [() => api.getModules(), () => api.getLatest(), () => api.getAlarms(), () => api.getPipeline()]) {
    await assert.rejects(call, /原接口请求已停止/)
  }
  assert.equal(calls.length, 3)
})

test('health base override is independent of the same-origin new service and trims trailing slash', async () => {
  const calls = []
  const api = await loadApi(async (url) => { calls.push(url); return reply(heartbeat) }, { VITE_API_BASE_URL: 'http://health.test:5158/' }, { origin: 'http://localhost:5175' })
  await api.getHealth()
  assert.equal(calls[0], 'http://health.test:5158/api/health')
  assert.equal(api.getNewApiBaseUrl(), 'http://localhost:5175')
})

test('development health and new service calls use scoped same-origin proxies', async () => {
  const calls = []
  const api = await loadApi(async (url) => { calls.push(url); return reply(heartbeat) }, { DEV: true }, { origin: 'http://localhost:5175' })
  await api.getHealth()
  assert.equal(calls[0], '/_health-api/api/health')
  assert.equal(api.getNewApiBaseUrl(), 'http://localhost:5175')
})

test('production uses same-origin proxies for both services', async () => {
  const calls = []
  const location = { origin: 'http://equipment.example:8080' }
  const api = await loadApi(async (url) => { calls.push(url); return reply(heartbeat) }, {}, location)
  await api.getHealth()
  assert.equal(calls[0], '/_health-api/api/health')
  assert.equal(api.getNewApiBaseUrl(), 'http://equipment.example:8080')
})

test('proxy allowlist excludes unmigrated legacy routes and all new API routes', async () => {
  const { default: config } = await import('../vite.config.js')
  const proxies = config({ mode: 'test' }).server.proxy
  const healthProxyKey = Object.keys(proxies).find((key) => key.startsWith('^/_health-api/'))
  const pattern = new RegExp(healthProxyKey)
  for (const path of ['/api/health', '/api/health/detail', '/api/health/table-maintenance']) {
    assert.equal(pattern.test(`/_health-api${path}`), true)
  }
  for (const path of ['/_health-api/api/configuration/modules', '/api/health', '/monitor/devices', '/auth/login', '/_health-api/api/health/other']) {
    assert.equal(pattern.test(path), false)
  }
  assert.equal(proxies[healthProxyKey].target, 'http://66.66.66.4:5158')
  assert.equal(proxies[healthProxyKey].rewrite('/_health-api/api/health/detail'), '/api/health/detail')
  const newApiProxyKey = Object.keys(proxies).find((key) => new RegExp(key).test('/auth/login'))
  assert.equal(proxies[newApiProxyKey].target, 'http://66.66.66.4:18080')
  assert.equal(proxies[newApiProxyKey].ws, true)
})

test('new API methods, auth, body, unwrapping and audio URLs remain unchanged', async () => {
  const calls = []
  const api = await loadApi(async (url, options) => { calls.push({ url, options }); return reply({ code: 200, data: { token: 'new-token', id: 1 } }) }, {}, { origin: 'http://localhost:5175' })
  assert.equal((await api.login({ username: 'user', password: 'password' })).token, 'new-token')
  assert.equal(calls[0].url, 'http://localhost:5175/auth/login')
  assert.equal(calls[0].options.headers.Authorization, undefined)
  assert.equal(calls[0].options.body.get('username'), 'user')
  const methods = [
    ['getMonitorDevices', [], '/monitor/devices', 'GET'],
    ['createMonitorSession', [{ channel: 1 }], '/monitor/sessions', 'POST'],
    ['closeMonitorSession', ['s1'], '/monitor/sessions/s1', 'DELETE'],
    ['getExternalAlarmPage', [{}], '/alarm/page', 'POST'],
    ['getExternalAlarmAudioFiles', [{}], '/alarm/audioFiles', 'POST'],
    ['getExternalAlarmAudioFileSampleTypes', [1], '/alarm/audioFileSampleTypes/1', 'GET'],
    ['getExternalAlarmChartByDay', [0], '/alarm/chatByDay?day=0', 'GET'],
    ['getCollectorStatuses', [], '/collectorManagement/status', 'GET'],
    ['getCollectorStatus', ['c1'], '/collectorManagement/c1/status', 'GET'],
    ['getCollectorStatusHistory', [], '/collectorManagement/status-history', 'GET'],
    ['getCollectorStatusEvents', [], '/collectorManagement/status-events', 'GET'],
    ['getRecordings', [], '/recordings', 'GET'],
    ['getRecording', [1], '/recordings/1', 'GET'],
    ['getRecordingVisualization', [1], '/recordings/1/visualization', 'GET'],
  ]
  for (const [name, args, path, method] of methods) {
    assert.equal((await api[name](...args)).id, 1)
    const call = calls.at(-1)
    assert.equal(call.url, `http://localhost:5175${path}`)
    assert.equal(call.options.method, method)
    assert.equal(call.options.headers.Authorization, 'Bearer test-token')
  }
  assert.equal(calls[2].options.body, JSON.stringify({ channel: 1 }))
  assert.equal(api.getRecordingContentUrl(1, { download: true }), 'http://localhost:5175/recordings/1/content?token=test-token&download=true')
})

test('monitor device requests accept cancellation without changing authentication or URL', async () => {
  let call
  const api = await loadApi(async (url, options) => { call = { url, options }; return reply({ code: 200, data: [] }) }, {}, { origin: 'http://localhost:5175' })
  const controller = new AbortController()
  await api.getMonitorDevices({ signal: controller.signal })
  assert.equal(call.options.signal, controller.signal)
  assert.equal(call.url, 'http://localhost:5175/monitor/devices')
  assert.equal(call.options.headers.Authorization, 'Bearer test-token')
  await api.getMonitorDevices()
  assert.equal('signal' in call.options, false)
})

test('503 detail remains usable, other HTTP errors and invalid data reject', async () => {
  const api = await loadApi(async () => reply({ status: 'Unhealthy', checks: [{ status: 'Unhealthy' }] }, 503))
  assert.equal((await api.getHealthDetail()).status, 'Unhealthy')
  await assert.rejects(() => api.getHealth(), /503/)
  await assert.rejects(() => api.getTableMaintenance(), /503/)
  const unauthorized = await loadApi(async () => reply({ message: 'Denied' }, 401))
  await assert.rejects(() => unauthorized.getHealthDetail(), /401/)
  const invalid = await loadApi(async () => reply({ unexpected: true }))
  await assert.rejects(() => invalid.getHealthDetail(), /格式不正确/)
  const html = await loadApi(async () => new Response('<html>not JSON</html>'))
  await assert.rejects(() => html.getHealthDetail())
})

test('healthy system can contain offline modules; no preview data on first load', async () => {
  setActivePinia(createPinia())
  const store = useHealthStore()
  assert.equal(store.detail, null)
  assert.equal(store.modules.length, 0)
  globalThis.fetch = sampleFetch
  await store.refresh()
  assert.equal(store.detail.status, 'Healthy')
  assert.equal(store.onlineCount, 8)
  assert.equal(store.offlineCount, 2)
  assert.equal(store.failedChecks.length, 0)
  assert.equal(store.maintenance.options.futurePartitionMonths, 3)
})

test('failed refresh retains last data and marks only failing section; recovery clears error', async () => {
  setActivePinia(createPinia())
  const store = useHealthStore()
  globalThis.fetch = sampleFetch
  await store.refresh()
  globalThis.fetch = async (url) => { if (url.endsWith('/detail')) throw new Error('Network failed'); return sampleFetch(url) }
  await store.refresh()
  assert.equal(store.onlineCount, 8)
  assert.equal(store.errors.detail, 'Network failed')
  assert.equal(store.errors.heartbeat, undefined)
  assert.equal(store.loading, false)
  globalThis.fetch = sampleFetch
  await store.refresh()
  assert.equal(store.errors.detail, undefined)
})

test('refreshes do not overlap, and unmount cancellation does not mutate data', async () => {
  setActivePinia(createPinia())
  const store = useHealthStore()
  let count = 0
  const releases = []
  globalThis.fetch = async (url) => { count++; await new Promise((resolve) => releases.push(resolve)); return sampleFetch(url) }
  const controller = new AbortController()
  const pending = store.refresh({ signal: controller.signal })
  await store.refresh()
  assert.equal(count, 3)
  controller.abort()
  releases.forEach((resolve) => resolve())
  await pending
  assert.equal(store.detail, null)
  assert.deepEqual(store.errors, {})
  assert.equal(store.loading, false)
})

test('503 unhealthy check details reach the store', async () => {
  setActivePinia(createPinia())
  const store = useHealthStore()
  globalThis.fetch = async (url) => url.endsWith('/detail') ? reply({ ...healthy, status: 'Unhealthy', checks: [{ name: 'db', status: 'Unhealthy', message: 'connection failed' }] }, 503) : sampleFetch(url)
  await store.refresh()
  assert.equal(store.failedChecks.length, 1)
  assert.equal(store.errors.detail, undefined)
  assert.equal(store.detail.status, 'Unhealthy')
})
