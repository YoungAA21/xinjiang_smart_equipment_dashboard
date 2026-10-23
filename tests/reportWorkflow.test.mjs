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
    '../services/auth.js': { auth: { getUser: () => ({ username: 'test' }) } },
    '../stores/pointConfiguration.js': { presentPoint: point => point },
    '../services/reportArchive.js': {
      ...archive,
      loadReportConfiguration: owner => archive.loadReportConfiguration(owner, disk),
      listReportSnapshots: owner => archive.listReportSnapshots(owner, disk),
      saveReportSnapshot: (owner, value, options) => archive.saveReportSnapshot(owner, value, { ...options, storage: disk }),
      queryReport: async options => {
        calls.push(options)
        if (query) return query(options)
        return { snapshot: { id: archive.reportSelectionId(options.selection), selection: { ...options.selection }, ranges: analysis.reportRanges(options.selection), title: '测试班报', scope: '温度', html: '<html>查询结果</html>' }, report: { rows: [], ranges: analysis.reportRanges(options.selection) } }
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


test('inline configuration never navigates or queries and saving it cancels stale work', async t => {
  let resolve
  const page = await mountReport({ query: () => new Promise(done => { resolve = done }) })
  t.after(() => page.app.unmount())
  page.state.toggleSettings()
  assert.equal(page.state.settingsOpen, true)
  assert.equal(page.state.settingsLoaded, true)
  assert.equal(page.calls.length, 0)
  page.state.snapshot = { id: 'old', selection: { ...page.state.selection }, html: 'old scope' }
  const pending = page.state.readReport()
  page.state.configurationSaved({ comparison: 'same' })
  assert.equal(page.calls[0].signal.aborted, true)
  assert.equal(page.state.settingsOpen, false)
  assert.equal(page.state.selection.comparison, 'same')
  assert.equal(page.state.changed, true)
  resolve({ snapshot: { selection: { ...page.state.selection }, html: 'stale scope' }, report: { rows: [] } })
  await pending
  assert.equal(page.state.snapshot.html, 'old scope')
  page.state.save()
  assert.equal(archive.listReportSnapshots('test', page.disk).length, 0)
})


test('unsaved inline configuration blocks querying until explicitly saved', async t => {
  const page = await mountReport()
  t.after(() => page.app.unmount())
  page.state.configurationEdited()
  await page.state.readReport()
  assert.equal(page.calls.length, 0)
  assert.equal(page.state.settingsOpen, true)
  assert.match(page.state.error, /先保存报告配置/)
  page.state.configurationSaved({ comparison: 'same' })
  await page.state.readReport()
  assert.equal(page.calls.length, 1)
  assert.equal(page.state.configurationDirty, false)
})
