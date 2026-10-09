# NewtonRouter GEO

GEO（Generative Engine Optimization，生成式引擎优化）的目标是让生成式搜索更容易发现、理解和引用网站的公开信息。它建立在可抓取内容、准确描述和清晰来源之上，不能保证网站被任何 AI 推荐。

## 本次实现

- 首页补充平台介绍和接入指南入口，复用现有多语言文案。
- 默认与经典主题都包含描述、社交分享信息和 JSON-LD；保留 New API 的原有标题及项目归属。
- `/guides/getting-started.html` 和 `/guides/getting-started-zh.html` 是完整静态页面，不依赖 JavaScript、登录或数据库读取。两页提供互相对应的语言链接、canonical 和 TechArticle 数据。
- 指南内容包括适用人群、Base URL、Chat Completions 示例、价格来源、套餐估算限制、24h 成功率含义及支持联系方式。
- 两主题提供 `/robots.txt`、`/sitemap.xml` 和 `/llms.txt`。`llms.txt` 是辅助文档，不是已被所有 AI 搜索采用的标准。
- Go 网页路由为首页、模型定价、套餐和政策页面返回 HTTP canonical Link；登录、控制台等应用页面返回 `X-Robots-Tag: noindex, nofollow`。
- 公开抓取文件和指南缓存一小时，便于更新后重新抓取。

共享指南的源文件在 `web/public/guides/`，由两个主题的 Rsbuild 配置复制到各自构建目录，避免两套指南内容分叉。

## 发布与核对

这些是源码改动，须构建并发布包含本次改动的新镜像，然后更新服务器的 new-api 容器。数据库无需因本次 GEO 优化迁移。仅修改 Cloudflare DNS 不会发布代码。

发布后检查：

```bash
curl -fsS https://newtonrouter.com/robots.txt
curl -fsS https://newtonrouter.com/sitemap.xml
curl -fsS https://newtonrouter.com/llms.txt
curl -fsSI https://newtonrouter.com/pricing
curl -fsSI https://newtonrouter.com/sign-in
curl -fsS https://newtonrouter.com/guides/getting-started-zh.html
```

前三个地址应返回文本或 XML，不能返回 React 首页 HTML；`/pricing` 应有指向本页的 canonical Link；`/sign-in` 应有 noindex 响应头。关闭 JavaScript 也应能阅读指南。

如果 Cloudflare 对这些地址设置了缓存，发布后清理相关缓存。检查 Security/Bots 和 WAF 的实际规则，避免公开指南对正常搜索抓取器返回挑战页面；保留账号和 API 的访问保护。搜索抓取与模型训练抓取应分别按业务意愿配置，不必为 GEO 开放所有训练爬虫。

## 后续维护

1. 在 Google Search Console 和 Bing Webmaster Tools 中验证域名并提交 `https://newtonrouter.com/sitemap.xml`，检查抓取和索引状态。
2. 将真实的接入教程、模型对比和排错内容持续写入公开指南。价格引用必须标明计费单位、适用分组和核对时间，避免写死容易过期的模型价格。
3. 同步维护中英文页面、`llms.txt` 和 sitemap 中的链接；只加入实际可访问的公开页面。
4. 观察搜索流量、AI 引用来源与转化。网站被收录与被 AI 引用是两个不同结果，不以一次搜索或一次模型回答判断成效。

当前价格表与套餐的实时数据仍由 React 读取接口，本次没有为这些表格实现完整的服务端渲染。不能执行 JavaScript 的抓取器可以阅读静态指南，但不能从该指南得到实时模型价格。
