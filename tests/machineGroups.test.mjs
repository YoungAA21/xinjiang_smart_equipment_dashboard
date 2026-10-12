import test from 'node:test'
import assert from 'node:assert/strict'
import { groupMachineDevices } from '../src/charts/machineGroups.js'
const module = id => ({ id, key: id, source: 'legacy', online: true, points: [{ pointCode: id }], raw: {} })
test('all confirmed modules join three machines while unknown pressure sources stay visible', () => {
  const data = groupMachineDevices(['VSE03','TEMP02','PRESS02','VSE04','VSE05','TEMP03','SC01','VSE08','TEMP01','SC02','PRESS01','PRESS03'].map(module))
  assert.deepEqual(data.groups.map(group => group.members.map(member => member.id)), [
    ['VSE03','TEMP02','PRESS02'], ['VSE04','VSE05','TEMP03','SC01','PRESS01','PRESS03'], ['VSE08','TEMP01','SC02'],
  ])
  assert.deepEqual(data.pending.members, [])
  assert.equal([...data.groups,data.pending].reduce((n,g) => n + g.pointCount,0),12)
})
test('acoustic channels split by collector without changing identifiers or dropping unknown channels', () => {
  const points = [{ channelId: 'same', collectorId: 'a' }, { channelId: 'other', collectorId: 'b' }, { channelId: 'unknown', collectorId: 'missing' }]
  const device = { source: 'monitor', id: 'd', name: 'ZJ117', points, raw: { collectors: [{ collectorId: 'a', ip: '192.168.4.114' }, { collectorId: 'b', ip: '192.168.4.116' }] } }
  const { groups, pending } = groupMachineDevices([device])
  assert.equal(groups[0].pointCount,0)
  assert.equal(groups[1].members[0].points[0],points[0])
  assert.equal(groups[2].members[0].points[0],points[1])
  assert.equal(groups[1].members[0].raw,device.raw)
  assert.equal(pending.members[0].points[0],points[2])
})
test('partial offline acquisition is never reported as fully online', () => {
  const { groups } = groupMachineDevices([module('VSE03'), { ...module('TEMP02'), online: false }])
  assert.equal(groups[0].status,'部分离线')
  assert.equal(groups[1].status,'待加载')
})
