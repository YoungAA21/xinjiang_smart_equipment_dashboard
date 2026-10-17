import test from 'node:test'
import assert from 'node:assert/strict'
import { appearanceRejectionStatus } from '../src/charts/homeRejectionStatus.js'

const now = Date.parse('2026-10-17T10:00:00+08:00')
const sample = { moduleId: 'PRESS01', channelId: 'PRESS01-DI02', pointCode: 'PRESS01_DI02', pointId: 74, collectedAt: new Date(now).toISOString(), quality: 'Good', value: 0 }

test('appearance rejection uses inverted switch values from the specified point', () => {
  assert.equal(appearanceRejectionStatus([sample], { now }).label, '开启')
  assert.equal(appearanceRejectionStatus([{ ...sample, value: 1 }], { now }).label, '关闭')
  assert.equal(appearanceRejectionStatus([{ ...sample, pointId: undefined }], { now }).label, '开启')
  for (const change of [{ value: null }, { value: 2 }, { quality: 'Bad' }, { pointId: 75 }, { moduleId: 'PRESS03' }, { channelId: 'PRESS01-DI01' }, { pointCode: 'PRESS01_DI01' }, { collectedAt: new Date(now - 11000).toISOString() }]) {
    assert.equal(appearanceRejectionStatus([{ ...sample, ...change }], { now }).label, '未知')
  }
  assert.equal(appearanceRejectionStatus([], { now }).label, '未知')
  assert.equal(appearanceRejectionStatus([sample], { now, error: '请求失败' }).label, '未知')
  assert.equal(appearanceRejectionStatus([{ ...sample, value: 1, collectedAt: new Date(now - 1000).toISOString() }, sample], { now }).label, '开启')
})
