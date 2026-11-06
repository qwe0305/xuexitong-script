/**
 * tests/ai-check.mjs —— 大模型 key 自检（配好 key 后跑一下就知道通不通）
 *
 * 用法：npm run ai-check   或   node tests/ai-check.mjs
 */
import { askLLM, llmReady } from '../agent/ai.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfgPath = path.join(__dirname, '..', 'agent', 'config.json');

if (!llmReady()) {
  console.log('❌ 还没配置大模型 key\n');
  console.log('编辑这个文件，把 key 填进 llm.key：');
  console.log('  ' + cfgPath + '\n');
  if (!fs.existsSync(cfgPath)) {
    console.log('该文件不存在，先复制一份：');
    console.log('  copy agent\\config.example.json agent\\config.json\n');
  }
  console.log('或者临时用环境变量：');
  console.log('  set XXT_LLM_KEY=sk-xxxx');
  console.log('  set XXT_LLM_BASE=https://api.deepseek.com/v1   （换供应商时改这个）');
  console.log('  set XXT_LLM_MODEL=deepseek-chat');
  process.exit(1);
}

// 不同供应商的可用模型，仅供参考
const SAMPLE = {
  question: '中国共产党人的初心和使命是什么？',
  type: '单选题',
  options: [
    { label: 'A', text: '为中国人民谋幸福，为中华民族谋复兴' },
    { label: 'B', text: '为世界人民谋和平' },
    { label: 'C', text: '为全人类谋发展' },
    { label: 'D', text: '为个人谋利' },
  ],
};

console.log('正在向大模型提问…');
const t0 = Date.now();
const r = await askLLM(SAMPLE);
const cost = Date.now() - t0;

if (!r.ok) {
  console.log(`\n❌ 调用失败（${cost}ms）`);
  console.log('  错误：' + r.error);
  if (r.hint) console.log('  详情：' + String(r.hint).slice(0, 300));
  console.log('\n常见原因：');
  console.log('  HTTP_401  key 不对或已失效');
  console.log('  HTTP_402  DeepSeek 账户余额不足');
  console.log('  HTTP_404  base 写错（应以 /v1 结尾）或 model 名不存在');
  console.log('  NETWORK   网络不通 / 需要代理');
  process.exit(1);
}

console.log(`\n✅ 连通（${cost}ms，模型 ${r.model}）`);
console.log('  题目：' + SAMPLE.question);
console.log('  回答：' + r.answer + (r.raw ? `（原始输出：${r.raw.slice(0, 40)}）` : ''));
console.log('\n期望答案是 A。若一致，答题功能可以直接用了。');
