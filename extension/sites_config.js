"use strict";
if (globalThis.__GOOGLE_COPY_LOCK__ === undefined) globalThis.__GOOGLE_COPY_LOCK__ = false;
globalThis.SITES_CONFIG = {
  "doubao.com": {
    name: "豆包", supportedPaths: ["/chat"],
    selectors: { input: 'textarea[data-testid="chat-input"]', panel: 'div[class*="chat-layout"]', content: 'div[class*="chat-history"]', section: 'div[class*="input__container"]', message: 'div[class*="message-assistant"]', send: 'button[data-testid="chat-send"]' },
    isGenerating: (ctx) => !!ctx.section.querySelector('[class*="stop-icon"]') || !!ctx.panel.querySelector('[class*="loading-dots"]'),
    getMessages: (ctx) => [...ctx.root.querySelectorAll('div[class*="message-assistant"]')],
    getMessageText: (el) => el.innerText.trim()
  },
  "deepseek.com": {
    name: "DeepSeek", supportedPaths: ["/chat"],
    selectors: { input: 'textarea#chat-input', panel: 'div[class*="chat-page"]', content: 'div[class*="ds-markdown"]', section: 'div[class*="input-area"]', message: 'div[class*="answer-item"]', send: 'div[role="button"][class*="send-btn"]' },
    isGenerating: (ctx) => !!ctx.section.querySelector('[class*="stop-btn"]') || !!ctx.panel.querySelector('.is-generating'),
    getMessages: (ctx) => [...ctx.panel.querySelectorAll('div[class*="answer-item"]') ],
    getMessageText: (el) => (el.querySelector('.ds-markdown')?.innerText || el.innerText).trim()
  },
  "google.com": {
    name: "Google AI Mode", supportedPaths: ["/search", "/ai"],
    selectors: {
      input: 'textarea[aria-label*="Search"], textarea[aria-label*="Ask"], textarea[role="combobox"]',
      panel: 'div[role="main"], #center_col, #rcnt', content: 'body', message: 'body',
      send: 'div[role="button"][aria-label="Send"], button[aria-label="Send"]'
    },
    isGenerating: (ctx) => {
      const text = document.body.innerText || "";
      return text.includes("Transcribing...") || text.includes("Waiting...") || text.includes("Thinking...") || text.includes("thinking about your query") || document.querySelector('div[role="progressbar"]') !== null;
    },
    getMessages: (ctx) => {
      const text = document.body.innerText || "";
      if (text.includes("Waiting...") || text.includes("thinking about your query") || document.querySelector('div[role="progressbar"]') !== null) return [];
      if (globalThis.__GOOGLE_COPY_LOCK__ === true) return [];
      return [document.body];
    },
    getMessageText: (el) => {
      function deepExtract(node) {
        if (!node) return "";
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
        const tag = node.tagName ? node.tagName.toLowerCase() : "";
        if (['script','style','noscript','svg'].includes(tag)) return "";
        let text = "";
        if (node.shadowRoot) text += deepExtract(node.shadowRoot);
        let child = node.firstChild;
        while (child) { text += deepExtract(child); child = child.nextSibling; }
        return text;
      }
      
      const rawFullText = deepExtract(document.body).replace(/\s+/g, " ").trim();
      const START_KEY = "# THE FINAL USER TASK";
      
      // 动态向内包含多后缀变体，锁定物理最小右边界
      const END_KEYS = ["ShareGood response", "Copied to clipboard", "Failed to copy", "Copied", "Copy"];
      
      let foundEndKey = null;
      let minEndIndex = rawFullText.length;
      
      for (const key of END_KEYS) {
        const index = rawFullText.indexOf(key);
        if (index !== -1 && index < minEndIndex) {
          minEndIndex = index;
          foundEndKey = key;
        }
      }

      if (rawFullText.includes(START_KEY) && foundEndKey !== null) {
        let partsAfterStart = rawFullText.split(START_KEY);
        let afterStart = partsAfterStart[partsAfterStart.length - 1]; 
        
        let cleanCoreAnswer = afterStart.split(foundEndKey)[0].trim();
        
        if (cleanCoreAnswer.includes("</USER>")) {
          let finalAnswer = cleanCoreAnswer.split("</USER>").pop().trim();
          
          if (finalAnswer.includes("thinking about your query") || finalAnswer.length < 2) {
            return "";
          }
          return finalAnswer;
        }
      }
      return "";
    }
  }
};
