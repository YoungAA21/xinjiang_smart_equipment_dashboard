import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as information from '../src/services/information.js'

const expired = '用户token已失效，请重新登录'

test('recording failures from devices, list, details and visualization go to the shared message log', async () => {
  information.clearInformation()
  const source = await readFile(new URL('../src/views/RecordingManagementPage.vue', import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: 'recording-information-test' })
  const context = vm.createContext({ console, Date })
  const module = new vm.SourceTextModule(compiled.content, { context })
  await module.link(specifier => {
    let exports
    if (specifier === 'vue') exports = { ...vue, onMounted() {} }
    else if (specifier.endsWith('.vue')) exports = { default: {} }
    else if (specifier === '../services/information.js') exports = information
    else if (specifier === '../services/api') exports = { api: new Proxy({}, { get: () => async () => { throw new Error(expired) } }) }
    else if (specifier === '../charts/machineGroups.js') exports = { acousticChannelDisplayName: () => '' }
    else if (specifier === 'lucide-vue-next') exports = Object.fromEntries(['Database','Download','FileAudio','RefreshCcw','Search','SlidersHorizontal','Waves'].map(name => [name, {}]))
    assert.ok(exports, specifier)
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  const state = module.namespace.default.setup({}, { expose() {} })
  await state.loadMonitorDevices()
  await state.loadRecordings()
  await state.selectRecording({ id: 'test-recording' })
  await state.loadVisualization()
  const rows = information.informationMessages()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, '录音管理')
  assert.equal(rows[0].message, expired)
  assert.equal(rows[0].count, 4)
  information.clearInformation()
})

test('pages no longer use global error popups and monitor headers do not print raw service errors', async () => {
  const root = new URL('../src/views/', import.meta.url)
  for (const name of await readdir(root)) {
    if (!name.endsWith('.vue')) continue
    const source = await readFile(new URL(name, root), 'utf8')
    assert.doesNotMatch(source, /ElMessage\.(?:error|warning)|ElNotification|ElMessageBox/, name)
  }
  for (const name of ['DeviceMonitorPage', 'MachineMonitorPage', 'MachineOverviewPage']) {
    const source = await readFile(new URL(`${name}.vue`, root), 'utf8')
    const template = parse(source).descriptor.template.content
    assert.doesNotMatch(template, /\{\{[^}]*monitor\.error/, name)
  }
})

test('new messages shake the button, opening acknowledges them and clearing resets the indicator', async () => {
  information.clearInformation()
  const source = await readFile(new URL('../src/components/InformationBar.vue', import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: 'information-notification-test' })
  let cleanup, shakes = 0, reduceMotion = false
  const context = vm.createContext({ Date, window: {
    innerWidth: 1200, innerHeight: 800,
    matchMedia: () => ({ matches: reduceMotion }), removeEventListener() {},
  }, document: { removeEventListener() {} } })
  const module = new vm.SourceTextModule(compiled.content, { context })
  await module.link(specifier => {
    const exports = specifier === 'vue' ? { ...vue, onMounted() {}, onBeforeUnmount(callback) { cleanup = callback } }
      : specifier === 'lucide-vue-next' ? { MessageSquare: {} } : information
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  const state = module.namespace.default.setup({ collapsed: false }, { expose() {} })
  try {
    state.trigger.value = { animate() { shakes++ }, getBoundingClientRect() { return { right: 60, bottom: 750 } } }
    information.reportInformation('参数配置', expired)
    assert.equal(state.unread.value, true)
    assert.equal(shakes, 1)
    information.reportInformation('参数配置', expired)
    assert.equal(shakes, 2, 'repeated rows with increased counts still notify')
    state.toggle()
    assert.equal(state.expanded.value, true)
    assert.equal(state.unread.value, false)
    information.reportInformation('声纹连接', '连接异常')
    assert.equal(shakes, 2, 'do not shake while the messages are being read')
    state.toggle()
    reduceMotion = true
    information.reportInformation('声纹连接', '连接异常')
    assert.equal(state.unread.value, true)
    assert.equal(shakes, 2, 'reduced motion keeps the visual badge without shaking')
    information.clearInformation()
    assert.equal(state.unread.value, false)
    assert.equal(state.messages.value.length, 0)
  } finally { cleanup(); information.clearInformation() }
})
