<script setup>
import { computed, ref, watch } from 'vue'
import { ElDialog } from 'element-plus'
import { useAlarmColorsStore } from '../stores/alarmColors.js'
import { alarmSeverity, alarmKind, alarmIdentity, alarmColorName } from '../charts/alarmColors.js'

const props = defineProps({ events: { type: Array, default: () => [] } })
const colors = useAlarmColorsStore()
colors.ensureUser()
const open = ref(false)
const scope = ref('kind')
const target = ref('')
const selection = ref('yellow')
const savedMessage = ref('')
const options = computed(() => [...new Map(props.events.map(event => {
  const value = scope.value === 'alarm' ? alarmIdentity(event) : scope.value === 'kind' ? alarmKind(event) : alarmSeverity(event)
  return [value, { value, label: scope.value === 'alarm' ? `${event.name || event.reason || event.pointCode || '报警'} · ${event.startedAt || value}` : value }]
})).values()])
const ruleKey = computed(() => JSON.stringify([scope.value, target.value.trim()]))
const defaultSelection = computed(() => {
  const event = props.events.find(event => (scope.value === 'alarm' ? alarmIdentity(event) : scope.value === 'kind' ? alarmKind(event) : alarmSeverity(event)) === target.value.trim())
  return event ? alarmColorName(event) : 'yellow'
})
watch(scope, () => { target.value = '' })
watch([ruleKey, defaultSelection], ([key, defaultColor]) => { selection.value = colors.rules[key] || defaultColor; savedMessage.value = '' })
watch(() => colors.rules[ruleKey.value], value => { selection.value = value || defaultSelection.value })
function save() {
  if (!target.value.trim()) return
  colors.save(ruleKey.value, selection.value)
  savedMessage.value = colors.error ? '' : '已保存'
}
function reset() {
  colors.save(ruleKey.value, '')
  savedMessage.value = colors.error ? '' : '已恢复默认'
}
</script>

<template>
  <button type="button" class="alarm-colors-button" @click="open = true">颜色设置</button>
  <ElDialog v-model="open" title="报警颜色设置" width="540px" append-to-body class="alarm-colors-dialog">
    <div class="alarm-color-form">
      <label>设置范围<select v-model="scope" aria-label="颜色设置范围"><option value="kind">警种</option><option value="severity">报警级别</option><option value="alarm">单条报警</option></select></label>
      <label>{{ scope === 'alarm' ? '报警' : scope === 'kind' ? '警种' : '级别' }}<select v-if="scope === 'alarm'" v-model="target" aria-label="颜色配置对象"><option value="">请选择报警</option><option v-for="item in options" :key="item.value" :value="item.value">{{ item.label }}</option></select><input v-else v-model="target" list="alarm-color-options" aria-label="颜色配置对象" placeholder="选择或输入接口中的警种 / 级别" /><datalist id="alarm-color-options"><option v-for="item in options" :key="item.value" :value="item.value" /></datalist></label>
      <div class="color-options" role="group" aria-label="报警颜色"><button type="button" class="yellow" :aria-pressed="selection === 'yellow'" @click="selection = 'yellow'">黄色</button><button type="button" class="orange" :aria-pressed="selection === 'orange'" @click="selection = 'orange'">橙色</button><button type="button" class="red" :aria-pressed="selection === 'red'" @click="selection = 'red'">红色</button></div>
      <p>单条报警优先于警种，警种优先于级别。配置仅影响显示颜色。</p>
      <p v-if="colors.error" role="alert">{{ colors.error }}</p>
      <p v-if="savedMessage" role="status">{{ savedMessage }}</p>
      <div class="color-form-actions"><button type="button" :disabled="!target.trim()" @click="reset">恢复默认</button><button type="button" class="color-save-button" :disabled="!target.trim()" @click="save">保存颜色</button></div>
    </div>
  </ElDialog>
</template>

<style>
.alarm-colors-button { padding:5px 10px; font:inherit; color:var(--text-main); border:1px solid var(--glass-border); background:var(--control-bg); border-radius:4px; cursor:pointer; }
.alarm-colors-dialog.el-dialog {
  --el-dialog-bg-color:var(--el-bg-color-overlay);
  color-scheme:dark;
  color:var(--control-text);
  background:var(--el-bg-color-overlay);
  border:1px solid var(--control-border-active);
  border-radius:10px;
  box-shadow:0 20px 60px #0006;
  max-width:calc(100vw - 32px);
  max-height:85vh;
  display:flex;
  flex-direction:column;
}
.light-theme .alarm-colors-dialog { color-scheme:light; box-shadow:0 20px 60px #173d3026; }
.alarm-colors-dialog .el-dialog__header { border-bottom:1px solid var(--control-border); padding-bottom:16px; }
.alarm-colors-dialog .el-dialog__title { color:var(--control-text); font-size:22px; font-weight:600; }
.alarm-colors-dialog .el-dialog__headerbtn .el-dialog__close { color:var(--control-muted); }
.alarm-colors-dialog .el-dialog__headerbtn:hover .el-dialog__close,
.alarm-colors-dialog .el-dialog__headerbtn:focus-visible .el-dialog__close { color:var(--control-text); }
.alarm-colors-dialog .el-dialog__body { color:var(--control-text); padding:20px 0 0; min-height:0; overflow-y:auto; }
.alarm-color-form { display:grid; gap:18px; font-size:17px; }
.alarm-color-form label { display:grid; gap:9px; color:var(--control-text); }
.alarm-color-form input,.alarm-color-form select {
  width:100%; min-height:40px; padding:7px 10px; font:inherit;
  color:var(--control-text); background:var(--control-bg);
  border:1px solid var(--control-border); border-radius:6px;
}
.alarm-color-form select option { color:var(--control-text); background:var(--el-bg-color-overlay); }
.alarm-color-form input::placeholder { color:var(--control-muted); }
.alarm-color-form input:focus-visible,.alarm-color-form select:focus-visible { outline:2px solid var(--control-border-active); outline-offset:2px; }
.color-options,.color-form-actions { display:flex; gap:12px; }
.color-form-actions { justify-content:flex-end; border-top:1px solid var(--control-border); padding-top:16px; }
.alarm-color-form button { min-height:40px; padding:8px 18px; border:1px solid var(--control-border); background:var(--control-bg); border-radius:6px; color:var(--control-text); font:inherit; cursor:pointer; }
.alarm-color-form button:not(:disabled):hover { background:var(--control-bg-hover); border-color:var(--control-border-active); }
.alarm-color-form button:focus-visible { outline:2px solid var(--control-border-active); outline-offset:2px; }
.alarm-color-form button:disabled { opacity:.4; cursor:default; }
.color-options button { flex:1; }
.color-options .yellow { color:var(--alarm-color-yellow); }
.color-options .orange { color:var(--alarm-color-orange); }
.color-options .red { color:var(--alarm-color-red); }
.color-options button[aria-pressed=true] { border-color:currentColor; box-shadow:inset 0 0 0 1px currentColor; background:color-mix(in srgb,currentColor 10%,var(--el-bg-color-overlay)); }
.alarm-color-form .color-save-button { color:#fff; border-color:#46907c; background:#327667; }
.alarm-color-form .color-save-button:not(:disabled):hover { color:#fff; border-color:#62baa3; background:#3b8776; }
.alarm-color-form p { margin:0; font-size:14px; line-height:1.7; color:var(--control-muted); }
.alarm-color-form p[role=alert] { color:var(--alarm-color-red); }
.alarm-color-form p[role=status] { color:var(--control-text); }
</style>
