export default {
  async fetch(request, env) {
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

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const { text } = await request.json();

    const initRes = await fetch("https://api.minimax.chat/v1/t2s_async", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.MINIMAX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "speech-01",
        text,
        voice_id: "male-01",
        group_id: env.MINIMAX_GROUP_ID,
        audio_format: "mp3"
      }),
    });

    const task = await initRes.json();
    const taskId = task.task_id;

    // 查询任务状态
    let audioUrl = null;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000)); // 轮询间隔 1 秒
      const queryRes = await fetch(`https://api.minimax.chat/v1/t2s_async/query?task_id=${taskId}`, {
        headers: { "Authorization": `Bearer ${env.MINIMAX_API_KEY}` },
      });
      const data = await queryRes.json();
      if (data.task_status === "SUCCESS") {
        audioUrl = data.audio_url;
        break;
      }
    }

    if (!audioUrl) {
      return new Response("TTS timeout or failed", { status: 500 });
    }

    const audioRes = await fetch(audioUrl);
    const audioBuffer = await audioRes.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
};
