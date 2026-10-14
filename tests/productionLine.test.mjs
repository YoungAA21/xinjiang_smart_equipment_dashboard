import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLineMachines, readingState } from '../src/charts/productionLine.js'

test('home preserves five footprints and maps YB25 only to the confirmed ZB25 sources', () => {
  const devices = [{ id: 'VSE04', source: 'legacy', online: true, points: [{ pointCode: 'vibration' }], raw: {} }]
  const result = buildLineMachines(devices)
  assert.deepEqual(result.map(machine => machine.id), ['ZJ117', 'YB25', 'YB55', 'YB65', 'YB95'])
  assert.equal(result[1].pointCount, 1)
  assert.equal(result[1].state, 'online')
  assert.equal(result[3].state, 'unconfigured')
  assert.equal(result[4].state, 'unconfigured')
  assert.equal(result[0].state, 'unknown')
  assert.equal(buildLineMachines(devices, [], { legacy: true })[1].state, 'unknown')
  assert.equal(buildLineMachines(devices, [{ moduleId: 'VSE04', isActive: true }])[1].state, 'alarm')
})

test('readings preserve zero and reject missing, bad quality, future and stale samples', () => {
  const point = { moduleId: 'TEMP02', channelId: '1', pointCode: 'temperature' }
  const now = Date.parse('2026-10-14T12:00:00Z')
  const sample = { ...point, value: 0, quality: 'Good', collectedAt: new Date(now).toISOString() }
  assert.equal(readingState(point, [sample], now).value, 0)
  assert.equal(readingState(point, [sample], now).usable, true)
  assert.equal(readingState(point, [{ ...sample, value: null }], now).value, null)
  assert.equal(readingState(point, [{ ...sample, quality: 'Bad' }], now).usable, false)
  assert.equal(readingState(point, [sample], now + 11000).label, '未更新')
  assert.equal(readingState(point, [sample], now, true).usable, false)
  assert.equal(readingState(point, [sample], now, false, false).usable, false)
  assert.equal(readingState(point, [{ ...sample, collectedAt: new Date(now + 60000).toISOString() }], now).value, null)
  assert.equal(readingState(point, [{ ...sample, channelId: '2' }], now).value, null)
})
