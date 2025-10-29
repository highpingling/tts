export default {
  async fetch(request, env) {
    // 处理 OPTIONS 请求（CORS 预检）
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

    // 只允许 POST 请求
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let requestBody;
    let rawRequestBody; // 用于调试，存储原始请求体

    try {
      rawRequestBody = await request.text(); // 先获取原始文本
      requestBody = JSON.parse(rawRequestBody); // 再尝试解析 JSON
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.error("Error parsing request JSON:", e.message, "Raw body:", rawRequestBody ? rawRequestBody.substring(0, 200) : "[empty]");
        return new Response(`Invalid JSON in request body: ${e.message}. Raw body start: ${rawRequestBody ? rawRequestBody.substring(0, 50) : "[empty]"}`, { status: 400 });
      }
      console.error("Unexpected error during request body parsing:", e, "Raw body:", rawRequestBody ? rawRequestBody.substring(0, 200) : "[empty]");
      return new Response('Error processing request body', { status: 400 });
    }
    
    const { text } = requestBody;

    if (!text || typeof text !== 'string' || text.trim() === '') {
      console.error("Missing or invalid 'text' in request body. Received:", requestBody);
      return new Response('Missing or invalid "text" in request body', { status: 400 });
    }

    // 1. 初始化 Minimax TTS 任务
    // 异步TTS的API URL，根据Minimax文档确认
    const minimaxInitTaskUrl = `https://api.minimax.chat/v1/t2a_async_v2?GroupId=${env.MINIMAX_GROUP_ID}`;
    
    try {
      const initRes = await fetch(minimaxInitTaskUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.MINIMAX_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // 推荐使用文档中提到的高性能模型，例如 speech-2.6-hd
          model: "speech-2.6-hd", 
          text: text,
          // 根据Minimax文档选择合适的voice_id。例如：
          // 对于英文，可以是 "English_expressive_narrator"
          // 对于中文，可以是 "zh_female_jingjing", "zh_male_hong", 等 (具体请查阅Minimax最新文档)
          voice_id: "English_expressive_narrator", // 请根据你的需求和支持的语言进行更改
          audio_format: "mp3",
          // 其他可选参数，如 language_boost, voice_setting 等，可根据需求添加
          // language_boost: "auto",
          // voice_setting: {
          //   speed: 1, // 语速 (0.5 - 2.0)
          //   vol: 10,  // 音量 (1 - 10)
          //   pitch: 1  // 音调 (0.5 - 1.5)
          // }
        }),
      });

      if (!initRes.ok) {
        const errorText = await initRes.text();
        console.error("Minimax TTS init API failed:", initRes.status, errorText);
        return new Response(`Minimax TTS init failed: ${initRes.status} - ${errorText}`, { status: 500 });
      }

      const task = await initRes.json();
      // 检查Minimax API返回的业务错误码 (通常 status_code 0 表示成功)
      if (task.base_resp && task.base_resp.status_code !== 0) {
        console.error("Minimax TTS API error during task creation:", task.base_resp.status_msg, "Full response:", JSON.stringify(task));
        return new Response(`Minimax TTS API error: ${task.base_resp.status_msg}`, { status: 500 });
      }
      
      const taskId = task.task_id;
      if (!taskId) {
          console.error("Minimax TTS did not return a task_id:", JSON.stringify(task));
          return new Response("Minimax TTS task creation failed, no task_id returned.", { status: 500 });
      }

      // 2. 轮询任务状态
      let audioUrl = null;
      const maxRetries = 60; // 增加轮询次数，考虑长文本可能需要更长时间，例如60次
      const retryIntervalMs = 2000; // 轮询间隔2秒

      for (let i = 0; i < maxRetries; i++) {
        await new Promise(r => setTimeout(r, retryIntervalMs)); 

        const minimaxQueryTaskUrl = `https://api.minimax.chat/v1/t2a_async_v2/query?task_id=${taskId}`;
        const queryRes = await fetch(minimaxQueryTaskUrl, {
          headers: { "Authorization": `Bearer ${env.MINIMAX_API_KEY}` },
        });

        if (!queryRes.ok) {
          const errorText = await queryRes.text();
          console.error(`Minimax TTS query API failed (attempt ${i + 1}/${maxRetries}):`, queryRes.status, errorText);
          // 遇到查询API错误时，可以继续重试几次，或者直接返回错误
          if (i < 3) continue; // 前几次失败继续重试
          return new Response(`Minimax TTS query API failed after multiple retries: ${queryRes.status} - ${errorText}`, { status: 500 });
        }

        const data = await queryRes.json();
        if (data.base_resp && data.base_resp.status_code !== 0) {
            console.error("Minimax TTS API error during task query:", data.base_resp.status_msg, "Full response:", JSON.stringify(data));
            return new Response(`Minimax TTS query API error: ${data.base_resp.status_msg}`, { status: 500 });
        }

        if (data.task_status === "SUCCESS") {
          audioUrl = data.audio_url;
          break;
        } else if (data.task_status === "FAILED") {
          console.error("Minimax TTS task processing failed:", JSON.stringify(data));
          return new Response("Minimax TTS task failed during processing.", { status: 500 });
        }
        // 如果是 PROCESSING 或 PENDING，则继续轮询
      }

      if (!audioUrl) {
        console.error("Minimax TTS timeout or failed to get audio URL for task:", taskId);
        return new Response("Minimax TTS timeout or failed to generate audio.", { status: 500 });
      }

      // 3. 获取音频文件
      const audioRes = await fetch(audioUrl);
      
      if (!audioRes.ok) {
          const errorText = await audioRes.text();
          console.error("Failed to fetch generated audio:", audioRes.status, errorText);
          return new Response(`Failed to fetch generated audio: ${audioRes.status} - ${errorText}`, { status: 500 });
      }

      const audioBuffer = await audioRes.arrayBuffer();

      // 4. 返回音频
      return new Response(audioBuffer, {
        headers: {
          "Content-Type": "audio/mpeg", // 确保 Content-Type 正确
          "Access-Control-Allow-Origin": "*", // 允许所有源访问（CORS）
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", // 防止客户端缓存旧音频
          "Pragma": "no-cache",
          "Expires": "0"
        },
      });

    } catch (e) {
        // 捕获所有未被特定try/catch块处理的未知错误
        console.error("An unexpected error occurred in the Worker:", e.stack || e);
        return new Response(`Internal server error: ${e.message}`, { status: 500 });
    }
  }
};
