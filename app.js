/* Dữ liệu lấy từ API VNDirect (qua proxy trong server.js). Không có số liệu nào được gõ sẵn:
   không tìm thấy thì hiển thị "—" thay vì tự bịa số. */
const $ = s => document.querySelector(s);
const LOG = [];
function log(m) { LOG.push(new Date().toLocaleTimeString('vi-VN') + ' ' + m); const e = $('#log'); if (e) e.textContent = LOG.slice(-80).join('\n'); }
// Thử lần lượt: proxy local (node server.js) → gọi trực tiếp → proxy công cộng. Nhờ vậy vẫn chạy khi mở bằng Live Server.
async function J(u) {
  const short = u.replace(/\?.*/, '').split('/').slice(-2).join('/');
  const tries = [['proxy local', '/proxy?url=' + encodeURIComponent(u)], ['trực tiếp', u],
    ['corsproxy', 'https://corsproxy.io/?' + encodeURIComponent(u)], ['allorigins', 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u)]];
  for (const [n, url] of tries) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) { log(`${n}: HTTP ${r.status} (${short})`); continue; }
      const j = await r.json(); log(`${n}: OK (${short})`); return j;
    } catch (e) { log(`${n}: lỗi ${e.message} (${short})`); }
  }
  throw new Error('Không lấy được ' + short + ' – mở mục "Chẩn đoán kết nối" cuối trang');
}
const VD = 'https://finfo-api.vndirect.com.vn/v4/';
const DC = 'https://dchart-api.vndirect.com.vn/dchart/history';
const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const fmt = n => (n == null || !isFinite(n)) ? '—' : nf.format(n);

// Bảng ánh xạ chỉ tiêu: khớp theo tên tiêu chí (VN hoặc EN). Sửa tại đây nếu nguồn đổi tên.
const M0 = {
  rev: [/^(doanh thu thuần|net revenue|net sales)/i],
  gp: [/^(lợi nhuận gộp|gross profit)/i],
  np: [/(sau thuế.*(công ty mẹ|cổ đông.*mẹ)|attributable to.*(parent|shareholders of the parent))/i, /^(lợi nhuận sau thuế|net profit after tax|profit after tax)/i],
  ta: [/^(tổng cộng tài sản|tổng tài sản|total assets)/i],
  eq: [/^(vốn chủ sở hữu|owners.? equity|total equity)/i],
  inv: [/^(hàng tồn kho|inventor)/i],
  cogs: [/^(giá vốn hàng bán|cost of (goods sold|sales))/i],
  cfo: [/(lưu chuyển tiền thuần từ hoạt động kinh doanh|net cash.*operating)/i],
  cfi: [/(lưu chuyển tiền thuần từ hoạt động đầu tư|net cash.*investing)/i],
  cff: [/(lưu chuyển tiền thuần từ hoạt động tài chính|net cash.*financing)/i],
  cap: [/^(vốn góp của chủ sở hữu|vốn điều lệ|vốn cổ phần|share capital|contributed|paid-in|common shares)/i]
};
// Chỉ tiêu riêng cho ngân hàng (rev = Tổng thu nhập hoạt động, TOI)
const MB = {
  nii: [/^(thu nhập lãi thuần|net interest income)/i],
  fee: [/^(lãi.*thuần từ hoạt động dịch vụ|net fee)/i],
  rev: [/^(tổng thu nhập hoạt động|total operating income)/i],
  np: M0np(), ta: M0.ta, eq: M0.eq, cap: M0.cap,
  loan: [/^(cho vay khách hàng|loans and advances to customers)/i],
  sec: [/^(chứng khoán đầu tư|investment securities)/i],
  trade: [/^(chứng khoán kinh doanh|trading securities)/i],
  inter: [/^(tiền gửi và cho vay các tctd khác|due from and loans to other)/i],
  dep: [/^(tiền gửi của khách hàng|deposits from customers)/i],
  bond: [/^(phát hành giấy tờ có giá|valuable papers issued)/i],
  ibd: [/^(tiền gửi và vay các tctd khác|deposits and borrowings from other)/i],
  gov: [/^(các khoản nợ chính phủ|due to the government)/i]
};
function M0np() { return M0.np; }

let sym = 'HPG', mode = 'ANNUAL', px = { t: [], c: [] }, range = 365, charts = {}, F = null, timer;
const C = { b: '#0b3d91', o: '#f08a00', g: '#9aa5b4', gr: '#12a150', r: '#e5484d', c: '#18a0c9' };

function status(t, err) { const e = $('#status'); e.textContent = t; e.className = err ? 'err' : 'muted'; }

function draw(id, labels, sets, o = {}) {
  charts[id]?.destroy();
  charts[id] = new Chart($('#' + id), {
    data: { labels, datasets: sets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } },
                 tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}${c.dataset.unit || ''}` } } },
      scales: {
        x: { stacked: !!o.stack, ticks: { maxTicksLimit: 10 }, grid: { display: false } },
        y: { stacked: !!o.stack, ticks: { callback: v => o.pct ? v + '%' : fmt(v) } },
        ...(o.y2 ? { y2: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: v => v + '%' } } } : {})
      }
    }
  });
}
const bar = (label, data, color, extra = {}) => ({ type: 'bar', label, data, backgroundColor: color, borderRadius: 3, ...extra });
const line = (label, data, color, extra = {}) => ({ type: 'line', label, data, borderColor: color, backgroundColor: color, tension: .25, pointRadius: 2, borderWidth: 2, spanGaps: true, ...extra });

/* ---------- GIÁ ---------- */
async function loadPrice() {
  const to = Math.floor(Date.now() / 1e3);
  const h = await J(`${DC}?symbol=${sym}&resolution=D&from=1262304000&to=${to}`);
  if (h.s !== 'ok' || !h.t?.length) throw new Error('Không có dữ liệu giá cho mã ' + sym);
  px = { t: h.t, c: h.c };
  showPrice();
}
async function refreshPrice() {           // gọi lại mỗi 15 giây: cập nhật giá phiên gần nhất
  try {
    const to = Math.floor(Date.now() / 1e3);
    const h = await J(`${DC}?symbol=${sym}&resolution=D&from=${to - 864000}&to=${to}`);
    if (h.s !== 'ok' || !h.t?.length) return;
    const i = px.t.findIndex(t => t >= h.t[0]);
    if (i >= 0) { px.t.length = i; px.c.length = i; }
    px.t.push(...h.t); px.c.push(...h.c);
    showPrice();
  } catch (e) { /* giữ số liệu cũ */ }
}
function showPrice() {
  const n = px.c.length, p = px.c[n - 1], q = px.c[n - 2] ?? p, d = p - q;
  $('#price').textContent = fmt(p);
  const e = $('#chg');
  e.textContent = `${d >= 0 ? '+' : ''}${fmt(d)} (${d >= 0 ? '+' : ''}${fmt(d / q * 100)}%)`;
  e.className = d >= 0 ? 'up' : 'down';
  const from = range ? px.t[n - 1] - range * 86400 : 0;
  const idx = px.t.map((t, i) => t >= from ? i : -1).filter(i => i >= 0);
  draw('cPrice', idx.map(i => new Date(px.t[i] * 1e3).toLocaleDateString('vi-VN')),
    [line('Giá đóng cửa (nghìn đồng)', idx.map(i => px.c[i]), C.b, { pointRadius: 0, fill: true, backgroundColor: 'rgba(11,61,145,.08)' })]);
  if (F) showStats();
}
function priceAt(date) {
  const ts = Date.parse(date) / 1e3 + 86400; let lo = 0, hi = px.t.length - 1, r = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (px.t[m] <= ts) { r = m; lo = m + 1; } else hi = m - 1; }
  return r == null ? null : px.c[r] * 1000;
}

/* ---------- BÁO CÁO TÀI CHÍNH ---------- */
async function loadFin() {
  status('Đang tải báo cáo tài chính…');
  const since = mode === 'ANNUAL' ? '2009-01-01' : '2016-01-01';
  const get = async f => {
    let it = [];
    for (let p = 1; p <= 8; p++) {
      const r = await J(`${VD}financial_statements?q=code:${sym}~reportType:${mode}${f}&sort=fiscalDate&size=2000&page=${p}`);
      const d = r.data || []; it = it.concat(d);
      if (d.length < 2000) break;
    }
    return it;
  };
  let items = await get(`~fiscalDate:gte:${since}`).catch(() => []);
  if (!items.length) items = await get('');
  log(`Báo cáo ${mode}: ${items.length} dòng`);
  if (!items.length) throw new Error('Không có báo cáo tài chính (mã thuộc nhóm ngân hàng/chứng khoán dùng biểu mẫu khác)');
  const by = {}; items.forEach(i => (by[i.fiscalDate] ??= {})[i.itemCode] = i);
  const bank = items.some(i => /thu nhập lãi thuần|net interest income/i.test((i.itemName || '') + ' ' + (i.itemNameEn || '')));
  const M = bank ? MB : M0;
  const dates = Object.keys(by).sort(), S = {}, miss = [];
  for (const [k, res] of Object.entries(M)) {
    let code = null;
    for (const re of res) {
      const cs = [...new Set(items.filter(i => re.test(nm(i.itemName)) || re.test(nm(i.itemNameEn))).map(i => i.itemCode))].sort((a, b) => a - b);
      if (cs.length) { code = cs[0]; break; }
    }
    if (!code) { miss.push(k); S[k] = dates.map(() => null); continue; }
    S[k] = dates.map(d => by[d][code] ? +by[d][code].numericValue : null);
  }
  if (miss.length) log('Chưa khớp: ' + miss.join(', ') + '\nTên chỉ tiêu có sẵn: ' + [...new Set(items.map(i => i.itemNameEn || i.itemName))].slice(0, 150).join(' | '));
  F = { dates, S, miss, bank };
  render();
  status('Cập nhật ' + new Date().toLocaleTimeString('vi-VN'));
}

function render() {
  for (const k in charts) if (k !== 'cPrice') { charts[k].destroy(); delete charts[k]; }
  $('#grid').innerHTML = F.bank ? BANK_GRID : GRID0;
  const { dates, S, miss } = F, A = mode === 'ANNUAL', lag = A ? 1 : 4, B = 1e9;
  const lab = dates.map(d => A ? d.slice(0, 4) : `Q${+d.slice(5, 7) / 3}/${d.slice(2, 4)}`);
  const ttm = a => (a || []).map((_, i) => { if (A) return a[i]; if (i < 3) return null; const w = a.slice(i - 3, i + 1); return w.some(v => v == null) ? null : w.reduce((x, y) => x + y, 0); });
  const div = (a, b) => a.map((v, i) => v != null && b[i] ? v / b[i] : null);
  const gr = a => a.map((v, i) => i >= lag && v != null && a[i - lag] > 0 ? (v / a[i - lag] - 1) * 100 : null);
  const pc = a => a.map(v => v == null ? null : v * 100);
  const bn = a => a.map(v => v == null ? null : v / B);

  const npT = ttm(S.np), revT = ttm(S.rev), cogsT = ttm(S.cogs);
  F.ttm = { np: npT, rev: revT };

  if (F.bank) bankCharts(lab, S, gr, pc, bn, div, npT);
  else {
  draw('cRev', lab, [bar('Doanh thu thuần', bn(S.rev), C.g), line('Tăng trưởng YoY', gr(S.rev), C.o, { yAxisID: 'y2', unit: '%' })], { y2: true });
  draw('cNp', lab, [bar('LNST công ty mẹ', bn(S.np), C.g), line('Tăng trưởng YoY', gr(S.np), C.o, { yAxisID: 'y2', unit: '%' })], { y2: true });
  draw('cMg', lab, [line('Biên LN gộp', pc(div(S.gp, S.rev)), C.o, { unit: '%' }), line('Biên LN ròng', pc(div(S.np, S.rev)), C.g, { unit: '%' })], { pct: true });
  draw('cRo', lab, [line('ROE', pc(div(npT, S.eq)), C.o, { unit: '%' }), line('ROA', pc(div(npT, S.ta)), C.g, { unit: '%' })], { pct: true });
  draw('cCf', lab, [bar('Kinh doanh', bn(S.cfo), C.gr), bar('Đầu tư', bn(S.cfi), '#f6c453'), bar('Tài chính', bn(S.cff), C.r),
    line('Thuần trong kỳ', dates.map((_, i) => [S.cfo[i], S.cfi[i], S.cff[i]].some(v => v == null) ? null : (S.cfo[i] + S.cfi[i] + S.cff[i]) / B), '#222')]);
  draw('cInv', lab, [bar('Hàng tồn kho', bn(S.inv), C.g), line('Vòng quay (lần)', div(cogsT, S.inv), '#111', { yAxisID: 'y2', unit: ' lần' })].map(d => d.yAxisID ? d : d), { y2: true });
  charts.cInv.options.scales.y2.ticks.callback = v => fmt(v);
  charts.cInv.update();
  }

  valuation(lab);
  showStats();
  $('#note').innerHTML = (miss.length ? `<span class="err">Chưa khớp được chỉ tiêu: ${miss.join(', ')} – chỉnh bảng <code>M</code> trong app.js.</span><br>` : '') +
    'Nguồn: VNDirect (giá: dchart-api, báo cáo: finfo-api). Số cổ phiếu ước tính = vốn góp chủ sở hữu ÷ 10.000 đ/cp; P/E, P/B, P/S lịch sử tính từ giá đóng cửa tại ngày chốt báo cáo. Chỉ mang tính tham khảo, không phải khuyến nghị đầu tư.';
}

function valuation(lab) {
  const { dates, S } = F, last = dates.length - 1;
  const cap = S.cap.map((v, i) => v ?? S.cap.slice(0, i).reverse().find(x => x != null) ?? null);
  const mc = dates.map((d, i) => { const p = priceAt(d); return p && cap[i] ? p * cap[i] / 1e4 : null; });
  const series = { PE: mc.map((m, i) => m && F.ttm.np[i] > 0 ? m / F.ttm.np[i] : null),
                   PB: mc.map((m, i) => m && S.eq[i] > 0 ? m / S.eq[i] : null),
                   PS: mc.map((m, i) => m && F.ttm.rev[i] > 0 ? m / F.ttm.rev[i] : null) };
  F.val = {};
  for (const [k, a] of Object.entries(series)) {
    if (!$('#c' + k)) continue;
    const v = a.filter(x => x != null).sort((x, y) => x - y);
    if (!v.length) { $('#t' + k).textContent = `Định giá ${k}: chưa đủ dữ liệu`; continue; }
    const mean = v.reduce((x, y) => x + y, 0) / v.length, med = v[v.length >> 1];
    const sd = Math.sqrt(v.reduce((x, y) => x + (y - mean) ** 2, 0) / v.length);
    const cur = a[last] ?? v[v.length - 1];
    F.val[k] = cur;
    const cmp = (x, n) => `${cur < x ? 'thấp' : 'cao'} hơn ${n} ${Math.abs((cur / x - 1) * 100).toFixed(0)}%`;
    $('#t' + k).textContent = `Định giá ${k} ${fmt(cur)} lần, ${cmp(med, 'trung vị')}, ${cmp(mean, 'trung bình')}`;
    const flat = x => a.map(() => x), dash = { borderDash: [5, 4], pointRadius: 0, borderWidth: 1.3 };
    draw('c' + k, lab, [line(k, a, C.o), line('Trung vị', flat(med), C.g, dash), line('Trung bình', flat(mean), '#555', dash),
      line('+1 StDv', flat(mean + sd), C.r, dash), line('-1 StDv', flat(mean - sd), C.gr, dash)]);
  }
  F.cap = cap[last];
}

function showStats() {
  const sh = F.cap ? F.cap / 1e4 : null, p = px.c[px.c.length - 1] * 1000, l = F.dates.length - 1;
  const np = F.ttm.np[l], eq = F.S.eq[l];
  const rows = [['Vốn hóa (tỷ)', sh ? fmt(p * sh / 1e9) : null], ['Cổ phiếu lưu hành (triệu)', sh ? fmt(sh / 1e6) : null],
    ['P/E', F.val?.PE], ['P/B', F.val?.PB], ['P/S', F.val?.PS],
    ['EPS trượt 12T', sh && np != null ? fmt(np / sh) : null], ['BVPS', sh && eq != null ? fmt(eq / sh) : null]];
  $('#stats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${typeof v === 'number' ? fmt(v) : (v ?? '—')}</dd></div>`).join('');
}

/* ---------- NGÂN HÀNG ---------- */
const GRID0 = $('#grid').innerHTML;
const BANK_GRID = [
  ['Cơ cấu TOI (tỷ đồng) và tăng trưởng YoY', 'cToi'], ['LNST cổ đông công ty mẹ (tỷ đồng) và tăng trưởng YoY', 'cNp'],
  ['Cho vay khách hàng (tỷ đồng) và tăng trưởng YoY', 'cLoan'], ['Cơ cấu tài sản (tỷ đồng)', 'cAs'],
  ['Cơ cấu nguồn vốn (tỷ đồng) và Tài sản/VCSH (lần)', 'cFu'], ['ROE và ROA (theo 4 quý gần nhất)', 'cRo'],
  ['Định giá P/E', 'cPE'], ['Định giá P/B', 'cPB']
].map(([t, id]) => `<article class="card"><h3 id="t${id.slice(1)}">${t}</h3><div class="ch"><canvas id="${id}"></canvas></div></article>`).join('');

function bankCharts(lab, S, gr, pc, bn, div, npT) {
  const B = 1e9, z = (k, i) => S[k][i] || 0;
  const rest = (parts, sign) => S.ta.map((t, i) => t == null ? null : (t - parts.reduce((s, k) => s + z(k, i), 0)) / B);
  const st = (l, k, c) => bar(l, bn(S[k]), c, { stack: 's' });
  const toiOther = S.rev.map((v, i) => v == null ? null : (v - z('nii', i) - z('fee', i)) / B);
  draw('cToi', lab, [st('Thu nhập lãi thuần', 'nii', C.g), st('Lãi thuần dịch vụ', 'fee', C.b),
    bar('Thu nhập khác', toiOther, '#c9d3df', { stack: 's' }), line('Tăng trưởng TOI', gr(S.rev), C.o, { yAxisID: 'y2', unit: '%' })], { stack: true, y2: true });
  draw('cNp', lab, [bar('LNST công ty mẹ', bn(S.np), C.g), line('Tăng trưởng YoY', gr(S.np), C.o, { yAxisID: 'y2', unit: '%' })], { y2: true });
  draw('cLoan', lab, [bar('Cho vay khách hàng', bn(S.loan), C.g), line('Tăng trưởng YoY', gr(S.loan), C.o, { yAxisID: 'y2', unit: '%' })], { y2: true });
  draw('cAs', lab, [st('Cho vay khách hàng', 'loan', C.b), st('Chứng khoán đầu tư', 'sec', C.r), st('Chứng khoán kinh doanh', 'trade', '#f6c453'),
    st('Tiền gửi & cho vay TCTD khác', 'inter', C.gr), bar('Khác', rest(['loan', 'sec', 'trade', 'inter']), '#c9d3df', { stack: 's' })], { stack: true });
  draw('cFu', lab, [st('Tiền gửi khách hàng', 'dep', C.b), st('Giấy tờ có giá', 'bond', C.r), st('Tiền gửi & vay TCTD khác', 'ibd', '#f6c453'),
    st('Nợ Chính phủ & NHNN', 'gov', C.gr), st('Vốn chủ sở hữu', 'eq', '#7a4bd1'),
    bar('Khác', rest(['dep', 'bond', 'ibd', 'gov', 'eq']), '#c9d3df', { stack: 's' }),
    line('Tài sản/VCSH (lần)', div(S.ta, S.eq), '#111', { yAxisID: 'y2', unit: ' lần' })], { stack: true, y2: true });
  charts.cFu.options.scales.y2.ticks.callback = v => fmt(v); charts.cFu.update();
  draw('cRo', lab, [line('ROE', pc(div(npT, S.eq)), C.o, { unit: '%' }), line('ROA', pc(div(npT, S.ta)), C.g, { unit: '%' })], { pct: true });
}

/* ---------- KHỞI ĐỘNG ---------- */
const nm = s => (s || '').replace(/^\s*(?:[IVX]+\.|[\d.]+\)?|[-–])\s*/i, '').trim();
document.querySelector('main').insertAdjacentHTML('beforeend', '<details id="dbg" open><summary>Chẩn đoán kết nối</summary><pre id="log" style="white-space:pre-wrap;font-size:12px"></pre></details>');
async function loadAll() {
  clearInterval(timer); status('Đang tải…'); F = null;
  $('#badge').textContent = sym; $('#name').textContent = sym; $('#sector').textContent = '';
  try {
    const co = await J(`${VD}stocks?q=code:${sym}&size=1`).catch(() => null);
    const c = co?.data?.[0];
    if (c) { $('#name').textContent = `${c.companyName || sym} (${c.floor || ''}: ${sym})`; $('#sector').textContent = c.industryName || c.companyNameEng || ''; }
    await loadPrice(); await loadFin();
    timer = setInterval(refreshPrice, 15000);
  } catch (e) { status('Lỗi: ' + e.message, true); }
}
$('#f').onsubmit = e => { e.preventDefault(); sym = $('#sym').value.trim().toUpperCase() || 'HPG'; loadAll(); };
$('#mode').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  mode = b.dataset.m; [...$('#mode').children].forEach(x => x.classList.toggle('on', x === b)); loadFin().catch(er => status('Lỗi: ' + er.message, true)); };
$('#ranges').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  range = +b.dataset.d; [...$('#ranges').children].forEach(x => x.classList.toggle('on', x === b)); showPrice(); };
loadAll();
