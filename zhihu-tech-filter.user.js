// ==UserScript==
// @name         zh文章屏蔽器
// @name:en      Zhihu Article Shield
// @namespace    https://github.com/imenk2/zhihu-shield
// @version      0.0.21
// @description  自动屏蔽zh推荐/热榜/专栏/圈子非技术类文章，支持作者/关键词/标题黑白名单过滤，冲突黄色折叠栏一键消冲突
// @author       imenk2
// @match        https://www.zhihu.com/*
// @match        https://zhihu.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
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
  const REMOTE_RULES_URL = 'https://raw.githubusercontent.com/imenk2/zhihu-shield/main/rules.json';
  const REMOTE_RULES_KEY = 'ztf_remote_rules_meta';
  const REMOTE_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
      '动漫', '漫画', '动画', '小说', '网文', '番剧', 'cosplay',
      '历史', '哲学', '文学', '艺术', '诗歌', '散文',
      '心理', '抑郁', '焦虑', '心理咨询', '原生家庭',
      '育儿', '亲子', '教育', '高考', '考研', '留学', '雅思', '托福', '四六级',
      '社会', '热点', '事件', '新闻', '评论', '舆论',
      '股票', '基金', '理财', '房产', '经济', '通胀', '汇率', '保险',
      '汽车', '驾照', '电动车', '手机评测',
      '节日', '过年', '春节', '中秋', '情人节',
      '两性', '性教育', '性生活', '性健康', '避孕', '堕胎', '一夜情', '约炮', '炮友',
      '结婚', '离婚', '彩礼', '婆媳', '夫妻', '老婆', '老公', '媳妇', '剩女', '逼婚',
      '心动', '失恋', '治愈', '温暖', '扎心', '共鸣',
      '游记', '民宿', '打卡', '自由行', '跟团', '出境游',
      '北京', '上海', '广州', '深圳', '成都', '杭州', '武汉', '南京', '西安', '重庆',
      '苏州', '天津', '长沙', '青岛', '郑州', '昆明', '大连', '厦门', '沈阳', '哈尔滨',
      '佛山', '东莞', '无锡', '宁波', '福州', '合肥', '济南', '太原', '南宁', '贵阳',
      '兰州', '海口', '拉萨', '乌鲁木齐',
      '职场', '上班', '加班', '跳槽', '辞职', '裁员', '失业', '面试', '简历', '老板',
      '同事', '内卷', '996', '007', '打工人', '社畜', '体制内', '公务员', '退休', '薪水',
      '工资', '年终奖', '晋升', '绩效',
      '杂文', '随笔', '书评', '读书', '名著',
      '朝代', '皇帝', '古代', '近代', '抗战', '民国',
    ],
    techAuthors: [],
    nonTechAuthors: [],
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
    const { title, summary, author } = info;
    const text = (title ? title + ' ' : '') + summary;


    if (author && config.nonTechAuthors && config.nonTechAuthors.length > 0) {
      for (const a of config.nonTechAuthors) {
        if (a && (author === a || author.includes(a) || a.includes(author))) {
          return { isTech: false, reason: '作者黑名单: ' + author };
        }
      }
    }

    if (author && config.techAuthors && config.techAuthors.length > 0) {
      let techAuthorHit = false;
      for (const a of config.techAuthors) {
        if (a && (author === a || author.includes(a) || a.includes(author))) { techAuthorHit = true; break; }
      }
      if (techAuthorHit) {
        for (const kw of config.nonTechKeywords) {
          if (kw && text.includes(kw)) {
            return {
              isTech: false,
              reason: '【作者冲突】作者白名单「' + author + '」vs 关键词黑名单「' + kw + '」',
              conflict: true,
              conflictInfo: { whitelistField: 'techAuthors', whitelistValue: author, blacklistField: 'nonTechKeywords', blacklistValue: kw },
            };
          }
        }
        return { isTech: true, reason: '作者白名单: ' + author };
      }
    }

    const lowerText = text.toLowerCase();
    let techKwHit = null;
    for (const kw of config.techKeywords) {
      if (kw && lowerText.includes(kw.toLowerCase())) { techKwHit = kw; break; }
    }
    if (techKwHit) {
      for (const kw of config.nonTechKeywords) {
        if (kw && text.includes(kw)) {
          return {
            isTech: false,
            reason: '【关键词冲突】技术关键词「' + techKwHit + '」vs 非技术关键词「' + kw + '」',
            conflict: true,
            conflictInfo: { whitelistField: 'techKeywords', whitelistValue: techKwHit, blacklistField: 'nonTechKeywords', blacklistValue: kw },
          };
        }
      }
      return { isTech: true, reason: '技术关键词: ' + techKwHit };
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
      '.ztf-banner{display:flex;align-items:center;gap:8px;padding:6px 12px;background:#3a3a3c;border:1px solid #5a5a5c;border-left:3px solid #8590a6;border-radius:4px;margin:0 0 6px !important;cursor:pointer;font-size:12px;color:#d8d8d8;box-sizing:border-box;position:relative;width:100%;}',
      '.ztf-banner:hover{background:#48484a;}',
      '.ztf-banner-icon{color:#b0b0b0;font-size:13px;font-weight:bold;flex-shrink:0;}',
      '.ztf-banner-text{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ztf-banner-action{color:#7ab7ff;flex-shrink:0;}',
      '.ztf-banner.ztf-banner-conflict{border-left-color:#d4a72c;background:#6b5d20;}',
      '.ztf-banner.ztf-banner-conflict:hover{background:#7d6e26;}',
      '.ztf-banner.ztf-banner-conflict .ztf-banner-icon{color:#ffd54f;}',
      '.ztf-banner.ztf-banner-conflict .ztf-banner-text{color:#ffe9a8;}',
      '.ztf-banner-fix{color:#1a1a1a;background:#ffd54f;border:1px solid #d4a72c;border-radius:3px;padding:1px 6px;font-size:11px;cursor:pointer;flex-shrink:0;user-select:none;}',
      '.ztf-banner-fix:hover{background:#ffca28;}',
      '.ztf-banner-dot{color:#b0b0b0;font-size:16px;font-weight:bold;line-height:1;padding:2px 6px;border-radius:3px;cursor:pointer;flex-shrink:0;user-select:none;}',
      '.ztf-banner-dot:hover{color:#fff;background:rgba(255,255,255,0.15);}',
      '.ztf-collapsed{display:none !important;}',
      '[data-ztf-status="blocked"]{margin-top:0 !important;margin-bottom:6px !important;padding-top:0 !important;padding-bottom:0 !important;}',
      '.ztf-pass-mark{position:absolute;top:4px;right:28px;font-size:11px;color:#67c23a;background:#f0f9eb;padding:1px 6px;border-radius:8px;z-index:5;pointer-events:none;}',
      '.ztf-title-dot{position:absolute;right:8px;top:8px;cursor:pointer;z-index:10;color:#c9c9c9;font-size:16px;line-height:1;user-select:none;padding:2px 4px;font-weight:bold;}',
      '.ztf-title-dot:hover{color:#8590a6;}',
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
      '.ztf-fab{position:fixed;z-index:99996;width:40px;height:40px;border-radius:50%;background:#1772f6;color:#fff;border:none;cursor:pointer;font-size:20px;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity 0.2s;user-select:none;}',
      '.ztf-fab.show{opacity:1;pointer-events:auto;}',
      '.ztf-fab.dragging{transition:none;cursor:grabbing;}',
      '.ztf-scan-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;}',
      '.ztf-scan-btn{margin-left:0;}',
      '.ztf-candidate-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:420px;max-width:92vw;max-height:70vh;background:#fff;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.2);z-index:100000;display:flex;flex-direction:column;overflow:hidden;font-family:inherit;}',
      '.ztf-candidate-body{flex:1;overflow-y:auto;padding:10px 18px;}',
      '.ztf-candidate-item{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f6f6f6;cursor:pointer;font-size:13px;}',
      '.ztf-candidate-word{flex:1;color:#1a1a1a;}',
      '.ztf-candidate-count{color:#999;font-size:12px;}',
    ].join(NEWLINE);
    document.head.appendChild(style);
  }

  function resetCardAll(card) {
    card.removeAttribute('data-ztf-status');
    card.removeAttribute('data-ztf-dot');
    card.removeAttribute('data-ztf-pos-set');
    card.querySelectorAll('.ztf-banner, .ztf-pass-mark, .ztf-title-dot, .ztf-banner-dot').forEach((n) => n.remove());
    card.querySelectorAll('.ztf-collapsed').forEach((n) => n.classList.remove('ztf-collapsed'));
  }

  function blockCard(card, info, conflict, conflictInfo, reason) {
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
    icon.textContent = '\u2298';

    const text = document.createElement('span');
    text.className = 'ztf-banner-text';
    text.textContent = (conflict && reason) ? reason : ('\u5df2\u5c4f\u853d \u00b7 ' + shortTitle);

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
        config[conflictInfo.blacklistField] = (config[conflictInfo.blacklistField] || [])
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
        config[conflictInfo.whitelistField] = (config[conflictInfo.whitelistField] || [])
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
      if (action === 'addKw') {
        const kw = window.prompt('输入要添加的屏蔽关键词：', info.title || '');
        if (kw && kw.trim()) {
          const v = kw.trim();
          if ((config.techKeywords || []).includes(v)) {
            window.alert('「' + v + '」已在关键词白名单中，不能加入黑名单');
          } else {
            if (!config.nonTechKeywords) config.nonTechKeywords = [];
            if (!config.nonTechKeywords.includes(v)) {
              config.nonTechKeywords.push(v);
              saveConfig(config);
            }
          }
        }
      } else if (action === 'removeKw') {
        const kw = window.prompt('输入要移除的屏蔽关键词：', info.title || '');
        if (kw && kw.trim()) {
          const v = kw.trim();
          config.nonTechKeywords = (config.nonTechKeywords || []).filter((k) => k !== v);
          saveConfig(config);
        }
      } else if (action === 'addAuthor') {
        const a = window.prompt('输入要添加的屏蔽作者：', info.author || '');
        if (a && a.trim()) {
          const v = a.trim();
          if ((config.techAuthors || []).includes(v)) {
            window.alert('「' + v + '」已在作者白名单中，不能加入黑名单');
          } else {
            if (!config.nonTechAuthors) config.nonTechAuthors = [];
            if (!config.nonTechAuthors.includes(v)) {
              config.nonTechAuthors.push(v);
              saveConfig(config);
            }
          }
        }
      } else if (action === 'removeAuthor') {
        const a = window.prompt('输入要移除的屏蔽作者：', info.author || '');
        if (a && a.trim()) {
          const v = a.trim();
          config.nonTechAuthors = (config.nonTechAuthors || []).filter((x) => x !== v);
          saveConfig(config);
        }
      }
      closeDotMenu();
      rescanAll();
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

  function scanCards() {
    if (!isShieldPage()) return;
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
        blockCard(card, info, result.conflict, result.conflictInfo, result.reason);
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
    document.querySelectorAll('[data-ztf-dot], [data-ztf-status]').forEach((el) => resetCardAll(el));
    stats.blocked = 0; stats.passed = 0; stats.passedTech = 0;
    scanCards();
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

  const NON_TECH_GUIDES = [
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
  ];

  function buildGuidesFromDefs(defs) {
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

  let activeNonTechGuides = NON_TECH_GUIDES;
  try {
    const savedGuides = GM_getValue('ztf_remote_guides', null);
    if (Array.isArray(savedGuides)) {
      const built = buildGuidesFromDefs(savedGuides);
      if (built) activeNonTechGuides = built;
    }
  } catch (e) { /* ignore */ }

  function extractNonTechCandidates() {
    const rawCards = querySelectorAllAny(document, SELECTORS.cards);
    const cards = rawCards.filter((card) => {
      return !rawCards.some((parent) => parent !== card && parent.contains(card));
    });
    const counts = new Map();
    const techKwLower = (config.techKeywords || []).map((k) => k.toLowerCase());

    function addCandidate(word) {
      const w = word.trim();
      if (w.length === 0) return;
      counts.set(w, (counts.get(w) || 0) + 1);
    }

    for (const card of cards) {
      const info = extractArticleInfo(card);
      if (!info || !info.title) continue;
      const title = info.title;

      for (const re of activeNonTechGuides) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(title)) !== null) {
          addCandidate(m[0]);
        }
      }

      const hasQuestion = title.includes('？') || title.includes('?');
      if (hasQuestion) {
        const lowerTitle = title.toLowerCase();
        const isTechTitle = techKwLower.some((k) => k && lowerTitle.includes(k));
        if (!isTechTitle) {
          addCandidate('？');
          if (/吗[？?]/.test(title)) addCandidate('吗？');
          if (/呢[？?]/.test(title)) addCandidate('呢？');
          if (/吧[？?]/.test(title)) addCandidate('吧？');
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
      window.alert('当前页面未扫描到疑似非技术类关键词（请在知乎首页/热榜等页面打开配置）');
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
        '<span class="ztf-panel-title">扫描结果 — 勾选加入关键词黑名单</span>' +
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

  const REMOTE_RULE_FIELDS = ['techKeywords', 'nonTechKeywords', 'techAuthors', 'nonTechAuthors'];

  function fetchRemoteRules(onDone) {
    try {
      GM_xmlhttpRequest({
        method: 'GET',
        url: REMOTE_RULES_URL,
        timeout: 8000,
        onload: (resp) => {
          if (resp.status >= 200 && resp.status < 300) {
            try {
              const rules = JSON.parse(resp.responseText);
              onDone && onDone({ ok: true, rules });
              return;
            } catch (e) { /* parse error */ }
          }
          onDone && onDone({ ok: false, error: 'HTTP ' + resp.status });
        },
        onerror: () => { onDone && onDone({ ok: false, error: 'network' }); },
        ontimeout: () => { onDone && onDone({ ok: false, error: 'timeout' }); },
      });
    } catch (e) {
      onDone && onDone({ ok: false, error: 'GM_xmlhttpRequest unavailable' });
    }
  }

  function mergeRemoteRules(rules) {
    let added = 0;
    for (const f of REMOTE_RULE_FIELDS) {
      if (Array.isArray(rules[f])) {
        if (!config[f]) config[f] = [];
        for (const v of rules[f]) {
          if (v && typeof v === 'string' && !config[f].includes(v)) {
            config[f].push(v);
            added++;
          }
        }
      }
    }
    if (Array.isArray(rules.nonTechGuides)) {
      const built = buildGuidesFromDefs(rules.nonTechGuides);
      if (built) {
        activeNonTechGuides = built;
        try { GM_setValue('ztf_remote_guides', rules.nonTechGuides); } catch (e) { /* ignore */ }
      }
    }
    if (added > 0) saveConfig(config);
    return added;
  }

  function maybeAutoSyncRemote() {
    try {
      const meta = GM_getValue(REMOTE_RULES_KEY, null);
      const now = Date.now();
      if (meta && typeof meta.lastSync === 'number' && now - meta.lastSync < REMOTE_SYNC_INTERVAL_MS) return;
      fetchRemoteRules((res) => {
        if (res.ok) {
          const added = mergeRemoteRules(res.rules);
          GM_setValue(REMOTE_RULES_KEY, { lastSync: now, version: res.rules.version || null });
          if (added > 0) rescanAll();
        } else {
          GM_setValue(REMOTE_RULES_KEY, { lastSync: now, error: res.error });
        }
      });
    } catch (e) { /* ignore */ }
  }

  function syncRemoteRulesManual(statusEl, btn) {
    const restoreBtn = () => { if (btn) { btn.disabled = false; btn.textContent = '\u7acb\u5373\u540c\u6b65'; } };
    if (btn) { btn.disabled = true; btn.textContent = '\u540c\u6b65\u4e2d...'; }
    fetchRemoteRules((res) => {
      if (res.ok) {
        const added = mergeRemoteRules(res.rules);
        GM_setValue(REMOTE_RULES_KEY, { lastSync: Date.now(), version: res.rules.version || null });
        if (statusEl) statusEl.textContent = '\u540c\u6b65\u6210\u529f\uff08v' + (res.rules.version || '?') + '\uff09\uff0c\u65b0\u589e ' + added + ' \u4e2a\u89c4\u5219\u3002\u70b9\u51fb\u201c\u4fdd\u5b58\u201d\u751f\u6548\u3002';
        if (added > 0) {
          const textareas = document.querySelectorAll('#ztf-panel textarea[data-field]');
          textareas.forEach((ta) => {
            const field = ta.dataset.field;
            if (config[field]) ta.value = config[field].join(NEWLINE);
          });
        }
      } else {
        if (statusEl) statusEl.textContent = '\u540c\u6b65\u5931\u8d25\uff1a' + res.error;
      }
      restoreBtn();
    });
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
      { id: 'techKeywords', label: '关键词白名单' },
      { id: 'nonTechKeywords', label: '关键词黑名单' },
      { id: 'techAuthors', label: '作者白名单' },
      { id: 'nonTechAuthors', label: '作者黑名单' },

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
          '<div class="ztf-settings-row">' +
            '<div><div class="ztf-settings-label">\u8fdc\u7a0b\u89c4\u5219\u540c\u6b65</div>' +
            '<div class="ztf-settings-desc">\u4ece GitHub \u62c9\u53d6\u6700\u65b0\u5c4f\u853d\u89c4\u5219\u5e76\u5408\u5e76\u5230\u672c\u5730\uff08\u53bb\u91cd\uff0c\u4fdd\u7559\u672c\u5730\u81ea\u5b9a\u4e49\uff09</div></div>' +
            '<button class="ztf-btn ztf-btn-primary" id="ztf-sync-remote">\u7acb\u5373\u540c\u6b65</button>' +
          '</div>' +
          '<div class="ztf-settings-row"><div><div class="ztf-settings-label" id="ztf-remote-status" style="color:#8590a6;font-weight:normal;"></div></div></div>' +
          '<p class="ztf-hint">' +
            '判定优先级：作者黑名单 > 作者白名单 > 关键词白名单 > 关键词黑名单 > 默认行为。<br>' +
            '白名单优先于黑名单，避免「游戏编程」这类含非技术词的技术文章被误杀。<br>' +
            '匹配方式为子串包含（模糊匹配），关键词不区分大小写。' +
          '</p>';
      } else {
        const value = config[t.id] || [];
        div.innerHTML =
          '<label class="ztf-field-label">' + t.label + '\uff08\u6bcf\u884c\u4e00\u4e2a\uff0c\u7a7a\u884c\u5ffd\u7565\uff09</label>' +
          (t.id === 'nonTechKeywords'
            ? '<div class="ztf-scan-row"><button class="ztf-btn ztf-btn-primary ztf-scan-btn" id="ztf-scan-nontech">\u626b\u63cf\u5f53\u524d\u6587\u7ae0\u7591\u4f3c\u975e\u6280\u672f\u8bcd</button><span class="ztf-hint">\u4ece\u5f53\u524d\u9875\u9762\u6587\u7ae0\u6807\u9898\u63d0\u53d6\u8be2\u95ee\u5f0f/\u60c5\u611f\u5f0f\u7b49\u7591\u4f3c\u975e\u6280\u672f\u5173\u952e\u8bcd\uff0c\u52fe\u9009\u52a0\u5165\u9ed1\u540d\u5355</span></div>'
            : '') +
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

    const scanBtn = panel.querySelector('#ztf-scan-nontech');
    if (scanBtn) {
      scanBtn.addEventListener('click', () => {
        const ta = panel.querySelector('textarea[data-field="nonTechKeywords"]');
        openCandidateDialog(ta);
      });
    }

    const debugToggle = panel.querySelector('#ztf-debug-toggle');
    if (debugToggle) {
      debugToggle.addEventListener('click', () => {
        debugToggle.classList.toggle('on');
      });
    }

    const syncRemoteBtn = panel.querySelector('#ztf-sync-remote');
    if (syncRemoteBtn) {
      syncRemoteBtn.addEventListener('click', () => {
        const statusEl = panel.querySelector('#ztf-remote-status');
        syncRemoteRulesManual(statusEl, syncRemoteBtn);
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

  const FAB_PROXIMITY = 80;
  const FAB_DRAG_THRESHOLD = 5;
  const FAB_POS_KEY = 'ztf_fab_pos_v1';

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
    injectFab();
    if (isShieldPage()) {
      scanCards();
      startObserver();
      startInterval();
    }

    maybeAutoSyncRemote();

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
      GM_registerMenuCommand('\u540c\u6b65\u8fdc\u7a0b\u89c4\u5219', () => {
        fetchRemoteRules((res) => {
          if (res.ok) {
            const added = mergeRemoteRules(res.rules);
            GM_setValue(REMOTE_RULES_KEY, { lastSync: Date.now(), version: res.rules.version || null });
            window.alert('\u540c\u6b65\u6210\u529f\uff0c\u65b0\u589e ' + added + ' \u4e2a\u89c4\u5219');
            rescanAll();
          } else {
            window.alert('\u540c\u6b65\u5931\u8d25\uff1a' + res.error);
          }
        });
      });
    } catch (e) { /* GM_registerMenuCommand unavailable */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();