import { isMeasurementPoint } from './equipmentCatalog.js'
import { acousticPointIp } from './pointAddress.js'
import { configuredParameter, pointConfiguration, presentPoint } from '../stores/pointConfiguration.js'

// Physical monitoring locations, distinct from individual sensor measurements.
export const monitoringLocations = pointConfiguration.locations

export function monitoringLocationOf(member, point) {
  const configured = configuredParameter(point, member.source, member.id)
  if (configured) return configured.locationId
  return suggestedMonitoringLocationOf(member, point)
}

export function suggestedMonitoringLocationOf(member, point) {
  if (member.source === 'monitor') {
    const ip = acousticPointIp(member.raw, point)
    // Collector assignments follow the latest installation IP table.
    if (ip === '192.168.3.51') return 've'
    if (ip === '192.168.3.52') return 'max'
    if (ip === '192.168.3.53') return 'main-motor'
    if (ip === '192.168.3.54') return 'paper-wheel'
    if (ip === '192.168.3.55') return 'aux-motor'
    return null
  }
  if (!isMeasurementPoint(point)) return null
  const code = point.pointCode || ''
  const suffix = code.match(/_v_(\d+)$/)?.[1]
  switch (member.id) {
    case 'VSE03':
      if (['01', '02', '08', '09'].includes(suffix)) return 've'
      if (['03', '04', '10', '11'].includes(suffix)) return 'max'
      return null
    case 'TEMP02':
      if (['BEARING_TEMP_07', 'BEARING_TEMP_08'].includes(code)) return 've'
      if (['BEARING_TEMP_09', 'BEARING_TEMP_10'].includes(code)) return 'max'
      return null
    case 'PRESS02': return 'spider-pressure'
    case 'VSE04':
    case 'VSE05':
      if (['01', '08'].includes(suffix)) return 'main-motor'
      if (['02', '03', '04'].includes(suffix)) return member.id === 'VSE04' ? 'cutter' : 'seal'
      return null
    case 'TEMP03':
    case 'SC01': return 'main-motor'
    case 'VSE08':
    case 'TEMP01':
    case 'SC02': return 'aux-motor'
    case 'PRESS01':
    case 'PRESS03': return 'pressure'
    default: return null
  }
}

export function locationPoint(point) {
  const configured = presentPoint(point)
  if (configured.configurationState === 'configured') return configured
  // Distinguish the two pressure sources without changing their actual identities.
  if (point.moduleId === 'PRESS01') return { ...configured, name: 'ZB25 负压' }
  if (point.moduleId === 'PRESS03') return { ...configured, name: 'YB55 负压' }
  return configured
}
