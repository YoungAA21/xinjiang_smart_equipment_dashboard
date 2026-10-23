export const workspaceSections = [
  { id: 'home', label: '首页', path: '/', tabs: [] },
  { id: 'monitoring', label: '设备监测', path: '/machine/overview', tabs: [
    { label: '机组概览', path: '/machine/overview', matches: ['/monitor'] },
    { label: '测点详情', path: '/device' },
    { label: '实时监听', path: '/realtime-listen' },
  ] },
  { id: 'analysis', label: '告警分析', path: '/alarm/list', tabs: [
    { label: '设备报告', path: '/reports' },
    { label: '告警管理', path: '/alarm/list' },
  ] },
  { id: 'configuration', label: '数据配置', path: '/gateway/communication', tabs: [
    { label: '网关通讯', path: '/gateway/communication' },
    { label: '参数配置', path: '/settings/parameters' },
  ] },
]

export const workspaceTabMatches = (tab, path) => [tab.path, ...(tab.matches || [])]
  .some(prefix => path === prefix || (!tab.exact && path.startsWith(`${prefix}/`)))

export function workspaceSectionFor(path) {
  return workspaceSections.find(section => section.tabs.some(tab => workspaceTabMatches(tab, path)))
    || workspaceSections[0]
}
