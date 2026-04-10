/* ================================================
   鴻海 AI 重估偵測系統 — app.js
   資料來源：FinMind API（真實數據）
   ================================================ */

// ★ 填入你的 FinMind token（只改這裡）
const FINMIND_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJkYXRlIjoiMjAyNi0wNC0xMCAxOTozNToxNiIsInVzZXJfaWQiOiJmaW4xMTA5IiwiaXAiOiIxMTguMTUwLjk0Ljg4IiwiZXhwIjoxNzc2NDI1NzE2fQ.ZQDLDgP59ty7aE_7r7etUd5ydY7bVkRAioWyCqyZT6c';

// ── 設定 ──
const STOCK_ID   = '2317';   // 鴻海
const BASE_URL   = 'https://api.finmindtrade.com/api/v4/data';
const START_DATE = '2024-01-01';

// ── 門檻設定 ──
const THRESHOLDS = {
  revenueYoY:      25,
  grossMarginMin:  7.5,
  grossMarginNear: 7.0,
  epsMin:          4.5,
  epsNear:         4.0,
  peMax:           20,
};

// ════════════════════════════════════════
//  FinMind API 呼叫
// ════════════════════════════════════════

async function fetchFinMind(dataset, extraParams = {}) {
  const params = new URLSearchParams({
    dataset,
    data_id:    STOCK_ID,
    start_date: START_DATE,
    token:      FINMIND_TOKEN,
    ...extraParams,
  });
  const res = await fetch(`${BASE_URL}?${params}`);
  if (!res.ok) throw new Error(`API 錯誤：${res.status}`);
  const json = await res.json();
  if (!json.data || json.data.length === 0) throw new Error(`${dataset} 無資料`);
  return json.data;
}

// ── 抓月營收 ──
async function fetchMonthlyRevenue() {
  const data = await fetchFinMind('TaiwanStockMonthRevenue');
  return data.sort((a, b) => a.date.localeCompare(b.date));
}

// ── 抓財報 ──
async function fetchFinancials() {
  const data = await fetchFinMind('TaiwanStockFinancialStatements');
  return data.sort((a, b) => a.date.localeCompare(b.date));
}

// ── 抓最新股價 ──
async function fetchStockPrice() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 10);
  const fmt = d => d.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    dataset:    'TaiwanStockPrice',
    data_id:    STOCK_ID,
    start_date: fmt(start),
    token:      FINMIND_TOKEN,
  });
  const res  = await fetch(`${BASE_URL}?${params}`);
  const json = await res.json();
  if (!json.data || json.data.length === 0) return null;
  const sorted = json.data.sort((a, b) => b.date.localeCompare(a.date));
  return sorted[0].close;
}

// ════════════════════════════════════════
//  資料整理
// ════════════════════════════════════════

function processRevenue(raw) {
  const latest  = raw[raw.length - 1];
  const prev    = raw[raw.length - 2];

  // YoY：找去年同月
  const sameLastYear = raw.find(
    r => r.revenue_year == (latest.revenue_year - 1) && r.revenue_month == latest.revenue_month
  );
  const revenueYoY = sameLastYear
    ? ((latest.revenue - sameLastYear.revenue) / sameLastYear.revenue) * 100
    : null;

  // QoQ：前一個月對比
  const revenueQoQ = prev
    ? ((latest.revenue - prev.revenue) / prev.revenue) * 100
    : null;

  return { revenueYoY, revenueQoQ, latestRevenue: latest.revenue };
}

function processFinancials(raw) {
  const getRows = type => raw
    .filter(r => r.type === type)
    .sort((a, b) => b.date.localeCompare(a.date));

  const epsRows = getRows('EPS');
  const gmRows  = getRows('GrossProfit');
  const revRows = getRows('Revenue');
  const opRows  = getRows('OperatingIncome');

  const eps     = epsRows[0]?.value ?? null;
  const prevEps = epsRows[1]?.value ?? null;
  const epsQoQ  = eps && prevEps ? ((eps - prevEps) / Math.abs(prevEps)) * 100 : null;

  const gm      = gmRows[0]?.value  ?? null;
  const rev     = revRows[0]?.value ?? null;
  const prevGm  = gmRows[1]?.value  ?? null;
  const prevRev = revRows[1]?.value ?? null;

  const grossMargin = gm  && rev     ? (gm  / rev)     * 100 : null;
  const prevGM      = prevGm && prevRev ? (prevGm / prevRev) * 100 : null;
  const gmQoQ       = grossMargin && prevGM ? grossMargin - prevGM : null;

  const op = opRows[0]?.value ?? null;
  const operatingMargin = op && rev ? (op / rev) * 100 : null;

  const latestPeriod = epsRows[0]?.date ?? '—';

  return { eps, prevEps, epsQoQ, grossMargin, prevGM, gmQoQ, operatingMargin, latestPeriod };
}

// ════════════════════════════════════════
//  訊號判斷
// ════════════════════════════════════════

function judgeSignals(m) {
  const T = THRESHOLDS;

  const l1_revYoY = m.revenueYoY    !== null && m.revenueYoY > T.revenueYoY;
  const l1_gmUp   = m.gmQoQ         !== null && m.gmQoQ > 0;
  const level1    = l1_revYoY && l1_gmUp;

  const l2_epsNear = m.eps          !== null && m.eps >= T.epsNear;
  const l2_gmNear  = m.grossMargin  !== null && m.grossMargin >= T.grossMarginNear;
  const level2     = l2_epsNear && l2_gmNear;

  const l3_eps    = m.eps           !== null && m.eps >= T.epsMin;
  const l3_epsQoQ = m.epsQoQ        !== null && m.epsQoQ > 0;
  const l3_gm     = m.grossMargin   !== null && m.grossMargin >= T.grossMarginMin;
  const l3_pe     = m.pe            !== null && m.pe < T.peMax;
  const level3    = l3_eps && l3_epsQoQ && l3_gm && l3_pe;

  return {
    level1, level2, level3,
    details: { l1_revYoY, l1_gmUp, l2_epsNear, l2_gmNear, l3_eps, l3_epsQoQ, l3_gm, l3_pe },
  };
}

// ════════════════════════════════════════
//  UI 更新
// ════════════════════════════════════════

const fmt      = (v, d=1, s='') => (v===null||isNaN(v)) ? '—' : (v>=0?'+':'')+v.toFixed(d)+s;
const fmtPlain = (v, d=1, s='') => (v===null||isNaN(v)) ? '—' : v.toFixed(d)+s;

function setIcon(id, pass) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = pass ? '✓' : '○';
  el.className   = `cond-icon ${pass ? 'pass' : 'fail'}`;
}

function setStatus(id, level) {
  const el = document.getElementById(id);
  if (!el) return;
  const map = {
    triggered: ['🔥 TRIGGERED', 'level-status triggered'],
    active:    ['⚡ ACTIVE',    'level-status active'],
  };
  const [text, cls] = map[level] ?? ['WATCHING', 'level-status'];
  el.textContent = text;
  el.className   = cls;
}

function highlightCard(id, level) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.boxShadow = level === 'triggered'
    ? '0 0 32px rgba(255,23,68,0.25)'
    : level === 'active'
    ? '0 0 24px rgba(255,214,0,0.15)'
    : '';
}

function setM(id, text, updown = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  if (updown) el.className = `metric-val ${updown}`;
}

function renderUI(m, s) {
  const d  = s.details;
  const ud = v => v > 0 ? 'up' : v < 0 ? 'down' : '';

  // Level 1
  document.getElementById('rev-yoy').textContent = fmtPlain(m.revenueYoY, 1, '%');
  document.getElementById('gm-qoq').textContent  = fmt(m.gmQoQ, 2, '%');
  setIcon('icon-rev-yoy', d.l1_revYoY);
  setIcon('icon-gm-qoq',  d.l1_gmUp);
  setStatus('status1', s.level1 ? 'triggered' : (d.l1_revYoY || d.l1_gmUp) ? 'active' : null);
  highlightCard('card-level1', s.level1 ? 'triggered' : null);

  // Level 2
  document.getElementById('eps-val').textContent = fmtPlain(m.eps, 2, ' 元');
  document.getElementById('gm-val').textContent  = fmtPlain(m.grossMargin, 1, '%');
  setIcon('icon-eps-near', d.l2_epsNear);
  setIcon('icon-gm-near',  d.l2_gmNear);
  setStatus('status2', s.level2 ? 'active' : null);
  highlightCard('card-level2', s.level2 ? 'active' : null);

  // Level 3
  document.getElementById('eps-trigger').textContent = fmtPlain(m.eps, 2, ' 元');
  document.getElementById('eps-qoq').textContent     = fmt(m.epsQoQ, 1, '%');
  document.getElementById('gm-trigger').textContent  = fmtPlain(m.grossMargin, 1, '%');
  document.getElementById('pe-val').textContent      = m.pe ? fmtPlain(m.pe, 1, 'x') : '—';
  setIcon('icon-eps-trigger', d.l3_eps);
  setIcon('icon-eps-qoq',     d.l3_epsQoQ);
  setIcon('icon-gm-trigger',  d.l3_gm);
  setIcon('icon-pe',          d.l3_pe);
  setStatus('status3', s.level3 ? 'triggered' : s.level2 ? 'active' : null);
  highlightCard('card-level3', s.level3 ? 'triggered' : null);

  // 指標區
  setM('m-rev-yoy',  fmtPlain(m.revenueYoY, 1, '%'), ud(m.revenueYoY));
  setM('m-rev-qoq',  fmt(m.revenueQoQ, 1, '%'),      ud(m.revenueQoQ));
  setM('m-gm-delta', fmt(m.gmQoQ, 2, '%'),            ud(m.gmQoQ));
  setM('m-gm',       fmtPlain(m.grossMargin, 1, '%'));
  setM('m-op',       fmtPlain(m.operatingMargin, 1, '%'));
  setM('m-ai',       '— (proxy: 毛利+營收)');
  setM('m-eps',      fmtPlain(m.eps, 2, ' 元'),  ud(m.epsQoQ));
  setM('m-eps-qoq',  fmt(m.epsQoQ, 1, '%'),      ud(m.epsQoQ));
  setM('m-pe',       m.pe ? fmtPlain(m.pe, 1, 'x') : '—');

  // 時間戳
  const now = new Date();
  document.getElementById('updateTime').textContent =
    `更新：${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} ` +
    `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
}

function showError(msg) {
  document.getElementById('updateTime').textContent = `⚠️ ${msg}`;
  console.error(msg);
}

// ════════════════════════════════════════
//  主流程
// ════════════════════════════════════════

async function run() {
  document.getElementById('updateTime').textContent = '資料載入中...';
  try {
    const [rawRevenue, rawFinancials, stockPrice] = await Promise.all([
      fetchMonthlyRevenue(),
      fetchFinancials(),
      fetchStockPrice(),
    ]);

    const revMetrics = processRevenue(rawRevenue);
    const finMetrics = processFinancials(rawFinancials);

    // 本益比：最新 EPS × 4 粗估年化
    const annualEPS = finMetrics.eps ? finMetrics.eps * 4 : null;
    const pe = stockPrice && annualEPS ? stockPrice / annualEPS : null;

    const metrics = { ...revMetrics, ...finMetrics, stockPrice, pe, aiRevenueRatio: null };
    const signals = judgeSignals(metrics);

    renderUI(metrics, signals);

    console.group('📊 鴻海 AI 重估系統');
    console.log('metrics:', metrics);
    console.log('signals:', signals);
    console.groupEnd();

  } catch (err) {
    showError(err.message);
  }
}

// ── 啟動 ──
document.addEventListener('DOMContentLoaded', () => {
  run();
  setInterval(run, 5 * 60 * 1000); // 每 5 分鐘更新
});
