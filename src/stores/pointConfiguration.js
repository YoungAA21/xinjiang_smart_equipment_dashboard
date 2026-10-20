import { reactive } from 'vue'
import { emptyConfiguration, parameterKey, validateConfiguration } from '../charts/pointConfiguration.js'
import initialConfiguration from '../config/monitoring-parameters.json' with { type: 'json' }
import { frontendConfigurationApi } from '../services/frontendConfiguration.js'

export const configurationStorageKey = 'equipment_dashboard_point_configuration_v1'
export const configurationSyncStorageKey = `${configurationStorageKey}_sync`
export const pointConfiguration = reactive({ ...emptyConfiguration(), error: '', savedAt: '', ready: false,
  source: '', dirty: false, uploading: false, uploadedAt: '', syncError: '' })
let initialization, uploadTask, revision = 0

const contentKey = value => JSON.stringify({ version: 1, locations: value.locations, targets: value.targets,
  parameters: value.parameters, detailLocationIds: value.detailLocationIds })

function saveSyncState(storage) {
  storage?.setItem(configurationSyncStorageKey, JSON.stringify({ dirty: pointConfiguration.dirty, uploadedAt: pointConfiguration.uploadedAt }))
}

function apply(value) {
  pointConfiguration.locations.splice(0, pointConfiguration.locations.length, ...value.locations)
  pointConfiguration.targets = value.targets
  pointConfiguration.parameters = value.parameters
  pointConfiguration.detailLocationIds = value.detailLocationIds
  pointConfiguration.lineColors = value.lineColors
  pointConfiguration.savedAt = value.savedAt || ''
  pointConfiguration.error = ''
}

export function configurationSnapshot() {
  return JSON.parse(JSON.stringify({ version: 1, lineColors: pointConfiguration.lineColors, locations: pointConfiguration.locations, targets: pointConfiguration.targets, parameters: pointConfiguration.parameters, detailLocationIds: pointConfiguration.detailLocationIds }))
}

export function savePointConfiguration(value, storage = globalThis.localStorage) {
  const validated = validateConfiguration(value)
  validated.savedAt = new Date().toISOString()
  // A failed persistent write must not be reported as a successful save.
  try { storage.setItem(configurationStorageKey, JSON.stringify({ ...validated, localDraft: true })) }
  catch { throw new Error('浏览器无法保存配置，请检查存储空间或浏览器权限；本次修改尚未生效') }
  apply(validated)
  revision++
  pointConfiguration.dirty = true
  pointConfiguration.source = 'local'
  try { saveSyncState(storage) } catch { pointConfiguration.syncError = '配置已保存，但待上传状态无法缓存；请及时上传配置' }
}

// A shared promise prevents route changes from starting duplicate initialization requests.
export function initializePointConfiguration({ api = frontendConfigurationApi, storage = globalThis.localStorage } = {}) {
  if (initialization) return initialization
  initialization = (async () => {
    const startedRevision = revision
    let cached, sync = {}
    try {
      const text = storage?.getItem(configurationStorageKey)
      if (text) cached = validateConfiguration(JSON.parse(text))
    } catch { /* Invalid cache never replaces the built-in or server configuration. */ }
    try { sync = JSON.parse(storage?.getItem(configurationSyncStorageKey) || '{}') || {} } catch { /* Optional status cache. */ }
    sync = { ...sync, dirty: typeof cached?.localDraft === 'boolean' ? cached.localDraft : sync.dirty === true }
    if (cached && !sync.dirty && !Object.keys(cached.parameters).length && !cached.targets.length) cached = undefined
    pointConfiguration.uploadedAt = typeof sync.uploadedAt === 'string' ? sync.uploadedAt : ''
    const fallback = () => {
      if (revision !== startedRevision) return
      apply(cached || validateConfiguration(initialConfiguration))
      pointConfiguration.source = cached ? 'cache' : 'builtin'
      pointConfiguration.dirty = Boolean(cached && sync.dirty)
    }
    try {
      const result = await api.read()
      const remote = result === null ? null : validateConfiguration(result)
      if (revision !== startedRevision) return
      if (remote && !(cached && sync.dirty)) {
        apply(remote)
        pointConfiguration.source = 'server'
        pointConfiguration.dirty = false
        pointConfiguration.syncError = ''
        try {
          storage?.setItem(configurationStorageKey, JSON.stringify({ ...remote, localDraft: false }))
          saveSyncState(storage)
        } catch { pointConfiguration.syncError = '服务器配置已加载，但浏览器缓存写入失败' }
      } else {
        fallback()
        pointConfiguration.syncError = remote && cached && sync.dirty ? '当前保留本机待上传的修改，尚未覆盖服务器配置' : ''
      }
    } catch (error) {
      fallback()
      pointConfiguration.syncError = `服务器配置读取失败，已使用${pointConfiguration.source === 'cache' ? '本机缓存' : '内置配置'}：${error.message || '网络异常'}`
    } finally { pointConfiguration.ready = true }
  })()
  return initialization
}

export function uploadPointConfiguration({ api = frontendConfigurationApi, storage = globalThis.localStorage } = {}) {
  if (uploadTask) return uploadTask
  const value = validateConfiguration(configurationSnapshot())
  const uploadedContent = contentKey(value)
  pointConfiguration.uploading = true
  pointConfiguration.syncError = ''
  uploadTask = (async () => {
    try {
      await api.upload(value)
      pointConfiguration.uploadedAt = new Date().toISOString()
      pointConfiguration.dirty = uploadedContent !== contentKey(configurationSnapshot())
      if (!pointConfiguration.dirty) pointConfiguration.source = 'server'
      try {
        storage?.setItem(configurationStorageKey, JSON.stringify({ ...configurationSnapshot(), savedAt: pointConfiguration.savedAt, localDraft: pointConfiguration.dirty }))
        saveSyncState(storage)
      } catch { pointConfiguration.syncError = '配置已上传成功，但本机缓存写入失败' }
    } catch (error) {
      pointConfiguration.syncError = `配置尚未上传成功：${error.message || '网络异常'}，请重试`
      throw error
    } finally { pointConfiguration.uploading = false; uploadTask = undefined }
  })()
  return uploadTask
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
  if (pointConfiguration.dirty) {
    pointConfiguration.syncError = '其他页面的配置已变化，当前保留本机待上传的修改'
    return
  }
  if (!event.newValue) { apply(validateConfiguration(initialConfiguration)); pointConfiguration.source = 'builtin'; revision++; return }
  try {
    const value = validateConfiguration(JSON.parse(event.newValue))
    let sync = {}
    try { sync = JSON.parse(globalThis.localStorage?.getItem(configurationSyncStorageKey) || '{}') || {} } catch { /* Optional status cache. */ }
    apply(value)
    pointConfiguration.dirty = typeof value.localDraft === 'boolean' ? value.localDraft : sync?.dirty === true
    pointConfiguration.uploadedAt = sync?.uploadedAt || ''
    pointConfiguration.source = 'cache'
    revision++
  }
  catch { pointConfiguration.error = '其他页面的配置无效，保留当前配置' }
})
