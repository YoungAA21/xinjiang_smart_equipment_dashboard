import { parameterKey } from './pointConfiguration.js'
import { machineCategories, machineCategoryName } from './machineTaxonomy.js'

export function configuredAlarmPoints(configuration, metadata = {}) {
  return Object.entries(configuration.parameters).flatMap(([key, parameter]) => {
    const [source, moduleId, channelId, pointCode] = JSON.parse(key)
    if (source !== 'legacy') return []
    const location = configuration.locations.find(item => item.id === parameter.locationId)
    const target = configuration.targets.find(item => item.id === parameter.targetId && item.locationId === location?.id)
    if (!location || !target) return []
    const point = (metadata[moduleId] || []).find(item => parameterKey({ ...item, moduleId }) === key)
    return [{ ...point, key, moduleId, channelId, pointCode,
      pointId: point?.pointId, codeUnique: (metadata[moduleId] || []).filter(item => item.pointCode === pointCode).length === 1,
      name: parameter.displayName, unit: parameter.unit,
      machineId: location.machine, machineName: machineCategoryName(location.machine), modelId: location.model,
      locationId: location.id, locationName: location.name, targetId: target.id, targetName: target.name }]
  })
}

const dimensions = ['machineId', 'modelId', 'locationId', 'targetId', 'parameterId']
export function filterAlarmPoints(points, scope, depth = dimensions.length) {
  return points.filter(point => dimensions.slice(0, depth).every(key => !scope[key] || scope[key] === (key === 'parameterId' ? point.key : point[key])))
}

export function alarmPointOptions(points, scope) {
  const options = (depth, id, label) => [...new Map(filterAlarmPoints(points, scope, depth).map(point => [point[id], { id: point[id], name: label(point) }])).values()]
  const locationLabel = point => scope.modelId ? point.locationName : `${point.machineName} / ${point.modelId} / ${point.locationName}`
  const targetLabel = point => scope.locationId ? point.targetName : `${locationLabel(point)} / ${point.targetName}`
  const parameterRows = filterAlarmPoints(points, scope, 4)
  return {
    machineId: machineCategories.filter(machine => points.some(point => point.machineId === machine.id)),
    modelId: options(1, 'modelId', point => point.modelId),
    locationId: options(2, 'locationId', locationLabel),
    targetId: options(3, 'targetId', targetLabel),
    parameterId: options(4, 'key', point => {
      const name = scope.targetId ? point.name : `${targetLabel(point)} / ${point.name}`
      return parameterRows.some(other => other.key !== point.key && other.targetId === point.targetId && other.name === point.name)
        ? `${name} · ${point.moduleId} / ${point.channelId} / ${point.pointCode}` : name
    }),
  }
}

export function normalizeAlarmScope(points, scope, changed = '') {
  const next = { ...scope }
  if (changed) for (const key of dimensions.slice(dimensions.indexOf(changed) + 1)) next[key] = ''
  for (const key of dimensions) {
    if (next[key] && !alarmPointOptions(points, next)[key].some(item => item.id === next[key])) next[key] = ''
  }
  return next
}

export function selectNextAlarmScope(points, scope, changed) {
  const next = normalizeAlarmScope(points, scope, changed)
  const index = dimensions.indexOf(changed)
  if (index < 0 || !next[changed]) return next
  for (const key of dimensions.slice(index + 1)) next[key] = alarmPointOptions(points, next)[key][0]?.id || ''
  return next
}

export function alarmScopeLabel(points, scope) {
  const options = alarmPointOptions(points, scope)
  return dimensions.map(key => options[key].find(item => item.id === scope[key])?.name).filter(Boolean).join(' / ') || '全部已配置设备点位'
}

export function alarmEventPoint(event, point) {
  if (event.moduleId != null && String(event.moduleId) !== String(point.moduleId)) return null
  if (event.pointId != null) {
    if (String(event.pointId) !== String(point.pointId)) return null
  } else {
    if (!event.pointCode || event.pointCode !== point.pointCode) return null
    if (event.channelId == null && !point.codeUnique) return null
    if (event.channelId != null && String(event.channelId) !== String(point.channelId)) return null
  }
  return { ...event, moduleId: point.moduleId, pointId: point.pointId,
    channelId: event.channelId ?? point.channelId, pointCode: event.pointCode ?? point.pointCode,
    name: point.name, unit: event.unit ?? point.unit,
    machineName: point.machineName, modelId: point.modelId, locationName: point.locationName, targetName: point.targetName,
    configurationKey: point.key }
}

export function alarmChartGroups(events) {
  const groups = new Map()
  for (const event of events) {
    const id = JSON.stringify([event.configurationKey, event.unit || ''])
    if (!groups.has(id)) groups.set(id, { id, name: `${event.locationName} / ${event.targetName} / ${event.name}${event.unit ? `（${event.unit}）` : ''}`, events: [] })
    groups.get(id).events.push(event)
  }
  return [...groups.values()]
}
