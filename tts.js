// ==========================
// Cloudflare Worker: MiniMax TTS Proxy (Final Fixed)
// ==========================

const MINIMAX_TTS_ENDPOINT = "https://api.minimax.chat/v1/t2a_v2";

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

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/') {
      return new Response('Method Not Allowed or Invalid Path', { status: 405 });
    }

    try {
      // === 1. 环境变量 ===
      const apiKey = env.MINIMAX_API_KEY;
      const groupId = env.GROUP_ID;
      const voiceId = env.VOICE_ID;

      if (!apiKey || !groupId || !voiceId) {
        return new Response('Server configuration error: Missing API key or IDs.', { status: 500 });
      }

      // === 2. 读取请求体 ===
      const body = await request.json();
      const text = body.text;
      if (!text) {
        return new Response('Missing "text" field in request body.', { status: 400 });
      }

      // === 3. 向 MiniMax 发请求 ===
      const minimaxResp = await fetch(`${MINIMAX_TTS_ENDPOINT}?GroupId=${groupId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "speech-2.5-hd-preview",
          text,
          voice_id: voiceId,
          speed: 1.0,
          vol: 1.0,
          pitch: 0
        })
      });

      const json = await minimaxResp.json();

      // === 4. 检查返回是否正常 ===
      if (!json?.base_resp || json.base_resp.status_code !== 0) {
        return new Response(`MiniMax API Error: ${JSON.stringify(json)}`, {
          status: 500,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      // === 5. 获取音频文件 URL ===
      const audioUrl = json.data?.audio_file;
      if (!audioUrl) {
        return new Response('No audio file returned from MiniMax.', {
          status: 500,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      // === 6. 拉取音频二进制并返回给前端 ===
      const audioResp = await fetch(audioUrl);
      const audioData = await audioResp.arrayBuffer();

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
