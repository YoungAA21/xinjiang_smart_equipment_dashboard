const machines = [
  { id: 'ZJ117', name: 'ZJ117 卷接机', modules: ['VSE03', 'TEMP02', 'PRESS02'] },
  { id: 'ZB25', name: 'ZB25 小盒包装机', modules: ['VSE04', 'VSE05', 'TEMP03', 'SC01', 'PRESS01'] },
  { id: 'YB55', name: 'YB55 硬条包装机', modules: ['VSE08', 'TEMP01', 'SC02', 'PRESS03'] },
]
const acousticHosts = {
  '192.168.4.119': 'ZJ117', '192.168.4.111': 'ZJ117',
  '192.168.4.114': 'ZB25', '192.168.4.115': 'ZB25', '192.168.4.116': 'YB55',
}
function acousticMachine(device, channel) {
  const collectors = device.raw.collectors || []
  const collector = collectors.find(item => channel.collectorId != null && item.collectorId === channel.collectorId)
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
  const pending = { id: 'pending', name: '待确认归属', members: [] }
  const add = (id, member) => (groups.find(group => group.id === id) || pending).members.push(member)
  for (const device of devices) {
    if (device.source === 'legacy') {
      add(machines.find(machine => machine.modules.includes(device.id))?.id, device)
    } else {
      const partitions = new Map()
      for (const channel of device.points) {
        const id = acousticMachine(device, channel)
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
