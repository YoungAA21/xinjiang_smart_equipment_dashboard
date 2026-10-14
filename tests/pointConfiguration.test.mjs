import test from 'node:test'
import assert from 'node:assert/strict'
import { computed } from 'vue'
import { emptyConfiguration, parameterKey, validateConfiguration, mergeDiscoveredPoints } from '../src/charts/pointConfiguration.js'
import { configurationSnapshot, pointConfiguration, savePointConfiguration, loadPointConfiguration, configuredParameter, presentPoint } from '../src/stores/pointConfiguration.js'
import { configuredMonitoringPoints, discoveredMonitoringModules, monitoringPointName } from '../src/charts/equipmentCatalog.js'
import { buildLineMachines } from '../src/charts/productionLine.js'
import { alarmMachineId } from '../src/charts/productionLineStatus.js'
import { monitoringLocationOf, monitoringLocations } from '../src/charts/monitoringLocations.js'
import { acousticChannelDisplayName, fanGroupOf, groupMachineDevices } from '../src/charts/machineGroups.js'

const point = Object.freeze({ moduleId: 'VSE03', channelId: 'AI01', pointCode: 'SE01_v_03', pointId: 35, name: '后端名称', metricType: 'VibrationRms', unit: 'mm/s', value: 0 })
const storage = () => {
  const values = new Map()
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
}
const configured = () => {
  const value = emptyConfiguration()
  value.targets.push({ id: 'bearing', name: '驱动端轴承', locationId: 'max' })
  value.parameters[parameterKey(point)] = { displayName: '轴承振动', unit: '自定义单位', locationId: 'max', targetId: 'bearing', pointId: 35 }
  return value
}
const reset = () => savePointConfiguration(emptyConfiguration(), storage())

test('identities isolate sources, modules, channels and parameter codes without coercing device IDs', () => {
  assert.notEqual(parameterKey(point), parameterKey({ ...point, channelId: 'AI02' }))
  assert.notEqual(parameterKey(point), parameterKey({ ...point, moduleId: 'VSE04' }))
  assert.notEqual(parameterKey(point), parameterKey({ ...point, pointCode: 'OTHER' }))
  assert.notEqual(parameterKey({ channelId: 'AI01' }, 'monitor', '9007199254740993'), parameterKey({ channelId: 'AI01' }, 'monitor', '9007199254740992'))
})

test('configuration changes update cached computed names, units and ownership while preserving samples and IDs', t => {
  reset(); t.after(reset)
  const presented = computed(() => configuredMonitoringPoints([point], [], point.moduleId)[0])
  assert.equal(presented.value.configurationState, 'unconfigured')
  assert.match(presented.value.name, /未配置/)
  savePointConfiguration(configured(), storage())
  assert.equal(presented.value.name, '轴承振动')
  assert.equal(presented.value.unit, '自定义单位')
  assert.equal(presented.value.value, 0)
  assert.equal(presented.value.pointId, 35)
  assert.equal(presented.value.backendName, '后端名称')
  assert.equal(presented.value.backendUnit, 'mm/s')
  assert.equal(monitoringLocationOf({ id: 'VSE03', source: 'legacy' }, point), 'max')
  assert.equal(point.name, '后端名称')
})

test('new backend parameters remain unconfigured even next to a configured parameter', t => {
  reset(); t.after(reset)
  savePointConfiguration(configured(), storage())
  const newPoint = { ...point, pointCode: 'NEW_STATUS', metricType: 'AlarmStatus', value: 0 }
  const rows = configuredMonitoringPoints([point, newPoint], [], point.moduleId)
  assert.equal(rows.length, 2)
  assert.equal(rows[1].configurationState, 'unconfigured')
  assert.equal(rows[1].value, 0)
  assert.match(rows[1].name, /未配置/)
  assert.equal(presentPoint(newPoint).unit, 'mm/s')
})

test('latest-only discovery preserves zero and does not overwrite metadata or duplicate a known parameter', () => {
  const latest = [{ ...point, name: '采样名称', unit: '冲突单位' }, { ...point, pointCode: 'NEW', value: 0 }, { ...point, moduleId: 'OTHER', pointCode: 'OTHER' }]
  const rows = mergeDiscoveredPoints([point], latest, point.moduleId)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, '后端名称')
  assert.equal(rows[0].unit, 'mm/s')
  assert.equal(rows[1].discoveredFromLatest, true)
  assert.equal(rows[1].value, 0)
})

test('empty unit is an explicit configuration rather than a fallback to the backend unit', t => {
  reset(); t.after(reset)
  const value = configured()
  value.parameters[parameterKey(point)].unit = ''
  savePointConfiguration(value, storage())
  assert.equal(presentPoint(point).unit, '')
})

test('clearing configuration restores original names and units even for an already decorated selected point', t => {
  reset(); t.after(reset)
  savePointConfiguration(configured(), storage())
  const selected = presentPoint(point)
  assert.equal(selected.unit, '自定义单位')
  reset()
  const restored = presentPoint(selected)
  assert.equal(restored.name, '后端名称')
  assert.equal(restored.unit, 'mm/s')
  assert.equal(restored.targetId, '')
  assert.equal(restored.configurationState, 'unconfigured')
})

test('saving, reloading and exporting configuration retain relationships for all local users', t => {
  reset(); t.after(reset)
  const disk = storage()
  savePointConfiguration(configured(), disk)
  reset()
  assert.equal(configuredParameter(point), undefined)
  loadPointConfiguration(disk)
  assert.equal(monitoringPointName(point), '轴承振动')
  assert.equal(validateConfiguration(configurationSnapshot()).targets[0].name, '驱动端轴承')
})

test('invalid hierarchy and failed disk writes cannot replace the current valid configuration', t => {
  reset(); t.after(reset)
  savePointConfiguration(configured(), storage())
  const before = configurationSnapshot()
  const invalid = configured()
  invalid.parameters[parameterKey(point)].locationId = 've'
  assert.throws(() => savePointConfiguration(invalid, storage()), /对应的大点位/)
  assert.throws(() => savePointConfiguration(emptyConfiguration(), { setItem() { throw new Error('quota') } }), /尚未生效/)
  assert.deepEqual(configurationSnapshot(), before)
  const missing = configured()
  missing.locations = missing.locations.filter(location => location.id !== 've')
  assert.throws(() => validateConfiguration(missing), /固定大点位不能删除/)
})

test('a custom hierarchy appears in point options and overrides machine ownership by individual parameter', t => {
  reset(); t.after(reset)
  const value = configured()
  value.locations.push({ id: 'new-fan', name: '新增风机', machine: 'YB65', modules: [] })
  value.targets.push({ id: 'new-bearing', name: '轴承', locationId: 'new-fan' })
  Object.assign(value.parameters[parameterKey(point)], { locationId: 'new-fan', targetId: 'new-bearing' })
  savePointConfiguration(value, storage())
  assert.ok(monitoringLocations.some(location => location.id === 'new-fan'))
  assert.equal(monitoringLocationOf({ id: 'VSE03', source: 'legacy' }, point), 'new-fan')
  const { groups } = groupMachineDevices([{ source: 'legacy', id: 'VSE03', points: [point] }])
  assert.equal(groups.find(group => group.id === 'YB65').members[0].points[0], point)
  const machines = buildLineMachines([{ source: 'legacy', id: 'VSE03', online: true, points: [point] }], [{ ...point, status: 'Active' }])
  assert.equal(machines.find(machine => machine.id === 'YB65').sourceId, 'YB65')
  assert.equal(machines.find(machine => machine.id === 'YB65').state, 'alarm')
  assert.equal(machines.find(machine => machine.id === 'ZJ117').activeAlarms.length, 0)
  assert.equal(alarmMachineId(point), 'YB65')
})

test('acoustic channel configuration remains independent of collection parameter configuration', t => {
  reset(); t.after(reset)
  const device = { deviceId: '9007199254740993', collectors: [{ ip: '192.168.3.51' }] }
  const channel = { channelId: 'AI01', name: '后端声纹' }
  const value = configured()
  value.parameters[parameterKey(channel, 'monitor', device.deviceId)] = { displayName: '轴承声纹', unit: 'dB', locationId: 'max', targetId: 'bearing' }
  savePointConfiguration(value, storage())
  assert.equal(acousticChannelDisplayName(device, channel), '轴承声纹')
  assert.equal(monitoringLocationOf({ source: 'monitor', id: device.deviceId, raw: device }, channel), 'max')
  assert.equal(monitoringPointName(point), '轴承振动')
})

test('fan layout and point details share exactly the same temperature assignments', t => {
  reset(); t.after(reset)
  for (const [code, expected] of [['07', 've'], ['08', 've'], ['09', 'max'], ['10', 'max']]) {
    const row = { member: { source: 'legacy', id: 'TEMP02' }, point: { pointCode: `BEARING_TEMP_${code}`, metricType: 'Temperature' } }
    assert.equal(fanGroupOf(row), expected)
    assert.equal(monitoringLocationOf(row.member, row.point), expected)
  }
})

test('alarm rows with omitted channels resolve only unambiguous configured parameters', t => {
  reset(); t.after(reset)
  const value = configured()
  savePointConfiguration(value, storage())
  assert.equal(configuredParameter({ moduleId: point.moduleId, pointId: 35 }).displayName, '轴承振动')
  value.parameters[parameterKey({ ...point, channelId: 'AI02' })] = { ...value.parameters[parameterKey(point)] }
  savePointConfiguration(value, storage())
  assert.equal(configuredParameter({ moduleId: point.moduleId, pointId: 35 }), undefined)
})

test('a latest-only module is discoverable before the module directory catches up', () => {
  const rows = discoveredMonitoringModules([{ moduleId: 'TEMP02' }], [{ moduleId: 'NEW', value: 0 }, { moduleId: 'NEW', value: 1 }])
  assert.equal(rows.length, 2)
  assert.equal(rows[1].moduleId, 'NEW')
  assert.equal(rows[1].discoveredFromLatest, true)
  assert.equal(rows[1].runtimeStatus, undefined)
})
