<template>
  <div class="visualization-grid">
    <section class="visual-card waveform-card">
      <header>
        <div>
          <strong>时域音轨</strong>
          <span>{{ waveformMode === 'envelope' ? '对称峰值包络 / Time' : '采样折线 / Time' }}</span>
        </div>
        <div class="waveform-actions">
          <button :class="{ active: waveformMode === 'line' }" @click="waveformMode = 'line'">采样折线</button>
          <button :class="{ active: waveformMode === 'envelope' }" @click="waveformMode = 'envelope'">时域包络</button>
          <span class="unit">±1.0</span>
        </div>
      </header>
      <div class="waveform chart-grid">
        <span class="axis-line"></span>
        <div v-if="!waveform.length && !waveformEnvelope.length" class="empty-chart">等待实时时域数据</div>
        <svg viewBox="0 0 1000 180" preserveAspectRatio="none" aria-label="时域音轨">
          <defs>
            <linearGradient id="waveGradient" x1="0" x2="1">
              <stop offset="0" stop-color="#60a5fa" />
              <stop offset="0.52" stop-color="#2563eb" />
              <stop offset="1" stop-color="#14b8a6" />
            </linearGradient>
          </defs>
          <path v-if="waveformMode === 'envelope'" :d="envelopePath" fill="url(#waveGradient)" fill-opacity=".58" stroke="#2563eb" stroke-width="1" vector-effect="non-scaling-stroke" />
          <polyline v-else :points="waveformPoints" fill="none" stroke="url(#waveGradient)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
        </svg>
        <div class="amplitude-scale"><span>+1</span><span>0</span><span>-1</span></div>
        <div class="time-scale">
          <span>-{{ windowSeconds }}s</span>
          <span>-{{ windowSeconds * 0.75 }}s</span>
          <span>-{{ windowSeconds * 0.5 }}s</span>
          <span>-{{ windowSeconds * 0.25 }}s</span>
          <span>当前</span>
        </div>
      </div>
    </section>

    <section class="visual-card spectrum-card">
      <header>
        <div><strong>频域响应</strong><span>Frequency Response</span></div>
        <span class="unit">dB / Hz</span>
      </header>
      <div class="spectrum chart-grid" aria-label="频域响应">
        <div v-if="!displayedSpectrum.length" class="empty-chart">等待实时频域数据</div>
        <div class="spectrum-bars">
          <span v-for="(value, index) in displayedSpectrum" :key="index" :style="{ height: `${value}%` }"></span>
        </div>
        <div class="frequency-scale"><span>20</span><span>100</span><span>1k</span><span>5k</span><span>20k Hz</span></div>
      </div>
    </section>

    <section class="visual-card waterfall-card">
      <header>
        <div><strong>频谱瀑布图</strong><span>Spectrogram Waterfall</span></div>
        <span class="unit">时间 / 频率</span>
      </header>
      <div class="waterfall" aria-label="频谱瀑布图">
        <SpectrogramCanvas :frames="displayedWaterfall" :sample-rate="sampleRate" />
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import SpectrogramCanvas from './SpectrogramCanvas.vue'

const props = defineProps({
  active: { type: Boolean, default: false },
  waveform: { type: Array, default: () => [] },
  waveformEnvelope: { type: Array, default: () => [] },
  spectrumData: { type: Array, default: () => [] },
  waterfallData: { type: Array, default: () => [] },
  sampleRate: { type: Number, default: 22000 },
  windowSeconds: { type: Number, default: 10 },
})

const waveformMode = ref('envelope')

const displayedSpectrum = computed(() => props.spectrumData.map((item) => {
  const value = typeof item === 'number' ? item : item?.db
  return Math.max(2, Math.min(100, ((Number(value) || -120) + 120) / 1.2))
}))
const displayedWaterfall = computed(() => props.waterfallData.map((row) =>
  row.map((value) => value > 1 || value < 0 ? Math.max(0, Math.min(1, (value + 120) / 120)) : value)))

const waveformPoints = computed(() => {
  const values = props.waveform
  return values.map((sample, index) => {
    const x = index / Math.max(1, values.length - 1) * 1000
    const y = 90 - Number(sample || 0) * 72
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
})

const envelopePath = computed(() => {
  const source = props.waveformEnvelope.length
    ? props.waveformEnvelope
    : props.waveform.map((value) => [-Math.abs(Number(value) || 0), Math.abs(Number(value) || 0)])
  if (!source.length) return ''
  const top = source.map((pair, index) => {
    const peak = Math.max(Math.abs(Number(pair?.[0]) || 0), Math.abs(Number(pair?.[1]) || 0))
    return `${(index / Math.max(1, source.length - 1) * 1000).toFixed(2)},${(90 - peak * 72).toFixed(2)}`
  })
  const bottom = [...source].reverse().map((pair, reverseIndex) => {
    const index = source.length - 1 - reverseIndex
    const peak = Math.max(Math.abs(Number(pair?.[0]) || 0), Math.abs(Number(pair?.[1]) || 0))
    return `${(index / Math.max(1, source.length - 1) * 1000).toFixed(2)},${(90 + peak * 72).toFixed(2)}`
  })
  return `M ${top.join(' L ')} L ${bottom.join(' L ')} Z`
})
</script>

<style scoped>
.visualization-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
.visual-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  background: var(--chart-card-bg);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
.visual-card header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.visual-card header div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.visual-card strong {
  color: var(--chart-text);
  font-size: 14px;
}
.visual-card header div span,
.unit {
  color: var(--chart-muted);
  font-size: 11px;
}
.visual-card header .waveform-actions {
  align-items: center;
  flex-direction: row;
  gap: 4px;
}
.waveform-actions button {
  padding: 4px 8px;
  color: var(--chart-muted);
  background: transparent;
  border: 1px solid rgba(171, 235, 218, 0.18);
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}
.waveform-actions button.active {
  color: #88f36c;
  background: rgba(136, 243, 108, 0.11);
  border-color: rgba(136, 243, 108, 0.42);
}
.chart-grid {
  position: relative;
  min-height: 178px;
  overflow: hidden;
  background-image:
    linear-gradient(var(--chart-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--chart-grid-line) 1px, transparent 1px);
  background-size: 100% 25%, 10% 100%;
  border-radius: 7px;
}
.empty-chart {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  color: var(--chart-muted);
  font-size: 12px;
}
.waveform svg {
  position: absolute;
  inset: 0 0 20px;
  width: 100%;
  height: calc(100% - 20px);
}
.axis-line {
  position: absolute;
  top: calc(50% - 10px);
  left: 0;
  width: 100%;
  border-top: 1px dashed var(--chart-axis-line);
  opacity: 0.45;
}
.amplitude-scale {
  position: absolute;
  z-index: 1;
  top: 4px;
  bottom: 23px;
  left: 4px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  color: var(--chart-muted);
  font-size: 9px;
  pointer-events: none;
}
.time-scale,
.frequency-scale {
  display: flex;
  justify-content: space-between;
  color: var(--chart-muted);
  font-size: 10px;
}
.time-scale {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
}
.spectrum {
  min-height: 210px;
}
.spectrum-bars {
  position: absolute;
  inset: 8px 0 22px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
}
.spectrum-bars span {
  flex: 1;
  min-width: 2px;
  background: linear-gradient(180deg, #14b8a6, #2563eb);
  border-radius: 3px 3px 0 0;
  transition: height 0.14s linear;
}
.frequency-scale {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
}
.waterfall {
  position: relative;
  overflow: hidden;
  background: var(--chart-waterfall-bg);
  border-radius: 7px;
}
@media (max-height: 800px) {
  .visual-card {
    padding: 11px;
  }
  .visual-card header {
    margin-bottom: 8px;
  }
  .chart-grid,
  .spectrum {
    min-height: 150px;
  }
}
</style>
