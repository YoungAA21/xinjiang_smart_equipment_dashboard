import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { pointKey } from '../src/charts/telemetry.js'
import { updateDigitalAlarms, filterDigitalAlarms, digitalSignalName } from '../src/charts/digitalAlarms.js'
import { useDigitalAlarmStore } from '../src/stores/digitalAlarms.js'
const sample = (moduleId = 'PRESS02', channel = 1, value = 1, second = 1) => ({
  moduleId, channelId: `${moduleId}-DI0${channel}`, pointCode: `${moduleId}_DI0${channel}`,
  metricType: 'DigitalInput', quality: 'Good', value, collectedAt: `2026-10-13T20:00:${String(second).padStart(2, '0')}+08:00`,
})
const empty = () => ({ events: [], states: {} })

test('each of six DI channels creates its own incident, and repeated high values do not repeat notifications', () => {
  const samples = ['PRESS01', 'PRESS02', 'PRESS03'].flatMap(id => [sample(id, 1), sample(id, 2)])
  const first = updateDigitalAlarms(empty(), samples)
  assert.equal(first.events.length, 6)
  assert.equal(new Set(first.events.map(pointKey)).size, 6)
  assert.equal(first.triggered.length, 6)
  const next = updateDigitalAlarms(first, samples.map(p => ({ ...p, collectedAt: sample('PRESS02', 1, 1, 2).collectedAt })))
  assert.equal(next.events.length, 6)
  assert.deepEqual(next.triggered, [])
})
test('recovery closes only the matching incident; a subsequent high starts a new event', () => {
  let state = updateDigitalAlarms(empty(), [sample(), sample('PRESS01', 1)])
  state = updateDigitalAlarms(state, [sample('PRESS02', 1, 0, 3)])
  assert.equal(state.events.find(e => e.moduleId === 'PRESS02').status, 'Recovered')
  assert.equal(state.events.find(e => e.moduleId === 'PRESS01').status, 'Active')
  assert.equal(state.events.find(e => e.moduleId === 'PRESS02').durationSeconds, 2)
  state = updateDigitalAlarms(state, [sample('PRESS02', 1, 1, 4)])
  assert.equal(state.events.length, 3)
  assert.equal(state.triggered.length, 1)
})
test('absent, invalid, stale and wrong-quality data never create or recover alarms', () => {
  const first = updateDigitalAlarms(empty(), [sample()])
  for (const samples of [[], [sample('PRESS02', 1, 0, 0)], [{ ...sample(), value: null }], [{ ...sample(), quality: 'Bad' }], [{ ...sample(), moduleId: 'PRESS03' }], [{ ...sample(), collectedAt: 'invalid' }]]) {
    const next = updateDigitalAlarms(first, samples)
    assert.equal(next.events.length, 1)
    assert.equal(next.events[0].status, 'Active')
    assert.deepEqual(next.triggered, [])
  }
})
test('signal labels and point filters match the supplied installation sheet', () => {
  assert.equal(digitalSignalName(sample()), '卷烟机高低速转换')
  assert.equal(digitalSignalName(sample('PRESS03', 1)), 'CH 双包剔除信号')
  assert.equal(digitalSignalName(sample('PRESS03', 2)), 'CH 补包器信号')
  assert.equal(digitalSignalName(sample('PRESS01', 2)), '小包外观剔除按钮')
  const p = sample(), q = sample('PRESS03', 1)
  const events = updateDigitalAlarms(empty(), [p, q], { [pointKey(p)]: { pointId: 75 }, [pointKey(q)]: { pointId: 71 } }).events
  assert.equal(filterDigitalAlarms(events, { moduleId: 'PRESS02', pointId: 75 }).length, 1)
  assert.equal(filterDigitalAlarms(events, { moduleId: 'PRESS03', pointId: 75 }).length, 0)
  const withoutMetadata = updateDigitalAlarms(empty(), [p]).events
  assert.equal(filterDigitalAlarms(withoutMetadata, { moduleId: 'PRESS02', pointId: 75, pointCode: 'PRESS02_DI01' }).length, 1)
  assert.equal(filterDigitalAlarms(events, { isActive: false }).length, 0)
  assert.equal(filterDigitalAlarms(events, { start: '2026-10-13T20:01:00+08:00' }).length, 0)
})
test('local cache preserves unacknowledged alarms across restart without replaying prompts', async () => {
  const originalStorage = globalThis.localStorage, originalFetch = globalThis.fetch
  const cache = new Map()
  globalThis.localStorage = { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) }
  const p = sample()
  globalThis.fetch = async url => new Response(JSON.stringify(url.includes('/configuration/') ? { points: [{ ...p, pointId: 75 }] } : [p]))
  setActivePinia(createPinia())
  const store = useDigitalAlarmStore()
  try {
    store.start('operator')
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(store.events.length, 1)
    assert.equal(store.events[0].pointId, 75)
    assert.equal(store.notifications.length, 0)
    assert.equal(store.events[0].acknowledgedAt, null)
    store.start('operator')
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(store.events.length, 1)
    assert.equal(store.notifications.length, 0)
    store.dismiss()
    assert.equal(store.notifications.length, 0)
    assert.equal(store.events[0].isActive, true)
    store.start('operator')
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(store.events.length, 1)
    assert.equal(store.notifications.length, 0)
    store.start('another-operator')
    assert.equal(store.events.length, 0)
  } finally { store.stop(); globalThis.localStorage = originalStorage; globalThis.fetch = originalFetch }
})

test('new alarms and recoveries remain recorded without generating automatic notifications', () => {
  const originalStorage = globalThis.localStorage
  const cache = new Map()
  globalThis.localStorage = { setItem: (key, value) => cache.set(key, value) }
  setActivePinia(createPinia())
  const store = useDigitalAlarmStore()
  store.storageKey = 'silent-alarm-test'
  try {
    store.ingest([sample()])
    assert.equal(store.events.length, 1)
    assert.equal(store.events[0].isActive, true)
    assert.equal(store.events[0].acknowledgedAt, null)
    assert.deepEqual(store.notifications, [])
    store.ingest([sample('PRESS02', 1, 0, 2)])
    assert.equal(store.events[0].status, 'Recovered')
    store.ingest([sample('PRESS02', 1, 1, 3)])
    assert.equal(store.events.length, 2)
    assert.deepEqual(store.notifications, [])
    const saved = JSON.parse(cache.get(store.storageKey))
    assert.equal(saved.events.length, 2)
    assert.ok(saved.events.every(row => row.acknowledgedAt === null))
  } finally { globalThis.localStorage = originalStorage }
})
