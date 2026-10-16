<script setup>
import { computed, ref } from 'vue'
import { ElDrawer } from 'element-plus'
import { X } from 'lucide-vue-next'
import DeviceDetailPage from '../views/DeviceDetailPage.vue'
import { monitoringPointName } from '../charts/equipmentCatalog.js'
import { acousticChannelDisplayName } from '../charts/machineGroups.js'

const props = defineProps({ row: { type: Object, required: true }, location: String })
const emit = defineEmits(['close'])
const open = ref(true)
const title = computed(() => props.row.member.source === 'monitor'
  ? acousticChannelDisplayName(props.row.member.raw, props.row.point)
  : monitoringPointName(props.row.point))
const context = computed(() => ({
  source: props.row.member.source,
  device: props.row.member.id,
  pointId: props.row.point.pointId,
  channelId: props.row.point.channelId,
  pointCode: props.row.point.pointCode,
  tab: 'live',
  location: props.location,
}))
</script>

<template>
  <ElDrawer v-model="open" :title="title" direction="rtl" size="100%" :with-header="false" destroy-on-close append-to=".dashboard-shell" modal-class="monitor-point-overlay" class="monitor-point-details" :close-on-click-modal="false" @closed="emit('close')">
    <button class="point-details-close" type="button" aria-label="关闭测点详情" title="关闭测点详情" @click="open = false"><X :size="22" /></button>
    <DeviceDetailPage embedded :detail-context="context" @close="open = false" />
  </ElDrawer>
</template>

<style>
.monitor-point-overlay { left:var(--dashboard-sidebar-width,260px); }
.monitor-point-details.el-drawer { --el-drawer-bg-color:var(--page-bg); --el-text-color-primary:var(--text-main); color:var(--text-main); border-left:1px solid var(--glass-border); box-shadow:-14px 0 50px #0003; }
.monitor-point-details .el-drawer__body { position:relative; padding:20px; overflow:hidden; min-height:0; }
.point-details-close { position:absolute; top:20px; right:20px; z-index:5; display:grid; place-items:center; width:38px; height:38px; padding:0; border:1px solid var(--glass-border); border-radius:6px; background:var(--page-bg); color:var(--text-muted); cursor:pointer; }
.point-details-close:hover { color:var(--text-main); border-color:var(--control-border-active); }
.point-details-close:focus-visible { outline:2px solid var(--control-border-active); outline-offset:2px; }
.monitor-point-details .embedded-detail { height:100%; min-height:0; padding:0; overflow:hidden; }
.monitor-point-details .embedded-detail .device-workspace { display:grid; grid-template-columns:230px minmax(0,1fr); gap:20px; height:100%; min-height:0; align-items:stretch; }
.monitor-point-details .embedded-detail .device-profile { position:static; align-self:stretch; overflow-y:auto; padding:18px; }
.monitor-point-details .embedded-detail .device-profile h2 { margin:0; font-size:19px; }
.monitor-point-details .embedded-detail .profile-equipment-visual { height:190px; }
.monitor-point-details .embedded-detail .device-detail { min-height:0; overflow-y:auto; padding-right:2px; }
.monitor-point-details .embedded-detail .device-detail-tabs { position:sticky; top:0; z-index:3; background:var(--page-bg); padding-right:52px; border-radius:0; }
.monitor-point-details .embedded-detail .device-detail-tabs button { padding:12px 8px; }
.monitor-point-details .embedded-detail #device-panel-live { flex:1; }
.monitor-point-details .embedded-detail #device-panel-live > .configurable-dashboard { flex:1; }
.monitor-point-details .embedded-detail .live-point-grid { grid-template-columns:minmax(0,1fr); height:100%; }
.monitor-point-details .embedded-detail .live-point-card { display:flex; flex-direction:column; min-height:460px; height:100%; box-sizing:border-box; }
.monitor-point-details .embedded-detail .point-chart { flex:1; min-height:280px; height:clamp(280px,45vh,640px); }
.monitor-point-details .embedded-detail .history-form { grid-template-columns:repeat(2,minmax(0,1fr)) 110px auto; }
@media(max-width:1100px) {
  .monitor-point-details .el-drawer__body { padding:14px; }
  .point-details-close { top:14px; right:14px; }
  .monitor-point-details .embedded-detail .device-workspace { grid-template-columns:190px minmax(0,1fr); gap:14px; }
  .monitor-point-details .embedded-detail .history-form { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
@media(max-width:750px) {
  .monitor-point-details .embedded-detail { overflow-y:auto; }
  .monitor-point-details .embedded-detail .device-workspace { display:flex; flex-direction:column; flex:none; height:auto; }
  .monitor-point-details .embedded-detail .device-profile { order:2; overflow:visible; }
  .monitor-point-details .embedded-detail .device-detail { flex:none; overflow:visible; }
  .monitor-point-details .embedded-detail .device-detail-tabs { padding-right:44px; overflow-x:auto; }
  .monitor-point-details .embedded-detail .device-detail-tabs button { flex:none; }
}
</style>
