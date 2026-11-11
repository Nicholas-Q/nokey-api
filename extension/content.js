"use strict";
(() => {
  if (globalThis.__NOKEY_CONTENT__) return;
  globalThis.__NOKEY_CONTENT__ = true;
  
  const A = globalThis.RainbowAdapter;
  const DOCUMENT_ID = crypto.randomUUID();
  let currentJob = null; 
  let timer = null; 
  let stabilityTimer = null;

  function emit(job, type, payload = {}) {
    chrome.runtime.sendMessage({
      channel: "PAGE_EVENT",
      event: { version: 1, event_id: crypto.randomUUID(), job_id: job.id, type, payload: { ...payload, seq: ++job.seq, document_id: DOCUMENT_ID, url: job.url } }
    }).catch(() => {});
  }

  function cleanup(job) { 
    clearInterval(timer); 
    timer = null; 
    clearTimeout(stabilityTimer); 
    stabilityTimer = null; 
    if (currentJob === job) currentJob = null; 
  }

  async function inspect(job) {
    if (job.state === "IDLE" || job._inspecting) return;
    job._inspecting = true;
    try {
      const ctx = A.context(); 
      const generatingNow = A.isGenerating(ctx);
      const deltaText = A.text(document.body);
      
      console.log(`[Inspector Core] 轮询中 -> Generating: ${generatingNow}, State: ${job.state}, Length: ${deltaText.length}`);

      if (deltaText && deltaText.length > 0 && deltaText !== job.lastText) {
        job.lastText = deltaText;
        if (job.state === "SUBMITTING") {
          job.state = "GENERATING";
          emit(job, "reply.started", { text: deltaText });
        } else {
          emit(job, "reply.updated", { text: deltaText });
        }
        
        clearTimeout(stabilityTimer);
        stabilityTimer = setTimeout(() => {
          if (job.state === "GENERATING") {
            console.log("[Inspector] 检测到增量文本完全静止，触发正常收网。");
            job.state = "COMPLETING";
            emit(job, "reply.completed", { text: job.lastText });
            job.state = "IDLE"; 
            cleanup(job);
          }
        }, 500); 
      }
      
      if (!generatingNow && job.lastText && job.lastText.length > 2 && (job.state === "GENERATING" || job.state === "SUBMITTING")) {
        console.log("[Inspector] 检测到物理转圈终止且握有有效资产，强制收网。");
        job.state = "COMPLETING"; 
        emit(job, "reply.completed", { text: job.lastText });
        job.state = "IDLE"; 
        cleanup(job);
      }
    } catch (err) { 
      console.warn("[Inspector Non-Fatal]", err.message);
    } finally { 
      job._inspecting = false; 
    }
  }

  async function run(job) {
    job.state = "SUBMITTING";
    try {
      const ctx = A.context(); 
      
      // 💡 核心解锁：强制 await 让打字、回车脉冲完美执行完，阻断 inspect() 抢跑误杀发送通道
      await A.submit(ctx, job.prompt);
      emit(job, "job.accepted", { detail: "多轮洗脑数据资产已100%物理注入完毕" });
      
      // 发送完全落地后，精准拉起检测轮询
      timer = setInterval(() => void inspect(job), 250);
    } catch (err) { 
      emit(job, "job.failed", { detail: "上行注入器崩溃: " + err.message }); 
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === "PING") {
      reply({
        ok: true,
        page: { document_id: DOCUMENT_ID, url: location.href }
      });
      return false; 
    }

    if (message.type === "SUBMIT") {
      if (currentJob !== null) { reply({ ok: false, error: "管道正忙，拦截保护" }); return false; }
      
      currentJob = { 
        id: message.job_id, 
        prompt: message.payload.text, 
        url: location.href, 
        state: "SUBMITTING", 
        seq: 0, 
        lastText: "", 
        startedAt: Date.now() 
      };
      reply({ ok: true }); 
      void run(currentJob); 
      return false;
    }
  });
})();
