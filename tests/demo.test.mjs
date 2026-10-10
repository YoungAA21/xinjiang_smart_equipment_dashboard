import assert from 'node:assert/strict'
import { test } from 'node:test'
import { demoResponse, modules, points, signalFrame } from '../src/demo/data.js'

const now = Date.parse('2026-09-18T08:00:00+08:00')
test('demo device totals and point identities agree across pages', () => {
  const health = demoResponse('/api/health/detail', {}, now)
  assert.equal(health.moduleChannelPointTable.activePointCount, points.length)
  assert.equal(health.runtimeModules.statusCount, modules.length)
  for (const m of modules) {
    const data = demoResponse(`/api/configuration/modules/${m.moduleId}/points`, {}, now)
    assert.equal(data.points.length, m.pointCount)
    assert.ok(data.points.every(p => p.moduleId === m.moduleId))
  }
})
test('demo alarm filtering distinguishes false from an omitted status', () => {
  const result = demoResponse('/api/analysis/alarms', { pointId: 1, isActive: 'false', limit: 3 }, now)
  assert.equal(result.events.length, 3)
  assert.ok(result.events.every(e => e.pointId === 1 && e.status === 'Recovered'))
  assert.deepEqual(demoResponse('/api/analysis/alarms', { start: '2099-01-01' }, now).events, [])
})
test('demo history respects requested range and limit; recording pagination filters first', () => {
  const start = '2026-09-18T07:00:00+08:00', end = '2026-09-18T07:01:00+08:00'
  const history = demoResponse('/api/telemetry/history', { pointId: 2, start, end, limit: 7 }, now)
  assert.equal(history.points.length, 7)
  assert.ok(history.points.every(p => p.pointId === 2 && Date.parse(p.collectedAt) >= Date.parse(start) && Date.parse(p.collectedAt) < Date.parse(end)))
  const a = demoResponse('/recordings', { deviceId: 'DEV1', page: 1, pageSize: 5 }, now)
  const b = demoResponse('/recordings', { deviceId: 'DEV1', page: 2, pageSize: 5 }, now)
  assert.equal(a.total, 12)
  assert.ok(b.row.every(r => r.deviceId === 'DEV1' && !a.row.some(first => first.id === r.id)))
})
test('unsupported demo routes fail closed and generated signals contain finite values', () => {
  assert.throws(() => demoResponse('/api/unsupported'), /尚未提供接口/)
  const frame = signalFrame()
  assert.ok(frame.waveform.every(v => Number.isFinite(v) && Math.abs(v) <= 1))
  assert.ok(frame.spectrum.every(Number.isFinite))
  assert.ok(frame.waterfall.every(row => row.length === frame.spectrum.length))
})
