# 给 AI Agent 的安装交接说明

> 用法：把这个文件整个发给你的 AI 助手（"照这个文件帮我装"），它会自己完成安装和验证。
> 人也可以直接看，步骤是一样的。

---

## 你的任务

帮用户在这台 Windows 电脑上装好并跑起「学习通刷课脚本」。它会在浏览器里自动播放超星学习通的课程视频、自动切下一节、自动关防挂机弹窗。

**全程不需要用户输入任何命令**，用户只需要做一件事：在弹出的浏览器里登录学习通并点进一门课程。

---

## 步骤

### 0. 环境检查

```bash
node -v
```

- 输出 `v22.x` 或更高 → 继续
- 提示找不到命令 → 让用户安装：https://nodejs.org/zh-cn/download （选 LTS 版，一路下一步）
- 装完要**新开一个终端**再检查一次

端口要求：`9222`（浏览器调试）与 `8731`（本机中枢）需空闲。

### 1. 获取并安装（推荐一条命令）

在 PowerShell 里执行：

```powershell
irm https://raw.githubusercontent.com/qwe0305/xuexitong-script/main/install.ps1 | iex
```

这一条会做完 3 件事：检查 Node → 把源码下载到 `%USERPROFILE%\WorkBuddy\xuexitong-script` → 直接启动。

如果用户的环境禁止 `irm | iex`，改用 git：

```bash
git clone https://github.com/qwe0305/xuexitong-script.git
cd xuexitong-script
```

两者的后续行为一致。

### 2. 如果用了 install.ps1

install.ps1 装完会自动运行 `start.cmd`，跳到第 3 步即可。

如果没自动起来，手动进入 `%USERPROFILE%\WorkBuddy\xuexitong-script` 运行 `start.cmd`。

### 2b. 如果用了 git clone

在仓库目录直接运行：

```
start.cmd
```

（在终端里 `start.cmd`，或让用户双击。不需要任何参数。）

它会自动依次完成：

1. 检查 Node
2. 启动本机中枢 `agent/server.mjs`（127.0.0.1:8731）
3. 用独立配置目录 + 调试端口拉起 Edge/Chrome
4. 打开学习通门户，然后**每 3 秒检查一次当前页面**
5. 一旦检测到课程播放页（URL 含 `/mycourse/studentstudy`）就开始接管

### 3. 需要用户配合的唯一一步

**明确告诉用户**：在弹出的浏览器窗口里登录学习通、点进任意一门课程。之后窗口可以最小化，脚本自己会跑。

在用户完成这一步之前，终端会一直打印：

```
等待进入课程页：请在弹出的窗口里点进课程（只需第一次），当前：https://mooc1.chaoxing.com/...
```

### 4. 验证（逐条确认，不要跳过）

1. 终端出现类似 `[15:20:31] 3.4 教学视频 1 | 01:23/10:00 播放中` 的行
2. 浏览器里视频确实在自动播放
3. `curl http://127.0.0.1:8731/health` 返回 `{"ok":true,...}`
4. `python agent/agent.py status` 能读出当前小节名和播放进度

四条全部满足才算装好。

### 5. 后续使用

- 想纯后台无窗口：先确认 `start.cmd` 那次登录过，之后双击 `start-headless.cmd`
- 想调倍速：`start.cmd --rate 2`
- 想看状态：`python agent/agent.py status`
- 想让它自己判断并补动作：`python agent/agent.py watch`

### 6. 可选：开启 AI 答题

复制 `agent/config.example.json` 为 `agent/config.json`，填 `llm.key`（DeepSeek、通义、智谱、Kimi、本地 Ollama 都支持，OpenAI 格式）。

验证：`curl http://127.0.0.1:8731/ai-status` 返回 `{"ready":true}`。

⚠️ 默认 `autoSubmitQuiz = false`，只帮你勾选答案、不自动交卷。要改在 `localStorage['xxt_quiz_config']` 或改 `extension/quiz.js` 里的默认值。

---

## 故障对照表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 提示「没有检测到 Node.js」 | 未安装或没进 PATH | 装 Node 22 LTS，重开终端 |
| `调试端口未就绪` | 9222 被占用 / 被安全软件拦 | 关掉其他调试浏览器；把该目录加白名单 |
| 一直「等待进入课程页」 | 用户还没点进课程 | 提示用户点一下；确认登录成功 |
| 视频一播就暂停 | ① 倍速被改成非 1.0（最常见）② 平台识别无头浏览器 | 先确认 `--rate` 是 1.0；仍暂停则改用 `start.cmd`（有窗口）并最小化 |
| `连不上 CDP` | 浏览器被关掉 | 重新运行 start.cmd |
| 卡在测验页不动 | 平台结构变化 | 让用户手动过；把页面截图给 Agent 调选择器 |

---

## 边界与红线（Agent 必须遵守）

1. **不要索取、不要上传用户的账号密码或 cookie**。全部登录都在用户本机浏览器里手动完成。
2. **不要把 `agent/config.json`（含大模型 key）提交到任何仓库或发到聊天里**。
3. 只操作 `chaoxing.com` 域名下的页面，不要扩大范围。
4. 这是自动化工具，可能违反平台用户协议。**必须把 README 的免责声明转达给用户**，由用户自行判断是否使用。
5. 用户明确要求停止时，立刻结束进程（Ctrl+C 或关掉窗口），不要偷偷续跑。

---

## 技术备注（给需要排查的 Agent）

- 方案：CDP（Chrome DevTools Protocol）从外部在页面执行 JS，**不依赖浏览器扩展**
- 浏览器以 `--remote-debugging-port=9222 --user-data-dir=~/WorkBuddy/chaoxing-profile` 启动；Edge/Chrome 136+ 不允许在默认配置目录开调试端口，所以必须独立 profile（这也是需要重新登录一次的原因）
- 主循环在 `driver/drive.mjs`：每次 `Runtime.evaluate` 返回页面快照（小节名 / video 状态 / 待点弹窗），顺带执行播放、关弹窗；播完或无视频 60 秒后点目录树下一节
- 状态同时写入 `http://127.0.0.1:8731/hb`，落盘 `data/latest.json` 与 `data/heartbeat.log`
- 另有一套浏览器扩展实现（`extension/`），两者可二选一，不要同时开
