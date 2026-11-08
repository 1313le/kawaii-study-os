# kawaii / STUDY OS

个人学习博客：双皮肤（像素 / 线稿）、作者密码保护、会动的猫女作者卡与猫女线场 logo、CSDN 式文章列表与阅读 / 点赞 / 收藏、作者写作 LIVE、Markdown 笔记管线、8bit 写作台、思维导图、资源库、站内 AI 创作助教。
纯静态站点，不需要服务器和数据库；所有内容来自 `notes/*.md`。

- 首页 `index.html`：猫女动画作者卡 + 精选文章 + 最近文章 + 资源概览；线稿主题 hero 是猫女量化线场立体像，悬停显示 HEAD / EYES / HAND 检测框与写作 LN/COL
- 文章 `logs.html`：全文搜索、类型 / 栏目 / 标签筛选（标签默认折叠）、按时间 / 阅读 / 点赞 / 收藏排序、归档视图
- 笔记 `note.html?slug=…`：目录、代码、公式、图表、双链、封面动效、阅读 / 点赞 / 收藏、内嵌导图
- 写作台 `write.html`：8bit 复古终端，底排 4 主键 + Fn 功能键（F5–F10 收进 FUNCTION KEYS 面板），编辑 / 分屏 / 全渲染预览 / 导图、全屏、封面导入、AI 润色纠错与特效创作（作者入口 ✎）；默认开启 LIVE，把当前标题、光标前 4 行和 LN/COL 公开到关于页
- 思维导图 `mindmap.html`：选笔记或贴 Markdown，折叠 / 缩放 / 定位源文，复制嵌入片段，导出 SVG / PNG
- 资源库 `resources.html`：智能识别网址、拖拽 / 本地上传、AI 分类、页内观看、一键下载
- 关于 `about.html`：新版 8 秒猫女桌前景循环 + 实时 CRT；访客可看到作者的 LIVE 写作投影
- 视觉研究 `identity-in-lines.html`：独立单文件（量化线场 × 弹簧物理）

## 公开博客与日夜模式

- 访客默认只读：首页、文章、文章详情、资源、关于都能浏览；写作台、分类管理、资源写入需要作者密码。
- 所有内容都是同一套「文章」：笔记、实验、排障、复盘、随笔只是类型标签，不拆成多个模块。
- 文章列表显示阅读 / 点赞 / 收藏，可排序与筛选；搜索命中高亮，筛选状态写进 URL。
- 作者卡使用七帧猫耳少女立绘：敲代码、待机眨眼、喝咖啡、写完开心、思考、犯困，状态文字同步；眨眼只换帧，不会把状态字幕从「待机中」跳到「眨了眨眼」。系统减少动效或关掉 FX 时停在待机帧。侧栏可直接搜索，首页首篇是带封面的精选卡。
- `LIVE` 默认开启：写作台会把标题、光标位置和光标前 4 行发到本机 `/api/live`，关于页的 CRT 与首页线场 HUD 会显示 `LIVE · LN / COL`。点 `LIVE` 暂停；关闭写作台也会停止。静态托管没有服务端，LIVE 自动退回本地共写。
- 站点 logo 已统一为猫女：masthead/footer/favicon 使用猫女头剪影，线稿首页使用猫女半身像的量化线场浮雕；`identity-in-lines.html` 也加入 kawaii 猫女样例。
- 日夜模式默认跟随本地时间（06:00–18:00 白天），页头可固定为 DAY / NIGHT / AUTO。
- 页头 ✎ 是作者入口；第一次打开写作台会设置密码。

## 本地运行

需要 Node.js 20+（构建与本地服务）和 Chrome（仅测试需要）。

```bash
npm install
npm run build      # 把 notes/*.md 编译成 data/notes.generated.js
npm start          # 构建并启动 http://127.0.0.1:4173
```

只预览已有页面时，直接双击 `index.html` 也能看；但**写作台保存到 `notes/` 需要本地服务**（`npm start`），线上版本请用写作台的「导出」拿 `.md`。

## 作者与安全

- 站点默认**只读公开**：访客能看所有文章，但不能保存、改分类、上传素材或改资源。
- 第一次打开 `write.html` 会要求设置**作者密码**（至少 8 位）。密码用 PBKDF2-SHA256 加盐哈希存在 `data/auth.json`，不会写明文；登录后是 HttpOnly + SameSite=Strict 的签名 Cookie，默认 7 天。
- 登录带算术验证码，连续输错 5 次会短暂锁定；写接口同时校验 Origin，跨站页面无法调用。
- 写作台、分类管理、资源库的写操作都走同一套作者会话；`/api/notes` 与 `/api/note`（原始 Markdown、含草稿）也仅作者可读。
- **LIVE 隐私**：写作台默认把「标题 + 光标前 4 行 + LN/COL」发到本机内存，公开给访问 `/api/live` 的人；这是站点的实时写作直播。点写作台屏幕栏的 `LIVE` 立即停止，关闭写作台也会停止；服务端 45 秒无心跳自动失效。不要把密码、密钥或私人信息留在光标附近。静态托管下没有 `/api/live`，LIVE 自动退回本地共写。
- 忘记密码：删除 `data/auth.json` 后重启服务，再重新设置。
- 服务默认只监听 `127.0.0.1`。如果要暴露到局域网/公网，请放在 HTTPS 反向代理后；首次设置需要终端打印的 6 位设置码。
- 测试与无密码的本地脚本可用 `KAWAII_AUTH=off` 关闭认证（仅限测试环境）。

## 写一篇笔记

### 方式一：写作台（推荐）

打开 `write.html`（页头 ✎ 作者入口，或在终端里输入 `write`）：

- `F1` 切换 编辑 → 分屏 → 预览 → 导图；分屏 / 预览优先调用站内完整渲染器，callout、SEC 分节、PWM / RC 演示、WaveDrom、Mermaid 与最终文章一致，服务不可用时回退本地渲染
- slash 菜单可插入 说明 / 提示 / 警告框、待办、表格、PWM / RC 演示、WaveDrom、Mermaid 与 `mindmap` 导图块
- 「AI 特效 / 封面」会打开站内助教；它可以用 `insert_block` / `apply_style` 在光标处插入内容块、改强调色 / 动效 / 封面
- 底排只保留分屏 / 保存 / 润色 / 纠错 4 个主键；按 `Fn` 展开 FUNCTION KEYS，里面是导出、全屏、新笔记、打字机、焦点、大纲。有扩展模式开着时 Fn 键亮灯，`Esc` 或点外面收起。
- `F8` 打字机滚动 · `F9` 焦点模式 · `F10` 大纲侧栏（快捷键照常可用，不必先展开 Fn）
- `VERSIONS` 打开本地快照：每两分钟与每次保存各留一版，最近 8 版可恢复
- `FONT` / `GLOW` 切换屏幕字体与荧光色；`A−` / `A+` 调正文字号（12–24px，会记住）
- `F6` 全屏沉浸模式，`Esc` 退出；底部有标题 / 栏目 / 日期快捷条
- `Ctrl/Cmd + S` 保存为 `notes/<slug>.md` 并自动重建站点；同名文件会先询问是否覆盖
- 封面：可选 6 套模板，或上传照片自动像素化后存到 `assets/img/`
- `F3` 润色 / `F4` 纠错：需要先配置 OpenAI 兼容接口（右下角或面板内「配置 AI」）

草稿会自动存在浏览器里，刷新不丢。

### 悬浮共写台

在写作台点「打开悬浮共写」，会用 Document Picture-in-Picture 开一块置顶小电视（不支持的浏览器自动退回独立小窗）：

- 切到别的网页查资料时，小电视会实时显示标题、LN / COL、光标前最后几行与全文进度。
- 把截图、文本或链接拖进去（或在小电视里 Ctrl+V），会有一段传送动画，素材落到写作台的「素材箱」。
- 素材箱里点「插入」写到光标处：图片变 `![](...)`，链接变 `[...](...)`，文本直接追加。
- 小电视里点「直接写」可以写一句就按 Enter 插回正文，不用切回写作台。
- 「返回写作台」会关闭小电视并聚焦写作台。

### 方式二：手写 Markdown

在 `notes/` 下新建 `<slug>.md`，然后 `npm run build`。文件名即 URL：`note.html?slug=<slug>`。

```markdown
---
title: 基尔霍夫定律：给电路画一张收支表
date: 2026-11-04
kind: concept
summary: KCL 管节点，KVL 管回路。
tags: 电路, KVL, KCL
collection: 电子基础
cover: template:circuit
accent: cyan
fx: signal
---
```

| 字段 | 说明 |
| --- | --- |
| `title` / `date` | 必填；日期用 `YYYY-MM-DD` |
| `kind` | `article` 日志 / `concept` 概念卡 / `experiment` 实验记录 / `debug` 排障 / `cornell` 问答 / `review` 复盘 |
| `collection` | 自由栏目（生活、日记、读书……），想加就加。留空为「随笔」 |
| `cover` | `assets/img/xxx.webp` 或 `template:circuit｜waveform｜grid｜ladder｜chip｜terminal` |
| `accent` | `lime` / `pink` / `cyan` / `amber` / `blue` |
| `fx` | `reveal` / `scan` / `signal` / `glitch` / `type` / `none` |
| `draft` | `true` 时不进站 |

笔记里可以用 `[[slug]]` 做站内双链，构建时会自动生成反向链接。

## 目录结构

```
notes/              原文（Markdown + frontmatter）
data/notes.generated.js  由 tools/build.js 生成，勿手改
data/resources.json 资源库索引（链接 + 上传文件记录）
files/              上传的文件（流式落盘，支持 Range 下载）
tools/resources.js  资源检测、校验与增删改
tools/build.js      Markdown 渲染、分类、封面校验、反向链接
tools/taxonomy.js   栏目 / 标签的批量改名、合并、删除与一步撤销
tools/serve.js      本地预览 + 写作 / 分类 / 资源接口
assets/js/mindmap.js  Markdown → 双侧树 SVG（折叠 / 缩放 / 导出）
assets/css|js       样式与前端模块（无框架、无构建）
```

## 测试

```bash
npm test
```

23 个套件、192 条测试：Markdown 渲染、作者认证、文章指标、笔记存储、分类改写与撤销、分类管理 UI、写接口、写作台、写作体验（打字机 / 大纲 / slash / 快照 / 特效预览 / 4 主键 + Fn 键位表 / 手机一行键盘 / 首屏可见）、思维导图与嵌入、资源库（上传 / Range / 探测 / 智能识别）、悬浮共写、封面、动效开关、AI 助教与创作工具、阅读、实验台、场景、站点外壳、博客外壳（猫女立绘 / 精选卡 / 标签折叠 / 侧栏搜索）、写作 LIVE（公开端点 / 默认开播 / 访客 CRT / 暂停隐藏）、徽标（猫女线场 / 头眼框对齐 / 直播卡片）、视觉边界。测试会启动本地服务并用本机 Chrome 跑真实页面，请确保没有别的服务占用 4261 端口。

## 部署到 GitHub Pages

### 方式一：GitHub Actions（推荐）

仓库已带 `.github/workflows/pages.yml`。推送到 `main` 后：

1. 仓库 **Settings → Pages → Source** 选 **GitHub Actions**；
2. 之后每次 push，工作流会 `npm ci --omit=dev` → `node tools/build.js` → 只把 `*.html`、`assets/`、`data/`、`notes/` 打包发布（不会带上 `node_modules` 和临时目录）。

首次推送：

```bash
git init
git add .
git commit -m "init: kawaii / STUDY OS"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

### 方式二：直接从分支发布

1. **Settings → Pages → Deploy from a branch → main / (root)**；
2. 每次改完笔记，先在本地 `npm run build`，把 `data/notes.generated.js` 一起提交，否则线上看不到新文章。

`.nojekyll` 已就位，`assets/`、`data/` 这类目录不会被 Jekyll 忽略；`404.html` 会被 Pages 直接使用。

## 资源库

打开 `resources.html`（导航「03 资源」，或终端 `res`）：

- **链接**：B 站 / YouTube 自动转成页内播放器；网盘存链接与提取码；PDF / 图片 / 直链 mp4 页内打开；普通网页给常驻「新窗口打开」。
- **上传**：PDF、EPUB、压缩包、安装包、视频、图片，单个最大 300MB。文件流式写入 `files/`，下载支持断点 Range。
- **整理**：分类、标签、搜索、类型筛选、排序；筛选状态写进 URL。
- **智能识别**：把网址粘到顶部识别框，服务端会抓取标题 / 描述并建议分类；文件或链接也可以直接拖到页面任意位置；「AI 识别分类」会填入分类、标签与说明。
- 抓取只允许公网地址，8 秒 / 512KB 上限，内网与 localhost 会被拒绝。
- **AI 推荐**：助教可以用 `propose_resources` 把推荐放进资源库页的「AI 推荐」区，核对后一键导入，不会直接写库。
- 静态托管下浏览与打开照常，写入 / 上传需要本地服务。

## 站内 AI 助教

- 右下角「问助教」或 `Ctrl/Cmd + K`；终端里也可以 `ask <问题>`。
- 接口由你自己提供（BYOK），只存在浏览器里：面板内选服务商、粘贴 Key、点「保存并测试」。
- 浏览器可直连：DeepSeek、Kimi、SiliconFlow、OpenRouter；智谱需要在前面加一层代理。
- 它知道站内所有笔记与栏目，能检索、能读全文、能按「类比 → 最小步骤 → 自测题」讲概念；只有你明确要求时才替你切换皮肤 / 动效，不会自动改内容。
- 在写作台打开助教时，它还能用 `insert_block` 插入警告框 / 演示 / 导图等块，用 `apply_style` 改强调色、动效或封面；所有改动只落在当前草稿里。

## 导图嵌入

- 在正文里写 ` ```mindmap ` 围栏，里面放 `#` / `##` / 列表大纲；文章页会把它渲染成可折叠、可缩放的导图。
- `mindmap.html` 工作台选好笔记后点「复制嵌入片段」，把整段粘贴到写作台即可。
- 笔记页侧栏仍保留「导图视图」，可以整篇折叠成一张图；访客也能用。

## 动效与无障碍

- 右上 `FX` 开关控制全站动效；系统开启「减少动态效果」时站点默认静止，左下角会给出提示与一键恢复。
- 所有动画都遵守 `prefers-reduced-motion`，并支持键盘操作。
- 写作台、AI 面板、来源弹窗等均可键盘操作。

## 说明

本站是个人学习记录，不是课程平台；内容按「写了什么」组织，栏目由自己定义。原始笔记全部是 Markdown，随时可以迁走。
