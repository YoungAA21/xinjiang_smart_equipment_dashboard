import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cacheDonut, checksBars, countOnline, groupChecks, healthGauge, maintenanceBars, onlineDonut, partitionMatrix } from '../src/charts/healthCharts.js'

test('health gauge measures check pass rate independently from module connectivity', () => {
  const gauge = healthGauge([{ status: 'Healthy' }, { status: 'Healthy' }])
  assert.equal(gauge.series[1].data[0].value, 100)
  assert.deepEqual(countOnline([{ isOnline: true }, { isOnline: false }, {}]), { online: 1, offline: 1, unknown: 1 })
  assert.equal(onlineDonut([{ isOnline: true }, { isOnline: false }]).title.text, '50%')
})

test('unhealthy and degraded checks reduce the gauge', () => {
  assert.equal(healthGauge([{ status: 'Healthy' }, { status: 'Unhealthy' }, { status: 'Degraded' }, { status: 'Healthy' }]).series[1].data[0].value, 50)
})

test('missing data has an explicit empty state, not a synthetic score', () => {
  assert.equal(healthGauge().series.length, 0)
  assert.equal(onlineDonut().series.length, 0)
  assert.equal(maintenanceBars().series.length, 0)
  assert.equal(cacheDonut().series.length, 0)
  assert.equal(cacheDonut({}).series.length, 0)
})

test('check grouping includes unexpected checks exactly once', () => {
  const checks = [
    { name: 'database.connection', status: 'Healthy' },
    { name: 'database.module_table.TEMP01', status: 'Healthy' },
    { name: 'database.aggregation_table.TEMP01', status: 'Unhealthy' },
    { name: 'runtime.modules', status: 'Healthy' },
    { name: 'new.check', status: 'Unhealthy' },
  ]
  const groups = groupChecks(checks)
  assert.equal(groups.reduce((n, g) => n + g.total, 0), 5)
  assert.equal(groups.reduce((n, g) => n + g.passed, 0), 3)
  const option = checksBars(checks)
  assert.equal(option.series[0].data.reduce((a, b) => a + b, 0), 3)
  assert.equal(option.series[1].data.reduce((a, b) => a + b, 0), 2)
})

test('partition matrix distinguishes covered, absent, optional and unknown partitions', () => {
  const matrix = partitionMatrix([
    { moduleId: 'A', exists: true, hasPmax: true, expectedPartitions: ['p202608', 'p202609'], missingPartitions: ['p202609'] },
    { moduleId: 'B', exists: true, hasPmax: false, expectedPartitions: ['p202608'], missingPartitions: [] },
    { moduleId: 'C', exists: false, hasPmax: true, expectedPartitions: ['p202608'], missingPartitions: [] },
    { moduleId: 'D' },
  ])
  assert.deepEqual(matrix.columns, ['p202608', 'p202609', 'pmax'])
  assert.deepEqual(matrix.data.filter((d) => d[1] === 0).map((d) => d[2]), [1, 2, 1])
  assert.deepEqual(matrix.data.filter((d) => d[1] === 1).map((d) => d[2]), [1, 0, 3])
  assert.ok(matrix.data.filter((d) => d[1] === 2).every((d) => d[2] === 2))
  assert.ok(matrix.data.filter((d) => d[1] === 3).every((d) => d[2] === 4))
})

test('zero cache is an empty ring; populated cache represents actual counts', () => {
  const empty = cacheDonut({ fileCount: 0, badFileCount: 0, temporaryFileCount: 0 })
  assert.equal(empty.title.text, '0')
  assert.deepEqual(empty.series[0].data, [])
  const populated = cacheDonut({ fileCount: 3, badFileCount: 1, temporaryFileCount: 2 })
  assert.equal(populated.title.text, '6')
  assert.deepEqual(populated.series[0].data.map((d) => d.value), [3, 1, 2])
})

test('maintenance bar counts come from actual partition lists, including pmax', () => {
  const option = maintenanceBars([{ moduleId: 'A', existingPartitionsBefore: ['p202608', 'pmax'], existingPartitionsAfter: ['p202608', 'p202609', 'pmax'] }, { moduleId: 'B' }])
  assert.deepEqual(option.series[0].data, [2, null])
  assert.deepEqual(option.series[1].data, [3, null])
})
