// Интерактивная 3D-траектория в фазовом пространстве (x, y, z).
// Рисуется на обычном canvas: вращение мышью, масштаб колесом, сброс двойным кликом.
// Внешних библиотек нет; файл самодостаточный (window.RK3D + module.exports).
//
// Использование:
//   const view = new RK3D.Phase3D(canvas);
//   view.setData({ x: [...], y: [...], z: [...] });

(function (root) {
  "use strict";

  const COLORS = { x: "#806edc", y: "#4da74d", z: "#2196f3" };
  const MAX_POINTS = 6000;

  function Phase3D(canvas) {
    this.canvas = canvas;
    this.ctx = null;
    this.data = null;
    this.points = null;
    this.center = [0, 0, 0];
    this.half = 1;
    this.ax = -0.45;
    this.ay = 0.7;
    this.zoom = 1;
    this.width = 0;
    this.height = 0;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    if (!canvas || typeof canvas.getContext !== "function") return;
    this.ctx = canvas.getContext("2d");
    if (!this.ctx) return;
    this.bind();
    this.resize();
  }

  Phase3D.prototype.bind = function () {
    const self = this;
    const canvas = this.canvas;

    canvas.addEventListener("pointerdown", function (event) {
      self.dragging = true;
      self.lastX = event.clientX;
      self.lastY = event.clientY;
      if (canvas.setPointerCapture) {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch (err) {
          /* некоторые браузеры не поддерживают захват — не критично */
        }
      }
      if (event.preventDefault) event.preventDefault();
    });

    canvas.addEventListener("pointermove", function (event) {
      if (!self.dragging) return;
      const dx = event.clientX - self.lastX;
      const dy = event.clientY - self.lastY;
      self.lastX = event.clientX;
      self.lastY = event.clientY;
      self.ay += dx * 0.008;
      self.ax += dy * 0.008;
      self.ax = Math.max(-1.45, Math.min(1.45, self.ax));
      self.draw();
      if (event.preventDefault) event.preventDefault();
    });

    const stopDrag = function (event) {
      self.dragging = false;
      if (canvas.releasePointerCapture) {
        try {
          canvas.releasePointerCapture(event.pointerId);
        } catch (err) {
          /* ignore */
        }
      }
    };
    canvas.addEventListener("pointerup", stopDrag);
    canvas.addEventListener("pointercancel", stopDrag);

    canvas.addEventListener(
      "wheel",
      function (event) {
        if (event.preventDefault) event.preventDefault();
        const factor = Math.exp(-event.deltaY * 0.0012);
        self.zoom = Math.max(0.45, Math.min(3.5, self.zoom * factor));
        self.draw();
      },
      { passive: false },
    );

    canvas.addEventListener("dblclick", function () {
      self.ax = -0.45;
      self.ay = 0.7;
      self.zoom = 1;
      self.draw();
    });

    if (root.addEventListener) {
      root.addEventListener("resize", function () {
        self.resize();
      });
    }
  };

  Phase3D.prototype.resize = function () {
    if (!this.ctx) return;
    let width = 0;
    let height = 0;
    if (this.canvas.getBoundingClientRect) {
      const rect = this.canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
    }
    if (!width) width = this.canvas.clientWidth || 0;
    if (!height) height = this.canvas.clientHeight || 0;
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    const ratio = root.devicePixelRatio || 1;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.draw();
  };

  Phase3D.prototype.setData = function (series) {
    this.data = series;
    this.prepare();
    this.draw();
  };

  Phase3D.prototype.prepare = function () {
    const series = this.data;
    this.points = null;
    this.center = [0, 0, 0];
    this.min = [0, 0, 0];
    this.max = [0, 0, 0];
    this.half = 1;
    if (!series || !series.x || !series.x.length) return;

    const n = series.x.length;
    const stride = Math.max(1, Math.ceil(n / MAX_POINTS));
    const points = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = series.x[i];
      const y = series.y[i];
      const z = series.z[i];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      if (i % stride === 0 || i === n - 1) points.push([x, y, z]);
    }
    if (!points.length) return;
    this.points = points;
    this.min = [minX, minY, minZ];
    this.max = [maxX, maxY, maxZ];
    this.center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    this.half = Math.max((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2, 1e-9);
  };

  // Точка угла куба: signs — по ±1 на каждую ось.
  Phase3D.prototype.cornerPoint = function (signs) {
    return [
      this.center[0] + signs[0] * this.half,
      this.center[1] + signs[1] * this.half,
      this.center[2] + signs[2] * this.half,
    ];
  };

  // Компактная подпись деления: без лишних нулей.
  Phase3D.prototype.formatTick = function (value, span) {
    let digits = 0;
    if (span < 0.01) digits = 4;
    else if (span < 0.1) digits = 3;
    else if (span < 1) digits = 2;
    else if (span < 10) digits = 1;
    const rounded = Number(value.toFixed(digits));
    return String(rounded === 0 ? 0 : rounded);
  };

  Phase3D.prototype.project = function (point) {
    const px = (point[0] - this.center[0]) / this.half;
    const py = (point[1] - this.center[1]) / this.half;
    const pz = (point[2] - this.center[2]) / this.half;

    // поворот вокруг вертикальной оси (Y), затем вокруг горизонтальной (X)
    const cosY = Math.cos(this.ay);
    const sinY = Math.sin(this.ay);
    const x1 = px * cosY + pz * sinY;
    const z1 = -px * sinY + pz * cosY;

    const cosX = Math.cos(this.ax);
    const sinX = Math.sin(this.ax);
    const y2 = py * cosX - z1 * sinX;
    const z2 = py * sinX + z1 * cosX;

    // лёгкая перспектива, чтобы объём читался
    const perspective = 3.2 / (3.2 + z2 * 0.55);
    const scale = Math.min(this.width, this.height) * 0.36 * this.zoom;
    return [
      this.width / 2 + x1 * scale * perspective,
      this.height / 2 - y2 * scale * perspective,
    ];
  };

  Phase3D.prototype.draw = function () {
    const ctx = this.ctx;
    if (!ctx) return;
    const width = this.width;
    const height = this.height;
    ctx.clearRect(0, 0, width, height);
    if (!this.points || this.points.length < 2) {
      ctx.fillStyle = "#a0a7b6";
      ctx.font = '15px "Century Gothic", Cambria, serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Нажмите «Рассчитать», чтобы увидеть траекторию", width / 2, height / 2);
      return;
    }

    // куб в реальных координатах данных (а не в условных ±1) — 12 рёбер
    const signs = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ];
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
    const cornerScreens = signs.map((sign) => this.project(this.cornerPoint(sign)));

    ctx.strokeStyle = "#e4e9f2";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const edge of edges) {
      ctx.moveTo(cornerScreens[edge[0]][0], cornerScreens[edge[0]][1]);
      ctx.lineTo(cornerScreens[edge[1]][0], cornerScreens[edge[1]][1]);
    }
    ctx.stroke();

    // Оси жёстко привязаны к одному углу куба (минимумы по x, y, z):
    // при вращении они не перескакивают на другой угол, картинка не «прыгает».
    const originSigns = [-1, -1, -1];

    const axisMeta = [
      { dim: 0, color: COLORS.x, label: "x" },
      { dim: 1, color: COLORS.y, label: "y" },
      { dim: 2, color: COLORS.z, label: "z" },
    ];
    const axisLabels = [];
    const centerScreen = this.project([this.center[0], this.center[1], this.center[2]]);

    ctx.font = '15px "Century Gothic", Cambria, serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const axis of axisMeta) {
      const dim = axis.dim;
      const span = this.max[dim] - this.min[dim];
      const hasSpan = span > 1e-12;
      const cornerDims = [
        this.center[0] + originSigns[0] * this.half,
        this.center[1] + originSigns[1] * this.half,
        this.center[2] + originSigns[2] * this.half,
      ];
      const pointFor = (value) => [
        dim === 0 ? value : cornerDims[0],
        dim === 1 ? value : cornerDims[1],
        dim === 2 ? value : cornerDims[2],
      ];
      const startValue = hasSpan ? this.min[dim] : this.center[dim];
      const endValue = hasSpan ? this.max[dim] : this.center[dim];
      const startScreen = this.project(pointFor(startValue));
      const endScreen = this.project(pointFor(endValue));

      if (hasSpan) {
        ctx.strokeStyle = axis.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(startScreen[0], startScreen[1]);
        ctx.lineTo(endScreen[0], endScreen[1]);
        ctx.stroke();
      }

      let dx = endScreen[0] - startScreen[0];
      let dy = endScreen[1] - startScreen[1];
      let length = Math.hypot(dx, dy);
      if (length < 1e-6) {
        dx = startScreen[0] - centerScreen[0];
        dy = startScreen[1] - centerScreen[1];
        length = Math.hypot(dx, dy) || 1;
      }
      const ux = dx / length;
      const uy = dy / length;
      let px = -uy;
      let py = ux;
      // перпендикуляр направляем наружу от центра куба
      const midX = (startScreen[0] + endScreen[0]) / 2;
      const midY = (startScreen[1] + endScreen[1]) / 2;
      if ((midX - centerScreen[0]) * px + (midY - centerScreen[1]) * py < 0) {
        px = -px;
        py = -py;
      }

      // деления и подписи значений вдоль оси
      const fractions = hasSpan ? [0, 0.5, 1] : [0.5];
      for (const fraction of fractions) {
        const value = startValue + (endValue - startValue) * fraction;
        const tick = this.project(pointFor(value));
        if (hasSpan) {
          ctx.strokeStyle = axis.color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(tick[0] - px * 4, tick[1] - py * 4);
          ctx.lineTo(tick[0] + px * 4, tick[1] + py * 4);
          ctx.stroke();
        }
        axisLabels.push({
          text: this.formatTick(value, span),
          x: tick[0] + px * 13,
          y: tick[1] + py * 13,
          color: "#6b7488",
          title: false,
        });
      }

      // название оси — за концом
      const titleBase = hasSpan ? endScreen : startScreen;
      axisLabels.push({
        text: axis.label,
        x: titleBase[0] + ux * 16 + px * 4,
        y: titleBase[1] + uy * 16 + py * 4,
        color: axis.color,
        title: true,
      });
    }

    // сама траектория
    ctx.strokeStyle = "rgba(86, 122, 196, 0.9)";
    ctx.lineWidth = 1.3;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    for (const point of this.points) {
      const screen = this.project(point);
      if (!started) {
        ctx.moveTo(screen[0], screen[1]);
        started = true;
      } else {
        ctx.lineTo(screen[0], screen[1]);
      }
    }
    ctx.stroke();

    // начало и текущий конец — чтобы понимать направление движения
    const start = this.project(this.points[0]);
    const end = this.project(this.points[this.points.length - 1]);
    ctx.fillStyle = "#4da74d";
    ctx.beginPath();
    ctx.arc(start[0], start[1], 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff9800";
    ctx.beginPath();
    ctx.arc(end[0], end[1], 3.5, 0, Math.PI * 2);
    ctx.fill();

    // подписи осей и делений рисуем последними, чтобы они были читаемы
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const label of axisLabels) {
      ctx.font = label.title
        ? 'bold 15px "Century Gothic", Cambria, serif'
        : '15px "Century Gothic", Cambria, serif';
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, label.x, label.y);
    }
  };

  const RK3D = { Phase3D: Phase3D };

  if (typeof module !== "undefined" && module.exports) module.exports = RK3D;
  if (root) root.RK3D = RK3D;
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
