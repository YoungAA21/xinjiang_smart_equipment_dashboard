// Installation locations come from the supplied point list; metric values and units stay with the API.
const moduleNames = {
  VSE03: 'ZJ117 卷接机 · VE/MAX 风机振动',
  VSE04: 'ZB25 小盒包装机 · 电机与封签振动',
  VSE05: 'ZB25 小盒包装机 · 轴承与铝纸切刀振动',
  VSE08: 'YB65 硬条包装机 · 辅机振动',
  TEMP01: 'YB65 硬条包装机 · 辅机温度',
  TEMP02: 'ZJ117 卷接机 · VE/MAX 风机温度',
  TEMP03: 'ZB25 小盒包装机 · 主传动温度',
  PRESS02: 'ZJ117 卷接机 · 蜘蛛手负压',
  SC01: 'ZB25 小盒包装机 · 主电机控制',
  SC02: 'YB65 硬条包装机 · 辅机控制',
}

const vibrationLocations = {
  VSE03: {
    SE01_v_01: 'VE 风机轴承座',
    SE01_v_02: 'VE 风机电机驱动端',
    SE01_v_03: 'MAX 风机轴承座',
    SE01_v_04: 'MAX 风机电机驱动端',
  },
  VSE04: {
    SE04_v_01: '主电机驱动端',
    SE04_v_02: '封签部件 X 轴',
    SE04_v_03: '封签部件 Y 轴',
    SE04_v_04: '封签部件 Z 轴',
  },
  VSE05: {
    SE05_v_01: '皮带轮轴承座',
    SE05_v_02: '铝纸切刀 X 轴',
    SE05_v_03: '铝纸切刀 Y 轴',
    SE05_v_04: '铝纸切刀 Z 轴',
  },
  VSE08: {
    SE08_v_02: '辅机电机驱动端',
  },
}

export const moduleDisplayName = module => moduleNames[module?.moduleId] || module?.moduleName || module?.moduleId || ''

export const isVibrationModule = module => module?.moduleId?.startsWith('VSE') || module?.moduleName?.includes('振动') || false

export const sortMonitoringModules = modules => [...modules].sort((a, b) => Number(isVibrationModule(b)) - Number(isVibrationModule(a)))

export function monitoringPointName(point) {
  const location = vibrationLocations[point?.moduleId]?.[point?.pointCode]
  if (location && point.metricType === 'VibrationRms') return `${location} · 振动速度 RMS`
  return point?.name || point?.pointCode || ''
}

export const isVibrationPoint = point => point?.metricType === 'VibrationRms' || point?.metricType === 'VibrationUnbalance'

export function sortMonitoringPoints(points = []) {
  const priority = point => isVibrationPoint(point) ? 0 : ['AlarmStatus', 'SelfTestResult'].includes(point?.metricType) ? 2 : 1
  return [...points].sort((a, b) => priority(a) - priority(b))
}
