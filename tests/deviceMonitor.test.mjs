import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as groups from '../src/charts/machineGroups.js'
import * as addresses from '../src/charts/pointAddress.js'
import * as catalog from '../src/charts/equipmentCatalog.js'
import * as locations from '../src/charts/monitoringLocations.js'
import * as configuration from '../src/stores/pointConfiguration.js'
import { parameterKey } from '../src/charts/pointConfiguration.js'
import * as charts from '../src/charts/telemetry.js'
import * as homeNavigation from '../src/charts/homePointNavigation.js'
import * as recentHistory from '../src/composables/useRecentHistory.js'

test('measurement layout omits the three status tabs without changing saved locations', () => {
  const items = [
    { id: 'ch', name: 'CH 剔除状态' }, { id: 'speed', name: '高低速指示' },
    { id: 'appearance', name: '小包外观' }, { id: 've', name: 'VE 风机' },
    { id: 'motor', name: '主电机' }, { id: 'extra', name: '自定义点位' },
  ]
  assert.deepEqual(locations.pointLayoutLocations(items).map(item => item.id), ['ve', 'motor', 'extra'])
  assert.equal(items.length, 6)
})

test('point monitoring caches metadata and freely arranges cards across secondary targets', async () => {
  const original = configuration.configurationSnapshot()
  const calls = []
  const route = vue.reactive({ query: { location: 'unconfigured' } })
  const telemetry = vue.reactive({ modules: null, errors: {}, buffers: {}, latest: [],
    async refreshModules() { this.modules = ['PRESS01','PRESS03','VSE04'].map(moduleId => ({ moduleId, host: moduleId === 'PRESS01' ? '192.168.3.104' : '192.168.3.103', runtimeStatus: { isOnline: true } })) },
    async refreshLatest() {}, clear() {},
    async seedRecentPoints(point) { this.buffers[charts.pointKey(point)] = [1, 2].map(value => ({ ...point, value, collectedAt: new Date(2026, 9, 16, 10, 0, value).toISOString() })) },
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
    vue, 'vue-router': { useRoute: () => route, useRouter: () => ({ replace: value => { route.query = value.query } }) },
    '../stores/telemetry': { useTelemetryStore: () => telemetry },
    '../stores/homeDevices': { useHomeDevicesStore: () => monitor },
    '../services/telemetry.js': { telemetryApi: transport },
    '../services/api.js': { api: {} }, '../services/auth.js': { auth: { getToken: () => '' } },
    '../services/soundPreview.js': { createSoundPreview: () => ({ stop: async () => {}, setTarget: async () => {} }) },
    '../charts/monitoringLocations.js': locations, '../stores/pointConfiguration.js': configuration,
    '../charts/machineGroups.js': groups, '../charts/pointAddress.js': addresses,
    '../charts/equipmentCatalog.js': catalog, '../charts/telemetry.js': charts,
    '../charts/homePointNavigation.js': homeNavigation,
    '../composables/useRecentHistory.js': recentHistory,
  }
  const source = await readFile(new URL('../src/views/DeviceMonitorPage.vue', import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: 'machine-monitor-test' })
  const context = vm.createContext({ console, Date, AbortController, WebSocket: class {}, setInterval: () => 1, clearInterval() {} })
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
    assert.equal(state.selected.id, 've')
    assert.equal(state.rows.length, 0)
    assert.ok(state.locationOptions.every(location => location.id !== 'unconfigured'))
    assert.equal(state.pointMap.PRESS01.length, 3)
    assert.equal(state.pointMap.PRESS03.length, 3)
    assert.equal(calls.length, 3)
    await state.refresh()
    assert.equal(calls.length, 3)
    await state.refresh(true)
    assert.equal(calls.length, 6)
    // Hidden parameters remain available to configuration; the removed tab has no list.
    assert.ok(state.pointMap.PRESS01.some(point => point.metricType === 'AlarmStatus'))
    assert.ok(state.pointMap.PRESS01.some(point => point.metricType === 'SelfTestResult'))
    const point = state.pointMap.PRESS03[0]
    const saved = configuration.configurationSnapshot()
    saved.targets.push({ id: 'test-bearing', name: '测试被测点位', locationId: 'max' })
    saved.targets.push({ id: 'test-motor', name: '另一个被测点位', locationId: 'max' })
    saved.parameters[parameterKey(point)] = { displayName: '自定义压力', unit: 'Pa', locationId: 'max', targetId: 'test-bearing' }
    saved.parameters[parameterKey(state.pointMap.PRESS01[0])] = { displayName: '另一压力', unit: 'Pa', locationId: 'max', targetId: 'test-motor' }
    configuration.savePointConfiguration(saved, { setItem() {} })
    state.selectLocation('max')
    await vue.nextTick()
    assert.equal(state.targetGroups, undefined)
    assert.equal(state.layoutItems.length, 2)
    assert.deepEqual(new Set(state.layoutItems.map(item => item.title)), new Set(['自定义压力', '另一压力']))
    const pressureRow = state.rows.find(row => row.member.id === 'PRESS03')
    for (let i = 0; i < 10; i++) await vue.nextTick()
    assert.equal(state.telemetry.buffers[charts.pointKey(pressureRow.point)].length, 2)
    assert.equal(pressureRow.point.unit, 'Pa')
    assert.equal(state.rowName(pressureRow), '自定义压力')
    assert.match(source, /<ConfigurableDashboard uniform/)
    assert.doesNotMatch(source, /targetGroups|target-group/)
    state.openPoint(pressureRow)
    assert.equal(state.selectedRow.point.pointId, 1)
    assert.equal(state.selectedRow.member.id, 'PRESS03')
    state.selectedKey = ''
    // A home deep link can arrive before its parameter metadata is present.
    route.query = { location: 'max', source: 'legacy', device: 'PRESS03', pointId: '99', openPoint: '1' }
    await vue.nextTick()
    assert.equal(state.selectedRow, null)
    state.pointMap.PRESS03.push({ ...point, pointId: 99, pointCode: 'late-pressure', channelId: 'late' })
    const lateConfig = configuration.configurationSnapshot()
    lateConfig.parameters[parameterKey(state.pointMap.PRESS03.at(-1))] = { displayName: '迟到的报警参数', unit: 'Pa', locationId: 'max', targetId: 'test-bearing' }
    configuration.savePointConfiguration(lateConfig, { setItem() {} })
    await vue.nextTick()
    assert.equal(state.selectedRow.point.pointId, 99)
    assert.equal(state.selectedRow.member.id, 'PRESS03')
    assert.equal(route.query.openPoint, undefined)
    state.selectedKey = ''
    state.pointMap.PRESS03 = [...state.pointMap.PRESS03]
    await vue.nextTick()
    assert.equal(state.selectedRow, null, 'metadata refresh must not reopen a drawer after closing')
    state.selectLocation('unconfigured')
    await vue.nextTick()
    assert.equal(state.selectedRow, null)
  } finally { app.unmount(); configuration.savePointConfiguration(original, { setItem() {} }) }
  assert.ok(calls.every(call => call.signal.aborted))
})
