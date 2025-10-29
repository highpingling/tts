// ==========================
// Cloudflare Worker: MiniMax TTS Proxy (Auto-detect JSON / Base64 Audio)
// ==========================

const MINIMAX_TTS_ENDPOINT = "https://api.minimax.chat/v1/t2a_v2";

export default {
  async fetch(request, env) {
    // 处理 CORS
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

      // === 2. 请求体 ===
      const body = await request.json();
      const text = body.text;
      if (!text) {
        return new Response('Missing "text" field in request body.', { status: 400 });
      }

      // === 3. 调用 MiniMax API ===
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
          pitch: 0,
        }),
      });

      const json = await minimaxResp.json();

      if (!json?.base_resp || json.base_resp.status_code !== 0) {
        return new Response(`MiniMax API Error: ${JSON.stringify(json)}`, {
          status: 500,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      // === 4. 获取音频 ===
      let audioBuffer;
      if (json.data?.audio_file) {
        // 有音频URL → 再去拉取
        const audioResp = await fetch(json.data.audio_file);
        audioBuffer = await audioResp.arrayBuffer();
      } else if (json.data?.audio) {
        // 有base64 → 直接解码
        const binary = atob(json.data.audio);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        audioBuffer = bytes.buffer;
      } else {
        return new Response('No audio data found in MiniMax response.', {
          status: 500,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      // === 5. 返回音频 ===
      return new Response(audioBuffer, {
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
