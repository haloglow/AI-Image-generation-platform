<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'

const STORAGE_KEY = 'ai-image-conversations'
const SIDEBAR_KEY = 'ai-image-sidebar-collapsed'
const DEFAULT_MODEL = 'gpt-image-2'
const DEFAULT_SIZE = '16:9'
const MODEL_OPTIONS = ['gpt-image-2']
const SIZE_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const PROGRESS_TARGET_SECONDS = 150

const messageContainer = ref(null)
const draftTextarea = ref(null)
const conversations = ref([])
const activeConversationId = ref('')
const previewImage = ref(null)
const sidebarCollapsed = ref(readSavedSidebarCollapsed())
const progressTick = ref(0)
let progressTimer = null
const config = ref({
  ready: false,
  baseURL: '',
  imageModel: DEFAULT_MODEL,
  imageSize: DEFAULT_SIZE,
  message: '正在读取配置...',
})
const defaultIncludeHistory = ref(readSavedIncludeHistory())

const bridgeAvailable = computed(() => typeof window !== 'undefined' && !!window.imageApp)
const activeConversation = computed(() => conversations.value.find((item) => item.id === activeConversationId.value) || null)
const messages = computed(() => activeConversation.value?.messages || [])
const activePendingCount = computed(() => activeConversation.value?.pendingCount || 0)

const draft = computed({
  get: () => activeConversation.value?.draft || '',
  set: (value) => {
    ensureConversation().draft = value
  },
})

const referenceUrl = computed({
  get: () => activeConversation.value?.referenceUrl || '',
  set: (value) => {
    ensureConversation().referenceUrl = value
  },
})

const referenceImages = computed({
  get: () => activeConversation.value?.referenceImages || [],
  set: (value) => {
    ensureConversation().referenceImages = value
  },
})

const referenceError = computed({
  get: () => activeConversation.value?.referenceError || '',
  set: (value) => {
    ensureConversation().referenceError = value
  },
})

const selectedModel = computed({
  get: () => activeConversation.value?.selectedModel || getDefaultModel(),
  set: (value) => {
    ensureConversation().selectedModel = value || getDefaultModel()
  },
})

const selectedSize = computed({
  get: () => activeConversation.value?.selectedSize || getDefaultSize(),
  set: (value) => {
    ensureConversation().selectedSize = value || getDefaultSize()
  },
})

const includeHistory = computed({
  get: () => activeConversation.value?.includeHistory ?? defaultIncludeHistory.value,
  set: (value) => {
    const normalized = Boolean(value)
    defaultIncludeHistory.value = normalized
    saveDefaultIncludeHistory(normalized)
    ensureConversation().includeHistory = normalized
  },
})

const composerPlaceholder = computed(() => {
  if (!bridgeAvailable.value) {
    return '请在 Electron 中打开此页面'
  }

  return '描述你想生成的画面... (Enter 发送，Shift+Enter 换行)'
})

watch(
  messages,
  async () => {
    await nextTick()
    scrollToBottom()
  },
  { deep: true },
)

function readSavedIncludeHistory() {
  if (typeof localStorage === 'undefined') {
    return false
  }

  return localStorage.getItem('includeHistory') === 'true'
}

function saveDefaultIncludeHistory(value) {
  if (typeof localStorage === 'undefined') {
    return
  }

  localStorage.setItem('includeHistory', String(value))
}

function readSavedSidebarCollapsed() {
  if (typeof localStorage === 'undefined') {
    return false
  }

  return localStorage.getItem(SIDEBAR_KEY) === 'true'
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed.value))
  }
}

function computePendingProgress(message) {
  if (!message || !message.pending || !message.pendingStartedAt) {
    return 0
  }

  void progressTick.value
  const elapsed = (Date.now() - message.pendingStartedAt) / 1000
  const ratio = Math.min(elapsed / PROGRESS_TARGET_SECONDS, 1)
  const eased = 1 - Math.pow(1 - ratio, 2)
  return Math.min(99, eased * 99)
}

function ensureProgressTimer() {
  if (progressTimer) return
  progressTimer = setInterval(() => {
    progressTick.value = (progressTick.value + 1) % 100000
    if (!conversations.value.some((c) => c.pendingCount > 0)) {
      clearInterval(progressTimer)
      progressTimer = null
    }
  }, 500)
}

function getDefaultModel() {
  return MODEL_OPTIONS.includes(config.value.imageModel) ? config.value.imageModel : DEFAULT_MODEL
}

function getDefaultSize() {
  return SIZE_OPTIONS.includes(config.value.imageSize) ? config.value.imageSize : DEFAULT_SIZE
}

function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatTime(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatConversationMeta(conversation) {
  const messageText = conversation.messages.length ? `${conversation.messages.length} 条消息` : '空对话'

  if (!conversation.pendingCount) {
    return messageText
  }

  return `${messageText} · 生成中 ${conversation.pendingCount} 个`
}

function saveConversations() {
  if (typeof localStorage === 'undefined') return
  try {
    const data = conversations.value.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      messages: c.messages,
      selectedModel: c.selectedModel,
      selectedSize: c.selectedSize,
      includeHistory: c.includeHistory,
    }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch { /* ignore quota errors */ }
}

function loadConversations() {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return data.map((c) => ({
      ...createConversation(),
      ...c,
      pendingCount: 0,
      draft: '',
      referenceUrl: '',
      referenceImages: [],
      referenceError: '',
    }))
  } catch {
    return []
  }
}

function openPreview(src) {
  previewImage.value = src
}

function closePreview() {
  previewImage.value = null
}

function createConversation() {
  return {
    id: createId(),
    title: '新对话',
    createdAt: Date.now(),
    messages: [],
    draft: '',
    referenceUrl: '',
    referenceImages: [],
    referenceError: '',
    selectedModel: getDefaultModel(),
    selectedSize: getDefaultSize(),
    includeHistory: defaultIncludeHistory.value,
    pendingCount: 0,
  }
}

function ensureConversation() {
  if (activeConversation.value) {
    return activeConversation.value
  }

  const conversation = createConversation()
  conversations.value.unshift(conversation)
  activeConversationId.value = conversation.id
  return conversation
}

function startNewConversation() {
  const conversation = createConversation()
  conversations.value.unshift(conversation)
  activeConversationId.value = conversation.id
  saveConversations()
}

function switchConversation(id) {
  activeConversationId.value = id
}

function deleteConversation(id) {
  const target = conversations.value.find((c) => c.id === id)
  if (!target || target.pendingCount > 0) return

  conversations.value = conversations.value.filter((c) => c.id !== id)

  if (activeConversationId.value === id) {
    if (conversations.value.length) {
      activeConversationId.value = conversations.value[0].id
    } else {
      startNewConversation()
    }
  }

  saveConversations()
}

function clearCurrentConversation() {
  if (!activeConversation.value || activeConversation.value.pendingCount > 0) {
    return
  }

  activeConversation.value.messages = []
  activeConversation.value.title = '新对话'
  saveConversations()
}

function updateConversationTitle(conversation, prompt) {
  if (!conversation || conversation.title !== '新对话') {
    return
  }

  const title = String(prompt || '').trim().replace(/\s+/g, ' ').slice(0, 24)
  conversation.title = title || '新对话'
}

function scrollToBottom() {
  if (!messageContainer.value) {
    return
  }

  messageContainer.value.scrollTop = messageContainer.value.scrollHeight
}

function createReferenceImage(input) {
  const url = String(input.url || '').trim()

  return {
    id: createId(),
    sourceType: 'url',
    name: input.name || url,
    url,
    previewSrc: url,
  }
}

function serializeReferenceImage(image) {
  const rawImage = toRaw(image)

  return {
    sourceType: 'url',
    name: rawImage.name,
    url: rawImage.url,
    previewSrc: rawImage.previewSrc,
  }
}

function cloneReferenceImages(images = referenceImages.value) {
  return images.map((image) => serializeReferenceImage(image))
}

function addUrlReferenceImage() {
  const url = referenceUrl.value.trim()

  if (!url) {
    return
  }

  try {
    const parsedUrl = new URL(url)

    if (!/^https?:$/.test(parsedUrl.protocol)) {
      throw new Error('请输入 http 或 https 图片链接')
    }

    referenceImages.value = [...referenceImages.value, createReferenceImage({ sourceType: 'url', url })]
    referenceUrl.value = ''
    referenceError.value = ''
  } catch (error) {
    referenceError.value = error.message || '图片链接格式不正确'
  }
}

function removeReferenceImage(id) {
  referenceImages.value = referenceImages.value.filter((image) => image.id !== id)
}

function clearReferenceImages() {
  referenceImages.value = []
  referenceError.value = ''
}

async function refreshConfig() {
  if (!bridgeAvailable.value) {
    config.value = {
      ready: false,
      baseURL: '',
      imageModel: DEFAULT_MODEL,
      imageSize: DEFAULT_SIZE,
      message: '当前不在 Electron 环境中',
    }
    return
  }

  try {
    config.value = await window.imageApp.getConfig()
  } catch (error) {
    config.value = {
      ready: false,
      baseURL: '',
      imageModel: DEFAULT_MODEL,
      imageSize: DEFAULT_SIZE,
      message: error.message || '读取配置失败',
    }
  }
}

function collectSuccessfulHistory(conversation) {
  const history = []
  const list = conversation?.messages || []

  for (let index = 0; index < list.length - 1; index += 1) {
    const current = list[index]
    const next = list[index + 1]

    if (current?.role === 'user' && current.text && next?.role === 'assistant' && next.image) {
      history.push({
        role: 'user',
        text: current.text,
      })
    }
  }

  return history
}

function getLastGeneratedImageUrl(conversation) {
  const list = conversation?.messages || []

  for (let index = list.length - 1; index >= 0; index -= 1) {
    const msg = list[index]

    if (msg?.role === 'assistant' && msg.image) {
      const image = msg.image
      // 只有 URL 类型的图片才能作为参考图传给 API
      if (image.sourceType === 'url' && image.previewSrc) {
        return image.previewSrc
      }
    }
  }

  return ''
}

async function sendPrompt() {
  const conversation = ensureConversation()
  const prompt = String(conversation.draft || '').trim()

  if (!prompt || !bridgeAvailable.value) {
    return
  }

  const references = cloneReferenceImages(conversation.referenceImages)
  const model = conversation.selectedModel || getDefaultModel()
  const size = conversation.selectedSize || getDefaultSize()
  const history = collectSuccessfulHistory(conversation)
  const shouldIncludeHistory = Boolean(conversation.includeHistory)
  const lastImageUrl = shouldIncludeHistory ? getLastGeneratedImageUrl(conversation) : ''

  const userMessage = {
    id: createId(),
    role: 'user',
    text: prompt,
    createdAt: Date.now(),
    referenceImages: references,
    model,
    size,
  }

  const assistantMessage = {
    id: createId(),
    role: 'assistant',
    text: '正在生成图片...',
    createdAt: Date.now(),
    pending: true,
    pendingStartedAt: Date.now(),
    image: null,
    revisedPrompt: '',
    saveError: '',
    savedPath: '',
    saving: false,
    apiEndpoint: '',
    model,
    size,
    promptUsed: '',
    requestBody: null,
  }

  conversation.messages.push(userMessage, assistantMessage)
  updateConversationTitle(conversation, prompt)
  conversation.draft = ''
  conversation.referenceImages = []
  conversation.referenceUrl = ''
  conversation.referenceError = ''
  conversation.pendingCount += 1
  ensureProgressTimer()

  try {
    const result = await window.imageApp.generateImage({
      prompt,
      history,
      includeHistory: shouldIncludeHistory,
      referenceImages: references,
      lastGeneratedImageUrl: lastImageUrl,
      imageModel: model,
      imageSize: size,
    })

    assistantMessage.pending = false
    assistantMessage.text = result.revisedPrompt
      ? '图片已生成，服务端对提示词做了细化。'
      : '图片已生成。'
    assistantMessage.revisedPrompt = result.revisedPrompt
    assistantMessage.image = result.image
    assistantMessage.model = result.model || model
    assistantMessage.size = result.size || result.requestBody?.size || size
    assistantMessage.apiEndpoint = result.apiEndpoint
    assistantMessage.promptUsed = result.promptUsed || ''
    assistantMessage.requestBody = result.requestBody || null
  } catch (error) {
    const message = error.message || '未知错误'

    assistantMessage.pending = false
    assistantMessage.text = /HTTP 504|请求超时|任务超时/.test(message) ? '生成超时' : '生成失败'
    assistantMessage.error = message
  } finally {
    conversation.pendingCount = Math.max(0, conversation.pendingCount - 1)
    saveConversations()
    await refreshConfig()
  }
}

async function saveImage(message) {
  if (!message?.image || !bridgeAvailable.value) {
    return
  }

  message.saveError = ''
  message.savedPath = ''
  message.saving = true

  try {
    const image = toRaw(message.image)
    const result = await window.imageApp.saveImage({
      image: {
        sourceType: image.sourceType,
        mimeType: image.mimeType,
        previewSrc: image.previewSrc,
        saveData: { ...toRaw(image.saveData) },
        suggestedName: image.suggestedName,
      },
      suggestedName: image.suggestedName,
    })

    if (!result.canceled) {
      message.savedPath = result.filePath
    }
  } catch (error) {
    message.saveError = error.message || '保存失败'
  } finally {
    message.saving = false
  }
}

function autoResize() {
  const el = draftTextarea.value
  if (!el) return
  el.style.height = 'auto'
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 21
  const maxHeight = lineHeight * 3 + 16 // 3 lines + padding
  el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px'
}

function handleKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendPrompt()
  }
}

onMounted(async () => {
  await refreshConfig()
  const saved = loadConversations()
  if (saved.length) {
    conversations.value = saved
    activeConversationId.value = saved[0].id
  } else {
    startNewConversation()
  }
})

onBeforeUnmount(() => {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
})
</script>

<template>
  <div class="layout" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="primary full" type="button" @click="startNewConversation">新增对话</button>
      </div>

      <div class="conversation-list">
        <div
          v-for="conversation in conversations"
          :key="conversation.id"
          :class="['conversation-item', conversation.id === activeConversationId ? 'active' : '']"
        >
          <button class="conversation-content" type="button" @click="switchConversation(conversation.id)">
            <span>{{ conversation.title }}</span>
            <small>{{ formatConversationMeta(conversation) }}</small>
          </button>
          <button
            class="delete-btn"
            type="button"
            title="删除对话"
            :disabled="conversation.pendingCount > 0"
            @click.stop="deleteConversation(conversation.id)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>

      <div class="sidebar-bottom">
        <button class="ghost full" :disabled="activePendingCount > 0 || !messages.length" @click="clearCurrentConversation">清空当前对话</button>
      </div>
    </aside>

    <main class="chat-panel">
      <header class="chat-header">
        <div class="chat-header-left">
          <button class="icon-btn sidebar-toggle" type="button" :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'" @click="toggleSidebar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div>
            <strong>{{ activeConversation?.title || '新对话' }}</strong>
            <span>{{ messages.length }} 条消息{{ activePendingCount ? ` · 生成中 ${activePendingCount} 个` : '' }}</span>
          </div>
        </div>
        <div class="chat-header-right">
          <label class="toggle header-toggle">
            <input v-model="includeHistory" type="checkbox" />
            <span>连续对话</span>
          </label>
          <button class="ghost small" type="button" @click="startNewConversation">新增对话</button>
        </div>
      </header>

      <div ref="messageContainer" class="messages">
        <div v-if="!messages.length" class="empty-state"></div>

        <article v-for="message in messages" :key="message.id" :class="['message', message.role]">
          <div v-if="message.role === 'assistant'" class="message-header">
            <strong>{{ message.model || selectedModel }}</strong>
            <span>{{ formatTime(message.createdAt) }}</span>
          </div>

          <p class="message-text">{{ message.text }}</p>
          <div v-if="message.referenceImages?.length" class="reference-preview message-references">
            <p class="tip">参考图 {{ message.referenceImages.length }} 张</p>
            <div class="reference-grid compact">
              <div v-for="image in message.referenceImages" :key="image.previewSrc" class="reference-item">
                <img :src="image.previewSrc" alt="参考图片" />
                <span>URL</span>
              </div>
            </div>
          </div>
          <p v-if="message.pending" class="status">请稍候，图片生成中...</p>
          <div v-if="message.pending" class="progress-bar" :title="`${computePendingProgress(message).toFixed(0)}%`">
            <div class="progress-fill" :style="{ width: computePendingProgress(message) + '%' }"></div>
            <span class="progress-text">{{ computePendingProgress(message).toFixed(0) }}%</span>
          </div>
          <p v-if="message.error" class="error">{{ message.error }}</p>

          <div v-if="message.image" class="image-card">
            <div class="image-wrapper">
              <img :src="message.image.previewSrc" alt="生成图片" />
              <div class="image-hover-actions">
                <button class="img-action-btn" :disabled="message.saving" @click="saveImage(message)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  {{ message.saving ? '保存中' : '保存' }}
                </button>
                <button class="img-action-btn" type="button" @click="openPreview(message.image.previewSrc)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                  预览
                </button>
              </div>
            </div>
            <p v-if="message.saveError" class="error">{{ message.saveError }}</p>
          </div>
        </article>
      </div>

      <form class="composer" @submit.prevent="sendPrompt">
        <div class="composer-toolbar">
          <label class="toolbar-item">
            <span>模型</span>
            <select v-model="selectedModel" :disabled="!bridgeAvailable">
              <option v-for="model in MODEL_OPTIONS" :key="model" :value="model">{{ model }}</option>
            </select>
          </label>
          <label class="toolbar-item">
            <span>尺寸</span>
            <select v-model="selectedSize" :disabled="!bridgeAvailable">
              <option v-for="size in SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
            </select>
          </label>
          <div class="toolbar-item ref-input">
            <span>参考图 URL</span>
            <input
              v-model="referenceUrl"
              :disabled="!bridgeAvailable"
              placeholder="粘贴图片 URL"
              type="url"
              @keydown.enter.prevent="addUrlReferenceImage"
            />
            <button class="ghost small" type="button" :disabled="!referenceUrl.trim() || !bridgeAvailable" @click="addUrlReferenceImage">
              添加
            </button>
            <button v-if="referenceImages.length" class="ghost small" type="button" @click="clearReferenceImages">
              清空
            </button>
          </div>
        </div>

        <p v-if="referenceError" class="error ref-error">{{ referenceError }}</p>

        <div v-if="referenceImages.length" class="reference-grid compact">
          <div v-for="image in referenceImages" :key="image.id" class="reference-item">
            <img :src="image.previewSrc" alt="参考图片" />
            <span>URL</span>
            <button class="remove-reference" type="button" @click="removeReferenceImage(image.id)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div class="composer-input-row">
          <textarea
            ref="draftTextarea"
            v-model="draft"
            :disabled="!bridgeAvailable"
            :placeholder="composerPlaceholder"
            rows="1"
            @keydown="handleKeydown"
            @input="autoResize"
          />
          <button class="primary send-btn" type="submit" :disabled="!draft.trim() || !bridgeAvailable || activePendingCount > 0">
            <span v-if="activePendingCount > 0" class="btn-loading">
              <span class="spinner"></span>生成中
            </span>
            <span v-else>{{ referenceImages.length ? `参考 ${referenceImages.length} 张图生成` : '发送并生图' }}</span>
          </button>
        </div>
      </form>
    </main>

    <div v-if="previewImage" class="preview-overlay" @click="closePreview">
      <img :src="previewImage" alt="预览图片" @click.stop />
      <button class="preview-close" type="button" @click="closePreview">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
  transition: grid-template-columns 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.layout.sidebar-collapsed {
  grid-template-columns: 0px minmax(0, 1fr);
}

.sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  border-right: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.86);
  transition: opacity 0.2s ease;
}

.layout.sidebar-collapsed .sidebar {
  opacity: 0;
  pointer-events: none;
  border-right-color: transparent;
}

.sidebar-top,
.sidebar-bottom {
  padding: 18px;
}

.sidebar-top {
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.sidebar-bottom {
  border-top: 1px solid rgba(148, 163, 184, 0.1);
}

.conversation-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.conversation-item {
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: 8px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 14px;
  color: #cbd5e1;
  background: rgba(30, 41, 59, 0.54);
  text-align: left;
}

.conversation-item.active {
  border-color: rgba(96, 165, 250, 0.72);
  background: rgba(37, 99, 235, 0.28);
}

.conversation-content {
  flex: 1;
  min-width: 0;
  padding: 12px;
  background: none;
  border: none;
  border-radius: 14px 0 0 14px;
  color: inherit;
  text-align: left;
}

.conversation-content span,
.conversation-content small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-content small {
  margin-top: 4px;
  color: #94a3b8;
}

.delete-btn {
  flex-shrink: 0;
  padding: 8px 10px;
  margin-right: 6px;
  border-radius: 8px;
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 16px;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.conversation-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover:enabled {
  color: #fca5a5;
  transform: none;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.chat-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(2, 6, 23, 0.56);
}

.chat-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.chat-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 10px;
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.16);
  color: #cbd5e1;
  transition: background 0.18s ease, transform 0.18s ease, color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.icon-btn:hover:enabled {
  background: rgba(59, 130, 246, 0.22);
  border-color: rgba(96, 165, 250, 0.6);
  color: #e0e7ff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.icon-btn:active:enabled {
  transform: translateY(0) scale(0.94);
  box-shadow: 0 1px 4px rgba(59, 130, 246, 0.25);
}

.sidebar-toggle svg {
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.layout.sidebar-collapsed .sidebar-toggle svg {
  transform: rotate(180deg);
}

.header-toggle {
  margin: 0;
  padding: 6px 10px;
  border-radius: 10px;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.16);
  font-size: 13px;
  color: #cbd5e1;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.header-toggle:hover {
  background: rgba(59, 130, 246, 0.18);
  border-color: rgba(96, 165, 250, 0.5);
}

.header-toggle input {
  cursor: pointer;
}

.chat-header strong,
.chat-header span {
  display: block;
}

.chat-header span {
  margin-top: 3px;
  color: #94a3b8;
  font-size: 13px;
}

.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 24px;
}

.empty-state {
  min-height: 160px;
}

.message {
  max-width: 860px;
  width: fit-content;
  margin-bottom: 10px;
  padding: 12px 16px;
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.74);
  border: 1px solid rgba(148, 163, 184, 0.12);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.15);
}

.message.user {
  margin-left: auto;
  background: linear-gradient(135deg, rgba(30, 64, 175, 0.9), rgba(59, 130, 246, 0.72));
}

.message.assistant {
  margin-right: auto;
  max-width: 520px;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
}

.message-header {
  margin-bottom: 4px;
  color: #cbd5e1;
  font-size: 12px;
}

.message-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.5;
}

.reference-preview {
  margin-top: 12px;
}

.message-references .tip {
  margin: 0 0 8px;
}

.reference-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.reference-grid.compact {
  grid-template-columns: repeat(auto-fill, minmax(86px, 1fr));
  max-width: 520px;
}

.reference-item {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 14px;
  background: rgba(2, 6, 23, 0.55);
}

.reference-item img {
  width: 100%;
  height: 92px;
  object-fit: cover;
}

.reference-grid.compact .reference-item img {
  height: 72px;
}

.reference-item > span {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.76);
  color: #bfdbfe;
  font-size: 12px;
}

.remove-reference {
  position: absolute;
  top: 4px;
  right: 4px;
  width: auto;
  padding: 4px;
  border-radius: 50%;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.7);
  font-size: 14px;
  line-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-card {
  margin-top: 10px;
}

.image-wrapper {
  position: relative;
  display: block;
}

.image-wrapper img {
  width: 100%;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  cursor: pointer;
  transition: opacity 0.15s;
  display: block;
}

.image-wrapper img:hover {
  opacity: 0.9;
}

.save-btn,
.img-action-btn {
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(148, 163, 184, 0.25);
  color: #e2e8f0;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
}

.img-action-btn:hover:enabled {
  background: rgba(37, 99, 235, 0.85);
  border-color: rgba(96, 165, 250, 0.7);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.45);
}

.img-action-btn:active:enabled {
  transform: translateY(0) scale(0.96);
}

.image-hover-actions {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 18px;
  opacity: 0;
  transition: opacity 0.2s;
}

.image-wrapper:hover .image-hover-actions {
  opacity: 1;
}

.composer {
  flex-shrink: 0;
  padding: 10px 16px 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(2, 6, 23, 0.9);
  backdrop-filter: blur(18px);
}

.composer-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.toolbar-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #94a3b8;
  font-size: 13px;
  white-space: nowrap;
}

.toolbar-item.ref-input {
  flex: 1;
  min-width: 0;
}

.toolbar-item.ref-input input {
  flex: 1;
  min-width: 120px;
}

.ref-error {
  margin: 0 0 8px;
  font-size: 13px;
}

.toolbar-item input,
select,
textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 12px;
  color: #e2e8f0;
  background: rgba(15, 23, 42, 0.86);
  outline: none;
  font-size: 14px;
  line-height: 1.5;
}

.toolbar-item input,
select {
  min-width: 0;
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 13px;
}

select {
  width: auto;
}

textarea {
  resize: none;
  overflow-y: auto;
  max-height: 72px;
}

.toolbar-item input:focus,
select:focus,
textarea:focus {
  border-color: rgba(96, 165, 250, 0.8);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}

.composer-input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.composer-input-row textarea {
  flex: 1;
  min-width: 0;
}

.send-btn {
  flex-shrink: 0;
  padding: 8px 14px;
  font-size: 13px;
  white-space: nowrap;
}

button {
  position: relative;
  overflow: hidden;
  border: none;
  border-radius: 14px;
  padding: 11px 16px;
  color: white;
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.16s ease, background 0.2s ease, box-shadow 0.24s ease, border-color 0.2s ease, color 0.2s ease;
}

button:hover:enabled {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.25);
}

button:active:enabled {
  transform: translateY(0) scale(0.97);
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.2);
  transition-duration: 0.08s;
}

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.primary,
.ghost {
  isolation: isolate;
}

.primary::before,
.ghost::before {
  content: '';
  position: absolute;
  top: 0;
  left: -130%;
  width: 60%;
  height: 100%;
  background: linear-gradient(120deg, transparent 0%, rgba(255, 255, 255, 0.28) 50%, transparent 100%);
  transform: skewX(-20deg);
  pointer-events: none;
  mix-blend-mode: overlay;
  animation: btn-shine 3.2s ease-in-out infinite;
}

.ghost::before {
  background: linear-gradient(120deg, transparent 0%, rgba(255, 255, 255, 0.18) 50%, transparent 100%);
  animation-duration: 4s;
}

.primary:hover:enabled::before,
.ghost:hover:enabled::before {
  animation-duration: 1.4s;
}

.primary:disabled::before,
.ghost:disabled::before {
  animation: none;
}

@keyframes btn-shine {
  0% { left: -130%; }
  60%, 100% { left: 140%; }
}

.primary {
  background: linear-gradient(135deg, #2563eb, #7c3aed);
  background-size: 200% 200%;
  background-position: 0% 50%;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.32);
  animation: primary-breathe 3.6s ease-in-out infinite;
}

.primary:disabled {
  animation: none;
  box-shadow: none;
}

.primary:hover:enabled {
  background-position: 100% 50%;
  box-shadow: 0 10px 26px rgba(124, 58, 237, 0.55);
  animation-duration: 1.8s;
  transform: translateY(-2px);
}

.primary:active:enabled {
  box-shadow: 0 4px 10px rgba(99, 102, 241, 0.4);
}

@keyframes primary-breathe {
  0%, 100% {
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.3);
  }
  50% {
    box-shadow: 0 6px 22px rgba(124, 58, 237, 0.5);
  }
}

.ghost {
  color: #e2e8f0;
  background: rgba(30, 41, 59, 0.88);
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
}

.ghost:hover:enabled {
  background: rgba(51, 65, 85, 0.95);
  border-color: rgba(148, 163, 184, 0.45);
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.4), 0 1px 0 rgba(255, 255, 255, 0.06) inset;
}

.small {
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
}

.full {
  width: 100%;
}

.tip {
  color: #94a3b8;
}

.status {
  margin-top: 10px;
  color: #93c5fd;
}

.ok {
  color: #86efac;
}

.error {
  color: #fca5a5;
}

.preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(6px);
}

.preview-overlay img {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.preview-close {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-close:hover:enabled {
  background: rgba(255, 255, 255, 0.2);
  transform: none;
}

.progress-bar {
  position: relative;
  margin-top: 10px;
  height: 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.18);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #2563eb, #7c3aed, #ec4899);
  background-size: 200% 100%;
  transition: width 0.5s linear;
  animation: progress-shimmer 2.4s linear infinite;
  box-shadow: 0 0 12px rgba(124, 58, 237, 0.45);
}

@keyframes progress-shimmer {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}

.progress-text {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  font-size: 10px;
  color: #e2e8f0;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
  letter-spacing: 0.3px;
}

.btn-loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.conversation-item {
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}

.conversation-item:hover {
  border-color: rgba(96, 165, 250, 0.4);
  background: rgba(30, 41, 59, 0.85);
}

.conversation-content {
  cursor: pointer;
  transition: color 0.18s ease;
}

.delete-btn {
  transition: opacity 0.18s ease, color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.delete-btn:hover:enabled {
  background: rgba(127, 29, 29, 0.4);
  transform: scale(1.08);
}

.image-wrapper img {
  transition: opacity 0.2s ease, transform 0.3s ease;
}

.image-wrapper:hover img {
  transform: scale(1.01);
}

.remove-reference {
  transition: background 0.18s ease, transform 0.18s ease;
}

.remove-reference:hover {
  background: rgba(127, 29, 29, 0.95);
  transform: scale(1.1);
}

@media (max-width: 1100px) {
  .layout {
    grid-template-columns: 240px minmax(0, 1fr);
  }

  .layout.sidebar-collapsed {
    grid-template-columns: 0px minmax(0, 1fr);
  }

  .chat-panel {
    min-height: 0;
  }

  .composer-toolbar {
    flex-wrap: wrap;
  }
}
</style>
