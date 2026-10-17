import test from 'node:test'
import assert from 'node:assert/strict'
import { groupMachineDevices, acousticHosts, acousticCollectorDisplayName } from '../src/charts/machineGroups.js'
import { monitoringLocationOf } from '../src/charts/monitoringLocations.js'
const module = id => ({ id, key: id, source: 'legacy', online: true, points: [{ pointCode: id }], raw: {} })
test('all confirmed modules join three machines while unknown pressure sources stay visible', () => {
  const data = groupMachineDevices(['VSE03','TEMP02','PRESS02','VSE04','VSE05','TEMP03','SC01','VSE08','TEMP01','SC02','PRESS01','PRESS03'].map(module))
  assert.deepEqual(data.groups.map(group => group.members.map(member => member.id)), [
    ['VSE03','TEMP02','PRESS02'], ['VSE04','VSE05','TEMP03','SC01','PRESS01'], ['VSE08','TEMP01','SC02','PRESS03'],
  ])
  assert.deepEqual(data.pending.members, [])
  assert.equal([...data.groups,data.pending].reduce((n,g) => n + g.pointCount,0),12)
})
test('acoustic channels split by collector without changing identifiers or dropping unknown channels', () => {
  const points = [{ channelId: 'same', collectorId: 'a' }, { channelId: 'other', collectorId: 'b' }, { channelId: 'unknown', collectorId: 'missing' }]
  const device = { source: 'monitor', id: 'd', name: 'ZJ17', points, raw: { collectors: [{ collectorId: 'a', ip: '192.168.3.53' }, { collectorId: 'b', ip: '192.168.3.54' }] } }
  const { groups, pending } = groupMachineDevices([device])
  assert.equal(groups[0].pointCount,0)
  assert.equal(groups[1].members[0].points[0],points[0])
  assert.equal(groups[1].members[0].points[1],points[1])
  assert.equal(groups[1].members[0].raw,device.raw)
  assert.equal(pending.members[0].points[0],points[2])
})
test('partial offline acquisition is never reported as fully online', () => {
  const { groups } = groupMachineDevices([module('VSE03'), { ...module('TEMP02'), online: false }])
  assert.equal(groups[0].status,'部分离线')
  assert.equal(groups[1].status,'待加载')
})

test('latest installation addresses partition all five collectors and their channels', () => {
  const assignments = [
    ['192.168.3.51', 'ZJ17', 've', 'VE 风机采集器'],
    ['192.168.3.52', 'ZJ17', 'max', 'MAX 风机采集器'],
    ['192.168.3.53', 'ZB25', 'main-motor', '主机主电机采集器'],
    ['192.168.3.54', 'ZB25', 'paper-wheel', '齿轮箱采集器'],
    ['192.168.3.55', 'YB55', 'aux-motor', '辅机主电机采集器'],
  ]
  const raw = { collectors: assignments.map(([ip], index) => ({ collectorId: index + 1, ip })) }
  const points = assignments.flatMap((_, index) => [1, 2].map(ch => ({ collectorId: String(index + 1), channelId: `CH${ch}` })))
  const device = { source: 'monitor', id: 'sound', name: 'sound', raw, points }
  const { groups, pending } = groupMachineDevices([device])
  assert.equal(pending.members.length, 0)
  assert.deepEqual(groups.map(group => group.pointCount), [4, 4, 2])
  for (const [index, [ip, machine, location, name]] of assignments.entries()) {
    assert.equal(acousticHosts[ip], machine)
    assert.equal(acousticCollectorDisplayName(ip), name)
    for (const point of points.filter(p => p.collectorId === String(index + 1))) {
      assert.equal(monitoringLocationOf(device, point), location)
      assert.ok(groups.find(g => g.id === machine).members.some(m => m.points.includes(point)))
    }
  }
})
