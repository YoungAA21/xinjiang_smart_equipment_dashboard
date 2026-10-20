import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as presentation from '../src/charts/gradedAlarms.js'
import * as alarmFormatting from '../src/charts/alarms.js'

const flush = async () => { for (let i = 0; i < 8; i++) await vue.nextTick() }

async function mountPanel(t, initialize = () => Promise.resolve()) {
  let tick, interval, cleared = false, queries = 0
  const document = { visibilityState: 'visible' }
  const query = {
    scope: vue.reactive({}), filters: vue.reactive({ isActive: '', range: [], limit: 200 }),
    options: vue.computed(() => ({})), points: vue.ref([]), rows: vue.ref([]),
    requested: vue.ref(null), updatedAt: vue.ref(null), error: vue.ref(''), loading: vue.ref(false),
    metadataError: vue.ref(''), metadataLoading: vue.ref(false),
    async query() { queries++; query.loading.value = true },
    initialize() { query.requested.value = { isActive: query.filters.isActive }; return initialize(query) },
    async reset() { query.filters.isActive = ''; query.filters.range = [] },
    applyInitial() {}, changeScope() {},
  }
  const dependencies = {
    vue, 'element-plus': { ElDialog: {} }, 'lucide-vue-next': { Eye: {}, RefreshCcw: {}, RotateCcw: {}, Search: {} },
    '../composables/usePointAlarmQuery.js': { usePointAlarmQuery: () => query },
    '../services/alarms.js': { alarmApi: { getAlarms() {} } },
    '../charts/alarms.js': alarmFormatting, '../charts/gradedAlarms.js': presentation,
  }
  const context = vm.createContext({ document, window: {
    setInterval(callback, duration) { tick = callback; interval = duration; return 1 },
    clearInterval(id) { cleared = id === 1 },
  } })
  const { descriptor } = parse(await readFile(new URL('../src/components/LegacyAlarmPanel.vue', import.meta.url), 'utf8'))
  const module = new vm.SourceTextModule(compileScript(descriptor, { id: 'graded-panel-test' }).content, { context })
  await module.link(specifier => {
    const exports = specifier.endsWith('.vue') ? { default: {} } : dependencies[specifier]
    assert.ok(exports, specifier)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const component = module.namespace.default
  component.render = () => vue.h('div')
  const props = vue.reactive({ active: true })
  let instance
  const app = renderer.createApp({ render: () => vue.h(component, { ...props, ref: value => { instance = value } }) })
  app.mount({})
  let unmounted = false
  const unmount = () => { if (!unmounted) { unmounted = true; app.unmount() } }
  t.after(unmount)
  await flush()
  return { query, props, document, unmount, state: instance.$.setupState, tick: () => tick(),
    interval: () => interval, queries: () => queries, cleared: () => cleared }
}

test('active alarms refresh every three seconds without overlapping; history, hidden tabs and details pause polling', async t => {
  const panel = await mountPanel(t)
  assert.equal(panel.query.filters.isActive, 'true')
  assert.equal(panel.interval(), 3000)
  assert.equal(panel.state.initialLoading, false)
  panel.tick()
  assert.equal(panel.state.initialLoading, false, 'polling must not show an initial-load overlay')
  assert.equal(panel.queries(), 1)
  panel.tick()
  assert.equal(panel.queries(), 1, 'an in-flight query must not be cancelled by the next tick')
  panel.query.loading.value = false
  panel.query.filters.isActive = 'false'
  panel.tick()
  panel.query.filters.isActive = 'true'
  panel.query.filters.range = ['2026-10-19', '2026-10-20']
  panel.tick()
  panel.query.filters.range = []
  panel.props.active = false
  await flush()
  panel.tick()
  panel.props.active = true
  await flush()
  panel.document.visibilityState = 'hidden'
  panel.tick()
  panel.document.visibilityState = 'visible'
  panel.state.detailOpen = true
  panel.tick()
  assert.equal(panel.queries(), 1)
  panel.state.detailOpen = false
  panel.tick()
  assert.equal(panel.queries(), 2)
  panel.unmount()
  assert.equal(panel.cleared(), true)
})

test('first alarm load exits even when metadata fails and subsequent queries never reopen it', async t => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const panel = await mountPanel(t, async query => {
    await pending
    query.metadataError.value = 'HTTP 503'
  })
  assert.equal(panel.state.initialLoading, true)
  finish()
  await flush()
  assert.equal(panel.state.initialLoading, false)
  assert.equal(panel.query.metadataError.value, 'HTTP 503')
  panel.query.loading.value = true
  panel.query.rows.value = null
  await flush()
  assert.equal(panel.state.initialLoading, false)
})

test('local severity filters preserve separate IDs through a grade transition and keep the page in bounds', async t => {
  const panel = await mountPanel(t)
  const rows = [
    { alarmId: 101, alarmKey: 'GradedLimit', severity: 2, status: 'Recovered' },
    { alarmId: 102, alarmKey: 'GradedLimit', severity: 1, status: 'Active' },
    { alarmId: 103, alarmKey: 'Composite:DI', severity: null, status: 'Active' },
  ]
  panel.query.rows.value = rows
  await flush()
  assert.equal(panel.state.filteredRows.length, 3)
  panel.state.displayFilters.severity = '1'
  await flush()
  assert.deepEqual(panel.state.rows.map(row => row.alarmId), [102])
  assert.equal(panel.state.severityCards.find(card => card.value === '').count, 3)
  assert.equal(panel.state.severityCards.find(card => card.value === '1').count, 1)
  assert.equal(panel.state.severityCards.find(card => card.value === '2').count, 1)
  panel.query.rows.value = [{ ...rows[1], status: 'Recovered' }, { ...rows[0], alarmId: 104, status: 'Active' }]
  await flush()
  assert.equal(panel.state.severityCards.find(card => card.value === '1').count, 1)
  assert.equal(panel.state.severityCards.find(card => card.value === '2').count, 1)
  assert.equal(panel.state.rows[0].alarmId, 102, 'history filters must retain the recovered higher level')
  panel.state.displayFilters.severity = '2'
  await flush()
  assert.equal(panel.state.rows[0].alarmId, 104)
  assert.equal(panel.state.page, 1)
})

test('severity cards partition all returned alarms, including legacy and unknown grades, and filter the same rows they count', async t => {
  const panel = await mountPanel(t)
  const damage = Array.from({ length: 4 }, (_, i) => ({ alarmId: i + 1, alarmKey: 'GradedLimit', severity: 1, status: 'Active' }))
  const legacy = Array.from({ length: 4 }, (_, i) => ({ alarmId: i + 5, alarmKey: '', severity: null, levelName: null, status: 'Active' }))
  panel.query.rows.value = [...damage, ...legacy]
  await flush()
  assert.deepEqual(Array.from(panel.state.severityCards, card => card.count), [8, 4, 0, 0, 4])
  assert.equal(presentation.alarmLevelText(legacy[0]), '上下限告警')
  for (const card of panel.state.severityCards) {
    panel.state.displayFilters.severity = card.value
    await flush()
    assert.equal(panel.state.filteredRows.length, card.count)
  }
  panel.query.rows.value = [...damage, ...legacy,
    { alarmId: 9, alarmKey: 'GradedLimit', severity: '3', levelName: '提示', status: 'Active' },
    { alarmId: 10, alarmKey: 'GradedLimit', severity: 2, status: 'Recovered' },
    { alarmId: 11, alarmKey: 'GradedLimit', severity: 99, status: 'Active' },
    { alarmId: 12, alarmKey: 'Composite:DI', severity: 1, status: 'Active' },
  ]
  await flush()
  const cards = panel.state.severityCards
  assert.deepEqual(Array.from(cards, card => card.count), [12, 4, 1, 1, 4, 2])
  assert.equal(cards.slice(1).reduce((sum, card) => sum + card.count, 0), cards[0].count)
  panel.state.displayFilters.severity = '3'
  await flush()
  assert.deepEqual(panel.state.rows.map(row => row.alarmId), [9])
})

test('visible status follows the successful query, not unsubmitted filter changes', async t => {
  const panel = await mountPanel(t)
  assert.equal(panel.state.queryStatusLabel, '当前告警')
  panel.query.filters.isActive = ''
  await flush()
  assert.equal(panel.state.queryStatusLabel, '当前告警')
  panel.query.requested.value = { isActive: '', limit: 200, truncated: true }
  await flush()
  assert.equal(panel.state.queryStatusLabel, '全部状态')
  panel.query.filters.isActive = 'false'
  panel.query.error.value = 'HTTP 500'
  await flush()
  assert.equal(panel.state.queryStatusLabel, '全部状态', 'a failed request retains the previous result scope')
  panel.query.requested.value = { isActive: false, limit: 200 }
  await flush()
  assert.equal(panel.state.queryStatusLabel, '已恢复')
})
