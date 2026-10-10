import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isVibrationPoint, moduleDisplayName, monitoringPointName, sortMonitoringModules, sortMonitoringPoints } from '../src/charts/equipmentCatalog.js'

test('documented vibration modules and measuring locations have readable equipment labels', () => {
  assert.match(moduleDisplayName({ moduleId: 'VSE03', moduleName: '振动采集模块' }), /ZJ117.*振动/)
  assert.match(moduleDisplayName({ moduleId: 'VSE04', moduleName: '振动采集模块' }), /ZB25.*振动/)
  assert.match(moduleDisplayName({ moduleId: 'VSE05', moduleName: '振动采集模块' }), /ZB25.*振动/)
  assert.match(moduleDisplayName({ moduleId: 'VSE08', moduleName: '振动采集模块' }), /YB65.*振动/)
  assert.equal(monitoringPointName({ moduleId: 'VSE03', pointCode: 'SE01_v_02', metricType: 'VibrationRms', name: 'SE01 VE电机v-RMS02频域' }), 'VE 风机电机驱动端 · 振动速度 RMS')
  assert.equal(monitoringPointName({ moduleId: 'VSE04', pointCode: 'SE04_v_03', metricType: 'VibrationRms' }), '封签部件 Y 轴 · 振动速度 RMS')
  assert.equal(monitoringPointName({ moduleId: 'VSE05', pointCode: 'SE05_v_04', metricType: 'VibrationRms' }), '铝纸切刀 Z 轴 · 振动速度 RMS')
  assert.equal(monitoringPointName({ moduleId: 'VSE08', pointCode: 'SE08_v_02', metricType: 'VibrationRms' }), '辅机电机驱动端 · 振动速度 RMS')
  assert.equal(monitoringPointName({ moduleId: 'VSE08', pointCode: 'SE08_v_01', metricType: 'VibrationRms', name: '辅机皮带轴' }), '辅机皮带轴')
})

test('vibration measurements appear before status points without altering API identities', () => {
  const modules = [{ moduleId: 'TEMP02' }, { moduleId: 'VSE03' }, { moduleId: 'VSE04' }]
  assert.deepEqual(sortMonitoringModules(modules).map(module => module.moduleId), ['VSE03', 'VSE04', 'TEMP02'])
  assert.equal(modules[0].moduleId, 'TEMP02')
  const alarm = { pointId: 1, metricType: 'AlarmStatus' }
  const rms = { pointId: 2, metricType: 'VibrationRms' }
  const temperature = { pointId: 3, metricType: 'Temperature' }
  const unbalance = { pointId: 4, metricType: 'VibrationUnbalance' }
  const points = [alarm, temperature, rms, unbalance]
  assert.deepEqual(sortMonitoringPoints(points).map(point => point.pointId), [2, 4, 3, 1])
  assert.deepEqual(points.map(point => point.pointId), [1, 3, 2, 4])
  assert.equal(isVibrationPoint(unbalance), true)
  assert.equal(isVibrationPoint(alarm), false)
})
