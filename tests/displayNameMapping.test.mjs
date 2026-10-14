import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeDisplayNameMappings, monitoringCardMappings } from '../src/charts/displayNameMapping.js'
import { validateDisplayNameRules } from '../src/services/displayNames.js'

test('settings only include mapped measurements and acoustic channels present in monitoring cards', () => {
  const rules = validateDisplayNameRules([
    { kind: 'module', moduleId: 'TEMP02', displayName: '温度模块' },
    { kind: 'point', moduleId: 'TEMP02', pointCode: 'BEARING_TEMP_07', metricType: 'Temperature', displayName: 'MAX电机温度' },
    { kind: 'point', moduleId: 'TEMP02', pointCode: 'CUSTOM_TEMP_12', metricType: 'Temperature', displayName: '不在卡片中的点位' },
    { kind: 'point', moduleId: 'TEMP02', pointCode: 'BEARING_TEMP_07', metricType: 'AlarmStatus', displayName: '告警状态' },
    { kind: 'point', moduleId: 'TEMP02', pointCode: 'BEARING_TEMP_09', metricType: 'Temperature', displayName: '未返回的温度' },
    { kind: 'collector', ip: '192.168.3.52', displayName: 'MAX采集器' },
    { kind: 'channel', ip: '192.168.3.52', channelNumber: 2, displayName: 'MAX声纹' },
    { kind: 'channel', ip: '192.168.3.99', channelNumber: 1, displayName: '归属未确认的声纹' },
  ])
  const pointRow = (code, metricType = 'Temperature') => ({ kind: 'point', moduleId: 'TEMP02', pointCode: code, metricType, raw: { moduleId: 'TEMP02', pointCode: code, metricType } })
  const channelRow = (ip, channelNumber) => ({ kind: 'channel', ip, channelNumber, device: { collectors: [{ collectorId: 'g', ip }] }, raw: { collectorId: 'g', channelId: `CH${channelNumber}` } })
  const backend = [
    { kind: 'module', moduleId: 'TEMP02' },
    pointRow('BEARING_TEMP_07'),
    pointRow('BEARING_TEMP_07', 'AlarmStatus'),
    pointRow('CUSTOM_TEMP_12'),
    pointRow('BEARING_TEMP_08'),
    { kind: 'collector', ip: '192.168.3.52' },
    channelRow('192.168.3.52', 2),
    channelRow('192.168.3.99', 1),
  ]
  const rows = monitoringCardMappings(rules, backend)
  assert.deepEqual(rows.map(row => row.displayName), ['MAX电机温度', 'MAX声纹'])
  assert.ok(rows.every(row => row.rule && row.backendRecords.length))
  assert.deepEqual(monitoringCardMappings(rules, []), [])
})

test('merged mapping rows retain offline configuration and place returned names beside their rule', () => {
  const rules = validateDisplayNameRules([
    { kind: 'point', moduleId: 'TEMP02', pointCode: 'BEARING_TEMP_07', metricType: 'Temperature', displayName: 'MAX电机温度' },
    { kind: 'collector', ip: '192.168.3.55', displayName: '辅机采集器' },
  ])
  const backend = [
    { kind: 'point', moduleId: 'TEMP02', pointCode: 'BEARING_TEMP_07', metricType: 'Temperature', backendName: '旧VE名称' },
    { kind: 'point', moduleId: 'UNKNOWN', pointCode: 'T', metricType: 'Temperature', backendName: '新温度测点' },
  ]
  const rows = mergeDisplayNameMappings(rules, backend)
  assert.equal(rows.length, 3)
  assert.equal(rows[0].rule.displayName, 'MAX电机温度')
  assert.equal(rows[0].backendRecords[0].backendName, '旧VE名称')
  assert.equal(rows[1].backendRecords.length, 0)
  assert.equal(rows[2].rule, null)
  assert.equal(rows[2].backendRecords[0].backendName, '新温度测点')
  assert.equal(mergeDisplayNameMappings(rules, []).length, rules.length)
})

test('merged view honors exact, wildcard and source-specific name priority without duplicating records', () => {
  const rules = validateDisplayNameRules([
    { kind: 'point', moduleId: 'M', pointCode: '*', metricType: '*', displayName: '通配名称' },
    { kind: 'point', moduleId: 'M', pointCode: 'T1', metricType: 'Temperature', displayName: '具体名称' },
    { kind: 'name', source: 'legacy', backendName: '原名称', displayName: '按名称配置' },
    { kind: 'channel', ip: '192.168.3.52', channelNumber: 2, displayName: 'MAX声纹' },
  ])
  const backend = [
    { kind: 'point', moduleId: 'M', pointCode: 'T1', metricType: 'Temperature', backendName: '原名称' },
    { kind: 'point', moduleId: 'M', pointCode: 'T2', metricType: 'Temperature', backendName: '温度2' },
    { kind: 'point', moduleId: 'M', pointCode: 'T3', metricType: 'Temperature', backendName: '温度3' },
    { kind: 'point', moduleId: 'OTHER', pointCode: 'T1', metricType: 'Temperature', backendName: '原名称' },
    { kind: 'channel', ip: '192.168.3.52', channelNumber: 2, backendName: '2ch-584' },
    { kind: 'channel', ip: '192.168.3.52', channelNumber: 2, backendName: '2ch-585' },
    { kind: 'collector', ip: '192.168.3.53', backendName: '原名称' },
    { kind: 'point', moduleId: 'M', pointCode: 'STATUS', metricType: 'AlarmStatus', backendName: '状态' },
  ]
  const original = JSON.stringify(backend)
  const rows = mergeDisplayNameMappings(rules, backend)
  assert.deepEqual(rows.map(row => row.backendRecords.length), [2, 1, 1, 2, 1, 1])
  assert.equal(rows.flatMap(row => row.backendRecords).length, backend.length)
  assert.equal(rows[4].rule, null)
  assert.equal(rows[5].rule, null)
  assert.equal(JSON.stringify(backend), original)
})
