// worker.js - 部署在 Cloudflare Workers

// Minimax TTS API 的实际端点
// 请根据 Minimax AI 文档检查这个 URL 是否正确，特别是版本号
const MINIMAX_TTS_ENDPOINT = "https://api.minimax.chat/v1/text_to_speech"; 

// 处理所有请求的函数
// `env` 参数会自动由 Cloudflare Workers 运行时提供，包含你设置的环境变量
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event.env));
});

async function handleRequest(request, env) { // 接收 env 参数
  // 1. 检查请求方法和路径
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/') {
    return new Response('Method Not Allowed or Invalid Path', { status: 405 });
  }

  try {
    // 从环境变量中读取敏感信息
    const MINIMAX_API_KEY = env.MINIMAX_API_KEY;
    const MINIMAX_GROUP_ID = env.MINIMAX_GROUP_ID;
    const MINIMAX_VOICE_ID = env.MINIMAX_VOICE_ID;

    // 验证环境变量是否已设置
    if (!MINIMAX_API_KEY || !MINIMAX_GROUP_ID || !MINIMAX_VOICE_ID) {
      console.error("Minimax AI credentials are not configured in Worker environment variables.");
      return new Response('Server configuration error: Minimax AI credentials missing.', { status: 500 });
    }


    // 2. 解析前端发来的 JSON 数据 (包含要转语音的文本)
    const requestBody = await request.json();
    const textToSpeak = requestBody.text;

    if (!textToSpeak) {
      return new Response('Missing "text" in request body', { status: 400 });
    }

    // 3. 构建 Minimax TTS API 的请求体
    const minimaxRequestBody = JSON.stringify({
      model: "speech-01", // Minimax TTS 模型名称，根据文档可能不同
      voice_id: MINIMAX_VOICE_ID,
      text: textToSpeak,
      speed: 1.0,         // 语速，可调
      vol: 1.0,           // 音量，可调
      pitch: 0,           // 音调，可调
    });

    // 4. 发送请求到 Minimax TTS API
    // 注意：Minimax AI 的 Group ID 通常作为查询参数传递，请再次确认文档
    const minimaxResponse = await fetch(`${MINIMAX_TTS_ENDPOINT}?GroupId=${MINIMAX_GROUP_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`, // 通常是 Bearer Token，请确认
      },
      body: minimaxRequestBody,
    });

    // 5. 检查 Minimax AI 的响应是否成功
    if (!minimaxResponse.ok) {
      const errorText = await minimaxResponse.text();
      console.error('Minimax TTS API Error:', minimaxResponse.status, errorText);
      return new Response(`Minimax TTS API Error: ${minimaxResponse.status} - ${errorText}`, { status: minimaxResponse.status });
    }

    // 6. 返回 Minimax AI 传回的音频数据给前端
    const audioBlob = await minimaxResponse.blob();
    return new Response(audioBlob, {
      headers: {
        'Content-Type': 'audio/mpeg', // 根据 Minimax AI 返回的实际音频格式调整，例如 'audio/wav'
        'Access-Control-Allow-Origin': '*', // 允许所有来源访问，如果你只想特定域名访问，可以修改这里
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });

  } catch (error) {
    console.error('Worker error:', error);
    return new Response(`Worker Error: ${error.message}`, { status: 500 });
  }
}