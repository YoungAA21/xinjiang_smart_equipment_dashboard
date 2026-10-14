import test from 'node:test'
import assert from 'node:assert/strict'
import { productionLineTarget } from '../src/charts/productionLineTargets.js'

test('only four approved machine footprints navigate, preserving existing source ownership', () => {
  for (const [displayId, machine] of [['ZJ117', 'ZJ117'], ['YB25', 'ZB25'], ['YB55', 'YB55'], ['YB95', 'YB95']]) {
    assert.deepEqual(productionLineTarget(displayId), { path: '/monitor', query: { machine } })
  }
  for (const id of ['YB65', 'MAIN-CABINET', 'STORAGE-DRUM', 'unknown', 'toString']) assert.equal(productionLineTarget(id), null)
})
