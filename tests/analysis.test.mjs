import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { analysisApi, validateAnalysisQuery } from '../src/services/analysis.js'
import { dailyLimitTrendOption, percent, riskLabel, riskTone, trendAlarmChangeOption, valueText } from '../src/charts/analysis.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const range = { pointId: 35, start: '2026-08-01T00:00:00', end: '2026-09-01T00:00:00', bucketMinutes: 60 }

test('analysis routes use 5158, preserve supported filters and do not send credentials', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return reply({ events: [] }) }
  await analysisApi.getDailyLimitTrends({ ...range, limit: 366, ignored: 'value' })
  await analysisApi.getTrendInsights({ ...range, limit: 100000 })
  await analysisApi.getTrendAlarms({ pointId: 35, isActive: false, start: range.start, end: range.end, limit: 1000 })

  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    '/api/analysis/daily-limit-trends',
    '/api/analysis/trend-insights',
    '/api/analysis/trend-alarms',
  ])
  assert.deepEqual([...new URL(calls[0].url).searchParams.keys()], ['pointId', 'start', 'end', 'bucketMinutes', 'limit'])
  assert.equal(new URL(calls[2].url).searchParams.get('isActive'), 'false')
  for (const call of calls) {
    assert.equal(call.options.method, 'GET')
    assert.equal(call.options.headers.Authorization, undefined)
    assert.ok(call.options.signal instanceof AbortSignal)
  }
})

test('analysis query validation enforces endpoint constraints and complete time ranges', () => {
  const dailyOptions = { timeRequired: true, includeBucket: true, defaultLimit: 366, maxLimit: 3660 }
  assert.deepEqual(validateAnalysisQuery(range, dailyOptions), { ...range, limit: 366 })
  for (const invalid of [
    { ...range, pointId: 0 },
    { ...range, start: '' },
    { ...range, end: range.start },
    { ...range, bucketMinutes: 7 },
    { ...range, limit: 3661 },
  ]) assert.throws(() => validateAnalysisQuery(invalid, dailyOptions))
  assert.deepEqual(validateAnalysisQuery({ pointId: '', isActive: 'false' }, { pointRequired: false, includeStatus: true }), { isActive: false, limit: 200 })
})

test('development proxy permits only the trend analysis endpoints', async () => {
  let url
  const context = vm.createContext({ fetch: async (value) => { url = value; return reply({ events: [] }) }, URLSearchParams, AbortSignal })
  const endpointModule = new vm.SourceTextModule(await readFile(new URL('../src/services/endpoints.js', import.meta.url), 'utf8'), { context })
  const module = new vm.SourceTextModule(await readFile(new URL('../src/services/analysis.js', import.meta.url), 'utf8'), { context, initializeImportMeta(meta) { meta.env = { DEV: true } } })
  await endpointModule.link(() => { throw new Error('No dependencies expected') })
  await module.link((specifier) => specifier === './endpoints.js' ? endpointModule : Promise.reject(new Error(`Unexpected dependency: ${specifier}`)))
  await module.evaluate()
  await module.namespace.analysisApi.getTrendAlarms()
  assert.equal(url, '/_analysis-api/api/analysis/trend-alarms?limit=200')

  const { default: config } = await import('../vite.config.js')
  const proxies = config({ mode: 'test' }).server.proxy
  const pattern = new RegExp(Object.keys(proxies).find((key) => key.startsWith('^/_analysis-api/')))
  for (const path of [
    '/_analysis-api/api/analysis/daily-limit-trends?pointId=35',
    '/_analysis-api/api/analysis/trend-insights',
    '/_analysis-api/api/analysis/trend-alarms',
  ]) assert.ok(pattern.test(path))
  for (const path of [
    '/_analysis-api/api/analysis/alarms',
    '/_analysis-api/api/analysis/state-changes?limit=1',
    '/_analysis-api/api/configuration/points/35',
    '/_analysis-api/api/configuration/points/35/limits',
    '/_analysis-api/api/configuration/points/35/limits/history',
    '/_analysis-api/api/modbus-writebacks/trigger',
  ]) assert.equal(pattern.test(path), false)
})

test('trend chart helpers preserve zero values and map risk labels', () => {
  const option = dailyLimitTrendOption([{ date: '2026-08-01', minValue: 0, averageValue: 1, maxValue: 2, minimumValue: 0, maximumValue: 3 }], { name: '压力', unit: 'kPa' })
  assert.equal(option.series.length, 5)
  assert.equal(option.series[2].data[0], 0)
  assert.equal(valueText(0, 'kPa'), '0 kPa')
  assert.equal(percent(0), '0.0%')
  assert.equal(riskLabel('Watch'), '关注')
  assert.equal(riskTone('Warning'), 'warning')
  const alarmOption = trendAlarmChangeOption([
    { startedAt: '2026-08-02T00:00:00', alarmValue: 2, changeRate: 0.25, thresholdMax: 4, unit: 'mm/s' },
    { startedAt: '2026-08-01T00:00:00', alarmValue: 0, changeRate: 0, thresholdMin: 0, unit: 'mm/s' },
  ])
  assert.equal(alarmOption.series.length, 1)
  assert.equal(alarmOption.series[0].data[0], 0)
})

test('trend alarm panel defaults to the first module before querying events', async () => {
  const source = await readFile(new URL('../src/components/AnalysisAlarmPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /filters\.moduleId = modules\.value\[0\]\?\.moduleId \|\| ''/)
  assert.match(source, /if \(filters\.moduleId\) await changeModule\(\)/)
  assert.match(source, /async function handleModuleChange\(\) \{\s*await changeModule\(\)\s*await query\(\)\s*\}/)
  assert.match(source, /onMounted\(async \(\) => \{ await loadModules\(\); await query\(\) \}\)/)
})
