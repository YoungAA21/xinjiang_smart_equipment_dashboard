import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceSections, workspaceSectionFor, workspaceTabMatches } from '../src/charts/workspaceNavigation.js'

test('four primary sections retain every existing menu destination under workspace tabs', () => {
  assert.equal(workspaceSections.length, 4)
  const paths = workspaceSections.flatMap(section => section.tabs.map(tab => tab.path))
  assert.deepEqual(paths, ['/machine/overview', '/device', '/realtime-listen', '/reports', '/alarm/list', '/gateway/communication', '/settings/parameters'])
  assert.equal(new Set(paths).size, paths.length)
  for (const section of workspaceSections) assert.equal(workspaceSectionFor(section.path).id, section.id)
})

test('deep links and the original monitoring route select the appropriate section and tab', () => {
  assert.equal(workspaceSectionFor('/device/detail').id, 'monitoring')
  const monitoring = workspaceSectionFor('/device/detail')
  assert.equal(workspaceTabMatches(monitoring.tabs[1], '/device/detail'), true)
  assert.equal(workspaceTabMatches(monitoring.tabs[0], '/monitor'), true)
  assert.equal(workspaceTabMatches(monitoring.tabs[1], '/devices'), false)
  assert.equal(workspaceSectionFor('/reports').id, 'analysis')
  const analysis = workspaceSectionFor('/reports/view')
  assert.equal(workspaceTabMatches(analysis.tabs.find(tab => tab.label === '设备报告'), '/reports/view'), true)
  assert.equal(analysis.tabs.filter(tab => tab.path.startsWith('/reports')).length, 1)
  assert.equal(workspaceSectionFor('/settings/parameters').id, 'configuration')
  assert.equal(workspaceSectionFor('/').id, 'home')
})
