<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElDialog, ElButton } from 'element-plus'
import { useDigitalAlarmStore } from '../stores/digitalAlarms.js'
import { alarmTime } from '../charts/alarms.js'
import { presentMonitoringPoint } from '../charts/equipmentCatalog.js'
const alarms = useDigitalAlarmStore()
const notifications = computed(() => alarms.notifications.map(presentMonitoringPoint))
const router = useRouter()
function openAlarm(row) {
  alarms.dismiss()
  router.push({ path: '/alarm/list', query: { moduleId: row.moduleId, pointCode: row.pointCode } })
}
</script>
<template>
  <ElDialog :model-value="alarms.notifications.length > 0" title="DI 信号告警" class="di-alarm-dialog" width="min(680px, 94vw)" append-to=".dashboard-shell" :close-on-click-modal="false" @close="alarms.dismiss()">
    <article v-for="row in notifications" :key="row.alarmId" class="di-incident">
      <strong>{{ row.name }}</strong>
      <p>{{ row.moduleId }} · {{ row.channelId }} · {{ row.host }}</p>
      <p>触发时间：{{ alarmTime(row.startedAt) }} · 信号值：{{ row.alarmValue }} {{ row.unit }} · {{ row.isActive ? '当前告警' : '已恢复' }}</p>
      <ElButton type="primary" @click="openAlarm(row)">查看该点位告警</ElButton>
    </article>
    <p v-if="alarms.cacheError" role="alert">{{ alarms.cacheError }}</p>
    <template #footer><ElButton @click="alarms.dismiss()">知道了</ElButton></template>
  </ElDialog>
</template>
<style>
.di-alarm-dialog.el-dialog {
  --el-dialog-bg-color:var(--page-bg);
  --el-text-color-primary:var(--text-main);
  --el-text-color-regular:var(--text-muted);
  color:var(--text-main);
  background:var(--page-bg);
  border:1px solid var(--control-border-active);
  border-radius:10px;
  box-shadow:0 20px 60px #0006;
  max-height:80vh;
  display:flex;
  flex-direction:column;
}
.di-alarm-dialog .el-dialog__header { border-bottom:1px solid var(--glass-border); padding-bottom:14px; }
.di-alarm-dialog .el-dialog__title { color:var(--text-main); font-weight:600; }
.di-alarm-dialog .el-dialog__headerbtn .el-dialog__close { color:var(--text-muted); }
.di-alarm-dialog .el-dialog__headerbtn:hover .el-dialog__close { color:var(--text-main); }
.di-alarm-dialog .el-dialog__body { color:var(--text-main); padding:16px 0; overflow-y:auto; min-height:0; }
.di-alarm-dialog .el-dialog__footer { border-top:1px solid var(--glass-border); padding-top:14px; }
.di-alarm-dialog .di-incident { padding:14px; border:1px solid var(--glass-border); border-radius:6px; background:var(--glass-card); }
.di-alarm-dialog .di-incident + .di-incident { margin-top:12px; }
.di-alarm-dialog .di-incident strong { color:var(--text-main); font-size:17px; }
.di-alarm-dialog .di-incident p { color:var(--text-muted); margin:8px 0; }
</style>
