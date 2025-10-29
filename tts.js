// ==========================
// Cloudflare Worker: MiniMax TTS Proxy (FIXED VERSION)
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
        console.error("DEBUG: Missing API key or IDs.");
        return new Response('Server configuration error: Missing API key or IDs.', { status: 500 });
      }

      // === 2. 请求体 ===
      const body = await request.json();
      const text = body.text;
      if (!text) {
        console.error("DEBUG: Missing 'text' field in request body.");
        return new Response('Missing \"text\" field in request body.', { status: 400 });
      }

      // === 3. 调用 MiniMax API ===
      const minimaxResp = await fetch(`${MINIMAX_TTS_ENDPOINT}?group_id=${groupId}`, {
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

      if (!minimaxResp.ok) {
        const rawErrorText = await minimaxResp.text();
        console.error("DEBUG: MiniMax non-OK response:", rawErrorText);
        return new Response(`MiniMax upstream error (status ${minimaxResp.status}): ${rawErrorText}`, {
          status: minimaxResp.status,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      const json = await minimaxResp.json();

      if (!json?.base_resp || json.base_resp.status_code !== 0) {
        console.error("DEBUG: MiniMax API Error (status_code not 0):", JSON.stringify(json));
        return new Response(`MiniMax API Error: ${JSON.stringify(json)}`, {
          status: 500,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      // === 4. 获取音频 ===
      let audioBuffer;
      if (json.data?.audio_file) {
        console.log("DEBUG: Found audio_file URL:", json.data.audio_file);
        const audioResp = await fetch(json.data.audio_file);

        if (!audioResp.ok) {
          const audioFetchError = await audioResp.text();
          console.error("DEBUG: Secondary audio fetch failed:", audioFetchError);
          return new Response(`Failed to fetch audio from URL: ${audioFetchError}`, {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
          });
        }
        audioBuffer = await audioResp.arrayBuffer();
      } else if (json.data?.audio) {
        console.log("DEBUG: Found base64 audio.");
        const binary = atob(json.data.audio);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        audioBuffer = bytes.buffer;
      } else {
        console.error("DEBUG: No audio data (audio_file or base64) found.");
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
      console.error("Worker Error (caught):", err.message, err.stack);
      return new Response(`Worker Error (Caught Exception): ${err.message}`, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  }
};
