import { resolveDisplayName } from '../services/displayNames.js'

export const moduleDisplayName = module => resolveDisplayName('module', { moduleId: module?.moduleId })
  || resolveDisplayName('name', { source: 'legacy', backendName: module?.moduleName })
  || module?.moduleName || module?.moduleId || ''

export const isVibrationModule = module => module?.moduleId?.startsWith('VSE') || module?.moduleName?.includes('振动') || false

export const sortMonitoringModules = modules => [...modules].sort((a, b) => Number(isVibrationModule(b)) - Number(isVibrationModule(a)))

export function monitoringPointName(point) {
  const configured = resolveDisplayName('point', point) || resolveDisplayName('name', { source: 'legacy', backendName: point?.name })
  if (configured) return configured
  return point?.name || point?.pointCode || ''
}

export const isVibrationPoint = point => point?.metricType === 'VibrationRms' || point?.metricType === 'VibrationUnbalance'

export const isMeasurementPoint = point => !['AlarmStatus', 'SelfTestResult'].includes(point?.metricType)

export function sortMonitoringPoints(points = []) {
  const priority = point => isVibrationPoint(point) ? 0 : ['AlarmStatus', 'SelfTestResult'].includes(point?.metricType) ? 2 : 1
  return [...points].sort((a, b) => priority(a) - priority(b))
}
