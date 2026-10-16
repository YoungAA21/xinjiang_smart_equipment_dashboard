import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref } from 'vue'
import { useRecentHistory } from '../src/composables/useRecentHistory.js'

const flush = async () => { for (let i = 0; i < 15; i++) await nextTick() }

test('recent history retries failed points, skips successful metadata replacements and warms newly visible points', async () => {
  const scope = effectScope(), controller = new AbortController(), calls = []
  const points = ref([{ pointId: 1, moduleId: 'M', channelId: 'C', pointCode: 'P' }])
  let failing = true, state
  scope.run(() => { state = useRecentHistory(points, { async seedRecentPoints(point) { calls.push(point.pointId); if (failing) throw new Error('offline') } }, controller.signal) })
  await flush()
  assert.equal(state.failed.value, true)
  failing = false
  await state.retry()
  assert.equal(state.failed.value, false)
  points.value = points.value.map(point => ({ ...point, name: 'updated' }))
  await flush()
  assert.deepEqual(calls, [1, 1])
  points.value.push({ ...points.value[0], pointId: 2, pointCode: 'P2' })
  await flush()
  assert.deepEqual(calls, [1, 1, 2])
  controller.abort()
  points.value.push({ ...points.value[0], pointId: 3, pointCode: 'P3' })
  await flush()
  assert.deepEqual(calls, [1, 1, 2])
  scope.stop()
})
