const path = require("node:path");
const dotenv = require("dotenv");

function readEnv() {
  dotenv.config({
    path: path.join(__dirname, "..", ".env"),
    override: true,
    quiet: true,
  });
}

function normalizeBaseUrl(baseURL = "") {
  return String(baseURL).trim().replace(/\/+$/, "");
}

function sanitizeFileName(input = "") {
  return String(input)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mimeToExtension(mimeType = "image/png") {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "png";
  }
}

function getSuggestedFileName(prompt = "image", mimeType = "image/png") {
  const safeName = sanitizeFileName(prompt).slice(0, 40) || "generated-image";
  return `${safeName}.${mimeToExtension(mimeType)}`;
}

function getFirstEnv(names, fallback = "") {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();

    if (value) {
      return value;
    }
  }

  return fallback;
}

function getNumberEnv(names, fallback) {
  const envNames = Array.isArray(names) ? names : [names];

  for (const name of envNames) {
    const value = Number(process.env[name]);

    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return fallback;
}

function getDefaultBaseUrl() {
  return String.fromCharCode(
    104,
    116,
    116,
    112,
    115,
    58,
    47,
    47,
    100,
    117,
    111,
    109,
    105,
    97,
    112,
    105,
    46,
    99,
    111,
    109,
  );
}

function loadConfig() {
  readEnv();

  const baseURL = normalizeBaseUrl(
    getFirstEnv(["PLATFORM_BASE_URL"], getDefaultBaseUrl()),
  );
  const apiKey = getFirstEnv(["PLATFORM_API_KEY"]);
  const imageModel = getFirstEnv(["PLATFORM_IMAGE_MODEL"], "gpt-image-2");
  const imageSize = getFirstEnv(["PLATFORM_IMAGE_SIZE"], "16:9");
  const requestTimeoutMs = getNumberEnv(["PLATFORM_REQUEST_TIMEOUT_MS"], 30000);
  const taskTimeoutMs = getNumberEnv(["PLATFORM_TASK_TIMEOUT_MS"], 300000);
  const taskPollIntervalMs = getNumberEnv(
    ["PLATFORM_TASK_POLL_INTERVAL_MS"],
    3000,
  );

  if (!apiKey) {
    throw new Error("未配置 PLATFORM_API_KEY，请先在 .env 中填写平台接口密钥");
  }

  return {
    baseURL,
    apiKey,
    imageModel,
    imageSize,
    requestTimeoutMs,
    taskTimeoutMs,
    taskPollIntervalMs,
  };
}

function getPublicConfig() {
  try {
    const config = loadConfig();
    return {
      ready: true,
      baseURL: config.baseURL,
      imageModel: config.imageModel,
      imageSize: config.imageSize,
      message: "平台图像服务配置已就绪",
    };
  } catch (error) {
    return {
      ready: false,
      baseURL: normalizeBaseUrl(
        getFirstEnv(["PLATFORM_BASE_URL"], getDefaultBaseUrl()),
      ),
      imageModel: getFirstEnv(["PLATFORM_IMAGE_MODEL"], "gpt-image-2"),
      imageSize: getFirstEnv(["PLATFORM_IMAGE_SIZE"], "16:9"),
      message: error.message,
    };
  }
}

function buildPrompt(prompt, history = [], includeHistory = true) {
  const currentPrompt = String(prompt || "").trim();

  if (!currentPrompt) {
    throw new Error("请输入你想生成的画面描述");
  }

  if (!includeHistory || !Array.isArray(history)) {
    return currentPrompt;
  }

  const recentUserPrompts = history
    .filter((item) => item && item.role === "user" && item.text)
    .slice(-4)
    .map((item, index) => `历史要求 ${index + 1}：${String(item.text).trim()}`);

  if (!recentUserPrompts.length) {
    return currentPrompt;
  }

  return [
    "你正在根据一段连续对话生成图片。",
    "请理解下面的历史创作上下文，并以最后的当前要求为主生成一张完整图像。",
    ...recentUserPrompts,
    `当前要求：${currentPrompt}`,
  ].join("\n");
}

function extractErrorMessage(payload, fallbackMessage) {
  if (!payload) {
    return fallbackMessage;
  }

  if (typeof payload === "string") {
    return payload || fallbackMessage;
  }

  const message =
    payload?.error?.message ||
    payload?.error?.type ||
    payload?.message ||
    payload?.msg ||
    payload?.detail ||
    fallbackMessage;

  const code = payload?.error?.code || payload?.code;

  if (code && code !== message) {
    return `${message} (${code})`;
  }

  return message;
}

function compactPayload(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return text.length > 800 ? `${text.slice(0, 800)}...` : text;
}

function buildApiUrl(config, endpoint, query = {}) {
  const pathPrefix =
    /\/v1$/i.test(config.baseURL) && endpoint.startsWith("/v1/")
      ? endpoint.slice(3)
      : endpoint;
  const url = new URL(
    `${config.baseURL}${pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`}`,
  );

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

async function requestJson(url, options = {}) {
  const { method = "GET", headers = {}, body, timeoutMs = 30000 } = options;
  let timeoutId;
  let controller;

  try {
    if (timeoutMs > 0) {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    });

    const responseText = await response.text();
    let payload = null;

    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = responseText;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      requestId:
        response.headers.get("x-oneapi-request-id") ||
        response.headers.get("x-request-id") ||
        "",
      payload,
      message: extractErrorMessage(
        payload,
        `请求失败（HTTP ${response.status}）`,
      ),
    };
  } catch (error) {
    const isAbort = error?.name === "AbortError";

    return {
      ok: false,
      status: 0,
      requestId: "",
      payload: null,
      message: isAbort
        ? `请求超时（>${Math.round(timeoutMs / 1000)}秒）`
        : `请求接口失败：${error.message}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function formatRequestError(label, result) {
  const extra = [];

  if (result.status) {
    extra.push(`HTTP ${result.status}`);
  }

  if (result.requestId) {
    extra.push(`request id: ${result.requestId}`);
  }

  return `${label}失败：${result.message}${extra.length ? ` [${extra.join(", ")}]` : ""}`;
}

function readTaskId(payload) {
  return (
    payload?.id ||
    payload?.task_id ||
    payload?.taskId ||
    payload?.data?.id ||
    payload?.data?.task_id ||
    payload?.data?.taskId ||
    ""
  );
}

function normalizeImageSize(size = "") {
  const value = String(size || "").trim();
  const allowedSizes = new Set(["16:9", "9:16", "1:1", "4:3", "3:4"]);

  if (!value) {
    return "16:9";
  }

  if (!allowedSizes.has(value)) {
    throw new Error(
      `不支持的图片尺寸比例：${value}，请使用 ${Array.from(allowedSizes).join("、")}`,
    );
  }

  return value;
}

function normalizeReferenceImages(referenceImages = []) {
  if (!Array.isArray(referenceImages) || !referenceImages.length) {
    return [];
  }

  const urls = referenceImages.map((image) => {
    if (!image || typeof image !== "object") {
      return "";
    }

    return String(image.url || "").trim();
  });

  const invalidCount = urls.filter((url) => !/^https?:\/\//i.test(url)).length;

  if (invalidCount > 0) {
    throw new Error("当前图像参考请使用 http 或 https 图片 URL");
  }

  return urls;
}

async function createImageTask(
  config,
  promptUsed,
  referenceImages = [],
  options = {},
) {
  const imageList = normalizeReferenceImages(referenceImages);
  const requestBody = {
    model: String(options.imageModel || config.imageModel).trim(),
    prompt: promptUsed,
    size: normalizeImageSize(options.imageSize || config.imageSize),
  };

  if (imageList.length) {
    requestBody.image = imageList;
  }

  const result = await requestJson(
    buildApiUrl(config, "/v1/images/generations", { async: "true" }),
    {
      method: "POST",
      headers: {
        Authorization: config.apiKey,
        "Content-Type": "application/json",
      },
      body: requestBody,
      timeoutMs: config.requestTimeoutMs,
    },
  );

  if (!result.ok) {
    throw new Error(formatRequestError("创建图像生成任务", result));
  }

  const taskId = readTaskId(result.payload);

  if (!taskId) {
    throw new Error(
      `创建图像生成任务成功，但未返回任务 ID：${compactPayload(result.payload)}`,
    );
  }

  return {
    taskId,
    requestBody,
  };
}

function normalizeTaskState(payload) {
  return String(
    payload?.state ||
      payload?.status ||
      payload?.data?.state ||
      payload?.data?.status ||
      "",
  ).toLowerCase();
}

function readTaskProgress(payload) {
  return (
    payload?.progress ??
    payload?.data?.progress ??
    payload?.result?.progress ??
    0
  );
}

function isTaskSucceeded(payload) {
  const state = normalizeTaskState(payload);

  if (
    [
      "succeeded",
      "success",
      "completed",
      "complete",
      "done",
      "finished",
    ].includes(state)
  ) {
    return true;
  }

  return Boolean(readImageList(payload).length);
}

function isTaskFailed(payload) {
  const state = normalizeTaskState(payload);
  return [
    "failed",
    "failure",
    "error",
    "canceled",
    "cancelled",
    "timeout",
  ].includes(state);
}

function readImageList(payload) {
  const candidates = [
    payload?.data?.images,
    payload?.images,
    payload?.result?.images,
    payload?.data?.data?.images,
    payload?.output?.images,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  return [];
}

function guessMimeTypeFromName(name = "") {
  const lowerName = String(name).toLowerCase();

  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lowerName.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/png";
}

function readFileNameFromUrl(url = "") {
  try {
    const pathname = new URL(url).pathname;
    const rawName = decodeURIComponent(pathname.split("/").pop() || "");
    return sanitizeFileName(rawName);
  } catch {
    return "";
  }
}

function createImageResult({
  base64,
  url,
  mimeType = "image/png",
  revisedPrompt = "",
  promptUsed,
  suggestedName = "",
}) {
  if (base64) {
    return {
      revisedPrompt,
      image: {
        sourceType: "base64",
        mimeType,
        previewSrc: `data:${mimeType};base64,${base64}`,
        saveData: {
          type: "base64",
          base64,
        },
        suggestedName:
          suggestedName || getSuggestedFileName(promptUsed, mimeType),
      },
    };
  }

  if (url) {
    return {
      revisedPrompt,
      image: {
        sourceType: "url",
        mimeType,
        previewSrc: url,
        saveData: {
          type: "url",
          url,
        },
        suggestedName:
          suggestedName || getSuggestedFileName(promptUsed, mimeType),
      },
    };
  }

  throw new Error("接口返回成功，但没有找到可用图片数据");
}

function resolveTaskResult(payload, promptUsed) {
  const images = readImageList(payload);
  const firstImage = images[0];

  if (!firstImage) {
    throw new Error(`任务已完成，但没有返回图片：${compactPayload(payload)}`);
  }

  const url =
    typeof firstImage === "string"
      ? firstImage
      : firstImage.url || firstImage.image_url || firstImage.href || "";
  const base64 =
    typeof firstImage === "object"
      ? firstImage.b64_json || firstImage.base64 || ""
      : "";
  const fileName =
    typeof firstImage === "object"
      ? firstImage.file_name || firstImage.filename || ""
      : "";
  const suggestedName = sanitizeFileName(fileName) || readFileNameFromUrl(url);
  const mimeType =
    (typeof firstImage === "object" &&
      (firstImage.mime_type || firstImage.mimeType)) ||
    guessMimeTypeFromName(fileName || url);

  return createImageResult({
    base64,
    url,
    mimeType,
    revisedPrompt: payload?.data?.description || payload?.description || "",
    promptUsed,
    suggestedName,
  });
}

async function queryImageTask(config, taskId) {
  const result = await requestJson(
    buildApiUrl(config, `/v1/tasks/${encodeURIComponent(taskId)}`),
    {
      method: "GET",
      headers: {
        Authorization: config.apiKey,
      },
      timeoutMs: config.requestTimeoutMs,
    },
  );

  if (!result.ok) {
    throw new Error(formatRequestError("查询图像生成任务", result));
  }

  return result.payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForImageTask(config, taskId, promptUsed) {
  const startedAt = Date.now();
  let lastPayload = null;

  while (Date.now() - startedAt <= config.taskTimeoutMs) {
    const payload = await queryImageTask(config, taskId);
    lastPayload = payload;

    if (isTaskSucceeded(payload)) {
      return resolveTaskResult(payload, promptUsed);
    }

    if (isTaskFailed(payload)) {
      throw new Error(
        `图像生成任务失败：${extractErrorMessage(payload, compactPayload(payload))}`,
      );
    }

    await sleep(config.taskPollIntervalMs);
  }

  const progress = readTaskProgress(lastPayload);
  const progressText = progress ? `，最后进度 ${progress}%` : "";
  throw new Error(
    `图像生成任务超时（>${Math.round(config.taskTimeoutMs / 1000)}秒）${progressText}，请稍后重试`,
  );
}

async function generateImage({
  prompt,
  history = [],
  includeHistory = true,
  referenceImages = [],
  lastGeneratedImageUrl = "",
  imageModel = "",
  imageSize = "",
} = {}) {
  const config = loadConfig();
  const model = String(imageModel || config.imageModel).trim();
  const size = normalizeImageSize(imageSize || config.imageSize);
  const promptUsed = buildPrompt(prompt, history, includeHistory);

  // 连续对话模式：如果用户没有手动添加参考图，且有上一次生成的图片 URL，自动作为参考图传入
  let effectiveReferenceImages = referenceImages;
  if (
    includeHistory &&
    lastGeneratedImageUrl &&
    (!referenceImages || referenceImages.length === 0)
  ) {
    effectiveReferenceImages = [{ url: lastGeneratedImageUrl }];
  }

  const { taskId, requestBody } = await createImageTask(
    config,
    promptUsed,
    effectiveReferenceImages,
    { imageModel: model, imageSize: size },
  );
  const normalized = await waitForImageTask(config, taskId, promptUsed);

  return {
    model: requestBody.model,
    size: requestBody.size,
    promptUsed,
    requestBody,
    revisedPrompt: normalized.revisedPrompt,
    image: normalized.image,
    apiEndpoint: `/v1/images/generations?async=true · task ${taskId}`,
  };
}

module.exports = {
  generateImage,
  getPublicConfig,
  getSuggestedFileName,
};
