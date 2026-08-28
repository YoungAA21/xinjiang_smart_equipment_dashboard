import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import { createPinia, setActivePinia, defineStore } from 'pinia'
import { mergeHomeDevices, deviceSourceSummary } from '../src/charts/homeDevices.js'
import { countOnline, onlineDonut } from '../src/charts/healthCharts.js'

const legacy = Array.from({ length: 10 }, (_, i) => ({ moduleId: `M${i}`, protocol: 'Modbus', isOnline: i < 8 }))
const monitor = [{ deviceId: '2087109229625348096', deviceName: '大风机', online: true,
  collectors: [{ runtime: { connected: true, updatedAt: '2026-08-28T10:00:00+08:00' } }, { runtime: { connected: false, state: 'connecting', updatedAt: '2026-08-28T10:01:00+08:00' } }],
  channels: [{ online: true }, { online: false }],
}]

async function makeStore(getMonitorDevices) {
  setActivePinia(createPinia())
  const context = vm.createContext({ AbortSignal, Date, console })
  const pinia = new vm.SyntheticModule(['defineStore'], function () { this.setExport('defineStore', defineStore) }, { context })
  const api = new vm.SyntheticModule(['api'], function () { this.setExport('api', { getMonitorDevices }) }, { context })
  const store = new vm.SourceTextModule(await readFile(new URL('../src/stores/homeDevices.js', import.meta.url), 'utf8'), { context })
  await store.link((specifier) => specifier === 'pinia' ? pinia : api)
  await store.evaluate()
  return store.namespace.useHomeDevicesStore()
}

test('merged overview counts 10 legacy modules plus one device, not its collectors/channels', () => {
  const rows = mergeHomeDevices(legacy, monitor)
  assert.equal(rows.length, 11)
  assert.deepEqual(countOnline(rows), { online: 9, offline: 2, unknown: 0 })
  assert.equal(onlineDonut(rows).title.text, '82%')
  const device = rows.find((r) => r.source === 'monitor')
  assert.equal(device.id, '2087109229625348096')
  assert.equal(device.isOnline, true)
  assert.equal(device.collectorCount, 2)
  assert.equal(device.connectedCollectors, 1)
  assert.equal(device.channelCount, 2)
  assert.equal(device.onlineChannels, 1)
  assert.equal(device.updatedAt, '2026-08-28T10:01:00+08:00')
})

test('same IDs across services or protocols stay distinct', () => {
  const rows = mergeHomeDevices([{ moduleId: 'same', protocol: 'Modbus' }, { moduleId: 'same', protocol: 'Acoustic' }], [{ deviceId: 'same', deviceName: 'same' }])
  assert.equal(new Set(rows.map((r) => r.key)).size, 3)
  assert.equal(countOnline(rows).unknown, 3)
})

test('missing/invalid online values remain unknown and child status does not override device status', () => {
  const rows = mergeHomeDevices([], [{ deviceId: 'a', online: false, collectors: [{ runtime: { connected: true } }] }, { deviceId: 'b', online: 'false' }, { deviceId: 'c', online: null }])
  assert.deepEqual(countOnline(rows), { online: 0, offline: 1, unknown: 2 })
  assert.equal(rows[1].collectorCount, null)
})

test('source filtering keeps the expected individual distributions', () => {
  const rows = mergeHomeDevices(legacy, monitor)
  assert.equal(onlineDonut(rows.filter((r) => r.source === 'monitor')).title.text, '100%')
  assert.equal(onlineDonut(rows.filter((r) => r.source === 'legacy')).title.text, '80%')
})

test('source summary distinguishes partial data, stale data and a complete empty source', () => {
  assert.match(deviceSourceSummary({ legacyLoaded: true, monitorLoaded: false }), /部分来源/)
  assert.match(deviceSourceSummary({ legacyLoaded: true, monitorLoaded: true, monitorError: 'offline' }), /上次成功/)
  assert.match(deviceSourceSummary({ legacyLoaded: true, monitorLoaded: true }), /不跨系统去重/)
})

test('monitor refresh uses cancellable transport and validates response shape', async () => {
  let result = monitor
  const store = await makeStore(async (options) => { assert.ok(options.signal instanceof AbortSignal); return result })
  assert.equal(store.devices, null)
  await store.refresh()
  assert.equal(store.devices.length, 1)
  assert.ok(store.refreshedAt)
  result = { devices: monitor }
  await store.refresh()
  assert.match(store.error, /格式不正确/)
  assert.equal(store.devices.length, 1)
  result = []
  await store.refresh()
  assert.equal(store.devices.length, 0)
  assert.equal(store.error, '')
})

test('failure preserves snapshot without classifying missing source devices as offline; recovery clears error', async () => {
  let fail = true
  const store = await makeStore(async () => { if (fail) throw new Error('401 token expired'); return monitor })
  await store.refresh()
  assert.equal(store.devices, null)
  assert.match(store.error, /401/)
  assert.equal(countOnline(mergeHomeDevices(legacy, store.devices || [])).offline, 2)
  fail = false
  await store.refresh()
  const time = store.refreshedAt
  fail = true
  await store.refresh()
  assert.equal(store.devices[0].online, true)
  assert.equal(store.refreshedAt, time)
  fail = false
  await store.refresh()
  assert.equal(store.error, '')
})

test('requests do not overlap and unmount abort prevents publishing a snapshot', async () => {
  let release, calls = 0
  const store = await makeStore(async () => { calls++; await new Promise((r) => { release = r }); return monitor })
  const controller = new AbortController()
  const pending = store.refresh({ signal: controller.signal })
  await store.refresh()
  assert.equal(calls, 1)
  controller.abort(); release(); await pending
  assert.equal(store.devices, null)
  assert.equal(store.loading, false)
})

test('clearing a previous session invalidates late responses without disturbing the next request', async () => {
  const releases = []
  const store = await makeStore(async () => { await new Promise((resolve) => releases.push(resolve)); return monitor })
  const first = store.refresh()
  store.clear()
  const second = store.refresh()
  releases[0](); await first
  assert.equal(store.devices, null)
  assert.equal(store.loading, true)
  releases[1](); await second
  assert.equal(store.devices.length, 1)
  assert.equal(store.loading, false)
})
