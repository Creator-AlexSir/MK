const COMPONENTS = ["x", "y", "z"];
const COLORS = {
  x: { data: "#806edc", fit: "#ff9800" },
  y: { data: "#4da74d", fit: "#cb4b4b" },
  z: { data: "#2196f3", fit: "#e91e63" },
};
const MAX_N = 1000;

let N = 20;

const emptySeries = () => ({ x: [], y: [], z: [] });

const formulas = { x: "", y: "", z: "" };
const theoryCoeffs = {};
const lambdas = { x: 0, y: 0, z: 0 };
let estimates = null;
let seriesData = emptySeries();
let seriesFit = emptySeries();
let dataText = "";

const el = (id) => document.getElementById(id);

const formulaInputs = {
  x: el("formula-x"),
  y: el("formula-y"),
  z: el("formula-z"),
};
const noiseInputs = { x: el("noise-x"), y: el("noise-y"), z: el("noise-z") };
const nInput = el("N");
const saveNameInput = el("save-name");
const fileInput = el("hidden-file-input");
const fileNameLabel = el("file-name");
const statusEl = el("status");

function toSubscriptNumber(num) {
  return num
    .toString()
    .split("")
    .map((d) => String.fromCharCode(0x2080 + parseInt(d)))
    .join("");
}

function toSuperscriptNumber(num) {
  const map = {
    0: "⁰",
    1: "¹",
    2: "²",
    3: "³",
    4: "⁴",
    5: "⁵",
    6: "⁶",
    7: "⁷",
    8: "⁸",
    9: "⁹",
    n: "ⁿ",
  };
  return num
    .toString()
    .split("")
    .map((ch) => map[ch] || ch)
    .join("");
}

function convertToDisplayFormula(formula) {
  let result = formula;
  result = result.replace(
    /\b(a)(\d+)/g,
    (m, p, num) => `${p}${toSubscriptNumber(num)}`,
  );
  result = result.replace(
    /\[t-(\d+)\]/g,
    (m, offset) => `ₜ₋${toSubscriptNumber(offset)}`,
  );
  result = result.replace(/\[t\]/g, "ₜ");
  result = result.replace(/\bwt\b/g, "wₜ");
  result = result.replace(/\bpi\b/gi, "π");
  result = result.replace(
    /(\w+|\([^)]+\))\s*(\^|\*\*)\s*(\d+)/g,
    (m, base, _, exp) => `${base}${toSuperscriptNumber(exp)}`,
  );
  return result;
}

function convertToRawFormula(displayFormula) {
  const decodeSub = (s) => {
    const map = {
      "₀": "0",
      "₁": "1",
      "₂": "2",
      "₃": "3",
      "₄": "4",
      "₅": "5",
      "₆": "6",
      "₇": "7",
      "₈": "8",
      "₉": "9",
    };
    return s
      .split("")
      .map((ch) => map[ch] || ch)
      .join("");
  };
  const decodeSup = (s) => {
    const map = {
      "⁰": "0",
      "¹": "1",
      "²": "2",
      "³": "3",
      "⁴": "4",
      "⁵": "5",
      "⁶": "6",
      "⁷": "7",
      "⁸": "8",
      "⁹": "9",
      ⁿ: "n",
    };
    return s
      .split("")
      .map((ch) => map[ch] || ch)
      .join("");
  };

  let result = displayFormula;
  result = result.replace(
    /([xyz])ₜ₋([₀₁₂₃₄₅₆₇₈₉]+)/g,
    (m, p, sub) => `${p}[t-${decodeSub(sub)}]`,
  );
  result = result.replace(/([xyz])ₜ/g, (m, p) => `${p}[t]`);
  result = result.replace(/wₜ/g, "wt");
  result = result.replace(
    /\b(a)([₀₁₂₃₄₅₆₇₈₉]+)/g,
    (m, p, sub) => `${p}${decodeSub(sub)}`,
  );
  result = result.replace(/π/g, "pi");
  result = result.replace(
    /(\w+|\([^)]+\))([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ]+)/g,
    (m, base, sup) => `${base}^${decodeSup(sup)}`,
  );
  return result;
}

function extractIndices(rawFormula, prefix) {
  const re = new RegExp(`\\b${prefix}(\\d+)\\b`, "g");
  const set = new Set();
  let m;
  while ((m = re.exec(rawFormula)) !== null) set.add(parseInt(m[1]));
  return Array.from(set).sort((a, b) => a - b);
}

function formulaToJS(expr) {
  return expr
    .replace(/pi/g, "Math.PI")
    .replace(/sin\(/g, "Math.sin(")
    .replace(/cos\(/g, "Math.cos(")
    .replace(/tan\(/g, "Math.tan(")
    .replace(/exp\(/g, "Math.exp(")
    .replace(/ln\(/g, "Math.log(")
    .replace(/sqrt\(/g, "Math.sqrt(")
    .replace(/\^/g, "**");
}

function getNormalRandom() {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function formulaHasNoise(comp) {
  return /\bwt\b/.test(formulas[comp]);
}

function getActiveComps() {
  const active = new Set(["x"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of Array.from(active)) {
      for (const v of ["y", "z"]) {
        if (!active.has(v) && new RegExp(`\\b${v}\\[`).test(formulas[c])) {
          active.add(v);
          changed = true;
        }
      }
    }
  }
  return COMPONENTS.filter((c) => active.has(c));
}

function getWorkingComps() {
  return getActiveComps().filter((c) => formulas[c]);
}

function collectIndices(comps) {
  const set = new Set();
  for (const c of comps) extractIndices(formulas[c], "a").forEach((i) => set.add(i));
  return Array.from(set).sort((p, q) => p - q);
}

function applyVisibility() {
  const active = getActiveComps();
  for (const c of COMPONENTS) {
    el(`row-${c}`).classList.toggle("hidden", !active.includes(c));
  }
}

function evaluate(comp, t, coeffs, series, noise) {
  let e = formulas[comp];
  e = e.replace(/([xyz])\[t(?:-(\d+))?\]/g, (m, v, lag) => {
    const i = t - (lag ? parseInt(lag) : 0);
    const arr = series[v] || [];
    const val = i >= 0 && i < arr.length && Number.isFinite(arr[i]) ? arr[i] : 0;
    return `(${val})`;
  });
  e = e.replace(/\bt\b/g, `(${t})`);
  e = e.replace(/\b(a\d+)\b/g, (m, k) => `(${coeffs[k] ?? 0})`);
  e = e.replace(/\bwt\b/g, `(${noise})`);
  e = formulaToJS(e);
  try {
    const v = eval(e);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

// Один шаг модели: f(...) + λ·w, w ~ N(0,1). Если в формуле явно записан wt,
// то λ·w подставляется вместо него, а не добавляется автоматически.
function stepValue(comp, t, series) {
  const w = (lambdas[comp] || 0) * getNormalRandom();
  if (formulaHasNoise(comp)) return evaluate(comp, t, theoryCoeffs, series, w);
  return evaluate(comp, t, theoryCoeffs, series, 0) + w;
}

function generateSeries(comps, length) {
  const series = emptySeries();
  for (let t = 0; t < length; t++) {
    for (const c of comps) series[c][t] = stepValue(c, t, series);
  }
  return series;
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((r) => [...r]);
  const v = [...b];

  for (let i = 0; i < n; i++) {
    let max = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(M[j][i]) > Math.abs(M[max][i])) max = j;
    [M[i], M[max]] = [M[max], M[i]];
    [v[i], v[max]] = [v[max], v[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let j = i + 1; j < n; j++) {
      const f = M[j][i] / M[i][i];
      v[j] -= f * v[i];
      for (let k = i; k < n; k++) M[j][k] -= f * M[i][k];
    }
  }

  const res = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = 0;
    for (let j = i + 1; j < n; j++) s += M[i][j] * res[j];
    res[i] = (v[i] - s) / M[i][i];
  }
  return res;
}

function parseDataBlock(text) {
  const out = emptySeries();
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^([xyz])\s*[:=]\s*(.+)$/i);
    if (!m) continue;
    out[m[1].toLowerCase()] = m[2]
      .split(/[\s,;]+/)
      .map(Number)
      .filter((v) => !isNaN(v));
  }
  return out;
}

function maxLag(raw) {
  let m = 0;
  raw.replace(/[xyz]\[t-(\d+)\]/g, (s, l) => {
    m = Math.max(m, parseInt(l));
    return s;
  });
  return m;
}

function tQuantile(dof) {
  const tab = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];
  if (dof < 1) return null;
  if (dof <= 10) return tab[dof - 1];
  const z = 1.959964;
  return (
    z +
    (z ** 3 + z) / (4 * dof) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * dof ** 2)
  );
}

function estimateAll(comps, data) {
  const idxs = collectIndices(comps);
  const K = idxs.length;
  if (!K) return null;

  const unit = idxs.map((i) => {
    const cf = {};
    idxs.forEach((j) => (cf[`a${j}`] = j === i ? 1 : 0));
    return cf;
  });

  const Z = [];
  const target = [];
  const owner = [];
  for (const c of comps) {
    const y = data[c];
    if (!y || !y.length) continue;
    const t0 = maxLag(formulas[c]);
    for (let t = t0; t < y.length; t++) {
      Z.push(unit.map((cf) => evaluate(c, t, cf, data, 0)));
      target.push(y[t]);
      owner.push(c);
    }
  }
  const M = Z.length;
  if (M <= K) return null;

  const A = Array.from({ length: K }, () => Array(K).fill(0));
  const b = Array(K).fill(0);
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++)
      for (let r = 0; r < M; r++) A[i][j] += Z[r][i] * Z[r][j];
    for (let r = 0; r < M; r++) b[i] += Z[r][i] * target[r];
  }
  const beta = solveLinear(A, b);
  if (!beta) return null;

  const rss = {}, cnt = {};
  for (let r = 0; r < M; r++) {
    let pred = 0;
    for (let i = 0; i < K; i++) pred += Z[r][i] * beta[i];
    rss[owner[r]] = (rss[owner[r]] || 0) + (target[r] - pred) ** 2;
    cnt[owner[r]] = (cnt[owner[r]] || 0) + 1;
  }
  const s2 = {}, dofC = {};
  for (const c of Object.keys(rss)) {
    const k = extractIndices(formulas[c], "a").length;
    dofC[c] = cnt[c] - k;
    s2[c] = dofC[c] > 0 ? rss[c] / dofC[c] : null;
  }

  // ковариация: (ZᵀZ)⁻¹ · Σ s²_c·z zᵀ · (ZᵀZ)⁻¹ (у уравнений может быть разный шум)
  const inv = Array.from({ length: K }, () => Array(K).fill(0));
  for (let j = 0; j < K; j++) {
    const e = Array(K).fill(0);
    e[j] = 1;
    const col = solveLinear(A, e);
    if (!col) return null;
    for (let i = 0; i < K; i++) inv[i][j] = col[i];
  }
  const canErr = Object.values(s2).every((v) => v !== null);
  let se = null;
  if (canErr) {
    const B = Array.from({ length: K }, () => Array(K).fill(0));
    for (let r = 0; r < M; r++) {
      const w = s2[owner[r]];
      for (let i = 0; i < K; i++)
        for (let j = 0; j < K; j++) B[i][j] += w * Z[r][i] * Z[r][j];
    }
    se = [];
    for (let i = 0; i < K; i++) {
      let v = 0;
      for (let p = 0; p < K; p++)
        for (let q = 0; q < K; q++) v += inv[i][p] * B[p][q] * inv[q][i];
      se.push(Math.sqrt(Math.max(v, 0)));
    }
  }

  const tq = tQuantile(M - K);
  const coeffs = {};
  idxs.forEach((idx, i) => {
    const e = { value: beta[i], lo: null, hi: null };
    if (se && tq) {
      e.lo = beta[i] - tq * se[i];
      e.hi = beta[i] + tq * se[i];
    }
    coeffs[`a${idx}`] = e;
  });

  // λ̂ — стандартное отклонение остатков; интервал приближённый: s ± t·s/√(2·dof)
  const lambda = {};
  for (const c of Object.keys(rss)) {
    if (s2[c] === null) {
      lambda[c] = { value: null, lo: null, hi: null };
      continue;
    }
    const s = Math.sqrt(s2[c]);
    const tc = tQuantile(dofC[c]);
    const h = tc ? (tc * s) / Math.sqrt(2 * dofC[c]) : null;
    lambda[c] = { value: s, lo: h !== null ? Math.max(0, s - h) : null, hi: h !== null ? s + h : null };
  }
  return { coeffs, lambda };
}

function buildFit(comp, data) {
  const n = (data[comp] || []).length;
  if (!estimates) return [];
  const cf = {};
  for (const [k, v] of Object.entries(estimates.coeffs)) cf[k] = v.value;
  const t0 = maxLag(formulas[comp]);
  const out = [];
  for (let t = 0; t < n; t++) out.push(t < t0 ? null : evaluate(comp, t, cf, data, 0));
  return out;
}

function fmt(v, d = 4) {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—";
}

function intervalHTML(e) {
  if (!e || e.lo === null || e.hi === null || e.value === null) return "—";
  return (
    '<div class="ci"><span class="pm">±</span>' +
    '<span class="pm-vals">' +
    `<span>+${fmt(e.hi - e.value, 3)}</span>` +
    `<span>−${fmt(e.value - e.lo, 3)}</span>` +
    "</span></div>"
  );
}

function buildTable(comps) {
  const panel = document.createElement("div");
  panel.className = "coeff-panel";
  panel.innerHTML =
    '<table class="coeff-table"><thead><tr><th></th><th>Задано</th>' +
    "<th>Оценка</th><th>Доверительный интервал</th></tr></thead><tbody></tbody></table>";
  const body = panel.querySelector("tbody");

  const rows = collectIndices(comps).map((idx) => ({
    label: `a${toSubscriptNumber(idx)}`,
    value: theoryCoeffs[`a${idx}`] ?? 0,
    est: estimates ? estimates.coeffs[`a${idx}`] : null,
    onInput: (v) => (theoryCoeffs[`a${idx}`] = v),
  }));
  for (const c of comps) {
    rows.push({
      label: `λ<sub>${c}</sub>`,
      isLambda: true,
      value: lambdas[c] ?? 0,
      est: estimates && estimates.lambda ? estimates.lambda[c] : null,
    });
  }

  for (const r of rows) {
    const tr = document.createElement("tr");
    if (r.isLambda) tr.className = "lambda-row";

    const tdName = document.createElement("td");
    tdName.innerHTML = r.label;
    tr.appendChild(tdName);

    const tdIn = document.createElement("td");
    if (r.isLambda) {
      tdIn.textContent = String(r.value);
    } else {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.01";
      input.max = "100000";
      input.value = r.value;
      input.addEventListener("input", function () {
        if (parseFloat(this.value) > 100000) this.value = 100000;
        r.onInput(parseFloat(this.value) || 0);
      });
      tdIn.appendChild(input);
    }
    tr.appendChild(tdIn);

    const tdEst = document.createElement("td");
    tdEst.textContent = r.est ? fmt(r.est.value) : "—";
    tr.appendChild(tdEst);

    const tdCi = document.createElement("td");
    tdCi.innerHTML = intervalHTML(r.est);
    tr.appendChild(tdCi);

    body.appendChild(tr);
  }
  return panel;
}

function calcR2(comp) {
  const y = seriesData[comp] || [];
  const f = seriesFit[comp] || [];
  if (!y.length || !f.length) return null;
  let n = 0, sum = 0;
  for (let i = 0; i < y.length; i++) if (f[i] !== null && f[i] !== undefined) { n++; sum += y[i]; }
  if (n < 2) return null;
  const mean = sum / n;
  let ssr = 0, sst = 0;
  for (let i = 0; i < y.length; i++) {
    if (f[i] === null || f[i] === undefined) continue;
    ssr += (y[i] - f[i]) ** 2;
    sst += (y[i] - mean) ** 2;
  }
  return { r2: sst > 0 ? 1 - ssr / sst : null, n };
}

function estimatedEquation(comp) {
  const raw = formulas[comp].replace(/\ba(\d+)\b/g, (m, i) => {
    const e = estimates.coeffs[`a${i}`];
    if (!e) return m;
    const v = e.value.toFixed(3);
    return e.value < 0 ? `(${v})` : v;
  });
  const shown = convertToDisplayFormula(raw).replace(/\^(\d+)/g, (m, e) => toSuperscriptNumber(e)).replace(/\*/g, "·").replace(/-(?=\d)/g, "−");
  return `${comp}ₜ = ${shown}`;
}

function buildSummary(comps) {
  const box = document.createElement("div");
  box.className = "summary";
  box.innerHTML = "<h4>Оценённая модель</h4>";
  if (!estimates) {
    box.innerHTML +=
      '<p class="empty-note">После нажатия «Рассчитать» здесь появятся уравнения с найденными коэффициентами и R².</p>';
    return box;
  }
  for (const c of comps) {
    const st = calcR2(c);
    const line = document.createElement("div");
    line.className = "eq-line";
    const eq = document.createElement("div");
    eq.textContent = estimatedEquation(c);
    line.appendChild(eq);
    const meta = document.createElement("div");
    meta.className = "eq-meta";
    meta.textContent = st
      ? `R² = ${st.r2 === null ? "—" : st.r2.toFixed(4)}, точек: ${st.n}`
      : "";
    line.appendChild(meta);
    box.appendChild(line);
  }
  return box;
}

function renderCoeffPanels() {
  const box = el("coeff-group");
  const comps = getWorkingComps();
  box.innerHTML = "";
  if (!comps.length) {
    box.innerHTML =
      '<p class="empty-note">Введите уравнение — здесь появятся коэффициенты.</p>';
    return;
  }
  box.appendChild(buildTable(comps));
  // box.appendChild(buildSummary(comps)); // «Оценённая модель» — пока отключено
}

function plotGraph() {
  if (typeof $ === "undefined" || !$.plot) return;

  const datasets = [];
  for (const comp of getWorkingComps()) {
    if (seriesData[comp].length) {
      datasets.push({
        label: `${comp}[t]`,
        data: seriesData[comp].map((v, i) => [i, v]),
        color: COLORS[comp].data,
        lines: { show: true, lineWidth: 2 },
        points: { show: false },
      });
    }
    if (seriesFit[comp].length) {
      datasets.push({
        label: `МНК ${comp}[t]`,
        data: seriesFit[comp].map((v, i) => [i, v]),
        color: COLORS[comp].fit,
        lines: { show: true, lineWidth: 2, dashes: [5, 3] },
        points: { show: false },
      });
    }
  }

  const options = {
    grid: {
      hoverable: true,
      clickable: true,
      borderWidth: 1,
      borderColor: "#ddd",
      minBorderMargin: 10,
    },
    legend: { position: "ne" },
  };
  const font = { size: 15, family: "Century Gothic, Cambria, serif" };
  options.xaxis = { font };
  options.yaxis = { font };
  if (!datasets.length) {
    options.xaxis.min = 0;
    options.xaxis.max = N;
    options.yaxis.min = 0;
    options.yaxis.max = 1;
  }

  try {
    $.plot($("#graf"), datasets, options);
  } catch (e) {
    console.warn(e);
  }
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

function refreshUI() {
  applyVisibility();
  renderCoeffPanels();
  plotGraph();
}

function readN() {
  let n = parseInt(nInput.value) || 20;
  n = Math.min(Math.max(n, 3), MAX_N);
  nInput.value = n;
  N = n;
  return n;
}

function seriesToText(series, comps) {
  return comps
    .map((c) => `${c}: ${series[c].map((v) => v.toFixed(4)).join(", ")}`)
    .join("\n");
}

function downloadText(name, text) {
  let fname = name.trim().replace(/[\\/:*?"<>|]/g, "_");
  if (!/\.[a-z0-9]+$/i.test(fname)) fname += ".txt";
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return fname;
}

function onGenerate() {
  const comps = getWorkingComps();
  if (!comps.length) {
    setStatus("Сначала введите уравнение.", true);
    return;
  }
  const n = readN();
  seriesData = generateSeries(comps, n);
  seriesFit = emptySeries();
  estimates = null;

  const text = seriesToText(seriesData, comps);
  dataText = text;

  let msg = `Сгенерировано ${n} точек.`;
  if (saveNameInput.value.trim()) {
    msg += ` Сохранено в файл «${downloadText(saveNameInput.value, text)}».`;
  }
  setStatus(msg);
  renderCoeffPanels();
  plotGraph();
}

function onCalculate() {
  const comps = getWorkingComps();
  if (!comps.length) {
    setStatus("Сначала введите уравнение.", true);
    return;
  }
  const data = parseDataBlock(dataText);
  if (!comps.some((c) => data[c].length)) {
    setStatus("Нет данных: выберите файл или введите ряды (x:, y:, z:).", true);
    return;
  }

  seriesData = data;
  seriesFit = emptySeries();
  estimates = estimateAll(comps, data);
  if (estimates) {
    for (const c of comps) seriesFit[c] = buildFit(c, data);
    setStatus("Коэффициенты рассчитаны.");
  } else {
    setStatus(
      "Не удалось оценить коэффициенты: мало данных или вырожденная система.",
      true,
    );
  }
  renderCoeffPanels();
  plotGraph();
}

function onFormulaChange(comp) {
  const input = formulaInputs[comp];
  let userInput = input.value;
  if (userInput.includes("="))
    userInput = userInput.substring(userInput.indexOf("=") + 1).trim();

  const raw = convertToRawFormula(userInput);
  const display = convertToDisplayFormula(raw);
  const full = `${comp}ₜ = ` + display;

  if (input.value !== full && raw !== "") input.value = full;
  formulas[comp] = raw;

  estimates = null;
  seriesFit = emptySeries();
  refreshUI();
}

function onFileChosen() {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  fileNameLabel.textContent = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    dataText = String(reader.result);
    seriesData = parseDataBlock(dataText);
    seriesFit = emptySeries();
    estimates = null;
    const counts = COMPONENTS.filter((c) => seriesData[c].length)
      .map((c) => `${c}: ${seriesData[c].length}`)
      .join(", ");
    setStatus(
      counts
        ? `Файл загружен (${counts}). Нажмите «Рассчитать».`
        : "В файле не найдено рядов вида «x: 1, 2, 3».",
      !counts,
    );
    renderCoeffPanels();
    plotGraph();
  };
  reader.onerror = () => setStatus("Не удалось прочитать файл.", true);
  reader.readAsText(file);
  fileInput.value = "";
}

COMPONENTS.forEach((comp) => {
  formulaInputs[comp].addEventListener("input", () => onFormulaChange(comp));
});

COMPONENTS.forEach((comp) => {
  noiseInputs[comp].addEventListener("input", function () {
    if (parseFloat(this.value) < 0) this.value = 0;
    lambdas[comp] = parseFloat(this.value) || 0;
    renderCoeffPanels();
  });
});

el("file-btn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", onFileChosen);
el("btn-gen").addEventListener("click", onGenerate);
el("btn-calc").addEventListener("click", onCalculate);

document.addEventListener("wheel", function () {
  if (document.activeElement && document.activeElement.type === "number") {
    document.activeElement.blur();
  }
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(plotGraph, 150);
});

window.addEventListener("DOMContentLoaded", () => {
  COMPONENTS.forEach((c) => {
    formulaInputs[c].value = "";
    lambdas[c] = parseFloat(noiseInputs[c].value) || 0;
  });
  refreshUI();
});
