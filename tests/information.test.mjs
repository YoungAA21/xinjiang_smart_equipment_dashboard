import test from 'node:test'
import assert from 'node:assert/strict'
import { reportInformation, clearInformation, informationMessages, subscribeInformation } from '../src/services/information.js'

test('information log merges repeated errors, clears all rows and accepts new errors after clearing', () => {
  clearInformation()
  const updates = []
  const unsubscribe = subscribeInformation(rows => updates.push(rows))
  reportInformation('声纹服务', new Error('用户token已失效，请重新登录'))
  reportInformation('声纹服务', new Error('用户token已失效，请重新登录'))
  assert.equal(informationMessages().length, 1)
  assert.equal(informationMessages()[0].count, 2)
  reportInformation('声纹连接', new Error('连接异常'))
  assert.equal(informationMessages().length, 2)
  reportInformation('采集服务', new DOMException('cancelled', 'AbortError'))
  assert.equal(informationMessages().length, 2)
  clearInformation()
  assert.deepEqual(informationMessages(), [])
  reportInformation('声纹连接', '连接异常')
  assert.equal(informationMessages()[0].count, 1)
  const count = updates.length
  unsubscribe()
  clearInformation()
  assert.equal(updates.length, count)
})

test('information log is bounded and callers cannot mutate its internal records', () => {
  clearInformation()
  for (let index = 0; index < 205; index++) reportInformation('采集服务', `错误 ${index}`)
  const rows = informationMessages()
  assert.equal(rows.length, 200)
  assert.equal(rows[0].message, '错误 204')
  rows[0].message = 'overwritten'
  assert.equal(informationMessages()[0].message, '错误 204')
  clearInformation()
})
