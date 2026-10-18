import { reactive } from 'vue'
import { emptyConfiguration, parameterKey, validateConfiguration } from '../charts/pointConfiguration.js'

export const configurationStorageKey = 'equipment_dashboard_point_configuration_v1'
export const pointConfiguration = reactive({ ...emptyConfiguration(), error: '', savedAt: '' })

function apply(value) {
  pointConfiguration.locations.splice(0, pointConfiguration.locations.length, ...value.locations)
  pointConfiguration.targets = value.targets
  pointConfiguration.parameters = value.parameters
  pointConfiguration.detailLocationIds = value.detailLocationIds
  pointConfiguration.savedAt = value.savedAt || ''
  pointConfiguration.error = ''
}

export function configurationSnapshot() {
  return JSON.parse(JSON.stringify({ version: 1, locations: pointConfiguration.locations, targets: pointConfiguration.targets, parameters: pointConfiguration.parameters, detailLocationIds: pointConfiguration.detailLocationIds }))
}

export function savePointConfiguration(value, storage = globalThis.localStorage) {
  const validated = validateConfiguration(value)
  validated.savedAt = new Date().toISOString()
  // A failed persistent write must not be reported as a successful save.
  try { storage.setItem(configurationStorageKey, JSON.stringify(validated)) }
  catch { throw new Error('浏览器无法保存配置，请检查存储空间或浏览器权限；本次修改尚未生效') }
  apply(validated)
}

export function loadPointConfiguration(storage = globalThis.localStorage) {
  try {
    const text = storage?.getItem(configurationStorageKey)
    if (text) apply(validateConfiguration(JSON.parse(text)))
  } catch { pointConfiguration.error = '已保存配置读取失败，当前使用系统默认点位；请导入有效配置或重新保存' }
}

export function configuredParameter(point, source = 'legacy', deviceId = '') {
  const exact = pointConfiguration.parameters[parameterKey(point, source, deviceId)]
  if (exact || source !== 'legacy' || (point.channelId != null && point.pointCode)) return exact
  // Alarm/analysis rows may omit the channel. Only resolve an unambiguous identity.
  const candidates = Object.entries(pointConfiguration.parameters).filter(([key, config]) => {
    const identity = JSON.parse(key)
    return identity[0] === 'legacy' && identity[1] === String(point.moduleId || deviceId || '')
      && (point.channelId == null || identity[2] === String(point.channelId))
      && (point.pointId != null && config.pointId != null ? String(config.pointId) === String(point.pointId) : point.pointCode && identity[3] === point.pointCode)
  })
  return candidates.length === 1 ? candidates[0][1] : undefined
}

export function presentPoint(point, source = 'legacy', deviceId = '') {
  const config = configuredParameter(point, source, deviceId)
  const location = pointConfiguration.locations.find(item => item.id === config?.locationId)
  const backendName = point.backendName ?? point.name ?? point.channelName ?? point.pointCode ?? point.channelId ?? ''
  const backendUnit = point.backendUnit ?? point.unit ?? ''
  return { ...point, backendName, backendUnit, name: backendName, unit: backendUnit,
    ...(source === 'monitor' ? { channelName: backendName } : {}),
    locationId: config?.locationId || '', targetId: config?.targetId || '',
    machineId: location?.machine || '', modelId: location?.model || '',
    ...(config ? { name: config.displayName, channelName: config.displayName, unit: config.unit, locationId: config.locationId, targetId: config.targetId } : {}),
    configurationState: config ? 'configured' : 'unconfigured',
  }
}

export function targetName(point, source = 'legacy', deviceId = '') {
  const config = configuredParameter(point, source, deviceId)
  return pointConfiguration.targets.find(target => target.id === config?.targetId)?.name || ''
}

export function configuredMachineId(point) {
  const config = configuredParameter(point)
  const machine = pointConfiguration.locations.find(location => location.id === config?.locationId)?.machine
  return machine && !machine.includes('/') ? machine : ''
}

export function configuredModelId(point, source = 'legacy', deviceId = '') {
  const config = configuredParameter(point, source, deviceId)
  return pointConfiguration.locations.find(location => location.id === config?.locationId)?.model || ''
}

loadPointConfiguration()
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== configurationStorageKey && event.key !== null) return
  if (!event.newValue) { apply(emptyConfiguration()); return }
  try { apply(validateConfiguration(JSON.parse(event.newValue))) }
  catch { pointConfiguration.error = '其他页面的配置无效，保留当前配置' }
})
