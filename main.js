// ============================================================
//  main.js — логика приложения «Стохастические временные ряды»
//  Модели x(t), y(t), z(t), МНК, данные TXT/CSV/XLSX,
//  система Лоренца (Рунге–Кутта).
// ============================================================
(function () {
  "use strict";

  // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
  const $ = function (id) {
    return document.getElementById(id);
  };
  const $$ = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };

  const COLORS = {
    x: "#2563eb",
    y: "#06b6d4",
    z: "#7c3aed",
    lsm: "#f59e0b",
    lsmY: "#f97316",
    lsmZ: "#eab308",
    data: "#64748b",
    init: "#94a3b8"
  };

  const VAR_KEYS = ["x", "y", "z"];

  const VAR_META = {
    x: { key: "x", label: "xₜ", sym: "x", prefix: "a", color: COLORS.x },
    y: { key: "y", label: "yₜ", sym: "y", prefix: "b", color: COLORS.y, lsm: COLORS.lsmY },
    z: { key: "z", label: "zₜ", sym: "z", prefix: "c", color: COLORS.z, lsm: COLORS.lsmZ }
  };

  const DEFAULT_FORMULAS = {
    x: "a0 + a1*x[t-1] + wt",
    y: "b0 + b1*x[t-1] + b2*y[t-1] + wt",
    z: "c0 + c1*y[t-1] + c2*z[t-1] + wt"
  };

  const DEFAULT_COEFFS = {
    x: { a0: 1.2, a1: 0.85 },
    y: { b0: 0.4, b1: 0.3, b2: 0.6 },
    z: { c0: 0.2, c1: 0.3, c2: 0.5 }
  };

  function clampInt(value, min, max, fallback) {
    const number = parseInt(value, 10);
    if (!isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function finiteNumber(value, fallback) {
    const number = parseFloat(value);
    return isFinite(number) ? number : fallback;
  }

  function formatNumber(value, digits) {
    if (!isFinite(value)) return "—";
    const d = typeof digits === "number" ? digits : 3;
    const abs = Math.abs(value);
    if (abs !== 0 && (abs >= 10000 || abs < 0.001)) return value.toExponential(2).replace(".", ",");
    return value.toFixed(d).replace(".", ",");
  }

  function formatSigned(value, digits) {
    if (!isFinite(value)) return "—";
    const d = typeof digits === "number" ? digits : 3;
    const sign = value > 0 ? "+" : "";
    return sign + formatNumber(value, d);
  }

  function escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toSubscript(text) {
    const map = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉" };
    return String(text).split("").map(function (ch) { return map[ch] || ch; }).join("");
  }

  // ==================== ГЕНЕРАТОР СЛУЧАЙНЫХ ЧИСЕЛ ====================
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalSample(rng) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ==================== СОСТОЯНИЕ ПРИЛОЖЕНИЯ ====================
  const state = {
    N: 122,
    seed: 42,
    noise: { x: 0.8, y: 0.8, z: 0.8 },
    init: { x: 0, y: 0, z: 0 },
    models: {
      x: { key: "x", visible: true, collapsed: false, formula: DEFAULT_FORMULAS.x, coeffs: {}, estimated: {}, error: "" },
      y: { key: "y", visible: false, collapsed: false, formula: DEFAULT_FORMULAS.y, coeffs: {}, estimated: {}, error: "" },
      z: { key: "z", visible: false, collapsed: false, formula: DEFAULT_FORMULAS.z, coeffs: {}, estimated: {}, error: "" }
    },
    series: { x: [], y: [], z: [] },
    lsm: { x: [], y: [], z: [] },
    empirical: null,
    dataSource: "generated",
    metricVar: "x",
    phasePair: "xy",
    saveFormat: "csv",
    odeSaveFormat: "csv",
    inputMode: "text",
    charts: {},
    ode: { preset: "lorenz", result: null, charts: {} }
  };

  // Начальные коэффициенты
  VAR_KEYS.forEach(function (key) {
    const defaults = DEFAULT_COEFFS[key];
    Object.keys(defaults).forEach(function (name) {
      state.models[key].coeffs[name] = defaults[name];
    });
  });

  // ==================== ТОСТЫ ====================
  let toastLayer = null;

  function toast(kind, title, text, timeout) {
    if (!toastLayer) {
      toastLayer = document.createElement("div");
      toastLayer.className = "toast-layer";
      document.body.appendChild(toastLayer);
    }
    const node = document.createElement("div");
    node.className = "toast" + (kind === "error" ? " toast--error" : kind === "ok" ? " toast--ok" : "");
    node.innerHTML =
      '<div class="toast-title">' + escapeHtml(title) + "</div>" +
      (text ? '<div class="toast-text">' + escapeHtml(text) + "</div>" : "");
    toastLayer.appendChild(node);
    window.setTimeout(function () {
      node.style.opacity = "0";
      node.style.transform = "translateY(6px)";
      node.style.transition = "opacity .25s ease, transform .25s ease";
      window.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 260);
    }, timeout || 4200);
  }

  // ==================== ПАРСИНГ И КОМПИЛЯЦИЯ ФОРМУЛ ====================
  const MATH_FUNCTIONS = [
    "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
    "exp", "sqrt", "abs", "ln", "log", "pow", "min", "max", "floor", "ceil",
    "round", "sign"
  ];

  function formulaToJS(expr) {
    let text = String(expr == null ? "" : expr);
    text = text.replace(/\bpi\b/gi, "Math.PI");
    MATH_FUNCTIONS.forEach(function (fn) {
      const target = fn === "ln" ? "log" : fn;
      const re = new RegExp("(?<![\\w.])" + fn + "\\s*\\(", "g");
      text = text.replace(re, "Math." + target + "(");
    });
    text = text.replace(/\^/g, "**");
    return text;
  }

  function extractCoeffs(formula, prefix) {
    const re = new RegExp("\\b" + prefix + "(\\d+)\\b", "g");
    const found = [];
    let match;
    while ((match = re.exec(formula || "")) !== null) {
      const index = parseInt(match[1], 10);
      if (found.indexOf(index) === -1) found.push(index);
    }
    return found.sort(function (a, b) { return a - b; });
  }

  function maxLagOf(formula) {
    const re = /[xyz]\s*\[\s*t\s*-\s*(\d+)\s*\]/g;
    let max = 0;
    let match;
    while ((match = re.exec(formula || "")) !== null) {
      max = Math.max(max, parseInt(match[1], 10));
    }
    return max;
  }

  function modelReferences(formula, variable) {
    if (!formula) return false;
    return new RegExp("\\b" + variable + "\\b").test(formula);
  }

  // Сборка вычислителя формулы модели.
  // Возвращает функцию (V, C, WT, t, x, y, z) -> число
  function buildEvaluator(model) {
    let expr = String(model.formula || "").trim();
    model.error = "";
    if (!expr) return null;

    // Позволяем писать «x_t = ...» или «x[t] = ...» слева
    expr = expr.replace(/^\s*[xyz]\s*(\[[^\]]*\]|_t|t)?\s*=\s*/, "");

    let js = formulaToJS(expr);

    js = js.replace(/([xyz])\s*\[\s*t\s*-\s*(\d+)\s*\]/g, function (m, v, lag) {
      return 'V("' + v + '",t-' + parseInt(lag, 10) + ")";
    });
    js = js.replace(/([xyz])\s*\[\s*t\s*\]/g, function (m, v) {
      return 'V("' + v + '",t)';
    });

    const prefix = VAR_META[model.key].prefix;
    js = js.replace(new RegExp("\\b" + prefix + "(\\d+)\\b", "g"), function (m, idx) {
      return 'C("' + prefix + idx + '")';
    });

    js = js.replace(/\bwt\b/gi, "WT()");

    let fn;
    try {
      fn = new Function("V", "C", "WT", "t", "x", "y", "z", "return (" + js + ");");
    } catch (e) {
      model.error = "Ошибка в формуле: " + e.message;
      return null;
    }
    return fn;
  }

  // Значение переменной с учётом истории
  function makeLookup(data, init, currentT) {
    return function (variable, index) {
      const arr = data[variable];
      if (arr && index >= 0 && index < arr.length) {
        const value = arr[index];
        if (value !== undefined && value !== null && isFinite(value)) return value;
      }
      if (index === currentT && arr && isFinite(arr[currentT])) return arr[currentT];
      return isFinite(init[variable]) ? init[variable] : 0;
    };
  }

  function evaluateModel(fn, key, t, data, coeffs, noise, init) {
    const lookup = makeLookup(data, init, t);
    let noiseUsed = false;
    let noiseValue = 0;

    function coefficient(name) {
      const value = coeffs[name];
      return isFinite(value) ? value : 0;
    }
    function noiseTerm() {
      if (!noiseUsed) {
        noiseValue = noise;
        noiseUsed = true;
      }
      return noiseValue;
    }

    try {
      const value = fn(
        lookup,
        coefficient,
        noiseTerm,
        t,
        lookup("x", t),
        lookup("y", t),
        lookup("z", t)
      );
      return isFinite(value) ? value : 0;
    } catch (e) {
      return 0;
    }
  }

  // ==================== ГЕНЕРАЦИЯ ВРЕМЕННЫХ РЯДОВ ====================
  function visibleVars() {
    return VAR_KEYS.filter(function (key) { return state.models[key].visible; });
  }

  function generateTheory() {
    const N = clampInt(state.N, 3, 5000, 122);
    state.N = N;

    const order = visibleVars();
    const data = { x: new Array(N), y: new Array(N), z: new Array(N) };
    const evaluators = {};
    const rng = makeRng(state.seed + 17);

    order.forEach(function (key) {
      evaluators[key] = buildEvaluator(state.models[key]);
      if (!evaluators[key]) {
        for (let i = 0; i < N; i++) data[key][i] = 0;
      }
    });

    for (let t = 0; t < N; t++) {
      for (let i = 0; i < order.length; i++) {
        const key = order[i];
        const fn = evaluators[key];
        if (!fn) {
          data[key][t] = 0;
          continue;
        }
        const noise = normalSample(rng) * (isFinite(state.noise[key]) ? state.noise[key] : 0);
        data[key][t] = evaluateModel(fn, key, t, data, state.models[key].coeffs, noise, state.init);
      }
    }

    state.series = { x: [], y: [], z: [] };
    order.forEach(function (key) { state.series[key] = data[key]; });
  }

  // ==================== МНК (ОЦЕНКА КОЭФФИЦИЕНТОВ) ====================
  function currentData() {
    if (state.dataSource === "file" && state.empirical) return state.empirical;
    return state.series;
  }

  function solveLinearSystem(matrix, vector) {
    const n = vector.length;
    const A = matrix.map(function (row) { return row.slice(); });
    const b = vector.slice();

    for (let i = 0; i < n; i++) {
      let pivot = i;
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[j][i]) > Math.abs(A[pivot][i])) pivot = j;
      }
      if (Math.abs(A[pivot][i]) < 1e-12) return null;
      const tmpRow = A[i];
      A[i] = A[pivot];
      A[pivot] = tmpRow;
      const tmpVal = b[i];
      b[i] = b[pivot];
      b[pivot] = tmpVal;

      for (let j = i + 1; j < n; j++) {
        const factor = A[j][i] / A[i][i];
        b[j] -= factor * b[i];
        for (let k = i; k < n; k++) A[j][k] -= factor * A[i][k];
      }
    }

    const solution = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let sum = 0;
      for (let j = i + 1; j < n; j++) sum += A[i][j] * solution[j];
      solution[i] = (b[i] - sum) / A[i][i];
    }
    return solution;
  }

  function estimateModel(key, data) {
    const model = state.models[key];
    const prefix = VAR_META[key].prefix;
    const indices = extractCoeffs(model.formula, prefix);
    const dependent = data[key];

    if (!indices.length || !dependent || dependent.length < 5) return null;

    const fn = buildEvaluator(model);
    if (!fn) return null;

    const maxLag = maxLagOf(model.formula);
    const total = dependent.length;
    const start = Math.min(maxLag, total - 1);
    const rows = [];
    const targets = [];

    for (let t = start; t < total; t++) {
      const row = indices.map(function (index) {
        const coeffs = {};
        indices.forEach(function (other) {
          coeffs[prefix + other] = other === index ? 1 : 0;
        });
        const value = evaluateModel(fn, key, t, data, coeffs, 0, state.init);
        return isFinite(value) ? value : 0;
      });
      rows.push(row);
      targets.push(dependent[t]);
    }

    if (rows.length <= indices.length) return null;

    const count = indices.length;
    const normal = [];
    for (let i = 0; i < count; i++) {
      normal.push(new Array(count).fill(0));
    }
    const rhs = new Array(count).fill(0);

    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        let sum = 0;
        for (let m = 0; m < rows.length; m++) sum += rows[m][i] * rows[m][j];
        normal[i][j] = sum;
      }
      let sum = 0;
      for (let m = 0; m < rows.length; m++) sum += rows[m][i] * targets[m];
      rhs[i] = sum;
    }

    const solution = solveLinearSystem(normal, rhs);
    if (!solution) return null;

    const fitted = new Array(total).fill(null);
    for (let t = start; t < total; t++) {
      let value = 0;
      for (let i = 0; i < count; i++) value += rows[t - start][i] * solution[i];
      fitted[t] = isFinite(value) ? value : null;
    }

    const coeffs = {};
    indices.forEach(function (index, position) {
      coeffs[prefix + index] = solution[position];
    });

    return { coeffs: coeffs, fitted: fitted };
  }

  function estimateAll() {
    const data = currentData();
    const order = visibleVars();
    VAR_KEYS.forEach(function (key) {
      state.models[key].estimated = {};
      state.lsm[key] = [];
    });

    order.forEach(function (key) {
      const result = estimateModel(key, data);
      if (!result) return;
      state.models[key].estimated = result.coeffs;
      state.lsm[key] = result.fitted;
    });
  }

  // ==================== МЕТРИКИ ====================
  function calcMetrics(reference, actual) {
    if (!reference || !actual || !reference.length || !actual.length) return null;
    const total = Math.min(reference.length, actual.length);
    const pairs = [];
    for (let i = 0; i < total; i++) {
      if (isFinite(reference[i]) && isFinite(actual[i])) pairs.push([reference[i], actual[i]]);
    }
    if (pairs.length < 2) return null;

    let sumAbs = 0;
    let sumSq = 0;
    let sumPct = 0;
    let pctCount = 0;
    let mean = 0;

    pairs.forEach(function (pair) {
      const error = pair[0] - pair[1];
      sumAbs += Math.abs(error);
      sumSq += error * error;
      mean += pair[0];
      if (Math.abs(pair[0]) > 1e-9) {
        sumPct += Math.abs(error / pair[0]);
        pctCount++;
      }
    });
    mean /= pairs.length;

    let ssTotal = 0;
    let ssResidual = 0;
    pairs.forEach(function (pair) {
      ssTotal += (pair[0] - mean) * (pair[0] - mean);
      ssResidual += (pair[0] - pair[1]) * (pair[0] - pair[1]);
    });

    return {
      n: pairs.length,
      mae: sumAbs / pairs.length,
      rmse: Math.sqrt(sumSq / pairs.length),
      mape: pctCount ? (sumPct / pctCount) * 100 : null,
      r2: ssTotal > 1e-12 ? 1 - ssResidual / ssTotal : null
    };
  }

  function updateMetrics() {
    const key = state.metricVar;
    let metrics = calcMetrics(state.series[key], state.lsm[key]);

    if (!metrics && state.empirical && state.empirical[key]) {
      metrics = calcMetrics(state.series[key], state.empirical[key]);
    }

    const values = {
      mae: metrics ? formatNumber(metrics.mae, 4) : "—",
      rmse: metrics ? formatNumber(metrics.rmse, 4) : "—",
      mape: metrics && metrics.mape !== null ? formatNumber(metrics.mape, 2) + " %" : "—",
      r2: metrics && metrics.r2 !== null ? formatNumber(metrics.r2, 4) : "—"
    };

    const maeEl = $("kpi-mae");
    const rmseEl = $("kpi-rmse");
    const mapeEl = $("kpi-mape");
    const r2El = $("kpi-r2");
    if (maeEl) maeEl.textContent = values.mae;
    if (rmseEl) rmseEl.textContent = values.rmse;
    if (mapeEl) mapeEl.textContent = values.mape;
    if (r2El) r2El.textContent = values.r2;

    const sub = $("metrics-sub");
    if (sub) {
      const sourceLabel = state.dataSource === "file" ? "загруженные данные" : "сгенерированный ряд";
      sub.textContent =
        VAR_META[key].label + " · теоретическая модель против МНК (" + sourceLabel + ")";
    }
  }

  // ==================== ПАНЕЛЬ МОДЕЛЕЙ ====================
  function coeffTableHtml(key) {
    const meta = VAR_META[key];
    const model = state.models[key];
    const indices = extractCoeffs(model.formula, meta.prefix);

    if (!indices.length) {
      return '<tr><td colspan="4" class="model-empty">В формуле пока нет коэффициентов ' +
        meta.prefix + "₀, " + meta.prefix + "₁, …</td></tr>";
    }

    return indices.map(function (index) {
      const name = meta.prefix + index;
      const theory = isFinite(model.coeffs[name]) ? model.coeffs[name] : 0;
      const estimated = isFinite(model.estimated[name]) ? model.estimated[name] : null;
      let deviationCell = '<td class="coeff-dev">—</td>';
      if (estimated !== null) {
        let deviation = theory - estimated;
        if (Math.abs(deviation) < 0.00005) deviation = 0;
        const signClass = deviation > 0 ? "coeff-dev--pos" : deviation < 0 ? "coeff-dev--neg" : "";
        deviationCell = '<td class="coeff-dev ' + signClass + '">' + formatSigned(deviation, 4) + "</td>";
      }
      return (
        "<tr data-coeff=\"" + name + "\">" +
        '<td class="coeff-name">' + meta.prefix + toSubscript(index) + "</td>" +
        '<td><input class="coeff-input" type="number" step="0.01" data-coeff-input="' + name + '" value="' + escapeHtml(theory) + '"></td>' +
        '<td class="coeff-estim">' + (estimated === null ? "—" : formatNumber(estimated, 4)) + "</td>" +
        deviationCell +
        "</tr>"
      );
    }).join("");
  }

  function modelCardHtml(key) {
    const meta = VAR_META[key];
    return (
      '<div class="model-card' + (state.models[key].visible ? "" : " is-hidden") + '" data-model-key="' + key + '">' +
      '<div class="model-head">' +
      '<span class="model-badge model-badge--' + key + '">' + meta.sym + "</span>" +
      '<span class="model-name">' + meta.label + "</span>" +
      '<span class="model-tag">' + (key === "x" ? "основная" : "система") + "</span>" +
      '<span class="model-actions">' +
      '<button type="button" class="model-toggle" data-action="collapse" title="Свернуть/развернуть">–</button>' +
      "</span>" +
      "</div>" +
      '<div class="model-body">' +
      '<div class="model-formula">' +
      '<span class="formula-prefix">' + meta.label + " =</span>" +
      '<input class="model-input" type="text" spellcheck="false" data-model-input="' + key +
      '" list="datalist-' + key + '" placeholder="например ' + escapeHtml(DEFAULT_FORMULAS[key]) + '">' +
      '<datalist id="datalist-' + key + '">' +
      '<option value="' + escapeHtml(DEFAULT_FORMULAS[key]) + '"></option>' +
      '<option value="' + escapeHtml(meta.prefix + "0 + " + meta.prefix + "1*t") + '"></option>' +
      '<option value="' + escapeHtml(meta.prefix + "0 + " + meta.prefix + "1*t + " + meta.prefix + "2*t^2") + '"></option>' +
      '<option value="' + escapeHtml(meta.prefix + "0 + " + meta.prefix + "1*x[t-1] + " + meta.prefix + "2*y[t-1] + wt") + '"></option>' +
      "</datalist>" +
      "</div>" +
      '<div class="model-error" data-model-error="' + key + '"></div>' +
      '<table class="coeff-table">' +
      "<thead><tr><th>Коэфф.</th><th>Теор.</th><th>МНК</th><th>Δ</th></tr></thead>" +
      '<tbody data-coeff-body="' + key + '">' + coeffTableHtml(key) + "</tbody>" +
      "</table>" +
      "</div>" +
      "</div>"
    );
  }

  function renderModels() {
    const container = $("models-list");
    if (!container) return;
    container.innerHTML = VAR_KEYS.map(modelCardHtml).join("");

    VAR_KEYS.forEach(function (key) {
      const input = container.querySelector('[data-model-input="' + key + '"]');
      if (input) input.value = state.models[key].formula;
      const card = container.querySelector('[data-model-key="' + key + '"]');
      if (card && state.models[key].collapsed) card.classList.add("is-collapsed");
    });
    syncModelVisibility();
  }

  function syncModelVisibility() {
    VAR_KEYS.forEach(function (key) {
      const visible = state.models[key].visible;
      const card = document.querySelector('[data-model-key="' + key + '"]');
      if (card) card.classList.toggle("is-hidden", !visible);

      const addButton = document.querySelector('#model-add [data-add="' + key + '"]');
      if (addButton) addButton.classList.toggle("hidden", visible);

      ["init", "noise"].forEach(function (group) {
        const input = $(group + "-" + key);
        if (input) {
          input.disabled = !visible;
          input.style.opacity = visible ? "1" : "0.45";
        }
      });

      const metricButton = document.querySelector('#metrics-model [data-model="' + key + '"]');
      if (metricButton) metricButton.classList.toggle("hidden", !visible);
    });

    const addRow = $("model-add");
    if (addRow) {
      const allVisible = VAR_KEYS.every(function (key) { return state.models[key].visible; });
      addRow.classList.toggle("hidden", allVisible);
    }

    if (!state.models[state.metricVar].visible) {
      state.metricVar = visibleVars()[0] || "x";
    }
    $$("#metrics-model .seg").forEach(function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-model") === state.metricVar);
    });
  }

  function updateModelError(key) {
    const box = document.querySelector('[data-model-error="' + key + '"]');
    const model = state.models[key];
    if (!box) return;
    if (model.error) {
      box.textContent = model.error;
      box.classList.add("is-visible");
    } else {
      box.textContent = "";
      box.classList.remove("is-visible");
    }
  }

  function updateModelCoeffTables() {
    VAR_KEYS.forEach(function (key) {
      const body = document.querySelector('[data-coeff-body="' + key + '"]');
      if (!body) return;
      const model = state.models[key];
      const meta = VAR_META[key];
      const indices = extractCoeffs(model.formula, meta.prefix);

      const existing = body.querySelectorAll("tr[data-coeff]");
      const existingNames = Array.prototype.map.call(existing, function (row) {
        return row.getAttribute("data-coeff");
      });
      const needed = indices.map(function (index) { return meta.prefix + index; });

      const same = existingNames.length === needed.length &&
        existingNames.every(function (name, i) { return name === needed[i]; });

      if (!same) {
        body.innerHTML = coeffTableHtml(key);
        return;
      }

      // Обновляем только числовые ячейки, чтобы не терять фокус в полях ввода
      indices.forEach(function (index) {
        const name = meta.prefix + index;
        const row = body.querySelector('tr[data-coeff="' + name + '"]');
        if (!row) return;
        const estimatedCell = row.querySelector(".coeff-estim");
        const deviationCell = row.querySelector(".coeff-dev");
        const theory = isFinite(model.coeffs[name]) ? model.coeffs[name] : 0;
        const estimated = isFinite(model.estimated[name]) ? model.estimated[name] : null;
        const input = row.querySelector("input");
        if (input && document.activeElement !== input) input.value = theory;

        if (estimatedCell) estimatedCell.textContent = estimated === null ? "—" : formatNumber(estimated, 4);
        if (deviationCell) {
          if (estimated === null) {
            deviationCell.textContent = "—";
            deviationCell.className = "coeff-dev";
          } else {
            let deviation = theory - estimated;
            if (Math.abs(deviation) < 0.00005) deviation = 0;
            deviationCell.textContent = formatSigned(deviation, 4);
            deviationCell.className = "coeff-dev" + (deviation > 0 ? " coeff-dev--pos" : deviation < 0 ? " coeff-dev--neg" : "");
          }
        }
      });
    });
  }

  // Автоматическое появление моделей y и z при ссылке в формулах
  function updateDependencies() {
    let changed = true;
    while (changed) {
      changed = false;
      if (!state.models.y.visible && modelReferences(state.models.x.formula, "y")) {
        state.models.y.visible = true;
        changed = true;
      }
      if (!state.models.z.visible) {
        const referenced = modelReferences(state.models.x.formula, "z") ||
          (state.models.y.visible && modelReferences(state.models.y.formula, "z"));
        if (referenced) {
          state.models.z.visible = true;
          changed = true;
        }
      }
    }
    syncModelVisibility();
  }

  // ==================== ГРАФИКИ ВРЕМЕННЫХ РЯДОВ ====================
  function pointsFrom(values, skipNulls) {
    const points = [];
    if (!values) return points;
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (!isFinite(value)) {
        if (!skipNulls) continue;
        continue;
      }
      points.push([i, value]);
    }
    return points;
  }

  function seriesChartConfig() {
    const series = [];
    const order = visibleVars();

    order.forEach(function (key) {
      const meta = VAR_META[key];
      const theoryPoints = pointsFrom(state.series[key]);
      if (theoryPoints.length) {
        series.push({
          name: meta.label + " теория",
          color: meta.color,
          data: theoryPoints,
          kind: "line",
          width: 2.6,
          smooth: true
        });
      }

      const lsmPoints = pointsFrom(state.lsm[key]);
      if (lsmPoints.length) {
        series.push({
          name: meta.label + " МНК",
          color: meta.lsm || COLORS.lsm,
          data: lsmPoints,
          kind: "line",
          width: 2,
          dash: [7, 4],
          smooth: true
        });
      }

      if (state.dataSource === "file" && state.empirical && state.empirical[key]) {
        const dataPoints = pointsFrom(state.empirical[key]);
        if (dataPoints.length) {
          series.push({
            name: meta.label + " данные",
            color: COLORS.data,
            data: dataPoints,
            kind: "line",
            width: 1.4,
            markers: true,
            smooth: false
          });
        }
      }
    });

    return {
      height: 380,
      series: series,
      xLabel: "t",
      yLabel: "значение",
      xFormat: function (value) { return String(Math.round(value)); },
      yFormat: function (value) { return formatNumber(value, 2); },
      legend: true,
      tooltip: true,
      animate: true,
      yZero: false,
      emptyText: "Нет данных — нажмите «Сгенерировать»"
    };
  }

  function phaseChartConfig() {
    const source = currentData();
    const firstKey = state.phasePair.charAt(0);
    const secondKey = state.phasePair.charAt(1);
    const hasSeries = function (key) {
      return !!(source[key] && source[key].length > 1);
    };

    let points = [];
    let xLabel;
    let yLabel;

    if (hasSeries(firstKey) && hasSeries(secondKey)) {
      const first = source[firstKey];
      const second = source[secondKey];
      const total = Math.min(first.length, second.length);
      const stride = Math.max(1, Math.ceil(total / 1200));
      for (let i = 0; i < total; i += stride) {
        if (isFinite(first[i]) && isFinite(second[i])) points.push([first[i], second[i]]);
      }
      xLabel = VAR_META[firstKey].label;
      yLabel = VAR_META[secondKey].label;
      return {
        height: 300,
        series: points.length
          ? [{
              name: VAR_META[firstKey].label + " – " + VAR_META[secondKey].label,
              color: COLORS.x,
              data: points,
              kind: "line",
              width: 2,
              smooth: true,
              preserveOrder: true
            }]
          : [],
        xLabel: xLabel,
        yLabel: yLabel,
        xFormat: function (value) { return formatNumber(value, 1); },
        yFormat: function (value) { return formatNumber(value, 1); },
        legend: false,
        tooltip: true,
        animate: true,
        grid: { x: true, y: true },
        emptyText: "Нет данных для фазового портрета"
      };
    }

    // Запасной вариант: если второй переменной ещё нет — показываем
    // «портрет запаздывания» xₜ от xₜ₋₁ (диагональ = сильная корреляция).
    const key = visibleVars().filter(hasSeries)[0] || "x";
    const values = source[key] || [];
    const stride = Math.max(1, Math.ceil(values.length / 1200));
    for (let i = 1; i < values.length; i += stride) {
      if (isFinite(values[i - 1]) && isFinite(values[i])) points.push([values[i - 1], values[i]]);
    }
    xLabel = VAR_META[key].label.replace("ₜ", "ₜ₋₁");
    yLabel = VAR_META[key].label;

    return {
      height: 300,
      series: points.length
        ? [{
            name: xLabel + " – " + yLabel,
            color: COLORS.x,
            data: points,
            kind: "line",
            width: 2,
            smooth: true,
            preserveOrder: true
          }]
        : [],
      xLabel: xLabel,
      yLabel: yLabel,
      xFormat: function (value) { return formatNumber(value, 1); },
      yFormat: function (value) { return formatNumber(value, 1); },
      legend: false,
      tooltip: true,
      animate: true,
      grid: { x: true, y: true },
      emptyText: "Данных пока нет — нажмите «Сгенерировать»"
    };
  }

  function syncPhaseButtons() {
    const available = visibleVars();
    let allDisabled = true;
    $$("#phase-pair .seg").forEach(function (button) {
      const pair = button.getAttribute("data-pair");
      const enabled = available.indexOf(pair.charAt(0)) !== -1 && available.indexOf(pair.charAt(1)) !== -1;
      button.disabled = !enabled;
      button.title = enabled ? "" : "Сначала добавьте соответствующую модель";
      if (!button.disabled) allDisabled = false;
      if (enabled && available.indexOf(state.phasePair.charAt(0)) === -1) state.phasePair = pair;
    });
    if (allDisabled) state.phasePair = "xy";
  }

  function updateCharts() {
    if (!window.ChartKit) return;
    syncPhaseButtons();
    const seriesHost = $("chart-series");
    const phaseHost = $("chart-phase");

    try {
      if (!state.charts.series && seriesHost) {
        state.charts.series = window.ChartKit.line(seriesHost, seriesChartConfig());
      } else if (state.charts.series) {
        state.charts.series.update(seriesChartConfig());
      }
    } catch (e) {
      console.error("Ошибка графика рядов:", e);
    }

    try {
      if (!state.charts.phase && phaseHost) {
        state.charts.phase = window.ChartKit.line(phaseHost, phaseChartConfig());
      } else if (state.charts.phase) {
        state.charts.phase.update(phaseChartConfig());
      }
    } catch (e) {
      console.error("Ошибка фазового портрета:", e);
    }

    const sub = $("chart-series-sub");
    if (sub) {
      const parts = ["N = " + state.N + " точек"];
      parts.push(state.dataSource === "file" && state.empirical
        ? "загруженные данные: " + (state.empirical.name || "файл")
        : "сгенерированный ряд");
      sub.textContent = parts.join(" · ");
    }

    const phaseSub = $("phase-sub");
    if (phaseSub) {
      const firstKey = state.phasePair.charAt(0);
      const secondKey = state.phasePair.charAt(1);
      const firstValues = state.series[firstKey];
      const secondValues = state.series[secondKey];
      if (firstValues && firstValues.length && secondValues && secondValues.length) {
        phaseSub.textContent = VAR_META[firstKey].label + " – " + VAR_META[secondKey].label + " · траектория";
      } else {
        const key = visibleVars()[0] || "x";
        phaseSub.textContent =
          VAR_META[key].label + " – " + VAR_META[key].label.replace("ₜ", "ₜ₋₁") + " · портрет запаздывания";
      }
    }
  }

  // ==================== ТАБЛИЦА ДАННЫХ ====================
  function renderDataTable() {
    const wrap = $("data-table-wrap");
    if (!wrap) return;

    const data = currentData();
    const order = visibleVars().filter(function (key) {
      return data[key] && data[key].length;
    });

    if (!order.length) {
      wrap.innerHTML = '<div class="table-empty">Данных пока нет — нажмите «Сгенерировать»</div>';
      const sub = $("table-sub");
      if (sub) sub.textContent = "нет данных";
      return;
    }

    const length = Math.max.apply(null, order.map(function (key) { return data[key].length; }));
    const limit = Math.min(length, 200);

    let html = "<table><thead><tr><th>t</th>";
    order.forEach(function (key) {
      html += "<th>" + VAR_META[key].label + "</th>";
    });
    html += "</tr></thead><tbody>";

    for (let t = 0; t < limit; t++) {
      html += "<tr><td>" + t + "</td>";
      order.forEach(function (key) {
        const value = data[key][t];
        html += "<td>" + (isFinite(value) ? formatNumber(value, 4) : "—") + "</td>";
      });
      html += "</tr>";
    }
    html += "</tbody></table>";
    wrap.innerHTML = html;

    const sub = $("table-sub");
    if (sub) {
      const source = state.dataSource === "file" && state.empirical
        ? "файл: " + (state.empirical.name || "")
        : "сгенерированные данные";
      sub.textContent = source + " · показано " + limit + " из " + length;
    }
  }

  // ==================== ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ====================
  function refreshAll(options) {
    const opts = options || {};
    updateDependencies();
    generateTheory();

    VAR_KEYS.forEach(function (key) {
      updateModelError(key);
    });

    estimateAll();
    updateModelCoeffTables();
    updateCharts();
    updateMetrics();
    renderDataTable();

    if (opts.toastMessage) toast("ok", opts.toastTitle || "Готово", opts.toastMessage);
  }

  let refreshTimer = null;
  function scheduleRefresh(delay) {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(function () { refreshAll(); }, typeof delay === "number" ? delay : 140);
  }

  // ==================== ФАЙЛЫ: ЗАГРУЗКА ====================
  function updateInputModeUi() {
    const isExcel = state.inputMode === "excel";
    const hint = $("file-formats");
    const input = $("file-input");
    if (hint) {
      hint.textContent = isExcel
        ? "XLSX — первый лист книги, числа в колонках"
        : "TXT · CSV — числа через пробел, «;» или запятую";
    }
    if (input) input.setAttribute("accept", isExcel ? ".xlsx,.xlsm" : ".txt,.csv,.tsv");
  }

  function setDataBadge(kind, text) {
    const badge = $("data-badge");
    if (!badge) return;
    badge.className = "badge " + kind;
    badge.textContent = text;
  }

  function updateDataMeta() {
    const meta = $("data-meta");
    const name = $("data-meta-name");
    const cols = $("data-meta-cols");
    const sub = $("data-sub");

    if (state.dataSource === "file" && state.empirical) {
      const parts = [];
      if (state.empirical.x) parts.push("x: " + state.empirical.x.length);
      if (state.empirical.y) parts.push("y: " + state.empirical.y.length);
      if (state.empirical.z) parts.push("z: " + state.empirical.z.length);
      if (meta) meta.classList.remove("hidden");
      if (name) name.textContent = state.empirical.name || "файл данных";
      if (cols) cols.textContent = "Распознано — " + parts.join(" · ");
      if (sub) sub.textContent = "Данные загружены из файла";
      setDataBadge("badge--ok", "файл");
    } else {
      if (meta) meta.classList.add("hidden");
      if (sub) sub.textContent = "Ряд ещё не загружен — данные сгенерированы";
      setDataBadge("badge--muted", "нет файла");
    }
  }

  function applyLoadedData(normalized, fileName) {
    if (!normalized || !normalized.x || !normalized.x.length) {
      throw new Error("В файле не найден числовой ряд x");
    }
    state.empirical = {
      name: fileName || normalized.name || "данные",
      x: normalized.x,
      y: normalized.y && normalized.y.length ? normalized.y : null,
      z: normalized.z && normalized.z.length ? normalized.z : null,
      index: normalized.index || null
    };
    state.dataSource = "file";
    state.N = state.empirical.x.length;
    const nInput = $("param-N");
    if (nInput) nInput.value = state.N;

    updateDataMeta();
    refreshAll();

    const warnings = normalized.warnings || [];
    toast(
      "ok",
      "Данные загружены",
      "Точек: " + state.N + (warnings.length ? " · " + warnings.join(" ") : "")
    );
  }

  async function handleFile(file) {
    if (!window.DataIO) {
      toast("error", "Модуль ввода-вывода не загружен", "Проверьте наличие io.js");
      return;
    }
    if (!file) return;

    try {
      setDataBadge("badge--muted", "чтение…");
      const parsed = await window.DataIO.readFile(file);
      const normalized = window.DataIO.normalizeSeries(parsed);
      applyLoadedData(normalized, file.name);
    } catch (e) {
      console.error(e);
      setDataBadge("badge--warn", "ошибка файла");
      toast("error", "Не удалось прочитать файл", e && e.message ? e.message : String(e));
    }
  }

  function bindFileInput() {
    const input = $("file-input");
    const dropzone = $("dropzone");
    const pickButton = $("btn-pick");

    if (input) {
      input.addEventListener("change", function () {
        if (this.files && this.files[0]) handleFile(this.files[0]);
        this.value = "";
      });
    }

    if (dropzone) {
      dropzone.addEventListener("click", function (event) {
        if (event.target === pickButton || !pickButton) {
          if (input) input.click();
          return;
        }
        if (input) input.click();
      });
      dropzone.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (input) input.click();
        }
      });
      ["dragenter", "dragover"].forEach(function (type) {
        dropzone.addEventListener(type, function (event) {
          event.preventDefault();
          dropzone.classList.add("is-over");
        });
      });
      ["dragleave", "drop"].forEach(function (type) {
        dropzone.addEventListener(type, function (event) {
          event.preventDefault();
          dropzone.classList.remove("is-over");
        });
      });
      dropzone.addEventListener("drop", function (event) {
        const files = event.dataTransfer && event.dataTransfer.files;
        if (files && files[0]) handleFile(files[0]);
      });
    }
  }

  // ==================== ФАЙЛЫ: СОХРАНЕНИЕ ====================
  function buildDatasetFromSeries() {
    const data = currentData();
    const order = visibleVars().filter(function (key) {
      return data[key] && data[key].length;
    });
    if (!order.length) return null;

    const length = Math.max.apply(null, order.map(function (key) { return data[key].length; }));
    const headers = ["t"].concat(order.map(function (key) { return VAR_META[key].sym; }));
    const columns = [{ name: "t", values: [] }].concat(order.map(function (key) {
      return { name: VAR_META[key].sym, values: [] };
    }));

    for (let i = 0; i < length; i++) {
      columns[0].values.push(i);
      order.forEach(function (key, position) {
        const value = data[key][i];
        columns[position + 1].values.push(isFinite(value) ? Number(value.toFixed(6)) : 0);
      });
    }
    return { headers: headers, columns: columns };
  }

  function downloadWithFormat(dataset, format, baseName) {
    if (!window.DataIO) {
      toast("error", "Модуль ввода-вывода не загружен", "Проверьте наличие io.js");
      return;
    }
    if (!dataset) {
      toast("error", "Нечего сохранять", "Сначала сгенерируйте или загрузите данные");
      return;
    }

    try {
      let blob;
      let extension;
      if (format === "xlsx") {
        blob = window.DataIO.exportXlsx(dataset);
        extension = "xlsx";
      } else if (format === "txt") {
        blob = window.DataIO.exportTxt(dataset);
        extension = "txt";
      } else {
        blob = window.DataIO.exportCsv(dataset);
        extension = "csv";
      }
      const name = baseName + "." + extension;
      window.DataIO.download(blob, name);
      toast("ok", "Файл сохранён", name);
    } catch (e) {
      console.error(e);
      toast("error", "Не удалось сохранить файл", e && e.message ? e.message : String(e));
    }
  }

  function saveSeriesData() {
    const dataset = buildDatasetFromSeries();
    downloadWithFormat(dataset, state.saveFormat, "ryad_" + state.N);
  }

  function saveChartPng(chart, name) {
    if (!chart || typeof chart.toDataURL !== "function") {
      toast("warn", "График ещё не построен", "");
      return;
    }
    try {
      const link = document.createElement("a");
      link.href = chart.toDataURL();
      link.download = name + ".png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      toast("error", "Не удалось сохранить график", e.message);
    }
  }

  // ==================== ОБРАБОТЧИКИ: МОДЕЛИ И ПАРАМЕТРЫ ====================
  function bindModels() {
    const container = $("models-list");
    if (container) {
      container.addEventListener("input", function (event) {
        const target = event.target;

        if (target.matches("[data-model-input]")) {
          const key = target.getAttribute("data-model-input");
          const model = state.models[key];
          model.formula = target.value;

          updateDependencies();
          updateModelError(key);
          updateModelCoeffTables();
          scheduleRefresh(160);
          return;
        }

        if (target.matches("[data-coeff-input]")) {
          const name = target.getAttribute("data-coeff-input");
          const modelKey = name.charAt(0) === "a" ? "x" : name.charAt(0) === "b" ? "y" : "z";
          state.models[modelKey].coeffs[name] = finiteNumber(target.value, 0);
          scheduleRefresh(90);
        }
      });

      container.addEventListener("click", function (event) {
        const toggle = event.target.closest("[data-action='collapse']");
        if (!toggle) return;
        const card = toggle.closest(".model-card");
        if (!card) return;
        const key = card.getAttribute("data-model-key");
        state.models[key].collapsed = !state.models[key].collapsed;
        card.classList.toggle("is-collapsed", state.models[key].collapsed);
        toggle.textContent = state.models[key].collapsed ? "+" : "–";
      });
    }

    $$("#model-add .btn").forEach(function (button) {
      button.addEventListener("click", function () {
        const key = button.getAttribute("data-add");
        if (!VAR_KEYS.includes(key)) return;
        state.models[key].visible = true;
        state.models[key].collapsed = false;
        const card = document.querySelector('[data-model-key="' + key + '"]');
        if (card) card.classList.remove("is-collapsed");
        syncModelVisibility();
        refreshAll();
      });
    });
  }

  function bindParameters() {
    const nInput = $("param-N");
    if (nInput) {
      nInput.addEventListener("input", function () {
        state.N = clampInt(this.value, 3, 5000, state.N);
        scheduleRefresh(220);
      });
    }

    const seedInput = $("param-seed");
    if (seedInput) {
      seedInput.addEventListener("input", function () {
        state.seed = clampInt(this.value, 0, 9999999, 42);
        scheduleRefresh(180);
      });
    }

    VAR_KEYS.forEach(function (key) {
      const noiseInput = $("noise-" + key);
      if (noiseInput) {
        noiseInput.addEventListener("input", function () {
          state.noise[key] = Math.max(0, finiteNumber(this.value, 0));
          scheduleRefresh(150);
        });
      }
      const initInput = $("init-" + key);
      if (initInput) {
        initInput.addEventListener("input", function () {
          state.init[key] = finiteNumber(this.value, 0);
          scheduleRefresh(150);
        });
      }
    });
  }

  function bindMainControls() {
    const generate = $("btn-generate");
    if (generate) {
      generate.addEventListener("click", function () {
        state.dataSource = "generated";
        updateDataMeta();
        refreshAll({
          toastTitle: "Ряд сгенерирован",
          toastMessage: "N = " + state.N + " · шум δW = " + formatNumber(state.noise.x, 2)
        });
      });
    }

    const calc = $("btn-calc");
    if (calc) {
      calc.addEventListener("click", function () {
        refreshAll();
        const estimatedCount = visibleVars().filter(function (key) {
          return Object.keys(state.models[key].estimated).length > 0;
        }).length;
        toast(
          estimatedCount ? "ok" : "warn",
          estimatedCount ? "Коэффициенты пересчитаны" : "Недостаточно данных",
          estimatedCount
            ? "МНК применён для моделей: " + visibleVars().join(", ")
            : "Нужно минимум 5 значений ряда и коэффициенты в формуле"
        );
      });
    }

    const save = $("btn-save");
    if (save) save.addEventListener("click", saveSeriesData);

    const saveTable = $("btn-save-table");
    if (saveTable) saveTable.addEventListener("click", saveSeriesData);

    const saveChart = $("btn-save-chart-series");
    if (saveChart) {
      saveChart.addEventListener("click", function () {
        saveChartPng(state.charts.series, "graf_ryadov");
      });
    }

    const savePhase = $("btn-save-chart-phase");
    if (savePhase) savePhase.addEventListener("click", function () { saveChartPng(state.charts.phase, "fazovyi_portret"); });

    // Переключатели сегментов
    $$("#save-format .seg").forEach(function (button) {
      button.addEventListener("click", function () {
        state.saveFormat = button.getAttribute("data-format");
        $$("#save-format .seg").forEach(function (other) {
          other.classList.toggle("is-active", other === button);
        });
      });
    });

    $$("#input-mode .seg").forEach(function (button) {
      button.addEventListener("click", function () {
        state.inputMode = button.getAttribute("data-mode");
        $$("#input-mode .seg").forEach(function (other) {
          other.classList.toggle("is-active", other === button);
        });
        updateInputModeUi();
      });
    });

    $$("#metrics-model .seg").forEach(function (button) {
      button.addEventListener("click", function () {
        state.metricVar = button.getAttribute("data-model");
        $$("#metrics-model .seg").forEach(function (other) {
          other.classList.toggle("is-active", other === button);
        });
        updateMetrics();
      });
    });

    $$("#phase-pair .seg").forEach(function (button) {
      button.addEventListener("click", function () {
        state.phasePair = button.getAttribute("data-pair");
        $$("#phase-pair .seg").forEach(function (other) {
          other.classList.toggle("is-active", other === button);
        });
        updateCharts();
      });
    });
  }

  // ==================== ВКЛАДКИ ====================
  function switchTab(name) {
    $$("#tabs .tab").forEach(function (tab) {
      const active = tab.getAttribute("data-tab") === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$(".tab-panel").forEach(function (panel) {
      panel.classList.toggle("is-active", panel.id === "panel-" + name);
    });

    window.requestAnimationFrame(function () {
      if (Object.keys(state.charts).length) {
        Object.keys(state.charts).forEach(function (chartKey) {
          const chart = state.charts[chartKey];
          if (chart && typeof chart.resize === "function") chart.resize();
        });
      }
      if (name === "lorenz") {
        if (!state.ode.result) calculateOde();
        else resizeOdeCharts();
      }
    });
  }

  function bindTabs() {
    $$("#tabs .tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        switchTab(tab.getAttribute("data-tab"));
      });
    });
  }

  // ==================== СИСТЕМА ЛОРЕНЦА (ОДУ) ====================
  function odeParamChips(preset) {
    const container = $("ode-params");
    if (!container) return;
    container.innerHTML = preset.params.map(function (param) {
      return (
        '<label class="param-chip">' +
        "<span>" + escapeHtml(param.label) + "</span>" +
        '<input type="number" step="' + param.step + '" min="' + param.min + '" max="' + param.max +
        '" data-param="' + param.key + '" value="' + escapeHtml(param.value) + '">' +
        "</label>"
      );
    }).join("");
  }

  function applyOdePreset(key, silent) {
    const preset = window.Numeric && window.Numeric.PRESETS[key];
    if (!preset) return;
    state.ode.preset = key;

    const select = $("ode-preset");
    if (select) select.value = key;

    $$("#ode-eqs .eq-input").forEach(function (input, index) {
      input.value = preset.eqs[index] || "";
    });

    odeParamChips(preset);

    const tmax = $("ode-tmax");
    const dt = $("ode-dt");
    if (tmax) tmax.value = preset.tMax;
    if (dt) dt.value = preset.dt;

    const inits = [$("ode-x0"), $("ode-y0"), $("ode-z0")];
    inits.forEach(function (input, index) {
      if (input) input.value = preset.state0[index] || 0;
    });

    const badge = $("attractor-badge");
    if (badge) badge.textContent = preset.title;
    const sub = $("ode-sub");
    if (sub) sub.textContent = preset.subtitle;

    if (!silent) toast("ok", "Система выбрана", preset.title);
  }

  function readOdeConfig() {
    const eqs = [];
    const inputs = $$("#ode-eqs .eq-input");
    inputs.forEach(function (input) {
      const value = input.value.trim();
      if (value) eqs.push(value);
    });
    if (!eqs.length) throw new Error("Введите хотя бы одно уравнение");

    const params = {};
    const paramNames = [];
    $$("#ode-params [data-param]").forEach(function (input) {
      const name = input.getAttribute("data-param");
      params[name] = finiteNumber(input.value, 0);
      paramNames.push(name);
    });

    if (state.ode.preset === "custom" && window.Numeric) {
      const identifiers = [];
      eqs.forEach(function (expr) {
        window.Numeric.extractIdentifiers(expr).forEach(function (name) {
          if (paramNames.indexOf(name) === -1 && !(name in params)) identifiers.push(name);
        });
      });
      // добавляем чипы для новых параметров, чтобы формула работала
      const container = $("ode-params");
      identifiers.forEach(function (name) {
        params[name] = 0;
        paramNames.push(name);
        if (container) {
          const chip = document.createElement("label");
          chip.className = "param-chip";
          chip.innerHTML = "<span>" + escapeHtml(name) + "</span>" +
            '<input type="number" step="0.1" data-param="' + escapeHtml(name) + '" value="0">';
          container.appendChild(chip);
        }
      });
    }

    const t1 = Math.max(0.1, finiteNumber($("ode-tmax") && $("ode-tmax").value, 40));
    const dt = Math.max(0.0001, finiteNumber($("ode-dt") && $("ode-dt").value, 0.01));
    const state0 = [
      finiteNumber($("ode-x0") && $("ode-x0").value, 1),
      finiteNumber($("ode-y0") && $("ode-y0").value, 1),
      finiteNumber($("ode-z0") && $("ode-z0").value, 1)
    ].slice(0, eqs.length);

    const method = ($("ode-method") && $("ode-method").value) || "rk4";

    return { eqs: eqs, state0: state0, t0: 0, t1: t1, dt: dt, method: method, params: params, paramNames: paramNames };
  }

  function odePoints(result, stride) {
    const points = [];
    const step = stride || 1;
    for (let i = 0; i < result.t.length; i += step) {
      points.push([result.t[i]].concat(result.states[i]));
    }
    const lastIndex = result.t.length - 1;
    if (points.length && points[points.length - 1][0] !== result.t[lastIndex]) {
      points.push([result.t[lastIndex]].concat(result.states[lastIndex]));
    }
    return points;
  }

  function updateOdeCharts() {
    if (!window.ChartKit || !state.ode.result) return;
    const result = state.ode.result;
    const preset = window.Numeric.PRESETS[state.ode.preset] || { labels: ["x", "y", "z"] };
    const labels = preset.labels || ["x", "y", "z"];
    const stride = Math.max(1, Math.ceil(result.t.length / 1400));
    const points = odePoints(result, stride);
    const dims = result.eqs.length;

    // 3D-аттрактор
    const attractorHost = $("chart-attractor");
    if (attractorHost) {
      const attractorConfig = {
        points: points.map(function (point) {
          return [point[1] || 0, point[2] || 0, point[3] || 0];
        }),
        labels: { x: labels[0], y: labels[1], z: labels[2] },
        height: 500,
        autoRotate: true,
        animate: true,
        colorFrom: "#38bdf8",
        colorTo: "#1d4ed8",
        axes: true
      };
      try {
        if (!state.ode.charts.attractor) {
          state.ode.charts.attractor = window.ChartKit.phase3d(attractorHost, attractorConfig);
        } else {
          state.ode.charts.attractor.update(attractorConfig);
        }
      } catch (e) {
        console.error("Ошибка аттрактора:", e);
      }
    }

    // Временные ряды решения
    const seriesHost = $("chart-ode-series");
    if (seriesHost) {
      const series = [];
      const palette = [COLORS.x, COLORS.y, COLORS.z];
      for (let d = 0; d < Math.min(dims, 3); d++) {
        series.push({
          name: labels[d] + "(t)",
          color: palette[d],
          data: points.map(function (point) { return [point[0], point[d + 1] || 0]; }),
          kind: "line",
          width: 2.2,
          smooth: true
        });
      }
      const config = {
        height: 300,
        series: series,
        xLabel: "t",
        yLabel: "значение",
        xFormat: function (value) { return formatNumber(value, 1); },
        yFormat: function (value) { return formatNumber(value, 2); },
        legend: true,
        tooltip: true,
        animate: true
      };
      try {
        if (!state.ode.charts.series) state.ode.charts.series = window.ChartKit.line(seriesHost, config);
        else state.ode.charts.series.update(config);
      } catch (e) {
        console.error("Ошибка рядов решения:", e);
      }
    }

    // Фазовый портрет x-y
    const phaseHost = $("chart-ode-phase");
    if (phaseHost) {
      const config = {
        height: 300,
        series: dims >= 2
          ? [{
              name: "x–y",
              color: COLORS.x,
              data: points.map(function (point) { return [point[1] || 0, point[2] || 0]; }),
              kind: "line",
              width: 1.8,
              smooth: true,
              preserveOrder: true
            }]
          : [],
        xLabel: labels[0],
        yLabel: labels[1],
        xFormat: function (value) { return formatNumber(value, 1); },
        yFormat: function (value) { return formatNumber(value, 1); },
        legend: false,
        tooltip: true,
        animate: true,
        emptyText: "Нужно минимум два уравнения"
      };
      try {
        if (!state.ode.charts.phase) state.ode.charts.phase = window.ChartKit.line(phaseHost, config);
        else state.ode.charts.phase.update(config);
      } catch (e) {
        console.error("Ошибка фазового портрета ОДУ:", e);
      }
    }
  }

  function resizeOdeCharts() {
    Object.keys(state.ode.charts).forEach(function (key) {
      const chart = state.ode.charts[key];
      if (chart && typeof chart.resize === "function") chart.resize();
    });
  }

  function renderOdeTable() {
    const wrap = $("ode-table-wrap");
    if (!wrap) return;
    const result = state.ode.result;
    if (!result) {
      wrap.innerHTML = '<div class="table-empty">Нажмите «Рассчитать»</div>';
      return;
    }
    const preset = window.Numeric.PRESETS[state.ode.preset] || { labels: ["x", "y", "z"] };
    const labels = preset.labels || ["x", "y", "z"];
    const dims = result.eqs.length;

    let html = "<table><thead><tr><th>t</th>";
    for (let d = 0; d < dims; d++) html += "<th>" + escapeHtml(labels[d]) + "</th>";
    html += "</tr></thead><tbody>";
    const limit = Math.min(result.t.length, 12);
    for (let i = 0; i < limit; i++) {
      html += "<tr><td>" + formatNumber(result.t[i], 3) + "</td>";
      for (let d = 0; d < dims; d++) {
        html += "<td>" + formatNumber(result.states[i][d], 5) + "</td>";
      }
      html += "</tr>";
    }
    html += "</tbody></table>";
    wrap.innerHTML = html;

    const sub = $("ode-table-sub");
    if (sub) sub.textContent = "показано " + limit + " из " + result.t.length + " строк";
  }

  function updateOdeKpi() {
    const result = state.ode.result;
    if (!result) return;
    const points = $("ode-kpi-points");
    const dtCell = $("ode-kpi-dt");
    const methodCell = $("ode-kpi-method");
    const timeCell = $("ode-kpi-time");
    if (points) points.textContent = String(result.t.length - 1);
    if (dtCell) dtCell.textContent = formatNumber(result.dt, 4);
    if (methodCell) methodCell.textContent = result.method;
    if (timeCell) timeCell.textContent = String(result.durationMs);
  }

  function calculateOde() {
    if (!window.Numeric) {
      toast("error", "Модуль численных методов не загружен", "Проверьте наличие rk.js");
      return;
    }
    let config;
    try {
      config = readOdeConfig();
    } catch (e) {
      toast("error", "Не хватает данных", e.message);
      return;
    }

    try {
      const result = window.Numeric.integrate(config);
      state.ode.result = result;
      state.ode.config = config;
      updateOdeKpi();
      updateOdeCharts();
      renderOdeTable();
      toast("ok", "Система рассчитана", result.method + " · " + (result.t.length - 1) + " шагов");
    } catch (e) {
      console.error(e);
      toast("error", "Ошибка интегрирования", e && e.message ? e.message : String(e));
    }
  }

  function saveOdeData() {
    const result = state.ode.result;
    if (!result) {
      toast("error", "Нечего сохранять", "Сначала рассчитайте систему");
      return;
    }
    const preset = window.Numeric.PRESETS[state.ode.preset] || { labels: ["x", "y", "z"] };
    const labels = preset.labels || ["x", "y", "z"];
    const dims = result.eqs.length;
    const headers = ["t"].concat(labels.slice(0, dims));
    const columns = [{ name: "t", values: [] }].concat(labels.slice(0, dims).map(function (label) {
      return { name: label, values: [] };
    }));
    for (let i = 0; i < result.t.length; i++) {
      columns[0].values.push(Number(result.t[i].toFixed(6)));
      for (let d = 0; d < dims; d++) {
        columns[d + 1].values.push(Number((result.states[i][d] || 0).toFixed(6)));
      }
    }
    downloadWithFormat({ headers: headers, columns: columns }, state.odeSaveFormat, "ode_" + state.ode.preset);
  }

  function bindOdeControls() {
    const presetSelect = $("ode-preset");
    if (presetSelect) {
      presetSelect.addEventListener("change", function () {
        applyOdePreset(this.value, true);
        toast("ok", "Система выбрана", this.options[this.selectedIndex].textContent);
      });
    }

    const calcButton = $("btn-ode-calc");
    if (calcButton) calcButton.addEventListener("click", calculateOde);

    const resetButton = $("btn-ode-reset");
    if (resetButton) {
      resetButton.addEventListener("click", function () {
        applyOdePreset(state.ode.preset, true);
        state.ode.result = null;
        calculateOde();
      });
    }

    const saveButton = $("btn-ode-save");
    if (saveButton) saveButton.addEventListener("click", saveOdeData);

    const saveAttractor = $("btn-save-attractor");
    if (saveAttractor) {
      saveAttractor.addEventListener("click", function () {
        saveChartPng(state.ode.charts.attractor, "attractor_" + state.ode.preset);
      });
    }

    $$("#ode-save-format .seg").forEach(function (button) {
      button.addEventListener("click", function () {
        state.odeSaveFormat = button.getAttribute("data-format");
        $$("#ode-save-format .seg").forEach(function (other) {
          other.classList.toggle("is-active", other === button);
        });
      });
    });

    $$("#ode-eqs .eq-input").forEach(function (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") calculateOde();
      });
    });
  }

  // ==================== ИНИЦИАЛИЗАЦИЯ ====================
  function init() {
    state.N = clampInt($("param-N") && $("param-N").value, 3, 5000, 122);
    state.seed = clampInt($("param-seed") && $("param-seed").value, 0, 9999999, 42);

    VAR_KEYS.forEach(function (key) {
      state.noise[key] = Math.max(0, finiteNumber($("noise-" + key) && $("noise-" + key).value, 0.8));
      state.init[key] = finiteNumber($("init-" + key) && $("init-" + key).value, 0);
    });

    renderModels();
    bindTabs();
    bindModels();
    bindParameters();
    bindMainControls();
    bindFileInput();
    bindOdeControls();
    updateInputModeUi();

    if (window.Numeric) applyOdePreset("lorenz", true);

    refreshAll();

    if (!window.ChartKit) {
      toast("error", "Модуль графиков не загружен", "Проверьте наличие chart.js");
    }
    if (!window.DataIO) {
      toast("warn", "Модуль файлов не загружен", "Загрузка и сохранение данных недоступны");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
