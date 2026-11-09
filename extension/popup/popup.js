"use strict";

/**
 * Popup 控制面板交互脚本
 * 职责：
 * 1. 负责 Popup UI 与 Background Service Worker 之间的状态同步
 * 2. 触发页面绑定、解绑、重新连接及刷新列表操作
 */

// ── 状态 ──────────────────────────────────────────────────
let state = {
  connected: false,
  binding:   null,
  tabs:      [],
  binding_in_progress: false,
};

// ── DOM 引用 ──────────────────────────────────────────────
const statusDot    = document.getElementById("statusDot");
const statusText   = document.getElementById("statusText");
const bindingInfo  = document.getElementById("bindingInfo");
const bindingUrl   = document.getElementById("bindingUrl");
const tabList      = document.getElementById("tabList");
const tabSection   = document.getElementById("tabSection");
const message      = document.getElementById("message");
const btnRefresh   = document.getElementById("btnRefresh");
const btnUnbind    = document.getElementById("btnUnbind");
const btnReconnect = document.getElementById("btnReconnect");

// ── 调试输出区域（保持你原本的极客风调试器，方便开源排查） ─────
function addDebugArea() {
  const div = document.createElement("div");
  div.id = "debugArea";
  div.style.cssText = (
    "margin-top:12px;"
    + "padding:8px;"
    + "background:#111;"
    + "border-radius:6px;"
    + "font-size:11px;"
    + "color:#aaa;"
    + "word-break:break-all;"
    + "max-height:120px;"
    + "overflow-y:auto;"
  );
  document.body.appendChild(div);
  return div;
}

const debugArea = addDebugArea();

function debug(label, value) {
  const line = document.createElement("div");
  line.style.marginBottom = "4px";
  line.innerHTML = (
    '<span style="color:#555">'
    + escapeHtml(label)
    + ": </span>"
    + '<span style="color:#0ea5e9">'
    + escapeHtml(JSON.stringify(value))
    + "</span>"
  );
  debugArea.appendChild(line);
  debugArea.scrollTop = debugArea.scrollHeight;
}

// ── 消息发送 ──────────────────────────────────────────────
function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

// ── UI 渲染控制 ───────────────────────────────────────────
function renderStatus() {
  if (state.connected) {
    statusDot.className    = "status-dot connected";
    statusText.textContent = "已连接 Agent";
  } else {
    statusDot.className    = "status-dot disconnected";
    statusText.textContent = "未连接，请启动 Agent";
  }
}

function renderBinding() {
  if (state.binding) {
    bindingInfo.classList.add("visible");
    bindingUrl.textContent   = state.binding.url;
    btnUnbind.style.display  = "block";
    tabSection.style.display = "none";
  } else {
    bindingInfo.classList.remove("visible");
    btnUnbind.style.display  = "none";
    tabSection.style.display = "block";
  }
}

function renderTabs() {
  if (!state.tabs.length) {
    tabList.innerHTML = (
      '<div class="tab-empty" style="padding:16px;text-align:center;color:#71717a;font-size:12px;">'
      + "未找到支持的 AI 聊天页面，请先在浏览器中打开 豆包 或 DeepSeek 等"
      + "</div>"
    );
    return;
  }

  tabList.innerHTML = "";

  for (const tab of state.tabs) {
    const item = document.createElement("div");
    item.className = "tab-item";

    const isBound = (
      state.binding &&
      state.binding.tab_id === tab.id
    );

    if (isBound) {
      item.classList.add("active");
    }

    item.innerHTML = (
      '<span class="tab-title">'
      + escapeHtml(tab.title)
      + "</span>"
      + (isBound ? '<span class="tab-badge">已锚定</span>' : "")
    );

    if (!isBound) {
      item.addEventListener("click", () => bindTab(tab.id));
    }

    tabList.appendChild(item);
  }
}

function showMessage(text, type = "info") {
  message.textContent = text;
  message.className   = `message visible ${type}`;
  setTimeout(() => {
    message.classList.remove("visible");
  }, 3000);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render() {
  renderStatus();
  renderBinding();
  renderTabs();
}

// ── 数据与通信链路交互 ──────────────────────────────────────
async function loadState() {
  try {
    debug("发送 STATE 请求", {type: "STATE"});
    const result = await send({type: "STATE"});
    debug("STATE 返回", result);

    state.connected = result.connected || false;
    state.binding   = result.binding   || null;
  } catch (e) {
    debug("STATE 错误", e.message);
  }
}

async function loadTabs() {
  try {
    debug("发送 TABS 请求", {type: "TABS"});
    const result = await send({type: "TABS"});
    debug("TABS 返回", result);

    state.tabs = result.tabs || [];
  } catch (e) {
    debug("TABS 错误", e.message);
    state.tabs = [];
  }
}

async function refresh() {
  debug("开始刷新", new Date().toLocaleTimeString());
  await loadState();
  await loadTabs();
  render();
}

// ── 交互操作行为 ──────────────────────────────────────────
async function bindTab(tabId) {
  if (state.binding_in_progress) return;
  if (!state.connected) {
    showMessage("请先连接 Agent", "error");
    return;
  }

  state.binding_in_progress = true;
  const items = tabList.querySelectorAll(".tab-item");
  items.forEach(item => item.classList.add("binding"));

  try {
    debug("发送 BIND 请求", {type: "BIND", tabId});
    const result = await send({type: "BIND", tabId});
    debug("BIND 返回", result);

    if (result.ok) {
      state.binding = {
        tab_id: tabId,
        url:    result.page.url,
      };
      showMessage("锚定绑定成功！", "success");
    } else {
      showMessage(result.error || "绑定失败", "error");
    }
  } catch (e) {
    debug("BIND 错误", e.message);
    showMessage("绑定失败: " + e.message, "error");
  } finally {
    state.binding_in_progress = false;
    await refresh();
  }
}

async function unbind() {
  try {
    debug("发送 UNBIND 请求", {type: "UNBIND"});
    const result = await send({type: "UNBIND"});
    debug("UNBIND 返回", result);

    state.binding = null;
    showMessage("已解除锚定", "info");
    await refresh();
  } catch (e) {
    debug("UNBIND 错误", e.message);
    showMessage("解绑失败: " + e.message, "error");
  }
}

async function reconnect() {
  statusDot.className    = "status-dot connecting";
  statusText.textContent = "连接中...";

  try {
    debug("发送 RECONNECT 请求", {type: "RECONNECT"});
    const result = await send({type: "RECONNECT"});
    debug("RECONNECT 返回", result);

    await new Promise(r => setTimeout(r, 1000));
    await refresh();

    if (state.connected) {
      showMessage("nokey-api 桥接成功！", "success");
    } else {
      showMessage("桥接失败，请确认本地 server.py 已启动", "error");
    }
  } catch (e) {
    debug("RECONNECT 错误", e.message);
    showMessage("连接失败: " + e.message, "error");
    await refresh();
  }
}

// ── 事件绑定 ──────────────────────────────────────────────
btnRefresh.addEventListener("click", refresh);
btnUnbind.addEventListener("click", unbind);
btnReconnect.addEventListener("click", reconnect);

// ── 初始化运行 ────────────────────────────────────────────
refresh();
