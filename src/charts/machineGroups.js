import { configuredParameter, pointConfiguration, presentPoint } from '../stores/pointConfiguration.js'
import { monitoringLocationOf } from './monitoringLocations.js'

export const machines = [
  { id: 'ZJ117', name: 'ZJ117 卷接机', modules: ['VSE03', 'TEMP02', 'PRESS02'] },
  { id: 'ZB25', name: 'ZB25 小盒包装机', modules: ['VSE04', 'VSE05', 'TEMP03', 'SC01', 'PRESS01'] },
  { id: 'YB55', name: 'YB55 硬条包装机', modules: ['VSE08', 'TEMP01', 'SC02', 'PRESS03'] },
]
export const acousticHosts = {
  '192.168.3.51': 'ZJ117', '192.168.3.52': 'ZJ117',
  '192.168.3.53': 'ZB25', '192.168.3.54': 'ZB25', '192.168.3.55': 'YB55',
}
const acousticChannelNames = {
  '192.168.3.51': { 1: 'VE 风机电机声纹', 2: 'VE 风机整体声纹' },
  '192.168.3.52': { 1: 'MAX 风机电机声纹', 2: 'MAX 风机整体声纹' },
  '192.168.3.53': { 1: '主机主电机声纹 · 通道1', 2: '主机主电机声纹 · 通道2' },
  '192.168.3.54': { 1: '齿轮箱声纹 · 通道1', 2: '齿轮箱声纹 · 通道2' },
  '192.168.3.55': { 1: '辅机主电机声纹 · 通道1', 2: '辅机主电机声纹 · 通道2' },
}
const acousticCollectorNames = {
  '192.168.3.51': 'VE 风机采集器',
  '192.168.3.52': 'MAX 风机采集器',
  '192.168.3.53': '主机主电机采集器',
  '192.168.3.54': '齿轮箱采集器',
  '192.168.3.55': '辅机主电机采集器',
}
export function acousticCollectorDisplayName(ip, fallback = '') {
  return acousticCollectorNames[ip] || fallback || ip || '声纹采集器'
}
export function acousticChannelDisplayName(device, channel) {
  const configured = configuredParameter(channel || {}, 'monitor', device?.deviceId || device?.id)
  if (configured) return configured.displayName
  const collectors = device?.collectors || []
  const collector = collectors.find(item => channel?.collectorId != null && String(item.collectorId) === String(channel.collectorId))
    || (collectors.length === 1 ? collectors[0] : null)
  const text = `${channel?.channelId || ''} ${channel?.channelName || ''} ${channel?.name || ''}`
  const ip = collector?.ip || text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || device?.ip || ''
  const channelNumber = Number(text.match(/(\d+)\s*ch(?:annel)?(?:[-_\s]|$)/i)?.[1]
    || text.match(/(?:^|[^a-z0-9])ch(?:annel)?[-_ ]?(\d+)(?:$|[^0-9])/i)?.[1]
    || text.match(/通道\s*(\d+)/)?.[1]
    || text.match(/^(\d+)$/)?.[1])
  const name = acousticChannelNames[ip]?.[channelNumber]
    || channel?.name || channel?.channelName || channel?.channelId || ''
  return `${name}${channel?.configurationState === 'unconfigured' ? ' · 未配置' : ''}`
}
export const presentAcousticChannels = device => (device.channels || []).map(channel => presentPoint(channel, 'monitor', device.deviceId))
function acousticMachine(device, channel) {
  const collectors = device.raw.collectors || []
  const collector = collectors.find(item => channel.collectorId != null && String(item.collectorId) === String(channel.collectorId))
  // A channel's collector takes precedence over a device-wide name or collector list.
  if (collector) return acousticHosts[collector.ip] || null
  if (channel.collectorId != null) return null
  const owners = new Set(collectors.map(item => acousticHosts[item.ip] || null))
  if (owners.size === 1 && !owners.has(null)) return [...owners][0]
  if (collectors.length) return null
  const name = `${device.id} ${device.name}`.toUpperCase()
  const matches = machines.filter(machine => new RegExp(`(^|[^A-Z0-9])${machine.id}([^A-Z0-9]|$)`).test(name))
  return matches.length === 1 ? matches[0].id : null
}
export function groupMachineDevices(devices) {
  const groups = machines.map(({ id, name }) => ({ id, name, members: [] }))
  for (const location of pointConfiguration.locations) {
    if (!location.machine.includes('/') && !groups.some(group => group.id === location.machine)) groups.push({ id: location.machine, name: location.machine, members: [] })
  }
  const pending = { id: 'pending', name: '待确认归属', members: [] }
  const add = (id, member) => (groups.find(group => group.id === id) || pending).members.push(member)
  for (const device of devices) {
    if (device.source === 'legacy') {
      const partitions = new Map()
      for (const point of device.points) {
        const configured = configuredParameter(point, device.source, device.id)
        const owner = pointConfiguration.locations.find(location => location.id === configured?.locationId)?.machine
        const id = owner && !owner.includes('/') ? owner : machines.find(machine => machine.modules.includes(device.id))?.id
        if (!partitions.has(id)) partitions.set(id, [])
        partitions.get(id).push(point)
      }
      if (!partitions.size) add(machines.find(machine => machine.modules.includes(device.id))?.id, device)
      for (const [id, points] of partitions) add(id, { ...device, points })
    } else {
      const partitions = new Map()
      for (const channel of device.points) {
        const configured = configuredParameter(channel, 'monitor', device.id)
        const owner = pointConfiguration.locations.find(location => location.id === configured?.locationId)?.machine
        const id = owner && !owner.includes('/') ? owner : acousticMachine(device, channel)
        if (!partitions.has(id)) partitions.set(id, [])
        partitions.get(id).push(channel)
      }
      if (!partitions.size) add(null, device)
      for (const [id, points] of partitions) add(id, { ...device, points })
    }
  }
  for (const group of [...groups, pending]) {
    group.pointCount = group.members.reduce((count, member) => count + member.points.length, 0)
    const states = group.members.map(member => member.online)
    group.status = !states.length ? '待加载' : states.every(state => state === true) ? '采集在线' : states.every(state => state === false) ? '采集离线' : states.some(state => state === false) ? '部分离线' : '状态待确认'
  }
  return { groups, pending }
}

export function fanGroupOf(row) {
  const location = monitoringLocationOf(row.member, row.point)
  return ['ve', 'max'].includes(location) ? location : ''
}

