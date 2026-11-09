"use strict";

globalThis.RainbowAdapter = (() => {
  // 1. 初始化检查并绑定当前站点的配置
  const hostKey = Object.keys(globalThis.SITES_CONFIG).find(h => location.hostname.includes(h));
  const cfg = globalThis.SITES_CONFIG[hostKey];

  function visible(element) {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    return element.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function context() {
    if (!cfg) throw new Error(`未适配当前域名: ${location.hostname}`);
    
    const inputs = [...document.querySelectorAll(cfg.selectors.input)].filter(visible);
    if (inputs.length !== 1) throw new Error("聊天输入框不唯一或未找到，数量：" + inputs.length);

    const input = inputs[0];
    const panel = input.closest(cfg.selectors.panel) || document.body;
    const section = input.closest(cfg.selectors.section) || input.parentElement;
    const root = document.querySelector(cfg.selectors.content) || panel;

    return { input, panel, section, root };
  }

  function messages(c) {
    if (!cfg) return [];
    return cfg.getMessages(c).filter(visible);
  }

  function text(element) {
    if (!cfg) return "";
    return cfg.getMessageText(element);
  }

  function normalize(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function isGenerating(c) {
    return cfg ? cfg.isGenerating(c) : false;
  }

  function isReady(c) {
    const sendBtn = c.section.querySelector(cfg.selectors.send);
    return !c.input.disabled && !c.input.readOnly && !c.input.value.trim() && !isGenerating(c) && sendBtn !== null;
  }

  async function submit(c, value) {
    if (c.input.value.trim()) throw new Error("输入框已有草稿，拒绝覆盖");
    if (c.input.disabled || c.input.readOnly || isGenerating(c)) throw new Error("页面尚未就绪（可能正在生成或被禁用）");

    // 突破 React / Vue 等框架的双向绑定拦截
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set 
                 || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("无法获取输入框底层 Setter");

    setter.call(c.input, value);
    // 触发一系列组合事件，欺骗多框架底层状态机
    c.input.dispatchEvent(new Event("input",  { bubbles: true }));
    c.input.dispatchEvent(new Event("change", { bubbles: true }));

    // 人类打字行为习惯微调：添加一小段延迟等待发送按钮转绿
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (!c.input.isConnected) throw new Error("输入框节点已被前端框架销毁");
      
      const button = c.section.querySelector(cfg.selectors.send);
      if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
        // 模拟人类微小的随机反应时间，防止被 Cloudflare 指纹识别
        await new Promise(r => setTimeout(r, Math.random() * 150 + 50));
        return button;
      }
      await new Promise(r => setTimeout(r, 150));
    }
    throw new Error("发送按钮启用的超时限制已到，文字可能留存在草稿中");
  }

  return {
    context, messages, text, normalize, isGenerating, isReady, submit, visible,
    supported: () => !!cfg,
    getPathways: () => cfg ? cfg.supportedPaths : []
  };
})();
