// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==================
let formulaRaw = ["", ""]; // [М1, М2]
let coeffIndices = [[], []]; // индексы коэффициентов
let theoryCoeffs = [{}, {}]; // теоретические значения
let estimatedCoeffs = [{}, {}]; // расчётные (МНК)
let xValues = [[], []]; // ряды по теоретическим коэффициентам
let lsmValues = [[], []]; // ряды по МНК-коэффициентам
let originalData = []; // исходные данные (общие)
let N = 20;
let x0Value = 0;

// ==================== ГЕНЕРАЦИЯ ШУМА ========================
function getNormalRandom() {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ==================== DOM ЭЛЕМЕНТЫ ==========================
const formulaInputs = [
  document.getElementById("formula1"),
  document.getElementById("formula2"),
];
const nInput = document.getElementById("N");
const wtCoeffInput = document.getElementById("Wt");
const x0Group = document.getElementById("x0-group");
const x0Input = document.getElementById("x0-input");
const yDataInput = document.getElementById("y-data");
const generatedOutputs = [
  document.getElementById("generated-data-output-1"),
  document.getElementById("generated-data-output-2"),
];
const copyBtns = [
  document.getElementById("copy_1"),
  document.getElementById("copy_2"),
];

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
  result = result.replace(/a(\d+)/g, (m, n) => `a${toSubscriptNumber(n)}`);
  result = result.replace(
    /x\[t-(\d+)\]/g,
    (m, o) => `xₜ₋${toSubscriptNumber(o)}`,
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
  let result = displayFormula;
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

  result = result.replace(
    /xₜ₋([₀₁₂₃₄₅₆₇₈₉]+)/g,
    (m, s) => `x[t-${decodeSub(s)}]`,
  );
  result = result.replace(/xₜ/g, "x[t]");
  result = result.replace(/wₜ/g, "wt");
  result = result.replace(/a([₀₁₂₃₄₅₆₇₈₉]+)/g, (m, s) => `a${decodeSub(s)}`);
  result = result.replace(/π/g, "pi");
  result = result.replace(
    /(\w+|\([^)]+\))([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ]+)/g,
    (m, base, sup) => `${base}^${decodeSup(sup)}`,
  );
  return result;
}

function extractIndicesFromRaw(rawFormula) {
  const re = /a(\d+)/g;
  let m,
    set = new Set();
  while ((m = re.exec(rawFormula)) !== null) set.add(parseInt(m[1]));
  return Array.from(set).sort((a, b) => a - b);
}

// ==================== ИНТЕРФЕЙС КОЭФФИЦИЕНТОВ ================
function renderCoeffPanel(modelIdx) {
  const container = document.getElementById(
    `coeffs-table-body-${modelIdx + 1}`,
  );
  if (!container) return;

  if (!coeffIndices[modelIdx] || coeffIndices[modelIdx].length === 0) {
    container.innerHTML =
      '<tr><td colspan="4" style="text-align:center; color:#aaa;">— нет коэффициентов —</td></tr>';
    return;
  }

  container.innerHTML = "";
  for (let idx of coeffIndices[modelIdx]) {
    const key = `a${idx}`;
    let theoryVal = theoryCoeffs[modelIdx][key] ?? 0;
    let estimatedVal =
      estimatedCoeffs[modelIdx][key] !== undefined
        ? estimatedCoeffs[modelIdx][key].toFixed(4)
        : "—";

    const tr = document.createElement("tr");

    // 1 — название
    const tdName = document.createElement("td");
    tdName.innerHTML = `a${toSubscriptNumber(idx.toString())}`;
    tr.appendChild(tdName);

    // 2 — теоретическое (input)
    const tdTheory = document.createElement("td");
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.01";
    input.value = theoryVal;
    input.setAttribute("data-coeff", key);
    input.max = "100000";
    input.addEventListener("input", function () {
      theoryCoeffs[modelIdx][key] = parseFloat(this.value) || 0;
      recalculateAll();
    });
    tdTheory.appendChild(input);
    tr.appendChild(tdTheory);

    // 3 — расчётное
    const tdEstimated = document.createElement("td");
    tdEstimated.textContent = estimatedVal;
    tr.appendChild(tdEstimated);

    // 4 — отклонение
    const tdDeviation = document.createElement("td");
    if (
      estimatedCoeffs[modelIdx][key] !== undefined &&
      theoryCoeffs[modelIdx][key] !== undefined
    ) {
      let deviation =
        theoryCoeffs[modelIdx][key] - estimatedCoeffs[modelIdx][key];
      if (Math.abs(deviation) < 0.0001) deviation = 0;
      tdDeviation.textContent = deviation.toFixed(4);
    } else {
      tdDeviation.textContent = "—";
    }
    tr.appendChild(tdDeviation);

    container.appendChild(tr);
  }
}

// ==================== ВЫЧИСЛЕНИЯ ============================
function calculateModel(coeffs, length, modelIdx) {
  const rawFormula = formulaRaw[modelIdx];
  if (!rawFormula || coeffIndices[modelIdx].length === 0) return [];

  let baseExpr = rawFormula
    .replace(/pi/g, "Math.PI")
    .replace(/sin\(/g, "Math.sin(")
    .replace(/cos\(/g, "Math.cos(")
    .replace(/tan\(/g, "Math.tan(")
    .replace(/exp\(/g, "Math.exp(")
    .replace(/ln\(/g, "Math.log(")
    .replace(/sqrt\(/g, "Math.sqrt(")
    .replace(/\^/g, "**");

  let result = [];
  const wtMult = wtCoeffInput ? parseFloat(wtCoeffInput.value) || 1 : 1;

  for (let t = 0; t < length; t++) {
    let expr = baseExpr;

    expr = expr.replace(/x\[t-(\d+)\]/g, (m, lag) => {
      const idx = t - parseInt(lag);
      if (idx >= 0 && idx < result.length) return result[idx];
      return x0Value;
    });

    expr = expr.replace(/\bt\b/g, t);

    for (let [key, val] of Object.entries(coeffs)) {
      expr = expr.replace(new RegExp(`\\b${key}\\b`, "g"), val);
    }

    let wt = (getNormalRandom() * wtMult).toString();
    expr = expr.replace(/\bwt\b/g, wt);

    try {
      let val = eval(expr);
      result[t] = isNaN(val) || !isFinite(val) ? 0 : val;
    } catch (e) {
      result[t] = 0;
    }
  }
  return result;
}

function recalculateAll() {
  for (let m = 0; m < 2; m++) {
    if (coeffIndices[m].length === 0) continue;

    let hasValidCoeffs =
      Object.keys(theoryCoeffs[m]).length > 0 &&
      Object.values(theoryCoeffs[m]).some((v) => v !== 0);

    if (hasValidCoeffs) {
      xValues[m] = calculateModel(theoryCoeffs[m], N, m);
    } else {
      let tempCoeffs = {};
      for (let idx of coeffIndices[m]) tempCoeffs[`a${idx}`] = 0;
      xValues[m] = calculateModel(tempCoeffs, N, m);
    }

    if (Object.keys(estimatedCoeffs[m]).length > 0) {
      lsmValues[m] = calculateModel(estimatedCoeffs[m], N, m);
    } else {
      lsmValues[m] = [];
    }

    if (generatedOutputs[m]) {
      generatedOutputs[m].textContent =
        xValues[m].map((v) => v.toFixed(4)).join(", ") || "";
    }
  }

  plotGraphModel(0, "#graf-1");
  plotGraphModel(1, "#graf-2");
  plotGraph();
  updateMetricsDisplay();
}

// ==================== МАТЕМАТИЧЕСКИЙ АППАРАТ (МНК) ============
function solveLinear(A, b) {
  let n = b.length;
  let M = A.map((row) => [...row]);
  let v = [...b];
  for (let i = 0; i < n; i++) {
    let max = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(M[j][i]) > Math.abs(M[max][i])) max = j;
    [M[i], M[max]] = [M[max], M[i]];
    [v[i], v[max]] = [v[max], v[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let j = i + 1; j < n; j++) {
      let factor = M[j][i] / M[i][i];
      v[j] -= factor * v[i];
      for (let k = i; k < n; k++) M[j][k] -= factor * M[i][k];
    }
  }
  let res = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < n; j++) sum += M[i][j] * res[j];
    res[i] = (v[i] - sum) / M[i][i];
  }
  return res;
}

function estimateCoefficientsFromData() {
  let rawData = yDataInput.value;

  if (!rawData.trim()) {
    for (let m = 0; m < 2; m++) {
      estimatedCoeffs[m] = {};
      renderCoeffPanel(m);
    }
    originalData = [];
    recalculateAll();
    return;
  }

  let ySeries = rawData
    .split(/[\s,;]+/)
    .map(Number)
    .filter((v) => !isNaN(v));

  if (ySeries.length < 3) {
    for (let m = 0; m < 2; m++) {
      estimatedCoeffs[m] = {};
      renderCoeffPanel(m);
    }
    originalData = [];
    recalculateAll();
    return;
  }

  originalData = [...ySeries];

  for (let m = 0; m < 2; m++) {
    if (!formulaRaw[m] || coeffIndices[m].length === 0) continue;

    const k = coeffIndices[m].length;
    const n = ySeries.length;
    let Z = [];

    for (let t = 0; t < n; t++) {
      let row = [];
      for (let idx of coeffIndices[m]) {
        let expr = formulaRaw[m];
        for (let other of coeffIndices[m]) {
          expr = expr.replace(
            new RegExp(`\\ba${other}\\b`, "g"),
            other === idx ? 1 : 0,
          );
        }
        expr = expr
          .replace(/pi/g, "Math.PI")
          .replace(/sin\(/g, "Math.sin(")
          .replace(/cos\(/g, "Math.cos(")
          .replace(/tan\(/g, "Math.tan(")
          .replace(/exp\(/g, "Math.exp(")
          .replace(/ln\(/g, "Math.log(")
          .replace(/sqrt\(/g, "Math.sqrt(")
          .replace(/\^/g, "**");

        expr = expr.replace(/x\[t-(\d+)\]/g, (mt, lag) => {
          const iPast = t - parseInt(lag);
          if (iPast >= 0 && iPast < ySeries.length) return ySeries[iPast];
          return 0;
        });
        expr = expr.replace(/\bwt\b/g, "0").replace(/\bt\b/g, t);
        let val = eval(expr);
        row.push(val);
      }
      Z.push(row);
    }

    let ZTZ = Array(k)
      .fill()
      .map(() => Array(k).fill(0));
    let ZTy = Array(k).fill(0);
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        for (let mm = 0; mm < n; mm++) ZTZ[i][j] += Z[mm][i] * Z[mm][j];
      }
      for (let mm = 0; mm < n; mm++) ZTy[i] += Z[mm][i] * ySeries[mm];
    }

    const solution = solveLinear(ZTZ, ZTy);
    if (!solution) continue;

    estimatedCoeffs[m] = {};
    for (let pos = 0; pos < coeffIndices[m].length; pos++) {
      estimatedCoeffs[m][`a${coeffIndices[m][pos]}`] = solution[pos];
    }
    renderCoeffPanel(m);
  }
  recalculateAll();
}

// ==================== ГРАФИК ОДНОЙ МОДЕЛИ ===================
function plotGraphModel(modelIdx, selector) {
  const datasets = [];

  let displayLength =
    originalData.length > 0 ? Math.min(N, originalData.length) : N;

  // Теоретическая модель — фиолетовая
  if (xValues[modelIdx].length > 0) {
    datasets.push({
      label: "Теоретическая",
      data: xValues[modelIdx].slice(0, displayLength).map((v, i) => [i, v]),
      color: "#806edc",
      lines: { show: true, lineWidth: 2 },
      points: { show: true, radius: 2.5 },
    });
  }

  // Расчётная модель (МНК) — оранжевая
  if (lsmValues[modelIdx].length > 0) {
    datasets.push({
      label: "Расчётная (МНК)",
      data: lsmValues[modelIdx].slice(0, displayLength).map((v, i) => [i, v]),
      color: "#ff9800",
      lines: { show: true, lineWidth: 2 },
      points: { show: true, radius: 2.5 },
    });
  }

  try {
    $.plot($(selector), datasets, {
      grid: { hoverable: true, clickable: true },
      legend: { position: "ne" },
    });
  } catch (e) {
    console.warn(e);
  }
}

// ==================== ОБЩИЙ ГРАФИК =========================
function plotGraph() {
  const datasets = [];

  let displayLength =
    originalData.length > 0 ? Math.min(N, originalData.length) : N;

  // Исходные данные — зелёные
  if (originalData.length > 0) {
    datasets.push({
      label: "Исходные данные",
      data: originalData.slice(0, displayLength).map((v, i) => [i, v]),
      color: "#4da74d",
      lines: { show: true, lineWidth: 2 },
      points: { show: true, radius: 3 },
    });
  }

  // Модель 1 — приоритет МНК
  let data1 = lsmValues[0].length > 0 ? lsmValues[0] : xValues[0];
  if (data1.length > 0) {
    datasets.push({
      label: lsmValues[0].length > 0 ? "Модель 1 (МНК)" : "Модель 1 (теор.)",
      data: data1.slice(0, displayLength).map((v, i) => [i, v]),
      color: "#806edc",
      lines: { show: true, lineWidth: 2 },
      points: { show: true, radius: 2.5 },
    });
  }

  // Модель 2 — приоритет МНК
  let data2 = lsmValues[1].length > 0 ? lsmValues[1] : xValues[1];
  if (data2.length > 0) {
    datasets.push({
      label: lsmValues[1].length > 0 ? "Модель 2 (МНК)" : "Модель 2 (теор.)",
      data: data2.slice(0, displayLength).map((v, i) => [i, v]),
      color: "#ff9800",
      lines: { show: true, lineWidth: 2 },
      points: { show: true, radius: 2.5 },
    });
  }

  if (datasets.length === 0) {
    $.plot($("#graf"), []);
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

// ==================== МЕТРИКИ ===============================
function calculateResiduals(modelIdx) {
  if (!originalData || originalData.length === 0) return null;
  if (!xValues[modelIdx] || xValues[modelIdx].length === 0) return null;

  let n = Math.min(originalData.length, xValues[modelIdx].length);
  let sumAbs = 0,
    sumSq = 0;

  for (let i = 0; i < n; i++) {
    let e = originalData[i] - xValues[modelIdx][i];
    sumAbs += Math.abs(e);
    sumSq += e * e;
  }

  return {
    mae: sumAbs / n,
    rmse: Math.sqrt(sumSq / n),
  };
}

function updateMetricsDisplay() {
  for (let m = 0; m < 2; m++) {
    const maeEl = document.getElementById(`mae-output-${m + 1}`);
    const rmseEl = document.getElementById(`rmse-output-${m + 1}`);
    if (!maeEl || !rmseEl) continue;

    const result = calculateResiduals(m);
    if (!result) {
      maeEl.textContent = "—";
      rmseEl.textContent = "—";
      continue;
    }

    maeEl.textContent = result.mae.toFixed(4);
    rmseEl.textContent = result.rmse.toFixed(4);
  }
}

// ==================== ОБРАБОТЧИК ФОРМУЛ =====================
function onFormulaChange(modelIdx) {
  let userInput = formulaInputs[modelIdx].value;
  if (userInput.includes("=")) {
    userInput = userInput.substring(userInput.indexOf("=") + 1).trim();
  }

  let rawValue = convertToRawFormula(userInput);
  let displayValue = convertToDisplayFormula(rawValue);
  let fullDisplayValue = "xₜ = " + displayValue;

  if (formulaInputs[modelIdx].value !== fullDisplayValue && rawValue !== "") {
    formulaInputs[modelIdx].value = fullDisplayValue;
  }
  formulaRaw[modelIdx] = rawValue;

  let newIndices = extractIndicesFromRaw(rawValue);
  let oldTheory = { ...theoryCoeffs[modelIdx] };
  coeffIndices[modelIdx] = newIndices;

  for (let idx of coeffIndices[modelIdx]) {
    const key = `a${idx}`;
    theoryCoeffs[modelIdx][key] =
      oldTheory[key] !== undefined ? oldTheory[key] : 0;
  }

  let validKeys = new Set(coeffIndices[modelIdx].map((i) => `a${i}`));
  for (let key in theoryCoeffs[modelIdx]) {
    if (!validKeys.has(key)) delete theoryCoeffs[modelIdx][key];
  }

  estimatedCoeffs[modelIdx] = {};
  lsmValues[modelIdx] = [];

  if (formulaRaw.every((f) => !f || f.trim() === "")) {
    originalData = [];
    if (yDataInput) yDataInput.value = "";
  }

  renderCoeffPanel(modelIdx);
  recalculateAll();

  if (x0Group) {
    const hasLag = formulaRaw.some((f) => /x\[t-\d+\]/.test(f));
    if (hasLag) {
      x0Group.classList.remove("hidden");
    } else {
      x0Group.classList.add("hidden");
      x0Value = 0;
      if (x0Input) x0Input.value = 0;
    }
  }
}

// ==================== НАСТРОЙКА ТУМБЛЕРОВ ===================
function initToggles() {
  const toggles = [
    { toggle: "toggle-model1", content: "model1-content" },
    { toggle: "toggle-model2", content: "model2-content" },
    { toggle: "toggle-compare", content: "compare-content" },
    { toggle: "toggle-metrics", content: "metrics-content" },
    { toggle: "toggle-data1", content: "data1-content" },
    { toggle: "toggle-data2", content: "data2-content" },
    { toggle: "toggle-y-data", content: "y-data-content" },
  ];

  toggles.forEach((item) => {
    const toggleEl = document.getElementById(item.toggle);
    const contentEl = document.getElementById(item.content);
    if (!toggleEl || !contentEl) return;

    toggleEl.addEventListener("change", function () {
      if (this.checked) {
        contentEl.classList.remove("hidden");
      } else {
        contentEl.classList.add("hidden");
      }
    });
  });
}

// ==================== ОБРАБОТЧИКИ СОБЫТИЙ ===================
formulaInputs[0].addEventListener("input", () => onFormulaChange(0));
formulaInputs[1].addEventListener("input", () => onFormulaChange(1));

if (nInput) {
  nInput.addEventListener("input", function () {
    N = parseInt(this.value) || 20;
    recalculateAll();
  });
}

if (wtCoeffInput) {
  wtCoeffInput.addEventListener("input", recalculateAll);
}

if (x0Input) {
  x0Input.addEventListener("input", function () {
    x0Value = parseFloat(this.value) || 0;
    recalculateAll();
  });
}

if (yDataInput) {
  yDataInput.addEventListener("input", estimateCoefficientsFromData);
}

copyBtns.forEach((btn, idx) => {
  if (btn) {
    btn.addEventListener("click", function () {
      const text = generatedOutputs[idx].textContent || "";
      navigator.clipboard.writeText(text);
    });
  }
});

document.addEventListener("wheel", function (event) {
  if (document.activeElement && document.activeElement.type === "number") {
    document.activeElement.blur();
  }
});

// ==================== ИНИЦИАЛИЗАЦИЯ =========================
window.addEventListener("DOMContentLoaded", () => {
  initToggles();
  formulaInputs[0].value = "";
  formulaInputs[1].value = "";
  onFormulaChange(0);
  onFormulaChange(1);
  $.plot($("#graf-1"), []);
  $.plot($("#graf-2"), []);
  $.plot($("#graf"), []);
});
