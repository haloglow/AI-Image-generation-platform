const path = require('node:path')
const dotenv = require('dotenv')

function readEnv() {
  dotenv.config({
    path: path.join(__dirname, '..', '.env'),
    override: true,
    quiet: true,
  })
}

function normalizeBaseUrl(baseURL = '') {
  return String(baseURL).trim().replace(/\/+$/, '')
}

function sanitizeFileName(input = '') {
  return String(input)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function mimeToExtension(mimeType = 'image/png') {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    default:
      return 'png'
  }
}

function getSuggestedFileName(prompt = 'image', mimeType = 'image/png') {
  const safeName = sanitizeFileName(prompt).slice(0, 40) || 'generated-image'
  return `${safeName}.${mimeToExtension(mimeType)}`
}

function loadConfig() {
  readEnv()

  const baseURL = normalizeBaseUrl(process.env.OPENAI_BASE_URL || '')
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim()
  const imageModel = String(process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1024x1024').trim()
  const imageSize = String(process.env.OPENAI_IMAGE_SIZE || '1024x1024').trim()

  if (!baseURL) {
    throw new Error('未配置 OPENAI_BASE_URL，请先复制 .env.example 为 .env')
  }

  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY，请先在 .env 中填写密钥')
  }

  return {
    baseURL,
    apiKey,
    imageModel,
    imageSize,
  }
}

function getPublicConfig() {
  try {
    const config = loadConfig()
    return {
      ready: true,
      baseURL: config.baseURL,
      imageModel: config.imageModel,
      imageSize: config.imageSize,
      message: '配置已就绪',
    }
  } catch (error) {
    return {
      ready: false,
      baseURL: '',
      imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1024x1024',
      imageSize: process.env.OPENAI_IMAGE_SIZE || '1024x1024',
      message: error.message,
    }
  }
}

function buildPrompt(prompt, history = [], includeHistory = true) {
  const currentPrompt = String(prompt || '').trim()

  if (!currentPrompt) {
    throw new Error('请输入你想生成的画面描述')
  }

  if (!includeHistory || !Array.isArray(history)) {
    return currentPrompt
  }

  const recentUserPrompts = history
    .filter((item) => item && item.role === 'user' && item.text)
    .slice(-4)
    .map((item, index) => `历史要求 ${index + 1}：${String(item.text).trim()}`)

  if (!recentUserPrompts.length) {
    return currentPrompt
  }

  return [
    '你正在根据一段连续对话生成图片。',
    '请理解下面的历史创作上下文，并以最后的当前要求为主生成一张完整图像。',
    ...recentUserPrompts,
    `当前要求：${currentPrompt}`,
  ].join('\n')
}

function extractErrorMessage(payload, fallbackMessage) {
  if (!payload) {
    return fallbackMessage
  }

  const message =
    payload?.error?.message ||
    payload?.error?.type ||
    payload?.message ||
    payload?.msg ||
    fallbackMessage

  const code = payload?.error?.code || payload?.code

  if (code && code !== message) {
    return `${message} (${code})`
  }

  return message
}

function isGatewayTimeoutResult(result) {
  return (
    result.status === 502 ||
    result.status === 503 ||
    result.status === 504 ||
    /bad_response_status_code|gateway timeout|请求超时|timed out/i.test(result.message)
  )
}

function shouldTryAlternativeResponsesFormat(result) {
  if (result.ok || isGatewayTimeoutResult(result)) {
    return false
  }

  return /invalid|unsupported|unknown|format|schema|input|json/i.test(result.message)
}

async function requestJson(config, endpoint, body, options = {}) {
  const { retries = 0, timeoutMs = 0 } = options

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let timeoutId
    let controller

    try {
      if (timeoutMs > 0) {
        controller = new AbortController()
        timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      }

      const response = await fetch(`${config.baseURL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller?.signal,
      })

      const payload = await response.json().catch(() => null)

      return {
        ok: response.ok,
        status: response.status,
        requestId: response.headers.get('x-oneapi-request-id') || '',
        payload,
        message: extractErrorMessage(payload, `请求失败（HTTP ${response.status}）`),
      }
    } catch (error) {
      const isAbort = error?.name === 'AbortError'

      if (attempt < retries) {
        continue
      }

      return {
        ok: false,
        status: 0,
        requestId: '',
        payload: null,
        message: isAbort
          ? `请求超时（>${Math.round(timeoutMs / 1000)}秒）`
          : `请求接口失败：${error.message}`,
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

async function requestImagesGenerations(config, body) {
  return requestJson(config, '/images/generations', body, { timeoutMs: 30000 })
}

async function requestResponses(config, body) {
  return requestJson(config, '/responses', body, { timeoutMs: 100000 })
}

function createImageResult({ base64, url, mimeType = 'image/png', revisedPrompt = '', promptUsed }) {
  if (base64) {
    return {
      revisedPrompt,
      image: {
        sourceType: 'base64',
        mimeType,
        previewSrc: `data:${mimeType};base64,${base64}`,
        saveData: {
          type: 'base64',
          base64,
        },
        suggestedName: getSuggestedFileName(promptUsed, mimeType),
      },
    }
  }

  if (url) {
    return {
      revisedPrompt,
      image: {
        sourceType: 'url',
        mimeType,
        previewSrc: url,
        saveData: {
          type: 'url',
          url,
        },
        suggestedName: getSuggestedFileName(promptUsed, mimeType),
      },
    }
  }

  throw new Error('接口返回成功，但没有找到可用图片数据')
}

function readFirstOutputText(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : []

  for (const item of output) {
    const contentList = Array.isArray(item?.content) ? item.content : []

    for (const content of contentList) {
      if (content?.type === 'output_text' && content?.text) {
        return String(content.text).trim()
      }
    }
  }

  return ''
}

function resolveImagesApiResult(payload, promptUsed) {
  const item = payload?.data?.[0]

  if (!item) {
    return null
  }

  return createImageResult({
    base64: item.b64_json || item.base64,
    url: item.url,
    mimeType: item.mime_type || item.mimeType || 'image/png',
    revisedPrompt: item.revised_prompt || '',
    promptUsed,
  })
}

function resolveResponsesApiResult(payload, promptUsed) {
  const output = Array.isArray(payload?.output) ? payload.output : []
  const revisedPrompt = readFirstOutputText(payload)

  for (const item of output) {
    if (item?.type === 'image_generation_call') {
      return createImageResult({
        base64: item.result || item.b64_json || item.base64,
        url: item.url,
        mimeType: item.mime_type || item.mimeType || 'image/png',
        revisedPrompt,
        promptUsed,
      })
    }

    const contentList = Array.isArray(item?.content) ? item.content : []

    for (const content of contentList) {
      if (content?.type === 'output_image' || content?.type === 'image_generation_call') {
        return createImageResult({
          base64: content.result || content.b64_json || content.base64,
          url: content.url,
          mimeType: content.mime_type || content.mimeType || 'image/png',
          revisedPrompt,
          promptUsed,
        })
      }
    }
  }

  return null
}

function resolveImageResult(payload, promptUsed) {
  const imagesApiResult = resolveImagesApiResult(payload, promptUsed)

  if (imagesApiResult) {
    return imagesApiResult
  }

  const responsesApiResult = resolveResponsesApiResult(payload, promptUsed)

  if (responsesApiResult) {
    return responsesApiResult
  }

  throw new Error('暂未识别接口返回的图片格式，请检查服务端返回结构')
}

function formatRequestError(endpoint, result) {
  const extra = []

  if (result.status) {
    extra.push(`HTTP ${result.status}`)
  }

  if (result.requestId) {
    extra.push(`request id: ${result.requestId}`)
  }

  return `${endpoint}: ${result.message}${extra.length ? ` [${extra.join(', ')}]` : ''}`
}

async function tryResolveRequest(result, promptUsed, endpoint) {
  if (!result.ok) {
    return {
      ok: false,
      message: formatRequestError(endpoint, result),
    }
  }

  try {
    return {
      ok: true,
      normalized: resolveImageResult(result.payload, promptUsed),
    }
  } catch (error) {
    return {
      ok: false,
      message: `${endpoint}: ${error.message}`,
    }
  }
}

function shouldPreferResponses(config) {
  return /^gpt-image/i.test(config.imageModel)
}

function buildGatewayHint(failures) {
  if (failures.some((item) => /HTTP 504|请求超时/.test(item))) {
    return '上游生图网关超时，请稍后重试；建议先关闭连续对话模式，再用更短提示词重试。'
  }

  return ''
}

async function generateImage({ prompt, history = [], includeHistory = true } = {}) {
  const config = loadConfig()
  const promptUsed = buildPrompt(prompt, history, includeHistory)
  const failures = []

  const primaryResponsesBody = {
    model: config.imageModel,
    input: promptUsed,
  }

  const primaryResponsesResult = await requestResponses(config, primaryResponsesBody)
  let handledResult = await tryResolveRequest(primaryResponsesResult, promptUsed, '/responses')

  if (handledResult.ok) {
    return {
      model: config.imageModel,
      promptUsed,
      revisedPrompt: handledResult.normalized.revisedPrompt,
      image: handledResult.normalized.image,
      apiEndpoint: '/responses',
    }
  }

  failures.push(handledResult.message)

  if (shouldPreferResponses(config)) {
    if (shouldTryAlternativeResponsesFormat(primaryResponsesResult)) {
      const altResponsesBody = {
        model: config.imageModel,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: promptUsed,
              },
            ],
          },
        ],
      }

      const altResponsesResult = await requestResponses(config, altResponsesBody)
      handledResult = await tryResolveRequest(altResponsesResult, promptUsed, '/responses(input_text)')

      if (handledResult.ok) {
        return {
          model: config.imageModel,
          promptUsed,
          revisedPrompt: handledResult.normalized.revisedPrompt,
          image: handledResult.normalized.image,
          apiEndpoint: '/responses',
        }
      }

      failures.push(handledResult.message)
    }

    const hint = buildGatewayHint(failures)
    throw new Error(hint ? `${failures.join('；')}；${hint}` : failures.join('；'))
  }

  const imagesRequestBody = {
    model: config.imageModel,
    prompt: promptUsed,
    size: config.imageSize,
    response_format: 'b64_json',
  }

  let imagesResult = await requestImagesGenerations(config, imagesRequestBody)

  if (!imagesResult.ok && /response_format|unsupported|unknown|invalid/i.test(imagesResult.message)) {
    delete imagesRequestBody.response_format
    imagesResult = await requestImagesGenerations(config, imagesRequestBody)
  }

  handledResult = await tryResolveRequest(imagesResult, promptUsed, '/images/generations')

  if (handledResult.ok) {
    return {
      model: config.imageModel,
      promptUsed,
      revisedPrompt: handledResult.normalized.revisedPrompt,
      image: handledResult.normalized.image,
      apiEndpoint: '/images/generations',
    }
  }

  failures.push(handledResult.message)
  const hint = buildGatewayHint(failures)
  throw new Error(hint ? `${failures.join('；')}；${hint}` : failures.join('；'))
}

module.exports = {
  generateImage,
  getPublicConfig,
  getSuggestedFileName,
}
