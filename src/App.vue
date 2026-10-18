<script setup>
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlarmClock, ChevronDown, Fan, Home, Maximize2, Minimize2, MonitorCog, Moon, PanelLeftClose, PanelLeftOpen, Settings2, Sun, UserRound } from 'lucide-vue-next'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useDashboardStore } from './stores/dashboard'
import { auth } from './services/auth'
import { useDigitalAlarmStore } from './stores/digitalAlarms.js'
import { historyWarmup } from './services/historyWarmup.js'
import InformationBar from './components/InformationBar.vue'
import { reportInformation, clearInformation } from './services/information.js'
import { useTelemetryStore } from './stores/telemetry.js'
import { useHomeDevicesStore } from './stores/homeDevices.js'
import { workspaceSections, workspaceSectionFor, workspaceTabMatches } from './charts/workspaceNavigation.js'
import './styles/configuration-workspace.css'
import './styles/machine-hierarchy.css'

const route = useRoute()
const router = useRouter()
const dashboard = useDashboardStore()
const telemetry = useTelemetryStore()
const homeDevices = useHomeDevicesStore()
provide('reportInformation', reportInformation)
watch(() => ({ ...telemetry.errors }), errors => {
  for (const [key, message] of Object.entries(errors)) if (message) reportInformation(`采集服务 · ${key}`, message)
}, { deep: true })
watch(() => homeDevices.error, error => { if (error) reportInformation('声纹服务', error) })
const digitalAlarms = useDigitalAlarmStore()
const sidebarCollapsed = ref(localStorage.getItem('dashboard-sidebar') === 'collapsed')
const homeControlsExpanded = ref(false)
const compactHeader = computed(() => route.path === '/')
const activeSection = computed(() => workspaceSectionFor(route.path))
const sectionIcons = { home: Home, monitoring: MonitorCog, analysis: AlarmClock, configuration: Settings2 }
const sectionLocations = new Map()
watch(() => route.fullPath, fullPath => {
  if (route.name !== 'login') sectionLocations.set(activeSection.value.id, fullPath)
}, { immediate: true })
function openSection(section) {
  if (activeSection.value.id !== section.id) router.push(sectionLocations.get(section.id) || section.path)
}
provide('homeControlsExpanded', homeControlsExpanded)
watch(() => route.path, path => {
  if (path === '/') {
    sidebarCollapsed.value = true
  }
  if (['/', '/device', '/machine/overview'].includes(path)) homeControlsExpanded.value = false
}, { immediate: true })
const isLightTheme = ref(localStorage.getItem('dashboard-theme') === 'light')
provide('isLightTheme', isLightTheme)
const isFullscreen = ref(false)

const pageTitle = computed(() => activeSection.value.label)
const isLoginPage = computed(() => route.name === 'login')
watch(isLoginPage, login => {
  if (login || !auth.isAuthenticated()) { digitalAlarms.stop(); historyWarmup.stop() }
  else {
    const user = auth.getUser()
    digitalAlarms.start(user?.id || user?.username || user?.name || 'default')
    historyWarmup.start(user?.id || user?.username || user?.name || 'default')
  }
}, { immediate: true })
const currentUser = computed(() => auth.getUser()?.username || auth.getUser()?.name || 'admin')

const logout = () => {
  clearInformation()
  historyWarmup.stop()
  auth.clearSession()
  dashboard.stopRealtimePolling()
  router.replace('/login')
}

const toggleTheme = () => {
  isLightTheme.value = !isLightTheme.value
  localStorage.setItem('dashboard-theme', isLightTheme.value ? 'light' : 'dark')
}

const toggleFullscreen = async () => {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen?.()
  } else {
    await document.exitFullscreen?.()
  }
}

const syncFullscreen = () => {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

onMounted(() => {
  syncFullscreen()
  document.documentElement.classList.toggle('light-theme', isLightTheme.value)
  document.addEventListener('fullscreenchange', syncFullscreen)
})

watch(isLightTheme, (value) => {
  document.documentElement.classList.toggle('light-theme', value)
}, { immediate: true })

watch(sidebarCollapsed, (value) => {
  localStorage.setItem('dashboard-sidebar', value ? 'collapsed' : 'expanded')
})

onBeforeUnmount(() => {
  digitalAlarms.stop()
  historyWarmup.stop()
  document.removeEventListener('fullscreenchange', syncFullscreen)
  dashboard.stopRealtimePolling()
})
</script>

<template>
  <el-config-provider :locale="zhCn">
    <router-view v-if="isLoginPage" />

    <main v-else class="dashboard-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed, 'light-theme': isLightTheme }">
    <aside class="side-nav">
      <div class="brand">
        <RouterLink class="brand-mark" to="/" aria-label="返回主页" title="返回主页"><Fan :size="23" /></RouterLink>
        <div class="brand-title"><span>新疆卷烟厂</span><strong>智能设备健康管理平台</strong></div>
      </div>
      <nav aria-label="主要功能">
        <el-button
          v-for="item in workspaceSections"
          :key="item.label"
          text
          :class="{ active: activeSection.id === item.id }"
          :aria-current="activeSection.id === item.id ? 'true' : undefined"
          :title="sidebarCollapsed ? item.label : ''"
          @click="openSection(item)"
        >
          <component :is="sectionIcons[item.id]" :size="19" />
          <span class="menu-label">{{ item.label }}</span>
        </el-button>
      </nav>
      <div class="side-nav-footer">
      <InformationBar :collapsed="sidebarCollapsed" />
      <button class="nav-collapse" type="button" :aria-expanded="!sidebarCollapsed" :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'" @click="sidebarCollapsed = !sidebarCollapsed">
        <component :is="sidebarCollapsed ? PanelLeftOpen : PanelLeftClose" :size="18" />
      </button>
      </div>
    </aside>

    <section class="screen" :class="{ 'device-monitor-screen': route.name === 'device-detail', 'parameter-settings-screen': route.name === 'parameter-settings' }">
      <header v-show="!compactHeader || homeControlsExpanded" class="topbar">
        <div class="workspace-heading">
        <div class="top-title">
          <span class="title-glow"></span>
          <strong>{{ pageTitle }}</strong>
        </div>
        <nav v-if="activeSection.tabs.length" class="workspace-tabs" :aria-label="activeSection.label + '子页面'">
          <RouterLink v-for="tab in activeSection.tabs" :key="tab.path" :to="tab.path" :class="{ active: workspaceTabMatches(tab, route.path) }" :aria-current="workspaceTabMatches(tab, route.path) ? 'page' : undefined">{{ tab.label }}</RouterLink>
        </nav>
        </div>
        <div class="top-actions">
          <button class="top-icon-btn" type="button" :title="isLightTheme ? '切换当前主题色' : '切换亮色主题'" @click="toggleTheme">
            <component :is="isLightTheme ? Moon : Sun" :size="17" />
          </button>
          <button class="top-icon-btn" type="button" :title="isFullscreen ? '退出全屏' : '全屏'" @click="toggleFullscreen">
            <component :is="isFullscreen ? Minimize2 : Maximize2" :size="17" />
          </button>
          <span class="avatar"><UserRound :size="17" /></span>
          <el-dropdown trigger="click">
            <span class="admin-entry">{{ currentUser }} <ChevronDown :size="13" /></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <section class="page-stage" :style="compactHeader ? { paddingTop: '0', ...(!homeControlsExpanded ? { height: '100vh' } : {}) } : undefined">
        <router-view />
      </section>
    </section>
    </main>
  </el-config-provider>
</template>
