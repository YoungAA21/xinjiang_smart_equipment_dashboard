import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as charts from '../src/charts/telemetry.js'

const source = await readFile(new URL('../src/views/DeviceDetailPage.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, { id: 'device-history-test' })
const flush = async () => { for (let i = 0; i < 8; i++) await vue.nextTick() }

async function mountMonitor() {
  let now = new Date(2026, 7, 28, 12, 0, 0).getTime()
  class Clock extends Date { static now() { return now } }
  const calls = []
  const record = { moduleId: 'PRESS02', moduleName: '负压', runtimeStatus: { isOnline: true } }
  const points = [37, 38].map((pointId) => ({ pointId, moduleId: 'PRESS02', channelId: `AI${pointId}`, pointCode: `P${pointId}` }))
  const telemetry = vue.reactive({
    modules: null, points: [], pointModuleId: '', latest: [], buffers: {}, history: null,
    async refreshModules() { this.modules = [record] },
    async loadPoints(moduleId) { this.pointModuleId = moduleId; this.points = points },
    async refreshLatest() {},
    clearHistory() { this.history = null },
    async loadHistory(query, options) { calls.push({ query, signal: options.signal }); this.history = { requested: query, points: [] } },
    clear() {},
  })
  const context = vm.createContext({ console, Date: Clock, AbortController, AbortSignal, window: { setInterval: () => 1, clearInterval: () => {} } })
  const dependencies = {
    vue,
    'lucide-vue-next': Object.fromEntries(['Activity', 'Database', 'Fan', 'RefreshCcw', 'Search', 'Server'].map((key) => [key, {}])),
    '../services/api': { api: { getMonitorDevices: async () => [] } },
    '../stores/telemetry': { useTelemetryStore: () => telemetry },
    '../charts/telemetry': charts,
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

test('history entry and point changes automatically query the preceding ten minutes', async (t) => {
  const { app, state, calls } = await mountMonitor()
  t.after(() => app.unmount())
  assert.equal(calls.length, 0)
  state.chartMode = 'history'
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].query.pointId, 37)
  assert.equal(calls[0].query.start, '2026-08-28T11:50:00')
  assert.equal(calls[0].query.end, '2026-08-28T12:00:00')
  state.selectedPointId = 38
  await flush()
  assert.equal(calls.length, 2)
  assert.equal(calls[1].query.pointId, 38)
  assert.equal(calls[0].signal.aborted, true)
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
  assert.equal(calls.at(-1).query.start, '2026-08-28T11:55:00')
  assert.equal(calls.at(-1).query.end, '2026-08-28T12:05:00')
})

test('only the live chart remains in the device view, with a history table and loading state', () => {
  assert.equal((descriptor.template.content.match(/<EChart\b/g) || []).length, 1)
  assert.doesNotMatch(source, /historyOption|历史原始数据折线/)
  assert.match(descriptor.template.content, /<TelemetryHistoryList/)
  assert.match(descriptor.template.content, /正在查询历史数据/)
})
