// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==================
const COMPONENTS = ["x", "y", "z"];

let N = 20;
let x0Value = 0;
let point = false;

const formulas = { x: "", y: "", z: "" };
const coeffIndices = { x: [], y: [], z: [] };
const theoryCoeffs = { x: {}, y: {}, z: {} };
const estimatedCoeffs = { x: {}, y: {}, z: {} };
const seriesTheory = { x: [], y: [], z: [] };
const seriesLsm = { x: [], y: [], z: [] };

const formulaInputs = {
  x: document.getElementById("formula-x"),
  y: document.getElementById("formula-y"),
  z: document.getElementById("formula-z"),
};

const nInput = document.getElementById("N");
const wtInput = document.getElementById("Wt");
const x0Input = document.getElementById("X0");
const yDataInput = document.getElementById("y-data");
const copyBtn = document.getElementById("copy_1");

const genOut = {
  x: document.getElementById("gen-x"),
  y: document.getElementById("gen-y"),
  z: document.getElementById("gen-z"),
};

const toggleData = document.getElementById("toggle-data");
const toggleDirect = document.getElementById("toggle-direct");
const dataContent = document.getElementById("data-content");
const directContent = document.getElementById("direct-content");

const tableBodies = {};
for (const comp of COMPONENTS) {
  const table = document.getElementById(`${comp}-table`);
  tableBodies[comp] = table ? table.querySelector("tbody") : null;
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==================
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
    /\b([abc])(\d+)/g,
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
    /\b([abc])([₀₁₂₃₄₅₆₇₈₉]+)/g,
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

// ==================== ИНТЕРФЕЙС КОЭФФИЦИЕНТОВ ================
function renderCoeffPanel() {
  for (const comp of COMPONENTS) {
    const body = tableBodies[comp];
    if (!body) continue;

    const prefix = comp === "x" ? "a" : comp === "y" ? "b" : "c";
    const indices = coeffIndices[comp];

    if (indices.length === 0) {
      body.innerHTML =
        '<tr><td colspan="3" style="text-align:center;color:#aaa;">— нет коэффициентов —</td></tr>';
      continue;
    }

    body.innerHTML = "";
    for (const idx of indices) {
      const key = `${prefix}${idx}`;
      const theoryVal = theoryCoeffs[comp][key] ?? 0;
      const estVal =
        estimatedCoeffs[comp][key] !== undefined
          ? estimatedCoeffs[comp][key].toFixed(4)
          : "—";

      const tr = document.createElement("tr");

      const tdName = document.createElement("td");
      tdName.innerHTML = `${prefix}${toSubscriptNumber(idx.toString())}`;
      tr.appendChild(tdName);

      const tdTheory = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.01";
      input.value = theoryVal;
      input.max = "100000";
      input.dataset.comp = comp;
      input.dataset.key = key;
      input.addEventListener("input", function () {
        if (parseFloat(this.value) > 100000) this.value = 100000;
        theoryCoeffs[comp][key] = parseFloat(this.value) || 0;
        recalculateAndPlot();
      });
      tdTheory.appendChild(input);
      tr.appendChild(tdTheory);

      const tdEst = document.createElement("td");
      tdEst.textContent = estVal;
      tr.appendChild(tdEst);

      body.appendChild(tr);
    }
  }
}

function syncTheoryFromDom() {
  for (const comp of COMPONENTS) {
    const body = tableBodies[comp];
    if (!body) continue;
    body.querySelectorAll("input[data-key]").forEach((inp) => {
      theoryCoeffs[comp][inp.dataset.key] = parseFloat(inp.value) || 0;
    });
  }
}

// ==================== ВЫЧИСЛЕНИЯ И МОДЕЛИРОВАНИЕ ============
function calculateComponent(comp, coeffs, length, context) {
  const raw = formulas[comp];
  if (!raw) return [];
  const baseExpr = formulaToJS(raw);
  const wtMul = wtInput ? parseFloat(wtInput.value) || 1 : 1;
  const result = [];

  for (let t = 0; t < length; t++) {
    let expr = baseExpr;

    for (const other of COMPONENTS) {
      expr = expr.replace(
        new RegExp(`\\b${other}\\[t-(\\d+)\\]`, "g"),
        (m, lag) => {
          const idx = t - parseInt(lag);
          const arr = context[other] || [];
          if (idx >= 0 && idx < arr.length) return arr[idx];
          return other === "x" ? x0Value : 0;
        },
      );
      expr = expr.replace(new RegExp(`\\b${other}\\[t\\]`, "g"), () => {
        const arr = context[other] || [];
        return t < arr.length ? arr[t] : 0;
      });
    }

    expr = expr.replace(/\bt\b/g, t);

    for (const [key, val] of Object.entries(coeffs)) {
      expr = expr.replace(new RegExp(`\\b${key}\\b`, "g"), val);
    }

    const wt = getNormalRandom() * wtMul;
    expr = expr.replace(/\bwt\b/g, wt);

    try {
      const v = eval(expr);
      result[t] = isNaN(v) || !isFinite(v) ? 0 : v;
    } catch {
      result[t] = 0;
    }
  }
  return result;
}

function recalculateAndPlot() {
  const hasAny = COMPONENTS.some((c) => coeffIndices[c].length > 0);
  if (!hasAny) {
    plotGraphEmpty();
    updateMetricsDisplay();
    return;
  }

  seriesTheory.x = calculateComponent("x", theoryCoeffs.x, N, seriesTheory);
  seriesTheory.y = calculateComponent("y", theoryCoeffs.y, N, seriesTheory);
  seriesTheory.z = calculateComponent("z", theoryCoeffs.z, N, seriesTheory);

  const hasEst = COMPONENTS.some(
    (c) => Object.keys(estimatedCoeffs[c]).length > 0,
  );
  if (hasEst) {
    seriesLsm.x = calculateComponent("x", estimatedCoeffs.x, N, seriesLsm);
    seriesLsm.y = calculateComponent("y", estimatedCoeffs.y, N, seriesLsm);
    seriesLsm.z = calculateComponent("z", estimatedCoeffs.z, N, seriesLsm);
  } else {
    seriesLsm.x = [];
    seriesLsm.y = [];
    seriesLsm.z = [];
  }

  plotGraph();
  updateMetricsDisplay();
}

// ==================== МНК ===================================
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
  const out = { x: [], y: [], z: [] };
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^([xyz])\s*[:=]\s*(.+)$/i);
    if (!m) continue;
    const comp = m[1].toLowerCase();
    out[comp] = m[2]
      .split(/[\s,;]+/)
      .map(Number)
      .filter((v) => !isNaN(v));
  }
  return out;
}

function estimateOneComponent(comp, data) {
  const raw = formulas[comp];
  const indices = coeffIndices[comp];
  if (!raw || indices.length === 0) return;

  const ySeries = data[comp];
  if (!ySeries || ySeries.length < 3) {
    estimatedCoeffs[comp] = {};
    return;
  }

  const prefix = comp === "x" ? "a" : comp === "y" ? "b" : "c";
  const k = indices.length;
  const n = ySeries.length;
  const Z = [];

  for (let t = 0; t < n; t++) {
    const row = [];
    for (const idx of indices) {
      let expr = raw;
      for (const other of indices) {
        expr = expr.replace(
          new RegExp(`\\b${prefix}${other}\\b`, "g"),
          other === idx ? 1 : 0,
        );
      }
      for (const oc of COMPONENTS) {
        expr = expr.replace(
          new RegExp(`\\b${oc}\\[t-(\\d+)\\]`, "g"),
          (m, lag) => {
            const pi = t - parseInt(lag);
            const arr = data[oc] || [];
            return pi >= 0 && pi < arr.length ? arr[pi] : 0;
          },
        );
        expr = expr.replace(new RegExp(`\\b${oc}\\[t\\]`, "g"), () => {
          const arr = data[oc] || [];
          return t < arr.length ? arr[t] : 0;
        });
      }
      expr = expr.replace(/\bwt\b/g, "0").replace(/\bt\b/g, t);
      expr = formulaToJS(expr);
      try {
        row.push(eval(expr));
      } catch {
        row.push(0);
      }
    }
    Z.push(row);
  }

  const ZTZ = Array(k)
    .fill()
    .map(() => Array(k).fill(0));
  const ZTy = Array(k).fill(0);

  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++)
      for (let m = 0; m < n; m++) ZTZ[i][j] += Z[m][i] * Z[m][j];
    for (let m = 0; m < n; m++) ZTy[i] += Z[m][i] * ySeries[m];
  }

  const sol = solveLinear(ZTZ, ZTy);
  if (!sol) return;

  estimatedCoeffs[comp] = {};
  for (let i = 0; i < indices.length; i++)
    estimatedCoeffs[comp][`${prefix}${indices[i]}`] = sol[i];
}

function estimateCoefficientsFromData() {
  const data = parseDataBlock(yDataInput.value);
  for (const comp of COMPONENTS) {
    estimatedCoeffs[comp] = {};
    estimateOneComponent(comp, data);
  }
  renderCoeffPanel();
  recalculateAndPlot();
}

// ==================== ОТРИСОВКА ГРАФИКОВ ====================
function plotGraph() {
  const datasets = [];
  const colors = {
    x: { theory: "#806edc", lsm: "#ff9800" },
    y: { theory: "#4da74d", lsm: "#cb4b4b" },
    z: { theory: "#2196f3", lsm: "#e91e63" },
  };

  for (const comp of COMPONENTS) {
    if (seriesTheory[comp] && seriesTheory[comp].length) {
      datasets.push({
        label: `Теор. ${comp}[t]`,
        data: seriesTheory[comp].map((v, i) => [i, v]),
        color: colors[comp].theory,
        lines: { show: true, lineWidth: 2 },
        points: { show: point, radius: 2.5 },
      });
    }
    if (seriesLsm[comp] && seriesLsm[comp].length) {
      datasets.push({
        label: `МНК ${comp}[t]`,
        data: seriesLsm[comp].map((v, i) => [i, v]),
        color: colors[comp].lsm,
        lines: { show: true, lineWidth: 2, dashes: [5, 3] },
        points: { show: point, radius: 2.5 },
      });
    }
  }

  if (datasets.length === 0) {
    plotGraphEmpty();
    return;
  }

  try {
    $.plot($("#graf"), datasets, {
      grid: { hoverable: true, clickable: true },
      legend: { position: "ne" },
    });
  } catch (e) {
    console.warn(e);
  }
}

function plotGraphEmpty() {
  $.plot($("#graf"), []);
}

// ==================== ГЕНЕРАЦИЯ ==============================
function onGenerateDirect() {
  N = parseInt(nInput?.value) || 20;
  syncTheoryFromDom();
  seriesTheory.x = calculateComponent("x", theoryCoeffs.x, N, seriesTheory);
  seriesTheory.y = calculateComponent("y", theoryCoeffs.y, N, seriesTheory);
  seriesTheory.z = calculateComponent("z", theoryCoeffs.z, N, seriesTheory);

  for (const comp of COMPONENTS) {
    if (genOut[comp]) {
      genOut[comp].textContent = seriesTheory[comp]
        .map((v) => v.toFixed(4))
        .join(", ");
    }
  }
  plotGraph();
  updateMetricsDisplay();
}

// ==================== СМЕНА ФОРМУЛ ==========================
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

  const prefix = comp === "x" ? "a" : comp === "y" ? "b" : "c";
  const newIdx = extractIndices(raw, prefix);
  const old = { ...theoryCoeffs[comp] };
  coeffIndices[comp] = newIdx;

  theoryCoeffs[comp] = {};
  for (const idx of newIdx) {
    const key = `${prefix}${idx}`;
    theoryCoeffs[comp][key] = old[key] ?? 0;
  }

  estimatedCoeffs[comp] = {};
  renderCoeffPanel();
  recalculateAndPlot();
  onGenerateDirect();
}

// ==================== ТУМБЛЕРЫ ==============================
function initToggles() {
  toggleData?.addEventListener("change", function () {
    dataContent.classList.toggle("hidden", !this.checked);
  });
  toggleDirect?.addEventListener("change", function () {
    directContent.classList.toggle("hidden", !this.checked);
  });
}

// ==================== ОБРАБОТЧИКИ ===========================
COMPONENTS.forEach((comp) => {
  formulaInputs[comp].addEventListener("input", () => onFormulaChange(comp));
});

nInput?.addEventListener("input", function () {
  N = parseInt(this.value) || 20;
  recalculateAndPlot();
  onGenerateDirect();
});

wtInput?.addEventListener("input", () => {
  recalculateAndPlot();
  onGenerateDirect();
});

yDataInput?.addEventListener("input", estimateCoefficientsFromData);

x0Input?.addEventListener("input", function () {
  x0Value = parseFloat(this.value) || 0;
  recalculateAndPlot();
  onGenerateDirect();
});

copyBtn?.addEventListener("click", function () {
  const text = COMPONENTS.map(
    (c) => `${c}: ${seriesTheory[c].map((v) => v.toFixed(4)).join(", ")}`,
  ).join("\n");
  navigator.clipboard.writeText(text);
});

document.addEventListener("wheel", function () {
  if (document.activeElement && document.activeElement.type === "number") {
    document.activeElement.blur();
  }
});

// ==================== МЕТРИКИ ===============================
function updateMetricsDisplay() {
  for (const comp of COMPONENTS) {
    const maeEl = document.getElementById(`mae-${comp}`);
    const rmseEl = document.getElementById(`rmse-${comp}`);
    if (!maeEl || !rmseEl) continue;

    const th = seriesTheory[comp];
    const ls = seriesLsm[comp];
    if (
      !th ||
      !ls ||
      th.length === 0 ||
      ls.length === 0 ||
      th.length !== ls.length
    ) {
      maeEl.textContent = "—";
      rmseEl.textContent = "—";
      continue;
    }

    let sumAbs = 0,
      sumSq = 0;
    for (let i = 0; i < th.length; i++) {
      const e = th[i] - ls[i];
      sumAbs += Math.abs(e);
      sumSq += e * e;
    }
    const n = th.length;
    maeEl.textContent = (sumAbs / n).toFixed(4);
    rmseEl.textContent = Math.sqrt(sumSq / n).toFixed(4);
  }
}

// ==================== ИНИЦИАЛИЗАЦИЯ =========================
window.addEventListener("DOMContentLoaded", () => {
  initToggles();
  COMPONENTS.forEach((c) => (formulaInputs[c].value = ""));
  plotGraphEmpty();
});
