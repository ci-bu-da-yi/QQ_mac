<script setup>
import {
  ChevronRight,
  Clock3,
  LogIn,
  LogOut,
  Palette,
  Play,
  Rows3,
  Settings2,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  Wifi,
  WifiOff,
  X,
} from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { EventsOff, EventsOn, Quit, WindowFullscreen } from '../wailsjs/runtime/runtime'
import * as api from './api.js'

const STORAGE_KEY = 'qq-danmaku:preferences:v1'
const MAX_QUEUE_SIZE = 200
const MAX_ACTIVE_BULLETS = 120

const defaults = {
  area: 'top',
  areaSpan: 42,
  fontSize: 22,
  speed: 210,
  background: '#111827',
  backgroundOpacity: 0.9,
  groupColor: '#67e8f9',
  contentColor: '#f8fafc',
  timeColor: '#cbd5e1',
}

const areaOptions = [
  { value: 'top', label: '上' },
  { value: 'center', label: '中' },
  { value: 'bottom', label: '下' },
]

const colorOptions = [
  { key: 'background', label: '底色' },
  { key: 'groupColor', label: '群名' },
  { key: 'contentColor', label: '内容' },
  { key: 'timeColor', label: '时间' },
]

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)))
}

function validColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return {
      area: areaOptions.some((option) => option.value === saved.area)
        ? saved.area
        : defaults.area,
      areaSpan: clamp(saved.areaSpan ?? defaults.areaSpan, 20, 90),
      fontSize: clamp(saved.fontSize ?? defaults.fontSize, 14, 42),
      speed: clamp(saved.speed ?? defaults.speed, 110, 420),
      background: validColor(saved.background, defaults.background),
      backgroundOpacity: clamp(
        saved.backgroundOpacity ?? defaults.backgroundOpacity,
        0.35,
        1,
      ),
      groupColor: validColor(saved.groupColor, defaults.groupColor),
      contentColor: validColor(saved.contentColor, defaults.contentColor),
      timeColor: validColor(saved.timeColor, defaults.timeColor),
    }
  } catch {
    return { ...defaults }
  }
}

function hexToRgba(hex, opacity) {
  const value = validColor(hex, defaults.background).slice(1)
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

function formatClock(value) {
  if (!value) {
    return new Date().toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const normalized = String(value).replace('T', ' ')
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(normalized)) {
    return normalized.slice(5, 19)
  }
  return normalized
}

function unwrapPayload(payload) {
  let current = payload
  while (Array.isArray(current) && current.length === 1) {
    current = current[0]
  }
  return current ?? {}
}

const preferences = reactive(loadPreferences())
const panelOpen = ref(true)
const backgroundMode = ref(false)
const wailsRuntimeAvailable = typeof window.runtime !== 'undefined'
const interactionReady = ref(!wailsRuntimeAvailable)
const authMode = ref('login')
const authBusy = ref(false)
const authError = ref('')
const authForm = reactive({ username: '', password: '' })
const currentUser = ref(null)
const monitorError = ref('')
const notice = ref('')
const bullets = ref([])
const viewport = reactive({
  width: Math.max(1, window.innerWidth),
  height: Math.max(1, window.innerHeight),
})

let nextBulletId = 1
let noticeTimer = null
let queueTimer = null
let overlayAreaFrame = 0
let overlayAreaObserver = null
const pendingMessages = []
const laneAvailableAt = []

const layout = computed(() => {
  const height = Math.max(1, viewport.height)
  const areaHeight = Math.max(1, height * preferences.areaSpan / 100)
  const bulletHeight = Math.ceil(preferences.fontSize * 1.55 + 18)
  const laneGap = Math.max(4, Math.round(preferences.fontSize * 0.24))
  const laneCount = Math.max(1, Math.floor(areaHeight / (bulletHeight + laneGap)))
  const laneStep = areaHeight / laneCount
  let areaTop = height * 0.03

  if (preferences.area === 'center') {
    areaTop = Math.max(0, (height - areaHeight) / 2)
  } else if (preferences.area === 'bottom') {
    areaTop = Math.max(0, height * 0.97 - areaHeight)
  }

  return {
    areaTop,
    areaHeight,
    bulletHeight,
    laneCount,
    laneStep,
  }
})

const overlayStyle = computed(() => ({
  '--bullet-background': hexToRgba(
    preferences.background,
    preferences.backgroundOpacity,
  ),
  '--bullet-group': preferences.groupColor,
  '--bullet-content': preferences.contentColor,
  '--bullet-time': preferences.timeColor,
  '--bullet-font-size': `${preferences.fontSize}px`,
  '--bullet-duration': `${bulletDuration({ groupName: '', content: '' })}s`,
}))

watch(
  preferences,
  (value) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    syncLanes()
  },
  { deep: true },
)

function pushNotice(message, timeout = 4200) {
  notice.value = String(message || '')
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, timeout)
}

function normalizeMessage(payload) {
  const value = unwrapPayload(payload)

  if (typeof value === 'string') {
    const fields = value.split('\t', 4)
    if (fields.length === 4) {
      return {
        groupName: fields[2].trim() || 'QQ 消息',
        content: fields[3].trim(),
        time: formatClock(fields[1]),
      }
    }
    return {
      groupName: 'QQ 消息',
      content: value.trim(),
      time: formatClock(),
    }
  }

  return {
    groupName: String(
      value.title ?? value.groupName ?? value.group_name ?? 'QQ 消息',
    ).trim(),
    content: String(value.body ?? value.content ?? value.message ?? '').trim(),
    time: formatClock(value.time ?? value.createdAt ?? ''),
  }
}

function handleQQMessage(payload) {
  const message = normalizeMessage(payload)
  if (!message.content && !message.groupName) {
    return
  }

  monitorError.value = ''
  pendingMessages.push(message)
  if (pendingMessages.length > MAX_QUEUE_SIZE) {
    pendingMessages.splice(0, pendingMessages.length - MAX_QUEUE_SIZE)
  }
  pumpQueue()
}

function handleMonitorError(payload) {
  const value = unwrapPayload(payload)
  monitorError.value = String(value || 'QQ 通知监听失败')
  pushNotice(monitorError.value, 6200)
}

function syncLanes() {
  viewport.width = Math.max(1, window.innerWidth)
  viewport.height = Math.max(1, window.innerHeight)

  while (laneAvailableAt.length < layout.value.laneCount) {
    laneAvailableAt.push(0)
  }
  if (laneAvailableAt.length > layout.value.laneCount) {
    laneAvailableAt.length = layout.value.laneCount
  }

  pumpQueue()
}

function findLane(now) {
  for (let index = 0; index < laneAvailableAt.length; index += 1) {
    if (laneAvailableAt[index] <= now) {
      return index
    }
  }
  return -1
}

function bulletDuration(message) {
  const estimatedWidth = Math.min(
    viewport.width * 0.92,
    180 + String(message.groupName).length * 18 + String(message.content).length * 17,
  )
  const distance = viewport.width + estimatedWidth
  return clamp(distance / preferences.speed, 6.5, 24)
}

function pumpQueue() {
  window.clearTimeout(queueTimer)
  queueTimer = null

  if (!currentUser.value) {
    pendingMessages.length = 0
    return
  }

  let now = performance.now()
  let lane = findLane(now)

  while (pendingMessages.length > 0 && lane >= 0) {
    const message = pendingMessages.shift()
    const duration = bulletDuration(message)
    const id = nextBulletId++

    bullets.value.push({
      id,
      ...message,
      top: layout.value.areaTop + lane * layout.value.laneStep,
      duration,
    })

    laneAvailableAt[lane] = now + duration * 1000 + 320
    lane = findLane(now)

    if (bullets.value.length > MAX_ACTIVE_BULLETS) {
      bullets.value.splice(0, bullets.value.length - MAX_ACTIVE_BULLETS)
    }
  }

  if (pendingMessages.length > 0 && laneAvailableAt.length > 0) {
    const nextAvailable = Math.min(...laneAvailableAt)
    queueTimer = window.setTimeout(
      pumpQueue,
      Math.max(80, Math.ceil(nextAvailable - performance.now())),
    )
  }
}

function removeBullet(id) {
  bullets.value = bullets.value.filter((bullet) => bullet.id !== id)
}

function clearBullets() {
  pendingMessages.length = 0
  bullets.value = []
  laneAvailableAt.fill(0)
  window.clearTimeout(queueTimer)
  queueTimer = null
}

function playPreview() {
  handleQQMessage({
    title: '测试群聊',
    body: '这是一条桌面弹幕效果预览',
    time: formatClock(),
  })
}

function switchAuthMode(mode) {
  authMode.value = mode
  authError.value = ''
  authForm.password = ''
}

async function submitAuth() {
  const username = authForm.username.trim()
  if (!username || !authForm.password) {
    authError.value = '请输入用户名和密码'
    return
  }

  authBusy.value = true
  authError.value = ''

  try {
    const action = authMode.value === 'login' ? api.login : api.register
    const result = await action(username, authForm.password)
    if (!result.success || !result.user) {
      authError.value = result.message
      return
    }

    currentUser.value = result.user
    authForm.password = ''
    monitorError.value = ''
    pushNotice(result.message)
    syncLanes()
  } catch (error) {
    authError.value = error?.message || '账号操作失败'
  } finally {
    authBusy.value = false
  }
}

async function logoutUser() {
  authBusy.value = true
  authError.value = ''

  try {
    const result = await api.logout()
    if (!result.success) {
      authError.value = result.message
      return
    }

    currentUser.value = null
    authMode.value = 'login'
    clearBullets()
    monitorError.value = ''
    pushNotice(result.message)
  } catch (error) {
    authError.value = error?.message || '退出登录失败'
  } finally {
    authBusy.value = false
  }
}

function resetPreferences() {
  Object.assign(preferences, defaults)
  pushNotice('已恢复默认样式')
}

function exitApp() {
  try {
    Quit()
  } catch {
    pushNotice('当前环境无法退出应用')
  }
}

function handleWindowFocus() {
  interactionReady.value = true
  if (!backgroundMode.value) {
    panelOpen.value = true
  }
  scheduleOverlayInteractiveArea()
}

function handleWindowBlur() {
  interactionReady.value = false
}

function handleViewportChange() {
  syncLanes()
  scheduleOverlayInteractiveArea()
}

function scheduleOverlayInteractiveArea() {
  window.cancelAnimationFrame(overlayAreaFrame)
  overlayAreaFrame = window.requestAnimationFrame(syncOverlayInteractiveArea)
}

async function syncOverlayInteractiveArea() {
  const target = document.querySelector(
    panelOpen.value ? '.settings-panel' : '.panel-trigger',
  )
  if (!target) {
    await api.setOverlayInteractiveArea(0, 0, 0, 0, false)
    return
  }

  const rect = target.getBoundingClientRect()
  const scale = window.devicePixelRatio || 1
  await api.setOverlayInteractiveArea(
    Math.round(rect.left * scale),
    Math.round(rect.top * scale),
    Math.round(rect.width * scale),
    Math.round(rect.height * scale),
    true,
  )
}

async function syncOverlayWindowMode() {
  await api.setOverlayBackgroundMode(backgroundMode.value)
}

watch(panelOpen, () => {
  scheduleOverlayInteractiveArea()
  syncOverlayWindowMode()
})

function hideToBackground() {
  backgroundMode.value = true
  panelOpen.value = false
}

function openSettings() {
  backgroundMode.value = false
  panelOpen.value = true
  scheduleOverlayInteractiveArea()
}

onMounted(() => {
  if (wailsRuntimeAvailable) {
    WindowFullscreen()
  }
  interactionReady.value = !wailsRuntimeAvailable || document.hasFocus()
  syncLanes()
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('focus', handleWindowFocus)
  window.addEventListener('blur', handleWindowBlur)
  overlayAreaObserver = new ResizeObserver(scheduleOverlayInteractiveArea)
  overlayAreaObserver.observe(document.querySelector('.control-dock'))
  scheduleOverlayInteractiveArea()
  syncOverlayWindowMode()
  if (wailsRuntimeAvailable) {
    EventsOn('qq:new-message', handleQQMessage)
    EventsOn('qq:monitor-error', handleMonitorError)
  }
})

onBeforeUnmount(() => {
  window.clearTimeout(queueTimer)
  window.clearTimeout(noticeTimer)
  window.cancelAnimationFrame(overlayAreaFrame)
  overlayAreaObserver?.disconnect()
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('focus', handleWindowFocus)
  window.removeEventListener('blur', handleWindowBlur)
  api.setOverlayBackgroundMode(false).catch(() => {})
  api.setOverlayInteractiveArea(0, 0, 0, 0, false).catch(() => {})
  if (wailsRuntimeAvailable) {
    EventsOff('qq:new-message')
    EventsOff('qq:monitor-error')
  }
})
</script>

<template>
  <main class="overlay" :style="overlayStyle">
    <section class="danmaku-layer" aria-live="polite">
      <article
        v-for="bullet in bullets"
        :key="bullet.id"
        class="danmaku"
        :style="{
          '--bullet-top': `${bullet.top}px`,
          '--bullet-duration': `${bullet.duration}s`,
        }"
        @animationend="removeBullet(bullet.id)"
      >
        <strong class="danmaku-group">{{ bullet.groupName }}</strong>
        <time class="danmaku-time">
          <Clock3 :size="14" aria-hidden="true" />
          {{ bullet.time }}
        </time>
        <span class="danmaku-content">{{ bullet.content }}</span>
      </article>
    </section>

    <aside class="control-dock" :class="{ interactive: interactionReady }">
      <button
        v-if="!panelOpen"
        class="panel-trigger"
        type="button"
        title="打开设置"
        aria-label="打开设置"
        @click="openSettings"
      >
        <Settings2 :size="19" />
        <span class="status-dot" :class="{ offline: !currentUser }"></span>
      </button>

      <section v-else class="settings-panel">
        <header class="panel-header">
          <div class="brand">
            <span class="brand-mark">Q</span>
            <div>
              <strong>QQ 桌面弹幕</strong>
              <span class="monitor-status" :class="{ offline: !currentUser }">
                <Wifi v-if="currentUser" :size="13" />
                <WifiOff v-else :size="13" />
                {{ currentUser ? '监听中' : '未登录' }}
              </span>
            </div>
          </div>

          <button
            class="icon-button"
            type="button"
            title="隐藏到后台运行"
            aria-label="隐藏到后台运行"
            @click="hideToBackground"
          >
            <ChevronRight :size="18" />
          </button>
        </header>

        <template v-if="!currentUser">
          <div class="auth-tabs" role="tablist" aria-label="账号操作">
            <button
              type="button"
              role="tab"
              :aria-selected="authMode === 'login'"
              :class="{ active: authMode === 'login' }"
              @click="switchAuthMode('login')"
            >
              <LogIn :size="15" />
              登录
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="authMode === 'register'"
              :class="{ active: authMode === 'register' }"
              @click="switchAuthMode('register')"
            >
              <UserPlus :size="15" />
              注册
            </button>
          </div>

          <form class="auth-form" @submit.prevent="submitAuth">
            <label class="field">
              <span>用户名</span>
              <input
                v-model.trim="authForm.username"
                type="text"
                autocomplete="username"
                maxlength="32"
              />
            </label>

            <label class="field">
              <span>密码</span>
              <input
                v-model="authForm.password"
                type="password"
                :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'"
                minlength="8"
                maxlength="20"
              />
            </label>

            <p v-if="authMode === 'register'" class="field-hint">
              8~20 位，需包含大小写字母、数字和特殊符号
            </p>
            <p v-if="authError" class="field-error">{{ authError }}</p>

            <button class="primary-button" type="submit" :disabled="authBusy">
              <LogIn v-if="authMode === 'login'" :size="17" />
              <UserPlus v-else :size="17" />
              {{ authBusy ? '处理中' : authMode === 'login' ? '登录并开始监听' : '注册并开始监听' }}
            </button>
          </form>
        </template>

        <template v-else>
          <div class="account-row">
            <div>
              <strong>{{ currentUser.name }}</strong>
              <span>ID {{ currentUser.id }}</span>
            </div>
            <button
              class="small-button"
              type="button"
              :disabled="authBusy"
              @click="logoutUser"
            >
              <LogOut :size="14" />
              退出
            </button>
          </div>

          <section class="setting-section">
            <div class="section-title">
              <Rows3 :size="16" />
              <span>弹幕区域</span>
            </div>

            <div class="segmented-control" role="group" aria-label="弹幕区域">
              <button
                v-for="option in areaOptions"
                :key="option.value"
                type="button"
                :class="{ active: preferences.area === option.value }"
                @click="preferences.area = option.value"
              >
                {{ option.label }}
              </button>
            </div>

            <label class="slider-row">
              <span>区域范围</span>
              <output>{{ Math.round(preferences.areaSpan) }}%</output>
              <input
                v-model.number="preferences.areaSpan"
                type="range"
                min="20"
                max="90"
                step="1"
              />
            </label>
          </section>

          <section class="setting-section">
            <div class="section-title">
              <SlidersHorizontal :size="16" />
              <span>弹幕样式</span>
            </div>

            <label class="slider-row">
              <span>字号</span>
              <output>{{ Math.round(preferences.fontSize) }} px</output>
              <input
                v-model.number="preferences.fontSize"
                type="range"
                min="14"
                max="42"
                step="1"
              />
            </label>

            <label class="slider-row">
              <span>速度</span>
              <output>{{ Math.round(preferences.speed) }} px/s</output>
              <input
                v-model.number="preferences.speed"
                type="range"
                min="110"
                max="420"
                step="10"
              />
            </label>

            <label class="slider-row">
              <span>底色透明度</span>
              <output>{{ Math.round(preferences.backgroundOpacity * 100) }}%</output>
              <input
                v-model.number="preferences.backgroundOpacity"
                type="range"
                min="0.35"
                max="1"
                step="0.05"
              />
            </label>
          </section>

          <section class="setting-section">
            <div class="section-title">
              <Palette :size="16" />
              <span>颜色</span>
            </div>

            <div class="color-grid">
              <label v-for="option in colorOptions" :key="option.key" class="color-row">
                <span>{{ option.label }}</span>
                <span class="color-value">
                  <code>{{ preferences[option.key] }}</code>
                  <input v-model="preferences[option.key]" type="color" />
                </span>
              </label>
            </div>
          </section>

          <section class="preview-strip">
            <strong>群名称</strong>
            <time>09-15 20:30:00</time>
            <span>消息内容预览</span>
          </section>

          <footer class="panel-actions">
            <button class="small-button" type="button" @click="playPreview">
              <Play :size="14" />
              试放
            </button>
            <button class="small-button" type="button" @click="clearBullets">
              <Trash2 :size="14" />
              清屏
            </button>
            <button class="small-button" type="button" @click="resetPreferences">
              重置
            </button>
            <button class="small-button danger" type="button" @click="exitApp">
              <X :size="14" />
              退出
            </button>
          </footer>
        </template>
      </section>
    </aside>

    <div v-if="notice || monitorError" class="notice" role="status">
      {{ monitorError || notice }}
    </div>
  </main>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background: transparent;
  color: #f8fafc;
}

.danmaku-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.danmaku {
  position: absolute;
  top: var(--bullet-top);
  left: 100%;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-height: calc(var(--bullet-font-size) * 1.55);
  max-width: min(92vw, 1600px);
  padding: 8px 14px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.17);
  border-radius: 8px;
  background: var(--bullet-background);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3);
  font-size: var(--bullet-font-size);
  line-height: 1.35;
  white-space: nowrap;
  backface-visibility: hidden;
  contain: layout paint;
  animation: danmaku-move var(--bullet-duration) linear both;
  will-change: transform;
}

.danmaku-group {
  flex: 0 0 auto;
  max-width: 18vw;
  overflow: hidden;
  color: var(--bullet-group);
  font-weight: 750;
  text-overflow: ellipsis;
}

.danmaku-time {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding-left: 11px;
  border-left: 1px solid rgba(148, 163, 184, 0.34);
  color: var(--bullet-time);
  font-size: 0.7em;
  font-variant-numeric: tabular-nums;
}

.danmaku-content {
  min-width: 0;
  overflow: hidden;
  color: var(--bullet-content);
  text-overflow: ellipsis;
}

@keyframes danmaku-move {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(calc(-100vw - 100%), 0, 0);
  }
}

.control-dock {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 20;
  pointer-events: none;
  opacity: 0.72;
  transform: translateX(8px);
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.control-dock.interactive {
  pointer-events: auto;
  opacity: 1;
  transform: translateX(0);
}

.panel-trigger,
.settings-panel {
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 8px;
  background: rgba(10, 16, 27, 0.96);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.44);
  backdrop-filter: blur(16px);
}

.panel-trigger {
  position: relative;
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-color: rgba(103, 232, 249, 0.32);
  color: #e2e8f0;
}

.status-dot {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 8px;
  height: 8px;
  border: 2px solid #0a101b;
  border-radius: 50%;
  background: #22c55e;
}

.status-dot.offline {
  background: #64748b;
}

.settings-panel {
  width: min(372px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 15px;
}

.panel-header,
.brand,
.monitor-status,
.account-row,
.section-title,
.slider-row,
.color-row,
.color-value,
.panel-actions,
.small-button,
.primary-button,
.auth-tabs button {
  display: flex;
  align-items: center;
}

.panel-header {
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 13px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
}

.brand {
  gap: 10px;
}

.brand-mark {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(103, 232, 249, 0.34);
  border-radius: 8px;
  background: linear-gradient(145deg, #123848, #102033);
  color: #a5f3fc;
  font-size: 15px;
  font-weight: 800;
}

.brand > div {
  display: grid;
  gap: 3px;
}

.brand strong {
  color: #f8fafc;
  font-size: 15px;
  line-height: 1.15;
}

.monitor-status {
  gap: 5px;
  color: #4ade80;
  font-size: 11px;
}

.monitor-status.offline {
  color: #94a3b8;
}

.icon-button {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 6px;
  background: #111b2a;
  color: #cbd5e1;
}

.auth-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-top: 14px;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  background: #0b1320;
}

.auth-tabs button {
  height: 34px;
  justify-content: center;
  gap: 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  font-size: 13px;
}

.auth-tabs button.active {
  background: #163346;
  color: #a5f3fc;
  font-weight: 700;
}

.auth-form {
  display: grid;
  gap: 13px;
  margin-top: 14px;
}

.field {
  display: grid;
  gap: 7px;
}

.field > span {
  color: #94a3b8;
  font-size: 12px;
}

.field input {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #334155;
  border-radius: 6px;
  outline: none;
  background: #0b1320;
  color: #f8fafc;
}

.field input:focus {
  border-color: #38bdf8;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
}

.field-hint,
.field-error {
  margin: -2px 0 0;
  font-size: 11px;
  line-height: 1.5;
}

.field-hint {
  color: #94a3b8;
}

.field-error {
  color: #fca5a5;
}

.primary-button {
  height: 40px;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  background: #22d3ee;
  color: #07131d;
  font-size: 13px;
  font-weight: 800;
}

.primary-button:disabled,
.small-button:disabled {
  opacity: 0.58;
}

.account-row {
  justify-content: space-between;
  gap: 12px;
  padding: 13px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
}

.account-row > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.account-row strong {
  overflow: hidden;
  color: #f8fafc;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-row span {
  color: #64748b;
  font-size: 11px;
}

.small-button {
  height: 32px;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #111b2a;
  color: #cbd5e1;
  font-size: 12px;
  white-space: nowrap;
}

.small-button.danger {
  border-color: rgba(248, 113, 113, 0.32);
  color: #fca5a5;
}

.setting-section {
  display: grid;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
}

.section-title {
  gap: 7px;
  color: #e2e8f0;
  font-size: 13px;
  font-weight: 700;
}

.section-title svg {
  color: #67e8f9;
}

.segmented-control {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 3px;
  border: 1px solid #263448;
  border-radius: 8px;
  background: #0b1320;
}

.segmented-control button {
  height: 30px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  font-size: 13px;
}

.segmented-control button.active {
  background: #163346;
  color: #a5f3fc;
  font-weight: 800;
}

.slider-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 5px 12px;
  color: #cbd5e1;
  font-size: 12px;
}

.slider-row output {
  color: #67e8f9;
  font-variant-numeric: tabular-nums;
}

.slider-row input {
  width: 100%;
  grid-column: 1 / -1;
  margin: 0;
  accent-color: #22d3ee;
}

.color-grid {
  display: grid;
  gap: 4px;
}

.color-row {
  min-height: 42px;
  justify-content: space-between;
  gap: 12px;
  color: #cbd5e1;
  font-size: 12px;
}

.color-value {
  gap: 9px;
}

.color-value code {
  color: #94a3b8;
  font-family: "Cascadia Mono", Consolas, monospace;
  font-size: 10px;
  text-transform: uppercase;
}

input[type='color'] {
  width: 42px;
  height: 28px;
  padding: 2px;
  border: 1px solid #475569;
  border-radius: 6px;
  background: #0b1320;
  cursor: pointer;
}

.preview-strip {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 14px;
  padding: 9px 11px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: var(--bullet-background);
  white-space: nowrap;
}

.preview-strip strong {
  flex: 0 0 auto;
  color: var(--bullet-group);
  font-size: 12px;
}

.preview-strip time {
  flex: 0 0 auto;
  color: var(--bullet-time);
  font-size: 9px;
}

.preview-strip span {
  min-width: 0;
  overflow: hidden;
  color: var(--bullet-content);
  font-size: 11px;
  text-overflow: ellipsis;
}

.panel-actions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 7px;
  margin-top: 14px;
}

.panel-actions .small-button {
  min-width: 0;
  padding: 0 7px;
}

.notice {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 30;
  max-width: min(460px, calc(100vw - 36px));
  padding: 10px 13px;
  border: 1px solid rgba(248, 113, 113, 0.42);
  border-radius: 8px;
  background: rgba(69, 10, 10, 0.95);
  color: #fecaca;
  font-size: 12px;
  box-shadow: 0 14px 42px rgba(0, 0, 0, 0.36);
}

button:hover:not(:disabled) {
  filter: brightness(1.12);
}

button:focus-visible,
input:focus-visible {
  outline: 2px solid #38bdf8;
  outline-offset: 2px;
}

@media (max-width: 560px) {
  .control-dock {
    top: 10px;
    right: 10px;
  }

  .settings-panel {
    width: calc(100vw - 20px);
    max-height: calc(100vh - 20px);
  }
}
</style>
