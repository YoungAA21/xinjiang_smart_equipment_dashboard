import test from 'node:test'
import assert from 'node:assert/strict'
import { machineReadings, machineHealth, alarmMatchesRow, alarmMachineId, acquisitionConnectionStatus, groupedMonitoringPoints, configuredHomeReadings } from '../src/charts/productionLineStatus.js'

const now = Date.parse('2026-10-14T08:00:00Z')
const point = { moduleId:'VSE04', channelId:'ch1', pointCode:'v', pointId:42, metricType:'VibrationRms' }
const machine = { sourceId:'ZB25', state:'online', activeAlarms:[], members:[{ id:'VSE04', source:'legacy', online:true, points:[point], raw:{} }] }
const latest = [{ ...point, value:0, quality:'Good', collectedAt:new Date(now).toISOString() }]

test('home values exclude unconfigured parameters and preserve configured zero and unavailable samples', () => {
  const rows = [
    { point: { configurationState: 'unconfigured' }, value: 9 },
    { point: { configurationState: 'configured' }, value: 0, usable: true },
    { point: { configurationState: 'configured' }, value: null, usable: false },
    { point: {}, value: 20 },
  ]
  assert.deepEqual(configuredHomeReadings(rows), [rows[1], rows[2]])
  assert.equal(rows.length, 4)
})

test('home point list never substitutes acquisition module names for missing locations', () => {
  const rows = [
    { member: { source: 'legacy', id: 'VSE03', name: '振动采集模块' }, point: { pointCode: 'unknown', metricType: 'VibrationRms' } },
    { member: { source: 'legacy', id: 'OTHER', name: '负压采集模块' }, point: { pointCode: 'unknown', metricType: 'NegativePressure' } },
    { member: { source: 'monitor', id: 'sound', name: '声纹采集器', raw: {} }, point: { channelId: 'ch1' } },
    { member: { source: 'legacy', id: 'VSE03' }, point: { pointCode: 'SE01_v_03', metricType: 'VibrationRms' }, normal: true },
  ]
  const groups = groupedMonitoringPoints(rows)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].name, 'MAX 风机')
  assert.equal(groups[0].rows.length, 1)
})
test('zero is a normal current value only with valid fresh samples and a successful alarm source', () => {
  const rows = machineReadings(machine, { latest, now, alarmsReady:true })
  assert.equal(rows[0].value, 0)
  assert.equal(rows[0].normal, true)
  assert.equal(machineHealth(machine, rows, true).health, 'normal')
  for (const options of [{ now:now+11000 }, { sourceErrors:{ legacy:true } }, { alarmsReady:false }, { latest:[] }]) {
    const uncertainRows = machineReadings(machine, { latest, now, alarmsReady:true, ...options })
    assert.equal(uncertainRows[0].normal, false)
    assert.equal(machineHealth(machine, uncertainRows, true).health, 'unknown')
  }
})
test('connection banner depends on device online states, not sampling or measurement alarms', () => {
  const modules = [{ runtimeStatus:{ isOnline:true } }]
  assert.equal(acquisitionConnectionStatus(modules, [{ online:true }]).label, '系统正常')
  assert.equal(acquisitionConnectionStatus([{ runtimeStatus:{ isOnline:false } }], []).label, '系统报警')
  assert.equal(acquisitionConnectionStatus(modules, [{ online:false }]).label, '系统报警')
  assert.equal(acquisitionConnectionStatus(modules, [], { legacyError:'request failed' }).state, 'unknown')
  assert.equal(acquisitionConnectionStatus(null, []).state, 'unknown')
  assert.equal(acquisitionConnectionStatus([], []).state, 'unknown')
  assert.equal(acquisitionConnectionStatus([{}], []).state, 'unknown')
})
test('MAX fan combines vibration, temperature and acoustic measurements into a single monitoring point', () => {
  const rows = [
    { member:{ source:'legacy', id:'VSE03' }, point:{ metricType:'VibrationRms', pointCode:'SE01_v_03' }, normal:true },
    { member:{ source:'legacy', id:'TEMP02' }, point:{ metricType:'Temperature', pointCode:'BEARING_TEMP_09' }, normal:true },
    { member:{ source:'monitor', id:'sound', raw:{ collectors:[{ collectorId:'max', ip:'192.168.3.52' }] } }, point:{ collectorId:'max', channelId:'CH1' }, normal:true },
    { member:{ source:'legacy', id:'PRESS02' }, point:{ metricType:'NegativePressure' }, normal:true },
  ]
  const groups = groupedMonitoringPoints(rows)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].name, 'MAX 风机')
  assert.equal(groups[0].rows.length, 3)
  assert.equal(groups[0].label, '正常')
  assert.equal(groupedMonitoringPoints(rows.map((row,index) => index === 1 ? { ...row, alarm:true, normal:false } : row))[0].label, '报警')
  assert.equal(groupedMonitoringPoints(rows.map((row,index) => index === 2 ? { ...row, normal:false } : row))[0].label, '待确认')
})
test('alarm matching and machine filtering preserve point and module identities', () => {
  const row = { member:machine.members[0], point }
  assert.equal(alarmMatchesRow({ moduleId:'VSE04', pointId:'42' }, row), true)
  assert.equal(alarmMatchesRow({ moduleId:'VSE04', pointId:43 }, row), false)
  assert.equal(alarmMatchesRow({ moduleId:'VSE05', pointId:42 }, row), false)
  assert.equal(alarmMatchesRow({ moduleId:'VSE04', pointCode:'v', channelId:'ch2' }, row), false)
  assert.equal(alarmMachineId({ moduleId:'VSE04' }), 'YB25')
  assert.equal(alarmMachineId({ moduleId:'TEMP02' }), 'ZJ117')
  assert.equal(alarmMachineId({ moduleId:'unknown' }), null)
  const events = [{ moduleId:'VSE04', pointId:42, isActive:true }]
  const rows = machineReadings(machine, { latest, now, events, alarmsReady:true })
  assert.equal(rows[0].alarm, true)
  assert.equal(rows[0].normal, false)
  assert.equal(machineHealth({ ...machine, activeAlarms:events }, rows, true).health, 'alarm')
  assert.equal(machineHealth({ ...machine, sourceId:null }, [], true).healthLabel, '未配置')
})
