<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { layoutStorageKey, readStoredLayout, reconcileLayout, updateLayout, moveLayout } from '../charts/dashboardLayout.js'

const props = defineProps({ scope: { type: String, required: true }, items: { type: Array, required: true }, uniform: Boolean, hideToolbar: Boolean, defaultGridClass: String, defaultSpan: { type: Number, default: 1 }, defaultHeight: { type: Number, default: 260 } })
const saved = ref(null)
const editing = ref(false)
const storageError = ref('')
const grid = ref(null)
const dragging = ref('')
const target = ref('')
const cards = computed(() => reconcileLayout(props.items, saved.value, props.defaultSpan, props.defaultHeight))
const visibleCards = computed(() => cards.value.filter(item => item.visible))
const customized = computed(() => Boolean(saved.value) || editing.value)
let cleanupGesture

watch(() => props.scope, () => {
  cleanupGesture?.()
  editing.value = false
  storageError.value = ''
  try { saved.value = readStoredLayout(localStorage, props.scope) }
  catch { saved.value = null; storageError.value = '无法读取布局配置，本次修改仍可在页面使用。' }
}, { immediate: true })

function persist(value) {
  saved.value = value
  try {
    if (value) localStorage.setItem(layoutStorageKey(props.scope), JSON.stringify(value))
    else localStorage.removeItem(layoutStorageKey(props.scope))
    storageError.value = ''
  } catch { storageError.value = '浏览器无法保存配置，刷新后可能丢失本次布局。' }
}
function change(id, patch) { persist(updateLayout(saved.value, cards.value, id, patch)) }
function move(id, targetId) { persist(moveLayout(saved.value, cards.value, id, targetId)) }
function step(card, offset) {
  const index = visibleCards.value.findIndex(item => item.id === card.id)
  const other = visibleCards.value[index + offset]
  if (other) move(card.id, other.id)
}
function reset() { cleanupGesture?.(); editing.value = false; persist(null) }
function toggleEditing() {
  cleanupGesture?.()
  if (editing.value) persist(updateLayout(saved.value, cards.value))
  editing.value = !editing.value
}
function gesture(event, onMove, onEnd, onCancel = () => {}) {
  if (event.button !== 0) return
  event.preventDefault()
  cleanupGesture?.()
  const handle = event.currentTarget
  handle.setPointerCapture(event.pointerId)
  const movePointer = e => { if (e.pointerId === event.pointerId) onMove(e) }
  const finish = e => {
    if (e.pointerId !== event.pointerId) return
    clean()
    if (e.type === 'pointerup') onEnd(e)
    else onCancel()
  }
  function clean() {
    handle.removeEventListener('pointermove', movePointer)
    handle.removeEventListener('pointerup', finish)
    handle.removeEventListener('pointercancel', finish)
    handle.removeEventListener('lostpointercapture', finish)
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    dragging.value = ''; target.value = ''; cleanupGesture = null
  }
  handle.addEventListener('pointermove', movePointer)
  handle.addEventListener('pointerup', finish)
  handle.addEventListener('pointercancel', finish)
  handle.addEventListener('lostpointercapture', finish)
  cleanupGesture = () => { clean(); onCancel() }
}
function startDrag(event, card) {
  let destination = ''
  gesture(event, e => {
    dragging.value = card.id
    const element = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-layout-id]')
    destination = element && grid.value?.contains(element) ? element.dataset.layoutId : ''
    target.value = destination
  }, () => { if (destination) move(card.id, destination) })
}
function startResize(event, card) {
  const startX = event.clientX, startY = event.clientY
  const columnWidth = (grid.value.clientWidth + 12) / 4
  let patch = {}
  const original = saved.value
  gesture(event, e => {
    patch = { span: Math.max(1, Math.min(4, card.span + Math.round((e.clientX - startX) / columnWidth))), height: Math.max(180, Math.min(900, card.height + e.clientY - startY)) }
    saved.value = updateLayout(original, cards.value, card.id, patch)
  }, () => change(card.id, patch), () => { saved.value = original })
}
onBeforeUnmount(() => cleanupGesture?.())
</script>

<template>
  <section class="configurable-dashboard">
    <slot v-if="!hideToolbar" name="toolbar" :editing="editing" :toggle-editing="toggleEditing" :reset="reset">
    <div class="layout-toolbar">
      <button type="button" :aria-pressed="editing" @click="toggleEditing">{{ editing ? '完成布局' : '编辑布局' }}</button>
      <button v-if="editing" type="button" @click="reset">恢复默认布局</button>
      <span>{{ editing ? '拖动标题调整顺序，拖动右下角调整大小；修改自动保存' : saved ? '自定义布局 · 已保存在当前浏览器' : '默认布局' }}</span>
    </div>
    </slot>
    <p v-if="storageError" role="alert" class="layout-warning">{{ storageError }}</p>
    <details v-if="editing" class="layout-settings" open>
      <summary>显示 / 隐藏卡片（{{ visibleCards.length }} / {{ cards.length }}）</summary>
      <div class="layout-visibility">
        <label v-for="card in cards" :key="card.id"><input type="checkbox" :checked="card.visible" @change="change(card.id, { visible: $event.target.checked })" />{{ card.title }}</label>
      </div>
    </details>
    <slot v-if="!customized && !uniform"><div :class="defaultGridClass"><template v-for="card in cards" :key="card.id"><slot name="card" :item="card" /></template></div></slot>
    <div v-else ref="grid" class="layout-grid" :class="{ editing }">
      <article v-for="(card, index) in visibleCards" :key="card.id" :data-layout-id="card.id" class="layout-card" :class="{ dragging: dragging === card.id, 'drop-target': target === card.id && dragging !== card.id }" :style="{ '--layout-span': card.span, '--layout-height': card.height + 'px', '--home-point-height': card.height + 'px' }">
        <header v-if="editing" class="layout-card-tools">
          <button type="button" class="layout-drag" :aria-label="'拖动 ' + card.title" @pointerdown="startDrag($event, card)" @keydown.left.prevent="step(card, -1)" @keydown.right.prevent="step(card, 1)">⠿ {{ card.title }}</button>
          <button type="button" :disabled="index === 0" :aria-label="'前移 ' + card.title" @click="step(card, -1)">←</button>
          <button type="button" :disabled="index === visibleCards.length - 1" :aria-label="'后移 ' + card.title" @click="step(card, 1)">→</button>
          <button type="button" :aria-label="'隐藏 ' + card.title" @click="change(card.id, { visible: false })">×</button>
        </header>
        <div class="layout-card-content"><slot name="card" :item="card" /></div>
        <footer v-if="editing" class="layout-size-controls">
          <label>宽度 <select :value="card.span" :aria-label="card.title + '宽度'" @change="change(card.id, { span: Number($event.target.value) })"><option v-for="span in 4" :key="span" :value="span">{{ span }} / 4</option></select></label>
          <label>高度 <input type="number" min="180" max="900" step="10" :value="card.height" :aria-label="card.title + '高度'" @change="change(card.id, { height: Number($event.target.value) })" /> px</label>
          <button type="button" class="layout-resize" :aria-label="'调整大小 ' + card.title" @pointerdown="startResize($event, card)" @keydown.up.prevent="change(card.id, { height: card.height - 10 })" @keydown.down.prevent="change(card.id, { height: card.height + 10 })">◢</button>
        </footer>
      </article>
      <p v-if="cards.length && !visibleCards.length" class="layout-empty">所有卡片已隐藏，请在“编辑布局”中勾选卡片，或恢复默认布局。</p>
    </div>
  </section>
</template>

<style scoped>
.configurable-dashboard { min-width:0; grid-column:1 / -1; }
.layout-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px; }
.layout-toolbar span,.layout-warning,.layout-empty { color:var(--text-muted); font-size:12px; }
button,select,input { font:inherit; color:var(--text-main); }
button,select { border:1px solid var(--glass-border); background:var(--glass-card); border-radius:5px; padding:6px 10px; }
button { cursor:pointer; } button:disabled { opacity:.4; cursor:default; }
button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--accent, #368ce8); outline-offset:2px; }
.layout-toolbar button[aria-pressed=true] { border-color:var(--accent, #368ce8); }
.layout-settings { border:1px solid var(--glass-border); border-radius:6px; padding:12px; margin-bottom:12px; background:var(--glass-card); font-size:13px; }
.layout-settings summary { cursor:pointer; }
.layout-visibility { display:flex; flex-wrap:wrap; gap:10px 20px; padding-top:12px; max-height:200px; overflow:auto; }
.layout-visibility label { display:flex; gap:6px; align-items:center; color:var(--text-main); }
.layout-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; align-items:start; }
.layout-card { grid-column:span var(--layout-span); min-width:0; position:relative; border-radius:6px; }
.layout-card-content { height:var(--layout-height); min-width:0; overflow:auto; }
.layout-card-content :deep(> *) { height:100%; min-height:0; box-sizing:border-box; }
.layout-card-content :deep(.home-point:not(.compact)) { display:flex; flex-direction:column; height:100%; box-sizing:border-box; }
.layout-card-content :deep(.home-point-chart) { flex:1; min-height:65px; height:auto; }
.layout-card-content :deep(.home-point.compact) { height:100%; }
.layout-card-content :deep(.compact .home-point-chart) { height:100%; }
.layout-card-content :deep(.sound-chart) { display:flex; flex-direction:column; height:100%; box-sizing:border-box; }
.layout-card-content :deep(.sound-chart .plot) { flex:1; min-height:65px; height:auto; }
.layout-card-content :deep(.sound-chart .spectrogram-canvas) { height:100%; }
.layout-card-content :deep(.live-point-card) { display:flex; flex-direction:column; }
.layout-card-content :deep(.point-chart) { flex:1; min-height:80px; height:auto; }
.layout-card-content :deep(.acoustic-point-card) { display:flex; flex-direction:column; }
.layout-card-content :deep(.compact-waveform) { flex:1; min-height:80px; height:auto; }
.editing .layout-card { border:1px dashed var(--control-border-active, #368ce8); }
.layout-card-tools { display:flex; gap:3px; align-items:center; padding:5px; background:var(--glass-card); }
.layout-card-tools button { padding:4px 6px; }
.layout-drag { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; cursor:grab; touch-action:none; user-select:none; }
.layout-size-controls { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:6px; font-size:11px; background:var(--glass-card); }
.layout-size-controls label { display:flex; align-items:center; gap:4px; }
.layout-size-controls select { padding:2px; }.layout-size-controls input { width:52px; padding:2px; background:var(--page-bg); border:1px solid var(--glass-border); border-radius:3px; }
.layout-resize { margin-left:auto; touch-action:none; cursor:nwse-resize; }
.dragging { opacity:.55; }.drop-target { outline:2px solid var(--accent, #368ce8); }
.layout-empty { grid-column:1 / -1; padding:24px; text-align:center; }
@media(max-width:650px) { .layout-grid { grid-template-columns:minmax(0,1fr); }.layout-card { grid-column:1; }.layout-toolbar span { flex-basis:100%; } }
</style>
