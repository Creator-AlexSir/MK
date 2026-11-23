// ============================================================
//  browser-check.js — проверка страницы в headless Chrome через CDP:
//  собирает ошибки консоли, делает скриншоты вкладок и сценариев.
//  Запуск: node _tests/browser-check.js
//  Требует Chrome (запускается с --no-sandbox, поэтому нужен полный доступ
//  к системе у процесса node; в песочнице Chrome не стартует).
// ============================================================
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const projectRoot = path.resolve(__dirname, "..");
const outDir = path.resolve(projectRoot, "..", ".tmp", "shots");
const profileDir = path.resolve(projectRoot, "..", ".tmp", "chrome-profile");
const port = 9333 + Math.floor(Math.random() * 200);
const pageUrl = pathToFileURL(path.join(projectRoot, "index.html")).href;

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(profileDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) return resolve(await response.json());
      } catch (e) {
        /* chrome ещё не поднялся */
      }
      if (Date.now() - started > timeoutMs) return reject(new Error("Chrome не ответил: " + url));
      setTimeout(tick, 250);
    };
    tick();
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method) {
        const list = this.listeners.get(message.method) || [];
        list.forEach((callback) => callback(message.params));
      }
    });
  }

  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  on(method, callback) {
    const list = this.listeners.get(method) || [];
    list.push(callback);
    this.listeners.set(method, list);
  }

  waitEvent(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Таймаут события " + method)), timeoutMs || 10000);
      this.on(method, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }
}

(async function main() {
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-crash-reporter",
      "--hide-scrollbars",
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + profileDir,
      "--window-size=1600,1100",
      "about:blank"
    ],
    { stdio: "ignore" }
  );

  const errors = [];
  const warnings = [];
  const checks = {};
  let cdp = null;

  try {
    const version = await waitForHttp("http://127.0.0.1:" + port + "/json/version", 15000);
    console.log("Chrome:", version.Browser);

    const targets = await waitForHttp("http://127.0.0.1:" + port + "/json/list", 8000);
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("Не найден page target");

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    cdp = new Cdp(ws);

    cdp.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails || {};
      const text = details.exception && details.exception.description
        ? details.exception.description
        : details.text;
      errors.push("Исключение: " + text);
    });
    cdp.on("Runtime.consoleAPICalled", (params) => {
      if (params.type !== "error" && params.type !== "warning") return;
      const text = (params.args || [])
        .map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || ""))
        .join(" ");
      if (params.type === "error") errors.push("console.error: " + text);
      else warnings.push("console.warn: " + text);
    });
    cdp.on("Log.entryAdded", (params) => {
      const entry = params.entry || {};
      if (entry.level === "error") errors.push("log: " + entry.text + " " + (entry.url || ""));
      if (entry.level === "warning") warnings.push("log: " + entry.text);
    });

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1600,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false
    });

    const loaded = cdp.waitEvent("Page.loadEventFired", 12000);
    await cdp.send("Page.navigate", { url: pageUrl });
    await loaded;
    await sleep(1600);

    const evaluate = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (result.exceptionDetails) {
        throw new Error("Evaluate: " + (result.exceptionDetails.text || ""));
      }
      return result.result ? result.result.value : undefined;
    };

    const removeToasts = () => evaluate(`(() => {
      document.querySelectorAll('.toast-layer').forEach(n => n.remove());
      return true;
    })()`);

    const screenshot = async (name, clip) => {
      const params = { format: "png", captureBeyondViewport: !clip };
      if (clip) params.clip = Object.assign({ scale: 1 }, clip);
      const result = await cdp.send("Page.captureScreenshot", params);
      const file = path.join(outDir, name + ".png");
      fs.writeFileSync(file, Buffer.from(result.data, "base64"));
      console.log("Скриншот:", file);
    };

    const cardClip = async (selector) => {
      const rect = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
      })()`);
      return rect;
    };

    // ---------- 1. Вкладка «Временные ряды» ----------
    checks.initial = await evaluate(`(() => ({
      canvases: document.querySelectorAll('canvas').length,
      visibleModels: [...document.querySelectorAll('.model-card')].filter(c => !c.classList.contains('is-hidden')).map(c => c.dataset.modelKey),
      kpiMae: document.getElementById('kpi-mae').textContent,
      kpiR2: document.getElementById('kpi-r2').textContent,
      tableRows: document.querySelectorAll('#data-table-wrap tbody tr').length,
      chartSub: document.getElementById('chart-series-sub').textContent,
      phaseSub: document.getElementById('phase-sub').textContent,
      phaseButtonsDisabled: [...document.querySelectorAll('#phase-pair .seg')].map(b => b.dataset.pair + ':' + b.disabled),
      modelInput: document.querySelector('[data-model-input="x"]').value,
      errorsShown: [...document.querySelectorAll('.model-error.is-visible')].map(e => e.textContent),
      hiddenY: document.querySelector('[data-model-key="y"]').classList.contains('is-hidden')
    }))()`);
    await removeToasts();
    await screenshot("01-series");

    // ---------- 1b. Тултип при наведении на график ----------
    const hoverPoint = await evaluate(`(() => {
      const canvas = document.querySelector('#chart-series canvas');
      if (!canvas) return null;
      const r = canvas.getBoundingClientRect();
      return {
        x: r.x + r.width * 0.58,
        y: r.y + r.height * 0.45,
        clip: { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height }
      };
    })()`);
    if (hoverPoint) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: hoverPoint.x,
        y: hoverPoint.y,
        button: "none",
        pointerType: "mouse"
      });
      await sleep(450);
      await screenshot("01b-tooltip", hoverPoint.clip);
      checks.tooltip = await evaluate(`(() => {
        const canvas = document.querySelector('#chart-series canvas');
        return { width: canvas.width, height: canvas.height };
      })()`);
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: 4,
        y: 4,
        button: "none",
        pointerType: "mouse"
      });
    }

    // ---------- 2. Добавляем y в формулу x (должна появиться модель y) ----------
    await evaluate(`(() => {
      const input = document.querySelector('[data-model-input="x"]');
      input.value = 'a0 + a1*x[t-1] + 0.15*y[t-1] + wt';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(1800);
    checks.afterY = await evaluate(`(() => ({
      visibleModels: [...document.querySelectorAll('.model-card')].filter(c => !c.classList.contains('is-hidden')).map(c => c.dataset.modelKey),
      kpiMae: document.getElementById('kpi-mae').textContent,
      yFormula: document.querySelector('[data-model-input="y"]').value,
      coeffRowsY: document.querySelectorAll('[data-coeff-body="y"] tr[data-coeff]').length,
      phaseSub: document.getElementById('phase-sub').textContent,
      phaseButtonsDisabled: [...document.querySelectorAll('#phase-pair .seg')].map(b => b.dataset.pair + ':' + b.disabled),
      xLast: document.querySelector('#data-table-wrap tbody tr:last-child td:last-child').textContent
    }))()`);
    await removeToasts();
    await screenshot("02-model-y");
    let clip = await cardClip('#panel-series .grid-2 .card');
    if (clip) await screenshot("02b-phase", clip);

    // ---------- 3. Ошибочная формула не должна ронять приложение ----------
    const brokenResult = await evaluate(`(() => {
      const input = document.querySelector('[data-model-input="y"]');
      input.value = 'b0 + b1*x[t-1] + ((( wt';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(900);
    checks.brokenFormula = await evaluate(`(() => ({
      hasError: !!document.querySelector('[data-model-error="y"].is-visible'),
      errorText: (document.querySelector('[data-model-error="y"]') || {}).textContent,
      appAlive: !!document.getElementById('chart-series'),
      kpi: document.getElementById('kpi-mae').textContent
    }))()`);
    // возвращаем корректную формулу
    await evaluate(`(() => {
      const input = document.querySelector('[data-model-input="y"]');
      input.value = 'b0 + b1*x[t-1] + b2*y[t-1] + wt';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(900);

    // ---------- 4. Добавляем z модель ----------
    await evaluate(`document.querySelector('#model-add [data-add="z"]').click()`);
    await sleep(1600);
    checks.afterZ = await evaluate(`(() => ({
      visibleModels: [...document.querySelectorAll('.model-card')].filter(c => !c.classList.contains('is-hidden')).map(c => c.dataset.modelKey),
      phaseButtons: [...document.querySelectorAll('#phase-pair .seg')].map(b => b.dataset.pair + ':' + b.disabled),
      zCoeffs: document.querySelectorAll('[data-coeff-body="z"] tr[data-coeff]').length,
      chartSeriesCount: (document.querySelectorAll('#chart-series canvas').length)
    }))()`);
    await removeToasts();
    await screenshot("03-three-models");

    // ---------- 5. Вкладка «Система Лоренца» ----------
    await evaluate(`document.querySelector('[data-tab="lorenz"]').click()`);
    await sleep(2600);
    checks.lorenz = await evaluate(`(() => ({
      canvases: document.querySelectorAll('canvas').length,
      odePoints: document.getElementById('ode-kpi-points').textContent,
      odeMethod: document.getElementById('ode-kpi-method').textContent,
      odeTime: document.getElementById('ode-kpi-time').textContent,
      odeSub: document.getElementById('ode-sub').textContent,
      tableRows: document.querySelectorAll('#ode-table-wrap tbody tr').length,
      equations: [...document.querySelectorAll('.eq-input')].map(i => i.value)
    }))()`);
    await removeToasts();
    await screenshot("04-lorenz");
    checks.geometry = await evaluate(`(() => {
      const info = (sel) => {
        const host = document.querySelector(sel);
        const canvas = host && host.querySelector('canvas');
        const hr = host && host.getBoundingClientRect();
        const cr = canvas && canvas.getBoundingClientRect();
        return {
          host: hr ? { w: Math.round(hr.width), h: Math.round(hr.height) } : null,
          canvas: cr ? { w: Math.round(cr.width), h: Math.round(cr.height), attrW: canvas.width, attrH: canvas.height, style: canvas.getAttribute('style') } : null
        };
      };
      return { dpr: window.devicePixelRatio, series: info('#chart-series'), odeSeries: info('#chart-ode-series'), odePhase: info('#chart-ode-phase') };
    })()`);
    clip = await cardClip('#chart-attractor');
    if (clip) await screenshot("04b-attractor", clip);
    clip = await cardClip('#chart-ode-phase');
    if (clip) await screenshot("04c-ode-phase", clip);

    // ---------- 6. Другой пресет (Рёсслер) ----------
    await evaluate(`(() => {
      const select = document.getElementById('ode-preset');
      select.value = 'rossler';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(500);
    await evaluate(`document.getElementById('btn-ode-calc').click()`);
    await sleep(2200);
    checks.rossler = await evaluate(`(() => ({
      badge: document.getElementById('attractor-badge').textContent,
      points: document.getElementById('ode-kpi-points').textContent,
      time: document.getElementById('ode-kpi-time').textContent,
      firstEquation: document.querySelector('.eq-input').value
    }))()`);
    await removeToasts();
    await screenshot("05-rossler");

    // ---------- 7. Вкладка «Справка» ----------
    await evaluate(`document.querySelector('[data-tab="help"]').click()`);
    await sleep(500);
    await removeToasts();
    await screenshot("06-help");

    // ---------- 8. Загрузка CSV ----------
    await evaluate(`document.querySelector('[data-tab="series"]').click()`);
    await sleep(500);
    const fixture = path.join(__dirname, "fixtures", "data.csv");
    if (fs.existsSync(fixture)) {
      const doc = await cdp.send("DOM.getDocument", { depth: -1 });
      const inputNode = await cdp.send("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: "#file-input"
      });
      if (inputNode.nodeId) {
        await cdp.send("DOM.setFileInputFiles", {
          nodeId: inputNode.nodeId,
          files: [fixture]
        });
        await sleep(2400);
        checks.loadedFile = await evaluate(`(() => ({
          badge: document.getElementById('data-badge').textContent,
          meta: document.getElementById('data-meta-name').textContent,
          tableRows: document.querySelectorAll('#data-table-wrap tbody tr').length,
          chartSub: document.getElementById('chart-series-sub').textContent,
          kpiMae: document.getElementById('kpi-mae').textContent
        }))()`);
        await removeToasts();
        await screenshot("07-loaded-csv");
      }

      // ---------- 8b. Загрузка XLSX ----------
      const xlsxFixture = path.join(__dirname, "fixtures", "data.xlsx");
      if (fs.existsSync(xlsxFixture)) {
        const doc2 = await cdp.send("DOM.getDocument", { depth: -1 });
        const inputNode2 = await cdp.send("DOM.querySelector", {
          nodeId: doc2.root.nodeId,
          selector: "#file-input"
        });
        if (inputNode2.nodeId) {
          await cdp.send("DOM.setFileInputFiles", {
            nodeId: inputNode2.nodeId,
            files: [xlsxFixture]
          });
          await sleep(2400);
          checks.loadedXlsx = await evaluate(`(() => ({
            badge: document.getElementById('data-badge').textContent,
            meta: document.getElementById('data-meta-name').textContent,
            tableRows: document.querySelectorAll('#data-table-wrap tbody tr').length,
            chartSub: document.getElementById('chart-series-sub').textContent
          }))()`);
          await removeToasts();
          await screenshot("07b-loaded-xlsx");
        }
      }
    }

    // ---------- 9. Проверка сохранения (DataIO) ----------
    checks.save = await evaluate(`(() => {
      if (!window.DataIO) return { ok: false, reason: 'нет DataIO' };
      const ds = { headers: ['t','x','y'], columns: [{name:'t', values:[0,1,2]},{name:'x', values:[1.5,2.5,3.5]},{name:'y', values:[0.1,0.2,0.3]}] };
      const out = { ok: true };
      try {
        const csv = window.DataIO.exportCsv(ds);
        const xlsx = window.DataIO.exportXlsx(ds);
        const txt = window.DataIO.exportTxt(ds);
        out.sizes = { csv: csv.size, xlsx: xlsx.size, txt: txt.size };
      } catch (e) { out.ok = false; out.reason = e.message; }
      // кнопки не должны бросать исключений
      try { document.getElementById('btn-save').click(); } catch (e) { out.ok = false; out.reason = 'save click: ' + e.message; }
      try { document.getElementById('btn-save-table').click(); } catch (e) { out.ok = false; out.reason = 'save table: ' + e.message; }
      return out;
    })()`);

    // ---------- 10. Переключение режима Excel ----------
    checks.excelMode = await evaluate(`(() => {
      document.querySelector('#input-mode [data-mode="excel"]').click();
      const input = document.getElementById('file-input');
      return { accept: input.getAttribute('accept'), hint: document.getElementById('file-formats').textContent };
    })()`);

    // ---------- 11. Мобильная проверка вёрстки ----------
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 420,
      height: 900,
      deviceScaleFactor: 1,
      mobile: true
    });
    await sleep(600);
    await removeToasts();
    await screenshot("08-mobile", { x: 0, y: 0, width: 420, height: 900, scale: 1 });
    checks.mobile = await evaluate(`(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      overflow: document.body.scrollWidth > window.innerWidth + 2
    }))()`);

    // ---------- 12. Ошибки ----------
    checks.errors = errors;
    checks.warnings = warnings.slice(0, 20);

    console.log("\n=== ПРОВЕРКИ ===");
    console.log(JSON.stringify(checks, null, 2));
    console.log("\n=== ОШИБКИ (" + errors.length + ") ===");
    errors.forEach((error) => console.log("-", error));
  } catch (e) {
    console.error("FAIL:", e && e.stack ? e.stack : e);
    process.exitCode = 1;
  } finally {
    if (cdp && cdp.ws) {
      try { cdp.ws.close(); } catch (e) { /* ignore */ }
    }
    chrome.kill();
  }
})();
