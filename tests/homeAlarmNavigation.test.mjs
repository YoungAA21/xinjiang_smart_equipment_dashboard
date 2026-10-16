import test from 'node:test'
import assert from 'node:assert/strict'
import { homePointTarget, homeStatusLabel, requestedPointRow } from '../src/charts/homePointNavigation.js'

const vibration = { key: 'v', member: { source: 'legacy', id: 'VSE03' }, point: { pointId: 1, channelId: 'v1', pointCode: 'SE01_v_03' }, alarm: false }
const temperature = { key: 't', member: { source: 'legacy', id: 'TEMP02' }, point: { pointId: 2, channelId: 't1', pointCode: 'BEARING_TEMP_09' }, alarm: true }

test('an alarming group targets the alarming parameter instead of its first normal parameter', () => {
  const target = homePointTarget({ location: 'max', rows: [vibration, temperature] })
  assert.equal(target.path, '/device')
  assert.deepEqual(target.query, { location: 'max', openPoint: '1', source: 'legacy', device: 'TEMP02', pointId: 2, channelId: 't1', pointCode: 'BEARING_TEMP_09' })
  assert.equal(requestedPointRow([vibration, temperature], target.query), temperature)
})

test('normal and unknown groups retain normal navigation without requesting a drawer', () => {
  for (const state of ['normal', 'unknown']) {
    assert.deepEqual(homePointTarget({ location: 'max', state, rows: [vibration] }), { path: '/device', query: { location: 'max' } })
  }
  assert.equal(homePointTarget({ rows: [vibration] }).path, '/device/detail')
})

test('drawer requests wait for the correct device and parameter and never fall back to the first row', () => {
  const query = homePointTarget({ location: 'max', rows: [vibration, temperature] }).query
  assert.equal(requestedPointRow([vibration], query), null)
  assert.equal(requestedPointRow([{ ...temperature, member: vibration.member }], query), null)
  assert.equal(requestedPointRow([temperature], { ...query, pointId: '2' }), temperature)
  assert.equal(requestedPointRow([temperature], { ...query, pointId: 99 }), null)
  assert.equal(requestedPointRow([temperature], { ...query, openPoint: undefined }), null)
  assert.equal(requestedPointRow([temperature], { ...query, pointId: undefined }), temperature)
  assert.equal(requestedPointRow([temperature], { ...query, pointId: undefined, pointCode: undefined }), null)
})

test('home hides pending wording while preserving alarms, normal and offline labels', () => {
  for (const label of ['待确认', '状态待确认', '连接待确认']) assert.equal(homeStatusLabel(label), '')
  for (const label of ['报警', '正常', '离线', '未配置', '系统报警']) assert.equal(homeStatusLabel(label), label)
})
