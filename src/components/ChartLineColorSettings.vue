<script setup>
import { reactive, ref, watch } from 'vue'
import { defaultLineColors } from '../charts/liveLineColors.js'
import { configurationSnapshot, pointConfiguration, savePointConfiguration } from '../stores/pointConfiguration.js'

const draft = reactive({ ...pointConfiguration.lineColors })
const message = ref('')
const error = ref('')
const states = [{ key: 'normal', label: '正常值', hint: '默认绿色' }, { key: 'alarm', label: '报警值', hint: '默认黄色' }, { key: 'damage', label: '损坏值', hint: '默认红色 · 暂未启用' }]
watch(() => pointConfiguration.lineColors, colors => { Object.assign(draft, colors) })
function save() {
  message.value = ''
  error.value = ''
  try {
    savePointConfiguration({ ...configurationSnapshot(), lineColors: { ...draft } })
    message.value = '图表线条颜色已保存，测点详情和机组概览已同步'
  } catch (reason) { error.value = reason.message }
}
</script>

<template>
  <details class="line-color-settings">
    <summary>图表线条颜色 <span>正常 / 报警 / 损坏</span></summary>
    <form @submit.prevent="save">
      <p>用于测点详情和机组概览的实时数据线及实时数字，两者颜色同步。实时值超出已有上下限或存在当前报警时使用报警色；历史记录和趋势图不受影响。</p>
      <div class="line-color-fields">
        <label v-for="state in states" :key="state.key">
          <span>{{ state.label }}</span>
          <input v-model="draft[state.key]" type="color" :aria-label="state.label + '线条颜色'" @input="message = ''; error = ''" />
          <small>{{ state.hint }}</small>
        </label>
      </div>
      <p>尚未指定损坏阈值，红色暂作预留，不自动判定损坏。无有效实时值且无当前报警时，线条显示灰色。</p>
      <div class="line-color-actions"><button type="button" @click="Object.assign(draft, defaultLineColors); message = ''; error = ''">恢复默认颜色</button><button type="submit">保存线条颜色</button></div>
      <p v-if="message" role="status">{{ message }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
    </form>
  </details>
</template>

<style scoped>
.line-color-settings { margin-bottom:16px; border:1px solid var(--glass-border); border-radius:8px; background:var(--glass-card); color:var(--text-main); }
summary { padding:14px 18px; cursor:pointer; font-weight:600; }
summary span { margin-left:12px; font-size:13px; font-weight:400; color:var(--text-muted); }
form { padding:0 18px 16px; }
p { color:var(--text-muted); font-size:13px; line-height:1.7; margin:0 0 12px; }
.line-color-fields { display:flex; flex-wrap:wrap; gap:16px 32px; margin-bottom:14px; }
label { display:grid; grid-template-columns:auto 48px; gap:8px 16px; align-items:center; font-size:14px; }
input[type=color] { width:48px; height:32px; padding:3px; border:1px solid var(--control-border); border-radius:4px; background:var(--control-bg); cursor:pointer; }
small { grid-column:1 / -1; color:var(--text-muted); font-size:12px; }
.line-color-actions { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:10px; }
button { padding:8px 14px; border:1px solid var(--control-border); border-radius:5px; background:var(--control-bg); color:var(--text-main); font:inherit; cursor:pointer; }
button[type=submit] { background:#327667; color:#fff; }
[role=alert] { color:var(--alarm-color-red,#ff6565); }
[role=status] { color:var(--text-main); }
</style>
