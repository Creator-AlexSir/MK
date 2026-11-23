/* io.js — модуль ввода/вывода данных: TXT, CSV, XLSX.
   Без внешних библиотек. Классический скрипт: подключается до main.js
   и выставляет глобальный namespace window.DataIO.
   Контракт — см. SPEC.md, раздел «Контракт io.js → window.DataIO». */
(function (root) {
  'use strict';

  var MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var MIME_TXT = 'text/plain;charset=utf-8';
  var MIME_CSV = 'text/csv;charset=utf-8';
  var SHEET_NAME = 'Данные';
  var DECIMALS = 6; // знаков после запятой в TXT/CSV

  // =====================================================================
  // Базовые утилиты
  // =====================================================================

  var textEncoder = new TextEncoder();
  var utf8Decoder = new TextDecoder('utf-8');

  function utf8Encode(str) {
    return textEncoder.encode(str);
  }

  function utf8Decode(bytes) {
    return utf8Decoder.decode(bytes);
  }

  // Декодирование байтов файла: UTF-8, при «битых» символах — windows-1251.
  function decodeBytes(bytes) {
    var text = utf8Decode(bytes);
    if (text.indexOf('\uFFFD') !== -1) {
      try {
        text = new TextDecoder('windows-1251').decode(bytes);
      } catch (e) {
        /* кодировка не поддерживается — оставляем UTF-8 */
      }
    }
    return text.replace(/^\uFEFF/, '');
  }

  function rangeArray(n) {
    var a = new Array(n);
    for (var i = 0; i < n; i++) a[i] = i;
    return a;
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function toBytes(input) {
    if (input == null) throw new Error('Нет данных для чтения');
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    throw new TypeError('Ожидался ArrayBuffer или Uint8Array');
  }

  // =====================================================================
  // CRC32 (для записи ZIP/XLSX)
  // =====================================================================

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // =====================================================================
  // ZIP: запись (метод STORE) и чтение (STORE / DEFLATE)
  // =====================================================================

  // files: [{ name: string, data: Uint8Array }] -> Uint8Array (валидный ZIP)
  function zipStore(files) {
    var localParts = [];
    var centralParts = [];
    var offset = 0;
    // Фиксированная метка времени DOS: 1980-01-01 00:00:00.
    var dosTime = 0;
    var dosDate = 0x0021;

    for (var fi = 0; fi < files.length; fi++) {
      var file = files[fi];
      var nameBytes = utf8Encode(file.name);
      var data = file.data;
      var crc = crc32(data);

      // Локальный заголовок (30 байт + имя).
      var local = new Uint8Array(30 + nameBytes.length);
      var ldv = new DataView(local.buffer);
      ldv.setUint32(0, 0x04034b50, true);   // сигнатура
      ldv.setUint16(4, 20, true);           // версия для распаковки
      ldv.setUint16(6, 0x0800, true);       // имена в UTF-8
      ldv.setUint16(8, 0, true);            // метод 0 = STORE
      ldv.setUint16(10, dosTime, true);
      ldv.setUint16(12, dosDate, true);
      ldv.setUint32(14, crc, true);         // CRC32
      ldv.setUint32(18, data.length, true); // сжатый размер
      ldv.setUint32(22, data.length, true); // исходный размер
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);           // extra
      local.set(nameBytes, 30);

      // Запись центрального каталога (46 байт + имя).
      var cd = new Uint8Array(46 + nameBytes.length);
      var cdv = new DataView(cd.buffer);
      cdv.setUint32(0, 0x02014b50, true);   // сигнатура
      cdv.setUint16(4, 20, true);           // версия создателя
      cdv.setUint16(6, 20, true);           // версия для распаковки
      cdv.setUint16(8, 0x0800, true);       // UTF-8 имена
      cdv.setUint16(10, 0, true);           // STORE
      cdv.setUint16(12, dosTime, true);
      cdv.setUint16(14, dosDate, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, data.length, true);
      cdv.setUint32(24, data.length, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint16(30, 0, true);           // extra
      cdv.setUint16(32, 0, true);           // comment
      cdv.setUint16(34, 0, true);           // номер диска
      cdv.setUint16(36, 0, true);           // внутренние атрибуты
      cdv.setUint32(38, 0, true);           // внешние атрибуты
      cdv.setUint32(42, offset, true);      // смещение локального заголовка
      cd.set(nameBytes, 46);

      localParts.push(local, data);
      centralParts.push(cd);
      offset += local.length + data.length;
    }

    var centralSize = 0;
    for (var ci = 0; ci < centralParts.length; ci++) centralSize += centralParts[ci].length;

    var eocd = new Uint8Array(22);
    var edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);       // сигнатура EOCD
    edv.setUint16(4, 0, true);                // номер диска
    edv.setUint16(6, 0, true);                // диск с каталогом
    edv.setUint16(8, files.length, true);     // записей на диске
    edv.setUint16(10, files.length, true);    // всего записей
    edv.setUint32(12, centralSize, true);     // размер каталога
    edv.setUint32(16, offset, true);          // смещение каталога
    edv.setUint16(20, 0, true);               // комментарий

    var total = offset + centralSize + eocd.length;
    var out = new Uint8Array(total);
    var pos = 0;
    for (var i = 0; i < localParts.length; i++) {
      out.set(localParts[i], pos);
      pos += localParts[i].length;
    }
    for (var j = 0; j < centralParts.length; j++) {
      out.set(centralParts[j], pos);
      pos += centralParts[j].length;
    }
    out.set(eocd, pos);
    return out;
  }

  // Распаковка raw deflate средствами браузера (DecompressionStream).
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('Браузер не поддерживает чтение XLSX');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    var reader = stream.getReader();
    var chunks = [];
    var total = 0;
    var res;
    while (!(res = await reader.read()).done) {
      var chunk = res.value;
      chunks.push(chunk);
      total += chunk.length;
    }
    var out = new Uint8Array(total);
    var off = 0;
    for (var i = 0; i < chunks.length; i++) {
      out.set(chunks[i], off);
      off += chunks[i].length;
    }
    return out;
  }

  // Читает ZIP целиком -> Map(name -> Uint8Array).
  async function readZip(input) {
    var bytes = toBytes(input);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 22) throw new Error('Файл слишком мал для ZIP');

    // Ищем End of Central Directory (сигнатура 0x06054b50) с конца.
    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Файл не является ZIP/XLSX (не найден EOCD)');

    var total = dv.getUint16(eocd + 10, true);
    var cdOffset = dv.getUint32(eocd + 16, true);
    if (total === 0xFFFF || cdOffset === 0xFFFFFFFF) {
      throw new Error('ZIP64 не поддерживается');
    }

    var entries = new Map();
    var p = cdOffset;
    for (var n = 0; n < total; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break; // каталог закончился
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var uncompSize = dv.getUint32(p + 24, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var localOffset = dv.getUint32(p + 42, true);
      var name = utf8Decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');

      // Проверяем локальный заголовок и вычисляем начало данных.
      if (localOffset + 30 > bytes.length || dv.getUint32(localOffset, true) !== 0x04034b50) {
        throw new Error('Повреждён локальный заголовок ZIP: ' + name);
      }
      var localNameLen = dv.getUint16(localOffset + 26, true);
      var localExtraLen = dv.getUint16(localOffset + 28, true);
      var dataStart = localOffset + 30 + localNameLen + localExtraLen;
      var raw = bytes.subarray(dataStart, dataStart + compSize);

      var data;
      if (method === 0) {
        data = raw.slice();
      } else if (method === 8) {
        data = await inflateRaw(raw);
      } else {
        throw new Error('Неподдерживаемый метод сжатия ZIP: ' + method);
      }
      entries.set(name, data);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  // =====================================================================
  // Разбор чисел и текстовых таблиц (TXT/CSV/TSV)
  // =====================================================================

  // Разбор одного числа. decimalComma=true: «1,23» = 1.23.
  function parseNumber(token, decimalComma) {
    if (token == null) return NaN;
    var t = String(token).trim();
    if (!t) return NaN;
    // убираем кавычки и пробелы-разделители разрядов
    t = t.replace(/^["']+|["']+$/g, '').replace(/\s+/g, '');
    if (!t) return NaN;

    var hasComma = t.indexOf(',') !== -1;
    var hasDot = t.indexOf('.') !== -1;
    if (hasComma && hasDot) {
      // «1.234,56» или «1,234.56» — последний разделитель считаем десятичным
      var lastComma = t.lastIndexOf(',');
      var lastDot = t.lastIndexOf('.');
      if (lastComma > lastDot) {
        t = t.replace(/\./g, '').replace(/,/g, '.');
      } else {
        t = t.replace(/,/g, '');
      }
    } else if (hasComma) {
      if (decimalComma) t = t.replace(/,/g, '.');
      else return NaN; // запятая — разделитель колонок, а не число
    }

    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return NaN;
    var v = Number(t);
    return isFinite(v) ? v : NaN;
  }

  // Сколько раз символ встречается в строке (вне кавычек).
  function countChar(line, ch) {
    var count = 0;
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') i++;
        else inQuotes = !inQuotes;
      } else if (c === ch && !inQuotes) {
        count++;
      }
    }
    return count;
  }

  // Автоопределение разделителя по выборке строк.
  function detectDelimiter(lines) {
    var sample = [];
    for (var i = 0; i < lines.length && sample.length < 50; i++) {
      if (lines[i].trim() !== '') sample.push(lines[i]);
    }
    if (!sample.length) return ';';

    var candidates = ['\t', ';', ','];
    for (var ci = 0; ci < candidates.length; ci++) {
      var d = candidates[ci];
      var hits = 0;
      for (var k = 0; k < sample.length; k++) {
        if (countChar(sample[k], d) > 0) hits++;
      }
      if (hits >= Math.max(1, Math.ceil(sample.length * 0.5))) return d;
    }

    // Пробелы: несколько токенов хотя бы в половине строк.
    var spaceHits = 0;
    for (var s = 0; s < sample.length; s++) {
      if (sample[s].trim().split(/\s+/).length >= 2) spaceHits++;
    }
    if (spaceHits >= Math.max(1, Math.ceil(sample.length * 0.5))) return ' ';

    return ';'; // одна колонка или неоднозначный файл
  }

  // Разбиение строки на ячейки с учётом кавычек CSV.
  function splitLine(line, delimiter) {
    if (delimiter === ' ') {
      var parts = line.trim().split(/\s+/);
      return parts.map(function (s) { return s.replace(/^["']+|["']+$/g, ''); });
    }
    var cells = [];
    var cur = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === delimiter && !inQuotes) {
        cells.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    return cells.map(function (s) { return s.trim(); });
  }

  // Имена колонок по умолчанию (когда шапки нет).
  function autoColumnName(index, total) {
    if (total === 1) return 'x';
    if (total === 2) return index === 0 ? 'x' : 'y';
    if (total === 3) return ['x', 'y', 'z'][index];
    if (index < 3) return ['x', 'y', 'z'][index];
    return 'col' + (index + 1);
  }

  // Строка-заголовок: нечисловая и содержит метки x/y/z/t/time/n.
  var HEADER_RE = /^(t|time|n|index|x|y|z|xt|x_t|x\[t\]|yt|y_t|y\[t\]|zt|z_t|z\[t\])$/i;

  function normHeaderToken(tok) {
    return String(tok).trim().toLowerCase().replace(/\s+/g, '');
  }

  function isHeaderToken(tok) {
    return HEADER_RE.test(normHeaderToken(tok));
  }

  // Убираем пустые хвостовые ячейки, приводим содержимое к строкам.
  function cleanCells(row) {
    if (!row) return [];
    var cells = new Array(row.length);
    for (var i = 0; i < row.length; i++) {
      cells[i] = row[i] == null ? '' : String(row[i]).trim();
    }
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    return cells;
  }

  function countNumericCells(cells, decimalComma) {
    var n = 0;
    for (var i = 0; i < cells.length; i++) {
      if (!isNaN(parseNumber(cells[i], decimalComma))) n++;
    }
    return n;
  }

  // Ищем шапку в первых строках (до первой строки с числами).
  function findHeaderRow(rows, decimalComma) {
    var limit = Math.min(rows.length, 20);
    for (var i = 0; i < limit; i++) {
      var cells = cleanCells(rows[i]);
      if (!cells.length) continue;
      if (countNumericCells(cells, decimalComma) > 0) return { headerIndex: -1, headers: null };
      var matched = 0;
      for (var k = 0; k < cells.length; k++) {
        if (isHeaderToken(cells[k])) matched++;
      }
      if (matched > 0) return { headerIndex: i, headers: cells };
    }
    return { headerIndex: -1, headers: null };
  }

  // Общая сборка parsed-объекта из матрицы строк (массив массивов строк).
  function matrixToParsed(rows, opts) {
    opts = opts || {};
    var decimalComma = !!opts.decimalComma;
    var warnings = (opts.warnings || []).slice();
    var skipped = 0;
    var i, k;

    if (!Array.isArray(rows) || !rows.length) throw new Error('Нет данных для разбора');

    var head = findHeaderRow(rows, decimalComma);
    var headerIndex = head.headerIndex;
    var headers = null;
    if (headerIndex >= 0) {
      headers = head.headers.map(function (h, idx) {
        var t = String(h).trim();
        return t || ('col' + (idx + 1));
      });
    }

    // Число колонок: из шапки либо самое частое у числовых строк.
    var ncols = headers ? headers.length : 0;
    if (!ncols) {
      var counts = Object.create(null);
      var best = 0;
      var bestCount = 0;
      for (i = 0; i < rows.length; i++) {
        var cells0 = cleanCells(rows[i]);
        if (!cells0.length) continue;
        if (countNumericCells(cells0, decimalComma) === 0) continue;
        var c = cells0.length;
        counts[c] = (counts[c] || 0) + 1;
        if (counts[c] > bestCount || (counts[c] === bestCount && c > best)) {
          best = c;
          bestCount = counts[c];
        }
      }
      ncols = best;
    }

    if (!ncols) {
      for (i = 0; i < rows.length; i++) {
        if (cleanCells(rows[i]).length) skipped++;
      }
      warnings.push('Числовые данные не найдены');
      return { headers: headers, columns: [], skipped: skipped, warnings: warnings };
    }

    var colValues = [];
    for (k = 0; k < ncols; k++) colValues.push([]);
    var extraWarned = false;
    var missingWarned = false;

    for (i = 0; i < rows.length; i++) {
      if (i === headerIndex) continue;
      var cells = cleanCells(rows[i]);
      if (!cells.length) continue; // пустые строки не считаем

      if (cells.length > ncols) {
        if (!extraWarned) {
          warnings.push('В строке ' + (i + 1) + ' больше колонок — лишние проигнорированы');
          extraWarned = true;
        }
      } else if (cells.length < ncols) {
        if (!missingWarned) {
          warnings.push('В строке ' + (i + 1) + ' не хватает колонок — строка пропущена');
          missingWarned = true;
        }
        skipped++;
        continue;
      }

      var vals = [];
      var ok = true;
      for (k = 0; k < ncols; k++) {
        var v = parseNumber(cells[k], decimalComma);
        if (isNaN(v)) {
          ok = false;
          break;
        }
        vals.push(v);
      }
      if (!ok) {
        skipped++;
        continue;
      }
      for (k = 0; k < ncols; k++) colValues[k].push(vals[k]);
    }

    var columns = [];
    for (k = 0; k < ncols; k++) {
      columns.push({
        name: headers ? headers[k] : autoColumnName(k, ncols),
        values: colValues[k]
      });
    }

    if (skipped > 0) warnings.push('Пропущено строк: ' + skipped);

    return { headers: headers, columns: columns, skipped: skipped, warnings: warnings };
  }

  // Парсинг текста TXT/CSV/TSV (синхронно).
  function parseText(text) {
    if (typeof text !== 'string') throw new TypeError('parseText ожидает строку');
    var src = text.replace(/^\uFEFF/, '');
    if (!src.trim()) throw new Error('Файл пуст');

    var lines = src.split(/\r\n|\r|\n/);
    var delimiter = detectDelimiter(lines);
    var decimalComma = delimiter === ';' || delimiter === '\t' || delimiter === ' ';

    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) {
        rows.push([]);
        continue;
      }
      rows.push(splitLine(lines[i], delimiter));
    }

    var parsed = matrixToParsed(rows, { decimalComma: decimalComma });
    parsed.meta = {
      delimiter: delimiter === '\t' ? 'tab' : (delimiter === ' ' ? 'space' : delimiter),
      decimalComma: decimalComma
    };
    return parsed;
  }

  // Синоним для CSV (по SPEC).
  function parseCsv(text) {
    return parseText(text);
  }

  // =====================================================================
  // XLSX: чтение (ZIP + XML, без библиотек)
  // =====================================================================

  var ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function decodeXmlEntities(s) {
    return String(s).replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g, function (all, hex, dec, name) {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      var key = String(name).toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITY_MAP, key) ? ENTITY_MAP[key] : all;
    });
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      if (ch === '"') return '&quot;';
      return '&apos;';
    });
  }

  // Значение атрибута XML-тега (tag — строка тега).
  function getXmlAttr(tag, name) {
    var re = new RegExp('(?:^|\\s)' + escapeRegExp(name) + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')');
    var m = re.exec(String(tag));
    if (!m) return null;
    return decodeXmlEntities(m[1] != null ? m[1] : m[2]);
  }

  // Все <t>…</t> в фрагменте (rich text и inline strings).
  function extractTextTags(fragment) {
    var out = '';
    var re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    var m;
    while ((m = re.exec(fragment))) out += decodeXmlEntities(m[1]);
    return out;
  }

  function parseSharedStrings(xml) {
    var strings = [];
    var re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    var m;
    while ((m = re.exec(xml))) {
      var inner = m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''); // убрать фонетику
      strings.push(extractTextTags(inner));
    }
    return strings;
  }

  // Индекс колонки по ссылке вида «C12» -> 2.
  function colIndexFromRef(ref) {
    var m = /^([A-Za-z]+)/.exec(String(ref || ''));
    if (!m) return -1;
    var s = m[1].toUpperCase();
    var n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }

  // Текст значения ячейки <c> по её телу и типу.
  function cellText(body, type, sharedStrings) {
    if (!body) return '';
    var vm;
    if (type === 'inlineStr') return extractTextTags(body);
    if (type === 's') {
      vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
      if (!vm) return '';
      var idx = parseInt(decodeXmlEntities(vm[1]).trim(), 10);
      return (sharedStrings && sharedStrings[idx] != null) ? sharedStrings[idx] : '';
    }
    if (type === 'str') {
      vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
      return vm ? decodeXmlEntities(vm[1]) : '';
    }
    if (type === 'b') {
      vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
      if (!vm) return '';
      return decodeXmlEntities(vm[1]).trim() === '1' ? '1' : '0';
    }
    if (type === 'e') return ''; // ошибочное значение
    vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
    return vm ? decodeXmlEntities(vm[1]).trim() : '';
  }

  function parseSheetXml(xml, sharedStrings) {
    var rows = [];
    var rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    var rm;
    while ((rm = rowRe.exec(xml))) {
      var inner = rm[2];
      var cells = [];
      var seq = 0;
      var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      var cm;
      while ((cm = cellRe.exec(inner))) {
        var attrs = cm[1] || '';
        var body = cm[2] || '';
        var ref = getXmlAttr(attrs, 'r');
        var idx = ref ? colIndexFromRef(ref) : seq;
        if (idx < 0) idx = seq;
        seq = idx + 1;
        var type = String(getXmlAttr(attrs, 't') || 'n').trim();
        cells[idx] = cellText(body, type, sharedStrings);
      }
      for (var i = 0; i < cells.length; i++) {
        if (cells[i] == null) cells[i] = '';
      }
      rows.push(cells);
    }
    return rows;
  }

  function normalizeParts(path) {
    var parts = String(path).split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === '..') out.pop();
      else if (p !== '.' && p !== '') out.push(p);
    }
    return out.join('/');
  }

  // Путь к XML первого листа: через workbook.xml + rels, с fallback.
  function resolveSheetPath(entries) {
    var wb = entries.get('xl/workbook.xml');
    var rels = entries.get('xl/_rels/workbook.xml.rels');
    if (wb) {
      var wbText = utf8Decode(wb);
      var sheetTag = /<sheet\b[^>]*>/.exec(wbText);
      if (sheetTag && rels) {
        var rid = getXmlAttr(sheetTag[0], 'r:id') || getXmlAttr(sheetTag[0], 'id');
        if (rid) {
          var relsText = utf8Decode(rels);
          var relRe = new RegExp('<Relationship\\b[^>]*\\bId\\s*=\\s*["\']' +
            escapeRegExp(rid) + '["\'][^>]*>', 'i');
          var relTag = relRe.exec(relsText);
          if (relTag) {
            var target = getXmlAttr(relTag[0], 'Target');
            if (target) {
              target = target.replace(/\\/g, '/').replace(/^\/+/, '');
              var full = /^xl\//.test(target) ? target : 'xl/' + target;
              full = normalizeParts(full);
              if (entries.has(full)) return full;
            }
          }
        }
      }
    }
    // Fallback: первый по имени xl/worksheets/sheetN.xml.
    var found = [];
    entries.forEach(function (value, key) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(key)) found.push(key);
    });
    found.sort(function (a, b) {
      var na = parseInt(/sheet(\d+)/.exec(a)[1], 10);
      var nb = parseInt(/sheet(\d+)/.exec(b)[1], 10);
      return na - nb;
    });
    if (found.length) return found[0];
    throw new Error('В XLSX не найдены листы');
  }

  // Публичный парсер XLSX (ArrayBuffer/Uint8Array -> Promise<parsed>).
  async function parseXlsx(input) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('Браузер не поддерживает чтение XLSX');
    }
    var entries;
    try {
      entries = await readZip(input);
    } catch (e) {
      throw new Error('Не удалось прочитать XLSX: ' + (e && e.message ? e.message : e));
    }
    var sheetPath = resolveSheetPath(entries);
    var sheetBytes = entries.get(sheetPath);
    if (!sheetBytes) throw new Error('В XLSX не найден лист: ' + sheetPath);

    var sharedStrings = [];
    var sharedBytes = entries.get('xl/sharedStrings.xml');
    if (sharedBytes) sharedStrings = parseSharedStrings(utf8Decode(sharedBytes));

    var rows = parseSheetXml(utf8Decode(sheetBytes), sharedStrings);
    var parsed = matrixToParsed(rows, { decimalComma: false });
    parsed.meta = { source: 'xlsx', sheet: sheetPath };
    return parsed;
  }

  // =====================================================================
  // readFile(File) — универсальное чтение по расширению
  // =====================================================================

  function readArrayBuffer(file) {
    if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Не удалось прочитать файл')); };
      reader.readAsArrayBuffer(file);
    });
  }

  async function readFile(file) {
    if (!file) throw new Error('Файл не выбран');
    var name = String(file.name || '').toLowerCase();
    var type = String(file.type || '').toLowerCase();

    if (/\.xls$/.test(name)) {
      throw new Error('Старый формат .xls не поддерживается — сохраните файл как .xlsx');
    }
    var isXlsx = /\.(xlsx|xlsm|xltx|xltm)$/.test(name) ||
      type.indexOf('spreadsheetml') !== -1;

    var buffer = await readArrayBuffer(file);
    if (isXlsx) return parseXlsx(buffer);

    var text = decodeBytes(toBytes(buffer));
    return parseText(text);
  }

  // =====================================================================
  // normalizeSeries — приведение parsed к x/y/z + ось X
  // =====================================================================

  function isMonotonicIndex(values) {
    if (!Array.isArray(values) || values.length < 2) return false;
    var start = Number(values[0]);
    if (start !== 0 && start !== 1) return false;
    for (var i = 1; i < values.length; i++) {
      var diff = Number(values[i]) - Number(values[i - 1]);
      if (!(Math.abs(diff - 1) < 1e-9)) return false;
    }
    return true;
  }

  function normalizeSeries(parsed) {
    if (!parsed || !Array.isArray(parsed.columns)) {
      throw new Error('Некорректные данные для нормализации');
    }
    var warnings = (parsed.warnings || []).slice();
    var cols = parsed.columns.filter(function (c) {
      return c && Array.isArray(c.values) && c.values.length > 0;
    });
    if (!cols.length) throw new Error('Нет числовых колонок для нормализации');

    var len = Infinity;
    for (var i = 0; i < cols.length; i++) len = Math.min(len, cols[i].values.length);
    if (!isFinite(len) || len <= 0) throw new Error('Нет числовых колонок для нормализации');

    var headers = parsed.headers ? parsed.headers.map(function (h) { return String(h).trim(); }) : null;
    var indexValues = null;
    var dataCols = cols;

    // 1) Явная колонка времени: заголовок t/time/n/index.
    if (headers && headers.length >= 1 && /^(t|time|n|index)$/i.test(headers[0]) && cols.length >= 2) {
      indexValues = cols[0].values.slice(0, len);
      dataCols = cols.slice(1);
    }

    // 2) Монотонный индекс 1..N (или 0..N-1) в первой колонке при 4+ колонках.
    if (!indexValues && cols.length >= 4 && isMonotonicIndex(cols[0].values.slice(0, len))) {
      indexValues = cols[0].values.slice(0, len);
      dataCols = cols.slice(1);
      warnings.push('Первая колонка распознана как ось времени (монотонный индекс)');
    }

    var out = { x: [], y: [], z: [], index: [], name: '', warnings: warnings };

    if (indexValues) {
      out.index = indexValues.map(Number);
    } else {
      for (var t = 0; t < len; t++) out.index.push(t);
    }

    var targets = ['x', 'y', 'z'];
    for (var k = 0; k < dataCols.length && k < 3; k++) {
      out[targets[k]] = dataCols[k].values.slice(0, len).map(Number);
    }
    if (dataCols.length > 3) {
      warnings.push('Колонок больше трёх: использованы первые три, остальные не учтены');
    }

    var names = dataCols.slice(0, 3).map(function (c) {
      return c && c.name ? String(c.name) : '?';
    });
    out.name = names.length ? names.join('/') : 'данные';
    return out;
  }

  // =====================================================================
  // Экспорт: TXT, CSV, XLSX
  // =====================================================================

  function formatFixed(value, digits) {
    var n = Number(value);
    if (!isFinite(n)) return '';
    return n.toFixed(digits);
  }

  function xlsxNumberString(value) {
    var n = Number(value);
    if (!isFinite(n)) return null;
    if (n === 0) return '0';
    var s = String(n);
    if (s.indexOf('e') === -1 && s.indexOf('E') === -1) return s;
    s = n.toFixed(15);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  // Приводим dataset к { headers, columns, length }.
  // Поддерживаются: {columns:[{name,values}]}, {index,x,y,z}, {x:[],y:[],z:[]}.
  function resolveDataset(dataset) {
    if (!dataset || typeof dataset !== 'object') throw new Error('Нет данных для экспорта');

    var cols = [];
    var i;
    if (Array.isArray(dataset.columns) && dataset.columns.length) {
      for (i = 0; i < dataset.columns.length; i++) {
        var c = dataset.columns[i] || {};
        var values = Array.isArray(c.values) ? c.values :
          (Array.isArray(c.data) ? c.data : []);
        cols.push({
          name: c.name != null ? String(c.name) : autoColumnName(i, dataset.columns.length),
          values: values
        });
      }
    } else {
      var index = Array.isArray(dataset.index) ? dataset.index : null;
      var x = Array.isArray(dataset.x) ? dataset.x : null;
      var y = Array.isArray(dataset.y) ? dataset.y : null;
      var z = Array.isArray(dataset.z) ? dataset.z : null;
      if (!index && !x && !y && !z) throw new Error('Нет данных для экспорта');
      var maxLen = Math.max(
        index ? index.length : 0,
        x ? x.length : 0,
        y ? y.length : 0,
        z ? z.length : 0
      );
      cols.push({ name: 't', values: index || rangeArray(maxLen) });
      if (x) cols.push({ name: 'x', values: x });
      if (y) cols.push({ name: 'y', values: y });
      if (z) cols.push({ name: 'z', values: z });
    }

    if (!cols.length) throw new Error('Нет колонок для экспорта');

    // Синтетическая ось времени, если её нет.
    var hasIndex = false;
    for (i = 0; i < cols.length; i++) {
      if (/^(t|time|n|index)$/i.test(String(cols[i].name).trim())) hasIndex = true;
    }
    if (!hasIndex) {
      var n = 0;
      for (i = 0; i < cols.length; i++) n = Math.max(n, cols[i].values.length);
      cols.unshift({ name: 't', values: rangeArray(n) });
    }

    var total = 0;
    for (i = 0; i < cols.length; i++) total = Math.max(total, cols[i].values.length);

    return {
      headers: cols.map(function (col) { return String(col.name); }),
      columns: cols,
      length: total
    };
  }

  // Строки таблицы как массив массивов отформатированных строк.
  function buildRows(resolved, formatter) {
    var rows = [];
    for (var r = 0; r < resolved.length; r++) {
      var row = [];
      for (var c = 0; c < resolved.columns.length; c++) {
        row.push(formatter(resolved.columns[c].values[r]));
      }
      rows.push(row);
    }
    return rows;
  }

  function exportTxt(dataset) {
    var resolved = resolveDataset(dataset);
    var rows = buildRows(resolved, function (v) { return formatFixed(v, DECIMALS); });
    var lines = [resolved.headers.join('\t')];
    for (var i = 0; i < rows.length; i++) lines.push(rows[i].join('\t'));
    return new Blob([lines.join('\r\n') + '\r\n'], { type: MIME_TXT });
  }

  function exportCsv(dataset) {
    var resolved = resolveDataset(dataset);
    var rows = buildRows(resolved, function (v) {
      return formatFixed(v, DECIMALS).replace('.', ',');
    });
    var lines = [resolved.headers.join(';')];
    for (var i = 0; i < rows.length; i++) lines.push(rows[i].join(';'));
    return new Blob([lines.join('\r\n') + '\r\n'], { type: MIME_CSV });
  }

  function colLetter(index) {
    var n = index + 1;
    var s = '';
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  // XML листа: шапка — inlineStr, числа — обычные.
  function buildSheetXml(resolved) {
    var parts = [];
    parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    parts.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    parts.push('<sheetData>');

    var rowNum = 1;
    parts.push('<row r="' + rowNum + '">');
    for (var c = 0; c < resolved.headers.length; c++) {
      var ref = colLetter(c) + rowNum;
      parts.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
        escapeXml(resolved.headers[c]) + '</t></is></c>');
    }
    parts.push('</row>');

    for (var r = 0; r < resolved.length; r++) {
      rowNum++;
      parts.push('<row r="' + rowNum + '">');
      for (var k = 0; k < resolved.columns.length; k++) {
        var cellRef = colLetter(k) + rowNum;
        var raw = resolved.columns[k].values[r];
        var num = xlsxNumberString(raw);
        if (num === null) {
          parts.push('<c r="' + cellRef + '"/>');
        } else {
          parts.push('<c r="' + cellRef + '"><v>' + num + '</v></c>');
        }
      }
      parts.push('</row>');
    }

    parts.push('</sheetData>');
    parts.push('</worksheet>');
    return parts.join('');
  }

  function buildXlsxBytes(dataset) {
    var resolved = resolveDataset(dataset);

    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>';

    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + escapeXml(SHEET_NAME) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';

    var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>';

    var files = [
      { name: '[Content_Types].xml', data: utf8Encode(contentTypes) },
      { name: '_rels/.rels', data: utf8Encode(rootRels) },
      { name: 'xl/workbook.xml', data: utf8Encode(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8Encode(workbookRels) },
      { name: 'xl/worksheets/sheet1.xml', data: utf8Encode(buildSheetXml(resolved)) }
    ];
    return zipStore(files);
  }

  function exportXlsx(dataset) {
    var bytes = buildXlsxBytes(dataset);
    return new Blob([bytes], { type: MIME_XLSX });
  }

  // Скачивание Blob через временную ссылку (только браузер).
  function download(blob, filename) {
    if (typeof document === 'undefined' || !document.createElement) {
      throw new Error('download доступен только в браузере');
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'data';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  // =====================================================================
  // Публичный API
  // =====================================================================

  var DataIO = {
    version: '1.0.0',
    mime: { xlsx: MIME_XLSX, txt: MIME_TXT, csv: MIME_CSV },

    parseText: parseText,
    parseCsv: parseCsv,
    parseXlsx: parseXlsx,
    readFile: readFile,
    normalizeSeries: normalizeSeries,

    exportTxt: exportTxt,
    exportCsv: exportCsv,
    exportXlsx: exportXlsx,
    download: download,

    // Внутренние хелперы — используются в самопроверке (_tests/io.test.js).
    _internal: {
      crc32: crc32,
      zipStore: zipStore,
      unzip: readZip,
      parseNumber: parseNumber,
      detectDelimiter: detectDelimiter,
      splitLine: splitLine,
      matrixToParsed: matrixToParsed,
      decodeBytes: decodeBytes,
      utf8Encode: utf8Encode,
      utf8Decode: utf8Decode
    }
  };

  root.DataIO = DataIO;
})(typeof globalThis !== 'undefined' ? globalThis : this);
