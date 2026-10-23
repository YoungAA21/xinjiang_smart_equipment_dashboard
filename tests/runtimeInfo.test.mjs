import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as vue from 'vue'
import * as endpoints from '../src/services/endpoints.js'

test('production runtime APIs use the shared 5158 prefix route, including future endpoints', async () => {
  const config = await readFile(new URL('../../nginx.conf', import.meta.url), 'utf8')
  const locations = [...config.matchAll(/location ~ (\S+) \{([\s\S]*?)\n        \}/g)]
  const entry = locations.find(([, pattern]) => new RegExp(pattern).test('/_runtime-api/api/runtime-info/latest'))
  assert.ok(entry)
  const [, pattern, route] = entry
  assert.match(route, /proxy_pass http:\/\/127\.0\.0\.1:5158;/)
  assert.ok(route.includes('rewrite ^/_[^/]+(/.*)$ $1 break;'))
  assert.match(route, /proxy_set_header Authorization "";/)
  assert.match(route, /proxy_set_header Cookie "";/)
  assert.match(route, /proxy_cache off;/)
  assert.doesNotMatch(route, /limit_except|try_files/)
  assert.equal(new RegExp(pattern).test('/_runtime-api/api/runtime-info/future'), true)
  assert.equal(new RegExp(pattern).test('/_runtime-apix/api/runtime-info/latest'), false)
  assert.ok(config.indexOf(entry[0]) < config.indexOf('location / {', config.indexOf('listen 80;')))
})

async function load(file, dependencies, globals = {}) {
  const context = vm.createContext({ AbortController, AbortSignal, ...globals })
  const module = new vm.SourceTextModule(await readFile(new URL(file, import.meta.url), 'utf8'), { context })
  await module.link(name => {
    const values = dependencies[name]
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  return module.namespace
}

test('runtime transport uses collection proxy without credentials or authentication', async () => {
  let request
  const api = await load('../src/services/runtimeInfo.js', { './endpoints.js': endpoints }, {
    fetch: async (url, options) => {
      request = { url, options }
      return { ok: true, json: async () => ({ status: 'Online', summary: { checkCount: 0, checkNg: 0, ngP: 0 } }) }
    },
  })
  const result = await api.getRuntimeInfo()
  assert.equal(request.url, '/_runtime-api/api/runtime-info/latest')
  assert.equal(request.options.credentials, 'omit')
  assert.equal(request.options.headers.Authorization, undefined)
  assert.equal(result.summary.ngP, 0)
})

test('home polls every second, skips overlap, retains failed data and cancels late responses', async () => {
  let mounted, unmounted, tick, resolveRequest, rejectRequest, signal, calls = 0, cleared
  const api = await load('../src/composables/useRuntimeInfo.js', {
    vue: { ...vue, onMounted: fn => { mounted = fn }, onBeforeUnmount: fn => { unmounted = fn } },
    '../services/runtimeInfo.js': { getRuntimeInfo: options => {
      calls++
      signal = options.signal
      return new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject })
    } },
  }, { window: { setInterval(fn, delay) { tick = fn; assert.equal(delay, 1000); return 7 }, clearInterval(id) { cleared = id } } })
  const state = api.useRuntimeInfo()
  mounted()
  await tick()
  assert.equal(calls, 1)
  resolveRequest({ status: 'Online', summary: { brand: '红塔山(软经典)', checkCount: 11, checkNg: 11, ngP: 100 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.summary.value.brand, '红塔山(软经典)')
  assert.equal(state.summary.value.ngP, 100)
  const failed = tick()
  rejectRequest(new Error('network failed'))
  await failed
  assert.equal(state.summary.value.checkCount, 11)
  assert.match(state.status.value, /过期/)
  const pending = tick()
  unmounted()
  assert.equal(cleared, 7)
  assert.equal(signal.aborted, true)
  resolveRequest({ status: 'Online', summary: { brand: '过期响应' } })
  await pending
  assert.equal(state.summary.value.brand, '红塔山(软经典)')
  await tick()
  assert.equal(calls, 3)
})
