import { machines, groupMachineDevices } from './machineGroups.js'
import { numericValue, pointKey } from './telemetry.js'
import { configuredMachineId, configuredModelId } from '../stores/pointConfiguration.js'
import { machineModel } from './machineTaxonomy.js'

// The site SVG owns physical footprints; these records own monitoring identities.
// YB25 is the display alias for the existing ZB25 mapping only.
export const lineMachines = [
  { id: 'ZJ17', sourceId: 'ZJ17', name: '卷接机' },
  { id: 'YB25', sourceId: 'ZB25', name: '小盒包装机' },
  { id: 'YB55', sourceId: 'ZB25-AUX', name: '小盒透明纸包装机' },
  { id: 'YB65', sourceId: 'ZB25-AUX', name: '硬条包装机' },
  { id: 'YB95', sourceId: 'ZB25-AUX', name: '条外透明纸包装机' },
]

export function buildLineMachines(devices, events = [], sourceErrors = {}) {
  const grouped = groupMachineDevices(devices)
  return lineMachines.map(machine => {
    const group = grouped.groups.find(group => group.id === (machine.sourceId || machine.id))
    const members = (group?.members || []).filter(member => (member.model || machineModel(machine.sourceId)) === machine.id)
    const sourceId = members.length || machineModel(machine.sourceId) === machine.id ? machine.sourceId : null
    const modules = [...(machineModel(sourceId) === machine.id ? machines.find(item => item.id === sourceId)?.modules || [] : []), ...members.filter(member => member.source === 'legacy').map(member => member.id)]
    const activeAlarms = events.filter(event => (configuredMachineId(event) ? configuredModelId(event) === machine.id : modules.includes(event.moduleId)) && (event.isActive === true || event.status === 'Active'))
    const uncertain = members.some(member => sourceErrors[member.source])
    const state = !sourceId ? 'unconfigured' : uncertain ? 'unknown' : !members.length ? 'unknown'
      : members.some(member => member.online === false) ? 'offline'
        : members.some(member => member.online !== true) ? 'unknown' : activeAlarms.length ? 'alarm' : 'online'
    const label = { unconfigured: '未配置', unknown: '状态待确认', offline: '采集离线', alarm: '存在告警', online: '采集在线' }[state]
    return { ...machine, categoryId: machine.sourceId, sourceId, members, pointCount: members.reduce((count, member) => count + member.points.length, 0), state, label, activeAlarms }
  })
}

export function readingState(point, samples, now, sourceError = false, online = true) {
  const sample = samples.filter(sample => pointKey(sample) === pointKey(point)).sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt))[0]
  const time = Date.parse(sample?.collectedAt)
  const value = numericValue(sample?.value)
  const invalid = value === null || !Number.isFinite(time) || time > now + 5000 || (sample?.quality && sample.quality !== 'Good')
  const stale = sourceError || online !== true || (!invalid && now - time > 10000)
  return { value: invalid ? null : value, sample, usable: !invalid && !stale, label: invalid ? '待采样' : stale ? '未更新' : '实时' }
}
