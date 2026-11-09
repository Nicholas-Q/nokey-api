"use strict";

/**
 * Background Service Worker (Universal Edition)
 * 职责：
 * 1. 维护与本地 Python Server 的 WebSocket 连接
 * 2. 在插件（content.js）和 Python API 网关之间进行协议转发
 * 3. 动态管理全站大模型（Foundry/豆包/DeepSeek）的页面绑定状态
 * 不包含任何具体网页的业务逻辑
 */

const WS_URL = "ws://127.0.0.1:8766";

// ── 静态多域路由定义（与前端 sites_config.js 完美互补） ───────
const SUPPORTED_DOMAINS = [
  { host: "doubao.com", paths: ["/chat"] },
  { host: "deepseek.com", paths: ["/chat"] }
];

// ── 连接状态 ──────────────────────────────────────────────

let socket        = null;
let authorized    = false;
let connecting    = false;
let retryTimer    = null;
let heartbeat     = null;
let backoff       = 1000;

// ── 存储操作 ──────────────────────────────────────────────

async function getConfig() {
  const stored = await chrome.storage.local.get("rainbowConfig");
  return {
    token:   "",
    enabled: true,
    binding: null,
    ...(stored.rainbowConfig || {}),
  };
}

async function setConfig(patch) {
  const current = await getConfig();
  const next    = { ...current, ...patch };
  await chrome.storage.local.set({ rainbowConfig: next });
  return next;
}

// ── 工具函数（动态路由校验升级） ───────────────────────────

function makeMessage(type, payload = {}, jobId = null) {
  return {
    version:  1,
    event_id: crypto.randomUUID(),
    type,
    job_id:   jobId,
    payload,
  };
}

/**
 * 升级版多域动态匹配函数
 * 职责：判定当前标签页是否在支持的 AI 模型聊天范围中
 */
function supported(url) {
  try {
    const u = new URL(url);
    // 寻找是否有匹配的宿主域名
    const rule = SUPPORTED_DOMAINS.find(item => u.hostname.includes(item.host));
    if (!rule) return false;

    // 校验路径前缀是否属于支持的聊天应用入口
    return rule.paths.some(p => u.pathname === p || u.pathname.startsWith(p + "/"));
  } catch {
    return false;
  }
}

// ── WebSocket 发送 ────────────────────────────────────────

function wsSend(message) {
  if (!authorized || socket?.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket 未连接");
  }
  socket.send(JSON.stringify(message));
}

// ── 出站队列（断线时缓存，重连后补发）────────────────────

// 串行处理队列的读取、写入和确认，避免并发覆盖。
let outboxChain = Promise.resolve();

function withOutboxLock(operation) {
  const result = outboxChain.then(operation);

  // 某次操作失败后，不让后续队列操作永久停住。
  outboxChain = result.catch(err => {
    console.error("[彩虹桥] 出站队列操作失败:", err.message);
  });

  return result;
}

// 只能在 withOutboxLock 内部调用。
async function flushUnlocked() {
  if (!authorized) return;

  const stored = await chrome.storage.local.get("rainbowOutbox");
  const outbox = stored.rainbowOutbox || [];

  for (const message of outbox) {
    if (!authorized) break;

    try {
      wsSend(message);
    } catch (err) {
      console.warn("[彩虹桥] 队列发送中断:", err.message);
      break;
    }
  }
}

function enqueue(message) {
  return withOutboxLock(async () => {
    const stored = await chrome.storage.local.get("rainbowOutbox");
    const outbox = stored.rainbowOutbox || [];

    // 同一任务只保留最新的回复更新。
    const filtered = outbox.filter(old => !(
      old.job_id === message.job_id &&
      old.type === "reply.updated" &&
      ["reply.updated", "reply.completed"].includes(message.type)
    ));

    if (filtered.length >= 150) {
      throw new Error("出站队列已满（150条），暂停入队");
    }

    filtered.push(message);
    await chrome.storage.local.set({ rainbowOutbox: filtered });

    await flushUnlocked();
  });
}

function flush() {
  return withOutboxLock(async () => {
    await flushUnlocked();
  });
}

function removeFromOutbox(eventId) {
  return withOutboxLock(async () => {
    const stored = await chrome.storage.local.get("rainbowOutbox");
    const outbox = (stored.rainbowOutbox || []).filter(
      item => item.event_id !== eventId
    );

    await chrome.storage.local.set({ rainbowOutbox: outbox });
  });
}

// ── 去重派发记录 ──────────────────────────────────────────

async function markDispatched(jobId, binding) {
  const stored  = await chrome.storage.local.get("rainbowDispatched");
  const records = stored.rainbowDispatched || {};

  if (records[jobId]) return false; // 已派发过

  if (Object.keys(records).length >= 1000) {
    throw new Error("派发记录达到上限（1000条）");
  }

  records[jobId] = { at: Date.now(), binding };
  await chrome.storage.local.set({ rainbowDispatched: records });
  return true;
}

// ── content.js 通信 ───────────────────────────────────────

async function pageMessage(tabId, message) {
  const tab = await chrome.tabs.get(tabId);

  if (!supported(tab.url)) {
    throw new Error("目标标签页已离开支持的页面");
  }

  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch {
    throw new Error("页面脚本未响应，请刷新页面并重新绑定");
  }
}

// ── Python → 页面：job.submit ─────────────────────────────

async function handleJobSubmit(message) {
  const cfg = await getConfig();
  const p   = message.payload;

  // 校验绑定匹配
  if (
    !cfg.enabled  ||
    !cfg.binding  ||
    p.tab_id      !== cfg.binding.tab_id      ||
    p.document_id !== cfg.binding.document_id ||
    p.url         !== cfg.binding.url
  ) {
    await enqueue(makeMessage(
      "job.unknown",
      {
        tab_id:      p.tab_id,
        document_id: p.document_id,
        url:         p.url,
        seq:         1000000,
        detail:      "任务与绑定不匹配",
      },
      message.job_id
    ));
    return;
  }

  // 去重
  const shouldSend = await markDispatched(message.job_id, cfg.binding);
  if (!shouldSend) return;

  // 转发给 content.js
  try {
    const result = await pageMessage(p.tab_id, {
      type:    "SUBMIT",
      job_id:  message.job_id,
      payload: p,
    });

    if (!result.ok) throw new Error(result.error);

  } catch (err) {
    await enqueue(makeMessage(
      "job.unknown",
      {
        tab_id:      p.tab_id,
        document_id: p.document_id,
        url:         p.url,
        seq:         1000000,
        detail:      err.message,
      },
      message.job_id
    ));
  }
}

// ── Python → 页面：page.probe ─────────────────────────────

async function handlePageProbe(message) {
  const p = message.payload;

  try {
    const cfg = await getConfig();

    if (
      !cfg.binding  ||
      p.tab_id      !== cfg.binding.tab_id      ||
      p.document_id !== cfg.binding.document_id ||
      p.url         !== cfg.binding.url
    ) {
      throw new Error("探测请求与绑定不一致");
    }

    const result = await pageMessage(p.tab_id, { type: "PING" });

    wsSend(makeMessage("page.status", {
      probe_id: p.probe_id,
      tab_id:   p.tab_id,
      ok:       result.ok === true,
      page:     result.page || {},
      error:    result.error || "",
    }));

  } catch (err) {
    wsSend(makeMessage("page.status", {
      probe_id: p.probe_id,
      tab_id:   p.tab_id,
      ok:       false,
      page:     { document_id: p.document_id, url: p.url },
      error:    err.message,
    }));
  }
}

// ── Python → 页面：job.detach ─────────────────────────────

async function handleJobDetach(message) {
  try {
    await pageMessage(message.payload.tab_id, {
      type:   "DETACH",
      job_id: message.job_id,
    });
  } catch {
    // detach 失败不影响主流程
  }
}

// ── WebSocket 消息处理 ────────────────────────────────────

async function onWsMessage(raw) {
  const message = JSON.parse(raw);

  switch (message.type) {

    case "connection.ready": {
      authorized = true;
      connecting = false;
      backoff    = 1000;

      await setConfig({ token: message.payload.token });

      // 启动心跳
      clearInterval(heartbeat);
      heartbeat = setInterval(async () => {
        if (!authorized) return;
        try {
          wsSend(makeMessage("connection.ping"));
          await flush();
        } catch (err) {
          console.warn("[彩虹桥] 心跳失败:", err.message);
        }
      }, 20000);

      // 恢复绑定
      try {
        await restoreBinding();
      } catch (err) {
        console.warn("[彩虹桥] 恢复绑定失败:", err.message);
      }

      await flush();
      break;
    }

    case "connection.rejected": {
      console.warn("[彩虹桥] 连接被拒绝:", message.payload.error);
      authorized = false;
      await setConfig({ enabled: false });
      socket?.close();
      break;
    }

    case "event.ack": {
      const p = message.payload;
      await removeFromOutbox(p.event_id);
      if (!p.ok) {
        console.warn("[彩虹桥] 事件被拒绝:", p.error);
      }
      break;
    }

    case "job.submit":
      await handleJobSubmit(message);
      break;

    case "page.probe":
      await handlePageProbe(message);
      break;

    case "job.detach":
      await handleJobDetach(message);
      break;

    default:
      console.debug("[彩虹桥] 未知消息类型:", message.type);
  }
}

// ── 绑定恢复 ──────────────────────────────────────────────

async function restoreBinding() {
  const cfg = await getConfig();
  if (!cfg.binding) return;

  const result = await pageMessage(cfg.binding.tab_id, { type: "PING" });
  if (!result.ok) throw new Error(result.error);

  if (
    result.page.url         !== cfg.binding.url ||
    result.page.document_id !== cfg.binding.document_id
  ) {
    throw new Error("绑定页面已变化，请重新绑定");
  }

  // 通知 Python 侧绑定已恢复
  wsSend(makeMessage("session.bind", cfg.binding));
}

// ── WebSocket 连接管理 ────────────────────────────────────

async function connect() {
  const cfg = await getConfig();

  if (
    !cfg.enabled                              ||
    connecting                                ||
    socket?.readyState === WebSocket.OPEN     ||
    socket?.readyState === WebSocket.CONNECTING
  ) {
    return;
  }

  connecting = true;
  console.log("[彩虹桥] 连接中...");

  const ws = new WebSocket(WS_URL);
  socket   = ws;

  ws.onopen = () => {
    connecting = false;
    ws.send(JSON.stringify(makeMessage("connection.hello", {
      extension_id: chrome.runtime.id,
    })));
  };

  ws.onmessage = event => {
    onWsMessage(event.data).catch(err => {
      console.error("[彩虹桥] 消息处理失败:", err.message);
    });
  };

  ws.onerror = () => {
    console.warn("[彩虹桥] WebSocket 连接失败");
  };

Use code with caution.
ws.onclose = () => {
if (socket !== ws) return;
authorized = false;
connecting = false;
clearInterval(heartbeat);
console.log([彩虹桥] 连接断开，${backoff}ms 后重连);
clearTimeout(retryTimer);
retryTimer = setTimeout(connect, backoff);
backoff    = Math.min(backoff * 2, 30000);
};
}
// ── Popup 消息处理（扩大全局标签检索范围） ───────────────────
async function handlePopup(message) {
switch (message.type) {
case "STATE": {
const cfg = await getConfig();
return {
ok:        true,
connected: authorized,
binding:   cfg.binding,
};
}
case "TABS": {
// 全局检索所有打开的标签，通过 supported() 动态过滤
const tabs = await chrome.tabs.query({});
return {
tabs: tabs
.filter(t => supported(t.url))
.map(t => ({ id: t.id, title: t.title, url: t.url })),
};
}
case "BIND": {
if (!authorized) throw new Error("请先连接 Agent");
const result = await pageMessage(message.tabId, { type: "PING" });
if (!result.ok)          throw new Error(result.error);
if (!result.page.ready)  throw new Error(result.page.error || "页面未就绪");
const binding = {
tab_id:      message.tabId,
document_id: result.page.document_id,
url:         result.page.url,
};
// 通知 Python 侧
wsSend(makeMessage("session.bind", binding));
await setConfig({ binding });
return { ok: true, page: result.page };
}
case "UNBIND": {
await setConfig({ binding: null });
return {};
}
case "RECONNECT": {
await setConfig({ enabled: true });
await connect();
return {};
}
default:
throw new Error("未知操作: " + message.type);
}
}
// ── 消息路由 ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, respond) => {
if (sender.id !== chrome.runtime.id) return false;
// 来自 content.js 的页面事件
if (message.channel === "PAGE_EVENT") {
if (
!sender.tab          ||
sender.frameId !== 0 ||
!supported(sender.url)
) {
respond({ ok: false, error: "事件来源无效" });
return false;
}
(async () => {
const cfg = await getConfig();
if (
!cfg.binding                                              ||
sender.tab.id !== cfg.binding.tab_id                     ||
message.event?.payload?.document_id !== cfg.binding.document_id
) {
throw new Error("事件与绑定不匹配");
}
// 补充 tab_id
message.event.payload.tab_id = sender.tab.id;
await enqueue(message.event);
respond({ ok: true });
})().catch(err => {
respond({ ok: false, error: err.message });
});
return true;
}
// 来自 popup 的操作
if (!sender.tab && sender.url === chrome.runtime.getURL("popup/popup.html")) {
handlePopup(message)
.then(result => respond({ ok: true,  ...result }))
.catch(err   => respond({ ok: false, error: err.message }));
return true;
}
return false;
});
// ── 初始化 ────────────────────────────────────────────────
async function initialize() {
try {
await chrome.storage.local.setAccessLevel({
accessLevel: "TRUSTED_CONTEXTS",
});
} catch {}
// 定时重连（每30秒检查一次）
await chrome.alarms.create("rainbow-reconnect", {
periodInMinutes: 0.5,
});
await connect();
}
chrome.alarms.onAlarm.addListener(alarm => {
if (alarm.name === "rainbow-reconnect") void connect();
});
chrome.runtime.onInstalled.addListener(() => void initialize());
chrome.runtime.onStartup.addListener(()   => void initialize());
void initialize();
