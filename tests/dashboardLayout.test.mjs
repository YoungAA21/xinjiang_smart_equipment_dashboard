import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as layout from '../src/charts/dashboardLayout.js'
import { normalizeLayout, reconcileLayout, updateLayout, moveLayout, layoutStorageKey } from '../src/charts/dashboardLayout.js'

const items = [{ id: 'a', title: '温度' }, { id: 'b', title: '振动' }]

test('layout validates stored data and clamps unsafe sizes', () => {
  assert.equal(normalizeLayout({ version: 2, items: [] }), null)
  assert.equal(normalizeLayout({ version: 1, items: {} }), null)
  const saved = normalizeLayout({ version: 1, items: [null, { id: 'a', visible: false, span: 50, height: -10 }, { id: 'a' }, { id: 3 }] })
  assert.deepEqual(saved.items, [{ id: 'a', visible: false, span: 4, height: 180 }])
})

test('layout retains missing cards and appends newly discovered cards', () => {
  const initial = reconcileLayout(items, null)
  const hidden = updateLayout(null, initial, 'a', { visible: false, span: 2, height: 340 })
  const temporary = reconcileLayout([{ id: 'b' }, { id: 'c' }], hidden)
  const updated = updateLayout(hidden, temporary, 'b', { height: 400 })
  const restored = reconcileLayout([...items, { id: 'c' }], updated)
  assert.equal(restored[0].id, 'a')
  assert.equal(restored[0].visible, false)
  assert.equal(restored[0].span, 2)
  assert.equal(restored[0].height, 340)
  assert.equal(restored[1].height, 400)
  assert.equal(restored[2].visible, true)
  assert.equal(restored[0].title, '温度')
})

test('reordering preserves dimensions and hidden preferences across reloads', () => {
  const hidden = updateLayout(null, reconcileLayout(items, null), 'a', { visible: false })
  const moved = moveLayout(hidden, reconcileLayout(items, hidden), 'b', 'a')
  const reloaded = normalizeLayout(JSON.parse(JSON.stringify(moved)))
  assert.deepEqual(reconcileLayout(items, reloaded).map(item => item.id), ['b', 'a'])
  assert.equal(reloaded.items[1].visible, false)
  assert.deepEqual(moveLayout(reloaded, reconcileLayout(items, reloaded), 'missing', 'a'), reloaded)
})

test('pages, machines and locations have independent storage keys', () => {
  const keys = ['machine-overview:ZJ17', 'machine-overview:ZB25', 'point-location:pressure', 'point-device:VSE01'].map(layoutStorageKey)
  assert.equal(new Set(keys).size, 4)
})

async function mountLayout(storage) {
  const source = await readFile(new URL('../src/components/ConfigurableDashboard.vue', import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: 'layout-test' })
  const context = vm.createContext({ localStorage: storage })
  const module = new vm.SourceTextModule(compiled.content, { context })
  await module.link(specifier => {
    const exports = specifier === 'vue' ? vue : layout
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const component = module.namespace.default
  component.render = () => vue.h('div')
  const scope = vue.ref('machine:A')
  const app = renderer.createApp({ render: () => vue.h(component, { scope: scope.value, items }) })
  const root = app.mount({})
  return { app, scope, state: root.$.subTree.component.proxy.$.setupState }
}

test('switching scope reads independent preferences and reset clears only that scope', async () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const { app, scope, state } = await mountLayout(storage)
  try {
    state.change('a', { visible: false, span: 3 })
    scope.value = 'machine:B'
    await vue.nextTick()
    assert.equal(state.saved, null)
    assert.equal(state.editing, false)
    state.change('b', { height: 400 })
    scope.value = 'machine:A'
    await vue.nextTick()
    assert.equal(state.cards[0].visible, false)
    assert.equal(state.cards[0].span, 3)
    state.reset()
    assert.equal(values.has(layoutStorageKey('machine:A')), false)
    assert.equal(values.has(layoutStorageKey('machine:B')), true)
  } finally { app.unmount() }
})

test('unavailable browser storage keeps layout usable and shows an explicit warning', async () => {
  const { app, state } = await mountLayout({ getItem() { throw new Error('denied') }, setItem() { throw new Error('full') }, removeItem() { throw new Error('denied') } })
  try {
    assert.ok(state.storageError)
    state.change('a', { visible: false })
    assert.equal(state.visibleCards.length, 1)
    assert.ok(state.storageError)
    state.reset()
    assert.equal(state.customized, false)
    assert.equal(state.cards.length, 2)
  } finally { app.unmount() }
})

test('corrected machine ID preserves old browser layout and prefers the new saved layout', () => {
  const previous = { version: 1, items: [{ id: 'point', visible: false, span: 3, height: 400 }] }
  const values = new Map([[layoutStorageKey('machine-overview:ZJ117'), JSON.stringify(previous)]])
  const storage = { getItem: key => values.get(key) ?? null }
  assert.deepEqual(layout.readStoredLayout(storage, 'machine-overview:ZJ17'), previous)
  const current = { version: 1, items: [] }
  values.set(layoutStorageKey('machine-overview:ZJ17'), JSON.stringify(current))
  assert.deepEqual(layout.readStoredLayout(storage, 'machine-overview:ZJ17'), current)
})
