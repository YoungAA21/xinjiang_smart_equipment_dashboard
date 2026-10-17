// Display configuration never changes acquisition IDs, samples or engineering values.
export const defaultLocations = [
  { id: 've', name: 'VE 风机', machine: 'ZJ17', modules: ['VSE03', 'TEMP02'] },
  { id: 'max', name: 'MAX 风机', machine: 'ZJ17', modules: ['VSE03', 'TEMP02'] },
  { id: 'spider-pressure', name: '蜘蛛手负压', machine: 'ZJ17', modules: ['PRESS02'] },
  { id: 'main-motor', name: '主电机', machine: 'ZB25', modules: ['VSE04', 'VSE05', 'TEMP03', 'SC01'] },
  { id: 'cutter', name: '铝纸切刀', machine: 'ZB25', modules: ['VSE04'] },
  { id: 'seal', name: '封签', machine: 'ZB25', modules: ['VSE05'] },
  { id: 'paper-wheel', name: '齿轮箱', machine: 'ZB25', modules: [] },
  { id: 'aux-motor', name: '辅机电机', machine: 'YB55', modules: ['VSE08', 'TEMP01', 'SC02'] }
]

export const emptyConfiguration = () => ({ version: 1, locations: defaultLocations.map(item => ({ ...item, modules: [...item.modules] })), targets: [], parameters: {} })

export const normalizedPointLabel = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ')
const comparableLabel = value => normalizedPointLabel(value).replace(/\s/g, '').toLowerCase()
export const isFixedLocation = id => defaultLocations.some(location => location.id === id)

export function updateLocation(configuration, id, fields) {
  const value = validateConfiguration(configuration)
  const existing = value.locations.find(location => location.id === id)
  if (existing && isFixedLocation(id)) throw new Error('系统固定大点位不能修改')
  const name = normalizedPointLabel(fields.name)
  const machine = normalizedPointLabel(fields.machine).toUpperCase()
  if (!name || !machine) throw new Error('请输入大点位名称和所属机组')
  if (value.locations.some(location => location.id !== id && comparableLabel(location.name) === comparableLabel(name) && comparableLabel(location.machine) === comparableLabel(machine))) throw new Error('该机组下已存在同名大点位（忽略空格、大小写及全角差异）')
  if (existing) Object.assign(existing, { name, machine })
  else value.locations.push({ id, name, machine, modules: [] })
  return validateConfiguration(value)
}

export function removeLocation(configuration, id, replacementId = '') {
  const value = validateConfiguration(configuration)
  if (isFixedLocation(id)) throw new Error('系统固定大点位不能删除')
  if (!value.locations.some(location => location.id === id)) throw new Error('大点位已不存在')
  if (replacementId && (replacementId === id || !value.locations.some(location => location.id === replacementId))) throw new Error('请选择其他已有大点位作为迁移目标')
  const targetIds = new Map()
  const children = value.targets.filter(target => target.locationId === id)
  for (const target of children) {
    if (!replacementId) continue
    const matching = value.targets.find(item => item.locationId === replacementId && comparableLabel(item.name) === comparableLabel(target.name))
    if (matching) targetIds.set(target.id, matching.id)
    else { target.locationId = replacementId; targetIds.set(target.id, target.id) }
  }
  value.targets = value.targets.filter(target => target.locationId !== id && (!targetIds.has(target.id) || targetIds.get(target.id) === target.id))
  for (const [key, parameter] of Object.entries(value.parameters)) {
    if (parameter.locationId !== id) continue
    if (replacementId) Object.assign(parameter, { locationId: replacementId, targetId: targetIds.get(parameter.targetId) })
    else delete value.parameters[key]
  }
  value.locations = value.locations.filter(location => location.id !== id)
  return validateConfiguration(value)
}

export function parameterKey(point, source = 'legacy', deviceId = '') {
  if (source === 'monitor') return JSON.stringify(['monitor', String(deviceId || point.deviceId || ''), String(point.channelId ?? '')])
  return JSON.stringify(['legacy', String(point.moduleId || deviceId || ''), String(point.channelId ?? ''), String(point.pointCode || '')])
}

export function validateConfiguration(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.locations) || !Array.isArray(value.targets) || !value.parameters || typeof value.parameters !== 'object' || Array.isArray(value.parameters)) throw new Error('配置文件格式不正确')
  const unique = (rows, label) => {
    const ids = new Set()
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !row.id || typeof row.name !== 'string' || !row.name.trim() || ids.has(row.id)) throw new Error(`${label}名称或编号无效`)
      ids.add(row.id)
    }
    return ids
  }
  const locations = unique(value.locations, '大点位')
  unique(value.targets, '被测点位')
  for (const item of defaultLocations) if (!locations.has(item.id)) throw new Error('系统固定大点位不能删除')
  for (const location of value.locations) {
    if (typeof location.machine !== 'string' || !location.machine.trim() || !Array.isArray(location.modules) || location.modules.some(id => typeof id !== 'string')) throw new Error('大点位机组信息无效')
  }
  for (const target of value.targets) if (!locations.has(target.locationId)) throw new Error('被测点位必须归属于已有大点位')
  for (const [key, parameter] of Object.entries(value.parameters)) {
    let identity
    try { identity = JSON.parse(key) } catch { throw new Error('参数身份无效') }
    if (!Array.isArray(identity) || !['legacy', 'monitor'].includes(identity[0]) || identity.some(item => typeof item !== 'string') || identity.length !== (identity[0] === 'legacy' ? 4 : 3) || !identity[1] || !identity.at(-1)) throw new Error('参数身份无效')
    if (!parameter || typeof parameter.displayName !== 'string' || !parameter.displayName.trim() || typeof parameter.unit !== 'string') throw new Error('每个参数必须配置前端名称和单位（无单位可留空）')
    if (!locations.has(parameter.locationId) || !value.targets.some(target => target.id === parameter.targetId && target.locationId === parameter.locationId)) throw new Error('参数必须选择对应的大点位和被测点位')
  }
  const normalized = JSON.parse(JSON.stringify(value))
  // Migrate previously saved/imported machine assignments to the corrected model ID.
  for (const location of normalized.locations) if (location.machine === 'ZJ117') location.machine = 'ZJ17'
  return normalized
}

export function mergeDiscoveredPoints(points, latest, moduleId) {
  const rows = new Map(points.map(point => {
    const row = { ...point, moduleId: point.moduleId || moduleId }
    return [parameterKey(row), row]
  }))
  for (const sample of latest.filter(item => String(item.moduleId) === String(moduleId))) {
    const key = parameterKey(sample)
    // Samples must never overwrite the authoritative backend parameter metadata.
    if (!rows.has(key)) rows.set(key, { ...sample, discoveredFromLatest: true })
  }
  return [...rows.values()]
}
