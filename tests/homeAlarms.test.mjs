import test from 'node:test'
import assert from 'node:assert/strict'
import { configuredHomeAlarms, homeAlarmTarget } from '../src/charts/homeAlarms.js'
import { pointConfiguration } from '../src/stores/pointConfiguration.js'
import { parameterKey } from '../src/charts/pointConfiguration.js'

const point = { moduleId: 'VSE03', channelId: 'CH1', pointCode: 'SE01_v_01', pointId: 51 }

test('home alarms hide unconfigured points, preserve active configured events and follow configuration changes', t => {
  const original = pointConfiguration.parameters
  t.after(() => { pointConfiguration.parameters = original })
  pointConfiguration.parameters = { [parameterKey(point)]: { displayName: 'VE 风机振动', locationId: 've', targetId: 'bearing', pointId: 51, unit: 'mm/s' } }
  const active = { ...point, status: 'Active', startedAt: '2026-10-16T12:45:00' }
  const older = { ...active, alarmId: 2, startedAt: '2026-10-16T12:40:00' }
  const events = [older, { ...active, pointCode: 'SE01_s_06', pointId: 52 }, { ...active, status: 'Recovered' }, active]
  const rows = configuredHomeAlarms(events)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, 'VE 风机振动')
  assert.equal(rows[0].startedAt, active.startedAt)
  assert.equal(configuredHomeAlarms(events, 'YB55').length, 0)
  assert.equal(configuredHomeAlarms(events, 'ZJ17').length, 2)
  assert.deepEqual(homeAlarmTarget(rows[0]), { path: '/device/detail', query: {
    source: 'legacy', device: 'VSE03', tab: 'trend', location: 've', pointId: 51, channelId: 'CH1', pointCode: 'SE01_v_01',
  } })
  delete pointConfiguration.parameters[parameterKey(point)]
  assert.equal(configuredHomeAlarms(events).length, 0)
  assert.deepEqual(configuredHomeAlarms(null), [])
})

test('alarm identity without channel resolves only an unambiguous configured point and retains its point ID', t => {
  const original = pointConfiguration.parameters
  t.after(() => { pointConfiguration.parameters = original })
  const config = { displayName: '振动', locationId: 've', targetId: 'bearing', pointId: 51, unit: 'mm/s' }
  pointConfiguration.parameters = { [parameterKey(point)]: config }
  const event = { moduleId: 'VSE03', pointCode: 'SE01_v_01', status: 'Active' }
  const rows = configuredHomeAlarms([event])
  assert.equal(rows.length, 1)
  assert.equal(homeAlarmTarget(rows[0]).query.pointId, 51)
  pointConfiguration.parameters[parameterKey({ ...point, channelId: 'CH2' })] = { ...config, pointId: 52 }
  assert.equal(configuredHomeAlarms([event]).length, 0)
})
