/* ================================================
   鴻海 AI 重估偵測系統 — app.js
   邏輯：指標計算 → 訊號判斷 → UI 更新
   ================================================ */

// ── 模擬資料（實際串接時替換此區塊）──
// 格式說明：
//   revenue: 月營收（億元）
//   eps: 季 EPS（元）
//   grossMargin: 毛利率（%）
//   operatingMargin: 營業利益率（%）
//   stockPrice: 當前股價
//   aiRevenueRatio: AI 營收占比（若無請設 null）

const MOCK_DATA = {
  // 最新三個月月營收（由舊到新）
  monthlyRevenue: [
    { period: '2025-10', value: 6320 },
    { period: '2025-11', value: 6780 },
    { period: '2025-12', value: 7210 },
  ],

  // 去年同期三個月月營收（對應上方月份）
  monthlyRevenueYoY: [
    { period: '2024-10', value: 5100 },
    { period: '2024-11', value: 5320 },
    { period: '2024-12', value: 5680 },
  ],

  // 最近兩季財報
  quarterly: [
    {
      period: '2025Q2',
      eps: 3.82,
      grossMargin: 7.1,
      operatingMargin: 2.8,
    },
    {
      period: '2025Q3',
      eps: 4.21,
      grossMargin: 7.6,
      operatingMargin: 3.1,
    },
  ],

  // 市場資料
  market: {
    stockPrice: 198.5,
    annualEPS: 14.2,   // 近四季 EPS 合計（用於算 PE）
  },

  // AI 營收占比（若財報未揭露請設 null）
  aiRevenueRatio: null,

  // 資料來源標記
  dataSource: 'mock',
  lastUpdated: new Date().toISOString(),
};

// ── 門檻設定（可調整）──
const THRESHOLDS = {
  revenueYoY:     25,    // 月營收 YoY > 25%
  grossMarginMin: 7.5,   // 毛利率觸發門檻 %
  grossMarginNear:7.0,   // 毛利率接近門檻 %
  epsMin:         4.5,   // EPS 觸發門檻
  epsNear:        4.0,   // EPS 接近門檻
  peMax:          20,    // 本益比防呆上限
  peWarn:         18,    // 本益比警戒線
};

// ════════════════════════════════════════
//  指標計算
// ════════════════════════════════════════

function calcMetrics(data) {
  const { monthlyRevenue, monthlyRevenueYoY, quarterly, market } = data;

  // 月營收 YoY（平均）
  const yoyList = monthlyRevenue.map((m, i) => {
    const base = monthlyRevenueYoY[i]?.value;
    return base ? ((m.value - base) / base) * 100 : null;
  }).filter(v => v !== null);
  const revenueYoY = yoyList.reduce((a, b) => a + b, 0) / yoyList.length;

  // 季營收 QoQ（用最近兩個月加總近似）
  const q1Rev = monthlyRevenue.slice(0, 2).reduce((a, b) => a + b.value, 0);
  const q2Rev = monthlyRevenue.slice(1, 3).reduce((a, b) => a + b.value, 0);
  const revenueQoQ = ((q2Rev - q1Rev) / q1Rev) * 100;

  // 最新季與前一季
  const latestQ  = quarterly[quarterly.length - 1];
  const prevQ    = quarterly[quarterly.length - 2];

  const eps         = latestQ.eps;
  const prevEps     = prevQ?.eps ?? null;
  const epsQoQ      = prevEps !== null ? ((eps - prevEps) / Math.abs(prevEps)) * 100 : null;

  const grossMargin = latestQ.grossMargin;
  const prevGM      = prevQ?.grossMargin ?? null;
  const gmQoQ       = prevGM !== null ? grossMargin - prevGM : null;

  const operatingMargin = latestQ.operatingMargin;

  // 本益比
  const pe = market.annualEPS > 0
    ? market.stockPrice / market.annualEPS
    : null;

  return {
    revenueYoY,
    revenueQoQ,
    eps,
    epsQoQ,
    grossMargin,
    gmQoQ,
    operatingMargin,
    pe,
    aiRevenueRatio: data.aiRevenueRatio,
    latestPeriod: latestQ.period,
  };
}

// ════════════════════════════════════════
//  訊號判斷
// ════════════════════════════════════════

function judgeSignals(m) {
  const T = THRESHOLDS;

  // Level 1：趨勢形成
  const l1_revYoY = m.revenueYoY > T.revenueYoY;
  const l1_gmUp   = m.gmQoQ !== null && m.gmQoQ > 0;
  const level1    = l1_revYoY && l1_gmUp;

  // Level 2：接近觸發
  const l2_epsNear = m.eps >= T.epsNear;
  const l2_gmNear  = m.grossMargin >= T.grossMarginNear;
  const level2     = l2_epsNear && l2_gmNear;

  // Level 3：正式觸發
  const l3_eps     = m.eps >= T.epsMin;
  const l3_epsQoQ  = m.epsQoQ !== null && m.epsQoQ > 0;
  const l3_gm      = m.grossMargin >= T.grossMarginMin;
  const l3_pe      = m.pe !== null && m.pe < T.peMax;
  const level3     = l3_eps && l3_epsQoQ && l3_gm && l3_pe;

  return {
    level1, level2, level3,
    details: {
      l1_revYoY, l1_gmUp,
      l2_epsNear, l2_gmNear,
      l3_eps, l3_epsQoQ, l3_gm, l3_pe,
    },
  };
}

// ════════════════════════════════════════
//  UI 更新
// ════════════════════════════════════════

function fmt(val, digits = 1, suffix = '') {
  if (val === null || val === undefined || isNaN(val)) return '—';
  return (val >= 0 ? '+' : '') + val.toFixed(digits) + suffix;
}

function fmtPlain(val, digits = 1, suffix = '') {
  if (val === null || val === undefined || isNaN(val)) return '—';
  return val.toFixed(digits) + suffix;
}

function setIcon(id, pass) {
  const el = document.getElementById(id);
  if (!el) return;
  if (pass === true)  { el.textContent = '✓'; el.className = 'cond-icon pass'; }
  else if (pass === false) { el.textContent = '○'; el.className = 'cond-icon fail'; }
  else                { el.textContent = '?'; el.className = 'cond-icon warn'; }
}

function setText(id, text, cls = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  if (cls) el.className = `metric-val ${cls}`;
}

function setStatus(id, level) {
  const el = document.getElementById(id);
  if (!el) return;
  if (level === 'triggered') {
    el.textContent = '🔥 TRIGGERED';
    el.className = 'level-status triggered';
  } else if (level === 'active') {
    el.textContent = '⚡ ACTIVE';
    el.className = 'level-status active';
  } else {
    el.textContent = 'WATCHING';
    el.className = 'level-status';
  }
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

function renderUI(metrics, signals) {
  const m = metrics;
  const s = signals;
  const d = s.details;

  // ── Level 1 卡片 ──
  setText('rev-yoy', fmtPlain(m.revenueYoY, 1, '%'));
  setText('gm-qoq',  fmt(m.gmQoQ, 2, '%'));
  setIcon('icon-rev-yoy', d.l1_revYoY);
  setIcon('icon-gm-qoq',  d.l1_gmUp);
  setStatus('status1', s.level1 ? 'triggered' : s.details.l1_revYoY || s.details.l1_gmUp ? 'active' : null);
  highlightCard('card-level1', s.level1 ? 'triggered' : null);

  // ── Level 2 卡片 ──
  setText('eps-val', fmtPlain(m.eps, 2, ' 元'));
  setText('gm-val',  fmtPlain(m.grossMargin, 1, '%'));
  setIcon('icon-eps-near', d.l2_epsNear);
  setIcon('icon-gm-near',  d.l2_gmNear);
  setStatus('status2', s.level2 ? 'active' : null);
  highlightCard('card-level2', s.level2 ? 'active' : null);

  // ── Level 3 卡片 ──
  setText('eps-trigger', fmtPlain(m.eps, 2, ' 元'));
  setText('eps-qoq',     fmt(m.epsQoQ, 1, '%'));
  setText('gm-trigger',  fmtPlain(m.grossMargin, 1, '%'));
  setText('pe-val',      m.pe ? fmtPlain(m.pe, 1, 'x') : '—');
  setIcon('icon-eps-trigger', d.l3_eps);
  setIcon('icon-eps-qoq',     d.l3_epsQoQ);
  setIcon('icon-gm-trigger',  d.l3_gm);
  setIcon('icon-pe',           d.l3_pe);
  setStatus('status3', s.level3 ? 'triggered' : s.level2 ? 'active' : null);
  highlightCard('card-level3', s.level3 ? 'triggered' : null);

  // ── 指標區塊 ──
  const updown = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
  document.getElementById('m-rev-yoy').textContent  = fmtPlain(m.revenueYoY, 1, '%');
  document.getElementById('m-rev-yoy').className    = `metric-val ${updown(m.revenueYoY)}`;
  document.getElementById('m-rev-qoq').textContent  = fmt(m.revenueQoQ, 1, '%');
  document.getElementById('m-rev-qoq').className    = `metric-val ${updown(m.revenueQoQ)}`;
  document.getElementById('m-gm-delta').textContent = fmt(m.gmQoQ, 2, '%');
  document.getElementById('m-gm-delta').className   = `metric-val ${updown(m.gmQoQ)}`;

  document.getElementById('m-gm').textContent  = fmtPlain(m.grossMargin, 1, '%');
  document.getElementById('m-op').textContent  = fmtPlain(m.operatingMargin, 1, '%');
  document.getElementById('m-ai').textContent  = m.aiRevenueRatio
    ? fmtPlain(m.aiRevenueRatio, 1, '%')
    : '— (proxy: 毛利+營收)';

  document.getElementById('m-eps').textContent     = fmtPlain(m.eps, 2, ' 元');
  document.getElementById('m-eps').className       = `metric-val ${updown(m.epsQoQ)}`;
  document.getElementById('m-eps-qoq').textContent = fmt(m.epsQoQ, 1, '%');
  document.getElementById('m-eps-qoq').className   = `metric-val ${updown(m.epsQoQ)}`;
  document.getElementById('m-pe').textContent      = m.pe ? fmtPlain(m.pe, 1, 'x') : '—';

  // ── 時間戳 ──
  const now = new Date();
  document.getElementById('updateTime').textContent =
    `更新：${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
}

// ════════════════════════════════════════
//  主流程
// ════════════════════════════════════════

function run() {
  // 1. 載入資料（此處用 mock，未來替換為 fetch API）
  const data = MOCK_DATA;

  // 2. 計算指標
  const metrics = calcMetrics(data);

  // 3. 判斷訊號
  const signals = judgeSignals(metrics);

  // 4. 更新 UI
  renderUI(metrics, signals);

  // 5. Console 摘要（方便 debug）
  console.group('📊 鴻海 AI 重估系統');
  console.log('指標：', metrics);
  console.log('訊號：', signals);
  console.log('Level1:', signals.level1, '| Level2:', signals.level2, '| Level3:', signals.level3);
  console.groupEnd();
}

// ── 啟動 ──
document.addEventListener('DOMContentLoaded', () => {
  run();
  // 每 60 秒自動重跑（模擬定期更新）
  setInterval(run, 60 * 1000);
});

// ════════════════════════════════════════
//  ★ 未來串接真實資料說明
// ════════════════════════════════════════
//
//  替換 MOCK_DATA 步驟：
//
//  1. 月營收 → 台灣證交所 MOPS 公開資訊觀測站
//     https://mops.twse.com.tw/mops/web/t05st10_ifrs
//     鴻海股票代號：2317
//
//  2. 季財報 EPS / 毛利率 → MOPS 財報系統
//     或使用第三方 API（如 Fugle、FinMind）
//     FinMind 範例：
//     fetch('https://api.finmindtrade.com/api/v4/data?
//            dataset=TaiwanStockFinancialStatements&
//            data_id=2317&start_date=2024-01-01&
//            token=YOUR_TOKEN')
//
//  3. 股價 → Yahoo Finance / Fugle Realtime API
//
//  4. 法說會文字 → 手動上傳 PDF → 呼叫 Claude API 解析
//
//  串接後只需更新 MOCK_DATA 結構，計算與判斷邏輯完全不用改。
