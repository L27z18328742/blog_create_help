# 博客全文翻译

桌面 Chrome 扩展。点击“翻译全文”后，在当前博客的原页面显示简体中文，再次点击即可切回原文。图片、代码、标题层级、列表、链接目标和已有事件监听器保持原样。

## 安装和使用

需要 Node.js 24 或更新版本和 Chrome 120 或更新版本。

```bash
npm ci
npm run build
```

1. 打开 `chrome://extensions`，开启“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择本项目的 `dist` 目录。
3. 打开扩展的“服务设置”，填写 API 地址、模型和密钥，保存并授权访问服务域名。
4. 打开一篇英文博客，点击扩展图标，再点“翻译全文”。
5. 翻译完成后使用“切回原文”或“显示中文”；当前页面会话内切换不再请求 API。

MiMo 默认配置：API 地址 `https://api.xiaomimimo.com/v1`，模型 `mimo-v2.5-pro`。基础地址会自动补全 `/chat/completions`，也可填写完整地址。其他服务须支持 Bearer 鉴权、Chat Completions、流式 SSE 和 `response_format: {type: "json_object"}`。不自动升级或切换模型。

密钥保存在 Chrome 的 `storage.session`，仅可信扩展上下文可读，浏览器重启后需要重新填写。“清除密钥”可立即删除。API 地址与模型保存在本机 `storage.local`。不使用同步存储，不把密钥打包进扩展。

## 第一版支持范围

- 优先识别唯一 `article` 或 `itemprop="articleBody"` 容器，否则使用唯一 `main` / `role="main"` 容器。要求含段落且正文至少 80 字符；无法识别、多篇文章索引等情况会明确报错。
- 导航、侧栏、页脚、常见评论/广告容器及隐藏内容不参与翻译。这是保守的通用识别，不能保证覆盖所有站点的自定义标记。
- 整篇正文的文本片段、段落分组和代码上下文在一次请求中发送，帮助模型统一术语。代码只作上下文，保留原节点。图片本身、图片内文字、视频、音频不翻译。
- 最大 40,000 字符或 2,000 个非空文本片段。超限在发送前拒绝；模型输出截断、缺失、重复分段或格式错误时不应用译文。
- 完整验证后一次性替换文本，不插入模型生成的 HTML。正文发生变化时拒绝应用旧译文；切换时检测到变化，会恢复仍匹配缓存的译文节点并提示重新翻译。
- 请求无自动重试，最长等待 2 分钟。超时或网络中断时服务仍可能已经计费，由用户决定是否重试。
- 页面刷新、导航或关闭后不保留译文。不爬取整站，不做后台批量翻译；无需服务器、数据库或登录本工具。

保留格式指保留 DOM 结构与原网页样式，译文自然换行后高度可以变化。网站的固定高度或复杂布局仍需人工核对，不承诺任意网页的像素级还原或动态页面兼容。

## 开发和测试

```bash
npm run typecheck
npx playwright install chromium
npm test
```

测试在真实 Chromium 中安装临时扩展，用自写文章和本机 HTTP 翻译服务替身验证完整页面行为。自动化加载实际 `popup.html`，仅将浏览器的“当前标签页查询”指向文章标签，并在临时清单中授予本机页面权限；生产清单仍使用 `activeTab`。Chrome 工具栏的点击和权限确认弹窗需人工验收。

普通测试不读取真实密钥、不调用付费服务。测试覆盖全文替换与恢复、结构/代码/图片/链接保留、错误响应、译文不完整、截断、重复点击、页面变化、长文拒绝、密钥清除以及 HTML 注入防护。

真实 API 验收需要本地 `.env.local`（已被 Git 忽略，建议权限 `600`）：

```dotenv
MIMO_API_KEY=你的密钥
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5-pro
```

```bash
npm run test:api   # 查询模型列表，并翻译两句自写文本；会产生用量
npm run test:live  # 通过扩展翻译自写完整样文并恢复；会产生用量
```

真实测试关闭追踪录制，截图与译文仅写入被忽略的 `test-results/`。不要对包含真实密钥的运行启用调试追踪或网络日志。真实测试不等同于任意文章的翻译质量保证。

如使用独立的浏览器下载目录，在安装和测试命令前设置同一 `PLAYWRIGHT_BROWSERS_PATH`。

## 设计和参考

`src/content.ts` 管理当前文章会话、正文提取和可逆文本替换；`src/background.ts` 读取可信配置、发起流式请求并校验完整译文；`src/protocol.ts` 定义数据和校验约束；`src/options.ts` / `src/popup.ts` 处理扩展页面交互。

需求基线为 [SPEC.md](SPEC.md)。该文件保留访谈草案原貌；其中失败提示、请求去重、会话缓存、保守正文识别和长文限制等建议，作为本次实现选择落地，未追溯改写为访谈中已确认的需求。测试采用规格建议的完整浏览器流程；未将本次测试事后补写描述为预先约定的 TDD。

- [Chrome 脚本注入与 activeTab](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome 存储与访问控制](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [扩展 Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)
- [MiMo Chat Completions API](https://mimo.mi.com/docs/en-US/api/chat/openai-api)
- [MiMo 可用模型列表](https://mimo.mi.com/docs/zh-CN/api/model/list-models)

当前没有外部 issue tracker。如以后需要按 Matt Pocock 的工作流发布规格或工单，可运行 `/setup-matt-pocock-skills` 配置；本地开发和测试不依赖它。
