"use strict";

globalThis.RainbowAdapter = (() => {
  function visible(element) {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    return element.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function context() {
    const hostKey = Object.keys(globalThis.SITES_CONFIG || {}).find(h => location.hostname.includes(h));
    const cfg = globalThis.SITES_CONFIG ? globalThis.SITES_CONFIG[hostKey] : null;
    if (!cfg) throw new Error(`未适配当前域名: ${location.hostname}`);
    
    const allInputs = [...document.querySelectorAll(cfg.selectors.input)].filter(visible);
    if (allInputs.length === 0) throw new Error("未找到适配大模型的活跃输入区域");

    let input = allInputs[0];
    if (location.hostname.includes("google.com")) {
      const targetInput = allInputs.find(el => el.getAttribute("aria-label")?.includes("Ask") || el.getAttribute("placeholder")?.includes("Ask") || el.getAttribute("role") === "combobox");
      if (targetInput) input = targetInput;
    }

    const panel = input.closest(cfg.selectors.panel) || document.body;
    const section = input.closest(cfg.selectors.section) || input.parentElement;
    const root = document.querySelector(cfg.selectors.content) || panel;

    return { input, panel, section, root };
  }

  function messages(c) {
    const hostKey = Object.keys(globalThis.SITES_CONFIG || {}).find(h => location.hostname.includes(h));
    const cfg = globalThis.SITES_CONFIG ? globalThis.SITES_CONFIG[hostKey] : null;
    if (!cfg) return [];
    return cfg.getMessages(c).filter(visible);
  }

  function text(element) {
    const hostKey = Object.keys(globalThis.SITES_CONFIG || {}).find(h => location.hostname.includes(h));
    const cfg = globalThis.SITES_CONFIG ? globalThis.SITES_CONFIG[hostKey] : null;
    if (!cfg) return "";
    return cfg.getMessageText(element);
  }

  function normalize(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function isGenerating(c) {
    const hostKey = Object.keys(globalThis.SITES_CONFIG || {}).find(h => location.hostname.includes(h));
    const cfg = globalThis.SITES_CONFIG ? globalThis.SITES_CONFIG[hostKey] : null;
    return cfg ? cfg.isGenerating(c) : false;
  }

  function isReady(c) {
    return !c.input.disabled && !c.input.readOnly && !isGenerating(c);
  }

  async function submit(c, value) {
    c.input.focus();
    await new Promise(r => setTimeout(r, 80));

    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set 
                 || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) {
      setter.call(c.input, value);
    } else {
      c.input.value = value;
    }

    c.input.dispatchEvent(new Event("keydown", { bubbles: true }));
    c.input.dispatchEvent(new Event("input",   { bubbles: true }));
    c.input.dispatchEvent(new Event("change",  { bubbles: true }));
    c.input.dispatchEvent(new Event("keyup",   { bubbles: true }));

    await new Promise(r => setTimeout(r, 300)); 

    console.log("[nokey-api] 正在向输入框直接发射最高优先级物理级 Enter 脉冲...");
    
    const enterKeyDown = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 });
    const enterKeyPress = new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 });
    const enterKeyUp = new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 });
    
    c.input.dispatchEvent(enterKeyDown);
    c.input.dispatchEvent(enterKeyPress);
    c.input.dispatchEvent(enterKeyUp);

    return true; 
  }

  return {
    context, messages, text, normalize, isGenerating, isReady, submit, visible,
    supported: () => {
      const hostKey = Object.keys(globalThis.SITES_CONFIG || {}).find(h => location.hostname.includes(h));
      return !!(globalThis.SITES_CONFIG && globalThis.SITES_CONFIG[hostKey]);
    }
  };
})();
