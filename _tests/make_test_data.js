// ============================================================
//  make_test_data.js — генерация тестовых данных для программы.
//  Создаёт data/test_ryad_122.{txt,csv,xlsx} по трём моделям:
//    x_t = 1.2 + 0.85*x_{t-1} + 0.15*y_{t-1} + δWx
//    y_t = 0.4 + 0.30*x_{t-1} + 0.60*y_{t-1} + δWy
//    z_t = 0.2 + 0.30*y_{t-1} + 0.50*z_{t-1} + δWz
//  Запуск: node _tests/make_test_data.js
// ============================================================
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
global.window = global;
require(path.join(projectRoot, "io.js"));
const DataIO = global.DataIO;

const N = 122;
const seed = 42;
const noise = { x: 0.8, y: 0.8, z: 0.8 };

let s = (seed >>> 0) || 1;
function rnd() {
  s |= 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function normal() {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const x = [];
const y = [];
const z = [];
for (let t = 0; t < N; t++) {
  const px = t > 0 ? x[t - 1] : 0;
  const py = t > 0 ? y[t - 1] : 0;
  const pz = t > 0 ? z[t - 1] : 0;
  const xv = 1.2 + 0.85 * px + 0.15 * py + normal() * noise.x;
  const yv = 0.4 + 0.3 * px + 0.6 * py + normal() * noise.y;
  const zv = 0.2 + 0.3 * py + 0.5 * pz + normal() * noise.z;
  x.push(Number(xv.toFixed(4)));
  y.push(Number(yv.toFixed(4)));
  z.push(Number(zv.toFixed(4)));
}

const dataset = {
  headers: ["t", "x", "y", "z"],
  columns: [
    { name: "t", values: Array.from({ length: N }, (_, i) => i) },
    { name: "x", values: x },
    { name: "y", values: y },
    { name: "z", values: z }
  ]
};

(async function main() {
  const dataDir = path.join(projectRoot, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const txt = await DataIO.exportTxt(dataset).text();
  fs.writeFileSync(path.join(dataDir, "test_ryad_122.txt"), txt, "utf8");

  const csv = await DataIO.exportCsv(dataset).text();
  fs.writeFileSync(path.join(dataDir, "test_ryad_122.csv"), csv, "utf8");

  const xlsx = Buffer.from(await DataIO.exportXlsx(dataset).arrayBuffer());
  fs.writeFileSync(path.join(dataDir, "test_ryad_122.xlsx"), xlsx);

  const parsed = DataIO.normalizeSeries(DataIO.parseText(txt));

  console.log("Файлы:");
  console.log("  data/test_ryad_122.txt  ", Buffer.byteLength(txt), "байт");
  console.log("  data/test_ryad_122.csv  ", Buffer.byteLength(csv), "байт");
  console.log("  data/test_ryad_122.xlsx ", xlsx.length, "байт");
  console.log("Строк:", parsed.x.length, "| колонки:", ["x", "y", "z"].filter(function (k) { return parsed[k]; }).join(", "));
  console.log("Первая строка TXT:", txt.split(/\r?\n/)[1]);
  console.log("XLSX round-trip через parseXlsx: проверяется отдельно в io.test.js");
  console.log("Средние: x=" + (x.reduce((a, b) => a + b, 0) / N).toFixed(2) +
    ", y=" + (y.reduce((a, b) => a + b, 0) / N).toFixed(2) +
    ", z=" + (z.reduce((a, b) => a + b, 0) / N).toFixed(2));
})();
