import test from 'node:test'
import assert from 'node:assert/strict'
import { productionLineTarget } from '../src/charts/productionLineTargets.js'

test('five model footprints navigate to their category and preserve individual model selection', () => {
  for (const [displayId, machine] of [['ZJ17', 'ZJ17'], ['YB25', 'ZB25'], ['YB55', 'ZB25-AUX'], ['YB65', 'ZB25-AUX'], ['YB95', 'ZB25-AUX']]) {
    assert.deepEqual(productionLineTarget(displayId), { path: '/monitor', query: { machine, ...(displayId === 'ZJ17' ? {} : { model: displayId }) } })
  }
  for (const id of ['MAIN-CABINET', 'STORAGE-DRUM', 'unknown', 'toString']) assert.equal(productionLineTarget(id), null)
})
