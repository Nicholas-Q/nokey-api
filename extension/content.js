"use strict";

(() => {
  // 防止在单页面应用或重合路由中重复注入
  if (globalThis.__NOKEY_CONTENT__) return;
  globalThis.__NOKEY_CONTENT__ = true;

  const A = globalThis.RainbowAdapter;
  const DOCUMENT_ID = crypto.randomUUID();

  // ── 核心状态机状态定义 ────────────────────────────────────────────
  const STATE = {
    IDLE:        "IDLE",
    SUBMITTING:  "SUBMITTING",
    GENERATING:  "GENERATING",
    COMPLETING:  "COMPLETING",
  };

  let currentJob = null;

  function createJob(jobId, text) {
    return {
      id:        jobId,
      prompt:    text,
      url:       location.href,
      state:     STATE.IDLE,
      seq:       0,
      oldNodes:  new Set(),
      lastText:  "",
      observer:  null,
      timer:     null,
      debounce:  null,
      startedAt: Date.now()
    };
  }

  // ── 状态事件分发 ──────────────────────────────────────────────────
  function emit(job, type, payload = {}) {
    chrome.runtime.sendMessage({
      channel: "PAGE_EVENT",
      event: {
        version:  1,
        event_id: crypto.randomUUID(),
        job_id:   job.id,
        type,
        payload: {
          ...payload,
          seq:         ++job.seq,
          document_id: DOCUMENT_ID,
          url:         job.url,
        }
      }
    }).catch(err => {
      console.error("[nokey-api] 插件事件回传信道失败:", err.message);
    });
  }

  function cleanup(job) {
    job.observer?.disconnect();
    job.observer = null;
    clearInterval(job.timer);
    job.timer = null;
    clearTimeout(job.debounce);
    job.debounce = null;
    if (currentJob === job) currentJob = null;
  }

  function transition(job, newState) {
    console.debug(`[nokey-api] 状态流转: ${job.state} → ${newState}`);
    job.state = newState;
  }

  function fail(job, reason) {
    if (job.state === STATE.IDLE) return;
    console.warn("[nokey-api] 调度流判定任务失败, 触发Fail转换:", reason);
    emit(job, "job.failed", { detail: reason });
    transition(job, STATE.IDLE);
    cleanup(job);
  }

  function ping() {
    try {
      if (!A || !A.supported()) {
        return { document_id: DOCUMENT_ID, url: location.href, ready: false, working: currentJob !== null, error: "未匹配到针对当前域名的有效适配器" };
      }
      const ctx = A.context();
      return {
        document_id: DOCUMENT_ID,
        url:         location.href,
        ready:       A.isReady(ctx),
        working:     currentJob !== null,
        error:       "",
      };
    } catch (err) {
      return { document_id: DOCUMENT_ID, url: location.href, ready: false, working: currentJob !== null, error: err.message };
    }
  }

  function findReply(job) {
    const ctx = A.context();
    const list = A.messages(ctx);
    if (!list || list.length === 0) return null;

    // 定位并提取网页最新的最终回复节点
    const lastNode = list[list.length - 1];
    const rawText = A.text(lastNode); // 这里会向外抛出 sites_config 里的风控异常
    
    if (!rawText || rawText === A.normalize(job.prompt)) return null;
    return { raw: rawText };
  }

  // ── 事件驱动与增量脏检查控制循环 ─────────────────────────────────────
  async function inspect(job) {
    if (job.state === STATE.IDLE) return;
    if (job._inspecting) return;
    job._inspecting = true;

    try {
      if (Date.now() - job.startedAt > 180000) throw new Error("180秒生存空间超时保护触发");
      if (location.href !== job.url) throw new Error("会话进行中宿主页面 URL 发生漂移");

      const ctx = A.context();

      if (job.state === STATE.GENERATING || job.state === STATE.SUBMITTING) {
        let reply = null;
        
        // 强力重构点：对数据读取层进行包裹，高灵敏捕获来自底层的风控报警清洗
        try {
          reply = findReply(job);
        } catch (domErr) {
          throw new Error(domErr.message); // 强行拦截并冒泡到最外层 fail 处理
        }

        if (reply && reply.raw !== job.lastText) {
          const isFirst = !job.lastText;
          job.lastText = reply.raw;
          emit(job, isFirst ? "reply.started" : "reply.updated", { text: reply.raw });
          
          if (job.state === STATE.SUBMITTING) {
            transition(job, STATE.GENERATING);
          }
        }

        // 判断大模型网页自身的生成状态机是否关闭
        if (!A.isGenerating(ctx) && job.lastText) {
          transition(job, STATE.COMPLETING);
          await new Promise(r => setTimeout(r, 600)); // 给前端虚拟 DOM 树挂载预留缓冲时间

          if (job.state === STATE.IDLE) return;
          
          let final = null;
          try {
            final = findReply(job);
          } catch (domErr) {
            throw new Error(domErr.message);
          }
          
          if (!final) throw new Error("生成流关闭但未能在目标 DOM 容器中捕获任何文本资产");

          emit(job, "reply.completed", { text: final.raw });
          transition(job, STATE.IDLE);
          cleanup(job);
        }
      }
    } catch (err) {
      fail(job, err.message);
    } finally {
      job._inspecting = false;
    }
  }

  // ── 任务触发流 ──────────────────────────────────────────────
  async function run(job) {
    transition(job, STATE.SUBMITTING);
    try {
      const ctx = A.context();
      const btn = await A.submit(ctx, job.prompt);

      if (job.state === STATE.IDLE) return;
      emit(job, "job.accepted", { detail: "多轮洗脑数据已投喂，正在模拟人类点击发送" });

      // 注册最高优先级的标准前端 MutationObserver
      job.observer = new MutationObserver(() => {
        clearTimeout(job.debounce);
        job.debounce = setTimeout(() => void inspect(job), 100);
      });

      job.observer.observe(ctx.root || document.body, {
        childList: true, subtree: true, characterData: true
      });

      // 挂载 1 秒轮询作为降级非事件更新兜底
      job.timer = setInterval(() => void inspect(job), 1000);

      // 点击发送按钮
      btn.click();
    } catch (err) {
      fail(job, err.message);
    }
  }

  // ── 核心消息总线侦听 ──────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return false;

    if (message.type === "PING") {
      reply({ ok: true, page: ping() });
      return false;
    }

    if (message.type === "DETACH") {
      if (currentJob?.id === message.job_id) {
        transition(currentJob, STATE.IDLE);
        cleanup(currentJob);
      }
      reply({ ok: true });
      return false;
    }

    if (message.type === "SUBMIT") {
      const data = message.payload;
      if (!data || data.document_id !== DOCUMENT_ID || data.url !== location.href) {
        reply({ ok: false, error: "多站安全上下文校验失败" });
        return false;
      }
      if (currentJob !== null) {
        reply({ ok: false, error: "当前传输管道正忙，请等待上个任务释放" });
        return false;
      }

      const p = ping();
      if (!p.ready) {
        reply({ ok: false, error: "目标页面适配异常: " + (p.error || "未就绪") });
        return false;
      }

      const job = createJob(message.job_id, data.text);
      currentJob = job;
      reply({ ok: true });
      void run(job);
      return false;
    }
    return false;
  });

  window.addEventListener("pagehide", () => {
    if (currentJob) fail(currentJob, "生成期间用户非预期离开会话页面");
  });
})();
