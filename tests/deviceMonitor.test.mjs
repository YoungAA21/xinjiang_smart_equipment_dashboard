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

test('whole-machine monitor keeps ownership, hides state points, caches configuration and preserves drill-down context', async () => {
  const calls = []
  const route = vue.reactive({ query: { machine: 'ZB25' } })
  const telemetry = vue.reactive({ modules: null, errors: {}, buffers: {},
    async refreshModules() { this.modules = ['PRESS01','PRESS03','VSE04'].map(moduleId => ({ moduleId, host: moduleId === 'PRESS01' ? '192.168.3.104' : '192.168.3.103', runtimeStatus: { isOnline: true } })) },
    async refreshLatest() {}, clear() {},
  })
  const monitor = vue.reactive({ devices: null, error: '', async refresh() { this.devices = [{ deviceId: 'sound', deviceName: '声音', online: true, collectors: [{ collectorId: 'gateway', ip: '192.168.4.114' }], channels: [{ channelId: 'ch1', collectorId: 'gateway', online: true }] }] }, clear() {} })
  const transport = { async getModulePoints(id, options) {
    calls.push({ id, signal: options.signal })
    return { moduleId: id, points: [
      { moduleId: id, pointId: 1, pointCode: 'measurement', metricType: 'NegativePressure' },
      { moduleId: id, pointId: 2, pointCode: 'alarm', metricType: 'AlarmStatus' },
      { moduleId: id, pointId: 3, pointCode: 'self-test', metricType: 'SelfTestResult' },
    ] }
  } }
  const dependencies = {
    vue, 'vue-router': { useRoute: () => route },
    '../stores/telemetry': { useTelemetryStore: () => telemetry },
    '../stores/homeDevices': { useHomeDevicesStore: () => monitor },
    '../services/telemetry.js': { telemetryApi: transport },
    '../charts/machineGroups.js': groups, '../charts/pointAddress.js': addresses,
    '../charts/equipmentCatalog.js': catalog, '../charts/telemetry.js': charts,
  }
  const source = await readFile(new URL('../src/views/DeviceMonitorPage.vue', import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: 'machine-monitor-test' })
  const context = vm.createContext({ console, Date, AbortController, setInterval: () => 1, clearInterval() {} })
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
    assert.equal(state.busy, false)
    assert.equal(state.selected.id, 'ZB25')
    assert.equal(state.selected.pointCount, 4)
    assert.ok(state.selected.members.some(member => member.id === 'PRESS03'))
    assert.equal(state.grouped.pending.members.length, 0)
    assert.equal(state.pointMap.PRESS01.length, 1)
    assert.equal(calls.length, 3)
    await state.refresh()
    assert.equal(calls.length, 3)
    await state.refresh(true)
    assert.equal(calls.length, 6)
    const link = state.detailLink(state.selected.members[0], 'history', state.pointMap.PRESS01[0])
    assert.equal(link.query.machine, 'ZB25')
    assert.equal(link.query.pointId, 1)
    assert.equal(link.query.source, 'legacy')
    route.query = { machine: 'main-pressure' }
    await vue.nextTick()
    assert.equal(state.selected.id, 'ZB25')
    route.query = { machine: 'missing' }
    await vue.nextTick()
    assert.equal(state.selected, undefined)
  } finally { app.unmount() }
  assert.ok(calls.every(call => call.signal.aborted))
})
