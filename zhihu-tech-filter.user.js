// ==UserScript==
// @name         zh文章屏蔽器
// @name:en      Zhihu Article Shield
// @namespace    https://github.com/imenk2/zhihu-shield
// @version      0.0.56
// @description  自动屏蔽zh推荐/热榜/专栏/圈子非技术类文章，支持作者/关键词/标题黑白名单过滤，冲突黄色折叠栏一键消冲突
// @author       imenk2
// @match        https://www.zhihu.com/*
// @match        https://zhihu.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      cdn.jsdelivr.net
// @connect      raw.githubusercontent.com
// @connect      github.com
// @run-at       document-idle
// @icon         https://static.zhihu.com/heifetz/favicon.ico
// @updateURL    https://raw.githubusercontent.com/imenk2/zhihu-shield/main/zhihu-tech-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/imenk2/zhihu-shield/main/zhihu-tech-filter.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCAN_DEBOUNCE_MS = 200;
  const SCAN_INTERVAL_MS = 2000;
  const MAX_SUMMARY_LENGTH = 300;
  const MAX_TITLE_DISPLAY = 18;
  const CONFIG_KEY = 'ztf_config_v2';
  const NEWLINE = String.fromCharCode(10);
  const REMOTE_RULES_BASE_URLS = [
    'https://cdn.jsdelivr.net/gh/imenk2/zhihu-shield@main/rules/',
    'https://raw.githubusercontent.com/imenk2/zhihu-shield/main/rules/',
  ];


  const SELECTORS = {
    cards: [
      '.ContentItem[data-zop]',
      '.TopstoryItem',
      'div[class*="TopstoryItem"]',
      '.List-item',
      'div[class*="Feed"] div[class*="Card"]',
      'section.HotItem',
      '.HotItem',
      '.subscrib-card',
      '.hot-column .card',
    ],
    title: [
      '.ContentItem-title',
      'h2.ContentItem-title',
      '.HotItem-title',
      '.content-title',
      '.subscrib-card .title',
      '.hot-column .title',
      'h2',
      '[itemprop="headline"]',
      '.RichContent .ContentItem-title',
    ],
    author: [
      '.AuthorInfo-name',
      '.UserLink-link',
      '.author-name',
      '.hot-column .name',
      '.AuthorInfo meta[itemprop="name"]',
    ],
    summary: [
      '.HotItem-excerpt',
      '.article-text',
      '.column-des-text',
      '.RichContent-inner',
      '.CopyrightRichText-richText',
      '.RichText',
      '.ContentItem-summary',
    ],
    content: [
      '.ContentItem-content',
      '.RichContent',
      '.ContentItem',
      '.card-content',
      '.HotItem-content',
    ],
  };

  const DEFAULT_CONFIG = {
    techAuthors: [],
    nonTechAuthors: [],
    categoryWhitelist: {},
    categoryBlacklist: {},
    activeCategoryId: 'tech',
    questionShieldEnabled: true,
    messageShieldEnabled: true,
    defaultAction: 'high',
    debug: false,
  };

  const stats = { blocked: 0, passed: 0, passedTech: 0 };

  // === 配置存取 ===
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function mergeConfig(base, override) {
    for (const key of Object.keys(base)) {
      if (Array.isArray(base[key]) && Array.isArray(override[key])) {
        base[key] = override[key];
      } else if (typeof base[key] === 'string' && typeof override[key] === 'string') {
        base[key] = override[key];
      } else if (typeof base[key] === 'boolean' && typeof override[key] === 'boolean') {
        base[key] = override[key];
      } else if (typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key]) && typeof override[key] === 'object' && override[key] !== null && !Array.isArray(override[key])) {
        base[key] = override[key];
      }
    }
    return base;
  }

  function loadConfig() {
    try {
      const saved = GM_getValue(CONFIG_KEY, null);
      if (!saved) return deepClone(DEFAULT_CONFIG);
      return mergeConfig(deepClone(DEFAULT_CONFIG), saved);
    } catch (e) {
      return deepClone(DEFAULT_CONFIG);
    }
  }

  function saveConfig(cfg) {
    GM_setValue(CONFIG_KEY, cfg);
  }

  let config = loadConfig();
  document.documentElement.dataset.ztfMsgShield = config.messageShieldEnabled !== false ? '1' : '0';

  const NEW_CAT_IDS = ['tech', 'life', 'emotion', 'entertainment', 'society'];

  (function migrateConfig() {
    let changed = false;
    if (config.defaultAction === 'pass') { config.defaultAction = 'low'; changed = true; }
    if (config.defaultAction === 'block') { config.defaultAction = 'high'; changed = true; }
    if (!['low', 'basic', 'high'].includes(config.defaultAction)) { config.defaultAction = 'high'; changed = true; }
    if (config.blockedCategories) { delete config.blockedCategories; changed = true; }
    if (config.categoryLevel) { delete config.categoryLevel; changed = true; }
    if (changed) saveConfig(config);
  })();

  function querySelectorAny(root, selectorList) {
    for (const sel of selectorList) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (e) { /* skip */ }
    }
    return null;
  }

  function querySelectorAllAny(root, selectorList) {
    const result = new Set();
    for (const sel of selectorList) {
      try {
        root.querySelectorAll(sel).forEach((el) => result.add(el));
      } catch (e) { /* skip */ }
    }
    return Array.from(result);
  }

  // === 文章提取与分类判定 ===
  function extractArticleInfo(card) {
    let title = '';
    let author = '';
    let itemType = '';

    const zopEl = card.hasAttribute('data-zop') ? card : card.querySelector('[data-zop]');
    const zopRaw = zopEl ? zopEl.getAttribute('data-zop') : null;
    if (zopRaw) {
      try {
        const zop = JSON.parse(zopRaw);
        if (zop && typeof zop.title === 'string') title = zop.title.trim();
        if (zop && typeof zop.authorName === 'string') author = zop.authorName.trim();
        if (zop && typeof zop.type === 'string') itemType = zop.type.trim();
      } catch (e) { /* ignore */ }
    }

    if (!title) {
      const titleEl = querySelectorAny(card, SELECTORS.title);
      if (titleEl) title = (titleEl.innerText || titleEl.textContent || '').trim();
    }

    if (!author) {
      const authorEl = querySelectorAny(card, SELECTORS.author);
      if (authorEl) {
        author = (authorEl.getAttribute('content') || authorEl.innerText || authorEl.textContent || '').trim();
      }
    }

    const summaryEl = querySelectorAny(card, SELECTORS.summary);
    let summary = '';
    if (summaryEl) {
      summary = (summaryEl.innerText || summaryEl.textContent || '').trim();
      if (summary.length > MAX_SUMMARY_LENGTH) summary = summary.slice(0, MAX_SUMMARY_LENGTH);
    }

    if (!title && !summary) return null;

    // 对想法/圈子等无标题卡片，生成备用展示名
    const displayTitle = title || (summary ? summary.replace(/\s+/g, ' ').slice(0, 30) : '动态内容');

    return { title, displayTitle, author, summary, type: itemType };
  }

  function classifyArticle(info) {
    const { title, author } = info;
    const text = title || '';
    const lowerText = text.toLowerCase();

    if (author && config.nonTechAuthors && config.nonTechAuthors.length > 0) {
      for (const a of config.nonTechAuthors) {
        if (a && (author === a || author.includes(a) || a.includes(author))) {
          return { isTech: false, reason: '作者黑名单: ' + author, category: null };
        }
      }
    }

    if (author && config.techAuthors && config.techAuthors.length > 0) {
      let techAuthorHit = false;
      for (const a of config.techAuthors) {
        if (a && (author === a || author.includes(a) || a.includes(author))) { techAuthorHit = true; break; }
      }
      if (techAuthorHit) {
        return { isTech: true, reason: '作者白名单: ' + author, category: null };
      }
    }

    const hitCategories = [];
    const hitKeywordMap = {};
    for (const cat of activeCategories) {
      for (const kw of cat.keywords) {
        if (kw && lowerText.includes(kw.toLowerCase())) {
          hitCategories.push(cat);
          hitKeywordMap[cat.id] = kw;
          break;
        }
      }
    }

    const action = config.defaultAction || 'high';
    const passSignals = [];
    const blockSignals = [];

    const techHit = hitCategories.find((c) => c.id === 'tech');
    if (techHit) {
      passSignals.push({ reason: '技术[' + hitKeywordMap['tech'] + ']', category: techHit });
    }

    for (const cat of hitCategories) {
      const catWhitelist = (config.categoryWhitelist && config.categoryWhitelist[cat.id]) || [];
      const catBlacklist = (config.categoryBlacklist && config.categoryBlacklist[cat.id]) || [];
      for (const k of catWhitelist) {
        if (k && text.includes(k)) {
          passSignals.push({ reason: '白名单[' + cat.name + ']: ' + k, category: cat, whitelistValue: k });
        }
      }
      for (const k of catBlacklist) {
        if (k && text.includes(k)) {
          blockSignals.push({ reason: '黑名单[' + cat.name + ']: ' + k, category: cat, blacklistValue: k });
        }
      }
    }

    if (action === 'high') {
      for (const cat of hitCategories) {
        if (cat.id !== 'tech') {
          blockSignals.push({ reason: '默认屏蔽[' + cat.name + ']', category: cat });
        }
      }
    }

    if (action === 'basic' && config.questionShieldEnabled !== false && activeQuestionPatterns.length > 0) {
      for (const re of activeQuestionPatterns) {
        re.lastIndex = 0;
        if (re.test(text)) {
          blockSignals.push({ reason: '问题屏蔽: ' + re.source, category: null });
          break;
        }
      }
    }

    if (passSignals.length > 0 && blockSignals.length > 0) {
      const pass = passSignals[0];
      const block = blockSignals.find((s) => s.blacklistValue) || blockSignals[0];
      const category = pass.category || block.category;
      const conflictInfo = {};
      if (block.blacklistValue && block.category) {
        conflictInfo.catId = block.category.id;
        conflictInfo.catName = block.category.name;
        conflictInfo.blacklistValue = block.blacklistValue;
      }
      if (pass.whitelistValue && pass.category) {
        conflictInfo.catId = pass.category.id;
        conflictInfo.catName = pass.category.name;
        conflictInfo.whitelistValue = pass.whitelistValue;
      }
      return {
        isTech: false,
        conflict: true,
        conflictInfo,
        reason: '冲突: ' + pass.reason + ' \u2194 ' + block.reason,
        category,
      };
    }

    if (passSignals.length > 0) {
      return { isTech: true, reason: passSignals[0].reason, category: passSignals[0].category };
    }
    if (blockSignals.length > 0) {
      return { isTech: false, reason: blockSignals[0].reason, category: blockSignals[0].category };
    }

    if (action === 'low') {
      return { isTech: true, reason: '默认放行', category: null };
    }
    if (action === 'basic') {
      return { isTech: true, reason: '默认放行', category: null };
    }
    return { isTech: false, reason: '默认屏蔽', category: null };
  }

  function getHitCategory(info) {
    const lowerText = (info.title || '').toLowerCase();
    const hits = [];
    for (const cat of activeCategories) {
      for (const kw of cat.keywords) {
        if (kw && lowerText.includes(kw.toLowerCase())) { hits.push(cat); break; }
      }
    }
    if (hits.length === 0) return null;
    hits.sort((a, b) => (a.priority || 99) - (b.priority || 99));
    return hits[0];
  }


  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isDarkTheme() {
    try {
      const html = document.documentElement;
      const t = html.getAttribute('data-theme');
      if (t === 'dark') return true;
      if (t === 'light') return false;
      const cm = html.getAttribute('data-color-mode');
      if (cm === 'dark') return true;
      if (cm === 'light') return false;
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return true;
      const bg = getComputedStyle(document.body).backgroundColor;
      const m = bg.match(/\d+/g);
      if (m && m.length >= 3) {
        const lum = 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2];
        if (lum < 128) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function updateBannerTheme() {
    try {
      document.documentElement.setAttribute('data-ztf-theme', isDarkTheme() ? 'dark' : 'light');
    } catch (e) { /* ignore */ }
  }

  function injectStyles() {
    if (document.getElementById('ztf-styles')) return;
    const style = document.createElement('style');
    style.id = 'ztf-styles';
    style.textContent = [
      '.ztf-banner{display:flex;align-items:center;gap:4px;padding:1px 8px;background:#fafafa;border:1px solid #f0f0f0;border-left:2px solid #d0d0d0;border-radius:3px;margin:0 0 2px !important;cursor:pointer;font-size:10px;color:#aaa;box-sizing:border-box;position:relative;width:100%;}',
      '.ztf-banner:hover{background:#f5f5f5;}',
      '.ztf-banner-icon{color:#bbb;font-size:11px;font-weight:bold;flex-shrink:0;}',
      '.ztf-banner-text{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ztf-banner-action{color:#bbb;flex-shrink:0;}',
      '.ztf-banner.ztf-banner-conflict{border-left-color:#ccc;background:#f0f0f0;}',
      '.ztf-banner.ztf-banner-conflict:hover{background:#e8e8e8;}',
      '.ztf-banner.ztf-banner-conflict .ztf-banner-icon{color:#f0ad4e;font-size:12px;}',
      '.ztf-banner.ztf-banner-conflict .ztf-banner-text{color:#888;}',
      '.ztf-banner-fix{color:#fff;background:#999;border:1px solid #888;border-radius:3px;padding:1px 6px;font-size:10px;cursor:pointer;flex-shrink:0;user-select:none;}',
      '.ztf-banner-fix:hover{background:#888;}',
      '.ztf-banner-dot{color:#bbb;font-size:14px;font-weight:bold;line-height:1;padding:2px 5px;border-radius:3px;cursor:pointer;flex-shrink:0;user-select:none;}',
      '.ztf-banner-dot:hover{color:#666;background:rgba(0,0,0,0.04);}',
      'html[data-ztf-theme="dark"] .ztf-banner{background:#2e2e30;border-color:#444;border-left-color:#555;color:#777;}',
      'html[data-ztf-theme="dark"] .ztf-banner:hover{background:#38383a;}',
      'html[data-ztf-theme="dark"] .ztf-banner-icon{color:#777;}',
      'html[data-ztf-theme="dark"] .ztf-banner-action{color:#777;}',
      'html[data-ztf-theme="dark"] .ztf-banner.ztf-banner-conflict{background:#333;border-left-color:#555;}',
      'html[data-ztf-theme="dark"] .ztf-banner.ztf-banner-conflict:hover{background:#3a3a3c;}',
      'html[data-ztf-theme="dark"] .ztf-banner.ztf-banner-conflict .ztf-banner-icon{color:#e0a800;}',
      'html[data-ztf-theme="dark"] .ztf-banner.ztf-banner-conflict .ztf-banner-text{color:#777;}',
      'html[data-ztf-theme="dark"] .ztf-banner-dot{color:#777;}',
      'html[data-ztf-theme="dark"] .ztf-banner-dot:hover{color:#ccc;background:rgba(255,255,255,0.08);}',
      '.ztf-collapsed{display:none !important;}',
      'html[data-ztf-msg-shield="1"] button[href*="/messages"] svg ~ div{display:none !important;}',

      '[data-ztf-status="blocked"]{margin-top:0 !important;margin-bottom:6px !important;padding-top:0 !important;padding-bottom:0 !important;}',
      '.ztf-pass-mark{position:absolute;top:4px;right:28px;font-size:11px;color:#67c23a;background:#f0f9eb;padding:1px 6px;border-radius:8px;z-index:5;pointer-events:none;}',
      '.ztf-title-dot{position:absolute;right:8px;top:8px;cursor:pointer;z-index:10;color:#c9c9c9;font-size:16px;line-height:1;user-select:none;padding:2px 4px;font-weight:bold;}',
      '.ztf-title-dot:hover{color:#8590a6;}',
      '.ztf-dot-menu{position:fixed;z-index:99997;background:#fff;border:1px solid #ebeced;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.15);padding:4px 0;min-width:140px;font-size:13px;}',
      '.ztf-dot-item{padding:7px 14px;cursor:pointer;color:#1a1a1a;}',
      '.ztf-dot-item:hover{background:#f6f6f6;}',
      '.ztf-panel-mask{position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:99998;backdrop-filter:blur(2px);}',
      '.ztf-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:540px;max-width:92vw;max-height:86vh;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.3);z-index:99999;display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;color-scheme:light dark;--ztf-primary:#1772f6;--ztf-bg:light-dark(#fff,#1e1e1e);--ztf-bg-2:light-dark(#fafafa,#252525);--ztf-text:light-dark(#1a1a1a,#e0e0e0);--ztf-muted:light-dark(#8590a6,#999);--ztf-border:light-dark(#ebeced,#3a3a3a);--ztf-border-2:light-dark(#f0f2f5,#333);--ztf-hover:light-dark(#f6f6f6,#2a2a2a);--ztf-input-bg:light-dark(#fff,#2a2a2a);--ztf-input-border:light-dark(#d9d9d9,#555);background:var(--ztf-bg);color:var(--ztf-text);accent-color:var(--ztf-primary);}',
      '.ztf-panel-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--ztf-border);}',
      '.ztf-panel-title{font-size:17px;font-weight:600;color:var(--ztf-text);}',
      '.ztf-panel-close{cursor:pointer;font-size:22px;color:var(--ztf-muted);line-height:1;padding:4px 8px;border:none;background:none;border-radius:6px;}',
      '.ztf-panel-close:hover{color:var(--ztf-text);background:var(--ztf-hover);}',
      '.ztf-panel-tabs{display:flex;gap:6px;padding:12px 20px;border-bottom:1px solid var(--ztf-border-2);}',
      '.ztf-tab{padding:6px 14px;border:1px solid var(--ztf-border);border-radius:18px;background:var(--ztf-bg);color:var(--ztf-muted);cursor:pointer;font-size:13px;transition:all 0.15s;}',
      '.ztf-tab:hover{border-color:var(--ztf-primary);color:var(--ztf-primary);}',
      '.ztf-tab.active{background:var(--ztf-primary);color:#fff;border-color:var(--ztf-primary);}',
      '.ztf-panel-body{flex:1;overflow-y:auto;padding:16px 20px;}',
      '.ztf-textarea{width:100%;min-height:200px;border:1px solid var(--ztf-input-border);border-radius:8px;padding:10px;font-size:13px;font-family:monospace;resize:vertical;box-sizing:border-box;line-height:1.6;background:var(--ztf-input-bg);color:var(--ztf-text);}',
      '.ztf-textarea:focus{outline:none;border-color:var(--ztf-primary);box-shadow:0 0 0 2px rgba(23,114,246,0.15);}',
      '.ztf-field-label{font-size:13px;color:var(--ztf-muted);margin-bottom:6px;display:block;}',
      '.ztf-settings-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--ztf-border-2);gap:12px;}',
      '.ztf-settings-label{font-size:14px;color:var(--ztf-text);}',
      '.ztf-settings-desc{font-size:12px;color:var(--ztf-muted);margin-top:2px;}',
      '.ztf-toggle{position:relative;width:42px;height:24px;background:light-dark(#ccc,#555);border-radius:12px;cursor:pointer;transition:background 0.2s;flex-shrink:0;}',
      '.ztf-toggle.on{background:var(--ztf-primary);}',
      '.ztf-toggle::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:transform 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2);}',
      '.ztf-toggle.on::after{transform:translateX(18px);}',
      '.ztf-select{font-size:13px;padding:6px 10px;border:1px solid var(--ztf-input-border);border-radius:8px;background:var(--ztf-input-bg);color:var(--ztf-text);cursor:pointer;min-width:140px;}',
      '.ztf-select:focus{outline:none;border-color:var(--ztf-primary);}',
      '.ztf-panel-footer{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-top:1px solid var(--ztf-border);background:var(--ztf-bg-2);}',
      '.ztf-stats{font-size:12px;color:var(--ztf-muted);}',
      '.ztf-stats b{color:var(--ztf-text);}',
      '.ztf-btn{padding:7px 18px;border-radius:8px;border:1px solid var(--ztf-input-border);background:var(--ztf-bg);color:var(--ztf-text);cursor:pointer;font-size:13px;transition:all 0.15s;}',
      '.ztf-btn:hover{border-color:var(--ztf-primary);color:var(--ztf-primary);}',
      '.ztf-btn:disabled{opacity:0.5;cursor:not-allowed;}',
      '.ztf-btn-primary{background:var(--ztf-primary);color:#fff;border-color:var(--ztf-primary);}',
      '.ztf-btn-primary:hover{background:#0d6ddb;color:#fff;}',
      '.ztf-btn-group{display:flex;gap:8px;}',
      '.ztf-tab-content{display:none;}',
      '.ztf-tab-content.active{display:block;}',
      '.ztf-hint{font-size:12px;color:var(--ztf-muted);margin:8px 0 0;line-height:1.6;}',
      '.ztf-cat-fieldset{margin-bottom:12px;border:1px solid var(--ztf-border);border-radius:10px;padding:12px;}',
      '.ztf-cat-legend{font-size:14px;font-weight:600;color:var(--ztf-primary);padding:0 6px;}',
      '.ztf-fab{position:fixed;z-index:99996;width:40px;height:40px;border-radius:50%;background:var(--ztf-primary);color:#fff;border:none;cursor:pointer;font-size:20px;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity 0.2s;user-select:none;}',
      '.ztf-fab.show{opacity:1;pointer-events:auto;}',
      '.ztf-fab.dragging{transition:none;cursor:grabbing;}',
      '.ztf-scan-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;}',
      '.ztf-scan-btn{margin-left:0;}',
      '.ztf-candidate-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:420px;max-width:92vw;max-height:70vh;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.3);z-index:100000;display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;color-scheme:light dark;background:light-dark(#fff,#1e1e1e);color:light-dark(#1a1a1a,#e0e0e0);accent-color:#1772f6;}',
      '.ztf-candidate-body{flex:1;overflow-y:auto;padding:12px 20px;}',
      '.ztf-candidate-item{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid light-dark(#f6f6f6,#333);cursor:pointer;font-size:13px;}',
      '.ztf-candidate-word{flex:1;color:light-dark(#1a1a1a,#e0e0e0);}',
      '.ztf-candidate-count{color:light-dark(#999,#777);font-size:12px;}',
    ].join(NEWLINE);
    document.head.appendChild(style);
  }

  // === 卡片屏蔽与三点菜单 ===
  function resetCardAll(card) {
    card.removeAttribute('data-ztf-status');
    card.removeAttribute('data-ztf-dot');
    card.removeAttribute('data-ztf-pos-set');
    card.querySelectorAll('.ztf-banner, .ztf-pass-mark, .ztf-title-dot, .ztf-banner-dot').forEach((n) => n.remove());
    card.querySelectorAll('.ztf-collapsed').forEach((n) => n.classList.remove('ztf-collapsed'));
  }

  function blockCard(card, info, conflict, conflictInfo, reason, category) {
    if (card.dataset.ztfStatus === 'blocked') return;
    card.dataset.ztfStatus = 'blocked';
    card.dataset.ztfDot = '1';

    const existingDot = card.querySelector(':scope > .ztf-title-dot');
    if (existingDot) existingDot.remove();

    const titleText = info.displayTitle || '';
    const shortTitle = titleText.length > MAX_TITLE_DISPLAY ? titleText.slice(0, MAX_TITLE_DISPLAY) + '...' : titleText;

    const collapsibles = Array.from(card.children).filter(
      (c) => !c.classList.contains('ztf-title-dot') && !c.classList.contains('ztf-banner')
    );
    collapsibles.forEach((c) => c.classList.add('ztf-collapsed'));

    const banner = document.createElement('div');
    banner.className = 'ztf-banner' + (conflict ? ' ztf-banner-conflict' : '');

    const icon = document.createElement('span');
    icon.className = 'ztf-banner-icon';
    icon.textContent = conflict ? '\u26a0' : '\u2298';

    const text = document.createElement('span');
    text.className = 'ztf-banner-text';
    const catLabel = category ? '[' + category.name + '] ' : '';
    text.textContent = (conflict && reason) ? reason : ('\u5df2\u5c4f\u853d ' + catLabel + '\u00b7 ' + shortTitle);

    const action = document.createElement('span');
    action.className = 'ztf-banner-action';
    action.textContent = '\u5c55\u5f00\u67e5\u770b';

    const dot = createDotButton(card, info, true);

    banner.appendChild(icon);
    banner.appendChild(text);
    banner.appendChild(action);

    if (conflict && conflictInfo) {
      const fixBlack = document.createElement('span');
      fixBlack.className = 'ztf-banner-fix';
      fixBlack.textContent = '\u9ed1\u540d\u5355fixed';
      fixBlack.title = '\u4ece\u9ed1\u540d\u5355\u79fb\u9664\u300c' + conflictInfo.blacklistValue + '\u300d';
      fixBlack.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!config.categoryBlacklist) config.categoryBlacklist = {};
        const blCat = conflictInfo.catId;
        config.categoryBlacklist[blCat] = (config.categoryBlacklist[blCat] || [])
          .filter((x) => x !== conflictInfo.blacklistValue);
        saveConfig(config);
        rescanAll();
      });

      const fixWhite = document.createElement('span');
      fixWhite.className = 'ztf-banner-fix';
      fixWhite.textContent = '\u767d\u540d\u5355fixed';
      fixWhite.title = '\u4ece\u767d\u540d\u5355\u79fb\u9664\u300c' + conflictInfo.whitelistValue + '\u300d';
      fixWhite.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!config.categoryWhitelist) config.categoryWhitelist = {};
        const wlCat = conflictInfo.catId;
        config.categoryWhitelist[wlCat] = (config.categoryWhitelist[wlCat] || [])
          .filter((x) => x !== conflictInfo.whitelistValue);
        saveConfig(config);
        rescanAll();
      });

      banner.appendChild(fixBlack);
      banner.appendChild(fixWhite);
    }

    banner.appendChild(dot);

    banner.addEventListener('click', (e) => {
      if (e.target === dot || e.target.classList.contains('ztf-banner-fix')) return;
      e.stopPropagation();
      e.preventDefault();
      let nowCollapsed = false;
      collapsibles.forEach((c) => {
        c.classList.toggle('ztf-collapsed');
        nowCollapsed = c.classList.contains('ztf-collapsed');
      });
      action.textContent = nowCollapsed ? '\u5c55\u5f00\u67e5\u770b' : '\u6536\u8d77';
    });

    card.insertBefore(banner, card.firstChild);
    stats.blocked++;
  }

  function markPassed(card, reason) {
    if (card.dataset.ztfStatus === 'passed-debug') return;
    card.dataset.ztfStatus = 'passed-debug';
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    const mark = document.createElement('div');
    mark.className = 'ztf-pass-mark';
    mark.textContent = reason.length > 20 ? reason.slice(0, 20) + '...' : reason;
    card.appendChild(mark);
  }

  let dotMenu = null;
  function closeDotMenu() {
    if (dotMenu) { dotMenu.remove(); dotMenu = null; }
    document.removeEventListener('click', closeDotMenu, true);
  }

  function openDotMenu(dot, card, info) {
    closeDotMenu();
    const rect = dot.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'ztf-dot-menu';
    menu.innerHTML =
      '<div class="ztf-dot-item" data-action="addKw">添加屏蔽关键词</div>' +
      '<div class="ztf-dot-item" data-action="removeKw">移除屏蔽关键词</div>' +
      '<div class="ztf-dot-item" data-action="addAuthor">添加屏蔽作者</div>' +
      '<div class="ztf-dot-item" data-action="removeAuthor">移除屏蔽作者</div>';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
    document.body.appendChild(menu);
    dotMenu = menu;

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.ztf-dot-item');
      if (!item) return;
      e.stopPropagation();
      const action = item.dataset.action;
      let changed = false;
      if (action === 'addKw') {
        const kw = window.prompt('输入要添加的屏蔽关键词：', info.title || '');
        if (kw && kw.trim()) {
          const v = kw.trim();
          const cat = getHitCategory(info);
          if (cat) {
            if (!config.categoryBlacklist) config.categoryBlacklist = {};
            if (!config.categoryBlacklist[cat.id]) config.categoryBlacklist[cat.id] = [];
            const catWhitelist = (config.categoryWhitelist && config.categoryWhitelist[cat.id]) || [];
            if (catWhitelist.includes(v)) {
              window.alert('「' + v + '」已在分类[' + cat.name + ']白名单中，不能加入黑名单');
            } else if (config.categoryBlacklist[cat.id].includes(v)) {
              window.alert('「' + v + '」已在分类[' + cat.name + ']黑名单中，无需重复添加');
            } else {
              config.categoryBlacklist[cat.id].push(v);
              saveConfig(config);
              changed = true;
            }
          } else {
            window.alert('该文章未命中任何分类，无法添加分类黑名单（关键词名单已按分类管理，请先确保分类规则覆盖该内容）');
          }
        }
      } else if (action === 'removeKw') {
        const result = classifyArticle(info);
        const text = info.title || '';
        const cat = getHitCategory(info);
        let promptMsg = '输入要移除的屏蔽关键词：';
        let defaultVal = info.title || '';
        if (cat) {
          const catBlacklist = (config.categoryBlacklist && config.categoryBlacklist[cat.id]) || [];
          const hits = catBlacklist.filter((k) => k && text.includes(k));
          if (hits.length > 0) {
            promptMsg = '分类[' + cat.name + ']命中: ' + hits.join(', ') + '\n输入要移除的词：';
            defaultVal = hits[0];
          } else if (!result.isTech) {
            promptMsg = '本文由「' + result.reason + '」屏蔽\n输入要移除的屏蔽关键词：';
          }
        } else {
          promptMsg = '该文章未命中任何分类，无分类黑名单可移除';
          defaultVal = '';
        }
        const kw = window.prompt(promptMsg, defaultVal);
        if (kw && kw.trim()) {
          const v = kw.trim();
          if (cat) {
            const arr = (config.categoryBlacklist && config.categoryBlacklist[cat.id]) || [];
            const before = arr.length;
            const newArr = arr.filter((k) => k !== v);
            if (newArr.length !== before) {
              if (!config.categoryBlacklist) config.categoryBlacklist = {};
              config.categoryBlacklist[cat.id] = newArr;
              saveConfig(config);
              changed = true;
            }
          }
        }
      } else if (action === 'addAuthor') {
        const a = window.prompt('输入要添加的屏蔽作者：', info.author || '');
        if (a && a.trim()) {
          const v = a.trim();
          if ((config.techAuthors || []).includes(v)) {
            window.alert('「' + v + '」已在作者白名单中，不能加入黑名单');
          } else {
            if (!config.nonTechAuthors) config.nonTechAuthors = [];
            if (config.nonTechAuthors.includes(v)) {
              window.alert('「' + v + '」已在作者黑名单中，无需重复添加');
            } else {
              config.nonTechAuthors.push(v);
              saveConfig(config);
              changed = true;
            }
          }
        }
      } else if (action === 'removeAuthor') {
        const a = window.prompt('输入要移除的屏蔽作者：', info.author || '');
        if (a && a.trim()) {
          const v = a.trim();
          const before = (config.nonTechAuthors || []).length;
          config.nonTechAuthors = (config.nonTechAuthors || []).filter((x) => x !== v);
          if (config.nonTechAuthors.length !== before) {
            saveConfig(config);
            changed = true;
          }
        }
      }
      closeDotMenu();
      if (changed) rescanAll();
    });

    setTimeout(() => {
      document.addEventListener('click', closeDotMenu, true);
    }, 0);
  }

  function createDotButton(card, info, isBanner) {
    const dot = document.createElement('span');
    dot.className = isBanner ? 'ztf-banner-dot' : 'ztf-title-dot';
    dot.textContent = '\u22ef';
    dot.title = '屏蔽关键词/作者管理';
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openDotMenu(dot, card, info);
    });
    return dot;
  }

  function injectDotUnblocked(card, info) {
    if (!card.dataset.ztfPosSet) {
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
      card.dataset.ztfPosSet = '1';
    }

    if (card.dataset.ztfDot) return;
    card.dataset.ztfDot = '1';
    const dot = createDotButton(card, info, false);
    card.appendChild(dot);
  }

  // === 扫描与重扫 ===
  function scanCards() {
    if (!isShieldPage()) {
      document.querySelectorAll('[data-ztf-pre-hidden]').forEach((card) => {
        card.style.visibility = '';
        delete card.dataset.ztfPreHidden;
      });
      return;
    }
    document.querySelectorAll('[data-ztf-pre-hidden]').forEach((card) => {
      card.style.visibility = '';
      delete card.dataset.ztfPreHidden;
    });
    const rawCards = querySelectorAllAny(document, SELECTORS.cards);
    const cards = rawCards.filter((card) => {
      return !rawCards.some((parent) => parent !== card && parent.contains(card));
    });

    for (const card of cards) {
      const info = extractArticleInfo(card);
      if (!info) continue;

      if (card.dataset.ztfStatus) {
        if (card.dataset.ztfStatus === 'passed') {
          injectDotUnblocked(card, info);
        }
        continue;
      }

      const result = classifyArticle(info);
      if (!result.isTech) {
        blockCard(card, info, result.conflict, result.conflictInfo, result.reason, result.category);
      } else {
        injectDotUnblocked(card, info);
        card.dataset.ztfStatus = 'passed';
        stats.passed++;
        if (result.reason.startsWith('\u6280\u672f') || result.reason.startsWith('\u4f5c\u8005')) stats.passedTech++;
        if (config.debug) markPassed(card, result.reason);
      }
    }
    updateStatsDisplay();
  }

  function rescanAll() {
    const scrollY = window.scrollY;
    document.querySelectorAll('[data-ztf-dot], [data-ztf-status]').forEach((el) => resetCardAll(el));
    stats.blocked = 0; stats.passed = 0; stats.passedTech = 0;
    scanCards();
    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
  }

  let scanTimer = null;
  function debouncedScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scanCards, SCAN_DEBOUNCE_MS);
  }

  let observer = null;
  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          for (const sel of SELECTORS.cards) {
            try { if (node.matches(sel) && !node.dataset.ztfStatus && !node.dataset.ztfPreHidden) { node.dataset.ztfPreHidden = '1'; node.style.visibility = 'hidden'; } } catch (e) {}
            if (node.querySelectorAll) {
              node.querySelectorAll(sel).forEach((card) => {
                if (!card.dataset.ztfStatus && !card.dataset.ztfPreHidden) {
                  card.dataset.ztfPreHidden = '1';
                  card.style.visibility = 'hidden';
                }
              });
            }
          }
        }
      }
      debouncedScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  let intervalId = null;
  function startInterval() {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(scanCards, SCAN_INTERVAL_MS);
  }

  let statsEl = null;
  function updateStatsDisplay() {
    if (statsEl) {
      statsEl.innerHTML =
        '\u5df2\u5c4f\u853d <b>' + stats.blocked + '</b> \u00b7 \u653e\u884c <b>' + stats.passed + '</b>' +
        ' \u00b7 \u6280\u672f\u547d\u4e2d <b>' + stats.passedTech + '</b>';
    }
  }

  const QUESTION_PATTERNS = [
    /怎么(?:评价|看待|说|做|想|看|回事|才能|会|了|办|用|选|知道|理解|处理|解决|避免|提高|优化|实现|设计)/g,
    /如何(?:评价|看待|说|做|想|看|才能|让|能|用|选|知道|理解|处理|解决|避免|提高|优化|实现|设计)/g,
    /怎样(?:评价|看待|说|做|想|看|才能|让|能|影响|用|选|知道|理解|处理|解决|避免|提高|优化|实现|设计)/g,
    /为何(?:不|要|会|能|是|没有|有)?/g,
    /为什么(?:不|要|会|能|是|没有|有|这么|那么)?/g,
    /凭什么/g,
    /难道(?:不|是|要|会|能)/g,
    /究竟(?:是|不|要|会|能|有没有|是不是|能不能)/g,
    /到底(?:是|不|要|会|能|有没有|是不是|能不能|想不想|要不要)/g,
    /敢不敢/g,
    /要不要/g,
    /会不会/g,
    /能不能/g,
    /有没有/g,
    /是不是/g,
    /是否/g,
    /能否/g,
    /可否/g,
    /值不值得/g,
    /应不应该/g,
    /该不该/g,
    /你(?:这一生|曾经|觉得|认为|怎么|如何|为什么|有没有|会|能|敢|想|看|说|做|知道|理解|感受|体验|经历|看法)/g,
    /您(?:觉得|认为|怎么看|如何|为什么|有没有|会|能|想|看|说|做)/g,
    /大家(?:怎么看|如何|觉得|认为|有没有|是不是|会不会)/g,
    /我们(?:该怎么|该如何|为什么|要不要|是不是)/g,
    /如果说/g,
    /假如(?:说|你|我|他|她|有|是|不)/g,
    /要是(?:你|我|他|她|有|是|不|能|会)/g,
    /如果(?:你|我|他|她|有|是|不|能|会|说)/g,
    /万一/g,
    /看一看/g, /试一试/g, /想一想/g, /说一说/g, /听一听/g, /走一走/g, /聊一聊/g,
    /看看/g, /试试/g, /想想/g, /说说/g, /听听/g, /走走/g, /瞧瞧/g, /聊聊/g,
    /一生/g, /曾经/g, /影响/g, /看法/g, /感受/g, /体验/g, /经历/g, /人生/g, /故事/g, /回忆/g,
    /感悟/g, /心得/g, /体会/g, /教训/g, /遗憾/g, /后悔/g,
    /喜欢/g, /难绷/g, /绷不住/g, /破防/g, /emo/g,
  ];

  function buildPatternsFromDefs(defs) {
    const list = [];
    for (const d of defs) {
      try {
        if (d && typeof d.pattern === 'string' && typeof d.flags === 'string') {
          list.push(new RegExp(d.pattern, d.flags));
        }
      } catch (e) { /* skip invalid */ }
    }
    return list.length > 0 ? list : null;
  }

  let activeCategories = [];
  try {
    const savedCats = GM_getValue('ztf_categories', null);
    if (Array.isArray(savedCats) && savedCats.length > 0) {
      const allNew = savedCats.every((c) => c && NEW_CAT_IDS.includes(c.id));
      if (allNew) {
        activeCategories = savedCats;
      } else {
        try { GM_setValue('ztf_categories', null); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
  if (activeCategories.length === 0) {
    fetchRemoteFile('categories.json', (res) => {
      if (res.ok && Array.isArray(res.data.categories)) {
        activeCategories = res.data.categories;
        try { GM_setValue('ztf_categories', activeCategories); } catch (e) { /* ignore */ }
      }
    });
  }

  let activeQuestionPatterns = QUESTION_PATTERNS;
  try {
    const savedGuides = GM_getValue('ztf_question_patterns', null);
    if (Array.isArray(savedGuides)) {
      const built = buildPatternsFromDefs(savedGuides);
      if (built) activeQuestionPatterns = built;
    }
  } catch (e) { /* ignore */ }

  function extractNonTechCandidates() {
    const rawCards = querySelectorAllAny(document, SELECTORS.cards);
    const cards = rawCards.filter((card) => {
      return !rawCards.some((parent) => parent !== card && parent.contains(card));
    });
    const counts = new Map();
    function addCandidate(word) {
      const w = word.trim();
      if (w.length === 0) return;
      counts.set(w, (counts.get(w) || 0) + 1);
    }

    for (const card of cards) {
      const info = extractArticleInfo(card);
      if (!info || !info.title) continue;
      const title = info.title;

      for (const re of activeQuestionPatterns) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(title)) !== null) {
          addCandidate(m[0]);
        }
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([word, count]) => ({ word, count }));
  }

  function openCandidateDialog(textarea) {
    injectStyles();
    const candidates = extractNonTechCandidates();
    if (candidates.length === 0) {
      window.alert('当前页面未扫描到类型词（请在知乎首页/热榜等页面打开配置）');
      return;
    }
    if (document.getElementById('ztf-candidate-dialog')) return;

    const mask = document.createElement('div');
    mask.className = 'ztf-panel-mask';
    mask.id = 'ztf-candidate-mask';

    const dialog = document.createElement('div');
    dialog.className = 'ztf-candidate-dialog';
    dialog.id = 'ztf-candidate-dialog';

    dialog.innerHTML =
      '<div class="ztf-panel-header">' +
        '<span class="ztf-panel-title">扫描类型词 — 勾选加入关键词黑名单</span>' +
        '<button class="ztf-panel-close" id="ztf-cand-close">\u00d7</button>' +
      '</div>' +
      '<div class="ztf-candidate-body" id="ztf-cand-body"></div>' +
      '<div class="ztf-panel-footer">' +
        '<span class="ztf-stats">共 ' + candidates.length + ' 个候选词</span>' +
        '<div>' +
          '<button class="ztf-btn" id="ztf-cand-cancel">\u53d6\u6d88</button>' +
          '<button class="ztf-btn ztf-btn-primary" id="ztf-cand-add">\u52a0\u5165\u9ed1\u540d\u5355</button>' +
        '</div>' +
      '</div>';

    const closeCandidateDialog = () => { mask.remove(); dialog.remove(); };
    mask.addEventListener('click', closeCandidateDialog);
    document.body.appendChild(mask);
    document.body.appendChild(dialog);

    const body = dialog.querySelector('#ztf-cand-body');
    for (const c of candidates) {
      const item = document.createElement('label');
      item.className = 'ztf-candidate-item';
      item.innerHTML =
        '<input type="checkbox" value="' + escapeHtml(c.word) + '">' +
        '<span class="ztf-candidate-word">' + escapeHtml(c.word) + '</span>' +
        '<span class="ztf-candidate-count">\u00d7' + c.count + '</span>';
      body.appendChild(item);
    }

    dialog.querySelector('#ztf-cand-close').addEventListener('click', closeCandidateDialog);
    dialog.querySelector('#ztf-cand-cancel').addEventListener('click', closeCandidateDialog);
    dialog.querySelector('#ztf-cand-add').addEventListener('click', () => {
      const checked = dialog.querySelectorAll('input[type="checkbox"]:checked');
      if (checked.length === 0) { closeCandidateDialog(); return; }
      const existing = textarea.value.split(NEWLINE).map((s) => s.trim()).filter((s) => s.length > 0);
      const set = new Set(existing);
      let added = 0;
      checked.forEach((cb) => {
        const w = cb.value;
        if (!set.has(w)) { set.add(w); added++; }
      });
      textarea.value = Array.from(set).join(NEWLINE);
      closeCandidateDialog();
      if (added > 0) window.alert('\u5df2\u52a0\u5165 ' + added + ' \u4e2a\u5173\u952e\u8bcd\u5230\u9ed1\u540d\u5355\uff08\u9700\u70b9\u51fb\u201c\u4fdd\u5b58\u201d\u751f\u6548\uff09');
    });
  }

  // === 远程同步 ===
  function fetchRemoteFile(fileName, onDone) {
    let idx = 0;
    function tryNext(prevError) {
      if (idx >= REMOTE_RULES_BASE_URLS.length) {
        onDone && onDone({ ok: false, error: prevError || 'network' });
        return;
      }
      const url = REMOTE_RULES_BASE_URLS[idx++] + fileName + '?_=' + Date.now();
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          timeout: 8000,
          onload: (resp) => {
            if (resp.status >= 200 && resp.status < 300) {
              try {
                const data = JSON.parse(resp.responseText);
                onDone && onDone({ ok: true, data });
                return;
              } catch (e) { /* parse error, try next */ }
            }
            tryNext('HTTP ' + resp.status);
          },
          onerror: () => { tryNext('network'); },
          ontimeout: () => { tryNext('timeout'); },
        });
      } catch (e) {
        tryNext('GM_xmlhttpRequest unavailable');
      }
    }
    tryNext(null);
  }


  function getQuestionPatterns() {
    try {
      const saved = GM_getValue('ztf_question_patterns', null);
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch (e) { /* ignore */ }
    return activeQuestionPatterns.map((re) => ({ pattern: re.source, flags: re.flags }));
  }

  // === 导出导入 ===
  function exportLocalConfig() {
    const cats = activeCategories.map((c) => ({
      id: c.id,
      name: c.name,
      whitelist: (config.categoryWhitelist && config.categoryWhitelist[c.id]) || [],
      blacklist: (config.categoryBlacklist && config.categoryBlacklist[c.id]) || [],
    }));
    const data = {
      version: '2.0.0',
      updatedAt: new Date().toISOString().slice(0, 10),
      source: 'local-export',
      categories: cats,
      techAuthors: config.techAuthors || [],
      nonTechAuthors: config.nonTechAuthors || [],
      questionPatterns: getQuestionPatterns(),
      defaultAction: config.defaultAction || 'high',
      activeCategoryId: config.activeCategoryId || 'tech',
      debug: !!config.debug,
      messageShieldEnabled: config.messageShieldEnabled !== false,
      questionShieldEnabled: config.questionShieldEnabled !== false,
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ztf-config-' + data.updatedAt + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }


  function importLocalConfig(file, onDone) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (Array.isArray(data.categories)) {
          if (!config.categoryWhitelist) config.categoryWhitelist = {};
          if (!config.categoryBlacklist) config.categoryBlacklist = {};
          for (const c of data.categories) {
            if (c && typeof c.id === 'string') {
              if (Array.isArray(c.whitelist)) {
                config.categoryWhitelist[c.id] = c.whitelist.filter((v) => v && typeof v === 'string');
              }
              if (Array.isArray(c.blacklist)) {
                config.categoryBlacklist[c.id] = c.blacklist.filter((v) => v && typeof v === 'string');
              }
            }
          }
        }
        if (typeof data.defaultAction === 'string') {
          const da = data.defaultAction;
          if (da === 'pass') config.defaultAction = 'low';
          else if (da === 'block') config.defaultAction = 'high';
          else if (['low', 'basic', 'high'].includes(da)) config.defaultAction = da;
        }
        if (typeof data.activeCategoryId === 'string' && data.activeCategoryId) {
          config.activeCategoryId = data.activeCategoryId;
        }
        if (Array.isArray(data.techAuthors)) config.techAuthors = data.techAuthors.filter((v) => v && typeof v === 'string');
        if (Array.isArray(data.nonTechAuthors)) config.nonTechAuthors = data.nonTechAuthors.filter((v) => v && typeof v === 'string');
        if (typeof data.debug === 'boolean') config.debug = data.debug;
        if (typeof data.messageShieldEnabled === 'boolean') config.messageShieldEnabled = data.messageShieldEnabled;
        if (typeof data.questionShieldEnabled === 'boolean') config.questionShieldEnabled = data.questionShieldEnabled;
        if (Array.isArray(data.questionPatterns)) {
          const built = buildPatternsFromDefs(data.questionPatterns);
          if (built) {
            activeQuestionPatterns = built;
            try { GM_setValue('ztf_question_patterns', data.questionPatterns); } catch (e) { /* ignore */ }
          }
        }
        saveConfig(config);

        onDone && onDone({ ok: true });
      } catch (e) {
        onDone && onDone({ ok: false, error: e.message || 'parse error' });
      }
    };
    reader.onerror = () => { onDone && onDone({ ok: false, error: 'read error' }); };
    reader.readAsText(file);
  }

  // === 配置面板 ===
  function openConfigPanel() {
    injectStyles();
    if (document.getElementById('ztf-panel')) return;

    const mask = document.createElement('div');
    mask.className = 'ztf-panel-mask';
    mask.id = 'ztf-panel-mask';

    const panel = document.createElement('div');
    panel.className = 'ztf-panel';
    panel.id = 'ztf-panel';

    const tabs = [
      { id: 'techAuthors', label: '作者白名单' },
      { id: 'nonTechAuthors', label: '作者黑名单' },
      { id: 'categoryRules', label: '分类规则' },
      { id: 'settings', label: '设置' },
    ];

    panel.innerHTML =
      '<div class="ztf-panel-header">' +
        '<span class="ztf-panel-title">zh文章屏蔽器 — 配置</span>' +
        '<button class="ztf-panel-close" id="ztf-close">\u00d7</button>' +
      '</div>' +
      '<div class="ztf-panel-tabs" id="ztf-tabs">' +
        tabs.map((t, i) =>
          '<button class="ztf-tab' + (i === 0 ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>'
        ).join('') +
      '</div>' +
      '<div class="ztf-panel-body" id="ztf-body"></div>' +
      '<div class="ztf-panel-footer">' +
        '<span class="ztf-stats" id="ztf-stats"></span>' +
        '<div>' +
          '<button class="ztf-btn" id="ztf-reset">\u6062\u590d\u9ed8\u8ba4</button>' +
          '<button class="ztf-btn ztf-btn-primary" id="ztf-save">\u4fdd\u5b58</button>' +
        '</div>' +
      '</div>';

    mask.addEventListener('click', closeConfigPanel);
    document.body.appendChild(mask);
    document.body.appendChild(panel);

    statsEl = panel.querySelector('#ztf-stats');
    updateStatsDisplay();

    const body = panel.querySelector('#ztf-body');

    tabs.forEach((t) => {
      const div = document.createElement('div');
      div.className = 'ztf-tab-content' + (t.id === tabs[0].id ? ' active' : '');
      div.dataset.content = t.id;

      if (t.id === 'settings') {
        const catOpts = activeCategories.map((c) =>
          '<option value="' + c.id + '"' + (config.activeCategoryId === c.id ? ' selected' : '') + '>' + c.name + '</option>'
        ).join('');
        const actionOpts = [
          { v: 'low', l: '低 (放行)' },
          { v: 'basic', l: '中 (基础：问题正则屏蔽，其余放行)' },
          { v: 'high', l: '高 (严格：未命中即屏蔽)' },
        ].map((o) => '<option value="' + o.v + '"' + (config.defaultAction === o.v ? ' selected' : '') + '>' + o.l + '</option>').join('');
        div.innerHTML =
          '<div class="ztf-settings-row">' +
            '<div><div class="ztf-settings-label">当前分类</div>' +
            '<div class="ztf-settings-desc">选择生效的分类规则</div></div>' +
            '<select class="ztf-select" id="ztf-active-cat">' + catOpts + '</select>' +
          '</div>' +
          '<div class="ztf-settings-row">' +
            '<div><div class="ztf-settings-label">等级</div>' +
            '<div class="ztf-settings-desc">未命中规则时的默认行为</div></div>' +
            '<select class="ztf-select" id="ztf-default-action">' + actionOpts + '</select>' +
          '</div>' +
          '<div class="ztf-settings-row">' +
            '<div><div class="ztf-settings-label">屏蔽私信未读提示</div></div>' +
            '<div class="ztf-toggle' + (config.messageShieldEnabled !== false ? ' on' : '') + '" id="ztf-msg-toggle"></div>' +
          '</div>' +
          '<div class="ztf-settings-row">' +
            '<div><div class="ztf-settings-label">调试模式</div>' +
            '<div class="ztf-settings-desc">放行文章也标记命中原因</div></div>' +
            '<div class="ztf-toggle' + (config.debug ? ' on' : '') + '" id="ztf-debug-toggle"></div>' +
          '</div>' +
          '<div class="ztf-settings-row">' +
            '<div><div class="ztf-settings-label">同步分类规则</div>' +
            '<div class="ztf-settings-desc">从远程同步当前分类的黑白名单</div></div>' +
            '<button class="ztf-btn ztf-btn-primary" id="ztf-sync-cats">同步</button>' +
          '</div>' +
          '<div class="ztf-settings-row"><div class="ztf-settings-label" id="ztf-remote-status" style="color:var(--ztf-muted);font-weight:normal;"></div></div>' +
          '<div class="ztf-settings-row">' +
            '<div><div class="ztf-settings-label">配置备份</div></div>' +
            '<div class="ztf-btn-group">' +
              '<button class="ztf-btn" id="ztf-export-config">导出</button>' +
              '<button class="ztf-btn" id="ztf-import-config">导入</button>' +
              '<input type="file" id="ztf-import-file" accept="application/json,.json" style="display:none;">' +
            '</div>' +
          '</div>';
      } else if (t.id === 'categoryRules') {
        let html = '';
        const cats = activeCategories.length > 0 ? activeCategories : [];
        const activeCatId = config.activeCategoryId || (cats[0] && cats[0].id) || '';
        const c = cats.find((cat) => cat.id === activeCatId);
        if (c) {
          const wl = (config.categoryWhitelist && config.categoryWhitelist[c.id]) || [];
          const bl = (config.categoryBlacklist && config.categoryBlacklist[c.id]) || [];
          html =
            '<fieldset class="ztf-cat-fieldset">' +
              '<legend class="ztf-cat-legend">' + c.name + '</legend>' +
              '<label class="ztf-field-label">白名单（每行一个，命中则放行）</label>' +
              '<textarea class="ztf-textarea" data-cat-wl="' + c.id + '" style="margin-bottom:10px;">' + escapeHtml(wl.join(NEWLINE)) + '</textarea>' +
              '<label class="ztf-field-label">黑名单（每行一个，命中则屏蔽）</label>' +
              '<textarea class="ztf-textarea" data-cat-bl="' + c.id + '">' + escapeHtml(bl.join(NEWLINE)) + '</textarea>' +
            '</fieldset>';
        } else {
          html = '<p class="ztf-hint">暂无分类，请到设置中同步分类规则。</p>';
        }
        div.innerHTML = html;
      } else {
        const value = config[t.id] || [];
        div.innerHTML =
          '<label class="ztf-field-label">' + t.label + '\uff08\u6bcf\u884c\u4e00\u4e2a\uff0c\u7a7a\u884c\u5ffd\u7565\uff09</label>' +

          '<textarea class="ztf-textarea" data-field="' + t.id + '">' +
            escapeHtml(value.join(NEWLINE)) +
          '</textarea>' +

          (t.id === 'techAuthors'
            ? '<p class="ztf-hint">填写知乎用户名（主页显示的昵称），精确或包含匹配均可。命中则放行。</p>'
            : '') +
          (t.id === 'nonTechAuthors'
            ? '<p class="ztf-hint">填写知乎用户名（主页显示的昵称），精确或包含匹配均可。命中则屏蔽。</p>'
            : '');
      }
      body.appendChild(div);
    });

    panel.querySelector('#ztf-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.ztf-tab');
      if (!btn) return;
      panel.querySelectorAll('.ztf-tab').forEach((t) => t.classList.remove('active'));
      btn.classList.add('active');
      body.querySelectorAll('.ztf-tab-content').forEach((c) => {
        c.classList.toggle('active', c.dataset.content === btn.dataset.tab);
      });
    });



    const activeCatSelect = panel.querySelector('#ztf-active-cat');
    if (activeCatSelect) {
      activeCatSelect.addEventListener('change', () => {
        config.activeCategoryId = activeCatSelect.value;
        const catContent = body.querySelector('.ztf-tab-content[data-content="categoryRules"]');
        if (catContent) {
          const cats = activeCategories.length > 0 ? activeCategories : [];
          const c = cats.find((cat) => cat.id === config.activeCategoryId);
          if (c) {
            const wl = (config.categoryWhitelist && config.categoryWhitelist[c.id]) || [];
            const bl = (config.categoryBlacklist && config.categoryBlacklist[c.id]) || [];
            catContent.innerHTML =
              '<fieldset class="ztf-cat-fieldset">' +
                '<legend class="ztf-cat-legend">' + c.name + '</legend>' +
                '<label class="ztf-field-label">白名单（每行一个，命中则放行）</label>' +
                '<textarea class="ztf-textarea" data-cat-wl="' + c.id + '" style="margin-bottom:10px;">' + escapeHtml(wl.join(NEWLINE)) + '</textarea>' +
                '<label class="ztf-field-label">黑名单（每行一个，命中则屏蔽）</label>' +
                '<textarea class="ztf-textarea" data-cat-bl="' + c.id + '">' + escapeHtml(bl.join(NEWLINE)) + '</textarea>' +
              '</fieldset>';
          } else {
            catContent.innerHTML = '<p class="ztf-hint">暂无分类，请到设置中同步分类规则。</p>';
          }
        }
      });
    }

    const debugToggle = panel.querySelector('#ztf-debug-toggle');
    if (debugToggle) {
      debugToggle.addEventListener('click', () => {
        debugToggle.classList.toggle('on');
      });
    }

    const msgToggle = panel.querySelector('#ztf-msg-toggle');
    if (msgToggle) {
      msgToggle.addEventListener('click', () => {
        msgToggle.classList.toggle('on');
      });
    }

    const syncCatsBtn = panel.querySelector('#ztf-sync-cats');
    if (syncCatsBtn) {
      syncCatsBtn.addEventListener('click', () => {
        const activeCatId = config.activeCategoryId || '';
        const activeCat = activeCategories.find((c) => c.id === activeCatId);
        if (!activeCat) {
          const statusEl = panel.querySelector('#ztf-remote-status');
          if (statusEl) statusEl.textContent = '请先选择当前分类。';
          return;
        }
        syncCatsBtn.disabled = true;
        const oldText = syncCatsBtn.textContent;
        syncCatsBtn.textContent = '同步中...';
        fetchRemoteFile('categories.json', (res) => {
          if (res.ok && Array.isArray(res.data.categories)) {
            const remoteCat = res.data.categories.find((c) => c.id === activeCatId);
            if (remoteCat) {
              if (!config.categoryWhitelist) config.categoryWhitelist = {};
              if (!config.categoryBlacklist) config.categoryBlacklist = {};
              config.categoryWhitelist[activeCatId] = Array.isArray(remoteCat.whitelist) ? remoteCat.whitelist.filter((v) => v && typeof v === 'string') : [];
              config.categoryBlacklist[activeCatId] = Array.isArray(remoteCat.blacklist) ? remoteCat.blacklist.filter((v) => v && typeof v === 'string') : [];
              saveConfig(config);
              const statusEl = panel.querySelector('#ztf-remote-status');
              if (statusEl) statusEl.textContent = '同步成功，已更新「' + remoteCat.name + '」分类规则。';
              const catContent = body.querySelector('.ztf-tab-content[data-content="categoryRules"]');
              if (catContent) {
                const wl = config.categoryWhitelist[activeCatId] || [];
                const bl = config.categoryBlacklist[activeCatId] || [];
                catContent.innerHTML =
                  '<fieldset class="ztf-cat-fieldset">' +
                    '<legend class="ztf-cat-legend">' + remoteCat.name + '</legend>' +
                    '<label class="ztf-field-label">白名单（每行一个，命中则放行）</label>' +
                    '<textarea class="ztf-textarea" data-cat-wl="' + activeCatId + '" style="margin-bottom:10px;">' + escapeHtml(wl.join(NEWLINE)) + '</textarea>' +
                    '<label class="ztf-field-label">黑名单（每行一个，命中则屏蔽）</label>' +
                    '<textarea class="ztf-textarea" data-cat-bl="' + activeCatId + '">' + escapeHtml(bl.join(NEWLINE)) + '</textarea>' +
                  '</fieldset>';
              }
            } else {
              const statusEl = panel.querySelector('#ztf-remote-status');
              if (statusEl) statusEl.textContent = '远程未找到该分类。';
            }
          } else {
            const statusEl = panel.querySelector('#ztf-remote-status');
            if (statusEl) statusEl.textContent = '同步失败：' + res.error;
          }
          syncCatsBtn.disabled = false;
          syncCatsBtn.textContent = oldText;
        });
        fetchRemoteFile('question-patterns.json', (res) => {
          if (res.ok && Array.isArray(res.data.questionPatterns)) {
            const built = buildPatternsFromDefs(res.data.questionPatterns);
            if (built) {
              activeQuestionPatterns = built;
              try { GM_setValue('ztf_question_patterns', res.data.questionPatterns); } catch (e) { /* ignore */ }
            }
          }
        });
      });
    }


    const exportCfgBtn = panel.querySelector('#ztf-export-config');
    if (exportCfgBtn) {
      exportCfgBtn.addEventListener('click', exportLocalConfig);
    }
    const importCfgBtn = panel.querySelector('#ztf-import-config');
    const importFileInput = panel.querySelector('#ztf-import-file');
    if (importCfgBtn && importFileInput) {
      importCfgBtn.addEventListener('click', () => { importFileInput.value = ''; importFileInput.click(); });
      importFileInput.addEventListener('change', () => {
        const file = importFileInput.files && importFileInput.files[0];
        if (!file) return;
        importLocalConfig(file, (res) => {
          if (res.ok) {
            closeConfigPanel();
            rescanAll();
            openConfigPanel();
            window.alert('导入成功，规则已覆盖生效。');
          } else {
            window.alert('导入失败：' + res.error);
          }
        });
      });
    }


    panel.querySelector('#ztf-close').addEventListener('click', closeConfigPanel);

    panel.querySelector('#ztf-reset').addEventListener('click', () => {
      config = deepClone(DEFAULT_CONFIG);
      saveConfig(config);
      closeConfigPanel();
      openConfigPanel();
    });

    panel.querySelector('#ztf-save').addEventListener('click', () => {
      const textareas = panel.querySelectorAll('textarea[data-field]');
      textareas.forEach((ta) => {
        const field = ta.dataset.field;
        const _arr = ta.value.split(NEWLINE).map((s) => s.trim()).filter((s) => s.length > 0);
        config[field] = Array.from(new Set(_arr));
      });

      const authorConflict = (config.nonTechAuthors || []).filter((a) => (config.techAuthors || []).includes(a));
      if (authorConflict.length > 0) {
        config.nonTechAuthors = (config.nonTechAuthors || []).filter((a) => !authorConflict.includes(a));
        window.alert('以下作者同时在黑白名单，已从黑名单移除（白名单优先）：\n' + authorConflict.join('、'));
      }
      const actionSelect = panel.querySelector('#ztf-default-action');
      if (actionSelect && ['low', 'basic', 'high'].includes(actionSelect.value)) {
        config.defaultAction = actionSelect.value;
      }
      const activeCatSelect2 = panel.querySelector('#ztf-active-cat');
      if (activeCatSelect2 && activeCatSelect2.value) {
        config.activeCategoryId = activeCatSelect2.value;
      }
      if (debugToggle) config.debug = debugToggle.classList.contains('on');
      if (msgToggle) config.messageShieldEnabled = msgToggle.classList.contains('on');
      const catWlTextareas = panel.querySelectorAll('textarea[data-cat-wl]');
      catWlTextareas.forEach((ta) => {
        const catId = ta.dataset.catWl;
        const arr = ta.value.split(NEWLINE).map((s) => s.trim()).filter((s) => s.length > 0);
        if (!config.categoryWhitelist) config.categoryWhitelist = {};
        config.categoryWhitelist[catId] = Array.from(new Set(arr));
      });
      const catBlTextareas = panel.querySelectorAll('textarea[data-cat-bl]');
      catBlTextareas.forEach((ta) => {
        const catId = ta.dataset.catBl;
        const arr = ta.value.split(NEWLINE).map((s) => s.trim()).filter((s) => s.length > 0);
        if (!config.categoryBlacklist) config.categoryBlacklist = {};
        config.categoryBlacklist[catId] = Array.from(new Set(arr));
      });
      saveConfig(config);
      document.documentElement.dataset.ztfMsgShield = config.messageShieldEnabled !== false ? '1' : '0';
      document.querySelectorAll('[data-ztf-status]').forEach((el) => resetCardAll(el));
      stats.blocked = 0; stats.passed = 0; stats.passedTech = 0;
      closeConfigPanel();
      scanCards();
    });
  }

  function closeConfigPanel() {
    const panel = document.getElementById('ztf-panel');
    const mask = document.getElementById('ztf-panel-mask');
    if (panel) panel.remove();
    if (mask) mask.remove();
    statsEl = null;
  }

  const FAB_PROXIMITY = 80;
  const FAB_DRAG_THRESHOLD = 5;
  const FAB_POS_KEY = 'ztf_fab_pos_v1';

  // === 悬浮入口与初始化 ===
  function injectFab() {
    if (document.getElementById('ztf-fab')) return;
    const fab = document.createElement('button');
    fab.className = 'ztf-fab';
    fab.id = 'ztf-fab';
    fab.title = '配置过滤规则（可拖拽）';
    fab.textContent = '\u2691';

    let pos = null;
    try { pos = GM_getValue(FAB_POS_KEY, null); } catch (e) { /* ignore */ }
    const initX = (pos && typeof pos.x === 'number') ? pos.x : (window.innerWidth - 56);
    const initY = (pos && typeof pos.y === 'number') ? pos.y : (window.innerHeight - 56);
    fab.style.left = initX + 'px';
    fab.style.top = initY + 'px';
    document.body.appendChild(fab);

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;
    let hideTimer = null;

    function showFab() {
      clearTimeout(hideTimer);
      fab.classList.add('show');
    }

    function hideFabSoon() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!dragging && !document.getElementById('ztf-panel')) fab.classList.remove('show');
      }, 400);
    }

    document.addEventListener('mousemove', (e) => {
      if (dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > FAB_DRAG_THRESHOLD) moved = true;
        fab.style.left = (e.clientX - offsetX) + 'px';
        fab.style.top = (e.clientY - offsetY) + 'px';
        return;
      }
      const r = fab.getBoundingClientRect();
      const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (dist < FAB_PROXIMITY) showFab(); else hideFabSoon();
    });

    fab.addEventListener('mousedown', (e) => {
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const r = fab.getBoundingClientRect();
      offsetX = e.clientX - r.left;
      offsetY = e.clientY - r.top;
      fab.classList.add('dragging');
      showFab();
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      fab.classList.remove('dragging');
      if (moved) {
        try {
          GM_setValue(FAB_POS_KEY, { x: parseInt(fab.style.left, 10), y: parseInt(fab.style.top, 10) });
        } catch (e) { /* ignore */ }
      } else {
        openConfigPanel();
      }
    });

    window.addEventListener('resize', () => {
      const r = fab.getBoundingClientRect();
      let x = r.left;
      let y = r.top;
      if (x + 40 > window.innerWidth) x = window.innerWidth - 56;
      if (y + 40 > window.innerHeight) y = window.innerHeight - 56;
      if (x < 0) x = 8;
      if (y < 0) y = 8;
      fab.style.left = x + 'px';
      fab.style.top = y + 'px';
    });
  }

  function isShieldPage() {
    const p = location.pathname;
    return p === '/' || p === '/hot' || p === '/column-square' || p === '/ring-feeds';
  }

  function init() {
    injectStyles();
    updateBannerTheme();
    setTimeout(updateBannerTheme, 1000);
    try {
      new MutationObserver(updateBannerTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-color-mode', 'class'] });
    } catch (e) { /* ignore */ }
    injectFab();
    if (isShieldPage()) {
      scanCards();
      startObserver();
      startInterval();
    }


  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();