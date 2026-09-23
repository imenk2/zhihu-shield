# zh-shield

一个 Tampermonkey 用户脚本，在 zh 网站推荐栏自动屏蔽非技术类文章，只保留技术内容。

## 浏览器与插件

- **浏览器**：Chrome / Edge / Firefox 等支持用户脚本的浏览器
- **插件**：Tampermonkey（油猴扩展）

## 功能

- 自动判定 zh 推荐栏每篇文章是否技术类，非技术文章折叠屏蔽
- 多维度判定：标题黑名单 > 作者白名单 > 话题标签 > 技术/非技术关键词 > 默认行为
- 每张卡片右侧 `⋯` 入口，一键加入/移出标题黑名单
- 可视化配置面板，自定义各类名单与默认行为
- 支持在线自动更新

## 安装

1. 安装 Tampermonkey 浏览器扩展
2. 浏览器访问下方 URL，Tampermonkey 识别 `.user.js` 并弹出安装确认：

```
https://raw.githubusercontent.com/imenk2/zhihu-shield/main/zhihu-tech-filter.user.js
```

3. 确认安装，打开 zh 网站即生效

## 更新

脚本头部含 `@updateURL` / `@downloadURL`，Tampermonkey 定期检查版本号自动拉取更新。发版时递增 `@version` 并推送即可。

## 配置

点击 Tampermonkey 图标 →「配置过滤规则」，可编辑标题黑名单、技术/非技术关键词、作者白名单、话题黑白名单，切换默认行为与调试模式。
