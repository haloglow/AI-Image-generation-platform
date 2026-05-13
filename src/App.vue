<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'

const messageContainer = ref(null)
const draft = ref('')
const isLoading = ref(false)
const messages = ref([])
const config = ref({
  ready: false,
  baseURL: '',
  imageModel: 'gpt-image-1024x1024',
  imageSize: '1024x1024',
  message: '正在读取配置...',
})

const includeHistory = ref(localStorage.getItem('includeHistory') === 'true')
const bridgeAvailable = computed(() => typeof window !== 'undefined' && !!window.imageApp)
const composerPlaceholder = computed(() => {
  if (!bridgeAvailable.value) {
    return '请在 Electron 中打开此页面'
  }

  return '描述你想生成的画面，例如：赛博朋克夜景中的白猫，电影感光影，超清细节'
})

watch(includeHistory, (value) => {
  localStorage.setItem('includeHistory', String(value))
})

watch(
  messages,
  async () => {
    await nextTick()
    scrollToBottom()
  },
  { deep: true },
)

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

function scrollToBottom() {
  if (!messageContainer.value) {
    return
  }

  messageContainer.value.scrollTop = messageContainer.value.scrollHeight
}

async function refreshConfig() {
  if (!bridgeAvailable.value) {
    config.value = {
      ready: false,
      baseURL: '',
      imageModel: 'gpt-image-1024x1024',
      imageSize: '1024x1024',
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
      imageModel: 'gpt-image-1024x1024',
      imageSize: '1024x1024',
      message: error.message || '读取配置失败',
    }
  }
}

function collectSuccessfulHistory() {
  const history = []

  for (let index = 0; index < messages.value.length - 1; index += 1) {
    const current = messages.value[index]
    const next = messages.value[index + 1]

    if (current?.role === 'user' && current.text && next?.role === 'assistant' && next.image) {
      history.push({
        role: 'user',
        text: current.text,
      })
    }
  }

  return history
}

async function sendPrompt() {
  const prompt = draft.value.trim()

  if (!prompt || isLoading.value || !bridgeAvailable.value) {
    return
  }

  const userMessage = {
    id: createId(),
    role: 'user',
    text: prompt,
    createdAt: Date.now(),
  }

  const assistantMessage = {
    id: createId(),
    role: 'assistant',
    text: '正在请求模型生成图片...',
    createdAt: Date.now(),
    pending: true,
    image: null,
    revisedPrompt: '',
    saveError: '',
    savedPath: '',
    saving: false,
    apiEndpoint: '',
  }

  const history = collectSuccessfulHistory()

  messages.value.push(userMessage, assistantMessage)
  draft.value = ''
  isLoading.value = true

  try {
    const result = await window.imageApp.generateImage({
      prompt,
      history,
      includeHistory: includeHistory.value,
    })

    assistantMessage.pending = false
    assistantMessage.text = result.revisedPrompt
      ? '图片已生成，服务端对提示词做了细化。'
      : '图片已生成。'
    assistantMessage.revisedPrompt = result.revisedPrompt
    assistantMessage.image = result.image
    assistantMessage.model = result.model
    assistantMessage.apiEndpoint = result.apiEndpoint
  } catch (error) {
    const message = error.message || '未知错误'

    assistantMessage.pending = false
    assistantMessage.text = /HTTP 504|请求超时/.test(message) ? '生成超时' : '生成失败'
    assistantMessage.error = message
  } finally {
    isLoading.value = false
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
    const result = await window.imageApp.saveImage({
      image: message.image,
      suggestedName: message.image.suggestedName,
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

function clearMessages() {
  messages.value = []
}

function handleKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendPrompt()
  }
}

onMounted(async () => {
  await refreshConfig()
})
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <span class="badge">Electron + Vue</span>
        <h1>对话生图</h1>
        <p>接入你自己的 OpenAI 兼容图片接口，在桌面端连续生成和保存图片。</p>
      </div>

      <section class="panel">
        <div class="panel-title-row">
          <h2>当前配置</h2>
          <button class="ghost small" @click="refreshConfig">重新读取</button>
        </div>
        <dl class="config-list">
          <div>
            <dt>状态</dt>
            <dd :class="config.ready ? 'ok' : 'warn'">{{ config.message }}</dd>
          </div>
          <div>
            <dt>接口</dt>
            <dd>{{ config.baseURL || '未读取到' }}</dd>
          </div>
          <div>
            <dt>模型</dt>
            <dd>{{ config.imageModel }}</dd>
          </div>
          <div>
            <dt>尺寸</dt>
            <dd>{{ config.imageSize }}</dd>
          </div>
        </dl>
      </section>

      <section class="panel">
        <label class="toggle">
          <input v-model="includeHistory" type="checkbox" />
          <span>连续对话模式</span>
        </label>
        <p class="tip">开启后会把最近几轮用户提示一起整理为本轮提示，适合迭代同一张图的风格和构图。</p>
        <button class="ghost" :disabled="isLoading || !messages.length" @click="clearMessages">清空会话</button>
      </section>
    </aside>

    <main class="chat-panel">
      <div ref="messageContainer" class="messages">
        <div v-if="!messages.length" class="empty-state">
          <h3>开始你的第一轮创作</h3>
          <p>先在项目根目录创建 <code>.env</code>，再输入提示词生成图片。</p>
        </div>

        <article v-for="message in messages" :key="message.id" :class="['message', message.role]">
          <div class="message-header">
            <strong>{{ message.role === 'user' ? '你' : '绘图助手' }}</strong>
            <span>{{ formatTime(message.createdAt) }}</span>
          </div>

          <p class="message-text">{{ message.text }}</p>
          <p v-if="message.pending" class="status">请稍候，图片生成中...</p>
          <p v-if="message.error" class="error">{{ message.error }}</p>

          <div v-if="message.image" class="image-card">
            <img :src="message.image.previewSrc" alt="生成图片" />
            <div class="image-actions">
              <span>{{ message.model }} · {{ message.apiEndpoint || '/images/generations' }}</span>
              <button class="primary small" :disabled="message.saving" @click="saveImage(message)">
                {{ message.saving ? '保存中...' : '保存图片' }}
              </button>
            </div>
            <p v-if="message.revisedPrompt" class="tip">修订提示词：{{ message.revisedPrompt }}</p>
            <p v-if="message.savedPath" class="ok">已保存到：{{ message.savedPath }}</p>
            <p v-if="message.saveError" class="error">{{ message.saveError }}</p>
          </div>
        </article>
      </div>

      <form class="composer" @submit.prevent="sendPrompt">
        <textarea
          v-model="draft"
          :disabled="!bridgeAvailable"
          :placeholder="composerPlaceholder"
          rows="4"
          @keydown="handleKeydown"
        />
        <div class="composer-actions">
          <span class="tip">Enter 发送，Shift + Enter 换行</span>
          <button class="primary" type="submit" :disabled="isLoading || !draft.trim() || !bridgeAvailable">
            {{ isLoading ? '生成中...' : '发送并生图' }}
          </button>
        </div>
      </form>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  min-height: 100vh;
}

.sidebar {
  padding: 24px;
  border-right: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.78);
  backdrop-filter: blur(16px);
}

.brand h1 {
  margin: 12px 0 8px;
  font-size: 30px;
}

.brand p {
  margin: 0;
  color: #94a3b8;
}

.badge {
  display: inline-flex;
  padding: 6px 10px;
  border-radius: 999px;
  color: #bfdbfe;
  background: rgba(37, 99, 235, 0.22);
  font-size: 12px;
}

.panel {
  margin-top: 20px;
  padding: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.68);
}

.panel-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel h2 {
  margin: 0 0 14px;
  font-size: 16px;
}

.config-list {
  margin: 0;
}

.config-list > div {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
}

.config-list > div:last-child {
  border-bottom: none;
}

.config-list dt {
  color: #94a3b8;
}

.config-list dd {
  margin: 0;
  word-break: break-all;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.chat-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 28px;
}

.empty-state {
  margin: 60px auto 0;
  max-width: 520px;
  padding: 28px;
  border: 1px dashed rgba(96, 165, 250, 0.35);
  border-radius: 20px;
  text-align: center;
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.48);
}

.empty-state h3 {
  margin-top: 0;
  margin-bottom: 8px;
}

.message {
  max-width: 860px;
  margin-bottom: 18px;
  padding: 18px;
  border-radius: 22px;
  background: rgba(15, 23, 42, 0.74);
  border: 1px solid rgba(148, 163, 184, 0.12);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.2);
}

.message.user {
  margin-left: auto;
  background: linear-gradient(135deg, rgba(30, 64, 175, 0.9), rgba(59, 130, 246, 0.72));
}

.message.assistant {
  margin-right: auto;
}

.message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: #cbd5e1;
  font-size: 13px;
}

.message-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.image-card {
  margin-top: 14px;
}

.image-card img {
  width: min(100%, 640px);
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.image-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}

.composer {
  padding: 20px 28px 28px;
  border-top: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(2, 6, 23, 0.85);
  backdrop-filter: blur(18px);
}

textarea {
  width: 100%;
  resize: vertical;
  padding: 16px 18px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 18px;
  color: #e2e8f0;
  background: rgba(15, 23, 42, 0.86);
  outline: none;
}

textarea:focus {
  border-color: rgba(96, 165, 250, 0.8);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.16);
}

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
}

button {
  border: none;
  border-radius: 14px;
  padding: 11px 16px;
  color: white;
  transition: transform 0.16s ease, opacity 0.16s ease, background 0.16s ease;
}

button:hover:enabled {
  transform: translateY(-1px);
}

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.primary {
  background: linear-gradient(135deg, #2563eb, #7c3aed);
}

.ghost {
  color: #e2e8f0;
  background: rgba(30, 41, 59, 0.88);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.small {
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
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

.warn {
  color: #facc15;
}

.error {
  color: #fca5a5;
}

code {
  padding: 2px 6px;
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.9);
}

@media (max-width: 1100px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: none;
    border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  }
}
</style>
