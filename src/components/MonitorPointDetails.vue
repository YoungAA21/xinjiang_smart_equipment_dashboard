<script setup>
import { computed } from 'vue'
import { ElDialog } from 'element-plus'
import DeviceDetailPage from '../views/DeviceDetailPage.vue'
import { monitoringPointName } from '../charts/equipmentCatalog.js'
import { acousticChannelDisplayName } from '../charts/machineGroups.js'

const props = defineProps({ row: { type: Object, required: true }, location: String })
const emit = defineEmits(['close'])
const title = computed(() => props.row.member.source === 'monitor'
  ? acousticChannelDisplayName(props.row.member.raw, props.row.point)
  : monitoringPointName(props.row.point))
const context = computed(() => ({
  source: props.row.member.source,
  device: props.row.member.id,
  pointId: props.row.point.pointId,
  channelId: props.row.point.channelId,
  tab: 'live',
  location: props.location,
}))
</script>

<template>
  <el-dialog :model-value="true" :title="title" width="min(1680px, 94vw)" top="5vh" draggable destroy-on-close append-to=".dashboard-shell" class="monitor-point-details" :close-on-click-modal="false" @closed="emit('close')">
    <DeviceDetailPage embedded :detail-context="context" @close="emit('close')" />
  </el-dialog>
</template>

<style>
.monitor-point-details.el-dialog { --el-dialog-bg-color:var(--page-bg); --el-text-color-primary:var(--text-main); color:var(--text-main); border:1px solid var(--control-border-active); border-radius:10px; }
.monitor-point-details .el-dialog__header { border-bottom:1px solid var(--glass-border); margin-bottom:14px; }
.monitor-point-details .el-dialog__title { color:var(--text-main); }
.monitor-point-details .embedded-detail { height:76vh; min-height:0; padding:0; }
.monitor-point-details .embedded-detail .device-workspace { display:grid; grid-template-columns:280px minmax(0,1fr); min-height:0; align-items:start; }
.monitor-point-details .embedded-detail .device-profile { position:static; }
.monitor-point-details .embedded-detail .profile-equipment-visual { height:240px; }
.monitor-point-details .embedded-detail .device-detail-tabs { position:sticky; top:0; z-index:2; background:var(--page-bg); }
.monitor-point-details .embedded-detail .live-point-grid { grid-template-columns:minmax(0,1fr); }
.monitor-point-details .embedded-detail .point-chart { height:380px; }
@media(max-width:900px) { .monitor-point-details .embedded-detail .device-workspace { grid-template-columns:minmax(0,1fr); } }
</style>
