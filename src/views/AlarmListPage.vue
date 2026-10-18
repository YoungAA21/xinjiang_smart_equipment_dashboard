<script setup>
import { computed, ref } from 'vue'
import LegacyAlarmPanel from '../components/LegacyAlarmPanel.vue'
import AnalysisAlarmPanel from '../components/AnalysisAlarmPanel.vue'
import { useAlarmColorsStore } from '../stores/alarmColors.js'
import '../styles/alarms.css'
import '../styles/analysis-alarms.css'
import { useRoute } from 'vue-router'
const route = useRoute()
const alarmColors = useAlarmColorsStore()
alarmColors.ensureUser()
const initialAlarmScope = computed(() => ({ machineId: String(route.query.machine || ''), modelId: String(route.query.model || ''),
  locationId: String(route.query.location || ''), targetId: String(route.query.target || ''), pointId: String(route.query.pointId || '') }))

const activePane = ref('legacy')
</script>

<template>
  <section class="page single-page alarm-page analysis-workspace" aria-label="告警管理">
    <el-tabs v-model="activePane" class="alarm-tabs">
      <el-tab-pane label="采集报警" name="legacy">
        <LegacyAlarmPanel :initial-scope="initialAlarmScope" :initial-module-id="String(route.query.moduleId || '')" :initial-point-code="String(route.query.pointCode || '')" :row-color="alarmColors.color" />
      </el-tab-pane>
      <el-tab-pane label="趋势报警" name="analysis">
        <AnalysisAlarmPanel :initial-scope="initialAlarmScope" :row-color="alarmColors.color" />
      </el-tab-pane>
    </el-tabs>
  </section>
</template>
