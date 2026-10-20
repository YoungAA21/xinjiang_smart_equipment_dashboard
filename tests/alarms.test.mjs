import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createPinia, setActivePinia } from 'pinia'
import { alarmApi, validateAlarmQuery } from '../src/services/alarms.js'
import { useAlarmStore, alarmEvents } from '../src/stores/alarms.js'
import { alarmValue, legacyAlarmStatus } from '../src/charts/alarms.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const event = { alarmId: '2087109229625348096', moduleId: 'VSE08', channelId: 'VSE08-SE01', pointCode: 'SE08_v_01', alarmValue: 0, recoveryValue: 0, status: 'Active', startedAt: '2026-08-28T10:00:00+08:00' }

test('5158 alarm routes use the isolated same-origin proxy and supported filters without credentials', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return reply({ events: [] }) }
  await alarmApi.getAlarms({ pointId: 28, isActive: false, moduleId: 'ignore', channelId: 'ignore', start: '2026-08-28T00:00:00', end: '2026-08-29T00:00:00', limit: 1000 })
  const url = new URL(calls[0].url, 'http://frontend.test')
  assert.equal(url.pathname, '/_alarm-api/api/analysis/alarms')
  assert.deepEqual([...url.searchParams.keys()], ['pointId', 'isActive', 'start', 'end', 'limit'])
  assert.equal(url.searchParams.get('isActive'), 'false')
  assert.equal(calls[0].options.headers.Authorization, undefined)
  assert.ok(calls[0].options.signal instanceof AbortSignal)
  await alarmApi.getAlarms()
  assert.equal(calls[1].url, '/_alarm-api/api/analysis/alarms?limit=200')
  await alarmApi.getStatus()
  assert.equal(calls[2].url, '/_alarm-api/api/analysis/status')
})

test('alarm filters reject invalid input and retain false, zero-free IDs and optional times', () => {
  for (const query of [{ pointId: 0 }, { pointId: 1.5 }, { limit: 0 }, { limit: 1001 }, { isActive: 1 }, { start: 'bad' }, { start: '2026-08-28', end: '2026-08-27' }]) assert.throws(() => validateAlarmQuery(query))
  assert.deepEqual(validateAlarmQuery({ pointId: '', isActive: 'false', limit: '20' }), { isActive: false, limit: 20 })
  assert.equal(validateAlarmQuery({ isActive: 'true' }).isActive, true)
})

test('HTTP 500 is reported and never interpreted as an empty successful result', async () => {
  setActivePinia(createPinia())
  const store = useAlarmStore()
  globalThis.fetch = async () => reply({}, 500)
  await store.load()
  assert.equal(store.rows, null)
  assert.equal(store.updatedAt, null)
  assert.match(store.error, /500/)
  assert.equal(store.loading, false)
})

test('a failed new query retains the previous rows and the previous applied filter label', async () => {
  setActivePinia(createPinia())
  const store = useAlarmStore()
  globalThis.fetch = async () => reply({ events: [event] })
  await store.load({ pointId: 28 })
  globalThis.fetch = async () => reply({}, 500)
  await store.load({ pointId: 35 })
  assert.equal(store.rows[0].alarmId, event.alarmId)
  assert.equal(store.requested.pointId, 28)
  assert.match(store.error, /500/)
})

test('analysis worker success does not fill failed event queries with runtime alarms', async () => {
  setActivePinia(createPinia())
  const store = useAlarmStore()
  globalThis.fetch = async (url) => url.includes('/status') ? reply({ runtimeStatus: { activeAlarms: [event] }, analysisPending: 0 }) : reply({}, 500)
  await Promise.all([store.load(), store.loadStatus()])
  assert.equal(store.status.runtimeStatus.activeAlarms.length, 1)
  assert.equal(store.rows, null)
  assert.match(store.error, /500/)
  assert.equal(store.statusError, '')
})

test('new query results win races and clearing invalidates outstanding requests', async () => {
  setActivePinia(createPinia())
  const store = useAlarmStore()
  const releases = []
  globalThis.fetch = async () => { const index = releases.length; await new Promise((resolve) => releases.push(resolve)); return reply({ events: [{ ...event, alarmId: String(index) }] }) }
  const first = store.load({ pointId: 28 }); const second = store.load({ pointId: 35 })
  releases[1](); await second; releases[0](); await first
  assert.equal(store.rows[0].alarmId, '1')
  assert.equal(store.requested.pointId, 35)
  const third = store.load(); store.clear(); releases[2](); await third
  assert.equal(store.rows, null)
})

test('event parsing rejects unknown envelopes and preserves alarm display helpers', () => {
  assert.equal(alarmEvents([event]).length, 1)
  assert.equal(alarmEvents({ events: [event] }).length, 1)
  assert.throws(() => alarmEvents({ wrong: [] }))
  assert.equal(legacyAlarmStatus('Recovered'), '已恢复')
  assert.equal(legacyAlarmStatus('Unexpected'), 'Unexpected')
  assert.equal(alarmValue(0, 'kPa'), '0 kPa')
  assert.equal(alarmValue(null), '—')
})

test('development alarm proxy only permits two read-only endpoints', async () => {
  let url
  const context = vm.createContext({ URLSearchParams, AbortSignal, fetch: async (value) => { url = value; return reply({ events: [] }) } })
  const endpointModule = new vm.SourceTextModule(await readFile(new URL('../src/services/endpoints.js', import.meta.url), 'utf8'), { context })
  const module = new vm.SourceTextModule(await readFile(new URL('../src/services/alarms.js', import.meta.url), 'utf8'), { context, initializeImportMeta(meta) { meta.env = { DEV: true } } })
  await endpointModule.link(() => { throw new Error('No dependencies expected') })
  await module.link((specifier) => specifier === './endpoints.js' ? endpointModule : Promise.reject(new Error(`Unexpected dependency: ${specifier}`))); await module.evaluate()
  await module.namespace.alarmApi.getAlarms()
  assert.equal(url, '/_alarm-api/api/analysis/alarms?limit=200')
  const { default: config } = await import('../vite.config.build.js')
  const proxies = config({ mode: 'test' }).server.proxy
  const key = Object.keys(proxies).find((key) => key.startsWith('^/_alarm-api/'))
  const pattern = new RegExp(key)
  for (const path of ['/_alarm-api/api/analysis/alarms?isActive=false', '/_alarm-api/api/analysis/status']) assert.ok(pattern.test(path))
  for (const path of ['/_alarm-api/api/analysis/alarms/confirm', '/_alarm-api/alarm/page', '/alarm/page', '/_alarm-api/api/modbus-writebacks/trigger']) assert.equal(pattern.test(path), false)
})

test('collection alarm panel uses the shared equipment point query and hierarchy selector', async () => {
  const source = await readFile(new URL('../src/components/LegacyAlarmPanel.vue', import.meta.url), 'utf8')
  assert.ok(source.includes('usePointAlarmQuery(alarmApi.getAlarms'))
  assert.match(source, /<AlarmPointFilters/)
  assert.doesNotMatch(source, /getModules|handleModuleChange/)
})
