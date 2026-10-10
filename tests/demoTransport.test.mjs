import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveDemoMode } from '../src/services/dataMode.js'
import { createDemoFetch } from '../src/demo/transport.js'

test('local development defaults to demo, remembers the switch, and published builds ignore that preference', () => {
  assert.equal(resolveDemoMode({ development: true }), true)
  assert.equal(resolveDemoMode({ development: true, saved: 'backend' }), false)
  assert.equal(resolveDemoMode({ development: true, configured: 'false', saved: 'demo' }), true)
  assert.equal(resolveDemoMode({ development: true, configured: 'false' }), false)
  assert.equal(resolveDemoMode({ saved: 'demo' }), false)
  assert.equal(resolveDemoMode({ configured: 'false', saved: 'demo' }), false)
  assert.equal(resolveDemoMode({ configured: 'true' }), true)
})

test('demo transport handles proxied reads, JSON sessions and form login without network requests', async () => {
  const fetch = createDemoFetch(() => assert.fail('Business request reached the network'), { baseUrl: 'http://localhost:5173/', delayMs: 0 })
  const points = await (await fetch('/_telemetry-api/api/configuration/modules/M01/points')).json()
  assert.equal(points.moduleId, 'M01')
  assert.equal(points.points.length, 4)
  const session = await (await fetch(new Request('http://localhost/monitor/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: 'DEV2', channelIds: ['MIC2'] }),
  }))).json()
  assert.equal(session.data.sessionId, 'demo-DEV2-MIC2')
  const login = await (await fetch('/auth/login', { method: 'POST', body: new URLSearchParams({ username: 'demo', password: 'demo' }) })).json()
  assert.equal(login.data.token, 'offline-demo')
})

test('unsupported business endpoints stay local; static assets retain their original transport', async () => {
  const paths = []
  const fetch = createDemoFetch(async (url) => { paths.push(String(url)); return new Response('asset') }, { baseUrl: 'http://localhost/', delayMs: 0 })
  assert.equal((await fetch('/api/not-implemented')).status, 404)
  assert.equal((await fetch('/monitor/not-implemented')).status, 404)
  assert.deepEqual(paths, [])
  assert.equal(await (await fetch('/demo-audio.wav')).text(), 'asset')
  assert.deepEqual(paths, ['/demo-audio.wav'])
})

test('aborting during simulated latency rejects the request instead of returning stale data', async () => {
  const fetch = createDemoFetch(() => assert.fail('Unexpected network request'), { baseUrl: 'http://localhost/', delayMs: 500 })
  const controller = new AbortController()
  const pending = fetch('/monitor/devices', { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
