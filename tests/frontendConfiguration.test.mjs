import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyConfiguration, validateConfiguration } from '../src/charts/pointConfiguration.js'
import { frontendConfigurationApi, configurationFileName } from '../src/services/frontendConfiguration.js'

const disk = () => {
  const values = new Map()
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
}
let scenario = 0
const freshStore = () => import(`../src/stores/pointConfiguration.js?configuration-test=${++scenario}`)
const config = name => {
  const value = emptyConfiguration()
  value.targets = [{ id: 'bearing', name, locationId: 've' }]
  return value
}

test('configuration transport uses an encoded fixed filename, raw JSON and isolated collection credentials', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    return new Response(null, { status: 204 })
  })
  assert.equal(await frontendConfigurationApi.read(), null)
  await frontendConfigurationApi.upload(config('上传'))
  assert.equal(requests[0].url, `/_configuration-api/api/frontend-files/${encodeURIComponent(configurationFileName)}`)
  for (const { options } of requests) {
    assert.equal(options.credentials, 'omit')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.headers.Authorization, undefined)
  }
  assert.equal(requests[1].options.method, 'PUT')
  assert.match(requests[1].options.headers['Content-Type'], /application\/json/)
  assert.deepEqual(JSON.parse(requests[1].options.body), config('上传'))
})

test('configuration transport handles BOM, malformed responses and HTTP errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('\uFEFF' + JSON.stringify(config('服务器'))))
  assert.equal((await frontendConfigurationApi.read()).targets[0].name, '服务器')
  globalThis.fetch = async () => new Response('<html>wrong proxy</html>')
  await assert.rejects(frontendConfigurationApi.read(), SyntaxError)
  globalThis.fetch = async () => new Response('bad', { status: 502 })
  await assert.rejects(frontendConfigurationApi.upload(config('上传')), /HTTP 502/)
})

test('initialization is single-flight and applies server configuration before becoming ready', async () => {
  const store = await freshStore(), storage = disk()
  storage.setItem(store.configurationStorageKey, JSON.stringify(config('旧缓存')))
  let finish, requests = 0
  const pending = new Promise(resolve => { finish = resolve })
  const api = { read: () => { requests++; return pending } }
  const first = store.initializePointConfiguration({ api, storage })
  const second = store.initializePointConfiguration({ api, storage })
  assert.equal(first, second)
  assert.equal(store.pointConfiguration.ready, false)
  finish(config('服务器'))
  await first
  assert.equal(requests, 1)
  assert.equal(store.pointConfiguration.ready, true)
  assert.equal(store.pointConfiguration.source, 'server')
  assert.equal(store.pointConfiguration.targets[0].name, '服务器')
  assert.equal(JSON.parse(storage.getItem(store.configurationStorageKey)).targets[0].name, '服务器')
  assert.equal(store.pointConfiguration.dirty, false)
})

for (const kind of ['missing', 'offline', 'invalid']) {
  test(`${kind} server configuration falls back to the validated 49-parameter built-in configuration without uploading`, async () => {
    const store = await freshStore()
    let writes = 0
    const api = { read: async () => {
      if (kind === 'offline') throw new Error('network unavailable')
      return kind === 'invalid' ? { version: 8 } : null
    }, upload: () => { writes++ } }
    await store.initializePointConfiguration({ api, storage: disk() })
    assert.equal(store.pointConfiguration.ready, true)
    assert.equal(store.pointConfiguration.source, 'builtin')
    assert.equal(Object.keys(store.pointConfiguration.parameters).length, 49)
    assert.equal(validateConfiguration(store.configurationSnapshot()).targets.length, 26)
    assert.equal(writes, 0)
    assert.equal(Boolean(store.pointConfiguration.syncError), kind !== 'missing')
  })
}

test('offline startup uses valid cache and invalid cache does not replace built-in configuration', async () => {
  const storage = disk(), store = await freshStore()
  storage.setItem(store.configurationStorageKey, JSON.stringify(config('缓存')))
  await store.initializePointConfiguration({ storage, api: { read: async () => { throw new Error('offline') } } })
  assert.equal(store.pointConfiguration.source, 'cache')
  assert.equal(store.pointConfiguration.targets[0].name, '缓存')
  const next = await freshStore()
  storage.setItem(next.configurationStorageKey, '{invalid')
  await next.initializePointConfiguration({ storage, api: { read: async () => null } })
  assert.equal(Object.keys(next.pointConfiguration.parameters).length, 49)
})

test('local drafts survive reload and are not silently overwritten by the server', async () => {
  const storage = disk(), previous = await freshStore()
  previous.savePointConfiguration(config('待上传'), storage)
  const store = await freshStore()
  await store.initializePointConfiguration({ storage, api: { read: async () => config('服务器') } })
  assert.equal(store.pointConfiguration.targets[0].name, '待上传')
  assert.equal(store.pointConfiguration.dirty, true)
  assert.match(store.pointConfiguration.syncError, /保留本机/)
})

test('upload is single-flight and edits made while uploading remain dirty after success', async () => {
  const store = await freshStore(), storage = disk()
  store.savePointConfiguration(config('第一次修改'), storage)
  let finish, sent, requests = 0
  const api = { upload: value => { requests++; sent = value; return new Promise(resolve => { finish = resolve }) } }
  const first = store.uploadPointConfiguration({ api, storage })
  assert.equal(first, store.uploadPointConfiguration({ api, storage }))
  assert.equal(store.pointConfiguration.uploading, true)
  store.savePointConfiguration(config('上传期间的新修改'), storage)
  finish()
  await first
  assert.equal(requests, 1)
  assert.equal(sent.targets[0].name, '第一次修改')
  assert.equal('localDraft' in sent, false, 'local-only sync flags must not be uploaded')
  assert.equal(store.pointConfiguration.dirty, true)
  assert.equal(store.pointConfiguration.uploading, false)
  assert.ok(store.pointConfiguration.uploadedAt)
  assert.equal(JSON.parse(storage.getItem(store.configurationStorageKey)).targets[0].name, '上传期间的新修改')
  await store.uploadPointConfiguration({ storage, api: { upload: async () => {} } })
  assert.equal(store.pointConfiguration.dirty, false)
  assert.equal(JSON.parse(storage.getItem(store.configurationSyncStorageKey)).dirty, false)
})

test('failed upload preserves local configuration, exits loading and can be retried', async () => {
  const store = await freshStore(), storage = disk()
  store.savePointConfiguration(config('本机'), storage)
  await assert.rejects(store.uploadPointConfiguration({ storage, api: { upload: async () => { throw new Error('HTTP 503') } } }), /503/)
  assert.equal(store.pointConfiguration.dirty, true)
  assert.equal(store.pointConfiguration.uploadedAt, '')
  assert.equal(store.pointConfiguration.uploading, false)
  assert.equal(store.pointConfiguration.targets[0].name, '本机')
  await store.uploadPointConfiguration({ storage, api: { upload: async () => {} } })
  assert.equal(store.pointConfiguration.dirty, false)
})

test('draft marker survives status-cache failure so a reload cannot overwrite pending changes', async () => {
  const values = new Map(), store = await freshStore()
  const storage = { getItem: key => values.get(key) || null, setItem(key, value) {
    if (key === store.configurationSyncStorageKey) throw new Error('status cache unavailable')
    values.set(key, value)
  } }
  store.savePointConfiguration(config('待上传'), storage)
  const next = await freshStore()
  await next.initializePointConfiguration({ storage, api: { read: async () => config('服务器') } })
  assert.equal(next.pointConfiguration.targets[0].name, '待上传')
  assert.equal(next.pointConfiguration.dirty, true)
})

test('configuration saved during a slow initial request is not overwritten by the response', async () => {
  const store = await freshStore(), storage = disk()
  let finish
  const pending = store.initializePointConfiguration({ storage, api: { read: () => new Promise(resolve => { finish = resolve }) } })
  store.savePointConfiguration(config('读取期间修改'), storage)
  finish(config('服务器'))
  await pending
  assert.equal(store.pointConfiguration.ready, true)
  assert.equal(store.pointConfiguration.targets[0].name, '读取期间修改')
  assert.equal(store.pointConfiguration.dirty, true)
})

test('browser cache failure does not discard valid server configuration or report a successful upload as failed', async () => {
  const store = await freshStore()
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  await store.initializePointConfiguration({ storage, api: { read: async () => config('服务器') } })
  assert.equal(store.pointConfiguration.targets[0].name, '服务器')
  assert.equal(store.pointConfiguration.ready, true)
  assert.match(store.pointConfiguration.syncError, /缓存/)
  await store.uploadPointConfiguration({ storage, api: { upload: async () => {} } })
  assert.equal(store.pointConfiguration.dirty, false)
  assert.match(store.pointConfiguration.syncError, /上传成功.*缓存/)
})
