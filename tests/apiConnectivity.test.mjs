import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import http from 'node:http'
import { createServer } from 'vite'
import { createBaseConfig } from '../vite.config.build.js'
import { probeTcp } from '../scripts/check-api.mjs'

test('connectivity check detects a listening port without sending HTTP requests', async () => {
  let bytes = 0
  const server = net.createServer(socket => socket.on('data', data => { bytes += data.length }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal(await probeTcp(address), 'connected')
    assert.equal(bytes, 0)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('Vite forwards login and collection to separate backends, strips only collection credentials and preserves query strings', async () => {
  const received = []
  const backend = name => http.createServer((request, response) => {
    received.push({ name, url: request.url, method: request.method, headers: request.headers })
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ name }))
  })
  const collection = backend('collection'), acoustic = backend('acoustic')
  let vite
  try {
    await Promise.all([collection, acoustic].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))))
    const config = createBaseConfig({ mode: 'development' })
    for (const [pattern, options] of Object.entries(config.server.proxy)) {
      options.target = `http://127.0.0.1:${(pattern.startsWith('^/_') ? collection : acoustic).address().port}`
    }
    vite = await createServer({ ...config, configFile: false, server: { ...config.server, host: '127.0.0.1', port: 0, watch: null } })
    await vite.listen()
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
    const headers = { Authorization: 'Bearer test-token', Cookie: 'test-session=token' }
    const latest = await fetch(`${origin}/_telemetry-api/api/realtime/latest?test=1`, { headers })
    assert.deepEqual(await latest.json(), { name: 'collection' })
    const login = await fetch(`${origin}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=fixture&password=fixture' })
    assert.deepEqual(await login.json(), { name: 'acoustic' })
    const monitor = await fetch(`${origin}/monitor/devices`, { headers })
    await monitor.json()
    assert.equal(received[0].url, '/api/realtime/latest?test=1')
    assert.equal(received[0].headers.authorization, undefined)
    assert.equal(received[0].headers.cookie, undefined)
    assert.equal(received[1].url, '/auth/login')
    assert.equal(received[1].method, 'POST')
    assert.equal(received[1].headers.authorization, undefined)
    assert.equal(received[2].headers.authorization, 'Bearer test-token')
  } finally {
    await vite?.close()
    await Promise.all([collection, acoustic].map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })))
  }
})
