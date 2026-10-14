import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyConfiguration, parameterKey, updateLocation, removeLocation } from '../src/charts/pointConfiguration.js'

const fixture = () => {
  const value = updateLocation(emptyConfiguration(), 'custom', { name: '排风机', machine: 'YB55' })
  value.targets.push({ id: 'bearing', name: '电机轴承', locationId: 'custom' })
  value.parameters[parameterKey({ moduleId: 'NEW', channelId: '1', pointCode: 'TEMP' })] = { displayName: '轴承温度', unit: '°C', locationId: 'custom', targetId: 'bearing' }
  return value
}

test('editing a custom location preserves its identity and all child parameter relationships', () => {
  const original = fixture()
  const updated = updateLocation(original, 'custom', { name: '  规范排风机  ', machine: ' yb65 ' })
  assert.equal(updated.locations.at(-1).name, '规范排风机')
  assert.equal(updated.locations.at(-1).machine, 'YB65')
  assert.deepEqual(updated.targets, original.targets)
  assert.deepEqual(updated.parameters, original.parameters)
  assert.equal(original.locations.at(-1).name, '排风机')
})

test('adding and editing detect duplicate names despite whitespace, case or fullwidth differences', () => {
  assert.throws(() => updateLocation(emptyConfiguration(), 'duplicate', { name: 'ｍａｘ风机', machine: ' zj117 ' }), /同名大点位/)
  assert.throws(() => updateLocation(fixture(), 'custom', { name: 'MAX风机', machine: 'ZJ117' }), /同名大点位/)
  assert.equal(updateLocation(fixture(), 'custom', { name: '排风机', machine: 'YB55' }).locations.at(-1).id, 'custom')
})

test('deleting a duplicate location migrates children and merges normalized target names without losing units', () => {
  const original = fixture()
  original.targets.push({ id: 'existing-bearing', name: '电机 轴承', locationId: 'max' })
  const updated = removeLocation(original, 'custom', 'max')
  assert.ok(!updated.locations.some(location => location.id === 'custom'))
  assert.deepEqual(updated.targets, [{ id: 'existing-bearing', name: '电机 轴承', locationId: 'max' }])
  const parameter = Object.values(updated.parameters)[0]
  assert.equal(parameter.locationId, 'max')
  assert.equal(parameter.targetId, 'existing-bearing')
  assert.equal(parameter.displayName, '轴承温度')
  assert.equal(parameter.unit, '°C')
  assert.equal(original.targets.length, 2)
})

test('migration to an empty destination keeps target identities and explicit unconfiguration removes references', () => {
  const migrated = removeLocation(fixture(), 'custom', 'max')
  assert.equal(migrated.targets[0].id, 'bearing')
  assert.equal(migrated.targets[0].locationId, 'max')
  const deleted = removeLocation(fixture(), 'custom')
  assert.equal(deleted.targets.length, 0)
  assert.equal(Object.keys(deleted.parameters).length, 0)
})

test('fixed locations and invalid migration destinations cannot be deleted or changed', () => {
  assert.throws(() => removeLocation(fixture(), 'max'), /固定/)
  assert.throws(() => updateLocation(fixture(), 'max', { name: '名称', machine: 'YB55' }), /固定/)
  assert.throws(() => removeLocation(fixture(), 'custom', 'custom'), /其他已有大点位/)
  assert.throws(() => removeLocation(fixture(), 'custom', 'missing'), /其他已有大点位/)
})
