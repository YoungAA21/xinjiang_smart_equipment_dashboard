import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as groups from '../src/charts/machineGroups.js'
import * as catalog from '../src/charts/equipmentCatalog.js'
import * as gateways from '../src/charts/gatewayCatalog.js'

test('module overview refreshes only collection modules and excludes acoustic rows from counts and filters', async () => {
  let requests = 0
  let fail = false
  const source = await readFile(new URL('../src/components/GatewayModuleOverview.vue', import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: 'gateway-overview-test' })
  const dependencies = {
    vue,
    'element-plus': { ElDrawer: {} },
    '../services/telemetry': { telemetryApi: { async getModules() {
      requests++
      if (fail) throw new Error('timeout')
      return { modules: [{ moduleId: 'VSE03', runtimeStatus: { isOnline: true } }, { moduleId: 'UNKNOWN', runtimeStatus: { isOnline: false } }, { moduleId: 'SOUND', protocol: 'Acoustic', runtimeStatus: { isOnline: true } }] }
    } } },
    '../charts/machineGroups.js': groups,
    '../charts/equipmentCatalog.js': catalog,
    '../charts/gatewayCatalog.js': gateways,
  }
  const context = vm.createContext({ console, Date, AbortController, AbortSignal, window: { setInterval: () => 1, clearInterval() {} } })
  const module = new vm.SourceTextModule(compiled.content, { context })
  await module.link(specifier => {
    const exports = dependencies[specifier]
    assert.ok(exports, `Unexpected dependency: ${specifier}`)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const component = module.namespace.default
  component.render = () => vue.h('div')
  const app = renderer.createApp(component)
  const instance = app.mount({})
  const state = instance.$.setupState
  try {
    for (let i = 0; i < 5; i++) await vue.nextTick()
    const expectedTotal = gateways.gatewayCatalog.filter(row => row.source === 'legacy').length + 1
    assert.equal(requests, 1)
    assert.ok(state.rows.every(row => row.source === 'legacy'))
    assert.equal(state.counts.total, expectedTotal)
    assert.equal(state.counts.online, 1)
    assert.equal(state.counts.offline, 1)
    assert.ok(state.rows.some(row => row.key === 'legacy:UNKNOWN'))
    state.search = '声纹'
    assert.equal(state.visible.length, 0)
    fail = true
    await instance.refresh()
    assert.equal(requests, 2)
    assert.equal(instance.loading, false)
    assert.equal(state.counts.total, expectedTotal)
    assert.equal(state.counts.online, 0)
    assert.equal(state.errors.modules, 'timeout')
  } finally {
    app.unmount()
  }
})
