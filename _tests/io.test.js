/* io.test.js — самопроверка модуля MK-main/io.js без браузера.
   Запуск:  node _tests/io.test.js
   Успех:   печатает "ALL TESTS PASSED" и завершается с кодом 0. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');

// --- Загружаем io.js как классический скрипт (он сам вешает себя на globalThis).
const ioSource = fs.readFileSync(path.join(ROOT, 'io.js'), 'utf8');
new Function(ioSource)();

const DataIO = globalThis.DataIO;
assert.ok(DataIO, 'io.js не выставил globalThis.DataIO');
const internals = DataIO._internal;

// --- Мини-раннер ------------------------------------------------------------
let passed = 0;
const failures = [];
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name));
}

function readFixtureText(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function assertNumbers(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: длина`);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) < 1e-12,
      `${label}[${i}]: ${actual[i]} != ${expected[i]}`);
  }
}

function columnByName(parsed, name) {
  const col = parsed.columns.find((c) => c.name === name);
  assert.ok(col, `нет колонки ${name}`);
  return col.values;
}

// Разбор ZIP вручную через node:zlib — независимая проверка экспорта.
function inspectZip(buf) {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'EOCD не найден');
  const count = dv.getUint16(eocd + 10, true);
  let cd = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let n = 0; n < count; n++) {
    assert.equal(dv.getUint32(cd, true), 0x02014b50, 'сигнатура центрального каталога');
    const method = dv.getUint16(cd + 10, true);
    const crc = dv.getUint32(cd + 16, true);
    const csize = dv.getUint32(cd + 20, true);
    const usize = dv.getUint32(cd + 24, true);
    const nlen = dv.getUint16(cd + 28, true);
    const elen = dv.getUint16(cd + 30, true);
    const clen = dv.getUint16(cd + 32, true);
    const localOffset = dv.getUint32(cd + 42, true);
    const name = Buffer.from(bytes.subarray(cd + 46, cd + 46 + nlen)).toString('utf8');
    assert.equal(dv.getUint32(localOffset, true), 0x04034b50, 'сигнатура локального заголовка');
    const lnlen = dv.getUint16(localOffset + 26, true);
    const lelen = dv.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lnlen + lelen;
    const raw = bytes.subarray(start, start + csize);
    let payload;
    if (method === 0) payload = raw;
    else if (method === 8) payload = zlib.inflateRawSync(raw);
    else throw new Error('неизвестный метод сжатия: ' + method);
    entries.push({ name, method, crc, usize, payload: Buffer.from(payload) });
    cd += 46 + nlen + elen + clen;
  }
  return entries;
}

// ============================================================================
// 1. parseText: CSV с запятой
// ============================================================================
test('parseCsv: data.csv — запятая, шапка t,x,y,z, мусорная строка', () => {
  const parsed = DataIO.parseCsv(readFixtureText('data.csv'));
  assert.deepEqual(parsed.headers, ['t', 'x', 'y', 'z']);
  assert.equal(parsed.columns.length, 4);
  assert.deepEqual(parsed.columns.map((c) => c.name), ['t', 'x', 'y', 'z']);
  assertNumbers(columnByName(parsed, 't'), [0, 1, 2, 3, 4], 't');
  assertNumbers(columnByName(parsed, 'x'), [1.25, 2.375, 3.5, 4.125, 5], 'x');
  assertNumbers(columnByName(parsed, 'y'), [0.5, 1.1, 1.9, 2.4, 3], 'y');
  assertNumbers(columnByName(parsed, 'z'), [-1, -0.75, 0.25, 1.5, 2.75], 'z');
  assert.equal(parsed.skipped, 1);
  assert.ok(parsed.warnings.some((w) => w.includes('Пропущено строк: 1')), 'warnings о пропуске');
  assert.equal(parsed.meta.delimiter, ',');
  assert.equal(parsed.meta.decimalComma, false);
});

// ============================================================================
// 2. parseText: ';' + десятичная запятая
// ============================================================================
test('parseText: data_semicolon.csv — ";" и десятичная запятая', () => {
  const parsed = DataIO.parseText(readFixtureText('data_semicolon.csv'));
  assert.deepEqual(parsed.headers, ['t', 'x', 'y', 'z']);
  assertNumbers(columnByName(parsed, 'x'), [1.25, 2.375, 3.5, 4.125, 5], 'x');
  assertNumbers(columnByName(parsed, 'y'), [0.5, 1.1, 1.9, 2.4, 3], 'y');
  assertNumbers(columnByName(parsed, 'z'), [-1, -0.75, 0.25, 1.5, 2.75], 'z');
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.meta.delimiter, ';');
  assert.equal(parsed.meta.decimalComma, true);
});

// ============================================================================
// 3. parseText: пробелы (TXT)
// ============================================================================
test('parseText: data.txt — пробелы, шапка, мусорная строка', () => {
  const parsed = DataIO.parseText(readFixtureText('data.txt'));
  assert.deepEqual(parsed.headers, ['t', 'x', 'y', 'z']);
  assertNumbers(columnByName(parsed, 'x'), [1.5, 2.5, 3.5, 4.5, 5.5], 'x');
  assertNumbers(columnByName(parsed, 'y'), [2.5, 3.5, 4.5, 5.5, 6.5], 'y');
  assertNumbers(columnByName(parsed, 'z'), [3.5, 4.5, 5.5, 6.5, 7.5], 'z');
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.meta.delimiter, 'space');
});

// ============================================================================
// 4. parseText: табуляция + десятичная запятая
// ============================================================================
test('parseText: табуляция + десятичная запятая', () => {
  const parsed = DataIO.parseText('t\tx\n0\t1,5\n1\t2,5\n2\t3,5\n');
  assert.deepEqual(parsed.headers, ['t', 'x']);
  assertNumbers(columnByName(parsed, 'x'), [1.5, 2.5, 3.5], 'x');
  assert.equal(parsed.meta.delimiter, 'tab');
  assert.equal(parsed.meta.decimalComma, true);
});

// ============================================================================
// 5. parseText: без шапки, 3 колонки -> x,y,z
// ============================================================================
test('parseText: без шапки — 3 колонки получают имена x,y,z', () => {
  const parsed = DataIO.parseText('1 2 3\n4 5 6\n');
  assert.equal(parsed.headers, null);
  assert.deepEqual(parsed.columns.map((c) => c.name), ['x', 'y', 'z']);
  assertNumbers(columnByName(parsed, 'x'), [1, 4], 'x');
  assertNumbers(columnByName(parsed, 'z'), [3, 6], 'z');
});

// ============================================================================
// 6. Одна колонка
// ============================================================================
test('parseText: одна колонка (по числу на строку)', () => {
  const parsed = DataIO.parseText('1.5\n2.5\n3.5\n');
  assert.equal(parsed.columns.length, 1);
  assert.equal(parsed.columns[0].name, 'x');
  assertNumbers(parsed.columns[0].values, [1.5, 2.5, 3.5], 'x');
});

// ============================================================================
// 7. Варианты шапки: x_t, y_t, x[t]; t / time / n
// ============================================================================
test('parseText: шапка x_t;y_t распознаётся', () => {
  const parsed = DataIO.parseText('x_t;y_t\n1;2\n3;4\n');
  assert.deepEqual(parsed.headers, ['x_t', 'y_t']);
  assertNumbers(columnByName(parsed, 'x_t'), [1, 3], 'x_t');
});

test('parseText: шапка x[t],y[t],z[t] распознаётся', () => {
  const parsed = DataIO.parseText('x[t];y[t];z[t]\n1;2;3\n4;5;6\n');
  assert.deepEqual(parsed.headers, ['x[t]', 'y[t]', 'z[t]']);
});

test('parseText: шапка t,time,n распознаётся как ось времени', () => {
  for (const head of ['t', 'time', 'n']) {
    const parsed = DataIO.parseText(`${head};x\n0;1,5\n1;2,5\n`);
    assert.deepEqual(parsed.headers, [head, 'x'], `шапка ${head}`);
  }
});

// ============================================================================
// 8. CSV в кавычках
// ============================================================================
test('parseText: CSV с кавычками', () => {
  const parsed = DataIO.parseText('"t","x","y"\n"0","1.5","-2"\n"1","2.5","-3"\n');
  assert.deepEqual(parsed.headers, ['t', 'x', 'y']);
  assertNumbers(columnByName(parsed, 'x'), [1.5, 2.5], 'x');
});

// ============================================================================
// 9. Ошибки и вырожденные случаи
// ============================================================================
test('parseText: пустой ввод — ошибка', () => {
  assert.throws(() => DataIO.parseText('   \n\n'), /Файл пуст/);
});

test('parseText: только текст -> колонок нет, warnings, skipped', () => {
  const parsed = DataIO.parseText('привет\nмир\n');
  assert.equal(parsed.columns.length, 0);
  assert.equal(parsed.skipped, 2);
  assert.ok(parsed.warnings.some((w) => w.includes('Числовые данные не найдены')));
});

test('parseText: короткая строка пропускается со счётчиком', () => {
  const parsed = DataIO.parseText('t;x;y\n0;1;2\n3;4\n');
  assert.equal(parsed.skipped, 1);
  assert.ok(parsed.warnings.some((w) => w.includes('не хватает колонок')));
  assertNumbers(columnByName(parsed, 'x'), [1], 'x');
});

test('parseText: лишние колонки игнорируются с предупреждением', () => {
  const parsed = DataIO.parseText('t;x;y\n0;1;2;3\n');
  assert.equal(parsed.skipped, 0);
  assert.ok(parsed.warnings.some((w) => w.includes('больше колонок')));
  assertNumbers(columnByName(parsed, 'y'), [2], 'y');
});

// ============================================================================
// 10. parseNumber (внутренний, но контрактно важный)
// ============================================================================
test('parseNumber: запятая/точка, разряды, экспонента, мусор', () => {
  const pn = internals.parseNumber;
  assert.equal(pn('1,23', true), 1.23);
  assert.equal(pn('1.234,56', true), 1234.56);
  assert.equal(pn('1,234.56', false), 1234.56);
  assert.equal(pn('1234.56', false), 1234.56);
  assert.equal(pn('-0.5', false), -0.5);
  assert.equal(pn('1e3', false), 1000);
  assert.equal(pn(' 12 ', false), 12);
  assert.equal(pn('1 234', false), 1234);
  assert.ok(Number.isNaN(pn('1,23', false)), 'запятая не число при разделителе ","');
  assert.ok(Number.isNaN(pn('—', false)));
  assert.ok(Number.isNaN(pn('', false)));
});

// ============================================================================
// 11. normalizeSeries
// ============================================================================
test('normalizeSeries: 4 колонки t,x,y,z — t становится осью X', () => {
  const parsed = DataIO.parseCsv(readFixtureText('data.csv'));
  const norm = DataIO.normalizeSeries(parsed);
  assertNumbers(norm.index, [0, 1, 2, 3, 4], 'index');
  assertNumbers(norm.x, [1.25, 2.375, 3.5, 4.125, 5], 'x');
  assertNumbers(norm.y, [0.5, 1.1, 1.9, 2.4, 3], 'y');
  assertNumbers(norm.z, [-1, -0.75, 0.25, 1.5, 2.75], 'z');
  assert.equal(norm.name, 'x/y/z');
});

test('normalizeSeries: 1 колонка -> x, индекс 0..n-1', () => {
  const norm = DataIO.normalizeSeries(DataIO.parseText('1.5\n2.5\n3.5\n'));
  assertNumbers(norm.x, [1.5, 2.5, 3.5], 'x');
  assert.equal(norm.y.length, 0);
  assert.equal(norm.z.length, 0);
  assertNumbers(norm.index, [0, 1, 2], 'index');
});

test('normalizeSeries: 2 колонки -> x,y', () => {
  const norm = DataIO.normalizeSeries(DataIO.parseText('1 2\n3 4\n'));
  assertNumbers(norm.x, [1, 3], 'x');
  assertNumbers(norm.y, [2, 4], 'y');
  assert.equal(norm.z.length, 0);
});

test('normalizeSeries: 3 колонки -> x,y,z', () => {
  const norm = DataIO.normalizeSeries(DataIO.parseText('1;2;3\n4;5;6\n'));
  assertNumbers(norm.x, [1, 4], 'x');
  assertNumbers(norm.y, [2, 5], 'y');
  assertNumbers(norm.z, [3, 6], 'z');
  assertNumbers(norm.index, [0, 1], 'index');
});

test('normalizeSeries: 4 колонки без шапки, монотонный 1..N -> ось X', () => {
  const norm = DataIO.normalizeSeries(DataIO.parseText('1 10 20 30\n2 11 21 31\n3 12 22 32\n'));
  assertNumbers(norm.index, [1, 2, 3], 'index');
  assertNumbers(norm.x, [10, 11, 12], 'x');
  assertNumbers(norm.y, [20, 21, 22], 'y');
  assertNumbers(norm.z, [30, 31, 32], 'z');
  assert.ok(norm.warnings.some((w) => w.includes('ось времени')));
});

test('normalizeSeries: 4 колонки без монотонного индекса -> первые три x,y,z', () => {
  const norm = DataIO.normalizeSeries(DataIO.parseText('5 10 20 30\n7 11 21 31\n'));
  assertNumbers(norm.index, [0, 1], 'index');
  assertNumbers(norm.x, [5, 7], 'x');
  assertNumbers(norm.y, [10, 11], 'y');
  assertNumbers(norm.z, [20, 21], 'z');
  assert.ok(norm.warnings.some((w) => w.includes('больше трёх')));
});

test('normalizeSeries: колонка n как ось X', () => {
  const norm = DataIO.normalizeSeries(DataIO.parseText('n;x\n1;10\n2;20\n'));
  assertNumbers(norm.index, [1, 2], 'index');
  assertNumbers(norm.x, [10, 20], 'x');
});

test('normalizeSeries: пустой parsed -> ошибка', () => {
  assert.throws(() => DataIO.normalizeSeries({ headers: null, columns: [] }), /Нет числовых колонок/);
});

// ============================================================================
// 12. Экспорт TXT
// ============================================================================
test('exportTxt: табуляция, шапка t x y z, 6 знаков, CRLF', async () => {
  const norm = DataIO.normalizeSeries(DataIO.parseCsv(readFixtureText('data.csv')));
  const blob = DataIO.exportTxt(norm);
  assert.ok(blob instanceof Blob);
  const text = await blob.text();
  const lines = text.split('\r\n');
  assert.equal(lines[0], 't\tx\ty\tz');
  assert.equal(lines[1], '0.000000\t1.250000\t0.500000\t-1.000000');
  assert.equal(lines[2], '1.000000\t2.375000\t1.100000\t-0.750000');
  assert.equal(lines[lines.length - 1], ''); // завершающий CRLF
});

// ============================================================================
// 13. Экспорт CSV
// ============================================================================
test('exportCsv: ";", десятичная запятая, шапка t;x;y;z', async () => {
  const norm = DataIO.normalizeSeries(DataIO.parseCsv(readFixtureText('data.csv')));
  const blob = DataIO.exportCsv(norm);
  const text = await blob.text();
  const lines = text.split('\r\n');
  assert.equal(lines[0], 't;x;y;z');
  assert.equal(lines[1], '0,000000;1,250000;0,500000;-1,000000');
});

// ============================================================================
// 14. Экспорт XLSX: структура ZIP, CRC32, XML
// ============================================================================
test('exportXlsx: валидный ZIP STORE с корректным CRC32 и нужными частями', async () => {
  const norm = DataIO.normalizeSeries(DataIO.parseCsv(readFixtureText('data.csv')));
  const blob = DataIO.exportXlsx(norm);
  assert.equal(blob.type, DataIO.mime.xlsx);
  const buf = Buffer.from(await blob.arrayBuffer());

  // ZIP-сигнатура.
  assert.equal(buf.subarray(0, 4).toString('hex'), '504b0304');

  const entries = inspectZip(buf);
  const names = entries.map((e) => e.name).sort();
  assert.deepEqual(names, [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/_rels/workbook.xml.rels',
    'xl/workbook.xml',
    'xl/worksheets/sheet1.xml'
  ].sort());

  for (const entry of entries) {
    assert.equal(entry.method, 0, `метод STORE для ${entry.name}`);
    assert.equal(entry.usize, entry.payload.length, `размер ${entry.name}`);
    assert.equal(entry.crc, internals.crc32(new Uint8Array(entry.payload)), `CRC32 ${entry.name}`);
  }

  const sheet = entries.find((e) => e.name === 'xl/worksheets/sheet1.xml').payload.toString('utf8');
  assert.ok(sheet.includes('<worksheet'), 'worksheet');
  assert.ok(sheet.includes('<t xml:space="preserve">t</t>'), 'шапка t');
  assert.ok(sheet.includes('<t xml:space="preserve">z</t>'), 'шапка z');
  assert.ok(sheet.includes('<v>1.25</v>'), 'число 1.25 с точкой');
  assert.ok(sheet.includes('<v>-1</v>'), 'отрицательное число');
  assert.ok(!sheet.includes('<v>1,25</v>'), 'в XLSX не должно быть десятичной запятой');

  const workbook = entries.find((e) => e.name === 'xl/workbook.xml').payload.toString('utf8');
  assert.ok(workbook.includes('name="Данные"'), 'имя листа «Данные»');

  const contentTypes = entries.find((e) => e.name === '[Content_Types].xml').payload.toString('utf8');
  assert.ok(contentTypes.includes('/xl/workbook.xml'), 'content types workbook');
});

// ============================================================================
// 15. Round-trip: exportXlsx -> parseXlsx
// ============================================================================
test('round-trip: exportXlsx -> parseXlsx даёт те же данные', async () => {
  const parsed = DataIO.parseCsv(readFixtureText('data.csv'));
  const norm = DataIO.normalizeSeries(parsed);
  const blob = DataIO.exportXlsx(parsed);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const back = await DataIO.parseXlsx(bytes);
  assert.deepEqual(back.headers, ['t', 'x', 'y', 'z']);
  assertNumbers(columnByName(back, 't'), [0, 1, 2, 3, 4], 't');
  assertNumbers(columnByName(back, 'x'), norm.x, 'x');
  assertNumbers(columnByName(back, 'y'), norm.y, 'y');
  assertNumbers(columnByName(back, 'z'), norm.z, 'z');

  const normBack = DataIO.normalizeSeries(back);
  assertNumbers(normBack.index, norm.index, 'index');
  assertNumbers(normBack.x, norm.x, 'x');
});

// ============================================================================
// 16. Чтение XLSX-фикстуры (ZIP_DEFLATED + sharedStrings)
// ============================================================================
test('parseXlsx: data.xlsx (deflate, sharedStrings) читается верно', async () => {
  const bytes = new Uint8Array(readFixture('data.xlsx'));

  // Фикстура действительно сжата методом deflate.
  const entries = inspectZip(Buffer.from(bytes));
  const sheetEntry = entries.find((e) => e.name === 'xl/worksheets/sheet1.xml');
  assert.ok(sheetEntry, 'sheet1.xml в фикстуре');
  assert.equal(sheetEntry.method, 8, 'фикстура должна быть deflate');

  const parsed = await DataIO.parseXlsx(bytes);
  assert.deepEqual(parsed.headers, ['t', 'x', 'y', 'z']);
  assertNumbers(columnByName(parsed, 't'), [0, 1, 2, 3, 4], 't');
  assertNumbers(columnByName(parsed, 'x'), [1.25, 2.375, 3.5, 4.125, 5], 'x');
  assertNumbers(columnByName(parsed, 'y'), [0.5, 1.1, 1.9, 2.4, 3], 'y');
  assertNumbers(columnByName(parsed, 'z'), [-1, -0.75, 0.25, 1.5, 2.75], 'z');
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.meta.source, 'xlsx');
});

test('parseXlsx: ArrayBuffer тоже принимается', async () => {
  const buf = readFixture('data.xlsx');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = await DataIO.parseXlsx(ab);
  assertNumbers(columnByName(parsed, 'x'), [1.25, 2.375, 3.5, 4.125, 5], 'x');
});

test('parseXlsx: повреждённый файл -> reject', async () => {
  const bad = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await assert.rejects(() => DataIO.parseXlsx(bad), /Не удалось прочитать XLSX/);
});

// ============================================================================
// 17. XLSX с inlineStr (собираем своим zipStore)
// ============================================================================
test('parseXlsx: поддержка inlineStr и t="str"', async () => {
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/></Types>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>';
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    '<row r="1"><c r="A1" t="inlineStr"><is><t>t</t></is></c>' +
    '<c r="B1" t="inlineStr"><is><t>x</t></is></c></row>' +
    '<row r="2"><c r="A2"><v>10</v></c><c r="B2"><v>1.5</v></c></row>' +
    '<row r="3"><c r="A3"><v>11</v></c><c r="B3" t="str"><v>2.5</v></c></row>' +
    '</sheetData></worksheet>';
  const enc = internals.utf8Encode;
  const zip = internals.zipStore([
    { name: '[Content_Types].xml', data: enc(contentTypes) },
    { name: '_rels/.rels', data: enc(rootRels) },
    { name: 'xl/workbook.xml', data: enc(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc(workbookRels) },
    { name: 'xl/worksheets/sheet1.xml', data: enc(sheet) }
  ]);
  const parsed = await DataIO.parseXlsx(zip);
  assert.deepEqual(parsed.headers, ['t', 'x']);
  assertNumbers(columnByName(parsed, 'x'), [1.5, 2.5], 'x');
});

// ============================================================================
// 18. ZIP: круговой тест с не-ASCII именем
// ============================================================================
test('zipStore/unzip: не-ASCII имя файла и содержимое', async () => {
  const data = internals.utf8Encode('привет, мир');
  const zip = internals.zipStore([{ name: 'тест/файл.txt', data }]);
  const map = await internals.unzip(zip);
  assert.deepEqual([...map.keys()], ['тест/файл.txt']);
  assert.equal(internals.utf8Decode(map.get('тест/файл.txt')), 'привет, мир');
});

// ============================================================================
// 19. CRC32 — известный вектор
// ============================================================================
test('crc32: эталонное значение "123456789" = 0xCBF43926', () => {
  const bytes = internals.utf8Encode('123456789');
  assert.equal(internals.crc32(bytes) >>> 0, 0xCBF43926);
});

// ============================================================================
// 20. decodeBytes: windows-1251 fallback
// ============================================================================
test('decodeBytes: windows-1251 fallback для не-UTF-8', () => {
  const cp1251 = new Uint8Array([0xF2, 0xE5, 0xF1, 0xF2]); // «тест» в cp1251
  assert.equal(internals.decodeBytes(cp1251), 'тест');
  assert.equal(internals.decodeBytes(internals.utf8Encode('\uFEFFпривет')), 'привет');
});

// ============================================================================
// 21. readFile(File)
// ============================================================================
test('readFile: CSV и XLSX через File', async () => {
  if (typeof File !== 'function') {
    console.log('  (пропущено: глобальный File недоступен в этой версии Node)');
    return;
  }
  const csvFile = new File(['t;x\n0;1,5\n1;2,5\n'], 'probe.csv', { type: 'text/csv' });
  const parsedCsv = await DataIO.readFile(csvFile);
  assert.deepEqual(parsedCsv.headers, ['t', 'x']);
  assertNumbers(columnByName(parsedCsv, 'x'), [1.5, 2.5], 'x');

  const xlsxBuf = readFixture('data.xlsx');
  const xlsxFile = new File([xlsxBuf], 'data.xlsx',
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const parsedXlsx = await DataIO.readFile(xlsxFile);
  assert.deepEqual(parsedXlsx.headers, ['t', 'x', 'y', 'z']);
  assertNumbers(columnByName(parsedXlsx, 'x'), [1.25, 2.375, 3.5, 4.125, 5], 'x');
});

test('readFile: старый .xls -> понятная ошибка', async () => {
  if (typeof File !== 'function') return;
  const file = new File([new Uint8Array([0, 1, 2])], 'old.xls');
  await assert.rejects(() => DataIO.readFile(file), /\.xls не поддерживается/);
});

// ============================================================================
// 22. download в Node выбрасывает понятную ошибку (DOM недоступен)
// ============================================================================
test('download: вне браузера — ошибка', () => {
  assert.throws(() => DataIO.download(new Blob(['x']), 'x.txt'), /только в браузере/);
});

// ============================================================================
// Запуск
// ============================================================================
(async function run() {
  console.log('--- io.js self-test ---');
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log(`  ok  ${name}`);
    } catch (err) {
      failures.push({ name, err });
      console.log(`  FAIL ${name}`);
      console.log(`       ${err && err.message ? err.message : err}`);
    }
  }
  console.log(`--- ${passed}/${tests.length} тестов пройдено ---`);
  if (failures.length) {
    console.error('\nПРОВАЛЕНО:');
    for (const { name, err } of failures) {
      console.error(`  * ${name}: ${err && err.stack ? err.stack : err}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('ALL TESTS PASSED');
  process.exitCode = 0;
})();
