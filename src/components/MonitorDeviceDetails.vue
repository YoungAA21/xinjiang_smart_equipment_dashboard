<script setup>
import { computed } from 'vue'
const props = defineProps({ device: { type: Object, required: true } })
const collectorRows = computed(() => props.device.collectors || [])
const channelRows = computed(() => props.device.channels || [])
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

</script>
<template>
      <section class="monitor-table-grid">
        <section class="panel table-card monitor-table-card">
          <h2>网关详情</h2>
          <div v-if="!collectorRows.length" class="empty-state">当前设备暂无网关</div>
          <el-table v-else :data="collectorRows" scrollbar-always-on class="dark-table fill-table">
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
          <el-table v-else :data="channelRows" scrollbar-always-on class="dark-table fill-table">
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
</template>
<style scoped>
.monitor-table-grid { grid-template-columns: minmax(0, 1fr); height: auto; flex: none; }
.monitor-table-card { height: 250px; min-width: 0; }
:deep(.el-scrollbar__bar.is-horizontal) { height: 8px; }
</style>
