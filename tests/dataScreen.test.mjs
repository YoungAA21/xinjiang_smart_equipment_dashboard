import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { collectionDetail, collectionModules, collectionRows, useDataScreenStore } from '../src/stores/dataScreen.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
const store = () => { setActivePinia(createPinia()); return useDataScreenStore() }
const reply = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

test('collection scope excludes acoustic modules, samples, checks and nested details', () => {
  const modules = collectionModules([{ moduleId: 'M', protocol: 'ModbusTcp' }, { moduleId: 'A', protocol: 'Acoustic' }])
  assert.deepEqual(collectionRows([{ moduleId: 'M', value: 0 }, { moduleId: 'A' }], modules), [{ moduleId: 'M', value: 0 }])
  const detail = collectionDetail({ runtimeModules: { enabledAcousticCount: 1, statuses: [{ moduleId: 'M' }, { moduleId: 'A' }] }, checks: [{ name: 'database.connection' }, { name: 'runtime.acoustic' }] }, modules)
  assert.equal(detail.runtimeModules.enabledAcousticCount, undefined)
  assert.deepEqual(detail.runtimeModules.statuses, [{ moduleId: 'M' }])
  assert.deepEqual(detail.checks, [{ name: 'database.connection' }])
})

test('failed refresh preserves data and successful timestamp while exposing the error', async () => {
  const screen = store()
  await screen.read('latest', async () => [{ value: 0 }])
  const time = screen.times.latest
  await screen.read('latest', async () => { throw new Error('offline') })
  assert.deepEqual(screen.data.latest, [{ value: 0 }])
  assert.equal(screen.times.latest, time)
  assert.equal(screen.errors.latest, 'offline')
})

test('late point response cannot overwrite the new selection', async () => {
  const screen = store()
  const pending = []
  globalThis.fetch = (url) => new Promise((resolve) => pending.push({ url: String(url), resolve }))
  const first = screen.loadPoint({ pointId: 1 })
  const second = screen.loadPoint({ pointId: 2 })
  for (const item of pending.filter((item) => item.url.includes('pointId=2'))) item.resolve(reply({ points: [{ value: 2 }], days: [{ averageValue: 2 }], insight: { recentAverageValue: 2 } }))
  await second
  for (const item of pending.filter((item) => item.url.includes('pointId=1'))) item.resolve(reply({ points: [{ value: 1 }], days: [{ averageValue: 1 }], insight: { recentAverageValue: 1 } }))
  await first
  assert.equal(screen.data.history[0].value, 2)
  assert.equal(screen.data.days[0].averageValue, 2)
  assert.equal(screen.data.insight.recentAverageValue, 2)
})

test('leaving the page prevents pending overview responses from repopulating the store', async () => {
  const screen = store()
  let finish
  const pending = screen.read('health', () => new Promise((resolve) => { finish = resolve }))
  screen.clear()
  finish({ status: 'Healthy' })
  await pending
  assert.deepEqual(screen.data, {})
  assert.deepEqual(screen.loading, {})
})
