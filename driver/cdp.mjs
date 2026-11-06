/**
 * cdp.mjs —— 极简 Chrome DevTools Protocol 客户端（零依赖，Node 22+ 自带 WebSocket）
 *
 * 用途：不装扩展，直接连上浏览器，在页面里执行 JS。
 */

const DEFAULT_PORT = Number(process.env.XXT_CDP_PORT || 9222);

function base(port) {
  return `http://127.0.0.1:${port}`;
}

async function j(url, opts = {}) {
  const res = await fetch(url, { cache: 'no-store', ...opts });
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { return { raw: text }; }
}

export async function listPages(port = DEFAULT_PORT) {
  return j(`${base(port)}/json/list`);
}

export async function version(port = DEFAULT_PORT) {
  return j(`${base(port)}/json/version`);
}

/** 新建标签页（不同 Chrome 版本支持 GET/PUT，这里都试） */
export async function newTab(url, port = DEFAULT_PORT) {
  const target = `${base(port)}/json/new?${encodeURIComponent(url)}`;
  let r = await j(target, { method: 'PUT' });
  if (!r || !r.webSocketDebuggerUrl) r = await j(target, { method: 'GET' });
  return r;
}

export class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.contexts = new Map();      // contextId -> { id, origin, name, auxData }
    this.sessions = new Map();      // sessionId -> { targetId, url, type } 跨域 iframe（OOPIF）
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      // 事件：维护 frame 执行上下文列表（跨域 iframe 也能取到）
      if (msg.method === 'Runtime.executionContextCreated') {
        const c = msg.params.context;
        this.contexts.set(c.id, c);
      } else if (msg.method === 'Runtime.executionContextDestroyed') {
        this.contexts.delete(msg.params.executionContextId);
      } else if (msg.method === 'Runtime.executionContextsCleared') {
        this.contexts.clear();
      } else if (msg.method === 'Target.attachedToTarget') {
        const { sessionId, targetInfo } = msg.params;
        this.sessions.set(sessionId, {
          targetId: targetInfo.targetId,
          url: targetInfo.url,
          type: targetInfo.type,
        });
      } else if (msg.method === 'Target.detachedFromTarget') {
        this.sessions.delete(msg.params.sessionId);
      }
    });
  }

  /** 打开 Runtime 并挂载跨域 iframe（OOPIF），等事件到达 */
  async watchContexts(waitMs = 500) {
    await this.send('Runtime.enable').catch(() => {});
    await this.send('Page.enable').catch(() => {});
    // flatten=true 让 OOPIF 以 sessionId 形式挂到当前连接上
    await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
    await this.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
    await new Promise((r) => setTimeout(r, waitMs));
    return this.contexts.size + this.sessions.size;
  }

  /** 在跨域 iframe 会话里执行 */
  async evalInSession(sessionId, expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, sessionId);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.text || '会话执行异常');
    }
    return r.result?.value;
  }

  /** 在指定 context 里执行 */
  async evalIn(contextId, expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.text || '上下文执行异常');
    }
    return r.result?.value;
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', (e) => reject(new Error('WS 连接失败：' + (e.message || 'unknown'))), { once: true });
    });
    return new Page(ws);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30000);
    });
  }

  /** 在页面执行表达式，返回 JS 值 */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.text || '页面执行异常');
    }
    return r.result?.value;
  }

  close() {
    try { this.ws.close(); } catch (e) {}
  }
}

/** 找到（或打开）课程页并连上 */
export async function attach(startUrl, port = DEFAULT_PORT) {
  let pages = [];
  try { pages = await listPages(port); } catch (e) {
    throw new Error(`连不上 CDP（${base(port)}）：浏览器没带 --remote-debugging-port 启动，或端口不对`);
  }
  if (!Array.isArray(pages)) throw new Error('CDP 返回异常：' + JSON.stringify(pages).slice(0, 200));

  // 优先连课程播放页，其次才是任意 chaoxing 页面
  const hit = pages.find((p) => p.type === 'page' && /studentstudy/.test(p.url || ''))
    || pages.find((p) => p.type === 'page' && /chaoxing\.com/.test(p.url || ''));
  if (hit) {
    const p = await Page.connect(hit.webSocketDebuggerUrl);
    await p.watchContexts();
    return p;
  }

  if (!startUrl) throw new Error('没有已打开的 chaoxing 页面，且未提供 startUrl');

  const created = await newTab(startUrl, port);
  if (!created || !created.webSocketDebuggerUrl) throw new Error('新建标签页失败，请手动在浏览器里打开发课程页');
  const page = await Page.connect(created.webSocketDebuggerUrl);
  await page.send('Page.enable').catch(() => {});
  await page.watchContexts();
  return page;
}
