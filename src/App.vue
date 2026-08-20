<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronDown, Fan, Maximize2, Minimize2, Moon, PanelLeftClose, PanelLeftOpen, Sun, UserRound } from 'lucide-vue-next'
import { useDashboardStore } from './stores/dashboard'
import { auth } from './services/auth'

const route = useRoute()
const router = useRouter()
const dashboard = useDashboardStore()
const sidebarCollapsed = ref(false)
const isLightTheme = ref(localStorage.getItem('dashboard-theme') === 'light')
const isFullscreen = ref(false)

const activePath = computed(() => route.path)
const pageTitle = computed(() => route.meta.title || '首页')
const isLoginPage = computed(() => route.name === 'login')
const currentUser = computed(() => auth.getUser()?.username || auth.getUser()?.name || 'admin')

const isMenuActive = (item) => {
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
  syncFullscreen()
  document.documentElement.classList.toggle('light-theme', isLightTheme.value)
  document.addEventListener('fullscreenchange', syncFullscreen)
})

watch(isLightTheme, (value) => {
  document.documentElement.classList.toggle('light-theme', value)
}, { immediate: true })

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreen)
  dashboard.stopRealtimePolling()
})
</script>

<template>
  <router-view v-if="isLoginPage" />

  <main v-else class="dashboard-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed, 'light-theme': isLightTheme }">
    <aside class="side-nav">
      <div class="brand">
        <span class="brand-mark"><Fan :size="23" /></span>
        <button class="nav-collapse" type="button" :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'" @click="sidebarCollapsed = !sidebarCollapsed">
          <component :is="sidebarCollapsed ? PanelLeftOpen : PanelLeftClose" :size="17" />
        </button>
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
          <span>{{ item.label }}</span>
          <ChevronDown v-if="item.path !== '/'" :size="14" class="menu-chevron" />
        </el-button>
      </nav>
    </aside>

    <section class="screen">
      <header class="topbar">
        <div class="top-title">
          <span class="title-glow"></span>
          <strong>{{ pageTitle }}</strong>
          <em>Equipment Health Command Center</em>
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
                <el-dropdown-item>个人中心</el-dropdown-item>
                <el-dropdown-item @click="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <section class="page-stage">
        <router-view />
      </section>
    </section>
  </main>
</template>
