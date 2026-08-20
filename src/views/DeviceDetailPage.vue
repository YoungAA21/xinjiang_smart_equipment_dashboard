<script setup>
import { computed, onMounted, ref } from 'vue'
import { Fan, RefreshCcw } from 'lucide-vue-next'
import { ElMessage } from 'element-plus'
import { api } from '../services/api'

const monitorDevices = ref([])
const selectedDeviceId = ref('')
const loading = ref(false)

const selectedDevice = computed(() =>
  monitorDevices.value.find((device) => device.deviceId === selectedDeviceId.value) || monitorDevices.value[0] || null)

const collectorRows = computed(() => selectedDevice.value?.collectors || [])
const channelRows = computed(() => selectedDevice.value?.channels || [])

const formatDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

const runtimeStateText = (runtime) => {
  if (!runtime) return '未知'
  if (runtime.connected) return '在线'
  if (runtime.state === 'connecting') return '连接中'
  return runtime.state || '离线'
}

const loadMonitorDevices = async () => {
  loading.value = true
  try {
    const devices = await api.getMonitorDevices()
    monitorDevices.value = Array.isArray(devices) ? devices : []
    if (!monitorDevices.value.some((device) => device.deviceId === selectedDeviceId.value)) {
      selectedDeviceId.value = monitorDevices.value[0]?.deviceId || ''
    }
  } catch (error) {
    ElMessage.error(error?.message || '可监听设备加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(loadMonitorDevices)
</script>

<template>
  <section class="page monitor-page">
    <header class="monitor-toolbar">
      <div>
        <span>Monitor Devices</span>
        <strong>可监听设备</strong>
      </div>
      <div class="monitor-actions">
        <el-button :icon="RefreshCcw" :loading="loading" @click="loadMonitorDevices">刷新</el-button>
      </div>
    </header>

    <section class="monitor-content-stack">
      <section class="panel monitor-topology-panel">
        <h2>拓扑总览</h2>
        <div v-if="!monitorDevices.length" class="empty-state">暂无可监听设备</div>
        <template v-else>
          <div class="topology-device-rail">
            <button
              v-for="device in monitorDevices"
              :key="device.deviceId"
              type="button"
              class="topology-device-tab"
              :class="{ active: device.deviceId === selectedDeviceId, offline: !device.online }"
              @click="selectedDeviceId = device.deviceId"
            >
              <div class="device-animated-icon" :class="{ offline: !device.online }">
                <Fan :size="22" />
                <i></i>
              </div>
              <strong>{{ device.deviceName || device.deviceId }}</strong>
              <span>{{ device.deviceId }}</span>
              <em>{{ device.online ? '在线' : '离线' }} / {{ device.collectors?.length || 0 }} 网关 / {{ device.channels?.length || 0 }} 通道</em>
            </button>
          </div>
        </template>
      </section>

      <section class="monitor-table-grid">
        <section class="panel table-card monitor-table-card">
          <h2>网关详情</h2>
          <div v-if="!collectorRows.length" class="empty-state">当前设备暂无网关</div>
          <el-table v-else :data="collectorRows" class="dark-table fill-table">
            <el-table-column prop="name" label="网关名称" min-width="220" />
            <el-table-column prop="ip" label="IP" width="140" />
            <el-table-column prop="audioPort" label="端口" width="90" />
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <span :class="row.runtime?.connected ? 'ok-text' : 'warn-text'">{{ runtimeStateText(row.runtime) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="采样率" width="110">
              <template #default="{ row }">{{ row.runtime?.effectiveSampleRate || '-' }} Hz</template>
            </el-table-column>
            <el-table-column label="最后数据" width="180">
              <template #default="{ row }">{{ formatDateTime(row.runtime?.lastDataAt) }}</template>
            </el-table-column>
          </el-table>
        </section>

        <section class="panel table-card monitor-table-card">
          <h2>通道详情</h2>
          <div v-if="!channelRows.length" class="empty-state">当前设备暂无通道</div>
          <el-table v-else :data="channelRows" class="dark-table fill-table">
            <el-table-column prop="name" label="通道名称" min-width="240" />
            <el-table-column prop="channelId" label="通道ID" min-width="190" />
            <el-table-column prop="collectorId" label="网关ID" min-width="190" />
            <el-table-column prop="number" label="编号" width="80" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <span :class="row.online ? 'ok-text' : 'warn-text'">{{ row.online ? '在线' : '离线' }}</span>
              </template>
            </el-table-column>
          </el-table>
        </section>
      </section>
    </section>
  </section>
</template>
