import { shallowRef } from 'vue'
import { moduleNames, vibrationLocations, temperatureNames, acousticChannelNames, acousticCollectorNames } from '../config/displayNameDefaults.js'

export const DISPLAY_NAMES_KEY = 'dashboard-display-names-v1'
export const ruleKinds = { module: '采集模块', point: '采集点位', collector: '声纹采集器', channel: '声纹通道', name: '后端原名称' }
const machineOf = moduleId => ({ VSE03: 'ZJ117', TEMP02: 'ZJ117', PRESS02: 'ZJ117', VSE04: 'ZB25', VSE05: 'ZB25', TEMP03: 'ZB25', SC01: 'ZB25', PRESS01: 'ZB25', VSE08: 'YB55', TEMP01: 'YB55', SC02: 'YB55', PRESS03: 'YB55' })[moduleId] || ''
const acousticMachineOf = ip => ({ '192.168.3.51': 'ZJ117', '192.168.3.52': 'ZJ117', '192.168.3.53': 'ZB25', '192.168.3.54': 'ZB25', '192.168.3.55': 'YB55' })[ip] || ''

export function ruleKey(rule) {
  switch (rule.kind) {
    case 'module': return JSON.stringify(['module', rule.moduleId])
    case 'point': return JSON.stringify(['point', rule.moduleId, rule.pointCode, rule.metricType])
    case 'collector': return JSON.stringify(['collector', rule.ip])
    case 'channel': return JSON.stringify(['channel', rule.ip, Number(rule.channelNumber)])
    case 'name': return JSON.stringify(['name', rule.source, rule.backendName])
    default: throw new Error('未知映射类型')
  }
}

const builtInRules = [
  ...Object.entries(moduleNames).map(([moduleId, displayName]) => ({ kind: 'module', moduleId, displayName, machine: machineOf(moduleId) })),
  ...Object.entries(vibrationLocations).flatMap(([moduleId, points]) => Object.entries(points).map(([pointCode, label]) => ({ kind: 'point', moduleId, pointCode, metricType: 'VibrationRms', displayName: `${label} · 振动速度 RMS`, machine: machineOf(moduleId) }))),
  ...Object.entries(temperatureNames).flatMap(([moduleId, points]) => Object.entries(points).map(([pointCode, displayName]) => ({ kind: 'point', moduleId, pointCode, metricType: 'Temperature', displayName, machine: machineOf(moduleId), note: `temp${Number(pointCode.split('_').at(-1))}` }))),
  ...['PRESS01', 'PRESS03'].map(moduleId => ({ kind: 'point', moduleId, pointCode: '*', metricType: '*', displayName: `${machineOf(moduleId)} 负压`, machine: machineOf(moduleId), note: '该模块的测量点位' })),
  ...Object.entries(acousticCollectorNames).map(([ip, displayName]) => ({ kind: 'collector', ip, displayName, machine: acousticMachineOf(ip) })),
  ...Object.entries(acousticChannelNames).flatMap(([ip, channels]) => Object.entries(channels).map(([channelNumber, displayName]) => ({ kind: 'channel', ip, channelNumber: Number(channelNumber), displayName, machine: acousticMachineOf(ip) }))),
]

export const defaultDisplayNameRules = () => builtInRules.map(rule => ({ ...rule, id: ruleKey(rule) }))

export function validateDisplayNameRules(value) {
  if (!Array.isArray(value) || value.length > 5000) throw new Error('配置必须为映射列表，最多支持 5000 条')
  const keys = new Set()
  return value.map((entry, index) => {
    const fail = message => { throw new Error(`第 ${index + 1} 条：${message}`) }
    if (!entry || typeof entry !== 'object' || !Object.hasOwn(ruleKinds, entry.kind)) fail('请选择有效的映射类型')
    const rule = { kind: entry.kind }
    for (const field of ['moduleId', 'pointCode', 'metricType', 'ip', 'source', 'backendName', 'displayName', 'machine', 'note']) {
      rule[field] = String(entry[field] ?? '').trim()
      if (rule[field].length > 300) fail('字段长度不能超过 300 字')
    }
    if (!rule.displayName) fail('前端显示名称不能为空')
    if (['module', 'point'].includes(rule.kind) && !rule.moduleId) fail('模块编号不能为空')
    if (rule.kind === 'point' && (!rule.pointCode || !rule.metricType)) fail('点位编码和指标类型不能为空；任意值可填 *')
    if (['collector', 'channel'].includes(rule.kind) && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(rule.ip)) fail('请输入有效 IPv4 地址')
    if (['collector', 'channel'].includes(rule.kind) && rule.ip.split('.').some(part => Number(part) > 255)) fail('IP 地址各段不能超过 255')
    if (rule.kind === 'channel') {
      rule.channelNumber = Number(entry.channelNumber)
      if (!Number.isSafeInteger(rule.channelNumber) || rule.channelNumber < 1) fail('通道编号必须是正整数')
    }
    if (rule.kind === 'name' && (!['legacy', 'monitor'].includes(rule.source) || !rule.backendName)) fail('请选择来源并填写后端原名称')
    rule.id = ruleKey(rule)
    if (keys.has(rule.id)) fail('匹配条件重复，请编辑已有映射')
    keys.add(rule.id)
    return rule
  })
}

// Readable outside Vue too; the ref also makes display helpers reactive in pages.
export const displayNameRules = shallowRef(defaultDisplayNameRules())
export const displayNameStorageError = shallowRef('')

export function loadDisplayNameRules(storage = globalThis.localStorage) {
  try {
    const saved = storage?.getItem(DISPLAY_NAMES_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.version !== 1) throw new Error('配置版本不支持')
      displayNameRules.value = validateDisplayNameRules(parsed.rules)
    } else displayNameRules.value = defaultDisplayNameRules()
    displayNameStorageError.value = ''
  } catch (error) { displayNameStorageError.value = `名称配置读取失败，继续使用当前有效配置：${error.message}` }
}

export function saveDisplayNameRules(value, storage = globalThis.localStorage) {
  const rules = validateDisplayNameRules(value)
  if (!storage) throw new Error('浏览器不支持保存配置')
  storage.setItem(DISPLAY_NAMES_KEY, JSON.stringify({ version: 1, rules }))
  displayNameRules.value = rules
  displayNameStorageError.value = ''
}

export function findDisplayNameRule(kind, values = {}, configuredRules = displayNameRules.value) {
  const rules = configuredRules.filter(rule => rule.kind === kind)
  if (kind === 'point') {
    const candidates = rules.filter(rule => rule.moduleId === values.moduleId
      && (rule.pointCode === values.pointCode || rule.pointCode === '*')
      && (rule.metricType === values.metricType || (rule.metricType === '*' && !['AlarmStatus', 'SelfTestResult'].includes(values.metricType))))
    candidates.sort((a, b) => (Number(b.pointCode !== '*') * 2 + Number(b.metricType !== '*')) - (Number(a.pointCode !== '*') * 2 + Number(a.metricType !== '*')))
    return candidates[0] || null
  }
  const key = ruleKey({ ...values, kind })
  return rules.find(rule => ruleKey(rule) === key) || null
}

export function resolveDisplayName(kind, values = {}) {
  return findDisplayNameRule(kind, values)?.displayName || ''
}

loadDisplayNameRules()
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === DISPLAY_NAMES_KEY || event.key === null) loadDisplayNameRules()
})
