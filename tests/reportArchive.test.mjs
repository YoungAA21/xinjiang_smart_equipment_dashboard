import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateEquipmentReport } from '../src/services/reports.js'
import { listReportSnapshots, loadReportConfiguration, previousReportSelection, resolveReportSnapshot, saveReportConfiguration, saveReportSnapshot } from '../src/services/reportArchive.js'

function memoryStorage() {
  const data = new Map()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}
const selection = { mode: 'shift', date: '2026-10-16', shift: 'night' }
const temperature = { pointId: 1, moduleId: 'A', metricType: 'Temperature', pointCode: 'TEMP', name: '<温度>', unit: '℃' }
const pressure = { pointId: 2, moduleId: 'B', metricType: 'NegativePressure', pointCode: 'PRESS', name: '负压', unit: 'kPa' }
function setup(storage = memoryStorage()) {
  let reads = 0, calls = []
  return {
    storage, owner: 'alice', selection,
    loadCatalog: async () => { reads++; return { modules: [{ moduleId: 'A' }, { moduleId: 'B' }], points: [temperature, pressure, { ...temperature, pointId: 3, metricType: 'DigitalInput' }], errors: [] } },
    generate: options => generateEquipmentReport({ ...options,
      telemetry: { getHistory: async query => { calls.push(query.pointId); return { points: [{ collectedAt: query.start, quality: 'Good', value: query.pointId === 2 ? -10 : 0 }] } } },
      alarms: { getAlarms: async () => ({ events: [] }) }, analysis: { getTrendAlarms: async () => ({ events: [] }) },
    }),
    reads: () => reads, calls: () => calls,
  }
}

test('saved report configuration and snapshots are isolated by user', async () => {
  const options = setup()
  saveReportConfiguration('alice', { moduleId: 'B', metrics: ['pressure'] }, options.storage)
  assert.deepEqual(loadReportConfiguration('alice', options.storage), { moduleId: 'B', metrics: ['pressure'] })
  assert.deepEqual(loadReportConfiguration('bob', options.storage).metrics, ['vibration', 'temperature', 'pressure'])
  const snapshot = await resolveReportSnapshot(options)
  assert.match(snapshot.html, /负压/)
  assert.deepEqual(options.calls(), [2, 2])
  assert.equal(listReportSnapshots('alice', options.storage).length, 1)
  assert.equal(listReportSnapshots('bob', options.storage).length, 0)
})

test('viewing a saved period reuses its fixed HTML after configuration or source changes', async () => {
  const options = setup()
  const first = await resolveReportSnapshot(options)
  saveReportConfiguration('alice', { moduleId: 'B', metrics: ['pressure'] }, options.storage)
  const second = await resolveReportSnapshot({ ...options, loadCatalog: () => { throw new Error('must not query') } })
  assert.deepEqual(second, first)
  assert.equal(options.reads(), 1)
  const regenerated = await resolveReportSnapshot({ ...options, replace: true })
  assert.notEqual(regenerated.scope, first.scope)
  assert.equal(listReportSnapshots('alice', options.storage).length, 1)
  assert.deepEqual(listReportSnapshots('alice', options.storage)[0], regenerated)
})

test('aborted generation never writes a stale snapshot and all failed histories remain retryable', async () => {
  const options = setup(), controller = new AbortController()
  await assert.rejects(resolveReportSnapshot({ ...options, signal: controller.signal, generate: async args => { const result = await options.generate(args); controller.abort(); return result } }), /abort/i)
  assert.equal(listReportSnapshots('alice', options.storage).length, 0)
  await assert.rejects(resolveReportSnapshot({ ...options, generate: async () => ({ rows: [{ errors: ['offline'] }] }) }), /均失败/)
  assert.equal(listReportSnapshots('alice', options.storage).length, 0)
})

test('report persistence failures are visible and a concurrent existing snapshot remains fixed', () => {
  const storage = memoryStorage()
  const first = { id: 'test', html: '<html>first</html>' }
  assert.equal(saveReportSnapshot('alice', first, { storage }), first)
  assert.deepEqual(saveReportSnapshot('alice', { id: 'test', html: 'second' }, { storage }), first)
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
  assert.throws(() => saveReportSnapshot('alice', first, { storage: full }), /保存失败/)
  assert.throws(() => saveReportConfiguration('alice', { metrics: ['temperature'] }, full), /保存失败/)
  assert.throws(() => saveReportConfiguration('alice', { metrics: [] }, storage), /至少选择/)
})

test('switching backwards respects night ownership, month boundaries and natural days', () => {
  assert.deepEqual(previousReportSelection({ mode: 'shift', date: '2026-10-01', shift: 'day' }), { mode: 'shift', date: '2026-09-30', shift: 'night' })
  assert.deepEqual(previousReportSelection(selection), { mode: 'shift', date: '2026-10-16', shift: 'day' })
  assert.equal(previousReportSelection({ mode: 'daily', date: '2026-10-01' }).date, '2026-09-30')
})

test('retention preserves the newly requested historical report without storing raw histories', async () => {
  const options = setup()
  for (let index = 0; index < 60; index++) saveReportSnapshot('alice', { id: `older-${index}`, html: 'saved' }, { storage: options.storage })
  const result = await resolveReportSnapshot(options)
  const snapshots = listReportSnapshots('alice', options.storage)
  assert.equal(snapshots.length, 60)
  assert.equal(snapshots[0].id, result.id)
  assert.equal('rows' in snapshots[0], false)
  assert.match(result.html, /&lt;温度&gt;/)
})
