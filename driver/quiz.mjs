/**
 * driver/quiz.mjs —— 驱动版 AI 答题（不需要浏览器扩展）
 *
 * 为什么单独做一个：方案 B（CDP 驱动）不加载任何扩展脚本，
 * extension/quiz.js 在无插件模式下根本不会执行，所以答题能力必须在驱动侧重新实现。
 *
 * 思路：页面里只做两件纯 DOM 的事（抓题 / 点选项），中间"想答案"由 Node 侧调用大模型。
 * 这样既能绕开页面 CSP，也方便把每一次问答记进日志。
 */

const COLLECT = `(() => {
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  };

  const groups = [];
  const selSets = ['.questionLi', '.TiMu', '.Zy_TItle', '.subject_node'];
  for (const sel of selSets) {
    const nodes = Array.from(document.querySelectorAll(sel));
    if (nodes.length) { groups.push(...nodes); break; }
  }
  if (!groups.length) return null;

  const stemOf = (node) => {
    for (const s of ['.mark_name', '.Zy_TItle', '.questionTitle', 'h3', '.stem']) {
      const t = txt(node.querySelector(s));
      if (t && t.length > 3) return t;
    }
    return txt(node).slice(0, 200);
  };
  const optsOf = (node) => {
    for (const s of ['.answerList li', '.Zy_ulTop li', 'ul li', '.option']) {
      const els = Array.from(node.querySelectorAll(s)).filter(visible);
      if (els.length) return els;
    }
    return [];
  };
  const labelOf = (el, i) => {
    const le = el.querySelector('.num_option, .optionKey, .label');
    let lab = txt(le).replace(/[.、．)\\s]/g, '');
    if (!lab || lab.length > 3) lab = String.fromCharCode(65 + i);
    return lab.toUpperCase().slice(0, 2);
  };
  const typeOf = (node, opts) => {
    if (node.querySelector('input[type="checkbox"]')) return '多选题';
    if (opts.length === 2 && opts.every((o) => /对|错|正确|错误|是|否/.test(txt(o)))) return '判断题';
    return '单选题';
  };

  const out = [];
  groups.forEach((node, qi) => {
    if (!visible(node)) return;
    const opts = optsOf(node);
    if (!opts.length) return;
    out.push({
      index: qi,
      question: stemOf(node),
      type: typeOf(node, opts),
      options: opts.map((el, i) => ({ label: labelOf(el, i), text: txt(el).slice(0, 200) })),
      done: !!node.querySelector('input:checked'),
    });
  });
  return out.length ? out : null;
})()`;

/** 生成「点某题某几个选项」的脚本 */
function clickScript(qIndex, letters) {
  const arr = JSON.stringify(letters);
  return `(() => {
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  let groups = [];
  for (const sel of ['.questionLi', '.TiMu', '.Zy_TItle', '.subject_node']) {
    const nodes = Array.from(document.querySelectorAll(sel));
    if (nodes.length) { groups = nodes; break; }
  }
  const node = groups[${qIndex}];
  if (!node) return { ok: false, why: '题目节点消失' };
  let opts = [];
  for (const s of ['.answerList li', '.Zy_ulTop li', 'ul li', '.option']) {
    const els = Array.from(node.querySelectorAll(s)).filter(visible);
    if (els.length) { opts = els; break; }
  }
  const labelOf = (el, i) => {
    const le = el.querySelector('.num_option, .optionKey, .label');
    let lab = txt(le).replace(/[.、．)\\s]/g, '');
    if (!lab || lab.length > 3) lab = String.fromCharCode(65 + i);
    return lab.toUpperCase().slice(0, 2);
  };
  const want = ${arr};
  let picked = 0, missed = [];
  want.forEach((ch) => {
    let hit = opts.find((el, i) => labelOf(el, i) === ch);
    if (!hit) hit = opts.find((el, i) => txt(el).indexOf(ch) === 0);
    if (!hit) { missed.push(ch); return; }
    const target = hit.querySelector('input[type="radio"], input[type="checkbox"]') || hit;
    try { target.click(); } catch (e) {
      try { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch (e2) {}
    }
    picked++;
  });
  return { ok: picked > 0, picked, missed };
})()`;
}

const SUBMIT = `(() => {
  const txt = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  const labels = ['提交', '提交答案', '交卷'];
  for (const el of document.querySelectorAll('button, a, div')) {
    if (labels.includes(txt(el)) && visible(el)) { try { el.click(); return txt(el); } catch (e) {} }
  }
  return null;
})()`;

/** 在页面里抓题；抓到返回题目数组，否则 null */
export async function collect(page, ctxId) {
  try {
    const r = ctxId != null ? await page.evalIn(ctxId, COLLECT) : await page.eval(COLLECT);
    return Array.isArray(r) ? r : null;
  } catch (e) {
    return null;
  }
}

/** 点选某题的指定选项 */
export async function answer(page, ctxId, qIndex, letters) {
  try {
    return ctxId != null
      ? await page.evalIn(ctxId, clickScript(qIndex, letters))
      : await page.eval(clickScript(qIndex, letters));
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

export async function submit(page, ctxId) {
  try {
    return ctxId != null ? await page.evalIn(ctxId, SUBMIT) : await page.eval(SUBMIT);
  } catch (e) {
    return null;
  }
}

/**
 * 把一页题全部答掉。
 * @param {(q:object)=>Promise<object>} ask  传入 {question,type,options} 返回 {ok,answer}
 */
export async function solvePage(page, ctxId, questions, ask, log, opts = {}) {
  const results = [];
  for (const q of questions) {
    if (q.done && !opts.force) {
      results.push({ index: q.index, skipped: '已作答' });
      continue;
    }
    const stem = String(q.question || '').slice(0, 60);
    const resp = await ask({ question: q.question, type: q.type, options: q.options });
    if (!resp || !resp.ok) {
      log(`第 ${q.index + 1} 题 AI 不可用：${(resp && (resp.error || resp.hint)) || '无返回'}`);
      results.push({ index: q.index, error: 'ai-unavailable' });
      continue;
    }
    const raw = String(resp.answer || '').trim();
    if (!raw || raw === 'UNKNOWN') {
      log(`第 ${q.index + 1} 题 AI 放弃作答（${stem}…）`);
      results.push({ index: q.index, error: 'unknown' });
      continue;
    }

    let letters = [];
    if (q.type === '判断题') {
      const wantTrue = /正确|对|是|√|T|TRUE/i.test(raw);
      const hit = (q.options || []).find((o) => /对|正确|是|√/.test(o.text) === wantTrue);
      letters = hit ? [hit.label] : [];
    } else {
      letters = (raw.toUpperCase().match(/[A-Z]/g) || []).slice(0, 8);
    }

    if (!letters.length) {
      log(`第 ${q.index + 1} 题答案无法映射到选项（AI 原话：${raw.slice(0, 30)}）`);
      results.push({ index: q.index, error: 'no-map', raw });
      continue;
    }

    const r = await answer(page, ctxId, q.index, letters);
    log(`第 ${q.index + 1} 题 [${q.type}] ${stem}… → ${letters.join('')} ${r && r.ok ? '✓' : '✗ ' + ((r && r.why) || '')}`);
    results.push({ index: q.index, letters, ok: !!(r && r.ok) });
    await new Promise((res) => setTimeout(res, 800));   // 别点太快
  }
  return results;
}
