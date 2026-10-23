import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as archive from '../src/services/reportArchive.js'
import * as analysis from '../src/charts/reportAnalysis.js'

const flush = async () => { for (let i = 0; i < 5; i++) await vue.nextTick() }
const storage = () => {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}
async function mountReport({ query, routeQuery = {}, disk = storage() } = {}) {
  const calls = [], route = vue.reactive({ query: routeQuery })
  const dependencies = {
    vue,
    'vue-router': { useRoute: () => route, useRouter: () => ({ replace: value => { route.query = value.query || {} }, push() {} }) },
    'lucide-vue-next': Object.fromEntries(['ArrowDownToLine', 'ChevronLeft', 'FileText', 'Search', 'Save', 'Settings2'].map(name => [name, {}])),
    '../charts/reportAnalysis.js': analysis,
    '../services/reports.js': { loadReportCatalog: async () => ({ modules: [], points: [], errors: [] }) },
    '../services/auth.js': { auth: { getUser: () => ({ username: 'test' }) } },
    '../stores/pointConfiguration.js': { presentPoint: point => point },
    '../services/reportArchive.js': {
      ...archive,
      saveReportConfiguration: (owner, value) => archive.saveReportConfiguration(owner, value, disk),
      loadReportConfiguration: owner => archive.loadReportConfiguration(owner, disk),
      listReportSnapshots: owner => archive.listReportSnapshots(owner, disk),
      saveReportSnapshot: (owner, value, options) => archive.saveReportSnapshot(owner, value, { ...options, storage: disk }),
      queryReport: async options => {
        calls.push(options)
        if (query) return query(options)
        return { snapshot: { id: archive.reportSelectionId(options.selection), selection: { ...options.selection }, configuration: { ...options.configuration, metrics: [...options.configuration.metrics] }, ranges: analysis.reportRanges(options.selection), title: '测试班报', scope: '温度', html: '<html>查询结果</html>' }, report: { rows: [], ranges: analysis.reportRanges(options.selection) } }
      },
    },
  }
  const compiled = compileScript(parse(await readFile(new URL('../src/views/EquipmentReportPage.vue', import.meta.url), 'utf8')).descriptor, { id: 'report-workflow' })
  const context = vm.createContext({ console, Date, AbortController, AbortSignal })
  const module = new vm.SourceTextModule(compiled.content, { context })
  await module.link(specifier => {
    const exports = specifier.endsWith('.vue') ? { default: {} } : specifier.endsWith('.css') ? {} : dependencies[specifier]
    assert.ok(exports, specifier)
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const component = module.namespace.default
  component.render = () => vue.h('div')
  const app = renderer.createApp(component)
  app.provide('isLightTheme', vue.ref(false))
  const instance = app.mount({})
  await flush()
  return { app, state: instance.$.setupState, calls, route, disk }
}

test('entering report view and changing controls never queries; explicit query does not save', async t => {
  const { app, state, calls, disk } = await mountReport()
  t.after(() => app.unmount())
  assert.equal(calls.length, 0)
  state.selection = { mode: 'shift', date: '2026-09-01', shift: 'day', comparison: 'same' }
  await flush()
  assert.equal(calls.length, 0)
  await state.readReport()
  assert.equal(calls.length, 1)
  assert.equal(state.saved, false)
  assert.equal(archive.listReportSnapshots('test', disk).length, 0)
  state.save()
  assert.equal(state.saved, true)
  assert.equal(archive.listReportSnapshots('test', disk).length, 1)
  await state.readReport()
  assert.equal(calls.length, 2)
  assert.equal(state.saved, false)
  assert.equal(archive.listReportSnapshots('test', disk).length, 1)
})

test('changing controls cancels requests and ignores late results without losing displayed report', async t => {
  const pending = []
  const { app, state, calls } = await mountReport({ query: options => new Promise(resolve => pending.push({ resolve, selection: { ...options.selection } })) })
  t.after(() => app.unmount())
  const first = state.readReport()
  state.selection.date = '2026-09-01'
  pending[0].resolve({ snapshot: { selection: pending[0].selection }, report: { rows: [] } })
  await first
  assert.equal(calls[0].signal.aborted, true)
  assert.equal(state.snapshot, null)
  const old = { selection: { ...state.selection }, id: 'displayed', html: 'previous' }
  state.snapshot = old
  const second = state.readReport()
  assert.equal(state.snapshot.html, 'previous')
  state.cancel()
  pending[1].resolve({ snapshot: { selection: pending[1].selection, html: 'late' }, report: { rows: [] } })
  await second
  assert.equal(state.snapshot.html, 'previous')
  state.selection.shift = old.selection.shift === 'day' ? 'night' : 'day'
  assert.equal(state.changed, true)
  state.save()
  assert.equal(state.saved, false)
})

test('opening an archived link only reads its saved HTML; missing links never generate data', async t => {
  const disk = storage()
  const selection = { mode: 'shift', date: '2026-09-01', shift: 'night', comparison: 'same' }
  const item = { id: archive.reportSelectionId(selection), selection, ranges: analysis.reportRanges(selection), html: 'fixed archive' }
  archive.saveReportSnapshot('test', item, { storage: disk })
  const page = await mountReport({ disk, routeQuery: { report: item.id } })
  t.after(() => page.app.unmount())
  assert.equal(page.calls.length, 0)
  assert.equal(page.state.snapshot.html, 'fixed archive')
  assert.equal(page.state.saved, true)
  assert.equal(page.state.preview, null)
  page.state.openArchived('missing')
  assert.equal(page.calls.length, 0)
  assert.match(page.state.error, /未找到/)
})

test('query failures keep previous content and saving failures leave a downloadable unsaved result', async t => {
  const disk = { getItem: () => null, setItem: () => { throw new Error('full') } }
  const page = await mountReport({ disk })
  t.after(() => page.app.unmount())
  await page.state.readReport()
  page.state.save()
  assert.match(page.state.error, /保存失败/)
  assert.equal(page.state.saved, false)
  assert.ok(page.state.snapshot.html)
  const failed = await mountReport({ query: async () => { throw new Error('HTTP 500') } })
  t.after(() => failed.app.unmount())
  failed.state.snapshot = { html: 'previous', selection: { ...failed.state.selection } }
  await failed.state.readReport()
  assert.match(failed.state.error, /HTTP 500/)
  assert.equal(failed.state.snapshot.html, 'previous')
})


test('editing the unified scope applies directly without saving preferences or querying automatically', async t => {
  const page = await mountReport()
  t.after(() => page.app.unmount())
  page.state.configuration.moduleId = 'B'
  page.state.configuration.metrics = ['pressure']
  page.state.selection.comparison = 'same'
  assert.equal(page.calls.length, 0)
  await page.state.readReport()
  assert.equal(page.calls.length, 1)
  assert.equal(page.calls[0].configuration.moduleId, 'B')
  assert.deepEqual([...page.calls[0].configuration.metrics], ['pressure'])
  assert.equal(page.calls[0].selection.comparison, 'same')
  assert.equal(page.state.changed, false)
  assert.equal(archive.loadReportConfiguration('test', page.disk).moduleId, '')
  page.state.rememberFilters()
  assert.equal(page.state.remembered, true)
  assert.equal(archive.loadReportConfiguration('test', page.disk).moduleId, 'B')
  assert.equal(page.calls.length, 1)
  page.state.configuration.metrics = ['temperature']
  assert.equal(page.state.changed, true)
  assert.equal(page.state.remembered, false)
})

test('scope changes cancel pending results and query captures an immutable filter snapshot', async t => {
  let resolve
  const page = await mountReport({ query: () => new Promise(done => { resolve = done }) })
  t.after(() => page.app.unmount())
  const pending = page.state.readReport()
  page.state.configuration.metrics.splice(0, 1)
  assert.equal(page.calls[0].signal.aborted, true)
  assert.equal(page.calls[0].configuration.metrics.length, 3)
  resolve({ snapshot: { html: 'stale' }, report: { rows: [] } })
  await pending
  assert.equal(page.state.snapshot, null)
  page.state.configuration.metrics = []
  await page.state.readReport()
  assert.equal(page.calls.length, 1)
  assert.match(page.state.error, /至少选择/)
})

test('opening an archive restores its scope without changing remembered defaults', async t => {
  const page = await mountReport()
  t.after(() => page.app.unmount())
  const selection = { mode: 'shift', date: '2026-09-01', shift: 'night', comparison: 'same' }
  page.state.snapshots = [{ id: 'archived', selection, configuration: { moduleId: 'B', metrics: ['pressure'], comparison: 'same' }, ranges: analysis.reportRanges(selection), html: 'fixed' }]
  page.state.openArchived('archived')
  assert.equal(page.state.configuration.moduleId, 'B')
  assert.deepEqual([...page.state.configuration.metrics], ['pressure'])
  assert.equal(page.state.changed, false)
  assert.equal(page.calls.length, 0)
  assert.equal(archive.loadReportConfiguration('test', page.disk).moduleId, '')
})


test('repeated query clicks share the active request and metadata is supplied to the query', async t => {
  let resolve
  const page = await mountReport({ query: () => new Promise(done => { resolve = done }) })
  t.after(() => page.app.unmount())
  const pending = page.state.readReport()
  await page.state.readReport()
  assert.equal(page.calls.length, 1)
  assert.equal(page.calls[0].signal.aborted, false)
  assert.ok(page.calls[0].catalog)
  page.calls[0].onStage('aggregate')
  assert.equal(page.state.queryStage, 'aggregate')
  resolve({ snapshot: { selection: { ...page.state.selection }, html: 'done' }, report: { rows: [] } })
  await pending
  assert.equal(page.state.loading, false)
})

test('directory timeouts have a readable stage-specific message and remain retryable', async t => {
  const page = await mountReport({ query: async () => { throw new DOMException('signal timed out', 'TimeoutError') } })
  t.after(() => page.app.unmount())
  await page.state.readReport()
  assert.match(page.state.error, /测点目录读取超时/)
  assert.doesNotMatch(page.state.error, /signal/)
  assert.equal(page.state.loading, false)
  await page.state.readReport()
  assert.equal(page.calls.length, 2)
})
