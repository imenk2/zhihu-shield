// ==UserScript==
// @name         zh技术文章屏蔽器
// @name:en      Zhihu Tech Article Filter
// @namespace    https://github.com/imenk2/zhihu-shield
// @version      1.2.0
// @description  自动屏蔽zh推荐栏非技术类文章，支持话题/作者/关键词/标题多维度黑白名单过滤，标题前圆点快速加黑名单
// @author       imenk2
// @match        https://www.zhihu.com/*
// @match        https://zhihu.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
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
  const MAX_TITLE_DISPLAY = 15;
  const CONFIG_KEY = 'ztf_config_v1';
  const NEWLINE = String.fromCharCode(10);

  const SELECTORS = {
    cards: [
      '.ContentItem[data-zop]',
      '.TopstoryItem',
      'div[class*="TopstoryItem"]',
      '.List-item',
      'div[class*="Feed"] div[class*="Card"]',
    ],
    title: [
      '.ContentItem-title',
      'h2.ContentItem-title',
      'h2',
      '[itemprop="headline"]',
      '.RichContent .ContentItem-title',
    ],
    author: [
      '.AuthorInfo-name',
      '.UserLink-link',
      'meta[itemprop="author"]',
    ],
    summary: [
      '.RichContent-inner',
      '.CopyrightRichText-richText',
      '.RichText',
      '.ContentItem-summary',
    ],
    topics: [
      '.TopicLink',
      'a[class*="TopicLink"]',
      '.ContentItem-title + div a[class*="Topic"]',
      'a[data-za-detail-view-path-module="TopicItem"]',
    ],
    content: [
      '.ContentItem-content',
      '.RichContent',
      '.ContentItem',
    ],
  };

  const DEFAULT_CONFIG = {
    titleBlacklist: [],
    techKeywords: [
      '编程', '代码', '算法', '数据结构', '前端', '后端', '全栈', '程序员', '开发者', '开发',
      'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'C++', 'C#', 'Kotlin', 'Swift',
      'React', 'Vue', 'Angular', 'Svelte', 'Node', 'Deno', 'Bun', 'NestJS', 'Next.js',
      '数据库', 'MySQL', 'Redis', 'MongoDB', 'PostgreSQL', 'SQLite', 'ElasticSearch', 'SQL',
      'Linux', 'Unix', 'Shell', 'Bash', '运维', 'DevOps', 'Docker', 'Kubernetes', 'K8s', 'Nginx',
      'AI', '人工智能', '机器学习', '深度学习', '神经网络', 'LLM', 'GPT', 'Transformer', 'PyTorch', 'TensorFlow',
      '计算机', '操作系统', '编译原理', '计算机网络', '分布式', '微服务', '并发', '多线程',
      'Git', 'GitHub', 'GitLab', '开源', '框架', 'API', 'HTTP', 'TCP', 'UDP', 'WebSocket',
      '前端工程化', 'Webpack', 'Vite', 'Rollup', '性能优化', '重构', '设计模式', 'Clean Code',
      '安全', '密码学', '渗透', '漏洞', 'SQL注入', 'XSS', 'CSRF',
      '游戏开发', 'Unity', 'Unreal', '图形学', 'Shader', '渲染', 'OpenGL', 'Vulkan', 'DirectX',
      '嵌入式', '单片机', 'STM32', 'Arduino', 'ESP32', 'Raspberry', 'FPGA', 'Verilog', '硬件',
      '数学', '线性代数', '概率', '统计学', '量化', '算法竞赛', 'LeetCode', 'Codeforces',
      '区块链', '智能合约', 'Solidity', 'Web3',
      '爬虫', '正则', 'AST', 'GC', '内存管理', '协程', '异步',
    ],
    nonTechKeywords: [
      '情感', '爱情', '恋爱', '分手', '婚姻', '相亲', '出轨', '前任', '暗恋', '表白',
      '星座', '塔罗', '占星', '算命', '风水', '八字', '生肖',
      '八卦', '娱乐', '明星', '偶像', '粉丝', '综艺', '电视剧', '电影', '追剧', '演唱会', '选秀',
      '时政', '政治', '政策', '国际', '外交', '军事', '战争', '选举',
      '养生', '健康', '中医', '西医', '减肥', '健身', '食疗', '保健品', '长寿',
      '美妆', '护肤', '穿搭', '时尚', '奢侈品', '口红', '粉底',
      '美食', '菜谱', '旅游', '旅行', '攻略', '摄影', '宠物', '猫', '狗',
      '游戏', '动漫', '漫画', '动画', '小说', '网文', '番剧', 'cosplay',
      '历史', '哲学', '文学', '艺术', '诗歌', '散文',
      '心理', '抑郁', '焦虑', '心理咨询', '原生家庭',
      '育儿', '亲子', '教育', '高考', '考研', '留学', '雅思', '托福', '四六级',
      '社会', '热点', '事件', '新闻', '评论', '舆论',
      '股票', '基金', '理财', '房产', '经济', '通胀', '汇率', '保险',
      '汽车', '驾照', '电动车', '手机评测',
      '节日', '过年', '春节', '中秋', '情人节',
    ],
    techAuthors: [],
    techTopics: [
      '编程', '计算机科学', '软件工程', '算法与数据结构', '程序员',
      '前端开发', '后端开发', '人工智能', '机器学习', '深度学习',
      '数据库', '操作系统', '计算机网络', '信息安全', '密码学',
      '编译器', 'Linux', '开源软件', 'GitHub', 'Git',
      '数学', '统计学', '物理学', '电子工程',
    ],
    nonTechTopics: [
      '情感', '星座', '娱乐', '时尚', '美食', '旅游',
      '摄影', '宠物', '游戏', '动漫', '历史', '哲学',
      '文学', '艺术', '心理学', '教育', '社会', '时事',
      '健康', '养生', '汽车', '房产', '理财',
    ],
    defaultAction: 'pass',
    debug: false,
  };

  const stats = { blocked: 0, passed: 0, passedTech: 0 };

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

  function extractArticleInfo(card) {
    let title = '';
    let author = '';

    const zopRaw = card.getAttribute('data-zop');
    if (zopRaw) {
      try {
        const zop = JSON.parse(zopRaw);
        if (zop && typeof zop.title === 'string') title = zop.title.trim();
        if (zop && typeof zop.authorName === 'string') author = zop.authorName.trim();
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

    const topicEls = querySelectorAllAny(card, SELECTORS.topics);
    const topics = topicEls
      .map((el) => (el.innerText || el.textContent || '').trim())
      .filter((t) => t.length > 0);

    if (!title && !summary) return null;
    return { title, author, summary, topics };
  }

  function classifyArticle(info) {
    const { title, summary, author, topics } = info;
    const text = title + ' ' + summary;

    if (title && config.titleBlacklist && config.titleBlacklist.length > 0) {
      for (const bt of config.titleBlacklist) {
        if (bt && title.includes(bt)) {
          return { isTech: false, reason: '标题黑名单' };
        }
      }
    }

    if (author && config.techAuthors.length > 0) {
      for (const a of config.techAuthors) {
        if (a && (author === a || author.includes(a) || a.includes(author))) {
          return { isTech: true, reason: '作者白名单: ' + author };
        }
      }
    }

    if (topics.length > 0) {
      for (const topic of topics) {
        for (const t of config.techTopics) {
          if (t && (topic.includes(t) || t.includes(topic))) {
            return { isTech: true, reason: '技术话题: ' + topic };
          }
        }
      }
      for (const topic of topics) {
        for (const t of config.nonTechTopics) {
          if (t && (topic.includes(t) || t.includes(topic))) {
            return { isTech: false, reason: '非技术话题: ' + topic };
          }
        }
      }
    }

    const lowerText = text.toLowerCase();
    for (const kw of config.techKeywords) {
      if (kw && lowerText.includes(kw.toLowerCase())) {
        return { isTech: true, reason: '技术关键词: ' + kw };
      }
    }

    for (const kw of config.nonTechKeywords) {
      if (kw && text.includes(kw)) {
        return { isTech: false, reason: '非技术关键词: ' + kw };
      }
    }

    return {
      isTech: config.defaultAction === 'pass',
      reason: config.defaultAction === 'pass' ? '默认放行' : '默认屏蔽',
    };
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function injectStyles() {
    if (document.getElementById('ztf-styles')) return;
    const style = document.createElement('style');
    style.id = 'ztf-styles';
    style.textContent = [
      '.ztf-banner{display:flex;align-items:center;gap:6px;padding:4px 40px 4px 10px;background:#3a3a3c;border:1px solid #5a5a5c;border-radius:4px;margin:2px 0;cursor:pointer;font-size:12px;color:#d8d8d8;box-sizing:border-box;}',
      '.ztf-banner:hover{background:#48484a;}',
      '.ztf-banner-icon{color:#b0b0b0;font-size:13px;font-weight:bold;flex-shrink:0;}',
      '.ztf-banner-text{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ztf-banner-action{color:#7ab7ff;flex-shrink:0;}',
      '.ztf-collapsed{display:none !important;}',
      '[data-ztf-status="blocked"]{margin-top:0 !important;margin-bottom:4px !important;padding-top:0 !important;padding-bottom:0 !important;}',
      '.ztf-banner{margin:0 0 2px !important;}',
      '.ztf-pass-mark{position:absolute;top:4px;right:4px;font-size:11px;color:#67c23a;background:#f0f9eb;padding:1px 6px;border-radius:8px;z-index:5;pointer-events:none;}',
      '.ztf-title-dot{position:absolute;right:8px;top:8px;cursor:pointer;z-index:10;color:#c9c9c9;font-size:16px;line-height:1;user-select:none;padding:2px 4px;font-weight:bold;}',
      '.ztf-title-dot:hover{color:#8590a6;}',
      '[data-ztf-status="blocked"] .ztf-title-dot{top:50%;transform:translateY(-50%);}',
      '.ztf-dot-menu{position:fixed;z-index:99997;background:#fff;border:1px solid #ebeced;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.15);padding:4px 0;min-width:140px;font-size:13px;}',
      '.ztf-dot-item{padding:7px 14px;cursor:pointer;color:#1a1a1a;}',
      '.ztf-dot-item:hover{background:#f6f6f6;}',
      '.ztf-panel-mask{position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:99998;}',
      '.ztf-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:520px;max-width:92vw;max-height:86vh;background:#fff;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.2);z-index:99999;display:flex;flex-direction:column;overflow:hidden;font-family:inherit;}',
      '.ztf-panel-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #ebeced;}',
      '.ztf-panel-title{font-size:16px;font-weight:600;color:#1a1a1a;}',
      '.ztf-panel-close{cursor:pointer;font-size:20px;color:#8590a6;line-height:1;padding:4px;border:none;background:none;}',
      '.ztf-panel-close:hover{color:#1a1a1a;}',
      '.ztf-panel-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:10px 18px;border-bottom:1px solid #f0f2f5;}',
      '.ztf-tab{padding:5px 12px;border:1px solid #ebeced;border-radius:14px;background:#fff;color:#646464;cursor:pointer;font-size:13px;}',
      '.ztf-tab.active{background:#1772f6;color:#fff;border-color:#1772f6;}',
      '.ztf-panel-body{flex:1;overflow-y:auto;padding:14px 18px;}',
      '.ztf-textarea{width:100%;min-height:240px;border:1px solid #d9d9d9;border-radius:4px;padding:8px;font-size:13px;font-family:monospace;resize:vertical;box-sizing:border-box;line-height:1.6;}',
      '.ztf-field-label{font-size:13px;color:#646464;margin-bottom:6px;display:block;}',
      '.ztf-settings-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f6f6f6;}',
      '.ztf-settings-label{font-size:14px;color:#1a1a1a;}',
      '.ztf-settings-desc{font-size:12px;color:#999;margin-top:2px;}',
      '.ztf-toggle{position:relative;width:40px;height:22px;background:#ccc;border-radius:11px;cursor:pointer;transition:background 0.2s;flex-shrink:0;}',
      '.ztf-toggle.on{background:#1772f6;}',
      '.ztf-toggle::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;background:#fff;border-radius:50%;transition:transform 0.2s;}',
      '.ztf-toggle.on::after{transform:translateX(18px);}',
      '.ztf-radio-group{display:flex;gap:12px;}',
      '.ztf-radio{display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;}',
      '.ztf-panel-footer{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-top:1px solid #ebeced;background:#fafafa;}',
      '.ztf-stats{font-size:12px;color:#8590a6;}',
      '.ztf-stats b{color:#1a1a1a;}',
      '.ztf-btn{padding:6px 16px;border-radius:4px;border:1px solid #d9d9d9;background:#fff;color:#1a1a1a;cursor:pointer;font-size:13px;margin-left:8px;}',
      '.ztf-btn:hover{border-color:#1772f6;color:#1772f6;}',
      '.ztf-btn-primary{background:#1772f6;color:#fff;border-color:#1772f6;}',
      '.ztf-btn-primary:hover{background:#0d6ddb;color:#fff;}',
      '.ztf-tab-content{display:none;}',
      '.ztf-tab-content.active{display:block;}',
      '.ztf-hint{font-size:12px;color:#999;margin:6px 0 0;line-height:1.6;}',
      '.ztf-fab{position:fixed;right:16px;bottom:16px;z-index:99996;width:40px;height:40px;border-radius:50%;background:#1772f6;color:#fff;border:none;cursor:pointer;font-size:20px;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;opacity:0.55;transition:opacity 0.2s,transform 0.2s;}',
      '.ztf-fab:hover{opacity:1;transform:scale(1.05);}',
      '.ztf-fab-label{position:absolute;right:52px;top:50%;transform:translateY(-50%);background:#1a1a1a;color:#fff;font-size:12px;padding:4px 8px;border-radius:4px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity 0.2s;}',
      '.ztf-fab:hover .ztf-fab-label{opacity:0.9;}',
    ].join(NEWLINE);
    document.head.appendChild(style);
  }

  function resetCardStatus(card) {
    card.removeAttribute('data-ztf-status');
    card.querySelectorAll('.ztf-banner, .ztf-pass-mark').forEach((n) => n.remove());
    card.querySelectorAll('.ztf-collapsed').forEach((n) => n.classList.remove('ztf-collapsed'));
  }

  function resetCardAll(card) {
    card.removeAttribute('data-ztf-status');
    card.removeAttribute('data-ztf-dot');
    card.querySelectorAll('.ztf-banner, .ztf-pass-mark, .ztf-title-dot').forEach((n) => n.remove());
    card.querySelectorAll('.ztf-collapsed').forEach((n) => n.classList.remove('ztf-collapsed'));
  }

  function blockCard(card, title) {
    if (card.dataset.ztfStatus === 'blocked') return;
    card.dataset.ztfStatus = 'blocked';

    const shortTitle = title.length > MAX_TITLE_DISPLAY ? title.slice(0, MAX_TITLE_DISPLAY) + '...' : title;

    const collapsibles = Array.from(card.children).filter((c) => !c.classList.contains('ztf-title-dot'));
    collapsibles.forEach((c) => c.classList.add('ztf-collapsed'));

    const banner = document.createElement('div');
    banner.className = 'ztf-banner';
    banner.innerHTML =
      '<span class="ztf-banner-icon">\u2298</span>' +
      '<span class="ztf-banner-text">\u5df2\u5c4f\u853d \u00b7 ' + escapeHtml(shortTitle) + '</span>' +
      '<span class="ztf-banner-action">\u5c55\u5f00\u67e5\u770b</span>';

    banner.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      let nowCollapsed = false;
      collapsibles.forEach((c) => {
        c.classList.toggle('ztf-collapsed');
        nowCollapsed = c.classList.contains('ztf-collapsed');
      });
      banner.querySelector('.ztf-banner-action').textContent = nowCollapsed ? '\u5c55\u5f00\u67e5\u770b' : '\u6536\u8d77';
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
      '<div class="ztf-dot-item" data-action="add">\u52a0\u5165\u6807\u9898\u9ed1\u540d\u5355</div>' +
      '<div class="ztf-dot-item" data-action="remove">\u79fb\u51fa\u6807\u9898\u9ed1\u540d\u5355</div>';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
    document.body.appendChild(menu);
    dotMenu = menu;

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.ztf-dot-item');
      if (!item) return;
      e.stopPropagation();
      const action = item.dataset.action;
      if (action === 'add') {
        if (!config.titleBlacklist) config.titleBlacklist = [];
        if (!config.titleBlacklist.includes(info.title)) {
          config.titleBlacklist.push(info.title);
          saveConfig(config);
        }
        resetCardStatus(card);
        blockCard(card, info.title);
      } else if (action === 'remove') {
        if (config.titleBlacklist) {
          config.titleBlacklist = config.titleBlacklist.filter((bt) => bt !== info.title);
          saveConfig(config);
        }
        resetCardStatus(card);
        const result = classifyArticle(info);
        if (!result.isTech) {
          blockCard(card, info.title);
        }
      }
      closeDotMenu();
    });

    setTimeout(() => {
      document.addEventListener('click', closeDotMenu, true);
    }, 0);
  }

  function injectDot(card, info) {
    if (card.dataset.ztfDot) return;
    if (!info.title) return;
    card.dataset.ztfDot = '1';
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

    const dot = document.createElement('div');
    dot.className = 'ztf-title-dot';
    dot.textContent = '\u22ef';
    dot.title = '\u52a0\u5165/\u79fb\u51fa\u9ed1\u540d\u5355';
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openDotMenu(dot, card, info);
    });
    card.appendChild(dot);
  }

  function scanCards() {
    const cards = querySelectorAllAny(document, SELECTORS.cards);
    for (const card of cards) {
      const info = extractArticleInfo(card);
      if (!info) continue;
      injectDot(card, info);
      if (card.dataset.ztfStatus) continue;
      const result = classifyArticle(info);
      if (!result.isTech) {
        blockCard(card, info.title);
      } else {
        stats.passed++;
        if (result.reason.startsWith('\u6280\u672f') || result.reason.startsWith('\u4f5c\u8005')) stats.passedTech++;
        if (config.debug) markPassed(card, result.reason);
      }
    }
    updateStatsDisplay();
  }

  let scanTimer = null;
  function debouncedScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scanCards, SCAN_DEBOUNCE_MS);
  }

  let observer = null;
  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(debouncedScan);
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
      { id: 'titleBlacklist', label: '\u6807\u9898\u9ed1\u540d\u5355' },
      { id: 'techKeywords', label: '\u6280\u672f\u5173\u952e\u8bcd' },
      { id: 'nonTechKeywords', label: '\u975e\u6280\u672f\u5173\u952e\u8bcd' },
      { id: 'techAuthors', label: '\u6280\u672f\u4f5c\u8005' },
      { id: 'techTopics', label: '\u6280\u672f\u8bdd\u9898' },
      { id: 'nonTechTopics', label: '\u975e\u6280\u672f\u8bdd\u9898' },
      { id: 'settings', label: '\u8bbe\u7f6e' },
    ];

    panel.innerHTML =
      '<div class="ztf-panel-header">' +
        '<span class="ztf-panel-title">\u77e5\u4e4e\u6280\u672f\u8fc7\u6ee4 \u2014 \u914d\u7f6e</span>' +
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
        div.innerHTML =
          '<div class="ztf-settings-row">' +
            '<div><div class="ztf-settings-label">\u672a\u547d\u4e2d\u4efb\u4f55\u89c4\u5219\u65f6\u7684\u9ed8\u8ba4\u884c\u4e3a</div>' +
            '<div class="ztf-settings-desc">\u63a8\u8350\u680f\u5927\u91cf\u6587\u7ae0\u65e0\u660e\u786e\u6280\u672f/\u975e\u6280\u672f\u7279\u5f81\uff0c\u6b64\u9879\u51b3\u5b9a\u5176\u53bb\u7559</div></div>' +
            '<div class="ztf-radio-group">' +
              '<label class="ztf-radio"><input type="radio" name="defaultAction" value="pass" ' +
              (config.defaultAction === 'pass' ? 'checked' : '') + '> \u653e\u884c</label>' +
              '<label class="ztf-radio"><input type="radio" name="defaultAction" value="block" ' +
              (config.defaultAction === 'block' ? 'checked' : '') + '> \u5c4f\u853d</label>' +
            '</div>' +
          '</div>' +
          '<div class="ztf-settings-row">' +
            '<div><div class="ztf-settings-label">\u8c03\u8bd5\u6a21\u5f0f</div>' +
            '<div class="ztf-settings-desc">\u653e\u884c\u7684\u6587\u7ae0\u4e5f\u4f1a\u6807\u8bb0\u547d\u4e2d\u539f\u56e0\uff0c\u4fbf\u4e8e\u6838\u5bf9\u89c4\u5219\u662f\u5426\u8bef\u6740</div></div>' +
            '<div class="ztf-toggle' + (config.debug ? ' on' : '') + '" id="ztf-debug-toggle"></div>' +
          '</div>' +
          '<p class="ztf-hint">' +
            '\u5224\u5b9a\u4f18\u5148\u7ea7\uff1a\u6807\u9898\u9ed1\u540d\u5355 > \u4f5c\u8005\u767d\u540d\u5355 > \u8bdd\u9898\u6807\u7b7e > \u6280\u672f\u5173\u952e\u8bcd > \u975e\u6280\u672f\u5173\u952e\u8bcd > \u9ed8\u8ba4\u884c\u4e3a\u3002<br>' +
            '\u6280\u672f\u5173\u952e\u8bcd\u4f18\u5148\u4e8e\u975e\u6280\u672f\u5173\u952e\u8bcd\uff0c\u907f\u514d\u300c\u6e38\u620f\u7f16\u7a0b\u300d\u8fd9\u7c7b\u542b\u975e\u6280\u672f\u8bcd\u7684\u6280\u672f\u6587\u7ae0\u88ab\u8bef\u6740\u3002<br>' +
            '\u5339\u914d\u65b9\u5f0f\u4e3a\u5b50\u4e32\u5305\u542b\uff08\u6a21\u7cca\u5339\u914d\uff09\uff0c\u4e0d\u533a\u5206\u5927\u5c0f\u5199\u3002' +
          '</p>';
      } else {
        const value = config[t.id] || [];
        div.innerHTML =
          '<label class="ztf-field-label">' + t.label + '\uff08\u6bcf\u884c\u4e00\u4e2a\uff0c\u7a7a\u884c\u5ffd\u7565\uff09</label>' +
          '<textarea class="ztf-textarea" data-field="' + t.id + '">' +
            escapeHtml(value.join(NEWLINE)) +
          '</textarea>' +
          (t.id === 'titleBlacklist'
            ? '<p class="ztf-hint">\u70b9\u51fb\u6587\u7ae0\u6807\u9898\u524d\u7684\u5706\u70b9\u53ef\u5feb\u901f\u52a0\u5165/\u79fb\u51fa\u3002\u6b64\u5904\u4e5f\u53ef\u624b\u52a8\u7f16\u8f91\uff0c\u5305\u542b\u5339\u914d\u3002</p>'
            : '') +
          (t.id === 'techAuthors'
            ? '<p class="ztf-hint">\u586b\u5199\u77e5\u4e4e\u7528\u6237\u540d\uff08\u4e3b\u9875\u663e\u793a\u7684\u6635\u79f0\uff09\uff0c\u7cbe\u786e\u6216\u5305\u542b\u5339\u914d\u5747\u53ef\u3002\u7559\u7a7a\u5219\u4e0d\u542f\u7528\u4f5c\u8005\u767d\u540d\u5355\u3002</p>'
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

    const debugToggle = panel.querySelector('#ztf-debug-toggle');
    if (debugToggle) {
      debugToggle.addEventListener('click', () => {
        debugToggle.classList.toggle('on');
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
        config[field] = ta.value.split(NEWLINE).map((s) => s.trim()).filter((s) => s.length > 0);
      });
      const radio = panel.querySelector('input[name="defaultAction"]:checked');
      if (radio) config.defaultAction = radio.value;
      if (debugToggle) config.debug = debugToggle.classList.contains('on');
      saveConfig(config);
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

  function injectFab() {
    if (document.getElementById('ztf-fab')) return;
    const fab = document.createElement('button');
    fab.className = 'ztf-fab';
    fab.id = 'ztf-fab';
    fab.title = '\u77e5\u4e4e\u6280\u672f\u8fc7\u6ee4 \u2014 \u914d\u7f6e';
    fab.innerHTML = '\u2691<span class="ztf-fab-label">\u914d\u7f6e\u8fc7\u6ee4\u89c4\u5219</span>';
    fab.addEventListener('click', openConfigPanel);
    document.body.appendChild(fab);
  }

  function init() {
    injectStyles();
    injectFab();
    scanCards();
    startObserver();
    startInterval();

    try {
      GM_registerMenuCommand('\u914d\u7f6e\u8fc7\u6ee4\u89c4\u5219', openConfigPanel);
      GM_registerMenuCommand('\u7acb\u5373\u91cd\u65b0\u626b\u63cf', () => {
        document.querySelectorAll('[data-ztf-status]').forEach((el) => resetCardAll(el));
        stats.blocked = 0; stats.passed = 0; stats.passedTech = 0;
        scanCards();
      });
      GM_registerMenuCommand('\u5207\u6362\u8c03\u8bd5\u6a21\u5f0f', () => {
        config.debug = !config.debug;
        saveConfig(config);
      });
    } catch (e) { /* GM_registerMenuCommand unavailable */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
