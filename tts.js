// ==========================
// Cloudflare Worker: MiniMax TTS Proxy
// ==========================

const MINIMAX_TTS_ENDPOINT = "https://api.minimax.chat/v1/t2a_v2"; // ✅ 正确端点

export default {
  async fetch(request, env) {
    // 允许跨域（前端 fetch）
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // 限定只允许 POST 请求到根路径
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/') {
      return new Response('Method Not Allowed or Invalid Path', { status: 405 });
    }

    try {
      // === 1. 从 Cloudflare Secrets 中读取配置 ===
      const apiKey = env.MINIMAX_API_KEY;
      const groupId = env.GROUP_ID;
      const voiceId = env.VOICE_ID;

      if (!apiKey || !groupId || !voiceId) {
        return new Response('Server configuration error: Missing API key or IDs.', { status: 500 });
      }

      // === 2. 解析请求体 ===
      const body = await request.json();
      const text = body.text;
      if (!text) {
        return new Response('Missing "text" field in request body.', { status: 400 });
      }

      // === 3. 构建 MiniMax 请求 ===
      const minimaxBody = JSON.stringify({
        model: "speech-2.5-hd-preview", // ✅ 根据账单使用的模型
        voice_id: voiceId,
        text,
        speed: 1.0,
        vol: 1.0,
        pitch: 0
      });

      // === 4. 发送请求到 MiniMax ===
      const minimaxResp = await fetch(`${MINIMAX_TTS_ENDPOINT}?GroupId=${groupId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: minimaxBody
      });

      // === 5. 检查响应 ===
      if (!minimaxResp.ok) {
        const errText = await minimaxResp.text();
        return new Response(`MiniMax API Error: ${minimaxResp.status} - ${errText}`, {
          status: minimaxResp.status,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      // === 6. 返回音频文件 ===
      const audioData = await minimaxResp.arrayBuffer();
      return new Response(audioData, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });

    } catch (err) {
      console.error("Worker Error:", err);
      return new Response(`Worker Error: ${err.message}`, { status: 500 });
    }
  }
};
