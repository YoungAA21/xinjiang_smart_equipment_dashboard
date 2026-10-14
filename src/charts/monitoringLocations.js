import { isMeasurementPoint, monitoringPointName } from './equipmentCatalog.js'
import { acousticPointIp } from './pointAddress.js'

// Physical monitoring locations, distinct from individual sensor measurements.
export const monitoringLocations = [
  { id: 've', name: 'VE 风机', machine: 'ZJ117', modules: ['VSE03', 'TEMP02'] },
  { id: 'max', name: 'MAX 风机', machine: 'ZJ117', modules: ['VSE03', 'TEMP02'] },
  { id: 'spider-pressure', name: '蜘蛛手负压', machine: 'ZJ117', modules: ['PRESS02'] },
  { id: 'main-motor', name: '主电机', machine: 'ZB25', modules: ['VSE04', 'VSE05', 'TEMP03', 'SC01'] },
  { id: 'cutter', name: '铝纸切刀', machine: 'ZB25', modules: ['VSE04'] },
  { id: 'seal', name: '封签', machine: 'ZB25', modules: ['VSE05'] },
  { id: 'paper-wheel', name: '齿轮箱', machine: 'ZB25', modules: [] },
  { id: 'aux-motor', name: '辅机电机', machine: 'YB55', modules: ['VSE08', 'TEMP01', 'SC02'] },
  { id: 'pressure', name: '负压', machine: 'ZB25 / YB55', modules: ['PRESS01', 'PRESS03'] },
]

export function monitoringLocationOf(member, point) {
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
      if (['BEARING_TEMP_09', 'BEARING_TEMP_10'].includes(code)) return 've'
      if (['BEARING_TEMP_07', 'BEARING_TEMP_08'].includes(code)) return 'max'
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
  // Distinguish the two pressure sources without changing their actual identities.
  if (['PRESS01', 'PRESS03'].includes(point.moduleId)) return { ...point, name: monitoringPointName(point) }
  return point
}
