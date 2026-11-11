"use strict";

// 💡 终极对齐：统一走 8000 端口的标准原生 Web 套接字端点，删除多余的 8766 端口
const WS_URL = "ws://127.0.0.1:8000/ws";
let ws = null;
let isConnected = false;
let currentBinding = null;
let pingTimer = null;

function writeLog(tag, body) {
  const timeStr = new Date().toTimeString().split(' ');
  chrome.storage.local.get({ debug_logs: [] }, (data) => {
    let logs = data.debug_logs || [];
    logs.push({ time: timeStr, tag: tag, body: body });
    if (logs.length > 50) logs.shift(); 
    chrome.storage.local.set({ debug_logs: logs }, () => {
      chrome.runtime.sendMessage({ type: "DEBUG_LOG_UPDATE" }).catch(() => {});
    });
  });
}

function startHeartbeat() {
  clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ version: 1, type: "connection.ping" }));
    }
  }, 4000);
}

function stopHeartbeat() {
  clearInterval(pingTimer);
}

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  writeLog("网关状态", "正在连接统一样式中央网关端口: " + WS_URL);
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    writeLog("来自SERVER", "🟢 Monolithic WebSocket 核心总线成功挂载绑定！稳定常驻。");
    isConnected = true;
    ws.send(JSON.stringify({
      version: 1, type: "connection.hello", payload: { client: "chrome-extension" }
    }));
    startHeartbeat();
    notifyPopup();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "connection.ready") {
        writeLog("来自SERVER", "📥 网关信道校验完毕，长连接激活就绪。");
      } else if (msg.type !== "connection.pong") {
        writeLog("来自SERVER", `📥 接收到新任务包指令 [${msg.type}]`);
      }
      
      if (msg.type === "job.submit") {
        forwardJobToPage(msg);
      }
    } catch (e) {
      writeLog("核心异常", "数据解包发生非预期干扰: " + e.message);
    }
  };

  ws.onclose = () => {
    writeLog("核心异常", "🔴 检测到网关物理离线，2秒后自动触发长效起搏重连...");
    isConnected = false;
    currentBinding = null;
    stopHeartbeat();
    notifyPopup();
    setTimeout(connect, 2000); // 缩短退避重连周期，实现极速原地复活
  };

  ws.onerror = () => {
    writeLog("核心异常", "握手遭到 127.0.0.1 拒绝，请确保 Python 终端已拉起。");
  };
}

function notifyPopup() {
  chrome.runtime.sendMessage({ type: "STATE_UPDATE", connected: isConnected, binding: currentBinding }).catch(() => {}); 
}

function forwardJobToPage(msg) {
  if (!currentBinding || Number(currentBinding.tab_id) !== Number(msg.payload.tab_id)) {
    writeLog("核心异常", "任务路由错线：当前标签已发生动态漂移");
    return;
  }
  
  writeLog("来自网页", `📤 正在投喂多轮洗脑数据资产进网页填词区...`);
  
  chrome.tabs.sendMessage(Number(currentBinding.tab_id), {
    type: "SUBMIT", job_id: msg.job_id, payload: msg.payload
  }).then(res => {
    writeLog("来自网页", `📥 网页已安全承接! 数据状态机初始化: ${res?.ok ? "SUCCESS" : "FAILED"}`);
  }).catch(err => {
    writeLog("核心异常", "网页隔离层未就绪: " + err.message);
  });
}

// ── 💡 黄金卡点修复：确保 Popup 状态查询永远处于最高顺位，1秒秒回，彻底解开弹窗未连接死锁 ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "STATE") {
    // 强制立刻同步返回，不阻塞任何异步等待通道
    sendResponse({ connected: isConnected, binding: currentBinding });
    return false; 
  }
  if (message.type === "RECONNECT") {
    connect();
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "TABS") {
    chrome.tabs.query({}, (allTabs) => {
      const filtered = (allTabs || []).filter(t => {
        if (!t.url) return false;
        const u = t.url.toLowerCase();
        return u.includes("google.com") || u.includes("deepseek.com") || u.includes("doubao.com") || u.startsWith("file:///");
      });
      sendResponse({ tabs: filtered });
    });
    return true; 
  }
  if (message.type === "BIND") {
    const targetTabId = Number(message.tabId);
    chrome.tabs.sendMessage(targetTabId, { type: "PING" }).then(res => {
      if (res && res.ok) {
        currentBinding = { tab_id: targetTabId, document_id: res.page.document_id, url: res.page.url };
        writeLog("网关状态", `⚓ 成功锁定大模型作用视场 -> URL: ${res.page.url}`);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "session.bind", payload: currentBinding }));
        }
        sendResponse({ ok: true, page: res.page });
      } else { sendResponse({ ok: false, error: "页面未就绪" }); }
    }).catch(() => { sendResponse({ ok: false, error: "请大刷新目标网页后重试" }); });
    return true;
  }
  if (message.type === "UNBIND") {
    currentBinding = null;
    writeLog("网关状态", "🔓 释放当前绑定的作用域");
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "session.bind", payload: null }));
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message.channel === "PAGE_EVENT") {
    writeLog("来自网页", `📥 剥离出增量资产文本 [${message.event.type}] | 长度: ${message.event.payload.text ? message.event.payload.text.length : 0}`);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: message.event.type, job_id: message.event.job_id, payload: message.event.payload }));
    }
    sendResponse({ ok: true });
    return false;
  }
});

connect();
