import { machines, acousticHosts } from './machineGroups.js'
import { moduleDisplayName } from './equipmentCatalog.js'

// Home configuration owns machine membership and runtime IPs.
// The document contributes installation locations only.
const locations = {
  "VSE03": {
    "location": "ZJ17子站箱",
    "network": "ZJ17子站箱交换机"
  },
  "TEMP02": {
    "location": "ZJ17子站箱",
    "network": "ZJ17子站箱交换机"
  },
  "PRESS02": {
    "location": "ZJ17蜘蛛手金属",
    "network": "主电柜交换机A"
  },
  "VSE04": {
    "location": "ZB25子站箱",
    "network": "ZB25子站箱交换机B"
  },
  "VSE05": {
    "location": "ZB25子站箱",
    "network": "ZB25子站箱交换机B"
  },
  "TEMP03": {
    "location": "ZB25子站箱",
    "network": "ZB25子站箱交换机A"
  },
  "SC01": {
    "location": "MACO2电柜内部",
    "network": "主电柜交换机B"
  },
  "PRESS01": {
    "location": "ZB25子站箱",
    "network": "ZB25子站箱交换机A"
  },
  "VSE08": {
    "location": "辅机通道主电柜",
    "network": "主电柜交换机B"
  },
  "TEMP01": {
    "location": "辅机通道主电柜",
    "network": "主电柜交换机A"
  },
  "SC02": {
    "location": "MACO2电柜内部",
    "network": "主电柜交换机B"
  },
  "PRESS03": {}
}
export const gatewayCatalog = [
  ...machines.flatMap(machine => machine.modules.map(id => ({
    key: `legacy:${id}`, machine: machine.id, name: moduleDisplayName({ moduleId: id }).split(' · ').at(-1),
    kind: id.startsWith('VSE') ? '振动' : id.startsWith('TEMP') ? '温度' : id.startsWith('PRESS') ? '压力' : '控制',
    source: 'legacy', moduleIds: [id], host: '', ...locations[id],
  }))),
  ...Object.entries(acousticHosts).map(([host, machine]) => ({
    key: `monitor:${host}`, machine, name: `${host.split('.').at(-1)} 声纹采集`, kind: '声纹',
    source: 'monitor', host, moduleIds: [],
  })),
]

const addressOf = row => row?.host || row?.ip || row?.runtime?.ip || ''
export function mergeGatewayInventory({ modules = [], devices = [], statuses = [], failed = {} } = {}) {
  const sources = modules.map(module => ({ source: 'legacy', id: String(module.moduleId), host: addressOf(module), raw: module, runtime: module.runtimeStatus || {}, points: [], device: null }))
  const collectors = new Map()
  for (const device of devices) for (const collector of device.collectors || []) {
    const id = String(collector.collectorId)
    if (!collectors.has(id)) collectors.set(id, { source: 'monitor', id, host: addressOf(collector), raw: collector, runtime: {}, points: [], device })
    const entry = collectors.get(id)
    entry.points.push(...(device.channels || []).filter(channel => channel.collectorId != null ? String(channel.collectorId) === id : device.collectors.length === 1))
  }
  for (const row of statuses) {
    const runtime = row.runtime || row
    const id = String(row.collectorId ?? runtime.collectorId)
    const entry = collectors.get(id) || { source: 'monitor', id, points: [], device: null }
    collectors.set(id, { ...entry, host: addressOf(row) || entry.host || '', raw: { ...entry.raw, ...row }, runtime })
  }
  sources.push(...collectors.values())
  const used = new Set()
  const decorate = (config, entry) => {
    if (entry) used.add(entry)
    const runtime = entry?.runtime || {}
    const runtimeFailed = failed[config.source === 'legacy' ? 'modules' : 'statuses']
    const online = runtimeFailed ? null : config.source === 'legacy' ? runtime.isOnline : runtime.connected
    const rawState = String(runtime.state || '').toLowerCase()
    const status = runtimeFailed ? '状态待确认' : online === true ? '在线' : online === false ? '离线' : ['stopped', 'disabled'].includes(rawState) ? '已停止' : ['connecting', 'reconnecting', 'starting'].includes(rawState) ? '连接中' : entry ? '状态未知' : '未接入'
    return { ...config, entry, runtime, status, online: status === '在线', host: entry?.host || config.host }
  }
  const entries = gatewayCatalog.map(config => {
    const entry = sources.find(entry => !used.has(entry) && entry.source === config.source && (config.source === 'legacy' ? config.moduleIds.includes(entry.id) : entry.host === config.host))
    return decorate(config, entry)
  })
  for (const entry of sources.filter(entry => !used.has(entry))) entries.push(decorate({ key: `${entry.source}:${entry.id}`, machine: '其他', name: entry.raw.moduleName || entry.raw.name || entry.id, kind: entry.source === 'monitor' ? '声纹' : '其他', host: '', location: '', source: entry.source, moduleIds: [], bindings: [], origin: '接口' }, entry))
  return entries
}
