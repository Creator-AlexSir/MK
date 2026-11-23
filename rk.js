// ============================================================
//  rk.js — численные методы: Рунге–Кутта 4-го порядка, Эйлер,
//  модель Лоренца и произвольные системы дифференциальных уравнений.
//  Глобальный namespace: window.Numeric
// ============================================================
window.Numeric = (function () {
  "use strict";

  // ---------- Пресеты систем ОДУ ----------
  // eqs — правые части dx/dt, dy/dt, dz/dt (могут зависеть от x,y,z,t и параметров)
  const PRESETS = {
    lorenz: {
      key: "lorenz",
      title: "Модель Лоренца",
      subtitle: "Детерминированный хаос, странный аттрактор",
      labels: ["x", "y", "z"],
      eqs: ["sigma * (y - x)", "x * (rho - z) - y", "x * y - beta * z"],
      params: [
        { key: "sigma", label: "σ (Прандтль)", value: 10, min: 0.1, max: 100, step: 0.1 },
        { key: "rho", label: "ρ (Рэлей)", value: 28, min: 0.1, max: 200, step: 0.1 },
        { key: "beta", label: "β (геометрия)", value: 8 / 3, min: 0.1, max: 50, step: 0.01 }
      ],
      state0: [1, 1, 1],
      tMax: 40,
      dt: 0.01
    },
    rossler: {
      key: "rossler",
      title: "Система Рёсслера",
      subtitle: "Хаотический аттрактор-лента",
      labels: ["x", "y", "z"],
      eqs: ["-y - z", "x + alpha * y", "beta + z * (x - gamma)"],
      params: [
        { key: "alpha", label: "α", value: 0.2, min: -10, max: 10, step: 0.01 },
        { key: "beta", label: "β", value: 0.2, min: -10, max: 10, step: 0.01 },
        { key: "gamma", label: "γ", value: 5.7, min: -10, max: 20, step: 0.01 }
      ],
      state0: [1, 1, 0],
      tMax: 120,
      dt: 0.01
    },
    vanderpol: {
      key: "vanderpol",
      title: "Осциллятор Ван дер Поля",
      subtitle: "Предельный цикл (2 уравнения)",
      labels: ["x", "y", "z"],
      eqs: ["y", "mu * (1 - x * x) * y - x", "0"],
      params: [{ key: "mu", label: "μ", value: 1.5, min: 0, max: 20, step: 0.1 }],
      state0: [2, 0, 0],
      tMax: 40,
      dt: 0.01
    },
    custom: {
      key: "custom",
      title: "Своя система",
      subtitle: "Задайте правые части уравнений вручную",
      labels: ["x", "y", "z"],
      eqs: ["-y - z", "x + 0.2 * y", "0.2 + z * (x - 5.7)"],
      params: [
        { key: "sigma", label: "σ", value: 10, min: -100, max: 100, step: 0.1 },
        { key: "rho", label: "ρ", value: 28, min: -100, max: 100, step: 0.1 },
        { key: "beta", label: "β", value: 2.667, min: -100, max: 100, step: 0.01 }
      ],
      state0: [1, 1, 1],
      tMax: 40,
      dt: 0.01
    }
  };

  // ---------- Имена математических функций, которые можно писать в формулах ----------
  const MATH_FNS = [
    "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
    "exp", "sqrt", "abs", "ln", "log", "pow", "min", "max", "floor", "ceil",
    "round", "sign"
  ];

  const RESERVED = new Set([
    "x", "y", "z", "t", "Math", "pi", "e", "PI", "E"
  ]);
  MATH_FNS.forEach(function (f) { RESERVED.add(f); });

  // ---------- Преобразование записи формулы в JavaScript ----------
  function toSafeExpr(expr) {
    let s = String(expr == null ? "" : expr).trim();
    if (!s) return "0";

    s = s.replace(/\bpi\b/gi, "Math.PI");
    s = s.replace(/\bexp\s*\(/g, "Math.exp(");
    s = s.replace(/\bln\s*\(/g, "Math.log(");
    s = s.replace(/\bpow\s*\(/g, "Math.pow(");
    s = s.replace(/\^/g, "**");

    MATH_FNS.forEach(function (fn) {
      if (fn === "ln" || fn === "pow") return; // уже обработаны
      const re = new RegExp("(?<![\\w.])" + fn + "\\s*\\(", "g");
      s = s.replace(re, "Math." + fn + "(");
    });

    // аккуратно: одиночное e -> Math.E (только как отдельный идентификатор)
    s = s.replace(/(?<![\w.])e(?![\w])/g, "Math.E");

    return s;
  }

  // ---------- Поиск имён параметров в выражении ----------
  function extractIdentifiers(expr) {
    const safe = toSafeExpr(expr);
    const re = /[A-Za-z_][A-Za-z0-9_]*/g;
    const found = [];
    let m;
    while ((m = re.exec(safe)) !== null) {
      const name = m[0];
      if (RESERVED.has(name)) continue;
      if (found.indexOf(name) === -1) found.push(name);
    }
    return found;
  }

  // ---------- Компиляция одного уравнения ----------
  function compile(expr, paramNames) {
    const names = (paramNames || []).filter(function (n) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n); });
    const params = names.map(function (n) { return n + " = p[" + JSON.stringify(n) + "]"; }).join(", ");
    const source = (params ? "var " + params + ";\n" : "") + "return (" + toSafeExpr(expr) + ");";

    let fn;
    try {
      fn = new Function("x", "y", "z", "t", "p", source);
    } catch (e) {
      const err = new Error("Не удалось разобрать уравнение: " + expr + " (" + e.message + ")");
      err.userFormula = expr;
      throw err;
    }

    return function (x, y, z, t, p) {
      try {
        const value = fn(x, y, z, t, p || {});
        return typeof value === "number" && isFinite(value) ? value : NaN;
      } catch (e) {
        return NaN;
      }
    };
  }

  // ---------- Компиляция системы уравнений ----------
  // exprs — массив строк (1..3 уравнения). Возвращает f(state, t, params) -> [dx, dy, dz]
  function compileSystem(exprs, paramNames) {
    const list = (exprs || []).map(function (s) { return String(s || "").trim(); });
    const fns = list.map(function (expr) { return compile(expr, paramNames); });
    const count = fns.length;

    return function (state, t, params) {
      const x = state[0] || 0;
      const y = state[1] || 0;
      const z = state[2] || 0;
      const out = new Array(count);
      for (let i = 0; i < count; i++) out[i] = fns[i](x, y, z, t, params);
      return out;
    };
  }

  // ---------- Выход функции в безопасное число ----------
  function safeValue(v) {
    return typeof v === "number" && isFinite(v) ? v : 0;
  }

  // ---------- Метод Рунге–Кутта 4-го порядка ----------
  function rk4(system, state0, t0, t1, dt, params) {
    const n = state0.length;
    const tArr = [];
    const states = [];
    let state = state0.slice();
    let time = t0;

    const span = t1 - t0;
    const steps = Math.max(1, Math.ceil(span / Math.abs(dt || 0.01)));
    const h = span / steps;

    tArr.push(time);
    states.push(state.slice());

    for (let i = 0; i < steps; i++) {
      const k1 = system(state, time, params);

      const y2 = new Array(n);
      for (let j = 0; j < n; j++) y2[j] = safeValue(state[j] + 0.5 * h * k1[j]);
      const k2 = system(y2, time + 0.5 * h, params);

      const y3 = new Array(n);
      for (let j = 0; j < n; j++) y3[j] = safeValue(state[j] + 0.5 * h * k2[j]);
      const k3 = system(y3, time + 0.5 * h, params);

      const y4 = new Array(n);
      for (let j = 0; j < n; j++) y4[j] = safeValue(state[j] + h * k3[j]);
      const k4 = system(y4, time + h, params);

      const next = new Array(n);
      for (let j = 0; j < n; j++) {
        next[j] = safeValue(state[j] + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
      }

      state = next;
      time = t0 + (i + 1) * h;
      tArr.push(time);
      states.push(state.slice());
    }

    return { t: tArr, states: states, steps: steps, dt: h, method: "Рунге–Кутта 4" };
  }

  // ---------- Метод Эйлера (для сравнения) ----------
  function euler(system, state0, t0, t1, dt, params) {
    const n = state0.length;
    const tArr = [];
    const states = [];
    let state = state0.slice();
    let time = t0;

    const span = t1 - t0;
    const steps = Math.max(1, Math.ceil(span / Math.abs(dt || 0.01)));
    const h = span / steps;

    tArr.push(time);
    states.push(state.slice());

    for (let i = 0; i < steps; i++) {
      const k = system(state, time, params);
      const next = new Array(n);
      for (let j = 0; j < n; j++) next[j] = safeValue(state[j] + h * k[j]);
      state = next;
      time = t0 + (i + 1) * h;
      tArr.push(time);
      states.push(state.slice());
    }

    return { t: tArr, states: states, steps: steps, dt: h, method: "Эйлер" };
  }

  // ---------- Единая точка входа ----------
  // opts = { eqs, state0, t0, t1, dt, method: 'rk4'|'euler', params, paramNames }
  function integrate(opts) {
    const cfg = opts || {};
    const eqs = cfg.eqs || [];
    if (!eqs.length) throw new Error("Не задано ни одного уравнения системы");

    const paramNames = cfg.paramNames || Object.keys(cfg.params || {});
    const system = compileSystem(eqs, paramNames);

    const state0 = (cfg.state0 || [0, 0, 0]).slice(0, eqs.length);
    while (state0.length < eqs.length) state0.push(0);

    const t0 = Number.isFinite(cfg.t0) ? cfg.t0 : 0;
    const t1 = Number.isFinite(cfg.t1) ? cfg.t1 : 40;
    const dt = Number.isFinite(cfg.dt) && cfg.dt > 0 ? cfg.dt : 0.01;

    if (!(t1 > t0)) throw new Error("Конечное время должно быть больше начального");
    if ((t1 - t0) / dt > 500000) throw new Error("Слишком много шагов: увеличьте dt или уменьшите время расчёта");

    const started = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const result = cfg.method === "euler"
      ? euler(system, state0, t0, t1, dt, cfg.params)
      : rk4(system, state0, t0, t1, dt, cfg.params);
    const finished = (typeof performance !== "undefined" ? performance.now() : Date.now());

    result.durationMs = Math.max(0, Math.round(finished - started));
    result.eqs = eqs.slice();
    result.params = cfg.params || {};
    return result;
  }

  // ---------- Готовая функция Лоренца ----------
  function lorenzSystem(params) {
    const p = Object.assign({ sigma: 10, rho: 28, beta: 8 / 3 }, params || {});
    return function (state, t) {
      const x = state[0] || 0, y = state[1] || 0, z = state[2] || 0;
      return [
        p.sigma * (y - x),
        x * (p.rho - z) - y,
        x * y - p.beta * z
      ];
    };
  }

  // ---------- Эйлерова дискретизация произвольной ОДУ (для связи с временными рядами) ----------
  function eulerDiscretize(f, state0, n, dt, params) {
    const t1 = dt * (n - 1);
    return euler(f, state0, 0, t1, dt, params);
  }

  return {
    PRESETS: PRESETS,
    toSafeExpr: toSafeExpr,
    extractIdentifiers: extractIdentifiers,
    compile: compile,
    compileSystem: compileSystem,
    rk4: rk4,
    euler: euler,
    integrate: integrate,
    lorenzSystem: lorenzSystem,
    eulerDiscretize: eulerDiscretize
  };
})();
