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
