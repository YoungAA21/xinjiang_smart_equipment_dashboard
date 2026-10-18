import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import '../../src/style.css'
import AlarmListPage from '../../src/views/AlarmListPage.vue'
import { emptyConfiguration, parameterKey } from '../../src/charts/pointConfiguration.js'
import { savePointConfiguration } from '../../src/stores/pointConfiguration.js'

const points = [
  { moduleId: 'VSE03', pointId: 11, channelId: 'ch1', pointCode: 'speed', name: '振动速度', unit: 'mm/s', metricType: 'VibrationRms' },
  { moduleId: 'TEMP02', pointId: 22, channelId: 'ch2', pointCode: 'temp', name: '轴承温度', unit: '℃', metricType: 'Temperature' },
  { moduleId: 'VSE04', pointId: 33, channelId: 'ch3', pointCode: 'speed', name: '主电机振动', unit: 'mm/s', metricType: 'VibrationRms' },
]
const configuration = emptyConfiguration()
configuration.targets = [{ id: 'bearing', name: '轴承驱动端', locationId: 've' }, { id: 'drive', name: '电机驱动端', locationId: 'main-motor' }]
configuration.parameters = Object.fromEntries(points.map((point, i) => [parameterKey(point), {
  displayName: point.name, unit: point.unit, locationId: i === 2 ? 'main-motor' : 've', targetId: i === 2 ? 'drive' : 'bearing',
}]))
// Keep fixture configuration in memory; this preview never writes user settings or contacts a backend.
savePointConfiguration(configuration, { setItem() {} })
globalThis.fetch = async input => {
  const url = new URL(input, location.href)
  const moduleId = decodeURIComponent(url.pathname.match(/\/modules\/([^/]+)\/points/)?.[1] || '')
  let body = {}
  if (moduleId) body = { moduleId, points: points.filter(point => point.moduleId === moduleId) }
  if (/\/analysis\/(alarms|trend-alarms)$/.test(url.pathname)) {
    const point = points.find(point => point.pointId === Number(url.searchParams.get('pointId')))
    const events = point ? [{ ...point, alarmId: `alarm-${point.pointId}`, trendAlarmId: `trend-${point.pointId}`,
      startedAt: '2026-10-19T08:05:00+08:00', status: 'Active', riskLevel: 'Warning', severity: 'Warning',
      alarmValue: point.pointId === 22 ? 85 : 7.5, thresholdMax: point.pointId === 22 ? 80 : 7, changeRate: 0.25,
      reason: '超过当前点位上限', quality: 'Good' }] : []
    body = { events: url.searchParams.get('isActive') === 'false' ? [] : events }
  }
  if (url.pathname.includes('/alarm/page')) body = { code: 200, data: { rows: [], total: 0 } }
  if (url.pathname.includes('/alarm/chatByDay')) body = { code: 200, data: [] }
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: AlarmListPage }] })
const app = createApp({ render: () => h('div', { style: 'padding:16px;height:100vh;overflow:auto' }, [
  h('button', { style: 'position:fixed;top:16px;right:32px;z-index:1000;padding:6px 12px', onClick: () => {
    const light = document.documentElement.classList.toggle('light-theme')
    document.querySelector('.dashboard-shell').classList.toggle('light-theme', light)
  } }, '切换主题'),
  h(AlarmListPage),
]) })
app.use(createPinia()).use(router).use(ElementPlus).mount('#app')
