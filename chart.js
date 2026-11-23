/*!
 * chart.js — движок графиков на canvas для проекта «Стохастические временные ряды».
 *
 * Публичный API (глобальный объект window.ChartKit):
 *   ChartKit.line(container, cfg)     -> { update, destroy, toDataURL, resize, setSeriesVisible }
 *   ChartKit.phase3d(container, cfg)  -> { update, destroy, toDataURL, resize, setSeriesVisible }
 *
 * Без внешних зависимостей, без сборки. IIFE + 'use strict', ES2020.
 * Все графики рисуются на canvas: HiDPI, ResizeObserver, анимации, легенда, тултип.
 */
(function (global) {
  'use strict';

  /* ============================== Палитра / шрифт ============================== */

  var FONT_FAMILY = '"Segoe UI", "Inter", system-ui, Arial, sans-serif';

  var COLORS = {
    grid: '#e4f0fb',
    gridStrong: '#cfe3f7',
    axis: '#9db9d6',
    tick: '#58799c',
    text: '#0c2440',
    muted: '#58799c',
    surface: '#ffffff',
    surface2: '#eaf4ff',
    surface3: '#dcefff',
    blue900: '#0b2545',
    blue700: '#1b4f8a',
    blue500: '#2f7fd0',
    border: '#cfe3f7'
  };

  /* Цвета серий по умолчанию (см. палитру в SPEC.md). */
  var SERIES_COLORS = ['#2563eb', '#06b6d4', '#7c3aed', '#f59e0b', '#0ea37a', '#d64550'];

  var ANIM_MS = 450;

  /* ============================== Базовые утилиты ============================== */

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function easeOutCubic(t) {
    t = clamp(t, 0, 1);
    return 1 - Math.pow(1 - t, 3);
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  /** Глубокое слияние настроек: объекты сливаются, массивы заменяются. */
  function deepMerge(base, patch) {
    var out = {};
    var k;
    if (isPlainObject(base)) {
      for (k in base) {
        if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
      }
    }
    if (!isPlainObject(patch)) return out;
    for (k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      var v = patch[k];
      if (v === undefined) continue;
      if (isPlainObject(v) && isPlainObject(base[k])) out[k] = deepMerge(base[k], v);
      else out[k] = v;
    }
    return out;
  }

  function nowMs() {
    return global.performance && global.performance.now ? global.performance.now() : Date.now();
  }

  function setFont(ctx, size, weight) {
    ctx.font = (weight ? weight + ' ' : '') + size + 'px ' + FONT_FAMILY;
  }

  function callFormat(fn, value, fallback) {
    if (typeof fn !== 'function') return fallback == null ? String(value) : String(fallback);
    try {
      var r = fn(value);
      return r == null ? '' : String(r);
    } catch (e) {
      return fallback == null ? String(value) : String(fallback);
    }
  }

  /** Аккуратное число: убирает хвостовые нули, поддерживает экспоненту. */
  function trimNum(v, digits) {
    if (!isFinite(v)) return '—';
    if (v === 0) return '0';
    var a = Math.abs(v);
    var d = digits == null ? 2 : digits;
    if (a < 0.001 || a >= 1e7) {
      return String(v.toExponential(1)).replace('e+', 'e');
    }
    var s = v.toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s;
  }

  /** «Красивое» число: 1/2/5 * 10^n. */
  function niceNum(range, round) {
    if (!(range > 0) || !isFinite(range)) return 1;
    var exp = Math.floor(Math.log10(range));
    var f = range / Math.pow(10, exp);
    var nf;
    if (round) {
      if (f < 1.5) nf = 1;
      else if (f < 3) nf = 2;
      else if (f < 7) nf = 5;
      else nf = 10;
    } else {
      if (f <= 1) nf = 1;
      else if (f <= 2) nf = 2;
      else if (f <= 5) nf = 5;
      else nf = 10;
    }
    return nf * Math.pow(10, exp);
  }

  function cleanFloat(v) {
    if (!isFinite(v)) return 0;
    return parseFloat(v.toPrecision(12));
  }

  /** Круглые деления оси: 4–7 тиков, диапазон расширяется до круглых границ. */
  function niceTicks(min, max, targetCount) {
    targetCount = Math.max(2, targetCount || 6);
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
    if (min > max) {
      var tmp = min;
      min = max;
      max = tmp;
    }
    if (max - min < 1e-12) {
      var pad = Math.abs(min) * 0.1 || 1;
      min -= pad;
      max += pad;
    }
    var step = niceNum((max - min) / (targetCount - 1), true);
    if (!(step > 0) || !isFinite(step)) step = 1;
    var nMin = Math.floor(min / step) * step;
    var nMax = Math.ceil(max / step) * step;
    if ((nMax - nMin) / step > 60) {
      step = niceNum((nMax - nMin) / 10, false);
      nMin = Math.floor(min / step) * step;
      nMax = Math.ceil(max / step) * step;
    }
    var ticks = [];
    var count = Math.round((nMax - nMin) / step);
    for (var i = 0; i <= count; i++) ticks.push(cleanFloat(nMin + i * step));
    return { min: cleanFloat(nMin), max: cleanFloat(nMax), step: step, ticks: ticks };
  }

  /** Соседний «круглый» шаг (1/2/5×10^n): dir=+1 — крупнее, dir=-1 — мельче. */
  function stepAround(step, dir) {
    if (!(step > 0) || !isFinite(step)) return 1;
    var seq = [1, 2, 5, 10];
    var exp = Math.floor(Math.log10(step));
    var f = step / Math.pow(10, exp);
    var best = 0;
    for (var i = 1; i < seq.length; i++) {
      if (Math.abs(seq[i] - f) < Math.abs(seq[best] - f)) best = i;
    }
    var ni = best + (dir > 0 ? 1 : -1);
    var nexp = exp;
    if (ni < 0) {
      ni = 2;
      nexp = exp - 1;
    } else if (ni > 3) {
      ni = 0;
      nexp = exp + 1;
    }
    return seq[ni] * Math.pow(10, nexp);
  }

  /** Деления внутри [lo, hi] с шагом step (границы диапазона не расширяются). */
  function ticksWithin(lo, hi, step) {
    if (!(step > 0) || !isFinite(lo) || !isFinite(hi)) return [];
    var i0 = Math.ceil(lo / step - 1e-9);
    var i1 = Math.floor(hi / step + 1e-9);
    if (i1 - i0 > 40) i1 = i0 + 40;
    var out = [];
    for (var i = i0; i <= i1; i++) out.push(cleanFloat(i * step));
    return out;
  }

  /**
   * План оси: диапазон НЕ расширяется до круглых границ (это и создавало «воздух»),
   * а тики выбираются круглыми и только внутри диапазона. 5–7 подписей.
   */
  function planAxis(lo, hi, intervals) {
    if (!isFinite(lo) || !isFinite(hi)) return { step: 1, ticks: [0, 1] };
    if (hi < lo) {
      var t = lo;
      lo = hi;
      hi = t;
    }
    if (hi - lo < 1e-12) {
      var p = Math.abs(lo) * 0.1 || 1;
      lo -= p;
      hi += p;
    }
    var step = niceNum((hi - lo) / Math.max(2, intervals || 5), true);
    var ticks = ticksWithin(lo, hi, step);
    var guard = 0;
    while (ticks.length < 3 && guard++ < 12) {
      step = stepAround(step, -1);
      ticks = ticksWithin(lo, hi, step);
    }
    guard = 0;
    while (ticks.length > 9 && guard++ < 12) {
      step = stepAround(step, 1);
      ticks = ticksWithin(lo, hi, step);
    }
    return { step: step, ticks: ticks };
  }

  function hexToRgb(hex) {    if (typeof hex !== 'string') return null;
    var h = hex.replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function hexToRgba(hex, alpha) {
    var rgb = hexToRgb(hex);
    if (!rgb) rgb = [47, 127, 208];
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
  }

  function buildPalette(from, to, count) {
    var a = hexToRgb(from) || [56, 189, 248];
    var b = hexToRgb(to) || [29, 78, 216];
    var out = new Array(count);
    for (var i = 0; i < count; i++) {
      var t = count <= 1 ? 0 : i / (count - 1);
      out[i] = [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t)
      ];
    }
    return out;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r == null ? 8 : r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Общий каркас: контейнер -> div + canvas (canvas сам занимает 100% ширины). */
  function makeShell(container, height) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new Error('ChartKit: нужен DOM-элемент контейнера');
    }
    var h = Number(height);
    if (!(h > 0)) h = 380;
    var root = global.document.createElement('div');
    root.className = 'ck-root';
    root.style.position = 'relative';
    root.style.width = '100%';
    root.style.height = h + 'px';
    root.style.overflow = 'hidden';
    var canvas = global.document.createElement('canvas');
    canvas.className = 'ck-canvas';
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    root.appendChild(canvas);
    container.appendChild(root);
    return { root: root, canvas: canvas };
  }

  function removeShell(chart) {
    if (chart.root && chart.root.parentNode) chart.root.parentNode.removeChild(chart.root);
  }

  /** Единое пустое состояние для обоих типов графиков. */
  function drawEmptyState(ctx, w, h, text) {
    var cx = w / 2;
    var cy = h / 2;
    var bw = clamp(w * 0.42, 150, 240);
    var bh = clamp(h * 0.24, 52, 92);
    var bx = cx - bw / 2;
    var by = cy - bh / 2 - 24;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(157,185,214,0.65)';
    roundRect(ctx, bx, by, bw, bh, 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    for (var i = 0; i <= 48; i++) {
      var t = i / 48;
      var px = bx + 16 + t * (bw - 32);
      var py = by + bh / 2 + Math.sin(t * Math.PI * 3.1) * bh * 0.17;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(47,127,208,0.42)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    setFont(ctx, 13.5, 600);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(text || 'Нет данных для отображения'), cx, by + bh + 28);
    ctx.restore();
  }

  function drawHaloText(ctx, text, x, y, size, weight, color) {
    ctx.save();
    setFont(ctx, size, weight);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color || COLORS.tick;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /**
   * Карточка тултипа: белый скруглённый прямоугольник с тенью.
   * rows: [{ color?: '#..', name: 'xₜ', value: '1.23' }]
   */
  function drawTooltipCard(ctx, w, h, mx, my, title, rows) {
    var pad = 12;
    var rowH = 20;
    var dotR = 3.4;
    var i;
    setFont(ctx, 12.5, 700);
    var titleW = ctx.measureText(title).width;
    var maxRowW = 0;
    var prepared = [];
    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      var hasDot = !!row.color;
      setFont(ctx, 12, 500);
      var nameW = ctx.measureText(row.name).width;
      setFont(ctx, 12, 700);
      var valW = ctx.measureText(row.value).width;
      var rowW = (hasDot ? dotR * 2 + 8 : 0) + nameW + 18 + valW;
      if (rowW > maxRowW) maxRowW = rowW;
      prepared.push({ nameW: nameW, valW: valW, hasDot: hasDot });
    }
    var cardW = Math.min(Math.max(titleW, maxRowW) + pad * 2, Math.max(120, w - 16));
    var rowsTop = pad + 22;
    var cardH = rowsTop + rows.length * rowH + pad - 4;
    var x = mx + 18;
    var y = my + 16;
    if (x + cardW > w - 8) x = mx - cardW - 18;
    if (y + cardH > h - 8) y = my - cardH - 16;
    x = clamp(x, 8, Math.max(8, w - cardW - 8));
    y = clamp(y, 8, Math.max(8, h - cardH - 8));

    ctx.save();
    ctx.shadowColor = 'rgba(11,37,69,0.20)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = COLORS.surface;
    roundRect(ctx, x, y, cardW, cardH, 10);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(207,227,247,0.95)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // заголовок
    setFont(ctx, 12.5, 700);
    ctx.fillStyle = COLORS.blue900;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, x + pad, y + pad + 8, cardW - pad * 2);
    // разделитель
    ctx.strokeStyle = '#eef6ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + pad, y + pad + 17.5);
    ctx.lineTo(x + cardW - pad, y + pad + 17.5);
    ctx.stroke();

    // строки
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var p = prepared[i];
      var cy = y + rowsTop + i * rowH + rowH / 2 - 2;
      var lx = x + pad;
      if (p.hasDot) {
        ctx.beginPath();
        ctx.arc(lx + dotR, cy, dotR, 0, Math.PI * 2);
        ctx.fillStyle = r.color;
        ctx.fill();
        lx += dotR * 2 + 8;
      }
      setFont(ctx, 12, 500);
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.name, lx, cy, Math.max(20, x + cardW - pad - 58 - lx));
      setFont(ctx, 12, 700);
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'right';
      ctx.fillText(r.value, x + cardW - pad, cy);
    }
  }

  /* ============================== Общие помощники графиков ============================== */

  /**
   * Точки серии из [[x,y],...], [{x,y},...] или [y,...].
   * preserveOrder=true — порядок сохраняется «как есть» (фазовые портреты, где x немонотонен);
   * иначе точки сортируются по x (обычные временные ряды).
   */
  function normalizePoints(data, preserveOrder) {
    var out = [];
    if (!Array.isArray(data)) return out;
    var sorted = true;
    for (var i = 0; i < data.length; i++) {
      var d = data[i];
      var x;
      var y;
      if (Array.isArray(d)) {
        x = +d[0];
        y = +d[1];
      } else if (d && typeof d === 'object') {
        x = +d.x;
        y = +d.y;
      } else if (typeof d === 'number') {
        x = i;
        y = d;
      } else {
        continue;
      }
      if (!isFinite(x) || !isFinite(y)) continue;
      if (!preserveOrder && out.length && x < out[out.length - 1][0]) sorted = false;
      out.push([x, y]);
    }
    if (!preserveOrder && !sorted) out.sort(function (a, b) { return a[0] - b[0]; });
    return out;
  }

  /** Путь линии с опциональным сглаживанием Catmull-Rom (через кубические Безье). */
  function tracePath(ctx, pts, smooth) {
    if (!pts.length) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) return;
    if (!smooth || pts.length < 3) {
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      return;
    }
    for (var j = 0; j < pts.length - 1; j++) {
      var p0 = pts[j > 0 ? j - 1 : j];
      var p1 = pts[j];
      var p2 = pts[j + 1];
      var p3 = pts[j + 2 < pts.length ? j + 2 : j + 1];
      var c1x = p1.x + (p2.x - p0.x) / 6;
      var c1y = p1.y + (p2.y - p0.y) / 6;
      var c2x = p2.x - (p3.x - p1.x) / 6;
      var c2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
    }
  }

  /** Ближайшая по x точка (список отсортирован по x). */
  function nearestByX(pts, x) {
    var hi = pts.length - 1;
    if (hi < 0) return null;
    var lo = 0;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (pts[mid].vx < x) lo = mid + 1;
      else hi = mid;
    }
    var best = pts[lo];
    var bestD = Math.abs(pts[lo].vx - x);
    if (lo > 0) {
      var d = Math.abs(pts[lo - 1].vx - x);
      if (d < bestD) {
        best = pts[lo - 1];
        bestD = d;
      }
    }
    return best;
  }

  /* ============================== График временных рядов ============================== */

  var LINE_DEFAULTS = {
    height: 380,
    xLabel: 't',
    yLabel: 'значение',
    xFormat: function (v) { return trimNum(v, 2); },
    yFormat: function (v) { return trimNum(v, 2); },
    series: [],
    yZero: false,
    animate: true,
    legend: true,
    tooltip: true,
    grid: { x: true, y: true },
    emptyText: 'Нет данных для отображения',
    background: '#ffffff'
  };

  function LineChart(container, cfg) {
    this.cfg = deepMerge(LINE_DEFAULTS, cfg || {});
    this.visible = {};
    this.progress = 1;
    this.hover = null;
    this._hoverLegend = -1;
    this._drawRaf = 0;
    this._animRaf = 0;
    this._ro = null;
    this._destroyed = false;
    this._geo = null;

    this.shell = makeShell(container, this.cfg.height);
    this.root = this.shell.root;
    this.canvas = this.shell.canvas;
    this.ctx = this.canvas.getContext ? this.canvas.getContext('2d') : null;

    var self = this;
    this._boundMove = function (e) { self._handleMove(e); };
    this._boundLeave = function () { self._handleLeave(); };
    this._boundClick = function (e) { self._handleClick(e); };
    this._boundWinResize = function () { self._onResize(); };

    this.canvas.addEventListener('pointermove', this._boundMove, false);
    this.canvas.addEventListener('pointerleave', this._boundLeave, false);
    this.canvas.addEventListener('click', this._boundClick, false);
    global.addEventListener('resize', this._boundWinResize);
    if (typeof global.ResizeObserver === 'function') {
      this._ro = new global.ResizeObserver(function () { self._onResize(); });
      this._ro.observe(this.root);
    }

    this._measure();
    var layout = this._build();
    if (layout.empty || this.cfg.animate === false) this._draw(1);
    else this._startAnimation();
  }

  LineChart.prototype._measure = function () {
    var h = Number(this.cfg.height);
    if (!(h > 0)) h = 380;
    if (this.root.style.height !== h + 'px') this.root.style.height = h + 'px';
    var w = this.root.clientWidth || 0;
    if (!w && this.root.parentNode) w = this.root.parentNode.clientWidth || 0;
    if (!w) w = 320;
    var dpr = Math.max(1, global.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    var pw = Math.max(1, Math.round(w * dpr));
    var ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
  };

  LineChart.prototype._onResize = function () {
    if (this._destroyed) return;
    var ow = this.w;
    var oh = this.h;
    var odpr = this.dpr;
    this._measure();
    if (this.w !== ow || this.h !== oh || this.dpr !== odpr) {
      this._cancelAnimation();
      this.hover = null;
      this._hoverLegend = -1;
      this.progress = 1;
      this._draw(1);
    }
  };

  LineChart.prototype._startAnimation = function () {
    this._cancelAnimation();
    if (this.cfg.animate === false) {
      this.progress = 1;
      this._draw(1);
      return;
    }
    var self = this;
    var start = nowMs();
    this.progress = 0;
    var tick = function (now) {
      self._animRaf = 0;
      if (self._destroyed) return;
      var t = clamp((now - start) / ANIM_MS, 0, 1);
      self.progress = easeOutCubic(t);
      self._draw(self.progress);
      if (t < 1) self._animRaf = global.requestAnimationFrame(tick);
      else {
        self.progress = 1;
        self._draw(1);
      }
    };
    this._animRaf = global.requestAnimationFrame(tick);
  };

  LineChart.prototype._cancelAnimation = function () {
    if (this._animRaf) {
      global.cancelAnimationFrame(this._animRaf);
      this._animRaf = 0;
    }
  };

  LineChart.prototype._requestDraw = function () {
    if (this._drawRaf || this._destroyed) return;
    var self = this;
    if (typeof global.requestAnimationFrame !== 'function') {
      this._draw(this.progress);
      return;
    }
    this._drawRaf = global.requestAnimationFrame(function () {
      self._drawRaf = 0;
      self._draw(self.progress);
    });
  };

  /** Полный расчёт раскладки: диапазоны, тики, отступы, легенда, пиксельные точки. */
  LineChart.prototype._build = function () {
    var cfg = this.cfg;
    var ctx = this.ctx;
    var w = this.w;
    var h = this.h;
    var raw = Array.isArray(cfg.series) ? cfg.series : [];
    var list = [];
    var xMin = Infinity;
    var xMax = -Infinity;
    var yMin = Infinity;
    var yMax = -Infinity;
    var i;
    var k;

    for (i = 0; i < raw.length; i++) {
      var src = raw[i] || {};
      var preserveOrder = src.preserveOrder === true;
      var pts = normalizePoints(src.data, preserveOrder);
      for (k = 0; k < pts.length; k++) {
        if (pts[k][0] < xMin) xMin = pts[k][0];
        if (pts[k][0] > xMax) xMax = pts[k][0];
        if (pts[k][1] < yMin) yMin = pts[k][1];
        if (pts[k][1] > yMax) yMax = pts[k][1];
      }
      var kind = src.kind === 'area' || src.kind === 'scatter' ? src.kind : 'line';
      list.push({
        index: i,
        name: src.name != null && src.name !== '' ? String(src.name) : 'серия ' + (i + 1),
        color: typeof src.color === 'string' && src.color ? src.color : SERIES_COLORS[i % SERIES_COLORS.length],
        pts: pts,
        kind: kind,
        preserveOrder: preserveOrder,
        width: isNum(src.width) && src.width > 0 ? src.width : 2.6,
        dash: Array.isArray(src.dash) && src.dash.length ? src.dash.slice() : null,
        markers: src.markers === true || kind === 'scatter',
        fillOpacity: isNum(src.fillOpacity) ? clamp(src.fillOpacity, 0, 1) : 0.14,
        // у «сырых» траекторий сглаживание по умолчанию выключено (иначе выбросы)
        smooth: preserveOrder ? src.smooth === true : kind !== 'scatter' && src.smooth !== false,
        hidden: this.visible[i] === false
      });
    }

    var hasData = isFinite(xMin) && isFinite(xMax) && isFinite(yMin) && isFinite(yMax);
    if (!hasData) return { empty: true, series: list };

    // --- диапазоны: данные + небольшой отступ (4–5%), без «воздуха» до круглых границ ---
    var xRangeData = xMax - xMin;
    if (!(xRangeData > 0)) {
      xMin -= 1;
      xMax += 1;
      xRangeData = 2;
    }
    var xPad = xRangeData * 0.02;
    var xLo = xMin - xPad;
    var xHi = xMax + xPad;

    var yRangeData = yMax - yMin;
    if (!(yRangeData > 0)) {
      yMin -= 1;
      yMax += 1;
      yRangeData = 2;
    }
    var yPad = yRangeData * 0.045;
    var yLo;
    var yHi;
    if (cfg.yZero) {
      // 0 включаем, но не «раздуваем» ось за счёт лишнего отступа с нулевой стороны
      yLo = yMin > 0 ? 0 : yMin - yPad;
      yHi = yMax < 0 ? 0 : yMax + yPad;
    } else {
      yLo = yMin - yPad;
      yHi = yMax + yPad;
    }

    // --- тики Y и левый отступ под подписи ---
    var yIntervals = clamp(Math.round((h - 120) / 55), 4, 6);
    var yAxis = planAxis(yLo, yHi, yIntervals);
    yMin = yLo;
    yMax = yHi;
    var yLabels = [];
    var maxYW = 0;
    setFont(ctx, 11.5, 500);
    for (i = 0; i < yAxis.ticks.length; i++) {
      var yl = callFormat(cfg.yFormat, yAxis.ticks[i], trimNum(yAxis.ticks[i], 2));
      yLabels.push(yl);
      var tw = ctx.measureText(yl).width;
      if (tw > maxYW) maxYW = tw;
    }
    var hasYLabel = !!cfg.yLabel;
    var left = Math.max(46, Math.round(maxYW) + (hasYLabel ? 32 : 14));
    if (w < 340) left = Math.min(left, Math.max(34, Math.round(maxYW) + 10));

    // --- тики X; правый отступ под последнюю подпись (два прохода) ---
    var right = 22;
    var xAxis = null;
    for (var pass = 0; pass < 2; pass++) {
      var plotW0 = Math.max(40, w - left - right);
      var xIntervals = clamp(Math.round(plotW0 / 112), 4, 9);
      xAxis = planAxis(xLo, xHi, xIntervals);
      setFont(ctx, 11.5, 500);
      var maxXW = 0;
      for (i = 0; i < xAxis.ticks.length; i++) {
        var xw = ctx.measureText(callFormat(cfg.xFormat, xAxis.ticks[i], trimNum(xAxis.ticks[i], 2))).width;
        if (xw > maxXW) maxXW = xw;
      }
      right = Math.max(18, Math.round(maxXW / 2) + 10);
    }
    xMin = xLo;
    xMax = xHi;

    // --- легенда сверху ---
    var legend = null;
    var legendHeight = 0;
    if (cfg.legend !== false && list.length) {
      legend = buildLegendLayout(ctx, list, Math.max(160, w - 8));
      legendHeight = legend.height;
    }

    var plot = {
      left: left,
      right: Math.max(left + 60, w - right),
      top: legend ? legendHeight + 8 : 16,
      bottom: h - (cfg.xLabel ? 46 : 30)
    };
    if (plot.bottom - plot.top < 46) plot.top = Math.max(8, plot.bottom - 46);
    if (plot.bottom > h - 24) plot.bottom = h - 24;
    if (plot.right - plot.left < 40) plot.left = Math.max(26, plot.right - 40);

    var xSpan = xMax - xMin || 1;
    var ySpan = yMax - yMin || 1;
    var plotW = Math.max(1, plot.right - plot.left);
    var plotH = Math.max(1, plot.bottom - plot.top);
    var xToPx = function (v) { return plot.left + (v - xMin) / xSpan * plotW; };
    var yToPx = function (v) { return plot.bottom - (v - yMin) / ySpan * plotH; };

    var xTicks = { values: xAxis.ticks, labels: [], px: [], widths: [] };
    for (i = 0; i < xAxis.ticks.length; i++) {
      xTicks.labels.push(callFormat(cfg.xFormat, xAxis.ticks[i], trimNum(xAxis.ticks[i], 2)));
      xTicks.px.push(xToPx(xAxis.ticks[i]));
    }
    var yTicks = { values: yAxis.ticks, labels: yLabels, py: [] };
    for (i = 0; i < yAxis.ticks.length; i++) yTicks.py.push(yToPx(yAxis.ticks[i]));

    // пиксельные точки; для отрисовки — прореживание до ~2 точек на пиксель
    // (тултип и легенда продолжают работать по исходным данным)
    var maxDrawPoints = Math.max(80, Math.round(plotW * 2.2));
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      var px = new Array(s.pts.length);
      for (k = 0; k < s.pts.length; k++) {
        px[k] = { x: xToPx(s.pts[k][0]), y: yToPx(s.pts[k][1]), vx: s.pts[k][0], vy: s.pts[k][1] };
      }
      s.px = px;
      if (px.length > maxDrawPoints && px.length > 3) {
        var stride = Math.ceil(px.length / maxDrawPoints);
        var drawPx = [];
        for (k = 0; k < px.length; k += stride) drawPx.push(px[k]);
        if (drawPx[drawPx.length - 1] !== px[px.length - 1]) drawPx.push(px[px.length - 1]);
        s.drawPx = drawPx;
      } else {
        s.drawPx = px;
      }
    }

    return {
      empty: false,
      series: list,
      plot: plot,
      xMin: xMin,
      xMax: xMax,
      yMin: yMin,
      yMax: yMax,
      xToPx: xToPx,
      yToPx: yToPx,
      xTicks: xTicks,
      yTicks: yTicks,
      legend: legend
    };
  };

  function buildLegendLayout(ctx, series, maxWidth) {
    var items = [];
    var x = 2;
    var y = 6;
    var rowH = 26;
    var gap = 8;
    var rowGap = 8;
    var limit = Math.max(120, maxWidth - 4);
    setFont(ctx, 12.5, 600);
    for (var i = 0; i < series.length; i++) {
      var label = series[i].name;
      var tw = ctx.measureText(label).width;
      var pw = 27 + tw + 13;
      if (x > 2 && x + pw > limit) {
        x = 2;
        y += rowH + rowGap;
      }
      items.push({ x: x, y: y, w: pw, h: rowH, i: i, label: label });
      x += pw + gap;
    }
    return { items: items, height: y + rowH + 6 };
  }

  LineChart.prototype._draw = function (progress) {
    if (this._destroyed || !this.ctx || !this.canvas) return;
    var ctx = this.ctx;
    var w = this.w;
    var h = this.h;
    if (!(w > 8) || !(h > 8)) {
      this._measure();
      w = this.w;
      h = this.h;
      if (!(w > 8) || !(h > 8)) return;
    }
    this.progress = progress == null ? 1 : progress;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.cfg.background || COLORS.surface;
    ctx.fillRect(0, 0, w, h);

    var layout = this._build();
    this._geo = layout;
    if (layout.empty) {
      this.hover = null;
      this._hoverLegend = -1;
      drawEmptyState(ctx, w, h, this.cfg.emptyText);
      return;
    }

    this._drawAxes(layout);
    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.plot.left - 1, layout.plot.top - 1,
      layout.plot.right - layout.plot.left + 2, layout.plot.bottom - layout.plot.top + 2);
    ctx.clip();
    this._drawSeries(layout);
    this._drawHover(layout);
    ctx.restore();

    this._drawLegend(layout);
    if (this.hover) this._drawTooltip(layout);
  };

  LineChart.prototype._drawAxes = function (L) {
    var ctx = this.ctx;
    var cfg = this.cfg;
    var plot = L.plot;
    var i;
    var px;
    var py;

    // сетка
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (cfg.grid && cfg.grid.y) {
      for (i = 0; i < L.yTicks.py.length; i++) {
        py = Math.round(L.yTicks.py[i]) + 0.5;
        if (py <= plot.top + 0.5 || py >= plot.bottom - 0.5) continue;
        ctx.moveTo(plot.left, py);
        ctx.lineTo(plot.right, py);
      }
    }
    if (cfg.grid && cfg.grid.x) {
      for (i = 0; i < L.xTicks.px.length; i++) {
        px = Math.round(L.xTicks.px[i]) + 0.5;
        if (px <= plot.left + 0.5 || px >= plot.right - 0.5) continue;
        ctx.moveTo(px, plot.top);
        ctx.lineTo(px, plot.bottom);
      }
    }
    ctx.stroke();
    ctx.restore();

    // нулевая линия
    if (L.yMin < 0 && L.yMax > 0) {
      py = Math.round(L.yToPx(0)) + 0.5;
      ctx.save();
      ctx.strokeStyle = COLORS.gridStrong;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(plot.left, py);
      ctx.lineTo(plot.right, py);
      ctx.stroke();
      ctx.restore();
    }

    // оси
    ctx.save();
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    var ax = Math.round(plot.left) + 0.5;
    ctx.moveTo(ax, plot.top);
    ctx.lineTo(ax, plot.bottom);
    var ay = Math.round(plot.bottom) + 0.5;
    ctx.moveTo(plot.left, ay);
    ctx.lineTo(plot.right, ay);
    ctx.stroke();
    ctx.restore();

    // деления и подписи Y
    ctx.save();
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 0; i < L.yTicks.py.length; i++) {
      py = Math.round(L.yTicks.py[i]) + 0.5;
      ctx.moveTo(plot.left - 4, py);
      ctx.lineTo(plot.left, py);
    }
    ctx.stroke();
    setFont(ctx, 11.5, 500);
    ctx.fillStyle = COLORS.tick;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (i = 0; i < L.yTicks.py.length; i++) {
      ctx.fillText(L.yTicks.labels[i], plot.left - 9, L.yTicks.py[i]);
    }
    ctx.restore();

    // деления X (все тики)
    ctx.save();
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 0; i < L.xTicks.px.length; i++) {
      px = Math.round(L.xTicks.px[i]) + 0.5;
      ctx.moveTo(px, plot.bottom);
      ctx.lineTo(px, plot.bottom + 4);
    }
    ctx.stroke();
    ctx.restore();

    // подписи X с прореживанием
    setFont(ctx, 11.5, 500);
    ctx.fillStyle = COLORS.tick;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var widths = [];
    var maxW = 0;
    for (i = 0; i < L.xTicks.labels.length; i++) {
      var tw = ctx.measureText(L.xTicks.labels[i]).width;
      widths.push(tw);
      if (tw > maxW) maxW = tw;
    }
    var pxArr = L.xTicks.px;
    var spacing = pxArr.length > 1 ? Math.abs(pxArr[pxArr.length - 1] - pxArr[0]) / (pxArr.length - 1) : 0;
    var every = spacing > 0 ? Math.max(1, Math.ceil((maxW + 14) / spacing)) : 1;
    var lastRight = -1e9;
    for (i = 0; i < pxArr.length; i++) {
      var show = i % every === 0 || i === pxArr.length - 1;
      if (!show) continue;
      var half = widths[i] / 2;
      if (pxArr[i] - half < lastRight + 4) continue;
      ctx.fillText(L.xTicks.labels[i], pxArr[i], plot.bottom + 8);
      lastRight = pxArr[i] + half;
    }

    // подписи осей
    if (cfg.xLabel) {
      setFont(ctx, 12, 600);
      ctx.fillStyle = COLORS.blue700;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cfg.xLabel, (plot.left + plot.right) / 2, this.h - 12, plot.right - plot.left);
    }
    if (cfg.yLabel) {
      ctx.save();
      ctx.translate(14, (plot.top + plot.bottom) / 2);
      ctx.rotate(-Math.PI / 2);
      setFont(ctx, 12, 600);
      ctx.fillStyle = COLORS.blue700;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cfg.yLabel, 0, 0);
      ctx.restore();
    }
  };

  LineChart.prototype._drawSeries = function (L) {
    var ctx = this.ctx;
    var plot = L.plot;
    var baseY = plot.bottom;
    var progress = this.progress;
    var list = L.series;
    var i;
    var k;
    var s;
    var pts;

    function animated(s) {
      var src = s.drawPx || s.px;
      // фазовые траектории (preserveOrder) «прорисовываются» по порядку точек
      var count = src.length;
      if (s.preserveOrder && progress < 1) count = Math.max(2, Math.ceil(count * progress));
      var out = new Array(count);
      for (var n = 0; n < count; n++) {
        var p = src[n];
        out[n] = {
          x: p.x,
          y: s.preserveOrder ? p.y : baseY + (p.y - baseY) * progress
        };
      }
      return out;
    }

    // 1) заливки area
    for (i = 0; i < list.length; i++) {
      s = list[i];
      if (s.hidden || s.kind !== 'area' || !s.drawPx.length) continue;
      pts = animated(s);
      var grad = ctx.createLinearGradient(0, plot.top, 0, plot.bottom);
      grad.addColorStop(0, hexToRgba(s.color, s.fillOpacity));
      grad.addColorStop(0.85, hexToRgba(s.color, Math.max(0.012, s.fillOpacity * 0.12)));
      grad.addColorStop(1, hexToRgba(s.color, 0));
      ctx.save();
      ctx.fillStyle = grad;
      ctx.beginPath();
      tracePath(ctx, pts, s.smooth);
      var last = pts[pts.length - 1];
      ctx.lineTo(last.x, baseY);
      ctx.lineTo(pts[0].x, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 2) линии
    for (i = 0; i < list.length; i++) {
      s = list[i];
      if (s.hidden || s.kind === 'scatter' || !s.drawPx.length) continue;
      pts = animated(s);
      ctx.save();
      ctx.beginPath();
      tracePath(ctx, pts, s.smooth);
      ctx.lineWidth = s.width;
      ctx.strokeStyle = s.color;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (s.dash) ctx.setLineDash(s.dash);
      ctx.shadowColor = hexToRgba(s.color, 0.18);
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      ctx.stroke();
      ctx.restore();
      if (pts.length === 1) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, Math.max(2.2, s.width), 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.restore();
      }
    }

    // 3) маркеры
    for (i = 0; i < list.length; i++) {
      s = list[i];
      if (s.hidden || !s.markers || !s.drawPx.length) continue;
      pts = animated(s);
      var scatter = s.kind === 'scatter';
      var r = scatter ? 3.2 : 2.9;
      ctx.save();
      ctx.lineWidth = scatter ? 1.4 : 1.6;
      ctx.strokeStyle = scatter ? '#ffffff' : s.color;
      ctx.fillStyle = scatter ? s.color : '#ffffff';
      for (k = 0; k < pts.length; k++) {
        ctx.beginPath();
        ctx.arc(pts[k].x, pts[k].y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  LineChart.prototype._drawHover = function (L) {
    var hov = this.hover;
    if (!hov) return;
    var ctx = this.ctx;
    var plot = L.plot;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(157,185,214,0.9)';
    ctx.lineWidth = 1;
    var x = Math.round(hov.px) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.bottom);
    ctx.stroke();
    ctx.restore();
    for (var i = 0; i < hov.rows.length; i++) {
      var row = hov.rows[i];
      var px = row.pxX != null ? row.pxX : L.xToPx(row.x);
      var py = row.pxY != null ? row.pxY : L.yToPx(row.y);
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = row.color;
      ctx.stroke();
      ctx.restore();
    }
  };

  LineChart.prototype._drawLegend = function (L) {
    var legend = L.legend;
    if (!legend || !legend.items.length) return;
    var ctx = this.ctx;
    for (var i = 0; i < legend.items.length; i++) {
      var item = legend.items[i];
      var s = L.series[item.i];
      var hover = this._hoverLegend === item.i;
      ctx.save();
      roundRect(ctx, item.x, item.y, item.w, item.h, item.h / 2);
      ctx.fillStyle = s.hidden ? 'rgba(234,244,255,0.55)' : hover ? COLORS.surface3 : COLORS.surface2;
      ctx.fill();
      if (s.hidden) {
        ctx.strokeStyle = 'rgba(207,227,247,0.95)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(item.x + 18, item.y + item.h / 2, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = s.hidden ? hexToRgba(s.color, 0.32) : s.color;
      ctx.fill();
      setFont(ctx, 12.5, 600);
      ctx.fillStyle = s.hidden ? COLORS.muted : COLORS.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.label, item.x + 27, item.y + item.h / 2 + 0.5, item.w - 34);
      ctx.restore();
    }
  };

  LineChart.prototype._drawTooltip = function (L) {
    var hov = this.hover;
    var cfg = this.cfg;
    var rows = [];
    for (var i = 0; i < hov.rows.length; i++) {
      var r = hov.rows[i];
      rows.push({
        color: r.color,
        name: r.name,
        value: callFormat(cfg.yFormat, r.y, trimNum(r.y, 2))
      });
    }
    var xTitle = callFormat(cfg.xFormat, hov.xVal, trimNum(hov.xVal, 2));
    var title = (cfg.xLabel || 't') + ' = ' + xTitle;
    drawTooltipCard(this.ctx, this.w, this.h, hov.mouseX, hov.mouseY, title, rows);
  };

  LineChart.prototype._handleLeave = function () {
    if (this._destroyed) return;
    if (this.hover || this._hoverLegend !== -1) {
      this.hover = null;
      this._hoverLegend = -1;
      this.canvas.style.cursor = 'default';
      this._requestDraw();
    }
  };

  LineChart.prototype._legendIndexAt = function (px, py) {
    var L = this._geo;
    if (!L || L.empty || !L.legend) return -1;
    var items = L.legend.items;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (px >= it.x && px <= it.x + it.w && py >= it.y && py <= it.y + it.h) return it.i;
    }
    return -1;
  };

  LineChart.prototype._handleMove = function (e) {
    if (this._destroyed) return;
    var rect = this.canvas.getBoundingClientRect();
    var px = e.clientX - rect.left;
    var py = e.clientY - rect.top;
    var L = this._geo;
    if (!L || L.empty) {
      this.hover = null;
      this._hoverLegend = -1;
      this.canvas.style.cursor = 'default';
      return;
    }

    var legendIdx = this._legendIndexAt(px, py);
    if (legendIdx !== -1) {
      this._hoverLegend = legendIdx;
      this.hover = null;
      this.canvas.style.cursor = 'pointer';
      this._requestDraw();
      return;
    }
    this._hoverLegend = -1;

    var plot = L.plot;
    var inPlot = px >= plot.left - 2 && px <= plot.right + 2 && py >= plot.top - 2 && py <= plot.bottom + 6;
    var nextHover = null;
    if (inPlot && this.cfg.tooltip !== false) {
      var xVal = L.xMin + (px - plot.left) / Math.max(1, plot.right - plot.left) * (L.xMax - L.xMin);
      var rows = [];
      var best = null;
      var bestDist = Infinity;
      for (var i = 0; i < L.series.length; i++) {
        var s = L.series[i];
        if (s.hidden || !s.px.length) continue;
        var pt = null;
        var d = Infinity;
        if (s.preserveOrder) {
          // траектория с немонотонным x: ищем ближайшую точку по 2D-расстоянию
          var bestD2 = 32 * 32;
          for (var k = 0; k < s.px.length; k++) {
            var cand = s.px[k];
            var ddx = cand.x - px;
            var ddy = cand.y - py;
            var d2 = ddx * ddx + ddy * ddy;
            if (d2 < bestD2) {
              bestD2 = d2;
              pt = cand;
            }
          }
          if (!pt) continue;
          d = Math.sqrt(bestD2);
        } else {
          pt = nearestByX(s.px, xVal);
          if (!pt) continue;
          d = Math.abs(pt.x - px);
        }
        rows.push({ color: s.color, name: s.name, x: pt.vx, y: pt.vy, pxX: pt.x, pxY: pt.y });
        if (d < bestDist) {
          bestDist = d;
          best = pt;
        }
      }
      if (rows.length && best) {
        nextHover = {
          px: best.x,
          mouseX: px,
          mouseY: py,
          xVal: best.vx,
          rows: rows
        };
      }
    }
    this.hover = nextHover;
    this.canvas.style.cursor = nextHover ? 'crosshair' : inPlot ? 'crosshair' : 'default';
    this._requestDraw();
  };

  LineChart.prototype._handleClick = function (e) {
    if (this._destroyed) return;
    var rect = this.canvas.getBoundingClientRect();
    var px = e.clientX - rect.left;
    var py = e.clientY - rect.top;
    var idx = this._legendIndexAt(px, py);
    if (idx === -1) return;
    this.visible[idx] = !(this.visible[idx] === false) ? false : true;
    if (this.hover) this.hover = null;
    this._cancelAnimation();
    this.progress = 1;
    this._draw(1);
  };

  /* --- публичные методы line --- */

  LineChart.prototype.update = function (patch) {
    if (this._destroyed) return;
    this.cfg = deepMerge(this.cfg, patch || {});
    this._measure();
    if (this.cfg.animate === false) {
      this._cancelAnimation();
      this.progress = 1;
      this._draw(1);
    } else {
      this._startAnimation();
    }
  };

  LineChart.prototype.setSeriesVisible = function (index, visible) {
    if (this._destroyed) return;
    if (typeof index !== 'number' || index < 0) return;
    this.visible[index] = visible !== false;
    this._cancelAnimation();
    this.progress = 1;
    this._draw(1);
  };

  LineChart.prototype.resize = function () {
    if (this._destroyed) return;
    this._measure();
    this._cancelAnimation();
    this.progress = 1;
    this._draw(1);
  };

  LineChart.prototype.toDataURL = function () {
    if (this._destroyed) return '';
    this._cancelAnimation();
    this.progress = 1;
    var savedHover = this.hover;
    var savedLegend = this._hoverLegend;
    this.hover = null;
    this._hoverLegend = -1;
    this._draw(1);
    var out = '';
    try {
      out = this.canvas.toDataURL('image/png');
    } finally {
      this.hover = savedHover;
      this._hoverLegend = savedLegend;
      if (savedHover) this._draw(1);
    }
    return out;
  };

  LineChart.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;
    this._cancelAnimation();
    if (this._drawRaf) {
      global.cancelAnimationFrame(this._drawRaf);
      this._drawRaf = 0;
    }
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    global.removeEventListener('resize', this._boundWinResize);
    this.canvas.removeEventListener('pointermove', this._boundMove);
    this.canvas.removeEventListener('pointerleave', this._boundLeave);
    this.canvas.removeEventListener('click', this._boundClick);
    removeShell(this);
    this.ctx = null;
  };

  /* ============================== 3D-фазовый портрет ============================== */

  var PHASE_DEFAULTS = {
    points: [],
    labels: { x: 'x', y: 'y', z: 'z' },
    height: 460,
    autoRotate: true,
    autoRotateSpeed: 0.28,
    animate: true,
    colorFrom: '#38bdf8',
    colorTo: '#1d4ed8',
    axes: true,
    tooltip: false,
    lineWidth: 1.6,
    startYaw: 0.45,
    startPitch: 0.3,
    maxPoints: 3200,
    emptyText: 'Нет данных для отображения',
    background: '#ffffff'
  };

  function PhaseChart(container, cfg) {
    this.cfg = deepMerge(PHASE_DEFAULTS, cfg || {});
    this.yaw = isNum(this.cfg.startYaw) ? this.cfg.startYaw : 0.45;
    this.pitch = isNum(this.cfg.startPitch) ? this.cfg.startPitch : 0.3;
    this.zoom = 1;
    this.dragging = false;
    this._hoverIndex = -1;
    this._hoverMouse = [0, 0];
    this._raf = 0;
    this._lastT = 0;
    this._destroyed = false;
    this._segCache = {};
    this._introStart = nowMs();
    this._introDone = this.cfg.animate === false;
    this._screen = [];
    this.rawPts = [];
    this.pts = [];
    this.n = 0;
    this.ticks = { x: [], y: [], z: [] };
    this.palette = buildPalette(this.cfg.colorFrom, this.cfg.colorTo, 97);

    this.shell = makeShell(container, this.cfg.height);
    this.root = this.shell.root;
    this.canvas = this.shell.canvas;
    this.ctx = this.canvas.getContext ? this.canvas.getContext('2d') : null;
    this.canvas.style.cursor = 'grab';

    var self = this;
    this._boundDown = function (e) { self._handleDown(e); };
    this._boundMove = function (e) { self._handleMove(e); };
    this._boundUp = function (e) { self._handleUp(e); };
    this._boundWheel = function (e) { self._handleWheel(e); };
    this._boundDbl = function () { self._resetView(); };
    this._boundWinResize = function () { self._onResize(); };
    this._boundLeave = function () {
      if (self.dragging) return;
      if (self._hoverIndex !== -1) {
        self._hoverIndex = -1;
        self._renderNow();
      }
    };

    this.canvas.addEventListener('pointerdown', this._boundDown, false);
    this.canvas.addEventListener('pointermove', this._boundMove, false);
    this.canvas.addEventListener('pointerup', this._boundUp, false);
    this.canvas.addEventListener('pointercancel', this._boundUp, false);
    this.canvas.addEventListener('wheel', this._boundWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this._boundDbl, false);
    this.canvas.addEventListener('pointerleave', this._boundLeave, false);
    global.addEventListener('resize', this._boundWinResize);
    if (typeof global.ResizeObserver === 'function') {
      this._ro = new global.ResizeObserver(function () { self._onResize(); });
      this._ro.observe(this.root);
    }

    this._measure();
    this._rebuildData();
    this._kick();
  }

  PhaseChart.prototype._measure = function () {
    var h = Number(this.cfg.height);
    if (!(h > 0)) h = 460;
    if (this.root.style.height !== h + 'px') this.root.style.height = h + 'px';
    var w = this.root.clientWidth || 0;
    if (!w && this.root.parentNode) w = this.root.parentNode.clientWidth || 0;
    if (!w) w = 320;
    var dpr = Math.max(1, global.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    var pw = Math.max(1, Math.round(w * dpr));
    var ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
  };

  PhaseChart.prototype._onResize = function () {
    if (this._destroyed) return;
    var ow = this.w;
    var oh = this.h;
    var odpr = this.dpr;
    this._measure();
    if (this.w !== ow || this.h !== oh || this.dpr !== odpr) {
      this._introDone = true;
      this._hoverIndex = -1;
      this._draw(nowMs());
    }
  };

  /** Нормировка точек в куб [-1,1]^3, тики осей и палитра по времени. */
  PhaseChart.prototype._rebuildData = function () {
    var cfg = this.cfg;
    var raw = Array.isArray(cfg.points) ? cfg.points : [];
    var pts = [];
    var i;
    var j;
    for (i = 0; i < raw.length; i++) {
      var p = raw[i];
      if (!p || p.length < 3) continue;
      var x = +p[0];
      var y = +p[1];
      var z = +p[2];
      if (isFinite(x) && isFinite(y) && isFinite(z)) pts.push([x, y, z]);
    }
    var maxP = isNum(cfg.maxPoints) && cfg.maxPoints >= 200 ? Math.round(cfg.maxPoints) : 3200;
    if (pts.length > maxP) {
      var step = Math.ceil(pts.length / maxP);
      var short = [];
      for (i = 0; i < pts.length; i += step) short.push(pts[i]);
      if (short[short.length - 1] !== pts[pts.length - 1]) short.push(pts[pts.length - 1]);
      pts = short;
    }
    this.rawPts = pts;
    this.n = pts.length;
    this.palette = buildPalette(cfg.colorFrom, cfg.colorTo, 97);
    this._segCache = {};
    this._screen = [];
    this._hoverIndex = -1;
    if (!pts.length) {
      this.pts = [];
      this.ticks = { x: [], y: [], z: [] };
      return;
    }
    var mn = [Infinity, Infinity, Infinity];
    var mx = [-Infinity, -Infinity, -Infinity];
    for (i = 0; i < pts.length; i++) {
      for (j = 0; j < 3; j++) {
        if (pts[i][j] < mn[j]) mn[j] = pts[i][j];
        if (pts[i][j] > mx[j]) mx[j] = pts[i][j];
      }
    }
    var span = [0, 0, 0];
    for (j = 0; j < 3; j++) {
      var d = mx[j] - mn[j];
      if (!(d > 0)) {
        mn[j] -= 0.5;
        mx[j] += 0.5;
        d = 1;
      }
      span[j] = d;
    }
    this.mn = mn;
    this.mx = mx;
    var norm = new Array(pts.length);
    for (i = 0; i < pts.length; i++) {
      norm[i] = [
        (pts[i][0] - mn[0]) / span[0] * 2 - 1,
        (pts[i][1] - mn[1]) / span[1] * 2 - 1,
        (pts[i][2] - mn[2]) / span[2] * 2 - 1
      ];
    }
    this.pts = norm;
    this.ticks = {
      x: normalizedTicks(mn[0], mx[0]),
      y: normalizedTicks(mn[1], mx[1]),
      z: normalizedTicks(mn[2], mx[2])
    };
  };

  /** Внутренние деления оси в нормированных координатах [-1,1]. */
  function normalizedTicks(min, max) {
    var out = [];
    var i;
    if (isFinite(min) && isFinite(max) && max > min) {
      var t = niceTicks(min, max, 4).ticks;
      for (i = 0; i < t.length; i++) {
        var pos = (t[i] - min) / (max - min) * 2 - 1;
        if (pos > -0.999 && pos < 0.999) {
          out.push({ pos: pos, label: trimNum(t[i], 2) });
        }
      }
    }
    if (out.length < 2) {
      out = [];
      var fr = [-0.65, -0.25, 0.25, 0.65];
      for (i = 0; i < fr.length; i++) {
        var v = min + (fr[i] + 1) / 2 * (max - min);
        out.push({ pos: fr[i], label: trimNum(v, 2) });
      }
    }
    return out;
  }

  PhaseChart.prototype._needLoop = function () {
    if (this.dragging) return true;
    if (this.cfg.autoRotate) return true;
    if (!this._introDone && this.cfg.animate !== false) return true;
    return false;
  };

  PhaseChart.prototype._kick = function () {
    if (this._raf || this._destroyed) return;
    var self = this;
    this._lastT = 0;
    var step = function (now) {
      self._raf = 0;
      if (self._destroyed) return;
      if (typeof now !== 'number') now = nowMs();
      var dt = self._lastT ? Math.min(0.06, (now - self._lastT) / 1000) : 0.016;
      self._lastT = now;
      if (self.cfg.autoRotate && !self.dragging) {
        self.yaw += (isNum(self.cfg.autoRotateSpeed) ? self.cfg.autoRotateSpeed : 0.28) * dt;
      }
      self._draw(now);
      if (self._needLoop()) self._raf = global.requestAnimationFrame(step);
      else self._lastT = 0;
    };
    this._raf = global.requestAnimationFrame(step);
  };

  PhaseChart.prototype._renderNow = function () {
    if (this._raf || this._destroyed) return;
    this._draw(nowMs());
  };

  PhaseChart.prototype._resetView = function () {
    this.yaw = isNum(this.cfg.startYaw) ? this.cfg.startYaw : 0.45;
    this.pitch = isNum(this.cfg.startPitch) ? this.cfg.startPitch : 0.3;
    this.zoom = 1;
    this._renderNow();
  };

  PhaseChart.prototype._draw = function (now, forceFinal) {
    if (this._destroyed || !this.ctx || !this.canvas) return;
    var ctx = this.ctx;
    var w = this.w;
    var h = this.h;
    if (!(w > 8) || !(h > 8)) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.cfg.background || COLORS.surface;
    ctx.fillRect(0, 0, w, h);

    var n = this.n;
    if (!this.pts.length || n < 2) {
      drawEmptyState(ctx, w, h, this.cfg.emptyText);
      this._screen = [];
      return;
    }
    if (typeof now !== 'number') now = nowMs();

    // прогресс анимации появления
    var intro = 1;
    if (!forceFinal && this.cfg.animate !== false && !this._introDone) {
      intro = easeOutCubic(clamp((now - this._introStart) / ANIM_MS, 0, 1));
      if (intro >= 1) this._introDone = true;
    }

    var cx = w / 2;
    var D = 6.2;
    var focal = D;
    var yaw = this.yaw;
    var pitch = this.pitch;
    var cyw = Math.cos(yaw);
    var syw = Math.sin(yaw);
    var cp = Math.cos(pitch);
    var sp = Math.sin(pitch);
    var camX = D * cp * syw;
    var camY = -D * cp * cyw;
    var camZ = D * sp;
    var fx = -cp * syw;
    var fy = cp * cyw;
    var fz = -sp;
    var rx = cyw;
    var ry = syw;
    var vx = -syw * sp;
    var vy = cyw * sp;
    var vz = cp;
    var i;
    var j;

    // сырая перспективная проекция (условные пиксели при масштабе 1, начало в центре)
    function rawProject(p) {
      var qx = p[0] - camX;
      var qy = p[1] - camY;
      var qz = p[2] - camZ;
      var depth = qx * fx + qy * fy + qz * fz;
      if (depth < 0.25) depth = 0.25;
      var k = focal / depth;
      var sx = qx * rx + qy * ry;
      var sy = qx * vx + qy * vy + qz * vz;
      return { rx: sx * k, ry: -sy * k, depth: depth };
    }

    // --- авто-подгонка под карточку: bbox спроецированных точек траектории ---
    var combos = [
      [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
    ];
    var marginX = clamp(w * 0.045, 24, 60);
    var marginTop = clamp(h * 0.07, 24, 46);
    var marginBottom = clamp(h * 0.095, 32, 60);
    var availW = Math.max(80, w - marginX * 2);
    var availH = Math.max(80, h - marginTop - marginBottom);
    var minRX = Infinity;
    var minRY = Infinity;
    var maxRX = -Infinity;
    var maxRY = -Infinity;
    var rawPoints = new Array(n);
    for (i = 0; i < n; i++) {
      var rp = rawProject(this.pts[i]);
      rawPoints[i] = rp;
      if (rp.rx < minRX) minRX = rp.rx;
      if (rp.rx > maxRX) maxRX = rp.rx;
      if (rp.ry < minRY) minRY = rp.ry;
      if (rp.ry > maxRY) maxRY = rp.ry;
    }
    var bboxW = (maxRX - minRX) || 1;
    var bboxH = (maxRY - minRY) || 1;
    var baseScale = Math.min(availW / bboxW, availH / bboxH) * this.zoom * (0.94 + 0.06 * intro);
    var bcx = (minRX + maxRX) / 2;
    var bcy = (minRY + maxRY) / 2;
    var areaCx = cx;
    var areaCy = marginTop + availH / 2;
    var cy = areaCy;

    function project(p) {
      var r = rawProject(p);
      return {
        x: areaCx + (r.rx - bcx) * baseScale,
        y: areaCy + (r.ry - bcy) * baseScale,
        depth: r.depth
      };
    }

    // --- рамка ---
    var corners = {};
    var cornerDepth = [];
    for (i = 0; i < combos.length; i++) {
      var pr = project(combos[i]);
      corners[combos[i].join(',')] = pr;
      cornerDepth.push(pr.depth);
    }
    var boxMinD = Math.min.apply(null, cornerDepth);
    var boxMaxD = Math.max.apply(null, cornerDepth);
    var boxSpan = (boxMaxD - boxMinD) || 1;

    // сетка на нижней грани
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(157,185,214,0.18)';
    ctx.beginPath();
    for (i = 0; i < this.ticks.x.length; i++) {
      var g1 = project([this.ticks.x[i].pos, -1, -1]);
      var g2 = project([this.ticks.x[i].pos, 1, -1]);
      ctx.moveTo(g1.x, g1.y);
      ctx.lineTo(g2.x, g2.y);
    }
    for (i = 0; i < this.ticks.y.length; i++) {
      var g3 = project([-1, this.ticks.y[i].pos, -1]);
      var g4 = project([1, this.ticks.y[i].pos, -1]);
      ctx.moveTo(g3.x, g3.y);
      ctx.lineTo(g4.x, g4.y);
    }
    ctx.stroke();
    ctx.restore();

    // рёбра параллелепипеда
    var edges = [
      [[-1, -1, -1], [1, -1, -1]], [[-1, 1, -1], [1, 1, -1]],
      [[-1, -1, 1], [1, -1, 1]], [[-1, 1, 1], [1, 1, 1]],
      [[-1, -1, -1], [-1, 1, -1]], [[1, -1, -1], [1, 1, -1]],
      [[-1, -1, 1], [-1, 1, 1]], [[1, -1, 1], [1, 1, 1]],
      [[-1, -1, -1], [-1, -1, 1]], [[1, -1, -1], [1, -1, 1]],
      [[-1, 1, -1], [-1, 1, 1]], [[1, 1, -1], [1, 1, 1]]
    ];
    ctx.save();
    ctx.lineWidth = 1;
    for (i = 0; i < edges.length; i++) {
      var e1 = corners[edges[i][0].join(',')];
      var e2 = corners[edges[i][1].join(',')];
      var dm = (e1.depth + e2.depth) / 2;
      var at = clamp((boxMaxD - dm) / boxSpan, 0, 1);
      ctx.strokeStyle = 'rgba(157,185,214,' + (0.15 + 0.35 * at).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(e1.x, e1.y);
      ctx.lineTo(e2.x, e2.y);
      ctx.stroke();
    }
    ctx.restore();

    // три оси из угла (-1,-1,-1)
    var corner0 = corners['-1,-1,-1'];
    var axisEnds = [corners['1,-1,-1'], corners['-1,1,-1'], corners['-1,-1,1']];
    ctx.save();
    ctx.strokeStyle = 'rgba(157,185,214,0.85)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (i = 0; i < axisEnds.length; i++) {
      ctx.moveTo(corner0.x, corner0.y);
      ctx.lineTo(axisEnds[i].x, axisEnds[i].y);
    }
    ctx.stroke();
    ctx.restore();

    // --- траектория: проекция, сортировка по глубине, градиент по времени ---
    var P = new Array(n);
    var dMin = Infinity;
    var dMax = -Infinity;
    for (i = 0; i < n; i++) {
      var pp = {
        x: areaCx + (rawPoints[i].rx - bcx) * baseScale,
        y: areaCy + (rawPoints[i].ry - bcy) * baseScale,
        depth: rawPoints[i].depth
      };
      P[i] = pp;
      if (pp.depth < dMin) dMin = pp.depth;
      if (pp.depth > dMax) dMax = pp.depth;
    }
    this._screen = P;

    var segs = new Array(n - 1);
    for (i = 0; i < n - 1; i++) segs[i] = { i: i, d: (P[i].depth + P[i + 1].depth) / 2 };
    segs.sort(function (a, b) { return b.d - a.d; });

    var lw = isNum(this.cfg.lineWidth) && this.cfg.lineWidth > 0 ? this.cfg.lineWidth : 1.6;
    var dSpan = (dMax - dMin) || 1;
    var pal = this.palette;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var k = 0; k < segs.length; k++) {
      var sg = segs[k];
      var a1 = P[sg.i];
      var a2 = P[sg.i + 1];
      var depthT = clamp((dMax - sg.d) / dSpan, 0, 1);
      var band = Math.min(96, Math.floor(((sg.i + 0.5) / (n - 1)) * 97));
      var ai = Math.round((0.25 + 0.75 * depthT) * 32);
      var key = band * 64 + ai;
      var style = this._segCache[key];
      if (!style) {
        var rgb = pal[band] || pal[0];
        style = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (ai / 32).toFixed(3) + ')';
        this._segCache[key] = style;
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = lw * (0.8 + 0.45 * depthT);
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.stroke();
    }
    ctx.restore();

    // начало и конец траектории
    var pFirst = P[0];
    var pLast = P[n - 1];
    ctx.save();
    ctx.beginPath();
    ctx.arc(pLast.x, pLast.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = this.cfg.colorTo;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pFirst.x, pFirst.y, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.cfg.colorFrom;
    ctx.stroke();
    ctx.restore();

    // --- подписи осей и деления ---
    if (this.cfg.axes !== false) this._drawAxes3d(ctx, project, cx, cy, w, h);

    // --- градиентная легенда времени ---
    if (this.cfg.gradientLegend !== false) this._drawGradientLegend(ctx, w, h);

    // --- тултип ---
    if (this.cfg.tooltip && this._hoverIndex >= 0 && this._screen[this._hoverIndex]) {
      var hp = this._screen[this._hoverIndex];
      ctx.save();
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 4.6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = this.cfg.colorTo;
      ctx.stroke();
      ctx.restore();
      var labels = this.cfg.labels || {};
      var rawPoint = this.rawPts[this._hoverIndex] || [0, 0, 0];
      drawTooltipCard(ctx, w, h, this._hoverMouse[0], this._hoverMouse[1],
        'точка ' + (this._hoverIndex + 1) + ' / ' + this.n,
        [
          { color: '#38bdf8', name: labels.x || 'x', value: trimNum(rawPoint[0], 3) },
          { color: '#22b8e6', name: labels.y || 'y', value: trimNum(rawPoint[1], 3) },
          { color: '#1d4ed8', name: labels.z || 'z', value: trimNum(rawPoint[2], 3) }
        ]);
    }
  };

  PhaseChart.prototype._drawAxes3d = function (ctx, project, cx, cy, w, h) {
    var cfg = this.cfg;
    var labels = cfg.labels || {};
    var axes = [
      {
        label: labels.x || 'x',
        ticks: this.ticks.x,
        at: function (pos) { return [pos, -1, -1]; },
        namePos: [0.5, -1, -1]
      },
      {
        label: labels.y || 'y',
        ticks: this.ticks.y,
        at: function (pos) { return [-1, pos, -1]; },
        namePos: [-1, 0.5, -1]
      },
      {
        label: labels.z || 'z',
        ticks: this.ticks.z,
        at: function (pos) { return [-1, -1, pos]; },
        namePos: [-1, -1, 0.5]
      }
    ];
    var i;
    var j;
    for (i = 0; i < axes.length; i++) {
      var axis = axes[i];
      for (j = 0; j < axis.ticks.length; j++) {
        var pt = project(axis.at(axis.ticks[j].pos));
        var dx = pt.x - cx;
        var dy = pt.y - cy;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var ux = dx / len;
        var uy = dy / len;
        ctx.strokeStyle = 'rgba(157,185,214,0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.x + ux * 5, pt.y + uy * 5);
        ctx.stroke();
        var lx = clamp(pt.x + ux * 14, 10, w - 10);
        var ly = clamp(pt.y + uy * 14, 10, h - 10);
        drawHaloText(ctx, axis.ticks[j].label, lx, ly, 9.5, 500, COLORS.tick);
      }
      var np = project(axis.namePos);
      var ndx = np.x - cx;
      var ndy = np.y - cy;
      var nlen = Math.sqrt(ndx * ndx + ndy * ndy) || 1;
      var nx = clamp(np.x + ndx / nlen * 20, 12, w - 12);
      var ny = clamp(np.y + ndy / nlen * 20, 12, h - 12);
      drawHaloText(ctx, axis.label, nx, ny, 11, 700, COLORS.blue700);
    }
  };

  PhaseChart.prototype._drawGradientLegend = function (ctx, w, h) {
    var gw = 92;
    var gh = 6;
    var gx = w - gw - 18;
    var gy = h - 22;
    if (gx < 10 || gy < 10) return;
    var grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
    grad.addColorStop(0, this.cfg.colorFrom);
    grad.addColorStop(1, this.cfg.colorTo);
    ctx.save();
    ctx.fillStyle = grad;
    roundRect(ctx, gx, gy, gw, gh, 3);
    ctx.fill();
    setFont(ctx, 9.5, 500);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('t₀', gx - 6, gy + gh / 2);
    ctx.textAlign = 'left';
    ctx.fillText('t', gx + gw + 6, gy + gh / 2);
    ctx.restore();
  };

  PhaseChart.prototype._handleDown = function (e) {
    if (this._destroyed) return;
    if (e.pointerType === 'mouse' && e.button != null && e.button !== 0) return;
    this.dragging = true;
    this._dragX = e.clientX;
    this._dragY = e.clientY;
    this._hoverIndex = -1;
    this.canvas.style.cursor = 'grabbing';
    if (this.canvas.setPointerCapture && e.pointerId != null) {
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    if (e.preventDefault) e.preventDefault();
    this._kick();
  };

  PhaseChart.prototype._handleMove = function (e) {
    if (this._destroyed) return;
    if (this.dragging) {
      var dx = e.clientX - this._dragX;
      var dy = e.clientY - this._dragY;
      this._dragX = e.clientX;
      this._dragY = e.clientY;
      this.yaw += dx * 0.008;
      this.pitch = clamp(this.pitch - dy * 0.006, -1.35, 1.35);
      this._hoverIndex = -1;
      this._kick();
      return;
    }
    if (this.cfg.tooltip) {
      var rect = this.canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var best = -1;
      var bestD = 16 * 16;
      for (var i = 0; i < this._screen.length; i++) {
        var p = this._screen[i];
        var ddx = p.x - mx;
        var ddy = p.y - my;
        var d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      this._hoverMouse = [mx, my];
      if (best !== this._hoverIndex) {
        this._hoverIndex = best;
        this._renderNow();
      }
    }
  };

  PhaseChart.prototype._handleUp = function (e) {
    if (this._destroyed) return;
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas.style.cursor = 'grab';
    if (this.canvas.releasePointerCapture && e && e.pointerId != null) {
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    this._kick();
  };

  PhaseChart.prototype._handleWheel = function (e) {
    if (this._destroyed) return;
    if (e.preventDefault) e.preventDefault();
    var factor = Math.exp(-e.deltaY * 0.0012);
    this.zoom = clamp(this.zoom * factor, 0.45, 3.5);
    this._renderNow();
  };

  /* --- публичные методы phase3d --- */

  PhaseChart.prototype.update = function (patch) {
    if (this._destroyed) return;
    this.cfg = deepMerge(this.cfg, patch || {});
    this._measure();
    this._rebuildData();
    this._renderNow();
    if (this.cfg.autoRotate) this._kick();
  };

  PhaseChart.prototype.setSeriesVisible = function (index, visible) {
    // У траектории одна серия — метод оставлен для единообразия API.
    if (this._destroyed) return;
    this.hidden = visible === false;
    this._renderNow();
  };

  PhaseChart.prototype.resize = function () {
    if (this._destroyed) return;
    this._measure();
    this._introDone = true;
    this._draw(nowMs());
  };

  PhaseChart.prototype.toDataURL = function () {
    if (this._destroyed) return '';
    this._introDone = true;
    this._draw(nowMs(), true);
    return this.canvas.toDataURL('image/png');
  };

  PhaseChart.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._raf) {
      global.cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    global.removeEventListener('resize', this._boundWinResize);
    this.canvas.removeEventListener('pointerdown', this._boundDown);
    this.canvas.removeEventListener('pointermove', this._boundMove);
    this.canvas.removeEventListener('pointerup', this._boundUp);
    this.canvas.removeEventListener('pointercancel', this._boundUp);
    this.canvas.removeEventListener('wheel', this._boundWheel);
    this.canvas.removeEventListener('dblclick', this._boundDbl);
    this.canvas.removeEventListener('pointerleave', this._boundLeave);
    removeShell(this);
    this.ctx = null;
  };

  /* ============================== Публичный namespace ============================== */

  global.ChartKit = {
    version: '1.0.0',
    line: function (container, cfg) {
      return new LineChart(container, cfg);
    },
    phase3d: function (container, cfg) {
      return new PhaseChart(container, cfg);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
