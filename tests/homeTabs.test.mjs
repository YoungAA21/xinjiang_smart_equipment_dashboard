import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as groups from '../src/charts/machineGroups.js'
import * as addresses from '../src/charts/pointAddress.js'
import * as catalog from '../src/charts/equipmentCatalog.js'
import * as charts from '../src/charts/telemetry.js'
import * as targets from '../src/charts/productionLineTargets.js'

for (const page of ['MachineMonitorPage', 'MachineOverviewPage']) {
test(`${page} defaults to the first machine and packs pressure and sound into one grid`, async () => {
  const calls = []
  const route = vue.reactive({ query: { machine: 'ZB25' } })
  const telemetry = vue.reactive({ modules: null, errors: {}, buffers: {},
    async refreshModules() { this.modules = ['VSE03','PRESS01','PRESS03','VSE04'].map(moduleId => ({ moduleId, host: moduleId === 'PRESS01' ? '192.168.3.104' : '192.168.3.103', runtimeStatus: { isOnline: true } })) },
    async refreshLatest() {}, clear() {}, async seedRecentPoints(point) { calls.push({ history: point.moduleId }) },
  })
  const monitor = vue.reactive({ devices: null, error: '', async refresh() { this.devices = [{ deviceId: 'sound', deviceName: '声音', online: true, collectors: [{ collectorId: 'gateway', ip: '192.168.3.53' }], channels: [{ channelId: 'ch1', collectorId: 'gateway', online: true }] }] }, clear() {} })
  const transport = { async getModulePoints(id, options) {
    calls.push({ id, signal: options.signal })
    return { moduleId: id, points: [
      { moduleId: id, pointId: 1, pointCode: 'measurement', metricType: 'NegativePressure' },
      { moduleId: id, pointId: 2, pointCode: 'alarm', metricType: 'AlarmStatus' },
      { moduleId: id, pointId: 3, pointCode: 'self-test', metricType: 'SelfTestResult' },
    ] }
  } }
  const dependencies = {
    '../services/soundPreview.js': { createSoundPreview: () => ({ stop: async () => {}, setTarget: async () => {} }) },
    '../services/api': { api: {} }, '../services/auth': { auth: { getToken: () => '' } },
    vue: { ...vue, inject: (_key, fallback) => fallback }, 'element-plus': { ElDialog: {} }, 'lucide-vue-next': Object.fromEntries(['Search','RefreshCw','Activity','AudioLines','Thermometer','Gauge','Eye','EyeOff'].map(name => [name, {}])),
    '../stores/telemetry': { useTelemetryStore: () => telemetry },
    '../stores/homeDevices': { useHomeDevicesStore: () => monitor },
    '../services/telemetry': { telemetryApi: transport },
    '../charts/machineGroups.js': groups, '../charts/pointAddress.js': addresses,
    '../charts/equipmentCatalog.js': catalog, '../charts/telemetry': charts,
    '../charts/productionLineTargets.js': targets,
  }
  const source = await readFile(new URL(`../src/views/${page}.vue`, import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: 'machine-monitor-test' })
  const context = vm.createContext({ console, Date, AbortController, WebSocket: class {}, window: { setInterval: () => 1, clearInterval() {} } })
  const module = new vm.SourceTextModule(compiled.content, { context })
  await module.link(specifier => {
    const exports = specifier.endsWith('.vue') ? { default: {} } : dependencies[specifier]
    assert.ok(exports, specifier)
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const component = module.namespace.default
  component.render = () => vue.h('div')
  const app = renderer.createApp(component)
  const state = app.mount({}).$.setupState
  try {
    for (let i = 0; i < 20; i++) await vue.nextTick()
    assert.equal(state.refreshing, false)
    assert.equal(state.activeMachineId, 'ZJ117')
    assert.equal(state.activeMachine.id, 'ZJ117')
    if (page === 'MachineOverviewPage') {
      assert.deepEqual(Array.from(state.machineData.groups, machine => machine.id), ['ZJ117', 'ZB25', 'YB55'])
    }
    assert.ok(state.allRows.every(row => row.member.id === 'VSE03'))
    assert.equal(state.allRows.length, 3)
    assert.ok(state.allRows.some(row => row.point.metricType === 'AlarmStatus'))
    assert.ok(state.allRows.every(row => row.point.configurationState === 'unconfigured'))
    assert.ok(calls.some(call => call.history === 'VSE03'))
    assert.equal(state.historyFailed, false)
    await state.selectMachine('ZB25')
    assert.equal(state.activeMachine.id, 'ZB25')
    assert.ok(state.allRows.some(row => row.member.id === 'PRESS01'))
    assert.ok(!state.allRows.some(row => row.member.id === 'PRESS03'))
    assert.ok(!state.allRows.some(row => row.member.id === 'VSE03'))
    assert.equal(state.displayRows.at(-1).member.source, 'monitor')
    assert.equal(state.displayRows.at(-2).member.source, 'legacy')
    assert.equal(state.soundTargets.length, 1)
    assert.deepEqual(Array.from(state.soundTargets[0].channelIds), ['ch1'])
    await state.selectMachine('YB55')
    assert.equal(state.activeMachineId, 'YB55')
    assert.equal(state.allRows.length, 3)
    assert.equal(state.allRows[0].member.id, 'PRESS03')
    assert.equal(state.sections.length, 2)
    assert.equal(state.switchingAcoustic, false)
    if (page === 'MachineMonitorPage') {
      await state.selectMachine('YB95')
      assert.equal(state.activeMachine.id, 'YB95')
      assert.equal(state.activeMachine.status, '未配置')
      assert.equal(state.allRows.length, 0)
      assert.equal(state.soundTargets.length, 0)
    }
  } finally { app.unmount() }
  assert.ok(calls.filter(call => call.signal).every(call => call.signal.aborted))
})
}
