import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as vue from 'vue'
import * as alarmPoints from '../src/charts/alarmPoints.js'
import { parameterKey, emptyConfiguration } from '../src/charts/pointConfiguration.js'
import { loadAlarmPointMetadata, queryPointAlarms } from '../src/services/pointAlarms.js'

const first = { moduleId: 'VSE03', channelId: 'ch1', pointCode: 'speed', pointId: 11 }
const second = { moduleId: 'TEMP02', channelId: 'ch2', pointCode: 'temp', pointId: 22 }
const third = { moduleId: 'VSE04', channelId: 'ch3', pointCode: 'speed', pointId: 33 }
const metadata = { VSE03: [first], TEMP02: [second], VSE04: [third] }
function configuration() {
  const value = emptyConfiguration()
  value.targets = [{ id: 'bearing', name: '轴承', locationId: 've' }, { id: 'drive', name: '驱动端', locationId: 'main-motor' }]
  value.parameters = Object.fromEntries([first, second, third].map((point, i) => [parameterKey(point), {
    displayName: ['振动', '温度', '主机振动'][i], unit: ['mm/s', '℃', 'mm/s'][i],
    locationId: i === 2 ? 'main-motor' : 've', targetId: i === 2 ? 'drive' : 'bearing', pointId: 999,
  }]))
  value.parameters[parameterKey({ deviceId: 'sound1', channelId: 'audio' }, 'monitor')] = {
    displayName: '声纹', unit: '', locationId: 've', targetId: 'bearing',
  }
  return value
}
const points = () => alarmPoints.configuredAlarmPoints(configuration(), metadata)
const event = (point, id = point.pointId) => ({ alarmId: String(id), pointId: point.pointId, moduleId: point.moduleId,
  startedAt: `2026-10-18T${point.pointId === 11 ? '01' : '02'}:00:00+08:00`, status: 'Active', alarmValue: 0 })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 20; i++) await vue.nextTick() }

test('alarm hierarchy follows current configured equipment, targets and parameters, using live IDs', () => {
  const rows = points()
  assert.equal(rows.length, 3)
  assert.equal(rows[0].pointId, 11, 'saved point IDs do not override the current catalog')
  assert.equal(rows[0].locationName, 'VE 风机')
  assert.equal(rows[0].targetName, '轴承')
  assert.deepEqual(alarmPoints.filterAlarmPoints(rows, { machineId: 'ZJ17', locationId: 've' }).map(row => row.pointId), [11, 22])
  const options = alarmPoints.alarmPointOptions(rows, { machineId: 'ZB25' })
  assert.deepEqual(options.modelId, [{ id: 'YB25', name: 'YB25' }])
  assert.deepEqual(options.targetId.map(row => row.id), ['drive'])
  const next = alarmPoints.normalizeAlarmScope(rows, { machineId: 'ZB25', modelId: 'ZJ17', locationId: 've', targetId: 'bearing', parameterId: rows[0].key }, 'machineId')
  assert.deepEqual(next, { machineId: 'ZB25', modelId: '', locationId: '', targetId: '', parameterId: '' })
  const config = configuration()
  Object.assign(config.parameters[parameterKey(first)], { locationId: 'main-motor', targetId: 'drive' })
  assert.equal(alarmPoints.configuredAlarmPoints(config, metadata)[0].machineId, 'ZB25')
})

test('device queries expand to selected point IDs, merge newest first and preserve event values and units', async () => {
  const selected = alarmPoints.filterAlarmPoints(points(), { machineId: 'ZJ17' })
  const calls = []
  const result = await queryPointAlarms(selected, { isActive: 'false', start: '2026-10-18', end: '2026-10-19', limit: 20 }, {
    fetchEvents: async query => { calls.push(query); const point = selected.find(point => point.pointId === query.pointId); return { events: [{ ...event(point), unit: '历史单位' }, { ...event(point), unit: '历史单位' }] } },
  })
  assert.deepEqual(calls.map(call => call.pointId), [11, 22])
  assert.ok(calls.every(call => call.isActive === false && call.start === '2026-10-18' && !('moduleId' in call)))
  assert.deepEqual(result.events.map(row => row.pointId), [22, 11])
  assert.equal(result.events[0].name, '温度')
  assert.equal(result.events[0].alarmValue, 0)
  assert.equal(result.events[0].unit, '历史单位')
  assert.equal(result.truncated, false)
})

test('choosing a parent automatically selects the first valid option through the remaining hierarchy', () => {
  const rows = points()
  const next = alarmPoints.selectNextAlarmScope(rows, { machineId: 'ZJ17', modelId: 'YB25', locationId: 'main-motor', targetId: 'drive', parameterId: rows[2].key }, 'machineId')
  assert.deepEqual(next, { machineId: 'ZJ17', modelId: 'ZJ17', locationId: 've', targetId: 'bearing', parameterId: rows[0].key })
  const all = alarmPoints.selectNextAlarmScope(rows, { ...next, modelId: '' }, 'modelId')
  assert.deepEqual(all, { machineId: 'ZJ17', modelId: '', locationId: '', targetId: '', parameterId: '' })
  assert.equal(alarmPoints.filterAlarmPoints(rows, all).length, 2)
  const temperature = alarmPoints.selectNextAlarmScope(rows, { ...next, parameterId: rows[1].key }, 'parameterId')
  assert.equal(temperature.parameterId, rows[1].key)
  const empty = alarmPoints.selectNextAlarmScope([], next, 'machineId')
  assert.ok(Object.values(empty).every(value => value === ''))
})

test('per-point and merged limits are explicit and zero selected points never falls back to a global query', async () => {
  const selected = points().slice(0, 2)
  const result = await queryPointAlarms(selected, { limit: 1 }, { fetchEvents: async query => [event(selected.find(point => point.pointId === query.pointId))] })
  assert.equal(result.events.length, 1)
  assert.equal(result.truncated, true)
  const merged = await queryPointAlarms(points(), { limit: 2 }, { fetchEvents: async query => ({ events: [event(points().find(point => point.pointId === query.pointId))] }) })
  assert.equal(merged.events.length, 2)
  assert.equal(merged.truncated, true)
  assert.deepEqual(await queryPointAlarms([], {}, { fetchEvents: assert.fail }), { events: [], truncated: false, pointCount: 0 })
})

test('trend charts keep distinct parameters and historical units in separate selectable groups', () => {
  const events = points().map(point => alarmPoints.alarmEventPoint(event(point), point))
  events.push({ ...events[0], unit: 'm/s' })
  const groups = alarmPoints.alarmChartGroups(events)
  assert.equal(groups.length, 4)
  assert.equal(groups[0].events[0].alarmValue, 0)
  assert.ok(groups.every(group => new Set(group.events.map(event => `${event.configurationKey}:${event.unit}`)).size === 1))
})

test('missing current IDs, mixed point responses and individual failures cannot become a successful empty result', async () => {
  await assert.rejects(queryPointAlarms(alarmPoints.configuredAlarmPoints(configuration()), {}, { fetchEvents: assert.fail }), /当前有效点位/)
  await assert.rejects(queryPointAlarms(points().slice(0, 1), {}, { fetchEvents: async () => ({ events: [event(second)] }) }), /不匹配/)
  await assert.rejects(queryPointAlarms(points().slice(0, 1), {}, { fetchEvents: async () => ({ events: [{ moduleId: first.moduleId }] }) }), /无法识别/)
  await assert.rejects(queryPointAlarms(points(), {}, { fetchEvents: async () => { throw new Error('HTTP 500') } }), /500/)
})

test('events without numeric point IDs require an unambiguous channel and code identity', async () => {
  const selected = points().slice(0, 1)
  const response = { moduleId: 'VSE03', pointCode: 'speed', startedAt: '2026-10-18', alarmValue: 0 }
  const result = await queryPointAlarms(selected, {}, { fetchEvents: async () => [response] })
  assert.equal(result.events[0].pointId, 11)
  const ambiguous = alarmPoints.configuredAlarmPoints(configuration(), { ...metadata, VSE03: [first, { ...first, channelId: 'other', pointId: 44 }] }).slice(0, 1)
  await assert.rejects(queryPointAlarms(ambiguous, {}, { fetchEvents: async () => [response] }), /无法识别/)
  const exact = await queryPointAlarms(ambiguous, {}, { fetchEvents: async () => [{ ...response, channelId: 'ch1' }] })
  assert.equal(exact.events[0].pointId, 11)
})

test('catalog checks identity and reports failed modules while supporting other equipment', async () => {
  const result = await loadAlarmPointMetadata(['VSE03', 'TEMP02'], { api: { getModulePoints: async id => ({ moduleId: id === 'TEMP02' ? 'wrong' : id, points: metadata[id] }) } })
  assert.equal(result.metadata.VSE03[0].pointId, 11)
  assert.equal(result.metadata.TEMP02.length, 0)
  assert.match(result.errors[0], /TEMP02/)
})

test('point alarm queries bound concurrency and stop queued work on navigation', async () => {
  const controller = new AbortController()
  const pending = []
  const selected = Array.from({ length: 8 }, (_, i) => ({ ...points()[0], pointId: i + 1 }))
  const request = queryPointAlarms(selected, {}, { signal: controller.signal, fetchEvents: query => {
    const wait = deferred(); pending.push({ query, wait }); return wait.promise
  } })
  const rejected = assert.rejects(request, { name: 'AbortError' })
  assert.equal(pending.length, 3)
  controller.abort()
  pending.forEach(row => row.wait.resolve({ events: [] }))
  await rejected
  assert.equal(pending.length, 3)
})

async function createQuery(t, fetchEvents, initial = {}) {
  const config = vue.reactive(configuration())
  const scope = vue.effectScope()
  let cleanup
  const context = vm.createContext({ AbortController, AbortSignal, Date })
  const module = new vm.SourceTextModule(await readFile(new URL('../src/composables/usePointAlarmQuery.js', import.meta.url), 'utf8'), { context })
  const dependencies = {
    vue: { ...vue, onBeforeUnmount: callback => { cleanup = callback } },
    '../stores/pointConfiguration.js': { pointConfiguration: config },
    '../charts/alarmPoints.js': alarmPoints,
    '../services/pointAlarms.js': { queryPointAlarms, loadAlarmPointMetadata: async () => ({ metadata, errors: [] }) },
  }
  await module.link(specifier => {
    const exports = dependencies[specifier]
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  const state = scope.run(() => module.namespace.usePointAlarmQuery(fetchEvents, initial))
  t.after(() => { cleanup(); scope.stop() })
  return { state, config, cleanup }
}

test('rapid equipment changes cancel old queries, reset child selections and only show current scope', async t => {
  const calls = []
  const { state } = await createQuery(t, (query, options) => {
    const wait = deferred(); calls.push({ query, options, wait }); return wait.promise
  })
  const initializing = state.initialize()
  await flush()
  assert.equal(calls.length, 3)
  state.scope.machineId = 'ZB25'
  const changed = state.changeScope('machineId')
  assert.equal(state.rows.value, null)
  assert.ok(calls[0].options.signal.aborted)
  assert.equal(calls[3].query.pointId, 33)
  calls[3].wait.resolve({ events: [event(third)] })
  await changed
  calls.slice(0, 3).forEach(call => call.wait.resolve({ events: [] }))
  await initializing
  assert.equal(state.rows.value[0].pointId, 33)
  assert.match(state.requested.value.label, /ZB25主机/)
  assert.equal(state.scope.modelId, 'YB25')
  assert.equal(state.scope.locationId, 'main-motor')
  assert.equal(state.scope.targetId, 'drive')
  assert.equal(state.scope.parameterId, points()[2].key)
})

test('same-scope failure preserves applied filters; configuration removal clears old results and sends no broad request', async t => {
  let fail = false, calls = 0
  const { state, config } = await createQuery(t, async query => {
    calls++
    if (fail) throw new Error('HTTP 500')
    return { events: [event([first, second, third].find(point => point.pointId === query.pointId))] }
  }, { pointId: 11 })
  await state.initialize()
  assert.equal(state.rows.value.length, 1)
  const requested = state.requested.value
  fail = true
  state.filters.isActive = 'false'
  await state.query()
  assert.equal(state.rows.value[0].pointId, 11)
  assert.equal(state.requested.value, requested)
  assert.match(state.error.value, /500/)
  config.parameters = {}
  await flush()
  assert.equal(state.rows.value.length, 0)
  assert.equal(state.requested.value.pointCount, 0)
  assert.equal(calls, 2)
})

test('unmount cancels requests and ignores late responses', async t => {
  const waits = []
  const { state, cleanup } = await createQuery(t, (query, { signal }) => {
    const wait = deferred(); waits.push({ wait, signal }); return wait.promise
  })
  const request = state.initialize()
  await flush()
  cleanup()
  assert.ok(waits.every(item => item.signal.aborted))
  waits.forEach(item => item.wait.resolve({ events: [] }))
  await request
  assert.equal(state.rows.value, null)
})
