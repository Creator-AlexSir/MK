# io.js — заметки разработчика

Модуль ввода/вывода данных для проекта «Стохастические временные ряды».
Контракт — `SPEC.md`, раздел «Контракт io.js → window.DataIO».
Классический скрипт (`<script src="io.js"></script>`, до `main.js`), IIFE + `'use strict'`,
без внешних зависимостей и CDN. Работает в браузере и в Node (для тестов).

## Публичный API

```js
DataIO.version                     // '1.0.0'
DataIO.mime                        // { xlsx, txt, csv } — MIME-типы

DataIO.parseText(text)             // -> parsed, синхронно; .txt/.csv/.tsv
DataIO.parseCsv(text)              // -> parsed, синоним parseText
DataIO.parseXlsx(arrayBuffer)      // -> Promise<parsed>; также принимает Uint8Array
DataIO.readFile(file)              // -> Promise<parsed>; File по расширению
DataIO.normalizeSeries(parsed)     // -> { x, y, z, index, name, warnings }

DataIO.exportTxt(dataset)          // -> Blob (UTF-8, таб, шапка t x y z, 6 знаков)
DataIO.exportCsv(dataset)          // -> Blob (UTF-8, ';', десятичная запятая)
DataIO.exportXlsx(dataset)         // -> Blob (валидный xlsx, ZIP STORE + CRC32)
DataIO.download(blob, filename)    // только браузер: <a download> + ObjectURL
```

### `parsed`

```js
{
  headers: ['x','y','z'] | null,      // null, если шапки не было
  columns: [{ name: 'x', values: [1, 2, 3] }, ...], // только числовые колонки
  skipped: 0,                         // сколько строк не распознано
  warnings: ['...'],                  // предупреждения для UI
  meta: { ... }                       // необязательное: delimiter / decimalComma / source
}
```

### `dataset` для экспорта

Поддерживаются три формы:

1. как в SPEC: `{ headers: ['t','x','y','z'], columns: [{ name, values }, ...] }`;
2. результат `normalizeSeries`: `{ index, x: [], y: [], z: [] }`;
3. просто `{ x: [], y: [], z: [] }`.

Если колонки `t/time/n/index` нет — она добавляется автоматически (`0..N-1`),
шапка получается `t x y z`. Пустые/NaN значения выгружаются пустой ячейкой.

## Правила парсинга текста

- Кодировка: UTF-8 (BOM отбрасывается); если встречаются «битые» символы —
  автоматический fallback на windows-1251 (полезно для старых файлов Excel RU).
- Разделитель определяется автоматически: таб → `;` → `,` → пробелы.
  Для `;`, таба и пробелов десятичная запятая трактуется как десятичная точка
  (`1,23` = 1.23); для `,` — запятая является разделителем.
- Числа: поддержаны знак, экспонента, пробелы-разделители разрядов,
  `1 234`, `1.234,56`, `1,234.56`, кавычки вокруг ячеек.
- Шапка: первая непустая нечисловая строка, содержащая `x/y/z/t/time/n`
  (а также `xt`, `x_t`, `x[t]`, `yt`, `y_t`, `z_t`). Имена колонок берутся как в файле.
- Строки с мусором/текстом/недостающим числом колонок пропускаются и считаются в
  `skipped`; в `warnings` попадает «Пропущено строк: N».
- Без шапки колонки называются: 1 → `x`; 2 → `x,y`; 3 → `x,y,z`; 4+ → `x,y,z,col4,…`.

## normalizeSeries

- Заголовок первой колонки `t/time/n/index` → эта колонка становится осью `index`,
  остальные — `x`, `y`, `z`.
- 4+ колонки без шапки: если первая — монотонный индекс `1..N` (или `0..N-1`),
  она становится осью `index` (предупреждение в `warnings`).
- 1 колонка → `x`; 2 → `x,y`; 3 → `x,y,z`; `index` = `0..N-1`, если ось не найдена.
- Лишние (сверх трёх) колонки не используются, в `warnings` добавляется предупреждение.
- `name` — имена использованных колонок через `/` (например `x/y/z`).

## XLSX: чтение без библиотек

1. `readZip` — поиск EOCD, разбор центрального каталога и локальных заголовков.
2. Метод 0 (STORE) — как есть; метод 8 (DEFLATE) — `DecompressionStream('deflate-raw')`;
   при отсутствии `DecompressionStream` — `Promise.reject(new Error('Браузер не поддерживает чтение XLSX'))`.
3. Путь листа: `xl/workbook.xml` + `xl/_rels/workbook.xml.rels`; fallback —
   первый `xl/worksheets/sheetN.xml`.
4. `xl/sharedStrings.xml` (`t="s"`), inline strings (`t="inlineStr"`), `t="str"`,
   числа, булевы значения, rich text, пропуски ячеек (`r="D5"`).
5. ZIP64 и зашифрованные книги не поддерживаются (понятная ошибка).

## XLSX: запись

ZIP собран вручную: локальные заголовки + центральный каталог + EOCD, метод **STORE**,
CRC32 по таблице, имена в UTF-8. Части книги:
`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`,
`xl/_rels/workbook.xml.rels`, `xl/worksheets/sheet1.xml`; лист «Данные»,
шапка — inlineStr, числа — с точкой. Файл проверен независимо:
`python -c "zipfile.ZipFile(...).testzip()"` → None, все XML-части разбираются
`xml.etree.ElementTree`; также проверяется открытие через round-trip `parseXlsx`.

## Самопроверка

```powershell
cd "C:\Users\sivin\OneDrive\Рабочий стол\PROJEKT\MK-main"
node --check io.js
node _tests/io.test.js        # "ALL TESTS PASSED", exit 0
```

`_tests/io.test.js` — 37 проверок: парсинг TXT/CSV (запятая, `;`, таб, пробелы,
десятичная запятая, шапки `x_t`/`x[t]`/`t`/`time`/`n`, кавычки, мусор), `normalizeSeries`
(1–4 колонки, монотонный индекс), экспорт TXT/CSV, структура ZIP/CRC32 экспортированного
XLSX (независимый разбор через `node:zlib`), round-trip `exportXlsx → parseXlsx`,
чтение `_tests/fixtures/data.xlsx` (ZIP_DEFLATED + sharedStrings), inlineStr, UTF-8 имена
в ZIP, windows-1251, `readFile`, ошибки.

Фикстуры: `_tests/fixtures/data.csv`, `data_semicolon.csv`, `data.txt`,
`data.xlsx` (генерируются заново скриптом `_tests/fixtures/make_fixtures.py`,
python 3.12, только stdlib; XLSX собран с ZIP_DEFLATED и sharedStrings).

Страница `_tests/io.html` — выбор/перетаскивание файла, вывод колонок, `skipped`,
`warnings`, предпросмотр, нормализованная серия, кнопки «Сохранить TXT/CSV/XLSX»,
демо-данные. Внешних ресурсов нет; скрипт подключается как `../io.js`.

## Известные ограничения

- `.xls` (старый бинарный формат) не поддерживается — `readFile` возвращает понятную ошибку.
- Зашифрованные и ZIP64-книги XLSX не поддерживаются.
- Читается первый лист книги; несколько листов/формулы не вычисляются
  (берутся сохранённые значения `<v>`).
- Строка, где хотя бы одна ячейка не является числом, пропускается целиком
  (счётчик `skipped` + предупреждение) — так выполняется требование «только числовые колонки».
- `download` работает только в браузере; в Node выбрасывает ошибку.
- Экспорт не сохраняет стили/форматы ячеек — только данные (по SPEC).
