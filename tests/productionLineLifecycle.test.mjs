import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as vue from 'vue'
import * as groups from '../src/charts/machineGroups.js'
import * as line from '../src/charts/productionLine.js'
import * as catalog from '../src/charts/equipmentCatalog.js'
import * as telemetryCharts from '../src/charts/telemetry.js'
import * as status from '../src/charts/productionLineStatus.js'
import * as homeAlarms from '../src/charts/homeAlarms.js'
import { pointConfiguration } from '../src/stores/pointConfiguration.js'
import { parameterKey } from '../src/charts/pointConfiguration.js'

test('leaving the production home cancels requests, clears timers and ignores late point configuration', async () => {
  let mounted, unmounted, resolvePoints
  const cleared = [], signals = [], timers = []
  const pointResponse = new Promise(resolve => { resolvePoints = resolve })
  const telemetry = vue.reactive({ modules: [{ moduleId: 'VSE03', runtimeStatus: { isOnline: true } }], errors: {}, latest: [], buffers: {},
    async refreshModules(options) { signals.push(options.signal) }, async refreshLatest(options) { signals.push(options.signal) }, clear() { this.modules = null },
  })
  const acoustic = vue.reactive({ devices: [], error: '', async refresh(options) { signals.push(options.signal) }, clear() { this.devices = null } })
  const dependencies = {
    vue: { ...vue, onMounted: callback => { mounted = callback }, onBeforeUnmount: callback => { unmounted = callback } },
    '../stores/telemetry.js': { useTelemetryStore: () => telemetry },
    '../stores/homeDevices.js': { useHomeDevicesStore: () => acoustic },
    '../services/telemetry.js': { telemetryApi: { getModulePoints(_id, options) { signals.push(options.signal); return pointResponse } } },
    '../services/alarms.js': { alarmApi: { async getAlarms(_query, options) { signals.push(options.signal); return [] } } },
    '../stores/alarms.js': { alarmEvents: body => body },
    '../charts/productionLine.js': line,
    '../charts/machineGroups.js': groups,
    '../charts/equipmentCatalog.js': catalog,
    '../charts/telemetry.js': telemetryCharts,
    '../charts/productionLineStatus.js': status,
    '../charts/homeAlarms.js': homeAlarms,
  }
  const context = vm.createContext({ Date, AbortController, window: { setInterval(callback) { timers.push(callback); return timers.length }, clearInterval(id) { cleared.push(id) } } })
  const source = await readFile(new URL('../src/composables/useProductionLine.js', import.meta.url), 'utf8')
  const module = new vm.SourceTextModule(source, { context })
  await module.link(specifier => {
    const exports = dependencies[specifier]
    assert.ok(exports, specifier)
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  const state = module.namespace.useProductionLine()
  mounted()
  for (let index = 0; index < 10; index++) await vue.nextTick()
  assert.equal(state.refreshing.value, true)
  assert.equal(timers.length, 3)
  unmounted()
  assert.deepEqual(cleared, [1, 2, 3])
  assert.ok(signals.every(signal => signal.aborted))
  resolvePoints({ moduleId: 'VSE03', points: [{ moduleId: 'VSE03', channelId: '1', pointCode: 'v', metricType: 'VibrationRms' }] })
  for (let index = 0; index < 10; index++) await vue.nextTick()
  assert.equal(state.refreshing.value, false)
  assert.equal(state.machines.value[0].pointCount, 0)
  assert.equal(state.selected.value.state, 'unknown')
})

test('SVG machine alarms and counts exclude unconfigured points and react immediately to configuration removal', async t => {
  const original = pointConfiguration.parameters
  t.after(() => { pointConfiguration.parameters = original })
  const point = { moduleId: 'VSE03', channelId: '1', pointCode: 'SE01_v_01', pointId: 51 }
  const other = { ...point, pointCode: 'SE01_s_06', pointId: 52 }
  pointConfiguration.parameters = { [parameterKey(point)]: { displayName: 'VE 振动', unit: 'mm/s', locationId: 've', targetId: 'bearing', pointId: 51 } }
  let reply = [{ ...other, status: 'Active' }]
  const telemetry = vue.reactive({ modules: [{ moduleId: 'VSE03', runtimeStatus: { isOnline: true } }], errors: {},
    latest: [point, other].map(item => ({ ...item, value: 0, collectedAt: new Date().toISOString() })), buffers: {},
    async refreshModules() {}, async refreshLatest() {}, clear() {},
  })
  const dependencies = {
    vue: { ...vue, onMounted() {}, onBeforeUnmount() {} },
    '../stores/telemetry.js': { useTelemetryStore: () => telemetry },
    '../stores/homeDevices.js': { useHomeDevicesStore: () => ({ devices: [], error: '', async refresh() {}, clear() {} }) },
    '../services/telemetry.js': { telemetryApi: { async getModulePoints() { return { moduleId: 'VSE03', points: [point, other] } } } },
    '../services/alarms.js': { alarmApi: { async getAlarms() { return reply } } },
    '../stores/alarms.js': { alarmEvents: body => body },
    '../charts/productionLine.js': line, '../charts/machineGroups.js': groups,
    '../charts/equipmentCatalog.js': catalog, '../charts/productionLineStatus.js': status,
    '../charts/homeAlarms.js': homeAlarms,
  }
  const context = vm.createContext({ Date, AbortController })
  const module = new vm.SourceTextModule(await readFile(new URL('../src/composables/useProductionLine.js', import.meta.url), 'utf8'), { context })
  await module.link(specifier => {
    const exports = dependencies[specifier]
    assert.ok(exports, specifier)
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  const state = module.namespace.useProductionLine()
  await state.refresh({ configuration: true })
  assert.equal(state.events.value.length, 0)
  assert.equal(state.machines.value[0].alarmCount, 0)
  assert.notEqual(state.machines.value[0].health, 'alarm')
  assert.ok(state.machines.value[0].rows.every(row => !row.alarm))
  reply = [{ ...point, status: 'Active' }, ...reply]
  await state.refresh()
  assert.equal(state.machines.value[0].alarmCount, 1)
  assert.equal(state.machines.value[0].health, 'alarm')
  assert.equal(state.events.value.length, 1)
  delete pointConfiguration.parameters[parameterKey(point)]
  assert.equal(state.machines.value[0].alarmCount, 0)
  assert.notEqual(state.machines.value[0].health, 'alarm')
  assert.equal(state.events.value.length, 0)
  reply = Array.from({ length: 1000 }, () => ({ ...other, status: 'Active' }))
  await state.refresh()
  assert.equal(state.events.value.length, 0)
  assert.equal(state.alarmsReady.value, false, 'filtered rows must not conceal a truncated alarm response')
})
