<script setup>
import { computed } from 'vue'
import EChart from '../components/EChart.vue'
import { useDashboardStore } from '../stores/dashboard'

const dashboard = useDashboardStore()

const selectedPointKey = computed({
  get: () => [dashboard.selectedModuleId, dashboard.selectedChannelId, dashboard.selectedPointCode].filter(Boolean).join('|'),
  set: (value) => dashboard.selectPoint(value),
})

const onPointChange = async (value) => {
  dashboard.selectPoint(value)
  await dashboard.loadSelectedTelemetry()
}

</script>

<template>
  <section class="page single-page">
    <article class="panel analysis-panel">
      <h2>设备监控 / 趋势分析</h2>
      <div class="filters">
        <label>选择测点
          <el-select v-model="selectedPointKey" filterable @change="onPointChange">
            <el-option v-for="item in dashboard.pointOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </label>
        <label>当前参数 <el-select :model-value="dashboard.selectedPointCode || '无数据'"><el-option :label="dashboard.selectedPointCode || '无数据'" :value="dashboard.selectedPointCode || '无数据'" /></el-select></label>
      </div>
      <div v-if="!dashboard.pointOptions.length" class="empty-state">暂无实时测点接口数据</div>
      <EChart :option="dashboard.trendOption" />
      <div class="range-strip"></div>
    </article>
  </section>
</template>
