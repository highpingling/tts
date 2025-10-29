// ==========================
// Cloudflare Worker: MiniMax TTS Proxy (Optimized for HTTP POST API)
// ==========================

// **重要：请根据 MiniMax 官方文档核实这个 HTTP API 端点**
// 如果文档显示不同的端点，请务必修改！
const MINIMAX_TTS_HTTP_ENDPOINT = "https://api.minimax.chat/v1/text_to_speech"; // 这是一个常见假设，务必核实！

export default {
  async fetch(request, env) {
    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400', // 缓存预检结果24小时
        },
      });
    }

    const url = new URL(request.url);
    // 只接受根路径的 POST 请求
    if (request.method !== 'POST' || url.pathname !== '/') {
      return new Response('Method Not Allowed or Invalid Path. Please use POST to /', { status: 405 });
    }

    try {
      // === 1. 环境变量检查 ===
      const apiKey = env.MINIMAX_API_KEY;
      const groupId = env.GROUP_ID;
      const voiceId = env.VOICE_ID;
      if (!apiKey || !groupId || !voiceId) {
        console.error("DEBUG: Server configuration error - Missing MINIMAX_API_KEY, GROUP_ID, or VOICE_ID in environment variables.");
        return new Response('Server configuration error: Missing API key or IDs. Please check Worker environment variables.', { status: 500 });
      }

      // === 2. 解析请求体 ===
      const requestBody = await request.json();
      const text = requestBody.text;
      if (!text || typeof text !== 'string' || text.trim() === '') {
        console.error("DEBUG: Invalid request body - Missing or empty 'text' field.");
        return new Response('Invalid request body: Missing or empty "text" field.', { status: 400 });
      }

      // === 3. 构造 MiniMax TTS API 请求 ===
      // MiniMax HTTP TTS API 通常将 group_id 放在 URL query 参数中
      const minimaxApiUrl = `${MINIMAX_TTS_HTTP_ENDPOINT}?Group_id=${groupId}`; // 注意：`Group_id` 的大小写也需核实

      const minimaxRequestBody = JSON.stringify({
        model: "speech-2.5-hd-preview", // 保持与你 Python 代码中的模型一致
        text: text,
        voice_id: voiceId,
        speed: 1.0,
        vol: 1.0,
        pitch: 0,
        // 如果 HTTP API 需要其他参数，请在这里添加
        // audio_output_format: "mp3", // MiniMax 的 HTTP API 可能有此参数
      });

      console.log(`DEBUG: Sending request to MiniMax URL: ${minimaxApiUrl}`);
      console.log(`DEBUG: MiniMax Request Body: ${minimaxRequestBody}`);

      const minimaxResp = await fetch(minimaxApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: minimaxRequestBody,
      });

      // === 4. 处理 MiniMax API 响应 ===
      if (!minimaxResp.ok) {
        // 如果 MiniMax 返回非 2xx 状态码
        const errorText = await minimaxResp.text();
        console.error(`DEBUG: MiniMax upstream error (status ${minimaxResp.status}): ${errorText}`);
        return new Response(`MiniMax API returned an error (status ${minimaxResp.status}): ${errorText}`, {
          status: minimaxResp.status,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      // **重要：这里假设 MiniMax HTTP API 直接返回音频二进制流**
      // 如果 MiniMax 实际上返回一个 JSON 对象，其中包含音频数据或一个下载 URL，
      // 你需要调整这里的逻辑。

      // 检查 Content-Type，确保它是音频类型
      const contentType = minimaxResp.headers.get('Content-Type');
      if (!contentType || !contentType.startsWith('audio/')) {
        const unexpectedResponse = await minimaxResp.text();
        console.error(`DEBUG: MiniMax returned unexpected Content-Type: ${contentType}. Full response: ${unexpectedResponse}`);
        return new Response(`MiniMax returned an unexpected content type. Expected audio, got: ${contentType}`, {
          status: 500,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      // === 5. 返回音频数据给客户端 ===
      // 直接将 MiniMax 的响应体（音频流）返回给请求方
      return new Response(minimaxResp.body, {
        headers: {
          'Content-Type': contentType, // 使用 MiniMax 返回的实际 Content-Type
          'Access-Control-Allow-Origin': '*',
          // 可以添加其他缓存控制头
          // 'Cache-Control': 'public, max-age=3600',
        },
      });

    } catch (err) {
      console.error("DEBUG: Worker Error (caught exception):", err.message, err.stack);
      return new Response(`Worker Error (Caught Exception): ${err.message}`, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  }
};
