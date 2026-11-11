"use strict";

let state = { connected: false, binding: null, tabs: [], binding_in_progress: false };

const statusDot    = document.getElementById("statusDot");
const statusText   = document.getElementById("statusText");
const bindingInfo  = document.getElementById("bindingInfo");
const bindingUrl   = document.getElementById("bindingUrl");
const tabList      = document.getElementById("tabList");
const tabSection   = document.getElementById("tabSection");
const btnRefresh   = document.getElementById("btnRefresh");
const btnUnbind    = document.getElementById("btnUnbind");
const btnReconnect = document.getElementById("btnReconnect");
const debugConsole = document.getElementById("debugConsole");
const btnClearLogs = document.getElementById("btnClearLogs");

function send(msg) {
  return chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, connected: false, tabs: [] }));
}

function renderLogs() {
  if (!debugConsole) return;
  chrome.storage.local.get({ debug_logs: [] }, (data) => {
    debugConsole.innerHTML = "";
    const logs = data.debug_logs || [];
    if (logs.length === 0) {
      debugConsole.innerHTML = '<div style="color:#52525b;text-align:center;padding-top:40px;">当前总线链路暂无调试日志...</div>';
      return;
    }
    logs.forEach(log => {
      const line = document.createElement("div");
      line.className = "log-line";
      
      let tagClass = "tag-extension";
      if (log.tag === "来自SERVER") tagClass = "tag-server";
      if (log.tag === "来自网页") tagClass = "tag-page";
      if (log.tag === "核心异常") tagClass = "tag-error";

      line.innerHTML = `
        <span class="log-time">${log.time}</span>
        <span class="log-tag ${tagClass}">${escapeHtml(log.tag)}</span>
        <span class="log-body">${escapeHtml(log.body)}</span>
      `;
      debugConsole.appendChild(line);
    });
    // 强制滚动至最底部，展示最新包
    debugConsole.scrollTop = debugConsole.scrollHeight;
  });
}

function render() {
  if (statusDot && statusText) {
    if (state.connected) {
      statusDot.className    = "status-dot connected";
      statusText.textContent = "已连接 Agent";
    } else {
      statusDot.className    = "status-dot disconnected";
      statusText.textContent = "未连接，请检查后台";
    }
  }

  if (bindingInfo && bindingUrl && btnUnbind && tabSection) {
    if (state.binding) {
      bindingInfo.style.display = "block";
      bindingUrl.textContent   = state.binding.url;
      btnUnbind.style.display  = "block";
      tabSection.style.display = "none";
    } else {
      bindingInfo.style.display = "none";
      btnUnbind.style.display  = "none";
      tabSection.style.display = "block";
    }
  }

  if (tabList) {
    if (!state.tabs || !state.tabs.length) {
      tabList.innerHTML = '<div class="tab-empty" style="padding:12px;text-align:center;color:#52525b;font-size:12px;">未找到支持的大模型活跃页面，请在左侧打开并刷新网页</div>';
    } else {
      tabList.innerHTML = "";
      state.tabs.forEach(tab => {
        const item = document.createElement("div");
        item.className = "tab-item";
        const isBound = (state.binding && state.binding.tab_id === tab.id);
        item.innerHTML = `
          <span class="tab-title">${escapeHtml(tab.title)}</span>
          ${isBound ? '<span class="tab-badge">已锚定</span>' : ''}
        `;
        if (!isBound) {
          item.addEventListener("click", () => bindTab(tab.id));
        }
        tabList.appendChild(item);
      });
    }
  }
}

function escapeHtml(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function refresh() {
  const resultState = await send({type: "STATE"});
  state.connected = resultState?.connected || false;
  state.binding   = resultState?.binding || null;

  const resultTabs = await send({type: "TABS"});
  state.tabs = resultTabs?.tabs || [];
  render();
  renderLogs();
}

async function bindTab(tabId) {
  if (state.binding_in_progress) return;
  state.binding_in_progress = true;
  try {
    const result = await send({type: "BIND", tabId});
    if (!result || !result.ok) {
      alert(result?.error || "绑定失败");
    }
  } catch (e) {
  } finally {
    state.binding_in_progress = false;
    await refresh();
  }
}

// 接收来自后台的实时推送日志刷新
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE_UPDATE" || message.type === "DEBUG_LOG_UPDATE") {
    if (message.type === "STATE_UPDATE") {
      state.connected = message.connected;
      state.binding = message.binding;
      render();
    }
    renderLogs();
  }
});

if (btnRefresh)   btnRefresh.addEventListener("click", refresh);
if (btnUnbind)    btnUnbind.addEventListener("click", async () => { await send({type: "UNBIND"}); await refresh(); });
if (btnReconnect) btnReconnect.addEventListener("click", async () => {
  if (statusText) statusText.textContent = "连接中...";
  await send({type: "RECONNECT"});
  setTimeout(refresh, 500);
});
if (btnClearLogs) btnClearLogs.addEventListener("click", () => {
  chrome.storage.local.set({ debug_logs: [] }, refresh);
});

document.addEventListener("DOMContentLoaded", refresh);
