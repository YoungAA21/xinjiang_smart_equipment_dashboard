import test from 'node:test'
import assert from 'node:assert/strict'
import { gatewayCatalog, mergeGatewayInventory } from '../src/charts/gatewayCatalog.js'
import { machines, acousticHosts, acousticChannelDisplayName, acousticCollectorDisplayName, fanGroupOf } from '../src/charts/machineGroups.js'
import { acousticPointIp } from '../src/charts/pointAddress.js'
import { monitoringLocationOf } from '../src/charts/monitoringLocations.js'

test('gateway inventory uses every home module and acoustic host', () => {
  assert.equal(gatewayCatalog.length, 17)
  assert.deepEqual(gatewayCatalog.filter(r => r.source === 'legacy').map(r => r.moduleIds[0]), machines.flatMap(m => m.modules))
  assert.deepEqual(gatewayCatalog.filter(r => r.source === 'monitor').map(r => r.host), Object.keys(acousticHosts))
  assert.equal(gatewayCatalog.find(r => r.key === 'legacy:PRESS03').machine, 'YB55')
})
test('runtime module identity and address override document IP assumptions', () => {
  const rows = mergeGatewayInventory({modules:[{moduleId:'SC02',host:'192.168.3.112',runtimeStatus:{isOnline:true}},{moduleId:'VSE03',host:'192.168.3.122',runtimeStatus:{isOnline:false}}]})
  assert.equal(rows.find(r=>r.key==='legacy:SC02').host,'192.168.3.112')
  assert.equal(rows.find(r=>r.key==='legacy:VSE03').machine,'ZJ117')
  assert.equal(rows.find(r=>r.key==='legacy:VSE04').entry,undefined)
})
test('home and gateway use identical fan temperature and sound assignments', () => {
  for (const [code,group] of [['07','max'],['08','max'],['09','ve'],['10','ve']]) {
    const member = { source: 'legacy', id: 'TEMP02' }
    const point = { pointCode: 'BEARING_TEMP_' + code }
    assert.equal(fanGroupOf({ member, point }), group)
    assert.equal(monitoringLocationOf(member, point), group)
  }
  for(const ch of [1,2]) assert.equal(fanGroupOf({member:{source:'monitor',raw:{collectors:[{ip:'192.168.3.51'}]}},point:{channelId:'CH'+ch}}),'ve')
  for(const ch of [1,2]) assert.equal(fanGroupOf({member:{source:'monitor',raw:{collectors:[{ip:'192.168.3.52'}]}},point:{channelId:'CH'+ch}}),'max')
})
test('sound channel labels follow configured collector IP and channel number', () => {
  const device = { collectors: [{ collectorId:'g', ip:'192.168.3.54' }] }
  assert.equal(acousticChannelDisplayName(device,{collectorId:'g',channelId:'584',name:'svt collector 2ch-192.168.3.54-584'}),'齿轮箱声纹 · 通道2')
  assert.equal(acousticChannelDisplayName({collectors:[{collectorId:'g',ip:'192.168.3.51'}]},{collectorId:'g',channelId:'584',name:'svt collector 2ch-192.168.3.51-584'}),'VE 风机整体声纹')
  assert.equal(acousticChannelDisplayName({collectors:[{collectorId:'g',ip:'192.168.3.51'}]},{collectorId:'g',channelId:'583',name:'svt collector 1ch-192.168.3.51-583'}),'VE 风机电机声纹')
  assert.equal(acousticChannelDisplayName({collectors:[{collectorId:'g',ip:'192.168.3.54'}]},{collectorId:'g',channelId:'584',name:'svt collector 1ch-192.168.3.54-584'}),'齿轮箱声纹 · 通道1')
})
test('device monitor resolves acoustic channels when collector IDs have different types', () => {
  const device = { collectors: [{ collectorId: 88, ip: '192.168.3.52' }, { collectorId: 'other', ip: '192.168.3.51' }] }
  const channel = { collectorId: '88', channelId: '584', name: 'svt collector 2ch-192.168.3.52-584' }
  assert.equal(acousticPointIp(device, channel), '192.168.3.52')
  assert.equal(fanGroupOf({ member: { source: 'monitor', raw: device }, point: channel }), 'max')
  assert.equal(monitoringLocationOf({ source: 'monitor', raw: device }, channel), 'max')
  assert.equal(monitoringLocationOf({ source: 'monitor', raw: { collectors: [{ collectorId: 'g', ip: '192.168.3.54' }] } }, { collectorId: 'g', channelId: '584', name: 'svt collector 2ch-192.168.3.54-584' }), 'paper-wheel')
})
test('gateway collector names use configured IP instead of backend svt collector labels', () => {
  assert.equal(acousticCollectorDisplayName('192.168.3.54','svt collector 2ch-192.168.3.54-584'),'齿轮箱采集器')
  assert.equal(acousticCollectorDisplayName('192.168.3.51','svt collector'),'VE 风机采集器')
  assert.equal(acousticCollectorDisplayName('192.168.4.99','svt collector unknown'),'svt collector unknown')
})
test('missing and failed runtime state is never presented as online or offline', () => {
  assert.ok(mergeGatewayInventory().every(r=>r.status==='未接入'))
  const rows=mergeGatewayInventory({modules:[{moduleId:'SC02',host:'192.168.3.112',runtimeStatus:{isOnline:true}}],failed:{modules:'timeout'}})
  assert.equal(rows.find(r=>r.key==='legacy:SC02').status,'状态待确认')
})
test('collector channels stay partitioned and unmatched modules remain visible', () => {
  const rows=mergeGatewayInventory({modules:[{moduleId:'UNKNOWN',host:'192.168.3.200'}],devices:[{collectors:[{collectorId:'a',ip:'192.168.3.51'},{collectorId:'b',ip:'192.168.3.52'}],channels:[{collectorId:'a',channelId:'CH1'},{collectorId:'b',channelId:'CH2'}]}],statuses:[{collectorId:'a',runtime:{connected:false}}]})
  assert.equal(rows.find(r=>r.key==='monitor:192.168.3.51').status,'离线')
  assert.deepEqual(rows.find(r=>r.key==='monitor:192.168.3.52').entry.points.map(p=>p.channelId),['CH2'])
  assert.equal(rows.find(r=>r.key==='legacy:UNKNOWN').machine,'其他')
})
