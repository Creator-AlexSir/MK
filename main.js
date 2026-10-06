// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==================
let N = 20;
let point = false;

// Переменные Модели 1
let currentFormulaRaw_1 = "";
let currentCoeffIndices_1 = [];
let theoryCoeffs_1 = {};
let estimatedCoeffs_1 = {};
let xValues_1 = [];
let lsmValues_1 = [];
let x0Value_1 = 0;

// Переменные Модели 2
let currentFormulaRaw_2 = "";
let currentCoeffIndices_2 = [];
let theoryCoeffs_2 = {};
let estimatedCoeffs_2 = {};
let xValues_2 = [];
let lsmValues_2 = [];
let x0Value_2 = 0;

// ==================== ГЕНЕРАЦИЯ ШУМА ========================
function getNormalRandom() {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ==================== DOM ЭЛЕМЕНТЫ ==========================
const nInput = document.getElementById("N");
const yDataInput = document.getElementById("y-data");

// Блок 1
const formulaInput_1 = document.getElementById("formula_1");
const wtCoeffInput_1 = document.getElementById("Wt_1");
const tbody_1 = document.getElementById("coeffs-table-body_1");
const generatedDataOutput_1 = document.getElementById(
  "generated-data-output_1",
);
const x0Group_1 = document.getElementById("x0-group_1");
const x0Input_1 = document.getElementById("x0-input_1");
const copyBtn_1 = document.getElementById("copy_1");

// Блок 2
const formulaInput_2 = document.getElementById("formula_2");
const wtCoeffInput_2 = document.getElementById("Wt_2");
const tbody_2 = document.getElementById("coeffs-table-body_2");
const generatedDataOutput_2 = document.getElementById(
  "generated-data-output_2",
);
const x0Group_2 = document.getElementById("x0-group_2");
const x0Input_2 = document.getElementById("x0-input_2");
const copyBtn_2 = document.getElementById("copy_2");

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==================
function toSubscriptNumber(num) {
  return num
    .toString()
    .split("")
    .map((d) => String.fromCharCode(0x2080 + parseInt(d)))
    .join("");
}

function toSuperscriptNumber(num) {
  const supMap = {
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
    .map((ch) => supMap[ch] || ch)
    .join("");
}

function convertToDisplayFormula(formula) {
  let result = formula;
  result = result.replace(/a(\d+)/g, (m, num) => `a${toSubscriptNumber(num)}`);
  result = result.replace(
    /x\[t-(\d+)\]/g,
    (m, offset) => `xₜ₋${toSubscriptNumber(offset)}`,
  );
  result = result.replace(/x\[t\]/g, "xₜ");
  result = result.replace(/\bwt\b/g, "wₜ");
  result = result.replace(/\bpi\b/gi, "π");
  result = result.replace(
    /(\w+|\([^)]+\))\s*(\^|\*\*)\s*(\d+)/g,
    (m, base, _, exp) => `${base}${toSuperscriptNumber(exp)}`,
  );
  return result;
}

function convertToRawFormula(displayFormula) {
  const decodeSubscript = (subscript) => {
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
    return subscript
      .split("")
      .map((ch) => map[ch] || ch)
      .join("");
  };
  const decodeSuperscript = (sup) => {
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
    return sup
      .split("")
      .map((ch) => map[ch] || ch)
      .join("");
  };

  let result = displayFormula;
  result = result.replace(
    /xₜ₋([₀₁₂₃₄₅₆₇₈₉]+)/g,
    (m, sub) => `x[t-${decodeSubscript(sub)}]`,
  );
  result = result.replace(/xₜ/g, "x[t]");
  result = result.replace(/wₜ/g, "wt");
  result = result.replace(
    /a([₀₁₂₃₄₅₆₇₈₉]+)/g,
    (m, sub) => `a${decodeSubscript(sub)}`,
  );
  result = result.replace(/π/g, "pi");
  result = result.replace(
    /(\w+|\([^)]+\))([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ]+)/g,
    (m, base, sup) => `${base}^${decodeSuperscript(sup)}`,
  );
  return result;
}

function extractIndicesFromRaw(rawFormula) {
  const aRegex = /a(\d+)/g;
  let match,
    indices = new Set();
  while ((match = aRegex.exec(rawFormula)) !== null) {
    indices.add(parseInt(match[1]));
  }
  return Array.from(indices).sort((a, b) => a - b);
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

function getSeriesFromInput() {
  if (!yDataInput || !yDataInput.value.trim()) return null;
  const series = yDataInput.value
    .split(/[\s,;]+/)
    .map(Number)
    .filter((v) => !isNaN(v));
  return series.length >= 3 ? series : null;
}

// ==================== РЕНДЕР ТАБЛИЦЫ КОЭФФИЦИЕНТОВ ============
function renderCoeffPanelForModel(modelNum) {
  const container = modelNum === 1 ? tbody_1 : tbody_2;
  const indices =
    modelNum === 1 ? currentCoeffIndices_1 : currentCoeffIndices_2;
  const theoryMap = modelNum === 1 ? theoryCoeffs_1 : theoryCoeffs_2;
  const estimatedMap = modelNum === 1 ? estimatedCoeffs_1 : estimatedCoeffs_2;

  if (!container) return;

  if (!indices || indices.length === 0) {
    container.innerHTML =
      '<tr><td colspan="4" style="text-align:center; color:#aaa;">— нет коэффициентов —</td></tr>';
    return;
  }

  container.innerHTML = "";
  for (let idx of indices) {
    const key = `a${idx}`;
    const theoryVal = theoryMap[key] !== undefined ? theoryMap[key] : 0;
    const estimatedVal =
      estimatedMap[key] !== undefined ? estimatedMap[key].toFixed(4) : "—";

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
      theoryMap[key] = parseFloat(this.value) || 0;
      recalculateAll();
    });
    tdTheory.appendChild(input);
    tr.appendChild(tdTheory);

    const tdEstimated = document.createElement("td");
    tdEstimated.textContent = estimatedVal;
    tr.appendChild(tdEstimated);

    const tdDeviation = document.createElement("td");
    if (estimatedMap[key] !== undefined && theoryMap[key] !== undefined) {
      let deviation = theoryMap[key] - estimatedMap[key];
      if (Math.abs(deviation) < 0.0001) deviation = 0;
      tdDeviation.textContent = deviation.toFixed(4);
    } else {
      tdDeviation.textContent = "—";
    }
    tr.appendChild(tdDeviation);

    container.appendChild(tr);
  }
}

function syncTheoryFromDomForModel(modelNum) {
  const container = modelNum === 1 ? tbody_1 : tbody_2;
  const theoryMap = modelNum === 1 ? theoryCoeffs_1 : theoryCoeffs_2;

  if (!container) return;
  container.querySelectorAll("input[data-coeff]").forEach((inp) => {
    theoryMap[inp.getAttribute("data-coeff")] = parseFloat(inp.value) || 0;
  });
}

// ==================== РАСЧЕТ МОДЕЛЕЙ =====================
function calculateModelSeries(
  rawFormula,
  indices,
  coeffs,
  wtInput,
  x0Val,
  ySeries,
  stepsCount,
) {
  if (!rawFormula || indices.length === 0) return [];

  const baseExpr = formulaToJS(rawFormula);
  const result = [];
  const wtMultiplier = wtInput ? parseFloat(wtInput.value) || 1 : 1;

  for (let t = 0; t < stepsCount; t++) {
    let evalExpr = baseExpr;

    evalExpr = evalExpr.replace(/x\[t-(\d+)\]/g, (match, lag) => {
      const idx = t - parseInt(lag);
      if (idx >= 0) {
        return ySeries && idx < ySeries.length ? ySeries[idx] : result[idx];
      }
      return x0Val;
    });

    evalExpr = evalExpr.replace(/\bt\b/g, t);

    for (let [key, val] of Object.entries(coeffs)) {
      evalExpr = evalExpr.replace(new RegExp(`\\b${key}\\b`, "g"), val);
    }

    const wt = getNormalRandom() * wtMultiplier;
    evalExpr = evalExpr.replace(/\bwt\b/g, wt);

    try {
      const val = eval(evalExpr);
      result[t] = isNaN(val) || !isFinite(val) ? 0 : val;
    } catch (e) {
      result[t] = 0;
    }
  }
  return result;
}

// ==================== МНК ===================================
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row) => [...row]);
  const v = [...b];

  for (let i = 0; i < n; i++) {
    let max = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(M[j][i]) > Math.abs(M[max][i])) max = j;
    [M[i], M[max]] = [M[max], M[i]];
    [v[i], v[max]] = [v[max], v[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let j = i + 1; j < n; j++) {
      const factor = M[j][i] / M[i][i];
      v[j] -= factor * v[i];
      for (let k = i; k < n; k++) M[j][k] -= factor * M[i][k];
    }
  }

  const res = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < n; j++) sum += M[i][j] * res[j];
    res[i] = (v[i] - sum) / M[i][i];
  }
  return res;
}

function estimateCoefficientsFromDataForModel(modelNum, ySeries) {
  const rawFormula = modelNum === 1 ? currentFormulaRaw_1 : currentFormulaRaw_2;
  const indices =
    modelNum === 1 ? currentCoeffIndices_1 : currentCoeffIndices_2;
  const x0Val = modelNum === 1 ? x0Value_1 : x0Value_2;

  if (!rawFormula || indices.length === 0 || !ySeries) {
    if (modelNum === 1) estimatedCoeffs_1 = {};
    else estimatedCoeffs_2 = {};
    return;
  }

  const k = indices.length;
  const n = ySeries.length;
  const Z = [];

  for (let t = 0; t < n; t++) {
    const row = [];
    for (let idx of indices) {
      let expr = rawFormula;
      for (let other of indices) {
        expr = expr.replace(
          new RegExp(`\\ba${other}\\b`, "g"),
          other === idx ? 1 : 0,
        );
      }
      expr = formulaToJS(expr);

      expr = expr.replace(/x\[t-(\d+)\]/g, (match, lag) => {
        const idxPast = t - parseInt(lag);
        return idxPast >= 0 && idxPast < ySeries.length
          ? ySeries[idxPast]
          : x0Val;
      });
      expr = expr.replace(/\bwt\b/g, "0").replace(/\bt\b/g, t);

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
    for (let j = 0; j < k; j++) {
      for (let m = 0; m < n; m++) ZTZ[i][j] += Z[m][i] * Z[m][j];
    }
    for (let m = 0; m < n; m++) ZTy[i] += Z[m][i] * ySeries[m];
  }

  const solution = solveLinear(ZTZ, ZTy);
  if (!solution) {
    if (modelNum === 1) estimatedCoeffs_1 = {};
    else estimatedCoeffs_2 = {};
    return;
  }

  const targetCoeffs = {};
  for (let i = 0; i < indices.length; i++) {
    targetCoeffs[`a${indices[i]}`] = solution[i];
  }

  if (modelNum === 1) estimatedCoeffs_1 = targetCoeffs;
  else estimatedCoeffs_2 = targetCoeffs;
}

// ==================== ОТРСОВКА ГРАФИКОВ ====================
function plotGraphForModel(modelNum) {
  const datasets = [];
  const grafEl = $(`#graf_${modelNum}`);
  const xVals = modelNum === 1 ? xValues_1 : xValues_2;
  const lsmVals = modelNum === 1 ? lsmValues_1 : lsmValues_2;

  if (xVals && xVals.length > 0) {
    datasets.push({
      label: `Теоретическая (Модель ${modelNum})`,
      data: xVals.map((v, i) => [i, v]),
      color: "#806edc",
      lines: { show: true, lineWidth: 2 },
      points: { show: point, radius: 2.5 },
    });
  }

  if (lsmVals && lsmVals.length > 0) {
    datasets.push({
      label: `Расчетная МНК (Модель ${modelNum})`,
      data: lsmVals.map((v, i) => [i, v]),
      color: "#ff9800",
      lines: { show: true, lineWidth: 2 },
      points: { show: point, radius: 2.5 },
    });
  }

  if (datasets.length === 0) {
    $.plot(grafEl, []);
    return;
  }

  try {
    $.plot(grafEl, datasets, {
      grid: { hoverable: true, clickable: true },
      legend: { position: "ne" },
    });
  } catch (e) {
    console.warn(e);
  }
}

// ==================== ЕДИНЫЙ ПЕРЕСЧЕТ СИСТЕМЫ ====================
function recalculateAll() {
  syncTheoryFromDomForModel(1);
  syncTheoryFromDomForModel(2);

  const ySeries = getSeriesFromInput();

  // --- БЛОК 1 ---
  xValues_1 = calculateModelSeries(
    currentFormulaRaw_1,
    currentCoeffIndices_1,
    theoryCoeffs_1,
    wtCoeffInput_1,
    x0Value_1,
    ySeries,
    N,
  );
  if (ySeries) {
    estimateCoefficientsFromDataForModel(1, ySeries);
    lsmValues_1 =
      Object.keys(estimatedCoeffs_1).length > 0
        ? calculateModelSeries(
            currentFormulaRaw_1,
            currentCoeffIndices_1,
            estimatedCoeffs_1,
            wtCoeffInput_1,
            x0Value_1,
            ySeries,
            N,
          )
        : [];
  } else {
    estimatedCoeffs_1 = {};
    lsmValues_1 = [];
  }

  // --- БЛОК 2 ---
  xValues_2 = calculateModelSeries(
    currentFormulaRaw_2,
    currentCoeffIndices_2,
    theoryCoeffs_2,
    wtCoeffInput_2,
    x0Value_2,
    ySeries,
    N,
  );
  if (ySeries) {
    estimateCoefficientsFromDataForModel(2, ySeries);
    lsmValues_2 =
      Object.keys(estimatedCoeffs_2).length > 0
        ? calculateModelSeries(
            currentFormulaRaw_2,
            currentCoeffIndices_2,
            estimatedCoeffs_2,
            wtCoeffInput_2,
            x0Value_2,
            ySeries,
            N,
          )
        : [];
  } else {
    estimatedCoeffs_2 = {};
    lsmValues_2 = [];
  }

  // Вывод сгенерированных теоретических значений
  if (generatedDataOutput_1) {
    generatedDataOutput_1.textContent =
      xValues_1.length > 0 ? xValues_1.map((v) => v.toFixed(4)).join(", ") : "";
  }
  if (generatedDataOutput_2) {
    generatedDataOutput_2.textContent =
      xValues_2.length > 0 ? xValues_2.map((v) => v.toFixed(4)).join(", ") : "";
  }

  // Рендер таблиц и перерисовка графиков
  renderCoeffPanelForModel(1);
  renderCoeffPanelForModel(2);

  plotGraphForModel(1);
  plotGraphForModel(2);

  updateMetricsDisplay();
}

// ==================== ОБРАБОТКА ИЗМЕНЕНИЯ ФОРМУЛЫ ============
function onFormulaChangeForModel(modelNum) {
  const formulaInput = modelNum === 1 ? formulaInput_1 : formulaInput_2;
  const x0Group = modelNum === 1 ? x0Group_1 : x0Group_2;
  const x0Input = modelNum === 1 ? x0Input_1 : x0Input_2;

  if (!formulaInput) return;
  let userInput = formulaInput.value;
  if (userInput.includes("=")) {
    userInput = userInput.substring(userInput.indexOf("=") + 1).trim();
  }

  const rawValue = convertToRawFormula(userInput);
  const displayValue = convertToDisplayFormula(rawValue);
  const fullDisplayValue = "xₜ = " + displayValue;

  if (formulaInput.value !== fullDisplayValue && rawValue !== "") {
    formulaInput.value = fullDisplayValue;
  }

  const newIndices = extractIndicesFromRaw(rawValue);

  if (modelNum === 1) {
    currentFormulaRaw_1 = rawValue;
    const oldTheoryCoeffs = { ...theoryCoeffs_1 };
    currentCoeffIndices_1 = newIndices;
    theoryCoeffs_1 = {};
    for (let idx of currentCoeffIndices_1) {
      const key = `a${idx}`;
      theoryCoeffs_1[key] =
        oldTheoryCoeffs[key] !== undefined ? oldTheoryCoeffs[key] : 0;
    }
    estimatedCoeffs_1 = {};
    lsmValues_1 = [];
  } else {
    currentFormulaRaw_2 = rawValue;
    const oldTheoryCoeffs = { ...theoryCoeffs_2 };
    currentCoeffIndices_2 = newIndices;
    theoryCoeffs_2 = {};
    for (let idx of currentCoeffIndices_2) {
      const key = `a${idx}`;
      theoryCoeffs_2[key] =
        oldTheoryCoeffs[key] !== undefined ? oldTheoryCoeffs[key] : 0;
    }
    estimatedCoeffs_2 = {};
    lsmValues_2 = [];
  }

  renderCoeffPanelForModel(modelNum);

  if (x0Group) {
    const hasLag = /x\[t-\d+\]/.test(rawValue);
    if (hasLag) {
      x0Group.classList.remove("hidden");
    } else {
      x0Group.classList.add("hidden");
      if (modelNum === 1) x0Value_1 = 0;
      else x0Value_2 = 0;
      if (x0Input) x0Input.value = 0;
    }
  }

  recalculateAll();
}

// ==================== ТУМБЛЕРЫ И ОБРАБОТЧИКИ СОБЫТИЙ ============
function initToggles() {
  document.querySelectorAll(".toggle-switch input").forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      const block = this.closest(".block");
      if (!block) return;
      const children = Array.from(block.children).filter(
        (el) => !el.classList.contains("toggle-header"),
      );
      children.forEach((child) => {
        child.classList.toggle("hidden", !this.checked);
      });
    });
  });
}

if (formulaInput_1)
  formulaInput_1.addEventListener("input", () => onFormulaChangeForModel(1));
if (formulaInput_2)
  formulaInput_2.addEventListener("input", () => onFormulaChangeForModel(2));

if (nInput) {
  nInput.addEventListener("input", function () {
    N = parseInt(this.value) || 20;
    recalculateAll();
  });
}

if (wtCoeffInput_1) wtCoeffInput_1.addEventListener("input", recalculateAll);
if (wtCoeffInput_2) wtCoeffInput_2.addEventListener("input", recalculateAll);

if (tbody_1) tbody_1.addEventListener("input", recalculateAll);
if (tbody_2) tbody_2.addEventListener("input", recalculateAll);

if (yDataInput) yDataInput.addEventListener("input", recalculateAll);

if (x0Input_1) {
  x0Input_1.addEventListener("input", function () {
    x0Value_1 = parseFloat(this.value) || 0;
    recalculateAll();
  });
}

if (x0Input_2) {
  x0Input_2.addEventListener("input", function () {
    x0Value_2 = parseFloat(this.value) || 0;
    recalculateAll();
  });
}

if (copyBtn_1) {
  copyBtn_1.addEventListener("click", function () {
    if (generatedDataOutput_1) {
      navigator.clipboard.writeText(generatedDataOutput_1.textContent || "");
    }
  });
}

if (copyBtn_2) {
  copyBtn_2.addEventListener("click", function () {
    if (generatedDataOutput_2) {
      navigator.clipboard.writeText(generatedDataOutput_2.textContent || "");
    }
  });
}

document.addEventListener("wheel", function () {
  if (document.activeElement && document.activeElement.type === "number") {
    document.activeElement.blur();
  }
});

// ==================== МЕТРИКИ ================================
function calculateResiduals() {
  if (!xValues_1 || xValues_1.length === 0) return null;
  if (!lsmValues_1 || lsmValues_1.length === 0) return null;
  if (xValues_1.length !== lsmValues_1.length) return null;

  const residuals = [];
  let sumAbs = 0;
  let sumSq = 0;

  for (let i = 0; i < xValues_1.length; i++) {
    const e = xValues_1[i] - lsmValues_1[i];
    residuals.push(e);
    sumAbs += Math.abs(e);
    sumSq += e * e;
  }

  const n = residuals.length;
  return {
    residuals,
    mae: sumAbs / n,
    rmse: Math.sqrt(sumSq / n),
  };
}

function updateMetricsDisplay() {
  const maeEl = document.getElementById("mae-output");
  const rmseEl = document.getElementById("rmse-output");
  if (!maeEl || !rmseEl) return;

  const result = calculateResiduals();
  if (!result) {
    maeEl.textContent = "—";
    rmseEl.textContent = "—";
    return;
  }

  maeEl.textContent = result.mae.toFixed(4);
  rmseEl.textContent = result.rmse.toFixed(4);
}

// ==================== ИНИЦИАЛИЗАЦИЯ =========================
window.addEventListener("DOMContentLoaded", () => {
  initToggles();

  if (formulaInput_1) {
    formulaInput_1.value = "";
    onFormulaChangeForModel(1);
  }

  if (formulaInput_2) {
    formulaInput_2.value = "";
    onFormulaChangeForModel(2);
  }
});
