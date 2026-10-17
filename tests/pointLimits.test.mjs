import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { telemetryApi } from '../src/services/telemetry.js'

test('production proxy forwards point limit PATCH instead of returning the dedicated API 404', async () => {
  const config = await readFile(new URL('../nginx.conf', import.meta.url), 'utf8')
  const path = '/_telemetry-api/api/configuration/points/51/limits'
  const locations = [...config.matchAll(/location ~ (\S+) \{([\s\S]*?)\n        \}/g)]
  const location = locations.find(([, pattern]) => new RegExp(pattern).test(path))
  assert.ok(location, 'point limits fall through to the dedicated API 404')
  assert.match(location[2], /limit_except PATCH(?: OPTIONS)?\s*\{/)
  assert.match(location[2], /proxy_pass http:\/\/equipment_backend;/)
  assert.match(config, /upstream equipment_backend\s*\{\s*server 127\.0\.0\.1:5158;/)
  assert.match(location[2], /proxy_set_header Authorization "";/)
  assert.match(location[2], /proxy_set_header Cookie "";/)
  assert.match(location[2], /rewrite \^\/_\[\^\/\]\+\(\/api\/\.\*\)\$ \$1 break;/)
  assert.equal(new RegExp(location[1]).test(path + '/history'), false)
})

test('point limit PATCH sends both nullable fields, accepts equal bounds and carries no acoustic token', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/_telemetry-api/api/configuration/points/51/limits')
    assert.equal(options.method, 'PATCH')
    assert.equal(options.headers.Authorization, undefined)
    const body = JSON.parse(options.body)
    assert.deepEqual(body, { minimumValue: 0, maximumValue: 0 })
    return Response.json({ saved: true, pointId: 51, ...body })
  })
  await telemetryApi.updatePointLimits(51, { minimumValue: 0, maximumValue: 0 })
})

test('point limit PATCH clears either bound and rejects reversed bounds before sending', async t => {
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body)
    bodies.push(body)
    return Response.json({ saved: true, pointId: 51, ...body })
  })
  await telemetryApi.updatePointLimits(51, { minimumValue: '', maximumValue: 1.5 })
  await telemetryApi.updatePointLimits(51, { minimumValue: 0, maximumValue: null })
  assert.deepEqual(bodies, [
    { minimumValue: null, maximumValue: 1.5 },
    { minimumValue: 0, maximumValue: null },
  ])
  await assert.rejects(telemetryApi.updatePointLimits(51, { minimumValue: 2, maximumValue: 1 }), /下限不能大于上限/)
  assert.equal(bodies.length, 2)
})
