/**
 * ai.mjs —— AI 答题：调用 OpenAI 兼容接口（DeepSeek / 通义 / 智谱 / 本地 Ollama 均可）
 *
 * 配置优先级：环境变量 > agent/config.json > 默认值
 *   XXT_LLM_BASE  例：https://api.deepseek.com/v1
 *   XXT_LLM_KEY   你的 key
 *   XXT_LLM_MODEL 例：deepseek-chat
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    fileCfg = {};
  }
  const llm = Object.assign(
    { base: 'https://api.deepseek.com/v1', key: '', model: 'deepseek-chat' },
    fileCfg.llm || {}
  );
  return {
    llm: {
      base: process.env.XXT_LLM_BASE || llm.base,
      key: process.env.XXT_LLM_KEY || llm.key,
      model: process.env.XXT_LLM_MODEL || llm.model,
    },
  };
}

const SYSTEM_PROMPT = `你是中国高校课程的选择题答题助手。用户会给出一道题和若干选项。
只输出最终答案，不要解释。格式严格如下：
单选题：一个字母，例如 A
多选题：字母连写，例如 ABD
判断题：正确 或 错误
填空题：直接给出答案内容
如果完全无法判断，输出 UNKNOWN。`;

function buildUserPrompt(q) {
  const opts = (q.options || [])
    .map((o) => `${o.label}. ${o.text}`)
    .join('\n');
  return `题型：${q.type || '单选题'}\n题目：${q.question}\n选项：\n${opts || '(无选项)'}`;
}

function normalize(raw, q) {
  let t = String(raw || '').trim().toUpperCase();
  t = t.replace(/答案[:：]?/g, '').replace(/[。.\s]/g, '');
  if (q.type === '判断题') {
    if (/^(正确|对|T|TRUE|A|√|是)$/.test(t)) return '正确';
    if (/^(错误|错|F|FALSE|B|×|否)$/.test(t)) return '错误';
    return raw.trim();
  }
  const letters = t.match(/[A-Z]/g);
  if (letters && letters.length) return Array.from(new Set(letters)).sort().join('');
  return raw.trim();
}

export async function askLLM(question, opts = {}) {
  const cfg = loadConfig();
  if (!cfg.llm.key) {
    return { ok: false, error: 'NO_KEY', hint: '未配置大模型 key：在 agent/config.json 填写 llm.key，或设置环境变量 XXT_LLM_KEY' };
  }

  const body = {
    model: cfg.llm.model,
    temperature: 0,
    max_tokens: 64,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(question) },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 30000);
  try {
    const res = await fetch(cfg.llm.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.llm.key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: 'HTTP_' + res.status, hint: txt.slice(0, 300) };
    }
    const j = await res.json();
    const raw = j?.choices?.[0]?.message?.content || '';
    return { ok: true, answer: normalize(raw, question), raw: raw.trim().slice(0, 200), model: cfg.llm.model };
  } catch (e) {
    return { ok: false, error: 'NETWORK', hint: String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

export function llmReady() {
  const cfg = loadConfig();
  return Boolean(cfg.llm.key);
}
