<template>
  <view class="page">
    <view class="header">
      <text class="title">最近一次睡眠记录回放</text>
      <text class="sub" v-if="session">（用于展示整晚数据回看）</text>
    </view>

    <view v-if="!session" class="card">
      <text class="muted">暂无记录（请先在首页点击“开始记录”，再“停止记录”）</text>
    </view>

    <view v-else>
      <!-- 概览 -->
      <view class="card">
        <view class="row">
          <text class="label">开始</text>
          <text class="value">{{ fmt(session.startTs) }}</text>
        </view>
        <view class="row">
          <text class="label">结束</text>
          <text class="value">{{ fmt(session.endTs) }}</text>
        </view>

        <view class="metrics">
          <view class="metric">
            <text class="mNum">{{ (session.samples || []).length }}</text>
            <text class="mText">采样点数</text>
          </view>
          <view class="metric">
            <text class="mNum">{{ (session.events || []).length }}</text>
            <text class="mText">报警次数</text>
          </view>
        </view>
      </view>

      <!-- 图表 -->
      <view class="card">
        <view class="cardTitle">
          <text class="h2">温度时间轴曲线</text>
          <text class="hint">（数据多时可左右拖动）</text>
        </view>

        <view class="chartBox" id="chartBox">
          <canvas
            canvas-id="tempLine"
            id="tempLine"
            class="chart"
            @touchstart="onChartTouchStart"
            @touchmove="onChartTouchMove"
          />
        </view>

        <view class="legendTip">
          <text class="dot blue" /><text class="lt">腹部(腰)</text>
          <text class="dot green" /><text class="lt">大腿</text>
          <text class="dot yellow" /><text class="lt">脚踝</text>
        </view>

        <view v-if="debugText" class="debug">{{ debugText }}</view>
      </view>

      <!-- 人体姿态回放 -->
      <view class="card">
        <view class="cardTitle">
          <text class="h2">人体姿态回放</text>
          <text class="hint">（拖动时间轴同步姿态与温度）</text>
        </view>

        <view v-if="(session.samples || []).length === 0" class="muted">暂无采样</view>

        <view v-else>
          <view class="row" style="margin-bottom: 10px;">
            <text class="label">选取时间点</text>
            <text class="value">{{ fmtTime(currentSample.ts) }}</text>
          </view>

          <slider
            :min="0"
            :max="Math.max(0, (session.samples || []).length - 1)"
            :value="selectedIdx"
            @changing="onSliderChanging"
            @change="onSliderChange"
            show-value
          />

          <HumanPose3D :pose="currentPoseFrame" :height="320" @ready="bodyReady = true" @error="bodyReady = false" />
          <view v-show="!bodyReady" class="chartBox" style="margin-top: 10px;">
            <canvas canvas-id="bodyCanvas" id="bodyCanvas" class="chart" />
          </view>

          <view class="muted" style="margin-top: 8px;">
            温度：腹 {{ currentSample.temp1 }}℃ / 大腿 {{ currentSample.temp2 }}℃ / 脚踝 {{ currentSample.temp3 }}℃
          </view>
        </view>
      </view>

      <!-- 采样预览 -->
      <view class="card">
        <view class="cardTitle">
          <text class="h2">采样预览</text>
          <text class="hint">（最近20条）</text>
        </view>

        <view v-if="previewSamples.length === 0" class="muted">暂无采样</view>

        <view v-for="(s, idx) in previewSamples" :key="idx" class="sampleRow">
          <text class="sampleTime">{{ fmtTime(s.ts) }}</text>
          <text class="sampleText">
            腹 {{ s.temp1 }}℃  腿 {{ s.temp2 }}℃  踝 {{ s.temp3 }}℃  电量 {{ s.battery == null ? '-' : (s.battery + '%') }}
          </text>
        </view>
      </view>

      <!-- 报警事件 -->
      <view class="card">
        <view class="cardTitle">
          <text class="h2">报警事件</text>
        </view>

        <view v-if="(session.events || []).length === 0" class="muted">无报警</view>

        <view v-for="(e, idx) in (session.events || [])" :key="'e' + idx" class="eventRow">
          <text class="eventIdx">{{ idx + 1 }}</text>
          <text class="eventText">{{ e.time }} - {{ e.type === 'kick' ? '疑似踢被' : '温度变化' }}{{ e.drop === '-' ? '' : ' ' + e.drop + '℃' }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import HumanPose3D from '@/components/HumanPose3D/HumanPose3D.vue'
import { buildPoseFrame } from '@/utils/poseFrame.js'
import uCharts from '@qiun/ucharts'
import { computeJoints2D, tempToColor } from '@/utils/bodyKinematics.js'

// 与首页一致：从本地缓存读取最近一次会话
import { ChunkedSessionRepository } from '@/repositories/chunkedSessionRepository.mjs'
import { createUniKeyValueStorage } from '@/repositories/keyValueStorage.mjs'

export default {
  components: { HumanPose3D },
  data() {
    return {
      session: null,
      chart: null,
      debugText: '',
      selectedIdx: 0,
      bodyReady: false
    }
  },
  computed: {
    currentPoseFrame() { return buildPoseFrame(this.currentSample, { now: 0 }) },
    previewSamples() {
      const arr = (this.session && this.session.samples) ? this.session.samples : []
      return arr.slice(Math.max(0, arr.length - 20))
    },
    currentSample() {
      const arr = (this.session && this.session.samples) ? this.session.samples : []
      const idx = Math.max(0, Math.min(this.selectedIdx, Math.max(0, arr.length - 1)))
      return arr[idx] || { ts: 0, temp1: '-', temp2: '-', temp3: '-' }
    }
  },
  onShow() {
    this.loadSession()
    // H5/真机都更稳：等页面渲染完成再算宽度再画图
    this.$nextTick(() => setTimeout(() => {
      this.renderTempLines()
      this.renderBody()
    }, 80))
  },
  onUnload() {
    // 释放图表对象（避免重复进入累积）
    this.chart = null
  },
  methods: {
    loadSession() {
      try {
        const repository = new ChunkedSessionRepository({ storage: createUniKeyValueStorage(uni) })
        repository.migrateLegacyFromStorage()
        const latest = repository.listSessions()[0]
        this.session = latest ? repository.loadSession(latest.id) : null
        this.selectedIdx = 0
      } catch (e) {
        console.warn('loadSession failed:', e)
        this.session = null
        uni.showToast({ title: '历史记录读取失败', icon: 'none' })
      }
    },

    // uCharts 滚动（拖动）支持
    onChartTouchStart(e) {
      if (this.chart && this.chart.scrollStart) this.chart.scrollStart(e)
    },
    onChartTouchMove(e) {
      if (this.chart && this.chart.scroll) this.chart.scroll(e)
    },

    // slider（人体图）
    onSliderChanging(e) {
      const v = Number(e.detail && e.detail.value)
      if (Number.isFinite(v)) {
        this.selectedIdx = Math.max(0, Math.min(v, (this.session?.samples?.length || 1) - 1))
        this.renderBody()
      }
    },
    onSliderChange(e) {
      const v = Number(e.detail && e.detail.value)
      if (Number.isFinite(v)) {
        this.selectedIdx = Math.max(0, Math.min(v, (this.session?.samples?.length || 1) - 1))
        this.renderBody()
      }
        this.renderTempLines()
    },

    renderBody() {
      const samples = (this.session && this.session.samples) ? this.session.samples : []
      if (!samples.length) return

      // 用 canvas 绘制一个“可坐标驱动”的 2D 人体骨架示例
      const q = uni.createSelectorQuery().in(this)
      q.select('#bodyCanvas').boundingClientRect(rect => {
        const width = Math.floor((rect && rect.width) ? rect.width : 320)
        const height = Math.floor((rect && rect.height) ? rect.height : 300)

        const ctx = uni.createCanvasContext('bodyCanvas', this)
        const s = this.currentSample
        const joints = computeJoints2D(s)

        // 坐标系：模型坐标 (x,y) → 画布坐标 (px)
        const origin = { x: width / 2, y: height * 0.75 }
        const scale = Math.min(width, height) / 3.2
        const toPx = (p) => ({
          x: origin.x + p.x * scale,
          y: origin.y - p.y * scale
        })

        // 清屏
        ctx.clearRect(0, 0, width, height)

        // 画骨架
        const waist = toPx(joints.waist)
        const head = toPx(joints.head)
        const ankle = toPx(joints.ankle)
        const wrist = toPx(joints.wrist)

        ctx.setLineWidth(3)
        ctx.setStrokeStyle('#222')

        // 躯干
        ctx.beginPath()
        ctx.moveTo(waist.x, waist.y)
        ctx.lineTo(head.x, head.y)
        ctx.stroke()

        // 腿
        ctx.beginPath()
        ctx.moveTo(waist.x, waist.y)
        ctx.lineTo(ankle.x, ankle.y)
        ctx.stroke()

        // 手（右侧）
        const shoulder = { x: waist.x + scale * 0.25, y: waist.y - scale * 0.8 }
        ctx.beginPath()
        ctx.moveTo(shoulder.x, shoulder.y)
        ctx.lineTo(wrist.x, wrist.y)
        ctx.stroke()

        // 头
        ctx.setFillStyle('#fff')
        ctx.setStrokeStyle('#222')
        ctx.beginPath()
        ctx.arc(head.x, head.y, 10, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()

        // 温度点（按温度上色）
        const tp = joints.tempPoints || {}
        const pWaist = toPx(tp.waist || joints.waist)
        const pThigh = toPx(tp.thigh || joints.waist)
        const pAnkle = toPx(tp.ankle || joints.ankle)

        const cWaist = tempToColor(s.temp1)
        const cThigh = tempToColor(s.temp2)
        const cAnkle = tempToColor(s.temp3)

        const drawDot = (p, color, label) => {
          ctx.setFillStyle(color)
          ctx.beginPath()
          ctx.arc(p.x, p.y, 9, 0, Math.PI * 2)
          ctx.fill()

          ctx.setFillStyle('#111')
          ctx.setFontSize(11)
          ctx.fillText(label, p.x + 12, p.y + 4)
        }

        drawDot(pWaist, cWaist, '腹')
        drawDot(pThigh, cThigh, '腿')
        drawDot(pAnkle, cAnkle, '踝')

        ctx.draw()
      }).exec()
    },

    renderTempLines() {
      const samples = (this.session && this.session.samples) ? this.session.samples : []
      if (samples.length < 2) {
        this.debugText = '采样点不足，无法绘制'
        return
      }

      const q = uni.createSelectorQuery().in(this)
      q.select('#chartBox').boundingClientRect(rect => {
        const width = Math.floor((rect && rect.width) ? rect.width : 320)
        const height = 300

        // 防止数据太多挤爆：最多显示最近 240 个点，支持左右拖动
        const maxKeep = 240
        const start = Math.max(0, Math.min(this.selectedIdx - Math.floor(maxKeep / 2), samples.length - maxKeep))
        const pickedRaw = samples.slice(start, start + maxKeep).filter(s => s.tempValid !== false && [s.temp1, s.temp2, s.temp3].every(Number.isFinite))
        if (pickedRaw.length < 2) { this.debugText = '当前时间段有效温度不足'; return }

        const categories = pickedRaw.map(s => this.fmtTime(s.ts))
        const s1 = pickedRaw.map(s => Number(s.temp1))
        const s2 = pickedRaw.map(s => Number(s.temp2))
        const s3 = pickedRaw.map(s => Number(s.temp3))

        const hasBad = [...s1, ...s2, ...s3].some(v => Number.isNaN(v))
        if (hasBad) {
          this.debugText = '发现非数字温度（NaN），请检查采样数据 temp1/temp2/temp3'
          return
        }

        // y 轴范围：按数据自动缩放，留一点边距
        const all = [...s1, ...s2, ...s3]
        const minV = Math.min(...all)
        const maxV = Math.max(...all)
        const pad = 0.6

        const sys = uni.getSystemInfoSync()
        const pixelRatio = sys.pixelRatio || 1
        const ctx = uni.createCanvasContext('tempLine', this)

        this.debugText = `绘制中：width=${width}px, points=${pickedRaw.length}`

        this.chart = new uCharts({
          type: 'line',
          context: ctx,
          canvasId: 'tempLine',
          width,
          height,
          pixelRatio,
          categories,
          series: [
            { name: '腹部(腰)', data: s1 },
            { name: '大腿', data: s2 },
            { name: '脚踝', data: s3 }
          ],

          background: '#FFFFFF',
          animation: true,

          // ✅ 关键：不显示每个点的数值（否则会挤成一团）
          dataLabel: false,
          // 保留点形状（更好看）
          dataPointShape: true,

          // ✅ 左右拖动
          enableScroll: true,
          scrollShow: true,
          scrollAlign: 'left',

          legend: { show: true, position: 'top' },

          xAxis: {
            disableGrid: true,
            rotateLabel: true,
            fontSize: 10,

            // 一屏显示点数：越小越不挤，但可拖动查看全部
            itemCount: 6,
            // 只显示少量刻度文字，避免重叠
            labelCount: 3
          },

          yAxis: {
            min: Number((minV - pad).toFixed(1)),
            max: Number((maxV + pad).toFixed(1)),
            title: '℃',
            gridType: 'dash',
            dashLength: 4,
            fontSize: 10
          },

          extra: {
            line: { type: 'curve', width: 2 }
          }
        })

        ctx.draw()
      }).exec()
    },

    fmt(ts) {
      if (!ts) return '-'
      return new Date(ts).toLocaleString()
    },
    fmtTime(ts) {
      if (!ts) return '-'
      return new Date(ts).toTimeString().slice(0, 8)
    }
  }
}
</script>

<style>
.page { padding:16px; background:#f6f7fb; min-height:100vh; }
.header { margin-bottom:12px; }
.title { font-size:18px; font-weight:700; color:#111; }
.sub { margin-left:6px; font-size:12px; color:#666; }

.card { background:#fff; border-radius:12px; padding:14px; margin-top:12px; box-shadow:0 2px 10px rgba(0,0,0,0.05); }
.cardTitle { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:10px; }
.h2 { font-size:15px; font-weight:700; color:#111; }
.hint { font-size:12px; color:#777; }

.row { display:flex; justify-content:space-between; margin-top:6px; }
.label { color:#666; font-size:13px; }
.value { color:#111; font-size:13px; }

.metrics { display:flex; gap:12px; margin-top:12px; }
.metric { flex:1; background:#f6f7fb; border-radius:10px; padding:10px 12px; }
.mNum { font-size:18px; font-weight:800; color:#111; }
.mText { margin-top:4px; font-size:12px; color:#666; }

.chartBox { width:100%; }
.chart { width:100%; height:300px; background:#fff; border-radius:10px; }

.legendTip { display:flex; align-items:center; gap:8px; margin-top:8px; color:#666; font-size:12px; }
.dot { width:10px; height:10px; border-radius:50%; display:inline-block; }
.blue { background:#2979ff; }
.green { background:#4caf50; }
.yellow { background:#ffb300; }
.lt { margin-right:8px; }

.sampleRow { padding:10px 0; border-top:1px solid #eee; }
.sampleTime { font-size:12px; color:#333; font-weight:700; }
.sampleText { display:block; margin-top:6px; font-size:13px; color:#333; }

.eventRow { display:flex; gap:10px; align-items:center; padding:10px 0; border-top:1px solid #eee; }
.eventIdx { width:22px; height:22px; border-radius:11px; background:#f6f7fb; color:#333; text-align:center; line-height:22px; font-weight:700; font-size:12px; }
.eventText { font-size:13px; color:#333; }

.muted { color:#888; font-size:13px; }
.debug { margin-top:10px; font-size:12px; color:#999; }
</style>
