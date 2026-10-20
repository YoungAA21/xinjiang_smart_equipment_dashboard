import { presentMonitoringPoint } from './equipmentCatalog.js'
import { alarmMachineId, isActiveAlarm } from './productionLineStatus.js'
import { configuredParameter } from '../stores/pointConfiguration.js'
import { compareAlarmPriority } from './gradedAlarms.js'

export function configuredHomeAlarms(events, machineId = '') {
  return (events || []).map(presentMonitoringPoint)
    .filter(event => event.configurationState === 'configured' && isActiveAlarm(event)
      && (!machineId || alarmMachineId(event) === machineId))
    .sort(compareAlarmPriority)
}

export function homeAlarmTarget(event) {
  const config = configuredParameter(event)
  return { path: '/device/detail', query: {
    source: 'legacy', device: String(event.moduleId), tab: 'trend',
    location: config?.locationId,
    pointId: event.pointId ?? config?.pointId,
    channelId: event.channelId, pointCode: event.pointCode,
  } }
}
