// Движок Рунге–Кутты 4-го порядка для системы трёх дифференциальных уравнений
// x' = f1(t, x, y, z), y' = f2(...), z' = f3(...).
//
// Файл самодостаточный: подключается как обычный <script> (появится window.RK4)
// и как модуль Node (module.exports). Внешних зависимостей нет, eval не используется.
//
// Пример:
//   const result = RK4.integrate({
//     equations: RK4.presets.lorenz.equations,
//     params: { sigma: 10, rho: 28, beta: 8 / 3 },
//     initial: { x: 1, y: 1, z: 1 },
//     dt: 0.005,
//     steps: 2000,
//   });
//   result.series.x[1000]; // значение x на 1000-м шаге
//
// Формулы разбираются собственным рекурсивным парсером (не eval, не Math.js):
// числа (включая 1e-3), переменные x, y, z, t, имена параметров, константы pi и e,
// операции + - * / ^ **, унарный минус, скобки, функции sin/cos/tan/asin/acos/
// atan/exp/ln/log/log10/sqrt/abs/floor/ceil/round.

(function (root) {
  "use strict";

  // Порядок компонент фиксирован и совпадает с порядком в series.
  const COMPONENTS = ["x", "y", "z"];

  // Функции, разрешённые в формулах. ln и log — натуральный логарифм.
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

  const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
  const NAME_RE = /^[A-Za-z_][A-Za-z_0-9]*/;
  const RESERVED_NAMES = new Set(["x", "y", "z", "t", "pi", "e"]);

  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  // Пользователь может вставить символы из другого редактора; приводим их
  // к обычной ASCII-записи до разбора.
  function normalizeExpression(text) {
    return String(text == null ? "" : text)
      .replace(/[−–—]/g, "-")
      .replace(/[×·⋅]/g, "*")
      .replace(/÷/g, "/");
  }

  // Имена, которые разрешено использовать в формуле: всегда x, y, z, t,
  // плюс имена параметров (extraNames — массив, объект или строка через запятую).
  function collectAllowedNames(extraNames) {
    const names = new Set(["x", "y", "z", "t"]);
    if (Array.isArray(extraNames)) {
      extraNames.forEach((name) => names.add(String(name)));
    } else if (extraNames && typeof extraNames === "object") {
      Object.keys(extraNames).forEach((name) => names.add(name));
    } else if (typeof extraNames === "string" && extraNames.trim()) {
      extraNames
        .split(/[\s,]+/)
        .filter(Boolean)
        .forEach((name) => names.add(name));
    }
    return names;
  }

  // Рекурсивный разбор выражения в дерево (AST). Ничего не вычисляет,
  // поэтому validateEquation может проверить формулу без значений переменных.
  function parseExpression(text, extraNames) {
    const s = normalizeExpression(text);
    const allowed = collectAllowedNames(extraNames);
    let pos = 0;

    const skip = () => {
      while (pos < s.length && /\s/.test(s[pos])) pos++;
    };

    const describe = () =>
      pos < s.length ? `«${s[pos]}» (позиция ${pos + 1})` : "конец формулы";

    const fail = (message) => {
      throw new Error(message);
    };

    const expect = (ch) => {
      skip();
      if (s[pos] !== ch) fail(`ожидалось «${ch}», найдено ${describe()}`);
      pos++;
    };

    // expr := term (("+" | "-") term)*
    function parseExpr() {
      let node = parseTerm();
      for (;;) {
        skip();
        const ch = s[pos];
        if (ch !== "+" && ch !== "-") return node;
        pos++;
        node = { type: "binary", op: ch, left: node, right: parseTerm() };
      }
    }

    // term := unary (("*" | "/") unary)*
    function parseTerm() {
      let node = parseUnary();
      for (;;) {
        skip();
        const ch = s[pos];
        if (ch !== "*" && ch !== "/") return node;
        pos++;
        node = { type: "binary", op: ch, left: node, right: parseUnary() };
      }
    }

    // unary := ("+" | "-") unary | power
    function parseUnary() {
      skip();
      const ch = s[pos];
      if (ch === "+" || ch === "-") {
        pos++;
        const arg = parseUnary();
        return ch === "-" ? { type: "unary", op: "-", arg } : arg;
      }
      return parsePower();
    }

    // power := primary (("^" | "**") unary)?
    // Степень правоассоциативна: 2^3^2 = 2^(3^2) = 512, а -t^2 = -(t^2).
    function parsePower() {
      const base = parsePrimary();
      skip();
      if (s.startsWith("**", pos)) {
        pos += 2;
        return { type: "binary", op: "^", left: base, right: parseUnary() };
      }
      if (s[pos] === "^") {
        pos++;
        return { type: "binary", op: "^", left: base, right: parseUnary() };
      }
      return base;
    }

    // primary := число | имя | имя "(" expr ")" | "(" expr ")"
    function parsePrimary() {
      skip();
      if (pos >= s.length) fail("неожиданный конец формулы: выражение не завершено");

      const ch = s[pos];
      if (ch === "(") {
        pos++;
        const node = parseExpr();
        expect(")");
        return node;
      }

      const numberMatch = NUMBER_RE.exec(s.slice(pos));
      if (numberMatch) {
        pos += numberMatch[0].length;
        return { type: "num", value: parseFloat(numberMatch[0]) };
      }

      const nameMatch = NAME_RE.exec(s.slice(pos));
      if (nameMatch) {
        const name = nameMatch[0];
        pos += name.length;
        const lower = name.toLowerCase();

        if (hasOwn(FUNCTIONS, lower)) {
          skip();
          if (s[pos] !== "(") {
            fail(`после функции «${name}» ожидалась «(»`);
          }
          pos++;
          const arg = parseExpr();
          expect(")");
          return { type: "call", name: lower, arg };
        }

        if (lower === "pi") return { type: "num", value: Math.PI };
        if (lower === "e") return { type: "num", value: Math.E };
        if (allowed.has(name)) return { type: "var", name };

        // Отдельная подсказка, если неизвестное имя используется как функция.
        skip();
        if (s[pos] === "(") fail(`неизвестная функция «${name}»`);
        fail(`неизвестное имя «${name}»`);
      }

      fail(`неожиданный символ ${describe()}`);
    }

    skip();
    if (pos >= s.length) fail("формула пуста");
    const ast = parseExpr();
    skip();
    if (pos < s.length) fail(`лишние символы ${describe()}`);
    return ast;
  }

  // Компиляция AST в замыкание env -> number. Вычисление в цикле RK4
  // идёт через эти замыкания, поэтому парсер вызывается один раз на систему,
  // а не на каждом шаге.
  function compileNode(node) {
    switch (node.type) {
      case "num": {
        const value = node.value;
        return () => value;
      }
      case "var": {
        const name = node.name;
        return (env) => env[name];
      }
      case "unary": {
        const arg = compileNode(node.arg);
        return (env) => -arg(env);
      }
      case "binary": {
        const left = compileNode(node.left);
        const right = compileNode(node.right);
        switch (node.op) {
          case "+":
            return (env) => left(env) + right(env);
          case "-":
            return (env) => left(env) - right(env);
          case "*":
            return (env) => left(env) * right(env);
          case "/":
            return (env) => left(env) / right(env);
          default:
            return (env) => Math.pow(left(env), right(env));
        }
      }
      case "call": {
        const fn = FUNCTIONS[node.name];
        const arg = compileNode(node.arg);
        return (env) => fn(arg(env));
      }
      default:
        throw new Error("внутренняя ошибка: неизвестный узел выражения");
    }
  }

  // Пресеты систем. params — то, что показывается/редактируется в интерфейсе,
  // equations — формулы правых частей в синтаксисе парсера.
  const presets = {
    lorenz: {
      id: "lorenz",
      label: "Лоренц",
      params: [
        { key: "sigma", label: "σ", default: 10 },
        { key: "rho", label: "ρ", default: 28 },
        { key: "beta", label: "β", default: 8 / 3 },
      ],
      equations: {
        x: "sigma*(y-x)",
        y: "x*(rho-z)-y",
        z: "x*y-beta*z",
      },
      initial: { x: 1, y: 1, z: 1 },
    },
    rossler: {
      id: "rossler",
      label: "Рёсслер",
      params: [
        { key: "a", label: "a", default: 0.2 },
        { key: "b", label: "b", default: 0.2 },
        { key: "c", label: "c", default: 5.7 },
      ],
      equations: {
        x: "-y-z",
        y: "x+a*y",
        z: "b+z*(x-c)",
      },
      initial: { x: 1, y: 1, z: 1 },
    },
    vanderpol: {
      id: "vanderpol",
      label: "Осциллятор Ван дер Поля",
      params: [{ key: "mu", label: "μ", default: 1 }],
      equations: {
        x: "y",
        y: "mu*(1-x*x)*y-x",
        z: "0",
      },
      initial: { x: 1, y: 0, z: 0 },
    },
  };

  // null — формула корректна; иначе строка с понятной русской ошибкой.
  function validateEquation(text, extraNames) {
    if (typeof text !== "string" || !text.trim()) return "формула пуста";
    try {
      parseExpression(text, extraNames);
      return null;
    } catch (err) {
      return err.message;
    }
  }

  // Все параметры должны быть конечными числами; имена x/y/z/t/pi/e
  // зарезервированы (иначе они перекрыли бы переменные системы).
  function normalizeParams(rawParams) {
    if (rawParams == null) return {};
    if (typeof rawParams !== "object") {
      throw new Error("Параметры params должны быть объектом.");
    }
    const params = {};
    for (const key of Object.keys(rawParams)) {
      if (RESERVED_NAMES.has(key)) {
        throw new Error(`Имя параметра «${key}» зарезервировано.`);
      }
      const value = rawParams[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Параметр «${key}» должен быть конечным числом.`);
      }
      params[key] = value;
    }
    return params;
  }

  function readInitialCondition(initial) {
    if (initial == null || typeof initial !== "object") {
      throw new Error("Не заданы начальные условия initial.");
    }
    return COMPONENTS.map((comp) => {
      const value = initial[comp];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Начальное условие ${comp} должно быть конечным числом.`);
      }
      return value;
    });
  }

  function readStep(dt) {
    if (typeof dt !== "number" || !Number.isFinite(dt)) {
      throw new Error("Шаг dt должен быть конечным числом.");
    }
    if (dt < 1e-6 || dt > 1) {
      throw new Error(`Шаг dt должен быть в диапазоне от 1e-6 до 1 (получено ${dt}).`);
    }
    return dt;
  }

  function readSteps(steps) {
    if (typeof steps !== "number" || !Number.isInteger(steps)) {
      throw new Error("Число шагов steps должно быть целым числом.");
    }
    if (steps < 1 || steps > 200000) {
      throw new Error(`Число шагов steps должно быть от 1 до 200000 (получено ${steps}).`);
    }
    return steps;
  }

  // Система: три формулы -> три скомпилированные функции env -> derivative.
  function compileSystem(equations, paramNames) {
    if (equations == null || typeof equations !== "object") {
      throw new Error("Не задана система уравнений equations.");
    }
    return COMPONENTS.map((comp) => {
      const text = equations[comp];
      if (typeof text !== "string") {
        throw new Error(`Не задано уравнение для ${comp}.`);
      }
      if (!text.trim()) {
        throw new Error(`Уравнение ${comp}: формула пуста.`);
      }
      try {
        return compileNode(parseExpression(text, paramNames));
      } catch (err) {
        throw new Error(`Уравнение ${comp}: ${err.message}`);
      }
    });
  }

  // Интегрирование системы классическим RK4 с постоянным шагом.
  // Возвращает {ok: true, series: {x, y, z}, steps, t}, где ряды длиной steps+1
  // и включают начальную точку; t[i] = i * dt.
  function integrate(options) {
    if (options == null || typeof options !== "object") {
      throw new Error("Не заданы параметры интегрирования.");
    }

    const params = normalizeParams(options.params);
    const paramNames = Object.keys(params);
    const derivatives = compileSystem(options.equations, paramNames);
    const state = readInitialCondition(options.initial);
    const dt = readStep(options.dt);
    const steps = readSteps(options.steps);

    // Единое окружение для всех стадий: поля меняются, объект не пересоздаётся.
    const env = { x: 0, y: 0, z: 0, t: 0 };
    for (const name of paramNames) env[name] = params[name];

    const k1 = [0, 0, 0];
    const k2 = [0, 0, 0];
    const k3 = [0, 0, 0];
    const k4 = [0, 0, 0];
    const half = dt / 2;

    const series = {
      x: new Array(steps + 1),
      y: new Array(steps + 1),
      z: new Array(steps + 1),
    };
    const t = new Array(steps + 1);
    for (let c = 0; c < COMPONENTS.length; c++) {
      series[COMPONENTS[c]][0] = state[c];
    }
    t[0] = 0;

    const setState = (values) => {
      env.x = values[0];
      env.y = values[1];
      env.z = values[2];
    };

    const divergence = (step, comp) =>
      new Error(
        `Решение разошлось на шаге ${step}: компонента ${comp} стала не числом. ` +
          "Уменьшите шаг dt или проверьте начальные условия.",
      );

    for (let i = 0; i < steps; i++) {
      const time = i * dt;
      env.t = time;
      setState(state);

      // K1 = f(t, y)
      for (let c = 0; c < COMPONENTS.length; c++) k1[c] = derivatives[c](env);
      for (let c = 0; c < COMPONENTS.length; c++) {
        if (!Number.isFinite(k1[c])) throw divergence(i + 1, COMPONENTS[c]);
      }

      // K2 = f(t + dt/2, y + dt/2 * K1)
      env.t = time + half;
      setState([
        state[0] + half * k1[0],
        state[1] + half * k1[1],
        state[2] + half * k1[2],
      ]);
      for (let c = 0; c < COMPONENTS.length; c++) k2[c] = derivatives[c](env);
      for (let c = 0; c < COMPONENTS.length; c++) {
        if (!Number.isFinite(k2[c])) throw divergence(i + 1, COMPONENTS[c]);
      }

      // K3 = f(t + dt/2, y + dt/2 * K2)
      setState([
        state[0] + half * k2[0],
        state[1] + half * k2[1],
        state[2] + half * k2[2],
      ]);
      for (let c = 0; c < COMPONENTS.length; c++) k3[c] = derivatives[c](env);
      for (let c = 0; c < COMPONENTS.length; c++) {
        if (!Number.isFinite(k3[c])) throw divergence(i + 1, COMPONENTS[c]);
      }

      // K4 = f(t + dt, y + dt * K3)
      env.t = time + dt;
      setState([
        state[0] + dt * k3[0],
        state[1] + dt * k3[1],
        state[2] + dt * k3[2],
      ]);
      for (let c = 0; c < COMPONENTS.length; c++) k4[c] = derivatives[c](env);
      for (let c = 0; c < COMPONENTS.length; c++) {
        if (!Number.isFinite(k4[c])) throw divergence(i + 1, COMPONENTS[c]);
      }

      // y_{n+1} = y_n + dt * (1/6*K1 + 1/3*K2 + 1/3*K3 + 1/6*K4)
      for (let c = 0; c < COMPONENTS.length; c++) {
        state[c] =
          state[c] +
          (dt / 6) * k1[c] +
          (dt / 3) * k2[c] +
          (dt / 3) * k3[c] +
          (dt / 6) * k4[c];
        if (!Number.isFinite(state[c])) throw divergence(i + 1, COMPONENTS[c]);
        series[COMPONENTS[c]][i + 1] = state[c];
      }
      t[i + 1] = (i + 1) * dt;
    }

    return { ok: true, series, steps, t };
  }

  const RK4 = {
    components: COMPONENTS.slice(),
    presets,
    validateEquation,
    integrate,
  };

  // Экспорт: в браузере — window.RK4, в Node — module.exports.
  if (typeof module !== "undefined" && module.exports) module.exports = RK4;
  if (root) root.RK4 = RK4;
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
