<script setup>
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronDown, Fan, Maximize2, Minimize2, Moon, PanelLeftClose, PanelLeftOpen, Sun, UserRound } from 'lucide-vue-next'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useDashboardStore } from './stores/dashboard'
import { auth } from './services/auth'
import { useDigitalAlarmStore } from './stores/digitalAlarms.js'
import DigitalAlarmDialog from './components/DigitalAlarmDialog.vue'

const route = useRoute()
const router = useRouter()
const dashboard = useDashboardStore()
const digitalAlarms = useDigitalAlarmStore()
const diDialogReady = ref(false)
const sidebarCollapsed = ref(localStorage.getItem('dashboard-sidebar') === 'collapsed')
const homeControlsExpanded = ref(false)
provide('homeControlsExpanded', homeControlsExpanded)
watch(() => route.path, path => {
  if (path === '/') {
    sidebarCollapsed.value = true
    homeControlsExpanded.value = false
  }
}, { immediate: true })
const isLightTheme = ref(localStorage.getItem('dashboard-theme') === 'light')
const isFullscreen = ref(false)

const activePath = computed(() => route.path)
const pageTitle = computed(() => route.meta.title || '设备监控')
const isLoginPage = computed(() => route.name === 'login')
watch(isLoginPage, login => {
  if (login || !auth.isAuthenticated()) digitalAlarms.stop()
  else {
    const user = auth.getUser()
    digitalAlarms.start(user?.id || user?.username || user?.name || 'default')
  }
}, { immediate: true })
const currentUser = computed(() => auth.getUser()?.username || auth.getUser()?.name || 'admin')

const isMenuActive = (item) => {
  if (item.path === '/device') return activePath.value.startsWith('/device')
  if (item.path === '/') return activePath.value === '/'
  return activePath.value === item.path
}

const logout = () => {
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
  diDialogReady.value = true
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
  document.removeEventListener('fullscreenchange', syncFullscreen)
  dashboard.stopRealtimePolling()
})
</script>

<template>
  <el-config-provider :locale="zhCn">
    <router-view v-if="isLoginPage" />

    <main v-else class="dashboard-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed, 'light-theme': isLightTheme }">
    <DigitalAlarmDialog v-if="diDialogReady" />
    <aside class="side-nav">
      <div class="brand">
        <span class="brand-mark"><Fan :size="23" /></span>
        <strong>智能设备健康管理平台</strong>
      </div>
      <nav>
        <el-button
          v-for="item in dashboard.menus"
          :key="item.label"
          text
          :class="{ active: isMenuActive(item) }"
          :title="sidebarCollapsed ? item.label : ''"
          @click="router.push(item.path)"
        >
          <component :is="item.icon" :size="17" />
          <span class="menu-label">{{ item.label }}</span>
          <ChevronDown v-if="item.path !== '/'" :size="14" class="menu-chevron" />
        </el-button>
      </nav>
      <button class="nav-collapse" type="button" :aria-expanded="!sidebarCollapsed" :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'" @click="sidebarCollapsed = !sidebarCollapsed">
        <component :is="sidebarCollapsed ? PanelLeftOpen : PanelLeftClose" :size="18" />
      </button>
    </aside>

    <section class="screen" :class="{ 'device-monitor-screen': route.name === 'device-detail' }">
      <header v-show="route.path !== '/' || homeControlsExpanded" class="topbar">
        <div class="top-title">
          <span class="title-glow"></span>
          <strong>{{ pageTitle }}</strong>
        </div>
        <div v-if="route.name === 'device-list'" id="monitor-location-tabs" style="flex:1; min-width:0; margin:0 18px;"></div>
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

      <section class="page-stage" :style="route.path === '/' ? { paddingTop: '0', ...(!homeControlsExpanded ? { height: '100vh' } : {}) } : undefined">
        <router-view />
      </section>
    </section>
    </main>
  </el-config-provider>
</template>
