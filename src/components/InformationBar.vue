<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { MessageSquare } from 'lucide-vue-next'
import { clearInformation, subscribeInformation } from '../services/information.js'

const props = defineProps({ collapsed: Boolean })
const messages = ref([])
const expanded = ref(false)
const trigger = ref(null)
const popup = ref(null)
const position = ref({})
const unread = ref(false)
const unsubscribe = subscribeInformation(value => {
  const previous = new Map(messages.value.map(item => [item.id, item.count]))
  const arrived = value.some(item => !previous.has(item.id) || item.count > previous.get(item.id))
  messages.value = value
  if (!value.length) unread.value = false
  else if (arrived && !expanded.value) {
    unread.value = true
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      trigger.value?.animate?.([
        { transform: 'translateX(0)' }, { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' }, { transform: 'translateX(-3px)' },
        { transform: 'translateX(3px)' }, { transform: 'translateX(0)' },
      ], { duration: 550, easing: 'ease-in-out' })
    }
  }
})
const time = value => new Date(value).toLocaleString('zh-CN', { hour12: false })
function updatePosition() {
  if (!trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const width = Math.min(520, window.innerWidth - 24)
  position.value = {
    left: `${Math.max(12, Math.min(rect.right + 12, window.innerWidth - width - 12))}px`,
    bottom: `${Math.max(12, window.innerHeight - rect.bottom)}px`,
  }
}
function toggle() { updatePosition(); expanded.value = !expanded.value; if (expanded.value) unread.value = false }
function outside(event) {
  if (!trigger.value?.contains(event.target) && !popup.value?.contains(event.target)) expanded.value = false
}
function keydown(event) {
  if (event.key === 'Escape' && expanded.value) { expanded.value = false; trigger.value?.focus() }
}
onMounted(() => {
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', keydown)
  window.addEventListener('resize', updatePosition)
})
onBeforeUnmount(() => {
  unsubscribe()
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('keydown', keydown)
  window.removeEventListener('resize', updatePosition)
})
</script>

<template>
  <button ref="trigger" class="message-trigger" type="button" :class="{ compact: props.collapsed, active: expanded, unread }" :aria-expanded="expanded" aria-controls="system-information-popup" :aria-label="unread ? '消息，有新消息' : '消息'" :title="unread ? '有新消息，点击查看' : '消息'" @click="toggle">
    <MessageSquare :size="18" /><span v-if="!props.collapsed">消息</span><span v-if="messages.length" class="message-count">{{ messages.length > 99 ? '99+' : messages.length }}</span>
  </button>
  <Teleport to="body">
    <section v-if="expanded" id="system-information-popup" ref="popup" class="information-popup" :style="position" role="dialog" aria-label="系统消息">
      <header><strong>消息 <span>{{ messages.length }}</span></strong><button type="button" :disabled="!messages.length" @click="clearInformation">清空</button></header>
      <div class="information-list" role="log" aria-live="polite">
        <p v-if="!messages.length" class="information-empty">暂无信息</p>
        <article v-for="item in messages" :key="item.id">
          <div><strong>{{ item.source }}</strong><time>{{ time(item.time) }}</time><span v-if="item.count > 1">{{ item.count }} 次</span></div>
          <p>{{ item.message }}</p>
        </article>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.message-trigger { position:relative; display:flex; align-items:center; justify-content:center; gap:10px; width:100%; min-height:40px; padding:8px 12px; color:inherit; background:transparent; border:1px solid var(--glass-border); border-radius:6px; cursor:pointer; font:inherit; font-size:14px; }
.message-trigger.compact { width:40px; padding:8px; align-self:center; }
.message-trigger:hover,.message-trigger.active { background:var(--control-bg-active); border-color:var(--accent,#78c9a6); }
.message-count { border-radius:10px; padding:1px 5px; color:#fff; background:#23845b; font-size:11px; }
.message-trigger.unread { border-color:#39b879; box-shadow:0 0 0 2px #39b87925; }
.compact .message-count { position:absolute; top:-5px; right:-8px; }
.information-popup { position:fixed; z-index:2100; width:min(520px,calc(100vw - 24px)); max-height:calc(100vh - 24px); overflow:auto; color:var(--control-text); background:var(--el-bg-color-overlay,#17251f); border:1px solid var(--glass-border); border-radius:8px; box-shadow:0 4px 24px #0003; }
header { display:flex; justify-content:space-between; gap:12px; padding:10px 14px; }
header button { font:inherit; font-size:13px; color:inherit; background:transparent; border:0; cursor:pointer; padding:4px; }
button:disabled { opacity:.4; cursor:default; }button:focus-visible { outline:2px solid var(--accent,#78c9a6); outline-offset:2px; }
header span { margin-left:8px; font-variant-numeric:tabular-nums; }
.information-list { max-height:min(360px,50vh); overflow:auto; border-top:1px solid var(--glass-border); }
article { padding:10px 14px; border-bottom:1px solid var(--glass-border); font-size:13px; }
article > div { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }time,article span { color:var(--control-muted); font-size:12px; }
article p { margin:6px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; }.information-empty { padding:10px 14px; color:var(--control-muted); font-size:13px; }
</style>
