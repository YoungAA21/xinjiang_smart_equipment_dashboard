<script setup>
import { computed } from 'vue'
import EChart from '../components/EChart.vue'
import { useDashboardStore } from '../stores/dashboard'

const dashboard = useDashboardStore()

const statusSummary = computed(() => {
  const total = dashboard.modules.length
  const online = dashboard.modules.filter((module) => module.runtimeStatus?.isOnline).length
  const alarm = Number(dashboard.kpis[2].value || 0)
  const offline = Math.max(total - online, 0)
  const normal = Math.max(total - alarm - offline, 0)
  const percent = (value) => (total ? `${((value / total) * 100).toFixed(2)}%` : '0%')

  return { total, normal, alarm, offline, percent }
})
</script>

<template>
  <section class="page page-home">
    <div class="kpi-row">
      <article v-for="item in dashboard.kpis" :key="item.label" class="kpi-card" :class="item.color">
        <span>{{ item.label }}</span>
        <strong><component :is="item.icon" :size="23" />{{ item.value }}<small>{{ item.unit }}</small></strong>
      </article>
    </div>

    <div class="home-grid">
      <article class="panel status-panel">
        <h2>设备状态分布</h2>
        <div class="donut-wrap">
          <EChart :option="dashboard.healthOption" />
          <ul class="legend-list">
            <li><b class="ok"></b>正常 <span>{{ statusSummary.normal }} ({{ statusSummary.percent(statusSummary.normal) }})</span></li>
            <li><b class="danger"></b>告警 <span>{{ statusSummary.alarm }} ({{ statusSummary.percent(statusSummary.alarm) }})</span></li>
            <li><b class="offline"></b>离线 <span>{{ statusSummary.offline }} ({{ statusSummary.percent(statusSummary.offline) }})</span></li>
          </ul>
        </div>
      </article>

      <article class="panel home-trend">
        <h2>告警趋势</h2>
        <EChart :option="dashboard.alarmTrendOption" />
      </article>

      <article class="panel table-card realtime-alarm-card">
        <h2>设备运行状态</h2>
        <div v-if="!dashboard.ranking.length" class="empty-state">暂无设备接口数据</div>
        <el-table :data="dashboard.ranking" class="dark-table fill-table">
          <el-table-column label="排名" width="70">
            <template #default="{ $index }">{{ $index + 1 }}</template>
          </el-table-column>
          <el-table-column prop="0" label="设备名称" />
          <el-table-column label="状态" width="90">
            <template #default="scope"><span :class="scope?.row?.[1] === '正常' ? 'ok-text' : 'danger-text'">{{ scope?.row?.[1] || '-' }}</span></template>
          </el-table-column>
          <el-table-column label="实时点数" width="90">
            <template #default="scope"><span class="ok-text">{{ scope?.row?.[2] ?? '-' }}</span></template>
          </el-table-column>
        </el-table>
      </article>

      <article class="panel table-card">
        <h2>实时告警</h2>
        <div v-if="!dashboard.homeAlarmRows.length" class="empty-state">暂无告警接口数据</div>
        <el-table :data="dashboard.homeAlarmRows" class="dark-table fill-table">
          <el-table-column prop="0" label="告警时间" width="170" />
          <el-table-column prop="1" label="设备名称" />
          <el-table-column prop="2" label="告警类型" width="100" />
          <el-table-column label="级别" width="80">
            <template #default="scope"><el-tag :type="scope?.row?.[3] === '重要' ? 'danger' : 'warning'" effect="dark">{{ scope?.row?.[3] || '-' }}</el-tag></template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="scope"><span class="state" :class="scope?.row?.[4] === '未处理' ? 'pending' : 'done'">{{ scope?.row?.[4] || '-' }}</span></template>
          </el-table-column>
        </el-table>
      </article>
    </div>
  </section>
</template>
