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
    try {
      requestBody = await request.json();
    } catch (e) {
      return new Response('Invalid JSON in request body', { status: 400 });
    }
    const { text } = requestBody;

    if (!text) {
      return new Response('Missing "text" in request body', { status: 400 });
    }

    // 1. 初始化 Minimax TTS 任务
    const initTaskUrl = `https://api.minimax.chat/v1/t2a_async_v2?GroupId=${env.MINIMAX_GROUP_ID}`;
    const initRes = await fetch(initTaskUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.MINIMAX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // 根据Minimax文档选择合适的模型，例如 speech-2.6-hd
        model: "speech-2.6-hd", 
        text,
        // 根据Minimax文档选择合适的voice_id，例如 English_expressive_narrator
        // 或者你自定义克隆的语音ID
        voice_id: "English_expressive_narrator", 
        audio_format: "mp3",
        // 其他可选参数，如 language_boost, voice_setting 等，可根据需求添加
        // language_boost: "auto",
        // voice_setting: {
        //   speed: 1,
        //   vol: 10,
        //   pitch: 1
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
      console.error("Minimax TTS API error during task creation:", task.base_resp.status_msg);
      return new Response(`Minimax TTS API error: ${task.base_resp.status_msg}`, { status: 500 });
    }
    
    const taskId = task.task_id;
    if (!taskId) {
        console.error("Minimax TTS did not return a task_id:", task);
        return new Response("Minimax TTS task creation failed, no task_id returned.", { status: 500 });
    }

    // 2. 轮询任务状态
    let audioUrl = null;
    const maxRetries = 30; // 增加轮询次数，例如30次
    const retryIntervalMs = 2000; // 增加轮询间隔，例如2秒

    for (let i = 0; i < maxRetries; i++) {
      await new Promise(r => setTimeout(r, retryIntervalMs)); 

      const queryTaskUrl = `https://api.minimax.chat/v1/t2a_async_v2/query?task_id=${taskId}`;
      const queryRes = await fetch(queryTaskUrl, {
        headers: { "Authorization": `Bearer ${env.MINIMAX_API_KEY}` },
      });

      if (!queryRes.ok) {
        const errorText = await queryRes.text();
        console.error("Minimax TTS query API failed:", queryRes.status, errorText);
        // 可以选择在这里返回错误或继续重试
        continue; 
      }

      const data = await queryRes.json();
      if (data.base_resp && data.base_resp.status_code !== 0) {
          console.error("Minimax TTS API error during task query:", data.base_resp.status_msg);
          // 如果查询本身就报错，可能是task_id无效等情况，直接返回错误
          return new Response(`Minimax TTS query API error: ${data.base_resp.status_msg}`, { status: 500 });
      }

      if (data.task_status === "SUCCESS") {
        audioUrl = data.audio_url;
        break;
      } else if (data.task_status === "FAILED") {
        console.error("Minimax TTS task failed:", data);
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
        "Content-Type": "audio/mpeg",
        "Access-Control-Allow-Origin": "*", // 允许所有源访问
      },
    });
  }
};
