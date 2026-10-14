import { configuredParameter, presentPoint } from '../stores/pointConfiguration.js'
import { mergeDiscoveredPoints } from './pointConfiguration.js'
// Supplied installation labels are suggestions until explicitly configured.
const moduleNames = {
  VSE03: 'ZJ117 卷接机 · VE/MAX 风机振动',
  VSE04: 'ZB25 小盒包装机 · 电机与铝纸切刀振动',
  VSE05: 'ZB25 小盒包装机 · 主传动与封签振动',
  VSE08: 'YB55 硬条包装机 · 辅机振动',
  TEMP01: 'YB55 硬条包装机 · 辅机温度',
  TEMP02: 'ZJ117 卷接机 · VE/MAX 风机温度',
  TEMP03: 'ZB25 小盒包装机 · 主传动温度',
  PRESS01: 'ZB25 小盒包装机 · 负压',
  PRESS03: 'YB55 硬条包装机 · 主负压源',
  PRESS02: 'ZJ117 卷接机 · 蜘蛛手负压',
  SC01: 'ZB25 小盒包装机 · 主电机控制',
  SC02: 'YB55 硬条包装机 · 辅机控制',
}

const vibrationLocations = {
  VSE03: {
    SE01_v_01: 'VE 风机轴承座',
    SE01_v_02: 'VE 风机电机驱动端',
    SE01_v_03: 'MAX 风机轴承座',
    SE01_v_04: 'MAX 风机电机驱动端',
  },
  // Confirmed document: SE04 is the cutter; SE05 is the sealing component.
  // Translate display labels only; preserve point IDs, codes, axis suffixes and samples.
  VSE04: {
    SE04_v_01: '主电机驱动端',
    SE04_v_02: '铝纸切刀 X 轴',
    SE04_v_03: '铝纸切刀 Y 轴',
    SE04_v_04: '铝纸切刀 Z 轴',
  },
  VSE05: {
    SE05_v_01: '皮带轮轴承座',
    SE05_v_02: '封签部件 X 轴',
    SE05_v_03: '封签部件 Y 轴',
    SE05_v_04: '封签部件 Z 轴',
  },
  VSE08: {
    SE08_v_02: '辅机电机驱动端',
  },
}

export const moduleDisplayName = module => moduleNames[module?.moduleId] || module?.moduleName || module?.moduleId || ''

export const isVibrationModule = module => module?.moduleId?.startsWith('VSE') || module?.moduleName?.includes('振动') || false

export const sortMonitoringModules = modules => [...modules].sort((a, b) => Number(isVibrationModule(b)) - Number(isVibrationModule(a)))

export function monitoringPointName(point) {
  const configured = configuredParameter(point || {})
  if (configured) return configured.displayName
  const location = vibrationLocations[point?.moduleId]?.[point?.pointCode]
  const name = location && point.metricType === 'VibrationRms' ? `${location} · 振动速度 RMS` : point?.backendName || point?.name || point?.pointCode || ''
  return `${name}${point?.configurationState === 'unconfigured' ? ' · 未配置' : ''}`
}

export const isVibrationPoint = point => point?.metricType === 'VibrationRms' || point?.metricType === 'VibrationUnbalance'

export const isMeasurementPoint = point => !['AlarmStatus', 'SelfTestResult'].includes(point?.metricType)

export function sortMonitoringPoints(points = []) {
  const priority = point => isVibrationPoint(point) ? 0 : ['AlarmStatus', 'SelfTestResult'].includes(point?.metricType) ? 2 : 1
  return [...points].sort((a, b) => priority(a) - priority(b))
}

export const presentMonitoringPoint = point => {
  const presented = presentPoint(point)
  return { ...presented, name: monitoringPointName(presented) }
}
export function configuredMonitoringPoints(points = [], latest = [], moduleId = '') {
  return sortMonitoringPoints(mergeDiscoveredPoints(points, latest, moduleId).map(presentMonitoringPoint))
}

export function discoveredMonitoringModules(modules = [], latest = []) {
  const rows = new Map(modules.map(module => [String(module.moduleId), module]))
  for (const sample of latest) {
    if (!sample.moduleId || rows.has(String(sample.moduleId))) continue
    rows.set(String(sample.moduleId), { moduleId: sample.moduleId, moduleName: sample.moduleId, discoveredFromLatest: true })
  }
  return [...rows.values()]
}
