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
  // степень у ссылки на ряд: x[t-1]^2 -> xₜ₋₁²
  result = result.replace(
    /([xyz])ₜ(₋[₀₁₂₃₄₅₆₇₈₉]+)?\s*(\^|\*\*)\s*(\d+)/g,
    (m, base, lag, _, exp) => `${base}ₜ${lag || ""}${toSuperscriptNumber(exp)}`,
  );
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
      "⁻": "-",
    };
    return s
      .split("")
      .map((ch) => map[ch] || ch)
      .join("");
  };

  let result = displayFormula;
  // степень у ссылки на ряд: xₜ₋₁² -> x[t-1]^2
  result = result.replace(
    /([xyz])ₜ₋([₀₁₂₃₄₅₆₇₈₉]+)([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁻]+)/g,
    (m, p, sub, sup) => `${p}[t-${decodeSub(sub)}]^${decodeSup(sup)}`,
  );
  result = result.replace(
    /([xyz])ₜ([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁻]+)/g,
    (m, p, sup) => `${p}[t]^${decodeSup(sup)}`,
  );
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
    /(\w+|\([^)]+\))([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁻]+)/g,
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

const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

// Разбор и вычисление арифметического выражения без eval.
// Поддерживает + - * / ^ (и **), унарный минус, скобки, функции
// sin/cos/tan/asin/acos/atan/exp/ln/log/log10/sqrt/abs/floor/ceil/round,
// константы pi и e. Имена переменных (t, wt, a0, a1, ...) берутся из vars.
function evalExpression(expr, vars) {
  const s = String(expr);
  let pos = 0;

  const skip = () => {
    while (pos < s.length && /\s/.test(s[pos])) pos++;
  };

  const describe = () => (pos < s.length ? `«${s[pos]}»` : "конец формулы");

  const expect = (ch) => {
    skip();
    if (s[pos] !== ch) throw new Error(`ожидалось «${ch}», найдено ${describe()}`);
    pos++;
  };

  function parseExpr() {
    let value = parseTerm();
    for (;;) {
      skip();
      const ch = s[pos];
      if (ch === "+" || ch === "-") {
        pos++;
        const right = parseTerm();
        value = ch === "+" ? value + right : value - right;
      } else {
        return value;
      }
    }
  }

  function parseTerm() {
    let value = parseUnary();
    for (;;) {
      skip();
      const ch = s[pos];
      if (ch === "*" || ch === "/") {
        pos++;
        const right = parseUnary();
        value = ch === "*" ? value * right : value / right;
      } else {
        return value;
      }
    }
  }

  function parseUnary() {
    skip();
    const ch = s[pos];
    if (ch === "+" || ch === "-") {
      pos++;
      const value = parseUnary();
      return ch === "-" ? -value : value;
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    skip();
    if (s.startsWith("**", pos)) {
      pos += 2;
      return Math.pow(base, parseUnary());
    }
    if (s[pos] === "^") {
      pos++;
      return Math.pow(base, parseUnary());
    }
    return base;
  }

  function parsePrimary() {
    skip();
    const ch = s[pos];
    if (ch === "(") {
      pos++;
      const value = parseExpr();
      expect(")");
      return value;
    }

    const numberMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(pos));
    if (numberMatch) {
      pos += numberMatch[0].length;
      return parseFloat(numberMatch[0]);
    }

    const nameMatch = /^[A-Za-z_][A-Za-z_0-9]*/.exec(s.slice(pos));
    if (nameMatch) {
      const name = nameMatch[0];
      pos += name.length;
      const lower = name.toLowerCase();
      if (FUNCTIONS[lower]) {
        skip();
        expect("(");
        const arg = parseExpr();
        expect(")");
        return FUNCTIONS[lower](arg);
      }
      if (name === "pi" || lower === "pi") return Math.PI;
      if (name === "e" || lower === "e") return Math.E;
      if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
      if (Object.prototype.hasOwnProperty.call(vars, lower)) return vars[lower];
      throw new Error(`неизвестное имя «${name}»`);
    }

    throw new Error(`неожиданный символ ${describe()}`);
  }

  const result = parseExpr();
  skip();
  if (pos < s.length) throw new Error(`лишние символы ${describe()}`);
  return result;
}

// Единая запись символов, которые пользователь может вставить из другого
// редактора: юникод-минус, знаки умножения, готовые надстрочные цифры.
function normalizeFormulaText(text) {
  const superscripts = {
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
    "ⁿ": "n",
    "⁻": "-",
  };
  return String(text || "")
    .replace(/[−–—]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(/\b([XYZ])\s*\[/g, (m, c) => `${c.toLowerCase()}[`)
    .replace(/\[\s*T\s*(?:-\s*(\d+))?\s*\]/g, (m, lag) => `[t${lag ? `-${lag}` : ""}]`)
    .replace(/\bA(\d+)\b/g, "a$1")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁻]+/g, (run) =>
      "^" + run.split("").map((ch) => superscripts[ch] || ch).join(""),
    );
}

// Отрезает левую часть «x[t] =» / «xₜ =», если пользователь ввёл её сам,
// и не трогает формулу, если она начинается сразу с выражения.
function stripEquationPrefix(text, comp) {
  const s = String(text || "").trim();
  if (!s) return "";
  const eq = s.indexOf("=");
  if (eq < 0) return s;
  const lhs = s.slice(0, eq).trim().replace(/\s+/g, "");
  const isModel = new RegExp(`^[xyz](?:\\[t\\]|ₜ)?$`, "i").test(lhs);
  return isModel || lhs === "" ? s.slice(eq + 1).trim() : s;
}

function substituteSeries(expr, t, series) {
  return String(expr).replace(/([xyz])\[t(?:-(\d+))?\]/g, (m, v, lag) => {
    const i = t - (lag ? parseInt(lag) : 0);
    const arr = series[v] || [];
    const value = i >= 0 && i < arr.length && Number.isFinite(arr[i]) ? arr[i] : 0;
    return `(${value})`;
  });
}

// null — формула синтаксически корректна; иначе текст ошибки.
function formulaSyntaxError(comp) {
  const raw = formulas[comp];
  if (!raw || !raw.trim()) return null;
  const substituted = substituteSeries(raw, 3, { x: [1], y: [1], z: [1] });
  const vars = { t: 3, wt: 0 };
  for (const m of substituted.matchAll(/\b(a\d+)\b/g)) vars[m[1]] = 1;
  try {
    evalExpression(substituted, vars);
    return null;
  } catch (err) {
    return err.message;
  }
}

function validateFormulas(comps) {
  for (const c of comps) {
    const error = formulaSyntaxError(c);
    if (error) return { comp: c, message: error };
    const linear = formulaLinearError(c);
    if (linear) return { comp: c, message: linear };
  }
  return null;
}

// МНК оценивает коэффициенты только в линейной по aN модели. Проверяем это
// численно: f(coeffs) должна равняться f(0) + Σ (∂f/∂a_i)·a_i.
function formulaLinearError(comp) {
  const raw = formulas[comp];
  if (!raw) return null;
  const idxs = extractIndices(raw, "a");
  if (!idxs.length) return null;
  const series = {
    x: [0.5, 1.5, 2.5, 3.5],
    y: [0.3, 0.8, 1.3, 1.8],
    z: [0.2, 0.6, 1.0, 1.4],
  };
  const t = 3;
  const zero = {};
  idxs.forEach((i) => (zero[`a${i}`] = 0));
  const base = evaluate(comp, t, zero, series, 0);
  const partial = {};
  for (const i of idxs) {
    const cf = Object.assign({}, zero, { [`a${i}`]: 1 });
    partial[i] = evaluate(comp, t, cf, series, 0) - base;
  }
  const probe = {};
  idxs.forEach((i, k) => (probe[`a${i}`] = 0.37 + 0.11 * k));
  const actual = evaluate(comp, t, probe, series, 0);
  let expected = base;
  for (const i of idxs) expected += partial[i] * probe[`a${i}`];
  const tolerance = 1e-7 * (1 + Math.abs(actual) + Math.abs(expected));
  if (Math.abs(actual - expected) > tolerance) {
    return "формула должна быть линейной по коэффициентам: aN можно умножать на t и на ряды, но нельзя возводить в степень, брать от них функции или перемножать коэффициенты";
  }
  return null;
}

function getNormalRandom() {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function formulaHasNoise(comp) {
  return /\bwt\b/i.test(formulas[comp]);
}

function getActiveComps() {
  const active = new Set(["x"]);
  // Уравнение, которое пользователь уже начал заполнять, не прячем,
  // даже если ссылка на него исчезла из формулы x.
  for (const c of COMPONENTS) if (formulas[c] && formulas[c].trim()) active.add(c);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of Array.from(active)) {
      for (const v of COMPONENTS) {
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
  const raw = formulas[comp];
  if (!raw || !raw.trim()) return 0;
  const expression = substituteSeries(raw, t, series);
  const vars = { t, wt: Number.isFinite(noise) ? noise : 0 };
  for (const m of expression.matchAll(/\b(a\d+)\b/g)) {
    vars[m[1]] = coeffs[m[1]] ?? 0;
  }
  try {
    const value = evalExpression(expression, vars);
    return Number.isFinite(value) ? value : 0;
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

function toNumber(token) {
  let s = String(token).trim();
  if (!s) return NaN;
  s = s.replace(/\s+/g, "").replace(/[−–—]/g, "-");
  // десятичная запятая: «1,5» -> 1.5 (но не «1,200» тысяч)
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  if (/^-?\.\d+$/.test(s) || /^-?\d+\.$/.test(s)) s = s.replace(/^\./, "0.").replace(/\.$/, "");
  return Number(s);
}

function parseNumericList(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  let tokens;
  if (/[;\t]/.test(raw)) tokens = raw.split(/[;\t]+/);
  else tokens = raw.split(/\s+/);
  tokens = tokens.map((token) => token.replace(/^[,;]+|[,;]+$/g, "")).filter(Boolean);
  // «1,2,3» без пробелов — список через запятую; «1,5» — одно число с запятой.
  if (tokens.length === 1) {
    const commas = (tokens[0].match(/,/g) || []).length;
    if (commas > 1 && /^-?\d+(,\d+)+$/.test(tokens[0])) {
      const numbers = tokens[0].split(",").map(toNumber);
      if (numbers.every((v) => Number.isFinite(v))) return numbers;
    }
  }
  return tokens.map(toNumber).filter((v) => Number.isFinite(v));
}

function parseDataBlock(text) {
  const out = emptySeries();
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^([xyz])\s*[:=]\s*(.+)$/i);
    if (!m) continue;
    const comp = m[1].toLowerCase();
    out[comp] = out[comp].concat(parseNumericList(m[2]));
  }
  return out;
}

// Резервный разбор файла с колонками:
// 1 колонка — x; 2 — x, y; 3 — x, y, z; 4 и больше (с t) — первая колонка ось времени.
// Если в шапке первый столбец называется t/time/n, он тоже считается осью времени.
function parseColumnData(text) {
  const out = emptySeries();
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  let hasTimeHeader = false;
  let headerChecked = false;
  const rows = [];
  for (const line of lines) {
    // Сначала пробуем числа: так строки с экспонентой (1e-3) не считаются шапкой.
    const cells = parseNumericList(line);
    if (cells.length) {
      rows.push(cells);
      continue;
    }
    if (!headerChecked) {
      headerChecked = true;
      const tokens = line.split(/[\s,;\t]+/).filter(Boolean);
      hasTimeHeader = /^(t|time|n|index|№|время)$/i.test(tokens[0] || "");
    }
  }
  if (!rows.length) return out;
  const columns = Math.min(...rows.map((row) => row.length));
  if (hasTimeHeader && columns >= 2) {
    out.x = rows.map((row) => row[1]);
    if (columns >= 3) out.y = rows.map((row) => row[2]);
    if (columns >= 4) out.z = rows.map((row) => row[3]);
    return out;
  }
  if (columns <= 1) {
    out.x = rows.map((row) => row[0]);
  } else if (columns === 2) {
    out.x = rows.map((row) => row[0]);
    out.y = rows.map((row) => row[1]);
  } else {
    const offset = columns >= 4 ? 1 : 0;
    out.x = rows.map((row) => row[offset]);
    out.y = rows.map((row) => row[offset + 1]);
    out.z = rows.map((row) => row[offset + 2]);
  }
  return out;
}

function parseAnyData(text) {
  const labeled = parseDataBlock(text);
  if (COMPONENTS.some((c) => labeled[c].length)) {
    return { series: labeled, format: "labeled" };
  }
  const columns = parseColumnData(text);
  if (COMPONENTS.some((c) => columns[c].length)) {
    return { series: columns, format: "columns" };
  }
  return { series: emptySeries(), format: "none" };
}

function maxLag(raw) {
  let m = 0;
  raw.replace(/[xyz]\[t-(\d+)\]/g, (s, l) => {
    m = Math.max(m, parseInt(l));
    return s;
  });
  return m;
}

// Диапазон t, на котором уравнение можно честно вычислить по имеющимся рядам:
// t не меньше максимального лага и не выходит за конец любого используемого ряда
// (иначе МНК молча подставлял бы нули вместо отсутствующих значений).
function equationRange(comp, data) {
  const raw = formulas[comp];
  const own = (data[comp] || []).length;
  if (!raw || !own) return null;
  let end = own - 1;
  for (const m of raw.matchAll(/([xyz])\[t(?:-(\d+))?\]/g)) {
    const lag = m[2] ? parseInt(m[2]) : 0;
    const available = (data[m[1]] || []).length;
    if (!available) return null;
    end = Math.min(end, available - 1 + lag);
  }
  const start = maxLag(raw);
  return end >= start ? { start, end } : null;
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
    const range = equationRange(c, data);
    if (!range) continue;
    for (let t = range.start; t <= range.end; t++) {
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

  // Число степеней свободы для интервала коэффициента берём по уравнению,
  // в которое этот коэффициент входит (уравнения могут быть разной длины).
  const coeffDof = {};
  for (const c of Object.keys(rss)) {
    const d = dofC[c];
    if (!(d > 0)) continue;
    for (const idx of extractIndices(formulas[c], "a")) {
      const key = `a${idx}`;
      if (coeffDof[key] === undefined || d < coeffDof[key]) coeffDof[key] = d;
    }
  }
  const defaultDof = M - K;
  const coeffs = {};
  idxs.forEach((idx, i) => {
    const e = { value: beta[i], lo: null, hi: null };
    const tq = tQuantile(coeffDof[`a${idx}`] ?? defaultDof);
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
  const range = equationRange(comp, data);
  const out = [];
  for (let t = 0; t < n; t++) {
    if (!range || t < range.start || t > range.end) out.push(null);
    else out.push(evaluate(comp, t, cf, data, 0));
  }
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

function seriesToText(series, comps, digits = 4) {
  return comps
    .map((c) => `${c}: ${series[c].map((v) => v.toFixed(digits)).join(", ")}`)
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
  const invalid = validateFormulas(comps);
  if (invalid) {
    setStatus(`Не могу разобрать уравнение ${invalid.comp}: ${invalid.message}.`, true);
    return;
  }
  // Ссылка на ряд, для которого нет уравнения, дала бы молча нулевой ряд.
  const emptyRefs = [];
  for (const c of comps) {
    for (const v of COMPONENTS) {
      if (v !== c && new RegExp(`\\b${v}\\[`).test(formulas[c]) && !formulas[v].trim()) {
        emptyRefs.push(v);
      }
    }
  }
  if (emptyRefs.length) {
    const list = Array.from(new Set(emptyRefs)).join(", ");
    setStatus(
      `В формуле есть ссылка на ${list}, но уравнение для ${list} не заполнено — этот ряд получился бы нулевым. Заполните уравнение ${list}.`,
      true,
    );
    return;
  }
  const n = readN();
  seriesData = generateSeries(comps, n);
  seriesFit = emptySeries();
  estimates = null;

  const text = seriesToText(seriesData, comps);
  // В файл пишем 4 знака, а для расчёта храним ряд точнее.
  dataText = seriesToText(seriesData, comps, 12);

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
  const invalid = validateFormulas(comps);
  if (invalid) {
    setStatus(`Не могу разобрать уравнение ${invalid.comp}: ${invalid.message}.`, true);
    return;
  }

  const parsed = parseAnyData(dataText);
  const data = parsed.series;
  if (!comps.some((c) => data[c].length)) {
    setStatus("Нет данных: выберите файл или нажмите «Сгенерировать».", true);
    return;
  }

  // Если уравнение ссылается на ряд, которого нет в данных, МНК молча
  // подставил бы нули. Лучше явно сказать, чего не хватает.
  const missing = new Set();
  for (const c of comps) {
    for (const v of COMPONENTS) {
      if (new RegExp(`\\b${v}\\[`).test(formulas[c]) && !data[v].length) missing.add(v);
    }
  }
  if (missing.size) {
    setStatus(
      `Нет данных для рядов: ${Array.from(missing).join(", ")}. Загрузите файл, где они есть, или нажмите «Сгенерировать».`,
      true,
    );
    return;
  }

  for (const c of comps) {
    if (!equationRange(c, data)) {
      setStatus(
        `Для уравнения ${c} слишком мало данных: ряд короче, чем требует формула (проверьте длины рядов и лаги).`,
        true,
      );
      return;
    }
  }

  seriesData = data;
  seriesFit = emptySeries();
  estimates = estimateAll(comps, data);
  if (estimates) {
    for (const c of comps) seriesFit[c] = buildFit(c, data);
    const rows = comps.reduce((sum, c) => {
      const range = equationRange(c, data);
      return sum + (range ? range.end - range.start + 1 : 0);
    }, 0);
    setStatus(`Коэффициенты рассчитаны (уравнений: ${comps.length}, строк МНК: ${rows}).`);
  } else {
    setStatus(
      "Не удалось оценить коэффициенты: слишком мало данных или система вырождена. Проверьте, что в каждом уравнении есть независимые коэффициенты (например, свободный член) и что для всех уравнений есть данные.",
      true,
    );
  }
  renderCoeffPanels();
  plotGraph();
}

// Во время набора поле не переформатируем: иначе каретка прыгает, а префикс
// «xₜ = » дублируется и попадает в саму формулу. Красивый вид — по blur/change.
function onFormulaChange(comp) {
  const input = formulaInputs[comp];
  const expression = normalizeFormulaText(stripEquationPrefix(input.value, comp));
  const raw = convertToRawFormula(expression).trim();
  formulas[comp] = raw;
  estimates = null;
  seriesFit = emptySeries();
  refreshUI();
}

function onFormulaCommit(comp) {
  const input = formulaInputs[comp];
  const expression = normalizeFormulaText(stripEquationPrefix(input.value, comp));
  const raw = convertToRawFormula(expression).trim();
  if (raw !== formulas[comp]) {
    formulas[comp] = raw;
    estimates = null;
    seriesFit = emptySeries();
    refreshUI();
  }
  if (!raw) {
    if (input.value !== "") input.value = "";
    return;
  }
  const display = `${comp}ₜ = ${convertToDisplayFormula(raw)}`;
  if (input.value !== display) input.value = display;
}

function onFileChosen() {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  fileNameLabel.textContent = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    dataText = String(reader.result);
    const parsed = parseAnyData(dataText);
    seriesData = parsed.series;
    seriesFit = emptySeries();
    estimates = null;
    const counts = COMPONENTS.filter((c) => seriesData[c].length)
      .map((c) => `${c}: ${seriesData[c].length}`)
      .join(", ");
    const formatNote = parsed.format === "columns" ? " · формат колонок" : "";
    setStatus(
      counts
        ? `Файл загружен (${counts}${formatNote}). Нажмите «Рассчитать».`
        : "В файле не найдено числовых рядов: ожидались строки «x: 1, 2, 3» или колонки чисел.",
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
  formulaInputs[comp].addEventListener("change", () => onFormulaCommit(comp));
  formulaInputs[comp].addEventListener("blur", () => onFormulaCommit(comp));
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
