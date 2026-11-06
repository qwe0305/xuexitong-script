# 学习通刷课脚本

超星学习通（chaoxing.com）课程自动化：**自动播放 · 自动切节 · 自动关弹窗 · AI 答题 · 本机 Agent 双向控制**。

> 本项目基于 [chaolucky18/xuexitongScript](https://github.com/chaolucky18/xuexitongScript) 的 `v3_optimized.js`（MIT）重写为浏览器扩展形态，并新增 Agent 控制层、心跳上报、AI 答题模块。
> 仅供前端自动化研究与个人学习效率实验，请遵守所在平台的使用规定。

---

## 一键安装

在 PowerShell 里粘贴其中一行（国内网络推荐第一条）：

```powershell
# 国内加速（jsDelivr CDN）
irm https://cdn.jsdelivr.net/gh/qwe0305/xuexitong-script@main/install.ps1 | iex

# 直连 GitHub
irm https://raw.githubusercontent.com/qwe0305/xuexitong-script/main/install.ps1 | iex
```

执行后自动完成：检查 Node → 多源下载源码（codeload / github / 镜像依次尝试）→ 安装到 `%USERPROFILE%\WorkBuddy\xuexitong-script` → 启动。

**分享给别人时，只需发一个网址**：

```
https://github.com/qwe0305/xuexitong-script
```

对方把网址丢给自己的 AI 助手，说"照这个装"，助手读 [`AGENT.md`](AGENT.md) 就能自己完成安装与验证。

国内网络也可用 Gitee 镜像：
```
https://gitee.com/qwe0305/xuexitong-script
```

---

## 手动三步（不想跑脚本时）

1. 装 [Node.js 22+](https://nodejs.org/zh-cn/download)（一路下一步，装完重开终端）
2. 双击 **`start.cmd`**
3. 在弹出的浏览器里登录学习通、点进任意一门课程 —— 之后就交给它，窗口可以最小化

想纯后台无窗口：先完成一次上面的登录，然后双击 **`start-headless.cmd`**。

---

## 它和原脚本有什么不同

| 能力 | 原版 userscript | 本项目 |
| --- | --- | --- |
| 自动播放 / 切下一节 | ✅ | ✅ |
| 视频元素定位 | 只认 `video#video_html5_api` | 多层兜底（`app._videoEl` → 主文档 → 同源 iframe） |
| 识别不到视频 | 立刻停止，不重试 | 等 60 秒仍无视频则自动跳过本节 |
| 播完卡住不跳节 | 无处理 | 30 秒后自动重试切换 |
| 进度卡死（暂停） | 部分处理 | 45 秒未推进强制恢复播放 |
| 防挂机弹窗 | ❌ 需要人点 | 自动点「继续学习 / 我知道了 / 点击继续」等 |
| 状态可见 | 只能看控制台 | 每 5 秒上报本机 `/status`，命令行随时查 |
| 远程控制 | ❌ | Agent 下发指令（切节 / 播放 / 改倍速 / 点按钮） |
| 章节测验 | 只做受限跳转 | 抓题干调大模型作答（可选自动提交） |

---

## 架构

```
 浏览器（已登录学习通）
 ┌─────────────────────────────────────────────┐
 │ core.js   MAIN 世界：播放/切节/看门狗/指令监听 │
 │ assist.js 隔离世界：关弹窗、心跳、拉指令        │
 │ quiz.js   隔离世界：抓题 → 问 AI → 点选项      │
 │ bg.js     Service Worker：转发请求，绕开 CSP   │
 └───────────────┬─────────────────────────────┘
                 │ POST /hb   GET /poll   POST /ask
                 ▼
 ┌─────────────────────────────────────────────┐
 │ agent/server.mjs   127.0.0.1:8731 本机中枢    │
 │   latest.json / heartbeat.log / commands.log │
 └───────────────┬─────────────────────────────┘
                 │ HTTP
                 ▼
        agent/agent.py  决策器 / 命令行
```

**为什么要一个本机服务**：浏览器扩展无法把状态写到文件，Agent 也无法直接读页面。用 `127.0.0.1` 做中转，两个方向都打通：页面能上报，Agent 能下发。

---

## 安装

### 1. 载入扩展

1. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`）
2. 打开「开发人员模式 / 开发者模式」
3. 「加载解压缩的扩展」→ 选择本仓库的 `extension/` 目录
4. 确认扩展已启用（改动代码后回来点「重新加载」，再刷新课程页）

### 2. 启动本机中枢

```bash
node agent/server.mjs
```

看到 `[xxt-agent] listening http://127.0.0.1:8731` 即成功。默认数据落在 `data/`（可用环境变量 `XXT_DATA` 改）。

### 3. 配置 AI 答题（可选，不配也能刷课）

复制 `agent/config.example.json` 为 `agent/config.json`，填入你的大模型 key：

```json
{
  "llm": {
    "base": "https://api.deepseek.com/v1",
    "key": "sk-你的key",
    "model": "deepseek-chat"
  }
}
```

兼容任何 OpenAI 格式接口：通义、智谱、Kimi、本地 Ollama（`http://127.0.0.1:11434/v1`）都可。
也可用环境变量：`XXT_LLM_BASE` / `XXT_LLM_KEY` / `XXT_LLM_MODEL`。

验证：`curl http://127.0.0.1:8731/ai-status` → `{"ready":true}`

---

## 两种跑法：扩展 或 纯后台驱动（不用插件）

| | 方案 A：浏览器扩展 | 方案 B：CDP 后台驱动 |
| --- | --- | --- |
| 需要装插件 | 是 | **否** |
| 浏览器可见 | 需要在窗口里 | **可以完全无窗口（headless）** |
| 原理 | 扩展注入页面脚本 | 通过调试协议从外部在页面执行 JS |
| 用你现有登录态 | 是（Edge 默认配置） | 否，需在独立配置目录登录一次 |
| 适合 | 边用电脑边刷 | 挂机、关机前挂着跑 |

### 方案 B：纯后台，不装插件

**第一次（只需一次，登录用）**

```bash
node driver/launch.mjs --url "https://mooc1.chaoxing.com/"
```

这会在**独立配置目录**（`~/WorkBuddy/chaoxing-profile`）打开一个全新浏览器，里面没有你的登录态。在这个窗口里正常登录学习通、进一次课程，然后关掉即可。登录状态会存在这个目录里。

**之后（完全后台）**

```bash
node driver/drive.mjs --url "<课程播放页URL>"
```

默认 headless：不弹窗、不占任务栏，脚本在后台把视频播完、自动切下一节。也可以双击 `run.cmd "<课程页URL>"`。

常用参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--windowed` | 关 | 改为有窗口运行（headless 被平台识别时用，可最小化） |
| `--rate` | **1.0（已锁死）** | 无效参数。传非 1.0 只会打印警告并被忽略，原因见下节「倍速与跳播的实测结论」 |
| `--interval` | 3 | 轮询间隔（秒） |
| `--skip-after` | 60 | 无视频多少秒后跳过该节 |
| `--max-hours` | 10 | 最长运行时长 |
| `--port` | 9222 | CDP 端口 |

它会自动：本机中枢没跑就先拉起 → 浏览器没开就带调试端口拉起 → 每 3 秒取一次页面快照（视频进度、小节名、待点弹窗）→ 需要时点播放 / 点弹窗 / 点下一节 → 状态照旧写入 `/hb`，所以 `agent.py status`、`agent.py watch` 都能继续用。

**首次带窗口跑一遍更稳**：`node driver/drive.mjs --windowed --url "<URL>"`，确认它在动，之后再换 headless。

---

## 使用

打开课程播放页（URL 含 `/mycourse/studentstudy`），脚本自动接管，无需操作。

### 命令行

```bash
python agent/agent.py status        # 看状态：小节 / 进度 / 是否暂停 / 是否卡住
python agent/agent.py watch         # 无人值守：每 20 秒自动决策并下发指令
python agent/agent.py watch --interval 30 --max-hours 6
python agent/agent.py next          # 手动切下一节
python agent/agent.py play          # 恢复播放
python agent/agent.py rate 1        # 倍速只能是 1.0，改成别的会被平台锁死播放
python agent/agent.py click 继续学习 # 按文字点按钮
python agent/agent.py config '{"autoSkipNoVideo": false}'
```

### 页面内可调参数

控制台执行，或通过 `agent.py config` 下发：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `playbackRate` | 1.0 | 倍速。**只能 1.0**，非 1.0 会被 ananas 判异常并锁死播放（见上文实测） |
| `autoSkipNoVideo` | true | 无视频页面是否自动跳过 |
| `skipNoVideoAfterMs` | 60000 | 等多久判定为无视频页 |
| `endedRetryAfterMs` | 30000 | 播完后多久重试切节 |
| `stuckResumeAfterMs` | 45000 | 进度停滞多久强制恢复 |
| `tickMs` | 2000 | 巡检间隔 |

AI 答题相关（`localStorage['xxt_quiz_config']`）：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | true | 是否启用答题 |
| `autoSubmitQuiz` | **false** | 是否答完自动提交。默认关闭，只勾选不提交 |
| `intervalMs` | 6000 | 每题间隔，避免请求过密 |

---

## 目录

```
extension/         浏览器扩展（方案 A，直接加载这个目录）
  manifest.json
  core.js          播放/切节/看门狗/指令监听（MAIN 世界）
  assist.js        弹窗处理 + 心跳上报 + 指令轮询
  quiz.js          AI 答题
  bg.js            Service Worker
driver/            纯后台驱动（方案 B，不用插件）
  launch.mjs       拉起带调试端口的浏览器（登录用）
  drive.mjs        主循环：取快照 → 决策 → 点播放/切节
  cdp.mjs          极简 CDP 客户端（零依赖，用 Node 内置 WebSocket）
  browser.mjs      浏览器启动参数与端口探测
agent/             本机中枢与 Agent
  server.mjs       状态接收 + 指令队列 + /ask 转发
  ai.mjs           大模型调用与答案归一化
  agent.py         命令行 + 自动决策器
  config.example.json
run.cmd            双击即跑（方案 B）
tests/             可复现的验证脚本（都可直接 node 跑）
  rate-125.mjs       倍速对照实验：1.0 → 1.25 → 1.0，输出实测倍率
  seek-probe.mjs     可跳转范围 / 缓冲范围探测
  catalog-probe.mjs  打印目录树节点及当前小节标记
  catalog-dom.mjs    打印单个目录节点的完整结构与 onclick
  switch-test.mjs    点下一节 → 点回来，验证切节是否真的生效
  end-test.mjs       播完自动切节的端到端观察
  frame-probe.mjs    跨域 iframe（OOPIF）穿透合成测试
  diag-live.mjs      只读诊断：每个 frame 的视频状态
docs/
  upstream-v3_optimized.js.txt   上游原始脚本存档
```

---

## 倍速与跳播的实测结论（重要）

这两件事在本项目里做过严格的对照实验，结论是**都不可行**，所以驱动直接把倍速锁死 1.0，不再提供加速开关。

### 一、任何非 1.0 倍速都会被强制锁死播放

实验脚本 `tests/rate-125.mjs`：同一节视频，依次 1.0x → 1.25x → 1.0x，每 3 秒采一次样。

| 阶段 | 真实耗时 | 视频推进 | 暂停次数 | 实测倍率 |
| --- | --- | --- | --- | --- |
| A 基线 1.0x | 15s | 15.1s | 0 | **1.01x** |
| B 测试 1.25x | 27s | **0.0s** | **9** | **0.00x** |
| C 回退 1.0x | 15s | 15.1s | 0 | **1.01x** |

更有意思的是 B 阶段里播放器自己把 `playbackRate` 改回了 `1`，但画面依旧不动 —— 说明它不是"改回倍速就恢复"，而是**检测到非官方倍速后直接锁死播放**，必须等倍速回到 1.0 再重新 `play()` 才解锁。1.5x 的实测结果同 1.25x（每 3~9 秒被暂停一次，进度原地打转）。

另外试过"点播放器自己的倍速菜单"（`tests/try-menu-rate.mjs`、`try-menu2.mjs`）：`.vjs-playback-rate` 按钮确实存在，但它的 `.vjs-menu-content` 的 `innerHTML.length` 是 **0**，弹出菜单里只有字幕、线路、清晰度 —— **这门课根本没提供倍速选项**，这条路在未提供倍速的课程上走不通。

### 二、不能跳着看，seek 会被拽回原位

`tests/seek-probe.mjs` 显示 `seekable` 是完整的 `0–2380s`，缓冲里也出现了 `[2346.2, 2355.7]`（说明 seek 确实触发了分片加载），但把 `currentTime` 设成 2355 之后，3 秒时读到的进度仍然是被拦回的原位，随后从原位继续播。
即：**超星主动拦截跳播**，不是 MSE 缓冲不足的技术限制。所以想"跳到结尾"来加速同样行不通，一节课必须按真实时长走完。

### 三、切下一节：已修好并用真实点击验证

`tests/switch-test.mjs` 做了"点下一节 → 立刻点回来"的往返验证：

- 当前 `4.4 教学视频 1`，`chapterId=1261415881`
- 点下一节后变成 `5.1 科学预言…`，`chapterId=1261415860` ✅
- 再点回来，恢复 `4.4 教学视频 1` ✅

过程中踩到两个 DOM 细节，已修进 `driver/drive.mjs`：

1. 当前小节用的是 `class="posCatalog_select posCatalog_active"`，**不是** `active`。旧的 `findIndex` 恒等于 `-1`，导致"点目录树下一节"一直是失效的（只是碰巧有上一节/下一节按钮兜底）。
2. 真正绑定跳转的不是 `.posCatalog_select` 这个 div，而是它里面的 `span.posCatalog_name`，其 `onclick="getTeacherAjax(courseId,clazzid,chapterId)"`。点 div 无效，点 span 才跳。

---

## 已知限制

- **方案 B 需要单独登录一次**：CDP 调试端口在 Chrome/Edge 136+ 不允许使用默认配置目录，因此用独立 profile，登录态不与你日常浏览器共享。
- **只能 1.0 倍速、只能实时**：见上一节的三组实验。想省时间只能靠"挂机"，靠不了"加速"。

- **headless 被识别**：少数课程会检测无头浏览器特征（`navigator.webdriver` 等）。若视频播不动或立刻暂停，改用 `--windowed` 并把窗口最小化。
- **扩展方案不能关窗口、不能让电脑睡眠**，否则播放与心跳一起断。标签页切后台、窗口最小化不影响。
- 超星的播放器常在**跨域 iframe** 里（`mooc1` 与 `ananas` 等子域不同源）：
  - 方案 B（驱动）已解决：通过 CDP 的 `Target.setAutoAttach` 挂载 OOPIF 会话，逐个 frame 执行探针，`tests/frame-probe.mjs` 有对应验证
  - 方案 A（扩展）仍受限：`assist.js` 按帧注入能拿到状态，但切节依赖主帧的目录树
- 测验页面结构在超星多套模板间差异很大，`quiz.js` 用多组选择器兜底，抓不到会在控制台明确打印原因，需要按实际 DOM 补选择器。
- AI 答题的准确率取决于模型与题库覆盖度，**默认不自动提交**，请自行核对后再交卷。
- 扩展方案依赖页面自带的 jQuery；若页面未加载会从 `code.jquery.com` 拉取，校园网墙掉时需改为本地注入。

---

## 免责声明

本项目仅用于前端自动化研究与技术学习。使用自动化工具刷课可能违反平台用户协议与学校教学管理规定，产生的后果由使用者自行承担。作者不对任何学术诚信问题、账号处罚或数据损失负责。
