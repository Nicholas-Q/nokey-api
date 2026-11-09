"use strict";

/**
 * 全局多大模型网页选择器映射表 (内置安全风控噪声清洗拦截器)
 */
globalThis.SITES_CONFIG = {
  "doubao.com": {
    name: "豆包",
    supportedPaths: ["/chat"],
    selectors: {
      input:   'textarea[data-testid="chat-input"], [class*="chat-input__textarea"]',
      panel:   'div[class*="chat-layout__container"]',
      content: 'div[class*="chat-history__list"]',
      section: 'div[class*="chat-input__container"]',
      message: 'div[class*="chat-message-assistant"]',
      send:    'button[data-testid="chat-send-button"]',
    },
    isGenerating: (ctx) => {
      return !!ctx.section.querySelector('[class*="stop-icon"]') || !!ctx.panel.querySelector('[class*="loading-dots"]');
    },
    getMessages: (ctx) => {
      return [...ctx.root.querySelectorAll('div[class*="chat-message-assistant"]')];
    },
    getMessageText: (el) => {
      const textEl = el.querySelector('[class*="text-content"], .markdown-body');
      let rawText = textEl ? textEl.innerText.trim() : el.innerText.trim();

      // ── 噪声及风控安全过滤清洗 ──
      const NOISE_PATTERNS = [
        /请完成安全验证/i, 
        /网络开小差了/i, 
        /发送速度太快/i, 
        /因敏感词汇无法显示/i, 
        /操作过于频繁/i,
        /请稍后再试/i
      ];
      for (let pattern of NOISE_PATTERNS) {
        if (pattern.test(rawText)) {
          throw new Error(`[CRITICAL_ERROR] 网页触发安全验证或风控阻断: ${rawText}`);
        }
      }
      return rawText;
    }
  },

  "deepseek.com": {
    name: "DeepSeek",
    supportedPaths: ["/chat"],
    selectors: {
      input:   'textarea#chat-input',
      panel:   'div[class*="chat-page"]',
      content: 'div[class*="ds-markdown"]',
      section: 'div[class*="input-area"]',
      message: 'div[class*="answer-item-container"]',
      send:    'div[role="button"][class*="send-btn"]',
    },
    isGenerating: (ctx) => {
      return !!ctx.section.querySelector('div[role="button"][class*="stop-btn"]') || !!ctx.panel.querySelector('.is-generating');
    },
    getMessages: (ctx) => {
      return [...ctx.panel.querySelectorAll('div[class*="answer-item-container"]')];
    },
    getMessageText: (el) => {
      const mdEl = el.querySelector('.ds-markdown');
      let rawText = mdEl ? mdEl.innerText.trim() : el.innerText.trim();

      // ── 噪声及风控安全过滤清洗 ──
      const NOISE_PATTERNS = [
        /请完成安全验证/i, 
        /无权访问该会话/i, 
        /触发反爬虫系统/i, 
        /请稍后再试/i,
        /当前服务人数较多/i
      ];
      for (let pattern of NOISE_PATTERNS) {
        if (pattern.test(rawText)) {
          throw new Error(`[CRITICAL_ERROR] 网页触发安全验证或风控阻断: ${rawText}`);
        }
      }
      return rawText;
    }
  }
};
