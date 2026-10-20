import test from 'node:test'
import assert from 'node:assert/strict'
import { computed } from 'vue'
import { liveLineColor, defaultLineColors } from '../src/charts/liveLineColors.js'
import { emptyConfiguration, validateConfiguration } from '../src/charts/pointConfiguration.js'
import { pointConfiguration, configurationSnapshot, savePointConfiguration } from '../src/stores/pointConfiguration.js'
import { telemetryLine } from '../src/charts/telemetry.js'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const point = { moduleId: 'TEMP02', channelId: 'AI01', pointCode: 'TEMP', pointId: 12, minimumValue: 0, maximumValue: 80 }
const alarm = { ...point, isActive: true }

test('live values switch between normal and alarm colors, preserving zero and inclusive limits', () => {
  for (const value of [0, 35, 80]) assert.equal(liveLineColor(point, { value }), defaultLineColors.normal)
  for (const value of [-1, 81, 999999]) assert.equal(liveLineColor(point, { value }), defaultLineColors.alarm)
  for (const value of [null, undefined, NaN, Infinity, '81']) assert.equal(liveLineColor(point, { value }), '#9aaba5')
  assert.equal(liveLineColor({ ...point, minimumValue: null, maximumValue: null }, { value: 999 }), defaultLineColors.normal)
})

test('only active alarms for the same point override realtime values; recovered alarms return to normal', () => {
  assert.equal(liveLineColor(point, { value: 5 }, [alarm]), defaultLineColors.alarm)
  assert.equal(liveLineColor(point, null, [alarm]), defaultLineColors.alarm)
  for (const event of [{ ...alarm, pointId: 13 }, { ...alarm, moduleId: 'TEMP03' }, { ...alarm, isActive: false }, { moduleId: point.moduleId, isActive: true }]) {
    assert.equal(liveLineColor(point, { value: 5 }, [event]), defaultLineColors.normal)
  }
  assert.equal(liveLineColor(point, { value: 5 }, [{ ...alarm, pointId: undefined, status: 'Active', isActive: undefined }]), defaultLineColors.alarm)
  assert.equal(liveLineColor(point, { value: 5 }, [{ ...alarm, pointId: undefined, channelId: 'AI02' }]), defaultLineColors.normal)
})

test('old configurations migrate and invalid imported colors are rejected', () => {
  const old = emptyConfiguration()
  delete old.lineColors
  assert.deepEqual(validateConfiguration(old).lineColors, defaultLineColors)
  for (const lineColors of [null, {}, { ...defaultLineColors, normal: 'red' }, { ...defaultLineColors, damage: '#bad' }]) {
    assert.throws(() => validateConfiguration({ ...old, lineColors }), /颜色/)
  }
})

test('saved colors persist, update reactive charts, and leave historical chart defaults unchanged', t => {
  const previous = configurationSnapshot()
  let stored
  const storage = { setItem(key, value) { stored = JSON.parse(value) } }
  t.after(() => savePointConfiguration(previous, storage))
  const color = computed(() => liveLineColor(point, { value: 2 }, [], pointConfiguration.lineColors))
  const colors = { normal: '#117733', alarm: '#ddaa00', damage: '#cc1111' }
  savePointConfiguration({ ...emptyConfiguration(), lineColors: colors }, storage)
  assert.equal(color.value, colors.normal)
  assert.deepEqual(stored.lineColors, colors)
  assert.deepEqual(configurationSnapshot().lineColors, colors)
  assert.equal(liveLineColor(point, { value: 90 }, [], colors), colors.alarm)
  assert.equal(telemetryLine([], point, { history: true }).series[0].lineStyle.color, '#68afff')
  assert.throws(() => savePointConfiguration({ ...emptyConfiguration(), lineColors: defaultLineColors }, { setItem() { throw new Error('quota') } }), /无法保存/)
  assert.equal(color.value, colors.normal)
})

test('page alarm polling deduplicates slow requests and cancels late replies on unmount', async () => {
  let mount, unmount, poll, provided, resolve, cleared = false
  const calls = []
  const dependencies = {
    vue: { inject() {}, provide(key, value) { provided = value }, ref: value => ({ value }), onMounted(fn) { mount = fn }, onBeforeUnmount(fn) { unmount = fn } },
    '../services/alarms.js': { alarmApi: { getAlarms(query, options) { calls.push({ query, ...options }); return new Promise(done => { resolve = done }) } } },
    '../stores/alarms.js': { alarmEvents: value => value },
    '../stores/pointConfiguration.js': { pointConfiguration: { lineColors: defaultLineColors } },
    '../charts/liveLineColors.js': { liveLineColor },
  }
  const context = vm.createContext({ AbortController, setInterval(fn, ms) { assert.equal(ms, 5000); poll = fn; return 7 }, clearInterval(id) { assert.equal(id, 7); cleared = true } })
  const module = new vm.SourceTextModule(await readFile(new URL('../src/composables/useLiveLineColors.js', import.meta.url), 'utf8'), { context })
  await module.link(name => {
    const exports = dependencies[name]
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  module.namespace.provideLiveLineColors()
  mount()
  await poll()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].query.isActive, true)
  resolve([alarm])
  await new Promise(done => setImmediate(done))
  assert.equal(provided(point, { value: 5 }), defaultLineColors.alarm)
  const pending = poll()
  unmount()
  assert.equal(cleared, true)
  assert.equal(calls[1].signal.aborted, true)
  resolve([])
  await pending
  assert.equal(provided(point, { value: 5 }), defaultLineColors.alarm)
  await poll()
  assert.equal(calls.length, 2)
})
