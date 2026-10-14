import test from 'node:test'
import assert from 'node:assert/strict'
import { computed } from 'vue'
import { DISPLAY_NAMES_KEY, defaultDisplayNameRules, displayNameRules, displayNameStorageError, loadDisplayNameRules, saveDisplayNameRules, validateDisplayNameRules } from '../src/services/displayNames.js'
import { moduleDisplayName, monitoringPointName } from '../src/charts/equipmentCatalog.js'
import { acousticChannelDisplayName, acousticCollectorDisplayName } from '../src/charts/machineGroups.js'
import { mergeGatewayInventory } from '../src/charts/gatewayCatalog.js'

const memoryStorage = () => {
  const entries = new Map()
  return { getItem: key => entries.get(key) || null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }
}
const reset = () => { displayNameRules.value = defaultDisplayNameRules(); displayNameStorageError.value = '' }

test('saved names survive reload and update monitoring, acoustic and gateway consumers reactively', () => {
  reset()
  try {
    const storage = memoryStorage()
    const point = Object.freeze({ moduleId: 'TEMP02', pointCode: 'BEARING_TEMP_07', metricType: 'Temperature', pointId: 70, channelId: 't', value: 45, name: '旧名称' })
    const device = { collectors: [{ collectorId: 5, ip: '192.168.3.52' }] }
    const channel = Object.freeze({ collectorId: '5', channelId: '584', name: 'svt collector 2ch-192.168.3.52-584' })
    const pointLabel = computed(() => monitoringPointName(point))
    const channelLabel = computed(() => acousticChannelDisplayName(device, channel))
    const gatewayLabel = computed(() => mergeGatewayInventory().find(row => row.key === 'legacy:TEMP02').name)
    assert.equal(pointLabel.value, 'MAX电机温度')
    assert.equal(channelLabel.value, 'MAX 风机整体声纹')
    assert.equal(gatewayLabel.value, 'VE/MAX 风机温度')
    const rules = defaultDisplayNameRules()
    rules.find(row => row.kind === 'point' && row.pointCode === point.pointCode).displayName = '已配置的温度'
    rules.find(row => row.kind === 'channel' && row.ip === '192.168.3.52' && row.channelNumber === 2).displayName = '已配置的声纹'
    rules.find(row => row.kind === 'module' && row.moduleId === 'TEMP02').displayName = 'ZJ117 · 已配置模块'
    rules.find(row => row.kind === 'collector' && row.ip === '192.168.3.52').displayName = '已配置采集器'
    saveDisplayNameRules(rules, storage)
    assert.equal(pointLabel.value, '已配置的温度')
    assert.equal(channelLabel.value, '已配置的声纹')
    assert.equal(gatewayLabel.value, '已配置模块')
    assert.equal(acousticCollectorDisplayName('192.168.3.52'), '已配置采集器')
    reset()
    loadDisplayNameRules(storage)
    assert.equal(pointLabel.value, '已配置的温度')
    assert.equal(channelLabel.value, '已配置的声纹')
    assert.equal(point.value, 45)
    assert.equal(channel.channelId, '584')
    assert.equal(moduleDisplayName({ moduleId: 'TEMP02' }), 'ZJ117 · 已配置模块')
  } finally { reset() }
})

test('invalid or duplicate imported conditions and failed writes never replace effective configuration', () => {
  reset()
  try {
    const rules = defaultDisplayNameRules()
    const storage = memoryStorage()
    const original = displayNameRules.value
    assert.throws(() => saveDisplayNameRules([...rules, { ...rules[0], displayName: '重复' }], storage), /重复/)
    assert.throws(() => validateDisplayNameRules([{ kind: 'channel', ip: '999.0.0.1', channelNumber: 1, displayName: '测试' }]), /255/)
    assert.throws(() => validateDisplayNameRules([{ kind: 'point', moduleId: 'TEMP02', displayName: '测试' }]), /点位编码/)
    assert.throws(() => saveDisplayNameRules(rules, { setItem() { throw new Error('QuotaExceeded') } }), /QuotaExceeded/)
    assert.equal(displayNameRules.value, original)
    storage.setItem(DISPLAY_NAMES_KEY, JSON.stringify({ version: 1, rules: [{ kind: 'invalid' }] }))
    loadDisplayNameRules(storage)
    assert.equal(displayNameRules.value, original)
    assert.match(displayNameStorageError.value, /读取失败/)
  } finally { reset() }
})

test('exact point mappings beat wildcard and name fallback, and deleting a mapping reveals backend names', () => {
  reset()
  try {
    const storage = memoryStorage()
    const base = { moduleId: 'CUSTOM', pointCode: 'TEMP_A', metricType: 'Temperature', name: '后端温度' }
    saveDisplayNameRules([
      { kind: 'point', moduleId: 'CUSTOM', pointCode: '*', metricType: '*', displayName: '模块测量名称' },
      { kind: 'point', moduleId: 'CUSTOM', pointCode: 'TEMP_A', metricType: 'Temperature', displayName: '准确点位名称' },
      { kind: 'name', source: 'legacy', backendName: '后端温度', displayName: '名称兜底' },
      { kind: 'name', source: 'monitor', backendName: '未知声纹', displayName: '新声纹名称' },
    ], storage)
    assert.equal(monitoringPointName(base), '准确点位名称')
    assert.equal(monitoringPointName({ ...base, pointCode: 'OTHER' }), '模块测量名称')
    assert.equal(monitoringPointName({ ...base, moduleId: 'OTHER' }), '名称兜底')
    assert.equal(monitoringPointName({ ...base, metricType: 'AlarmStatus', name: '告警状态' }), '告警状态')
    assert.equal(acousticChannelDisplayName({}, { channelId: 'x', name: '未知声纹' }), '新声纹名称')
    saveDisplayNameRules([], storage)
    assert.equal(monitoringPointName(base), '后端温度')
    assert.equal(acousticChannelDisplayName({}, { channelId: 'x', name: '未知声纹' }), '未知声纹')
    storage.removeItem(DISPLAY_NAMES_KEY)
    loadDisplayNameRules(storage)
    assert.equal(displayNameRules.value.length, defaultDisplayNameRules().length)
  } finally { reset() }
})
