# 学习通刷课脚本

超星学习通（chaoxing.com）课程自动化：**自动播放 · 自动切节 · 自动关弹窗 · AI 答题 · 本机 Agent 双向控制**。

> 本项目基于 [chaolucky18/xuexitongScript](https://github.com/chaolucky18/xuexitongScript) 的 `v3_optimized.js`（MIT）重写为浏览器扩展形态，并新增 Agent 控制层、心跳上报、AI 答题模块。
> 仅供前端自动化研究与个人学习效率实验，请遵守所在平台的使用规定。

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

## 使用

打开课程播放页（URL 含 `/mycourse/studentstudy`），脚本自动接管，无需操作。

### 命令行

```bash
python agent/agent.py status        # 看状态：小节 / 进度 / 是否暂停 / 是否卡住
python agent/agent.py watch         # 无人值守：每 20 秒自动决策并下发指令
python agent/agent.py watch --interval 30 --max-hours 6
python agent/agent.py next          # 手动切下一节
python agent/agent.py play          # 恢复播放
python agent/agent.py rate 2        # 改倍速（持久化到 localStorage）
python agent/agent.py click 继续学习 # 按文字点按钮
python agent/agent.py config '{"autoSkipNoVideo": false}'
```

### 页面内可调参数

控制台执行，或通过 `agent.py config` 下发：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `playbackRate` | 1.5 | 倍速 |
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
extension/         浏览器扩展（直接加载这个目录）
  manifest.json
  core.js          播放/切节/看门狗/指令监听（MAIN 世界）
  assist.js        弹窗处理 + 心跳上报 + 指令轮询
  quiz.js          AI 答题
  bg.js            Service Worker
agent/             本机中枢与 Agent
  server.mjs       状态接收 + 指令队列 + /ask 转发
  ai.mjs           大模型调用与答案归一化
  agent.py         命令行 + 自动决策器
  config.example.json
docs/
  upstream-v3_optimized.js.txt   上游原始脚本存档
```

---

## 已知限制

- **不能关窗口、不能让电脑睡眠**，否则播放与心跳一起断。标签页切到后台、窗口最小化不影响。
- 播放器若在**跨域 iframe** 内，主帧看不到 `<video>`；`assist.js` 已按帧注入兜底，但主帧的“切下一节”依赖课程目录树，仍需要主帧在线。
- 测验页面结构在超星多套模板间差异很大，`quiz.js` 用多组选择器兜底，抓不到会在控制台明确打印原因，需要按实际 DOM 补选择器。
- AI 答题的准确率取决于模型与题库覆盖度，**默认不自动提交**，请自行核对后再交卷。
- 依赖页面自带的 jQuery；若页面未加载会从 `code.jquery.com` 拉取，校园网墙掉时需改为本地注入。

---

## 免责声明

本项目仅用于前端自动化研究与技术学习。使用自动化工具刷课可能违反平台用户协议与学校教学管理规定，产生的后果由使用者自行承担。作者不对任何学术诚信问题、账号处罚或数据损失负责。
