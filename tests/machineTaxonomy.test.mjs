import test from 'node:test'
import assert from 'node:assert/strict'
import { computed } from 'vue'
import { machineCategories, machineCategoryId } from '../src/charts/machineTaxonomy.js'
import { emptyConfiguration, parameterKey, updateLocation, validateConfiguration } from '../src/charts/pointConfiguration.js'
import { configurationSnapshot, pointConfiguration, savePointConfiguration } from '../src/stores/pointConfiguration.js'
import { detailTabLocations } from '../src/charts/pointDetailTabs.js'
import { groupMachineDevices } from '../src/charts/machineGroups.js'
import { buildLineMachines } from '../src/charts/productionLine.js'
import { alarmMachineId } from '../src/charts/productionLineStatus.js'

const storage = { setItem() {} }
test('three categories own all five models, including legacy machine aliases', () => {
  assert.deepEqual(machineCategories.map(category => category.name), ['ZJ17', 'ZB25主机', 'ZB25辅机'])
  for (const model of ['YB55', 'YB65', 'YB95']) assert.equal(machineCategoryId(model), 'ZB25-AUX')
  assert.equal(machineCategoryId('YB25'), 'ZB25')
})

test('legacy configuration migration preserves locations, parameters, units and model ownership', () => {
  const legacy = emptyConfiguration()
  delete legacy.detailLocationIds
  for (const location of legacy.locations) {
    delete location.model
    if (location.machine === 'ZB25-AUX') location.machine = 'YB55'
  }
  legacy.locations.push({ id: 'wrapper', name: '包装电机', machine: 'YB95', modules: [] })
  legacy.targets.push({ id: 'bearing', name: '驱动端', locationId: 'wrapper' })
  legacy.parameters[parameterKey({ moduleId: 'VSE08', channelId: '1', pointCode: 'RMS' })] = { displayName: '包装振动', unit: 'mm/s', locationId: 'wrapper', targetId: 'bearing' }
  const migrated = validateConfiguration(legacy)
  assert.equal(migrated.locations.at(-1).machine, 'ZB25-AUX')
  assert.equal(migrated.locations.at(-1).model, 'YB95')
  assert.deepEqual(migrated.parameters, legacy.parameters)
  assert.deepEqual(migrated.targets, legacy.targets)
  assert.equal(legacy.locations.at(-1).machine, 'YB95')
  assert.ok(migrated.detailLocationIds.includes('wrapper'))
})

test('one collection module splits auxiliary models without duplicating samples or alarms', t => {
  const original = configurationSnapshot()
  t.after(() => savePointConfiguration(original, storage))
  let value = emptyConfiguration()
  const points = ['YB55', 'YB65', 'YB95'].map((model, index) => {
    const locationId = `motor-${model}`
    value = updateLocation(value, locationId, { name: '传动电机', machine: 'ZB25-AUX', model })
    value.targets.push({ id: `bearing-${model}`, name: '轴承', locationId })
    const point = { moduleId: 'VSE08', channelId: String(index), pointCode: model, pointId: index + 1, value: 0 }
    value.parameters[parameterKey(point)] = { displayName: model, unit: 'mm/s', locationId, targetId: `bearing-${model}`, pointId: point.pointId }
    return point
  })
  savePointConfiguration(value, storage)
  const device = { id: 'VSE08', source: 'legacy', online: true, points }
  const groups = groupMachineDevices([device]).groups
  assert.equal(groups.length, 3)
  assert.equal(groups[2].pointCount, 3)
  assert.deepEqual(groups[2].members.map(member => member.model), ['YB55', 'YB65', 'YB95'])
  const event = { ...points[2], status: 'Active' }
  const line = buildLineMachines([device], [event])
  assert.deepEqual(line.slice(2).map(machine => machine.pointCount), [1, 1, 1])
  assert.deepEqual(line.slice(2).map(machine => machine.activeAlarms.length), [0, 0, 1])
  assert.equal(alarmMachineId(event), 'YB95')
  assert.equal(points[2].value, 0)
})

test('detail tab visibility and ordering are reactive and do not remove location data', t => {
  const original = configurationSnapshot()
  t.after(() => savePointConfiguration(original, storage))
  const visible = computed(() => detailTabLocations(pointConfiguration.locations, pointConfiguration.detailLocationIds))
  const value = emptyConfiguration()
  value.detailLocationIds = ['max', 've']
  savePointConfiguration(value, storage)
  assert.deepEqual(visible.value.map(location => location.id), ['max', 've'])
  assert.ok(pointConfiguration.locations.some(location => location.id === 'aux-motor'))
  value.detailLocationIds = ['ve']
  savePointConfiguration(value, storage)
  assert.equal(visible.value[0].id, 've')
  value.detailLocationIds = []
  assert.throws(() => savePointConfiguration(value, storage), /至少保留/)
})

test('a model cannot be assigned to the wrong category and duplicate location names are scoped to models', () => {
  assert.throws(() => updateLocation(emptyConfiguration(), 'invalid', { name: '电机', machine: 'ZJ17', model: 'YB95' }), /机型/)
  const first = updateLocation(emptyConfiguration(), 'a', { name: '电机', machine: 'ZB25-AUX', model: 'YB65' })
  assert.equal(updateLocation(first, 'b', { name: '电机', machine: 'ZB25-AUX', model: 'YB95' }).locations.at(-1).model, 'YB95')
  assert.throws(() => updateLocation(first, 'c', { name: '电机', machine: 'ZB25-AUX', model: 'YB65' }), /同名/)
})
