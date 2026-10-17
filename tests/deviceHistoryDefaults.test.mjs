import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as charts from '../src/charts/telemetry.js'
import * as equipmentCatalog from '../src/charts/equipmentCatalog.js'
import * as machineGroups from '../src/charts/machineGroups.js'
import * as monitoringLocationCatalog from '../src/charts/monitoringLocations.js'
import { shiftRange } from '../src/charts/shiftRange.js'

const source = await readFile(new URL('../src/views/DeviceDetailPage.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, { id: 'device-history-test' })
const flush = async () => { for (let i = 0; i < 8; i++) await vue.nextTick() }

async function mountMonitor(query = { source: 'legacy', device: 'PRESS02' }) {
  let now = new Date(2026, 7, 28, 12, 0, 0).getTime()
  class Clock extends Date { static now() { return now } }
  const calls = []
  const record = { moduleId: 'PRESS02', moduleName: '负压', runtimeStatus: { isOnline: true } }
  const points = [37, 38].map((pointId) => ({ pointId, moduleId: 'PRESS02', channelId: `AI${pointId}`, pointCode: `P${pointId}` }))
  const telemetry = vue.reactive({
    modules: null, points: [], pointModuleId: '', latest: [], buffers: {}, history: null,
    async refreshModules() { this.modules = [record, { ...record, moduleId: 'PRESS03', moduleName: '新设备' }] },
    async loadPoints(moduleId) { this.pointModuleId = moduleId; this.points = points },
    async refreshLatest() {},
    async seedRecentPoints(point) {
      this.buffers[charts.pointKey(point)] = [1, 2].map(value => ({ ...point, value, collectedAt: new Date(now - (3 - value) * 2000).toISOString() }))
    },
    clearHistory() { this.history = null },
    async loadHistory(query, options) { calls.push({ query, signal: options.signal }); this.history = { requested: query, points: [] } },
    clear() {},
  })
  const context = vm.createContext({ console, Date: Clock, AbortController, AbortSignal, window: { setInterval: () => 1, clearInterval: () => {} } })
  const dependencies = {
    vue,
    'vue-router': { useRoute: () => ({ query }) },
    'lucide-vue-next': Object.fromEntries(['Activity', 'Database', 'Fan', 'RefreshCcw', 'Search', 'Server'].map((key) => [key, {}])),
    '../services/api': { api: { getMonitorDevices: async () => [] } },
    '../stores/telemetry': { useTelemetryStore: () => telemetry },
    '../charts/telemetry': charts,
    '../charts/equipmentCatalog.js': equipmentCatalog,
    '../charts/machineGroups.js': machineGroups,
    '../charts/monitoringLocations.js': monitoringLocationCatalog,
    '../charts/shiftRange.js': { shiftRange: mode => shiftRange(mode, new Date(now)) },
  }
  const moduleCode = new vm.SourceTextModule(compiled.content, { context })
  await moduleCode.link((specifier) => {
    const exports = specifier.endsWith('.vue') ? { default: {} } : dependencies[specifier]
    assert.ok(exports, `Unexpected dependency: ${specifier}`)
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) }, { context })
  })
  await moduleCode.evaluate()
  const renderer = vue.createRenderer({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {},
    parentNode: () => null, nextSibling: () => null,
  })
  const component = moduleCode.namespace.default
  component.render = () => vue.h('div')
  const app = renderer.createApp(component)
  const instance = app.mount({})
  await flush()
  return { app, state: instance.$.setupState, calls, advance: (ms) => { now += ms } }
}

test('history table entry and point changes automatically query the current shift', async (t) => {
  const { app, state, calls } = await mountMonitor()
  t.after(() => app.unmount())
  assert.equal(calls.length, 0)
  state.chartMode = 'history'
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].query.pointId, 37)
  assert.equal(calls[0].query.start, '2026-08-28T09:30:00')
  assert.equal(calls[0].query.end, '2026-08-28T18:00:00')
  state.selectedPointId = 38
  await flush()
  assert.equal(calls.length, 2)
  assert.equal(calls[1].query.pointId, 38)
  assert.equal(calls[0].signal.aborted, true)
})

test('opening point details defaults to historical charts without requesting live samples', async (t) => {
  const { app, state } = await mountMonitor()
  t.after(() => app.unmount())
  assert.equal(state.chartMode, 'live')
  assert.equal(state.detailTabs[0].label, '历史曲线')
  assert.equal(Object.keys(state.telemetry.buffers).length, 0)
  assert.doesNotMatch(source, /telemetry\.refreshLatest|setInterval|useRecentHistory/)
  assert.match(descriptor.template.content, /<HomePointExplorer embedded historical-only/)
})
test('reentering history uses current time while manual queries preserve the chosen range', async (t) => {
  const { app, state, calls, advance } = await mountMonitor()
  t.after(() => app.unmount())
  state.chartMode = 'history'
  await flush()
  state.historyStart = '2026-08-28T10:00:00'
  await state.queryHistory()
  assert.equal(calls.at(-1).query.start, '2026-08-28T10:00:00')
  state.chartMode = 'live'
  await flush()
  assert.equal(calls.at(-1).signal.aborted, true)
  advance(5 * 60 * 1000)
  state.chartMode = 'history'
  await flush()
  assert.equal(calls.at(-1).query.start, '2026-08-28T09:30:00')
  assert.equal(calls.at(-1).query.end, '2026-08-28T18:00:00')
})

test('whole-machine history link selects the requested point rather than the first point', async (t) => {
  const { app, state, calls } = await mountMonitor({ source: 'legacy', device: 'PRESS02', machine: 'ZJ17', pointId: '38', tab: 'history' })
  t.after(() => app.unmount())
  assert.equal(state.selectedPointId, 38)
  assert.equal(calls.at(-1).query.pointId, 38)
})

test('historical charts are embedded alongside a separate history table and loading state', () => {
  assert.equal((descriptor.template.content.match(/<HomePointExplorer\b/g) || []).length, 2)
  assert.doesNotMatch(source, /historyOption|历史原始数据折线/)
  assert.match(descriptor.template.content, /<TelemetryHistoryList/)
  assert.match(descriptor.template.content, /正在查询历史数据/)
})

test('analysis tabs keep the selected device and point; choosing a device resets the view', async (t) => {
  const { app, state } = await mountMonitor()
  t.after(() => app.unmount())
  state.selectedPointId = 38
  state.chartMode = 'trend'
  await flush()
  assert.equal(state.selected.id, 'PRESS02')
  assert.equal(state.selectedPoint.pointId, 38)
  state.chartMode = 'spectrum'
  await flush()
  assert.equal(state.selectedPoint.pointId, 38)
  state.selectedKey = JSON.stringify(['legacy', 'PRESS03'])
  await flush()
  assert.equal(state.selected.id, 'PRESS03')
  assert.equal(state.chartMode, 'live')
  assert.match(descriptor.template.content, /<TrendPage[^>]+:point="selectedPoint"/)
  assert.match(descriptor.template.content, /<SpectrumPage[^>]+:channel-id="selectedChannel.channelId"/)
})

test('legacy analysis entry opens the requested device detail tab', async (t) => {
  const { app, state } = await mountMonitor({ tab: 'trend', source: 'legacy', device: 'PRESS02' })
  t.after(() => app.unmount())
  assert.equal(state.chartMode, 'trend')
  assert.equal(state.source, 'legacy')
  assert.equal(state.selectedPoint.pointId, 37)
})


test('device directory waits for an explicit device choice and missing devices do not fall back', async () => {
  for (const query of [{}, { source: 'legacy', device: 'missing' }]) {
    const { app, state, calls } = await mountMonitor(query)
    assert.equal(state.selected, null)
    assert.equal(state.points.length, 0)
    assert.equal(calls.length, 0)
    app.unmount()
  }
})

test('device tabs exclude unsupported analysis and old URLs fall back to live', async () => {
  for (const [source, unsupported, supported] of [['legacy', 'spectrum', 'trend'], ['monitor', 'trend', 'spectrum']]) {
    const { app, state } = await mountMonitor({ source, device: source === 'legacy' ? 'PRESS02' : 'DEV1', tab: unsupported })
    assert.equal(state.detailTabs.some(tab => tab.id === unsupported), false)
    assert.equal(state.detailTabs.some(tab => tab.id === supported), true)
    assert.equal(state.chartMode, 'live')
    assert.equal(state.availableTab(unsupported, source), 'live')
    if (source === 'monitor') {
      assert.equal(state.detailTabs.some(tab => tab.id === 'history'), false)
      assert.equal(state.availableTab('history', source), 'live')
    }
    app.unmount()
  }
})
