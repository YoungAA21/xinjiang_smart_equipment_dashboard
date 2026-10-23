import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { createBaseConfig } from '../vite.config.build.js'

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections() })

test('real development proxy forwards future endpoints, JSON writes, upstream 404s and isolated credentials', async t => {
  const received = []
  const backend = name => createHttpServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const item = { name, url: request.url, method: request.method, authorization: request.headers.authorization || '', cookie: request.headers.cookie || '', body }
    received.push(item)
    response.statusCode = request.url.includes('not-found') ? 404 : 200
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(item))
  })
  const collection = backend('collection'), acoustic = backend('acoustic')
  const collectionOrigin = await listen(collection), acousticOrigin = await listen(acoustic)
  t.after(() => Promise.all([close(collection), close(acoustic)]))
  const config = createBaseConfig({ mode: 'development' })
  for (const [pattern, options] of Object.entries(config.server.proxy)) options.target = pattern.startsWith('^/_') ? collectionOrigin : acousticOrigin
  const vite = await createViteServer({ ...config, configFile: false, appType: 'custom', server: { ...config.server, middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } })
  t.after(() => vite.close())
  const front = createHttpServer(vite.middlewares)
  const origin = await listen(front)
  t.after(() => close(front))
  const headers = { Authorization: 'Bearer local-test', Cookie: 'local-test=value' }
  for (const prefix of ['telemetry', 'health', 'alarm', 'analysis', 'runtime', 'configuration']) {
    const suffix = '/api/future/report.json?count=2&name=%E7%9B%91%E6%B5%8B'
    const response = await fetch(`${origin}/_${prefix}-api${suffix}`, { headers })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { name: 'collection', url: suffix, method: 'GET', authorization: '', cookie: '', body: '' })
  }
  for (const method of ['PUT', 'PATCH', 'POST', 'DELETE']) {
    const body = JSON.stringify({ value: 0, label: '监测参数' })
    const response = await fetch(`${origin}/_configuration-api/api/future/configuration`, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body })
    const result = await response.json()
    assert.equal(result.name, 'collection')
    assert.equal(result.method, method)
    assert.equal(result.body, body)
    assert.equal(result.authorization, '')
    assert.equal(result.cookie, '')
  }
  const missing = await fetch(`${origin}/_runtime-api/api/future/not-found`)
  assert.equal(missing.status, 404)
  assert.match(missing.headers.get('content-type'), /application\/json/)
  const sound = await (await fetch(`${origin}/monitor/future`, { headers })).json()
  assert.equal(sound.name, 'acoustic')
  assert.equal(sound.url, '/monitor/future')
  assert.equal(sound.authorization, headers.Authorization)
  assert.equal(sound.cookie, headers.Cookie)
  const count = received.length
  assert.equal((await fetch(`${origin}/_runtime-apix/api/future`)).status, 404)
  assert.equal(received.length, count)
})
