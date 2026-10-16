import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { telemetryApi, validateHistoryQuery, configureHistoryReader } from '../src/services/telemetry.js'
import { useTelemetryStore } from '../src/stores/telemetry.js'
import { appendSamples, localInputTime, numericValue, pointKey, seriesData, telemetryLine } from '../src/charts/telemetry.js'
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; configureHistoryReader(null) })
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const point = { pointId: 35, moduleId: 'PRESS01', channelId: 'AI01', pointCode: 'PRESS', name: '负压', unit: 'kPa' }
const sample = (second, value = 0) => ({ ...point, collectedAt: `2026-08-28T10:00:${String(second).padStart(2,'0')}+08:00`, value })
const query = { pointId: 35, start: '2026-08-28T10:00:00', end: '2026-08-28T10:10:00', limit: 5000 }

test('direct and cached history transport allow 120 seconds while metadata keeps 10 seconds', async t => {
  const timeouts = [], originalTimeout = AbortSignal.timeout
  t.mock.method(AbortSignal, 'timeout', ms => { timeouts.push(ms); return originalTimeout(ms) })
  globalThis.fetch = async () => reply({ pointId: 35, points: [] })
  await telemetryApi.getHistory(query)
  configureHistoryReader(load => load)
  await telemetryApi.getHistory(query)
  await telemetryApi.getModules()
  assert.deepEqual(timeouts, [120000, 120000, 10000])
})

test('slow history remains cancellable and reports the history timeout during body reading', async () => {
  const controller = new AbortController()
  globalThis.fetch = async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const pending = telemetryApi.getHistory(query, { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  globalThis.fetch = async () => ({ ok: true, async json() { throw new DOMException('Timed out', 'TimeoutError') } })
  await assert.rejects(telemetryApi.getHistory(query), /历史查询超时（120 秒）/)
})

test('four telemetry routes use the same-origin 5158 proxy without credentials; history only uses pointId', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({url,options}); return reply({}) }
  await telemetryApi.getModules(); await telemetryApi.getModulePoints('PRESS01'); await telemetryApi.getLatest(); await telemetryApi.getHistory({ ...query, moduleId:'must-not-send', channelId:'ignore', pointCode:'ignore' })
  assert.equal(calls[0].url,'/_telemetry-api/api/configuration/modules')
  assert.equal(calls[1].url,'/_telemetry-api/api/configuration/modules/PRESS01/points?includeLatest=false')
  assert.equal(calls[2].url,'/_telemetry-api/api/realtime/latest')
  const url = new URL(calls[3].url, 'http://frontend.test')
  assert.equal(url.pathname, '/_telemetry-api/api/telemetry/history')
  assert.deepEqual([...url.searchParams.keys()], ['pointId','start','end','limit'])
  assert.equal(url.searchParams.get('start'), query.start)
  for (const call of calls) { assert.equal(call.options.headers.Authorization, undefined); assert.ok(call.options.signal instanceof AbortSignal) }
})

test('module route encodes IDs and HTTP errors are not accepted as samples', async () => {
  globalThis.fetch = async (url) => { assert.ok(url.includes('/A%2FB%20%23/points?includeLatest=false')); return reply({},404) }
  await assert.rejects(() => telemetryApi.getModulePoints('A/B #'), /404/)
})

test('point configuration retries a transient timeout once and returns the real response', async () => {
  let attempts = 0
  globalThis.fetch = async () => {
    if (++attempts === 1) throw new DOMException('Timed out', 'TimeoutError')
    return reply({ moduleId: 'PRESS01', points: [point] })
  }
  assert.deepEqual(await telemetryApi.getModulePoints('PRESS01'), { moduleId: 'PRESS01', points: [point] })
  assert.equal(attempts, 2)
})

test('point configuration stops after two network failures and never retries navigation cancellation', async () => {
  let attempts = 0
  globalThis.fetch = async () => { attempts++; throw new TypeError('Failed to fetch') }
  await assert.rejects(telemetryApi.getModulePoints('PRESS01'), /Failed to fetch/)
  assert.equal(attempts, 2)
  const controller = new AbortController()
  attempts = 0
  globalThis.fetch = async () => { attempts++; controller.abort(); throw new DOMException('Timed out', 'TimeoutError') }
  await assert.rejects(telemetryApi.getModulePoints('PRESS01', { signal: controller.signal }), { name: 'TimeoutError' })
  assert.equal(attempts, 1)
})

test('history rejects invalid point IDs, times and limits before fetching', async () => {
  globalThis.fetch = () => { throw new Error('Should not fetch') }
  for (const invalid of [{pointId:0},{pointId:-1},{pointId:1.5},{start:'bad'}, {end:query.start},{limit:0},{limit:100001},{limit:2.5}]) assert.throws(()=>validateHistoryQuery({...query,...invalid}))
  assert.deepEqual(validateHistoryQuery({...query, pointId:'35',limit:'100'}),{...query, pointId:35,limit:100})
})

test('development route uses dedicated telemetry prefix without widening health or 18080 proxies', async () => {
  let url
  const context = vm.createContext({ fetch: async (value)=>{url=value;return reply({})}, URLSearchParams, AbortSignal })
  const endpointModule = new vm.SourceTextModule(await readFile(new URL('../src/services/endpoints.js',import.meta.url),'utf8'),{context})
  const module = new vm.SourceTextModule(await readFile(new URL('../src/services/telemetry.js',import.meta.url),'utf8'),{context,initializeImportMeta(meta){meta.env={DEV:true}}})
  await endpointModule.link(()=>{throw new Error('No dependencies expected')})
  await module.link((specifier)=>specifier === './endpoints.js' ? endpointModule : Promise.reject(new Error(`Unexpected dependency: ${specifier}`))); await module.evaluate()
  await module.namespace.telemetryApi.getLatest()
  assert.equal(url,'/_telemetry-api/api/realtime/latest')
  const { default: config } = await import('../vite.config.js')
  const proxies=config({mode:'test'}).server.proxy
  const pattern=new RegExp(Object.keys(proxies).find((key)=>key.startsWith('^/_telemetry-api/')))
  for (const path of ['/configuration/modules','/configuration/modules/A/points?includeLatest=false','/realtime/latest','/telemetry/history?pointId=35']) assert.equal(pattern.test('/_telemetry-api/api'+path),true)
  for (const path of ['/configuration/modbus','/realtime/latest/A/B/C','/analysis/alarms','/telemetry/history/aggregate']) assert.equal(pattern.test('/_telemetry-api/api'+path),false)
  assert.equal(pattern.test('/monitor/devices'),false)
})

test('same value with new timestamps is retained; repeated cached sample is not duplicated', () => {
  let buffers=appendSamples({},[sample(1),sample(2)])
  buffers=appendSamples(buffers,[sample(2),sample(3)])
  assert.equal(buffers[pointKey(point)].length,3)
  assert.deepEqual(buffers[pointKey(point)].map(s=>s.value),[0,0,0])
  assert.equal(appendSamples(buffers,[sample(4)],2)[pointKey(point)].length,2)
})

test('latest buffers isolate tuples, sort timestamps and release removed points', () => {
  const other={...sample(1),moduleId:'OTHER'}
  const buffers=appendSamples({},[sample(3),sample(1),other])
  assert.equal(Object.keys(buffers).length,2)
  assert.deepEqual(buffers[pointKey(point)].map(s=>s.collectedAt),[sample(1).collectedAt,sample(3).collectedAt])
  assert.equal(Object.keys(appendSamples(buffers,[sample(4)])).length,1)
})

test('chart preserves zero, does not turn missing values into zero, and gaps real-time outages', () => {
  assert.equal(numericValue(0),0); assert.equal(numericValue(null),null); assert.equal(numericValue(''),null)
  const data=seriesData([sample(1,0),sample(30,2)],15000)
  assert.equal(data.length,3); assert.equal(data[1][1],null)
  assert.equal(seriesData([sample(1),sample(30)]).length,2)
  const option=telemetryLine([sample(1,0)],point)
  assert.equal(option.series[0].type,'line'); assert.equal(option.series[0].smooth,false)
  assert.equal(option.series[0].data.length,1)
  assert.equal(option.series[0].connectNulls,false)
})

test('datetime-local defaults use local calendar components', () => {
  assert.equal(localInputTime(new Date(2026,7,28,12,34,56)), '2026-08-28T12:34:56')
})

test('point changes ignore late responses from previous module', async () => {
  setActivePinia(createPinia()); const store=useTelemetryStore(); const releases={}
  globalThis.fetch=async(url)=>{const id=url.includes('/A/')?'A':'B';await new Promise(resolve=>releases[id]=resolve);return reply({moduleId:id,points:[{...point,moduleId:id}]})}
  const a=store.loadPoints('A');const b=store.loadPoints('B');releases.B();await b;releases.A();await a
  assert.equal(store.pointModuleId,'B');assert.equal(store.points[0].moduleId,'B')
})

test('metadata refresh retains same-module points while loading and clears them for a different module', async () => {
  setActivePinia(createPinia())
  const store = useTelemetryStore()
  globalThis.fetch = async () => reply({ moduleId: 'A', points: [{ ...point, moduleId: 'A' }] })
  await store.loadPoints('A')
  let release
  globalThis.fetch = async () => { await new Promise(resolve => { release = resolve }); return reply({ moduleId: 'A', points: [{ ...point, moduleId: 'A', name: '新名称' }] }) }
  const refreshing = store.loadPoints('A')
  assert.equal(store.loadingPoints, true)
  assert.equal(store.points.length, 1)
  release()
  await refreshing
  assert.equal(store.points[0].name, '新名称')
  globalThis.fetch = async () => { await new Promise(resolve => { release = resolve }); return reply({ moduleId: 'B', points: [] }) }
  const switching = store.loadPoints('B')
  assert.equal(store.points.length, 0)
  release()
  await switching
  assert.equal(store.pointModuleId, 'B')
})

test('failed latest refresh keeps the real previous samples and marks error', async () => {
  setActivePinia(createPinia());const store=useTelemetryStore()
  globalThis.fetch=async()=>reply([sample(1)])
  await store.refreshLatest();globalThis.fetch=async()=>{throw new Error('network down')};await store.refreshLatest()
  assert.equal(store.latest.length,1);assert.equal(store.buffers[pointKey(point)].length,1);assert.match(store.errors.latest,/network/)
})

test('changing point invalidates old history requests and clears the old chart', async () => {
  setActivePinia(createPinia());const store=useTelemetryStore();let release
  globalThis.fetch=async()=>{await new Promise(r=>release=r);return reply({points:[sample(1)]})}
  const pending=store.loadHistory(query);store.clearHistory();release();await pending
  assert.equal(store.history,null);assert.equal(store.loadingHistory,false)
})

test('history records the executed range, not mutable form fields', async () => {
  setActivePinia(createPinia());const store=useTelemetryStore()
  globalThis.fetch=async()=>reply({points:[sample(1)]})
  await store.loadHistory(query)
  assert.deepEqual(store.history.requested,query);assert.equal(store.history.points.length,1)
})

test('unmount clear prevents late sample response contaminating the next visit', async () => {
  setActivePinia(createPinia());const store=useTelemetryStore();let release
  globalThis.fetch=async()=>{await new Promise(r=>release=r);return reply([sample(1)])}
  const pending=store.refreshLatest();store.clear();release();await pending
  assert.equal(store.latest.length,0);assert.deepEqual(store.buffers,{})
})

test('home history fills a bounded window, merges concurrent live data and rolls oldest samples out', async () => {
  setActivePinia(createPinia()); const store = useTelemetryStore(); let release
  const start = Date.parse('2026-10-12T10:00:00+08:00')
  const at = (i, value = i) => ({ ...point, collectedAt: new Date(start + i * 1000).toISOString(), value })
  globalThis.fetch = async url => {
    if (url.includes('/history')) { await new Promise(resolve => release = resolve); return reply({ points: Array.from({ length: 310 }, (_, i) => at(i)).reverse() }) }
    return reply([at(309, 999), at(310)])
  }
  const loading = store.seedRecentPoints(point)
  await store.refreshLatest(); release(); await loading
  const key = pointKey(point)
  assert.equal(store.buffers[key].length, 300)
  assert.equal(store.buffers[key][0].value, 11)
  assert.equal(store.buffers[key].at(-2).value, 999)
  assert.equal(store.buffers[key].at(-1).value, 310)
  globalThis.fetch = async () => reply([at(311)])
  await store.refreshLatest()
  assert.equal(store.buffers[key].length, 300)
  assert.equal(store.buffers[key][0].value, 12)
  assert.equal(store.buffers[key].at(-1).value, 311)
  globalThis.fetch = async () => reply([])
  await store.refreshLatest()
  assert.equal(store.buffers[key].length, 300)
})

test('home history does not fabricate samples or restore data after leaving the page', async () => {
  setActivePinia(createPinia()); const store = useTelemetryStore(); let release
  globalThis.fetch = async () => reply({ points: [] })
  await store.seedRecentPoints(point)
  assert.deepEqual(store.buffers[pointKey(point)], [])
  globalThis.fetch = async () => { await new Promise(resolve => release = resolve); return reply({ points: [sample(1)] }) }
  const loading = store.seedRecentPoints(point)
  store.clear(); release(); await loading
  assert.deepEqual(store.buffers, {})
})

test('current thresholds preserve zero, support one-sided limits and stay visible outside sample range', () => {
  const samples = [{ collectedAt: '2026-10-16T10:00:00Z', value: 5 }]
  const point = { name: '振动', unit: 'mm/s', minimumValue: 0, maximumValue: 10 }
  const option = telemetryLine(samples, point, { history: true, showLimits: true })
  assert.deepEqual(option.series[0].markLine.data.map(line => line.yAxis), [0, 10])
  assert.equal(option.yAxis.min({ min: 4 }), 0)
  assert.equal(option.yAxis.max({ max: 6 }), 10)
  assert.match(option.series[0].markLine.data[0].label.formatter, /下限 0 mm\/s/)
  assert.deepEqual(option.series[0].data, [[Date.parse(samples[0].collectedAt), 5]])
  const upper = telemetryLine(samples, { ...point, minimumValue: null }, { showLimits: true })
  assert.deepEqual(upper.series[0].markLine.data.map(line => line.yAxis), [10])
  const empty = telemetryLine([], { minimumValue: null, maximumValue: null }, { showLimits: true })
  assert.equal(empty.series[0].markLine.data.length, 0)
  assert.equal(empty.yAxis.min, undefined)
  const equal = telemetryLine(samples, { minimumValue: 0, maximumValue: 0 }, { showLimits: true })
  assert.equal(equal.series[0].markLine.data.length, 2)
  assert.equal(telemetryLine(samples, point).series[0].markLine, undefined)
})
