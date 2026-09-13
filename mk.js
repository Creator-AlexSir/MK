// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==================
let currentMode = "mnk";
let currentFormulaRaw = "";
let currentFormulaDisplay = "";
let currentCoeffIndices = [];
let xValues = [];
let originalData = [];
let N = 20;
let x0Value = 0;

let theoryCoeffs = {};
let estimatedCoeffs = {};

// ==================== ГЕНЕРАЦИЯ ШУМА ========================
function getNormalRandom() {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ==================== DOM ЭЛЕМЕНТЫ ==========================
const formulaInput = document.getElementById("formula");
const nInput = document.getElementById("N");
const wtCoeffInput = document.getElementById("Wt");
const generateData = document.getElementById("generate-btn");
const yDataInput = document.getElementById("y-data");
const generatedDataOutput = document.getElementById("generated-data-output");
const x0Group = document.getElementById("x0-group");
const x0Input = document.getElementById("x0-input");

// Тумблеры
const toggleData = document.getElementById("toggle-data");
const toggleDirect = document.getElementById("toggle-direct");
const dataContent = document.getElementById("data-content");
const directContent = document.getElementById("direct-content");

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
  result = result.replace(
    /a(\d+)/g,
    (match, num) => `a${toSubscriptNumber(num)}`,
  );
  result = result.replace(
    /x\[t-(\d+)\]/g,
    (match, offset) => `xₜ₋${toSubscriptNumber(offset)}`,
  );
  result = result.replace(/x\[t\]/g, "xₜ");
  result = result.replace(/\bwt\b/g, "wₜ");
  result = result.replace(/\bpi\b/gi, "π");
  result = result.replace(
    /(\w+|\([^)]+\))\s*(\^|\*\*)\s*(\d+)/g,
    (match, base, _, exp) => `${base}${toSuperscriptNumber(exp)}`,
  );
  return result;
}

function convertToRawFormula(displayFormula) {
  let result = displayFormula;
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

  result = result.replace(
    /xₜ₋([₀₁₂₃₄₅₆₇₈₉]+)/g,
    (match, sub) => `x[t-${decodeSubscript(sub)}]`,
  );
  result = result.replace(/xₜ/g, "x[t]");
  result = result.replace(/wₜ/g, "wt");
  result = result.replace(
    /a([₀₁₂₃₄₅₆₇₈₉]+)/g,
    (match, sub) => `a${decodeSubscript(sub)}`,
  );
  result = result.replace(/π/g, "pi");
  result = result.replace(
    /(\w+|\([^)]+\))([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ]+)/g,
    (match, base, sup) => `${base}^${decodeSuperscript(sup)}`,
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

// ==================== ИНТЕРФЕЙС КОЭФФИЦИЕНТОВ ================
function renderCoeffPanel() {
  const container = document.getElementById("coeffs-table-body");
  if (!container) return;

  if (!currentCoeffIndices || currentCoeffIndices.length === 0) {
    container.innerHTML =
      '<tr><td colspan="3" style="text-align:center; color:#aaa;">— нет коэффициентов —</td></tr>';
    return;
  }

  container.innerHTML = "";
  for (let idx of currentCoeffIndices) {
    const key = `a${idx}`;
    let theoryVal = theoryCoeffs[key] !== undefined ? theoryCoeffs[key] : 0;
    let estimatedVal =
      estimatedCoeffs[key] !== undefined
        ? estimatedCoeffs[key].toFixed(4)
        : "—";

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
      let maxLimit = 100000;
      if (parseFloat(this.value) > maxLimit) {
        this.value = maxLimit;
      }

      theoryCoeffs[key] = parseFloat(this.value) || 0;
      if (currentFormulaRaw && currentCoeffIndices.length > 0)
        recalculateAndPlot();
    });
    tdTheory.appendChild(input);
    tr.appendChild(tdTheory);

    const tdEstimated = document.createElement("td");
    tdEstimated.textContent = estimatedVal;
    tr.appendChild(tdEstimated);
    container.appendChild(tr);
  }
}

function syncTheoryFromDom() {
  const container = document.getElementById("coeffs-table-body");
  if (!container) return;
  const inputs = container.querySelectorAll("input[data-coeff]");
  inputs.forEach((inp) => {
    const key = inp.getAttribute("data-coeff");
    theoryCoeffs[key] = parseFloat(inp.value) || 0;
  });
}

// ==================== ВЫЧИСЛЕНИЯ И МОДЕЛИРОВАНИЕ ============
function calculateModel(coeffs, length) {
  if (!currentFormulaRaw || currentCoeffIndices.length === 0) return [];

  let baseExpr = currentFormulaRaw
    .replace(/pi/g, "Math.PI")
    .replace(/sin\(/g, "Math.sin(")
    .replace(/cos\(/g, "Math.cos(")
    .replace(/tan\(/g, "Math.tan(")
    .replace(/exp\(/g, "Math.exp(")
    .replace(/ln\(/g, "Math.log(")
    .replace(/sqrt\(/g, "Math.sqrt(")
    .replace(/\^/g, "**");

  let result = [];
  const wtMultiplier = wtCoeffInput ? (parseFloat(wtCoeffInput.value) ?? 1) : 1;

  for (let t = 0; t < length; t++) {
    let evalExpr = baseExpr;

    evalExpr = evalExpr.replace(/x\[t-(\d+)\]/g, (match, lag) => {
      const idx = t - parseInt(lag);
      if (idx >= 0 && idx < result.length) return result[idx];
      return x0Value;
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
      console.error("Ошибка в формуле при вычислении eval:", evalExpr, e);
      result[t] = 0;
    }
  }
  return result;
}

function recalculateAndPlot() {
  if (currentCoeffIndices.length === 0) {
    plotGraphEmpty();
    return;
  }
  let hasValidCoeffs =
    Object.keys(theoryCoeffs).length > 0 &&
    Object.values(theoryCoeffs).some((v) => v !== 0);
  if (hasValidCoeffs) {
    xValues = calculateModel(theoryCoeffs, N);
  } else {
    let tempCoeffs = {};
    for (let idx of currentCoeffIndices) tempCoeffs[`a${idx}`] = 0;
    xValues = calculateModel(tempCoeffs, N);
  }
  plotGraph();
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
  if (!currentFormulaRaw || currentCoeffIndices.length === 0) {
    alert("Введите формулу с коэффициентами a0, a1...");
    return;
  }

  let rawData = yDataInput.value;
  if (!rawData.trim()) {
    if (xValues && xValues.length > 0) {
      rawData = xValues.join(", ");
      yDataInput.value = rawData;
    } else {
      alert("Введите числовые значения или сначала сгенерируйте данные");
      return;
    }
  }

  let ySeries = rawData
    .split(/[\s,;]+/)
    .map(Number)
    .filter((v) => !isNaN(v));

  if (ySeries.length < 3) {
    alert("Введите хотя бы 3 числовых значения");
    return;
  }

  originalData = [...ySeries];
  N = ySeries.length;
  if (nInput) nInput.value = N;

  const k = currentCoeffIndices.length;
  const n = ySeries.length;
  let Z = [];

  for (let t = 0; t < n; t++) {
    let row = [];
    for (let idx of currentCoeffIndices) {
      let expr = currentFormulaRaw;
      for (let other of currentCoeffIndices) {
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

      expr = expr.replace(/x\[t-(\d+)\]/g, (match, lag) => {
        const idxPast = t - parseInt(lag);
        if (idxPast >= 0 && idxPast < ySeries.length) return ySeries[idxPast];
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
      for (let m = 0; m < n; m++) ZTZ[i][j] += Z[m][i] * Z[m][j];
    }
    for (let m = 0; m < n; m++) ZTy[i] += Z[m][i] * ySeries[m];
  }

  const solution = solveLinear(ZTZ, ZTy);
  if (!solution) {
    alert("Матрица вырождена");
    return;
  }

  estimatedCoeffs = {};
  for (let idxPos = 0; idxPos < currentCoeffIndices.length; idxPos++) {
    estimatedCoeffs[`a${currentCoeffIndices[idxPos]}`] = solution[idxPos];
  }

  renderCoeffPanel();
  window.lsmValues = calculateModel(estimatedCoeffs, N);
  recalculateAndPlot();
}

// ==================== ОТРИСОВКА ГРАФИКОВ ====================
function plotGraph() {
  let datasets = [];
  if (xValues && xValues.length > 0) {
    datasets.push({
      label: "Исходная модель",
      data: xValues.map((v, i) => [i, v]),
      color: "#806edc",
      lines: { show: true, lineWidth: 2 },
      points: { show: true, radius: 2.5 },
    });
  }
  if (window.lsmValues && window.lsmValues.length > 0) {
    datasets.push({
      label: "Расчетная модель (МНК)",
      data: window.lsmValues.map((v, i) => [i, v]),
      color: "#ff9800",
      lines: { show: true, lineWidth: 2 },
      points: { show: true, radius: 2.5 },
    });
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

function onGenerateDirect() {
  if (nInput) N = parseInt(nInput.value) || 20;
  syncTheoryFromDom();
  let generated = calculateModel(theoryCoeffs, N);
  xValues = generated;
  if (generatedDataOutput) {
    generatedDataOutput.textContent = generated
      .map((v) => v.toFixed(4))
      .join(", ");
  }
  if (yDataInput && generated.length > 0) {
    yDataInput.value = generated.map((v) => v.toFixed(4)).join(", ");
  }

  if (yDataInput) {
    yDataInput.dispatchEvent(new Event("input"));
  }

  plotGraph();
}

function onFormulaChange() {
  let userInput = formulaInput.value;
  if (userInput.includes("=")) {
    userInput = userInput.substring(userInput.indexOf("=") + 1).trim();
  }

  let rawValue = convertToRawFormula(userInput);
  let displayValue = convertToDisplayFormula(rawValue);
  let fullDisplayValue = "xₜ = " + displayValue;

  if (formulaInput.value !== fullDisplayValue && rawValue !== "") {
    formulaInput.value = fullDisplayValue;
  }

  currentFormulaDisplay = fullDisplayValue;
  currentFormulaRaw = rawValue;

  let newIndices = extractIndicesFromRaw(rawValue);
  let oldTheoryCoeffs = { ...theoryCoeffs };
  currentCoeffIndices = newIndices;

  for (let idx of currentCoeffIndices) {
    const key = `a${idx}`;
    theoryCoeffs[key] =
      oldTheoryCoeffs[key] !== undefined ? oldTheoryCoeffs[key] : 0;
  }

  let validKeys = new Set(currentCoeffIndices.map((idx) => `a${idx}`));
  for (let key in theoryCoeffs) {
    if (!validKeys.has(key)) delete theoryCoeffs[key];
  }

  estimatedCoeffs = {};
  window.lsmValues = [];

  renderCoeffPanel();
  recalculateAndPlot();

  if (formulaInput && x0Group) {
    const hasLag = /x\[t-\d+\]/.test(currentFormulaRaw);

    if (hasLag) {
      x0Group.classList.remove("hidden");
    } else {
      x0Group.classList.add("hidden");
      x0Value = 0;
      if (x0Input) x0Input.value = 0;
    }
  }
}

// ==================== НАСТРОЙКА ТУМБЛЕРОВ ====================
function initToggles() {
  if (toggleData && dataContent) {
    toggleData.addEventListener("change", function () {
      if (this.checked) {
        dataContent.classList.remove("hidden");
      } else {
        dataContent.classList.add("hidden");
      }
    });
  }

  if (toggleDirect && directContent) {
    toggleDirect.addEventListener("change", function () {
      if (this.checked) {
        directContent.classList.remove("hidden");
      } else {
        directContent.classList.add("hidden");
      }
    });
  }
}

// ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================
formulaInput.addEventListener("input", onFormulaChange);
if (nInput) {
  nInput.addEventListener("input", function () {
    N = parseInt(this.value) || 20;
    recalculateAndPlot();
  });
}
if (wtCoeffInput) {
  wtCoeffInput.addEventListener("input", () => recalculateAndPlot());
}
if (generateData) {
  generateData.addEventListener("click", onGenerateDirect);
}
if (yDataInput) {
  yDataInput.addEventListener("input", estimateCoefficientsFromData);
}

if (x0Input) {
  x0Input.addEventListener("input", function () {
    x0Value = parseFloat(this.value) || 0;

    recalculateAndPlot();
  });
}

document.addEventListener("wheel", function (event) {
  if (document.activeElement && document.activeElement.type === "number") {
    document.activeElement.blur();
  }
});

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
window.addEventListener("DOMContentLoaded", () => {
  initToggles();
  formulaInput.value = "";
  onFormulaChange();
  plotGraphEmpty();
});
