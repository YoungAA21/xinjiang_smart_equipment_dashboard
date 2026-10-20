import test from 'node:test'
import assert from 'node:assert/strict'
import { isGradedAlarm, collectionAlarmKind, collectionAlarmType, alarmLevelText, alarmDirectionText,
  alarmThresholdText, filterCollectionAlarms, gradedAlarmCounts, compareAlarmPriority } from '../src/charts/gradedAlarms.js'
import { alarmColorName, alarmRuleKey } from '../src/charts/alarmColors.js'
import { queryPointAlarms } from '../src/services/pointAlarms.js'
import { alarmApi } from '../src/services/alarms.js'

const graded = (severity, extra = {}) => ({ alarmId: severity, alarmKey: 'GradedLimit', severity, status: 'Active',
  alarmDirection: 'Upper', triggerThreshold: 7.1, recoveryThreshold: 6.8, unit: 'mm/s', ...extra })

test('alarmKey determines type and nullable or unknown fields retain legacy compatibility', () => {
  assert.equal(collectionAlarmType(graded(1)), '分级报警')
  assert.equal(collectionAlarmKind({ alarmKey: 'Composite:DI01', severity: 1 }), 'composite')
  assert.equal(collectionAlarmType({ alarmKey: '', severity: 1 }), '上下限告警')
  assert.equal(collectionAlarmKind({}), 'limit')
  assert.equal(collectionAlarmKind({ alarmKey: 'FutureRule' }), 'other')
  assert.equal(isGradedAlarm({ severity: 1 }), false)
  assert.equal(alarmLevelText(graded(1, { levelName: '后端等级名称' })), '后端等级名称')
  assert.deepEqual([1, 2, 3].map(level => alarmLevelText(graded(level))), ['损坏', '告警', '提示'])
  assert.equal(alarmLevelText(graded(null)), '未知等级')
  assert.equal(alarmLevelText({ alarmKey: '', severity: null, levelName: null }), '上下限告警')
})

test('upper/lower trigger and recovery values remain distinct, preserve zero and use legacy bounds only as fallback', () => {
  assert.equal(alarmThresholdText(graded(1)), '≥ 7.1 mm/s')
  const lower = graded(2, { alarmDirection: 'Lower', triggerThreshold: 0, recoveryThreshold: 0.2 })
  assert.equal(alarmThresholdText(lower), '≤ 0 mm/s')
  assert.equal(alarmDirectionText(lower), '下限')
  assert.equal(lower.recoveryThreshold, 0.2)
  assert.equal(alarmThresholdText(graded(2, { triggerThreshold: null, thresholdMax: 4.5 })), '≥ 4.5 mm/s')
  assert.equal(alarmThresholdText(graded(2, { triggerThreshold: null })), '—')
  assert.equal(alarmThresholdText({ alarmKey: '', thresholdMin: 0, thresholdMax: 10, unit: 'A' }), '< 0 A / > 10 A')
  assert.equal(alarmThresholdText({ alarmKey: 'Composite:DI01', thresholdMax: 1 }), '—')
})

test('graded colors follow severity 1 red, 2 orange, 3 yellow and respect saved overrides', () => {
  assert.deepEqual([1, 2, 3].map(level => alarmColorName(graded(level))), ['red', 'orange', 'yellow'])
  assert.equal(alarmColorName(graded(1), { [alarmRuleKey('alarm', graded(1))]: 'orange' }), 'orange')
  assert.equal(alarmColorName(graded(1), { '["severity","1"]': 'yellow' }), 'yellow')
  assert.equal(alarmColorName(graded(1, { metricType: 'VibrationRms' }), {
    '["kind","VibrationRms"]': 'orange', '["severity","损坏"]': 'red',
  }), 'orange', 'saved metric-based kind rules must retain precedence over severity rules')
  assert.equal(alarmColorName({ alarmKey: '', metricType: 'Temperature' }, { '["kind","Temperature"]': 'red' }), 'red')
  assert.equal(alarmColorName({ severity: 'Critical' }), 'red')
})

test('local filters do not classify composite alarms by severity and summary only counts active graded rows', () => {
  const rows = [graded(1), graded(2, { alarmDirection: 'Lower' }), graded(3), graded(1, { status: 'Recovered' }), { alarmKey: 'Composite:DI', severity: 1 }]
  assert.equal(filterCollectionAlarms(rows, { kind: 'composite' }).length, 1)
  assert.equal(filterCollectionAlarms(rows, { severity: '1' }).length, 2)
  assert.equal(filterCollectionAlarms(rows, { direction: 'Lower' })[0].severity, 2)
  assert.equal(filterCollectionAlarms(rows, { kind: 'composite', severity: '1' }).length, 0)
  assert.deepEqual(gradedAlarmCounts(rows), { 1: 1, 2: 1, 3: 1 })
  assert.deepEqual(gradedAlarmCounts(null), { 1: 0, 2: 0, 3: 0 })
})

test('home priorities put damage before newer lower levels without modifying event objects', () => {
  const rows = [graded(3, { startedAt: '2026-10-19T15:00:00' }), graded(1, { startedAt: '2026-10-19T14:00:00' }), graded(2)]
  assert.deepEqual([...rows].sort(compareAlarmPriority).map(row => row.severity), [1, 2, 3])
  assert.equal(rows[0].severity, 3)
})

test('upgrade and downgrade preserve separate historical IDs, new fields and recovered events at the same point', async () => {
  const point = { moduleId: 'VSE03', channelId: 'CH1', pointCode: 'v', pointId: 51, key: 'point-51' }
  const rows = [graded(2, { ...point, alarmId: 101, status: 'Recovered', startedAt: '2026-10-19T10:00:00' }),
    graded(1, { ...point, alarmId: 102, status: 'Recovered', startedAt: '2026-10-19T10:01:00' }),
    graded(2, { ...point, alarmId: 103, startedAt: '2026-10-19T10:02:00' })]
  const result = await queryPointAlarms([point], { limit: 200 }, { fetchEvents: async () => ({ events: rows }) })
  assert.deepEqual(result.events.map(row => row.alarmId), [103, 102, 101])
  assert.equal(result.events[1].severity, 1)
  assert.equal(result.events[1].recoveryThreshold, 6.8)
  assert.equal(result.events[2].status, 'Recovered')
})

test('graded display filters are not sent as unsupported API query parameters or acoustic credentials', async t => {
  let request
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options }
    return Response.json({ events: [graded(1)] })
  })
  const body = await alarmApi.getAlarms({ isActive: true, severity: 1, alarmDirection: 'Upper', alarmKey: 'GradedLimit', limit: 500 })
  assert.equal(request.url, '/_alarm-api/api/analysis/alarms?isActive=true&limit=500')
  assert.equal(request.options.credentials, 'omit')
  assert.equal(request.options.headers.Authorization, undefined)
  assert.equal(body.events[0].recoveryThreshold, 6.8)
})
