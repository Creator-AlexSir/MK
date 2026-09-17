// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==================
const MODELS = [1, 2];

const state = {
  1: { formulaRaw: "", coeffIndices: [], theoryCoeffs: {}, estimatedCoeffs: {},
       xValues: [], lsmValues: [], N: 20, x0: 0, wt: 1 },
  2: { formulaRaw: "", coeffIndices: [], theoryCoeffs: {}, estimatedCoeffs: {},
       xValues: [], lsmValues: [], N: 20, x0: 0, wt: 1 },
};

let ySeries = [];

// ==================== ГЕНЕРАЦИЯ ШУМА ========================
function getNormalRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==================
function toSubscriptNumber(num) {
  return num.toString().split("").map(d => String.fromCharCode(0x2080 + parseInt(d))).join("");
}
function toSuperscriptNumber(num) {
  const supMap = {0:"⁰",1:"¹",2:"²",3:"³",4:"⁴",5:"⁵",6:"⁶",7:"⁷",8:"⁸",9:"⁹",n:"ⁿ"};
  return num.toString().split("").map(ch => supMap[ch] || ch).join("");
}
function convertToDisplayFormula(formula) {
  let r = formula;
  r = r.replace(/a(\d+)/g, (m,n) => `a${toSubscriptNumber(n)}`);
  r = r.replace(/x\[t-(\d+)\]/g, (m,o) => `xₜ₋${toSubscriptNumber(o)}`);
  r = r.replace(/x\[t\]/g, "xₜ");
  r = r.replace(/\bwt\b/g, "wₜ");
  r = r.replace(/\bpi\b/gi, "π");
  r = r.replace(/(\w+|\([^)]+\))\s*(\^|\*\*)\s*(\d+)/g,
               (m,b,_,e) => `${b}${toSuperscriptNumber(e)}`);
  return r;
}
function convertToRawFormula(displayFormula) {
  let r = displayFormula;
  const decSub = s => s.split("").map(ch => ({"₀":"0","₁":"1","₂":"2","₃":"3","₄":"4","₅":"5","₆":"6","₇":"7","₈":"8","₉":"9"}[ch]||ch)).join("");
  const decSup = s => s.split("").map(ch => ({"⁰":"0","¹":"1","²":"2","³":"3","⁴":"4","⁵":"5","⁶":"6","⁷":"7","⁸":"8","⁹":"9","ⁿ":"n"}[ch]||ch)).join("");
  r = r.replace(/xₜ₋([₀₁₂₃₄₅₆₇₈₉]+)/g, (m,s) => `x[t-${decSub(s)}]`);
  r = r.replace(/xₜ/g, "x[t]");
  r = r.replace(/wₜ/g, "wt");
  r = r.replace(/a([₀₁₂₃₄₅₆₇₈₉]+)/g, (m,s) => `a${decSub(s)}`);
  r = r.replace(/π/g, "pi");
  r = r.replace(/(\w+|\([^)]+\))([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ]+)/g, (m,b,s) => `${b}^${decSup(s)}`);
  return r;
}
function extractIndicesFromRaw(rawFormula) {
  const aRegex = /a(\d+)/g;
  let match, indices = new Set();
  while ((match = aRegex.exec(rawFormula)) !== null) indices.add(parseInt(match[1]));
  return Array.from(indices).sort((a,b) => a-b);
}

// ==================== DOM ХЕЛПЕРЫ ==================
// ВАЖНО: $id — свой хелпер, $ — это jQuery (для $.plot)
const $id = id => document.getElementById(id);

const getFormulaInput    = m => $id(`formula-${m}`);
const getNInput          = m => $id(`N-${m}`);
const getWtInput         = m => $id(`Wt-${m}`);
const getX0Input         = m => $id(`x0-input-${m}`);
const getX0Group         = m => $id(`x0-group-${m}`);
const getCoeffTbody      = m => $id(`coeffs-table-body-${m}`);
const getGraf            = m => $id(`graf-${m}`);
const getGeneratedOutput = m => $id(`generated-data-output-${m}`);

// ==================== ИНТЕРФЕЙС КОЭФФИЦИЕНТОВ ================
function renderCoeffPanel(modelNum) {
  const st = state[modelNum];
  const container = getCoeffTbody(modelNum);
  if (!container) return;

  if (!st.coeffIndices || st.coeffIndices.length === 0) {
    container.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#aaa;">— нет коэффициентов —</td></tr>';
    return;
  }

  container.innerHTML = "";
  for (let idx of st.coeffIndices) {
    const key = `a${idx}`;
    const theoryVal = st.theoryCoeffs[key] !== undefined ? st.theoryCoeffs[key] : 0;
    const estimatedVal = st.estimatedCoeffs[key] !== undefined
      ? st.estimatedCoeffs[key].toFixed(4) : "—";

    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.innerHTML = `a${toSubscriptNumber(idx.toString())}`;
    tr.appendChild(tdName);

    const tdTheory = document.createElement("td");
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.01";
    input.value = theoryVal;
    input.setAttribute("data-coeff", key);
    input.max = "100000";
    input.addEventListener("input", function () {
      if (parseFloat(this.value) > 100000) this.value = 100000;
      st.theoryCoeffs[key] = parseFloat(this.value) || 0;
      recalculateAndPlot(modelNum);
      onGenerateDirect(modelNum);
      plotCompare();
      updateMetrics();
    });
    tdTheory.appendChild(input);
    tr.appendChild(tdTheory);

    const tdEstimated = document.createElement("td");
    tdEstimated.textContent = estimatedVal;
    tr.appendChild(tdEstimated);
    container.appendChild(tr);
  }
}

function syncTheoryFromDom(modelNum) {
  const st = state[modelNum];
  const container = getCoeffTbody(modelNum);
  if (!container) return;
  container.querySelectorAll("input[data-coeff]").forEach(inp => {
    const key = inp.getAttribute("data-coeff");
    st.theoryCoeffs[key] = parseFloat(inp.value) || 0;
  });
}

// ==================== КНОПКИ ПЕРЕНОСА ================
function transferEstimatedToTheory(modelNum) {
  const st = state[modelNum];
  if (!st.estimatedCoeffs || Object.keys(st.estimatedCoeffs).length === 0) {
    alert("Нет расчётных коэффициентов. Введите данные для МНК.");
    return;
  }
  for (let key in st.estimatedCoeffs) {
    st.theoryCoeffs[key] = +st.estimatedCoeffs[key].toFixed(4);
  }
  renderCoeffPanel(modelNum);
  recalculateAndPlot(modelNum);
  onGenerateDirect(modelNum);
  plotCompare();
  updateMetrics();
}

function resetTheoryCoeffs(modelNum) {
  const st = state[modelNum];
  for (let key of st.coeffIndices) st.theoryCoeffs[`a${key}`] = 0;
  renderCoeffPanel(modelNum);
  recalculateAndPlot(modelNum);
  onGenerateDirect(modelNum);
  plotCompare();
  updateMetrics();
}

// ==================== ВЫЧИСЛЕНИЯ И МОДЕЛИРОВАНИЕ ============
function prepareExpr(formulaRaw) {
  return formulaRaw
    .replace(/pi/g, "Math.PI")
    .replace(/sin\(/g, "Math.sin(")
    .replace(/cos\(/g, "Math.cos(")
    .replace(/tan\(/g, "Math.tan(")
    .replace(/exp\(/g, "Math.exp(")
    .replace(/ln\(/g, "Math.log(")
    .replace(/sqrt\(/g, "Math.sqrt(")
    .replace(/\^/g, "**");
}

function calculateModel(modelNum, coeffs, length) {
  const st = state[modelNum];
  if (!st.formulaRaw || st.coeffIndices.length === 0) return [];

  let baseExpr = prepareExpr(st.formulaRaw);
  let result = [];
  const wtMultiplier = st.wt;

  for (let t = 0; t < length; t++) {
    let evalExpr = baseExpr;

    evalExpr = evalExpr.replace(/x\[t-(\d+)\]/g, (m, lag) => {
      const i = t - parseInt(lag);
      if (i >= 0 && i < result.length) return result[i];
      return st.x0;
    });

    evalExpr = evalExpr.replace(/\bt\b/g, t);

    for (let [key, val] of Object.entries(coeffs)) {
      evalExpr = evalExpr.replace(new RegExp(`\\b${key}\\b`, "g"), val);
    }

    let wt = (getNormalRandom() * wtMultiplier).toString();
    evalExpr = evalExpr.replace(/\bwt\b/g, wt);

    try {
      let val = eval(evalExpr);
      result[t] = isNaN(val) || !isFinite(val) ? 0 : val;
    } catch (e) {
      result[t] = 0;
    }
  }
  return result;
}

function recalculateAndPlot(modelNum) {
  const st = state[modelNum];
  if (st.coeffIndices.length === 0) {
    plotGraphEmpty(modelNum);
    return;
  }
  const hasValid = Object.values(st.theoryCoeffs).some(v => v !== 0);
  st.xValues = hasValid
    ? calculateModel(modelNum, st.theoryCoeffs, st.N)
    : calculateModel(modelNum, Object.fromEntries(st.coeffIndices.map(i => [`a${i}`, 0])), st.N);

  if (st.estimatedCoeffs && Object.keys(st.estimatedCoeffs).length > 0) {
    st.lsmValues = calculateModel(modelNum, st.estimatedCoeffs, st.N);
  } else {
    st.lsmValues = [];
  }
  plotGraph(modelNum);
}

// ==================== МАТЕМАТИЧЕСКИЙ АППАРАТ (МНК) ============
function solveLinear(A, b) {
  let n = b.length;
  let M = A.map(r => [...r]);
  let v = [...b];
  for (let i = 0; i < n; i++) {
    let max = i;
    for (let j = i+1; j < n; j++)
      if (Math.abs(M[j][i]) > Math.abs(M[max][i])) max = j;
    [M[i], M[max]] = [M[max], M[i]];
    [v[i], v[max]] = [v[max], v[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let j = i+1; j < n; j++) {
      let f = M[j][i] / M[i][i];
      v[j] -= f * v[i];
      for (let k = i; k < n; k++) M[j][k] -= f * M[i][k];
    }
  }
  let res = new Array(n);
  for (let i = n-1; i >= 0; i--) {
    let s = 0;
    for (let j = i+1; j < n; j++) s += M[i][j] * res[j];
    res[i] = (v[i] - s) / M[i][i];
  }
  return res;
}

function estimateCoefficientsFromData() {
  if (ySeries.length < 3) {
    MODELS.forEach(m => { state[m].estimatedCoeffs = {}; renderCoeffPanel(m); });
    MODELS.forEach(m => { recalculateAndPlot(m); plotCompare(); });
    updateMetrics();
    return;
  }

  MODELS.forEach(modelNum => {
    const st = state[modelNum];
    if (!st.formulaRaw || st.coeffIndices.length === 0) {
      st.estimatedCoeffs = {};
      return;
    }

    const k = st.coeffIndices.length;
    const n = ySeries.length;
    let Z = [];

    for (let t = 0; t < n; t++) {
      let row = [];
      for (let idx of st.coeffIndices) {
        let expr = st.formulaRaw;
        for (let other of st.coeffIndices) {
          expr = expr.replace(new RegExp(`\\ba${other}\\b`, "g"), other === idx ? 1 : 0);
        }
        expr = prepareExpr(expr);
        expr = expr.replace(/x\[t-(\d+)\]/g, (m, lag) => {
          const i = t - parseInt(lag);
          return (i >= 0 && i < ySeries.length) ? ySeries[i] : 0;
        });
        expr = expr.replace(/\bwt\b/g, "0").replace(/\bt\b/g, t);
        try { row.push(eval(expr)); } catch(e) { row.push(0); }
      }
      Z.push(row);
    }

    let ZTZ = Array(k).fill().map(() => Array(k).fill(0));
    let ZTy = Array(k).fill(0);
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++)
        for (let m = 0; m < n; m++) ZTZ[i][j] += Z[m][i] * Z[m][j];
      for (let m = 0; m < n; m++) ZTy[i] += Z[m][i] * ySeries[m];
    }

    const sol = solveLinear(ZTZ, ZTy);
    if (!sol) {
      st.estimatedCoeffs = {};
      return;
    }
    st.estimatedCoeffs = {};
    for (let p = 0; p < st.coeffIndices.length; p++)
      st.estimatedCoeffs[`a${st.coeffIndices[p]}`] = sol[p];
  });

  MODELS.forEach(m => renderCoeffPanel(m));
  MODELS.forEach(m => recalculateAndPlot(m));
  plotCompare();
  updateMetrics();
}

// ==================== МЕТРИКИ КАЧЕСТВА ============
function computeMetrics(actual, predicted) {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return null;

  let sumSqErr = 0, sumAbsErr = 0, sumAbsPctErr = 0, sumY = 0, countPct = 0;
  for (let i = 0; i < n; i++) {
    const y = actual[i];
    const p = predicted[i];
    const err = y - p;
    sumSqErr += err * err;
    sumAbsErr += Math.abs(err);
    if (y !== 0) { sumAbsPctErr += Math.abs(err / y); countPct++; }
    sumY += y;
  }
  const meanY = sumY / n;
  let ssTot = 0;
  for (let i = 0; i < n; i++) ssTot += (actual[i] - meanY) ** 2;

  const mse = sumSqErr / n;
  const mae = sumAbsErr / n;
  const mape = countPct > 0 ? (sumAbsPctErr / countPct) * 100 : null;
  const r2 = ssTot > 1e-12 ? 1 - sumSqErr / ssTot : null;

  return { mse, mae, r2, mape };
}

function updateMetrics() {
  const tbody = $id("metrics-body");
  if (!tbody) return;

  if (ySeries.length < 3) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#aaa;">Введите данные для расчёта</td></tr>';
    return;
  }

  const rows = [];
  MODELS.forEach(m => {
    const st = state[m];
    if (st.xValues && st.xValues.length > 0) {
      const mt = computeMetrics(ySeries, st.xValues);
      if (mt) rows.push({ model: m, type: "Теор.", ...mt });
    }
    if (st.lsmValues && st.lsmValues.length > 0) {
      const mr = computeMetrics(ySeries, st.lsmValues);
      if (mr) rows.push({ model: m, type: "МНК", ...mr });
    }
  });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#aaa;">Нет данных для сравнения</td></tr>';
    return;
  }

  // Ищем максимальный R²
  let bestR2 = -Infinity;
  rows.forEach(r => {
    if (r.r2 !== null && r.r2 > bestR2) bestR2 = r.r2;
  });

  tbody.innerHTML = "";
  rows.forEach(r => {
    const isBest = r.r2 !== null && Math.abs(r.r2 - bestR2) < 1e-9;
    const tr = document.createElement("tr");
    if (isBest) tr.className = "best-row";
    tr.innerHTML = `
      <td>Модель ${r.model}</td>
      <td>${r.type}</td>
      <td>${r.mse.toFixed(4)}</td>
      <td>${r.mae.toFixed(4)}</td>
      <td>${r.r2 !== null ? r.r2.toFixed(4) : "—"}</td>
      <td>${r.mape !== null ? r.mape.toFixed(2) : "—"}</td>
      <td>${isBest ? "★" : ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ==================== ОТРИСОВКА ГРАФИКОВ ====================
const MODEL_COLORS = {
  1: { theory: "#806edc", lsm: "#b3a4ff" },
  2: { theory: "#ff9800", lsm: "#ffc966" },
};

function plotGraph(modelNum) {
  const st = state[modelNum];
  const datasets = [];
  if (st.xValues && st.xValues.length > 0) {
    datasets.push({
      label: `Модель ${modelNum} (теор.)`,
      data: st.xValues.map((v,i) => [i,v]),
      color: MODEL_COLORS[modelNum].theory,
      lines: { show: true, lineWidth: 2 },
      points: { show: true, radius: 2.5 },
    });
  }
  if (st.lsmValues && st.lsmValues.length > 0) {
    datasets.push({
      label: `Модель ${modelNum} (МНК)`,
      data: st.lsmValues.map((v,i) => [i,v]),
      color: MODEL_COLORS[modelNum].lsm,
      lines: { show: true, lineWidth: 2 },
      points: { show: true, radius: 2.5 },
    });
  }
  try {
    $.plot($id(`graf-${modelNum}`), datasets, {
      grid: { hoverable: true, clickable: true },
      legend: { position: "ne" },
    });
  } catch(e) { console.warn(e); }
}

function plotGraphEmpty(modelNum) {
  try { $.plot($id(`graf-${modelNum}`), []); } catch(e) {}
}

function plotCompare() {
  const datasets = [];

  if (ySeries.length > 0) {
    datasets.push({
      label: "Эмпирика",
      data: ySeries.map((v,i) => [i,v]),
      color: "#333",
      lines: { show: false },
      points: { show: true, radius: 3.5, fillColor: "#333" },
    });
  }

  MODELS.forEach(m => {
    const st = state[m];
    if (st.xValues && st.xValues.length > 0) {
      datasets.push({
        label: `М${m} теор.`,
        data: st.xValues.map((v,i) => [i,v]),
        color: MODEL_COLORS[m].theory,
        lines: { show: true, lineWidth: 2 },
        points: { show: false },
      });
    }
    if (st.lsmValues && st.lsmValues.length > 0) {
      datasets.push({
        label: `М${m} МНК`,
        data: st.lsmValues.map((v,i) => [i,v]),
        color: MODEL_COLORS[m].lsm,
        lines: { show: true, lineWidth: 2, dashArray: [5,3] },
        points: { show: false },
      });
    }
  });

  try {
    $.plot($id("graf-compare"), datasets, {
      grid: { hoverable: true, clickable: true },
      legend: { position: "ne", noColumns: 2 },
    });
  } catch(e) { console.warn(e); }
}

// ==================== ОБРАБОТЧИКИ ====================
function onFormulaChange(modelNum) {
  const st = state[modelNum];
  const input = getFormulaInput(modelNum);
  if (!input) return;

  let userInput = input.value;
  if (userInput.includes("=")) userInput = userInput.substring(userInput.indexOf("=")+1).trim();

  let rawValue = convertToRawFormula(userInput);
  let displayValue = convertToDisplayFormula(rawValue);
  let fullDisplay = "xₜ = " + displayValue;

  if (input.value !== fullDisplay && rawValue !== "") input.value = fullDisplay;
  st.formulaRaw = rawValue;

  const newIndices = extractIndicesFromRaw(rawValue);
  const oldTheory = { ...st.theoryCoeffs };
  st.coeffIndices = newIndices;

  for (let idx of newIndices) {
    const key = `a${idx}`;
    st.theoryCoeffs[key] = oldTheory[key] !== undefined ? oldTheory[key] : 0;
  }
  const valid = new Set(newIndices.map(i => `a${i}`));
  for (let k in st.theoryCoeffs) if (!valid.has(k)) delete st.theoryCoeffs[k];

  st.estimatedCoeffs = {};
  st.lsmValues = [];

  renderCoeffPanel(modelNum);
  recalculateAndPlot(modelNum);
  onGenerateDirect(modelNum);

  const x0Group = getX0Group(modelNum);
  const hasLag = /x\[t-\d+\]/.test(st.formulaRaw);
  if (hasLag) x0Group.classList.remove("hidden");
  else {
    x0Group.classList.add("hidden");
    st.x0 = 0;
    const x0i = getX0Input(modelNum);
    if (x0i) x0i.value = 0;
  }

  plotCompare();
  updateMetrics();
}

function onGenerateDirect(modelNum) {
  const st = state[modelNum];
  const nIn = getNInput(modelNum);
  if (nIn) st.N = parseInt(nIn.value) || 20;
  syncTheoryFromDom(modelNum);
  const generated = calculateModel(modelNum, st.theoryCoeffs, st.N);
  st.xValues = generated;
  const out = getGeneratedOutput(modelNum);
  if (out) out.textContent = generated.map(v => v.toFixed(4)).join(", ");
  plotGraph(modelNum);
}

// ==================== НАСТРОЙКА ТУМБЛЕРОВ ====================
function initToggles() {
  function bindToggle(toggleId, contentId) {
    const t = $id(toggleId);
    const c = $id(contentId);
    if (t && c) {
      t.addEventListener("change", function () {
        c.classList.toggle("hidden", !this.checked);
      });
    }
  }

  // Общие данные
  bindToggle("toggle-data", "data-content");

  // Расчётные данные моделей
  MODELS.forEach(m => {
    bindToggle(`toggle-direct-${m}`, `direct-content-${m}`);
  });

  // Новые блоки
  bindToggle("toggle-model-2", "model-content-2");
  bindToggle("toggle-compare", "compare-content");
  bindToggle("toggle-metrics", "metrics-content");
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
window.addEventListener("DOMContentLoaded", () => {
  initToggles();

  MODELS.forEach(m => {
    const fIn = getFormulaInput(m);
    const nIn = getNInput(m);
    const wtIn = getWtInput(m);
    const x0In = getX0Input(m);

    if (fIn) fIn.addEventListener("input", () => onFormulaChange(m));
    if (nIn) nIn.addEventListener("input", function () {
      state[m].N = parseInt(this.value) || 20;
      recalculateAndPlot(m);
      onGenerateDirect(m);
      plotCompare();
      updateMetrics();
    });
    if (wtIn) wtIn.addEventListener("input", function () {
      state[m].wt = parseFloat(this.value) || 0;
      recalculateAndPlot(m);
      onGenerateDirect(m);
      plotCompare();
      updateMetrics();
    });
    if (x0In) x0In.addEventListener("input", function () {
      state[m].x0 = parseFloat(this.value) || 0;
      recalculateAndPlot(m);
      onGenerateDirect(m);
      plotCompare();
      updateMetrics();
    });

    const tbody = getCoeffTbody(m);
    if (tbody) tbody.addEventListener("input", () => {
      onGenerateDirect(m); plotCompare(); updateMetrics();
    });

    document.querySelectorAll(`.transfer-btn[data-model="${m}"]`)
      .forEach(b => b.addEventListener("click", () => transferEstimatedToTheory(m)));
    document.querySelectorAll(`.reset-btn[data-model="${m}"]`)
      .forEach(b => b.addEventListener("click", () => resetTheoryCoeffs(m)));
    document.querySelectorAll(`.copy_button[data-copy="${m}"]`)
      .forEach(b => b.addEventListener("click", () => {
        const out = getGeneratedOutput(m);
        if (out) navigator.clipboard.writeText(out.textContent || "");
      }));

    plotGraphEmpty(m);
  });

  const yDataInput = $id("y-data");
  if (yDataInput) {
    yDataInput.addEventListener("input", function () {
      ySeries = this.value.split(/[\s,;]+/).map(Number).filter(v => !isNaN(v));
      estimateCoefficientsFromData();
      plotCompare();
      updateMetrics();
    });
  }

  document.addEventListener("wheel", () => {
    if (document.activeElement && document.activeElement.type === "number")
      document.activeElement.blur();
  });

  plotCompare();
});