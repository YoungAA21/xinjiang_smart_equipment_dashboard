import { createRouter, createWebHashHistory } from 'vue-router'
import { auth } from '../services/auth'
import LoginPage from '../views/LoginPage.vue'
import HomePage from '../views/HomePage.vue'
import DeviceDetailPage from '../views/DeviceDetailPage.vue'
import TrendPage from '../views/TrendPage.vue'
import SpectrumPage from '../views/SpectrumPage.vue'
import AlarmListPage from '../views/AlarmListPage.vue'
import GatewayCommPage from '../views/GatewayCommPage.vue'
import RecordingManagementPage from '../views/RecordingManagementPage.vue'

export const routes = [
  { path: '/login', name: 'login', component: LoginPage, meta: { title: '登录', public: true } },
  { path: '/', name: 'home', component: HomePage, meta: { title: '首页' } },
  { path: '/device/detail', name: 'device-detail', component: DeviceDetailPage, meta: { title: '设备监控' } },
  { path: '/gateway/communication', name: 'gateway-communication', component: GatewayCommPage, meta: { title: '网关通讯' } },
  { path: '/recordings', name: 'recordings', component: RecordingManagementPage, meta: { title: '录音管理' } },
  { path: '/analysis/trend', name: 'trend', component: TrendPage, meta: { title: '趋势分析' } },
  { path: '/analysis/spectrum', name: 'spectrum', component: SpectrumPage, meta: { title: '频谱分析' } },
  { path: '/alarm/list', name: 'alarm-list', component: AlarmListPage, meta: { title: '告警列表' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach((to) => {
  if (to.meta.public) {
    if (to.name === 'login' && auth.isAuthenticated()) return '/'
    return true
  }

  if (!auth.isAuthenticated()) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  return true
})
