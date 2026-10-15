import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as catalog from '../src/charts/equipmentCatalog.js'
import * as groups from '../src/charts/machineGroups.js'
import * as addresses from '../src/charts/pointAddress.js'
import * as analysisCharts from '../src/charts/analysis.js'

const flush = async () => { for (let i = 0; i < 12; i++) await vue.nextTick() }
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

async function mountView(name, props, dependencies) {
  const source = await readFile(new URL(`../src/views/${name}.vue`, import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'device-context-test' })
  const context = vm.createContext({ console, Date, URL, AbortController, AbortSignal })
  const code = new vm.SourceTextModule(compiled.content, { context })
  await code.link((specifier) => {
    const exports = specifier === 'vue' ? vue : specifier.endsWith('.vue') ? { default: {} }
      : specifier.endsWith('.css') ? {} : dependencies[specifier]
        || ({ '../charts/machineGroups.js': groups, '../charts/pointAddress.js': addresses })[specifier]
    assert.ok(exports, `Unexpected dependency: ${specifier}`)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  })
  await code.evaluate()
  const renderer = vue.createRenderer({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {},
    parentNode: () => null, nextSibling: () => null,
  })
  const component = code.namespace.default
  component.render = () => vue.h('div')
  const currentProps = vue.reactive(props)
  let instance
  const app = renderer.createApp({ render: () => vue.h(component, { ...currentProps, ref: (value) => { instance = value } }) })
  app.mount({})
  await flush()
  return { app, props: currentProps, state: instance.$.setupState }
}

const icons = Object.fromEntries(['Activity', 'CalendarRange', 'Gauge', 'RefreshCcw', 'TrendingUp', 'AudioLines', 'CircleStop', 'Headphones'].map((key) => [key, {}]))

test('trend keeps its data and axis range during refresh and ignores same-point metadata replacements', async (t) => {
  const calls = []
  const request = params => {
    const pending = deferred()
    calls.push({ params, pending })
    return pending.promise
  }
  const { app, props, state } = await mountView('TrendPage', { embedded: true, moduleId: 'TEMP02', point: { pointId: 22, name: '温度', unit: '℃' } }, {
    'lucide-vue-next': icons,
    '../services/telemetry.js': { telemetryApi: {} },
    '../services/analysis.js': { analysisApi: { getDailyLimitTrends: request, getTrendInsights: request } },
    '../charts/analysis.js': analysisCharts,
    '../charts/equipmentCatalog.js': catalog,
  })
  t.after(() => app.unmount())
  calls[0].pending.resolve({ days: [{ date: '2026-10-10', averageValue: 15, sampleCount: 10 }] })
  calls[1].pending.resolve({ insight: { recentAverageValue: 15 } })
  await flush()
  state.axisMin = -10
  state.axisMax = 100
  await flush()
  props.point = { pointId: 22, name: '更新后的温度名称', unit: '℃' }
  await flush()
  assert.equal(calls.length, 2)
  assert.equal(state.days.length, 1)
  assert.equal(state.selectedPoint.name, '更新后的温度名称')
  const refresh = state.loadAnalysis()
  assert.equal(state.analysisLoading, true)
  assert.equal(state.days[0].sampleCount, 10)
  assert.equal(state.insight.recentAverageValue, 15)
  calls[2].pending.resolve({ days: [{ date: '2026-10-11', averageValue: 16, sampleCount: 20 }] })
  calls[3].pending.resolve({ insight: { recentAverageValue: 16 } })
  await refresh
  assert.equal(state.days[0].sampleCount, 20)
  assert.equal(state.chartOption.yAxis.min, -10)
  assert.equal(state.chartOption.yAxis.max, 100)
  const failedRefresh = state.loadAnalysis()
  calls[4].pending.reject(new Error('连接失败'))
  calls[5].pending.reject(new Error('连接失败'))
  await failedRefresh
  assert.equal(state.days[0].sampleCount, 20)
  assert.equal(state.insight.recentAverageValue, 16)
  assert.match(state.analysisError, /连接失败/)
  state.axisMin = 110
  await flush()
  assert.match(state.axisError, /小于/)
  assert.equal(state.chartOption.yAxis.min, -10)
  props.point = { pointId: 23, name: '另一点位', unit: 'MPa' }
  await flush()
  assert.equal(state.days.length, 0)
  assert.equal(state.insight, null)
  assert.equal(state.axisMin, null)
  assert.equal(state.axisMax, null)
  assert.equal(state.chartOption.yAxis.min, undefined)
  assert.equal(state.chartOption.yAxis.max, undefined)
  calls[6].pending.resolve({ days: [] })
  calls[7].pending.resolve({ insight: null })
  await flush()
  assert.equal(state.analysisLoading, false)
})

test('embedded trend queries the parent point and ignores a late response after point selection changes', async (t) => {
  const calls = []
  const query = (kind) => (params, options) => {
    const pending = deferred()
    calls.push({ kind, params, signal: options.signal, pending })
    return pending.promise
  }
  const { app, props, state } = await mountView('TrendPage', { embedded: true, moduleId: 'M02', point: { pointId: 22, name: '温度', unit: '℃' } }, {
    'lucide-vue-next': icons,
    '../services/telemetry.js': { telemetryApi: { getModules() { throw new Error('Parent owns device selection') } } },
    '../services/analysis.js': { analysisApi: { getDailyLimitTrends: query('daily'), getTrendInsights: query('insight') } },
    '../charts/analysis.js': analysisCharts,
    '../charts/equipmentCatalog.js': catalog,
  })
  t.after(() => app.unmount())
  assert.equal(calls[0].params.pointId, 22)
  props.point = { pointId: 23, name: '压力', unit: 'MPa' }
  await flush()
  assert.equal(calls[0].signal.aborted, true)
  assert.equal(calls[2].params.pointId, 23)
  calls[2].pending.resolve({ days: [{ date: '2026-10-10', sampleCount: 23 }] })
  calls[3].pending.resolve({ insight: { unit: 'MPa' } })
  await flush()
  calls[0].pending.resolve({ days: [{ date: '2026-10-09', sampleCount: 22 }] })
  calls[1].pending.resolve({ insight: { unit: '℃' } })
  await flush()
  assert.equal(state.days[0].sampleCount, 23)
  assert.equal(state.insight.unit, 'MPa')
})

test('leaving an embedded spectrum panel closes a session that finishes creating after unmount', async () => {
  const pending = deferred()
  const requests = [], closed = []
  const { app, state } = await mountView('SpectrumPage', {
    embedded: true, device: { deviceId: 'DEV2', online: true, channels: [{ channelId: 'CH2', online: true }] }, channelId: 'CH2', displayMode: 'spectrum',
  }, {
    'lucide-vue-next': icons,
    'element-plus': { ElMessage: { error: assert.fail, warning: assert.fail } },
    '../services/api': { api: {
      createMonitorSession: (params) => { requests.push(params); return pending.promise },
      closeMonitorSession: async (id) => { closed.push(id) },
    } },
    '../services/auth': { auth: {} },
  })
  assert.equal(state.audioEnabled, false)
  const starting = state.startSession()
  await flush()
  assert.equal(requests[0].deviceId, 'DEV2')
  assert.deepEqual(Array.from(requests[0].channelIds), ['CH2'])
  app.unmount()
  pending.resolve({ sessionId: 'late-session' })
  await starting
  assert.deepEqual(closed, ['late-session'])
  assert.equal(state.session, null)
})

test('switching acoustic points closes the old session and clears its waveform and counters', async (t) => {
  const closed = []
  const { app, props, state } = await mountView('SpectrumPage', {
    embedded: true, device: { deviceId: 'DEV2', channels: [{ channelId: 'CH1', online: true }, { channelId: 'CH2', online: true }] }, channelId: 'CH1',
  }, {
    'lucide-vue-next': icons,
    'element-plus': { ElMessage: { error: assert.fail, warning: assert.fail } },
    '../services/api': { api: { closeMonitorSession: async (id) => { closed.push(id) } } },
    '../services/auth': { auth: {} },
  })
  t.after(() => app.unmount())
  state.session = { sessionId: 'old-point-session' }
  state.latestFrame = { data: { waveform: [0.1, 0.3, -0.2] } }
  state.waveform = [0.1, 0.3, -0.2]
  state.stats.frames = 12
  props.channelId = 'CH2'
  await flush()
  assert.deepEqual(closed, ['old-point-session'])
  assert.equal(state.selectedChannelId, 'CH2')
  assert.equal(state.session, null)
  assert.equal(state.latestFrame, null)
  assert.equal(state.waveformSamples.length, 0)
  assert.equal(state.stats.frames, 0)
})
