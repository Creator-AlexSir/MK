# -*- coding: utf-8 -*-
"""Генератор фикстур для самопроверки MK-main/io.js.
Запуск:  python make_fixtures.py   (из папки _tests/fixtures)
Создаёт data.csv, data_semicolon.csv, data.txt, data.xlsx.
XLSX собирается вручную через zipfile (ZIP_DEFLATED) — без openpyxl,
чтобы тест проверял именно свой ZIP/XML-парсер.
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))


def write_text(name, content):
    path = os.path.join(HERE, name)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(content)
    print('written:', name)


# ---------------------------------------------------------------- CSV (запятая)
write_text('data.csv', '\r\n'.join([
    't,x,y,z',
    '0,1.250000,0.500000,-1.000000',
    '1,2.375000,1.100000,-0.750000',
    '2,3.500000,1.900000,0.250000',
    '3,4.125000,2.400000,1.500000',
    '4,5.000000,3.000000,2.750000',
    'см. методичку',   # мусорная строка -> skipped=1
    '',
]))

# ------------------------------------------------- CSV (; и десятичная запятая)
write_text('data_semicolon.csv', '\r\n'.join([
    't;x;y;z',
    '0;1,25;0,5;-1',
    '1;2,375;1,1;-0,75',
    '2;3,5;1,9;0,25',
    '3;4,125;2,4;1,5',
    '4;5;3;2,75',
    '',
]))

# ------------------------------------------------------- TXT (пробелы, шапка)
write_text('data.txt', '\r\n'.join([
    't x y z',
    '0 1.5 2.5 3.5',
    '1 2.5 3.5 4.5',
    '2 3.5 4.5 5.5',
    'мусорная строка',  # мусор -> skipped=1
    '3 4.5 5.5 6.5',
    '4 5.5 6.5 7.5',
    '',
]))

# --------------------------------------------------------------- XLSX (deflate)
SHARED = ['t', 'x', 'y', 'z']
ROWS = [
    ['0', '1.25', '0.5', '-1'],
    ['1', '2.375', '1.1', '-0.75'],
    ['2', '3.5', '1.9', '0.25'],
    ['3', '4.125', '2.4', '1.5'],
    ['4', '5', '3', '2.75'],
]


def col_letter(idx):
    s = ''
    n = idx + 1
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def shared_strings_xml():
    items = ''.join('<si><t>%s</t></si>' % s for s in SHARED)
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'count="%d" uniqueCount="%d">%s</sst>'
            % (len(SHARED), len(SHARED), items))


def sheet_xml():
    parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
             '<dimension ref="A1:D%d"/>' % (len(ROWS) + 1),
             '<sheetData>']
    # шапка через sharedStrings (t="s")
    parts.append('<row r="1">')
    for i, _ in enumerate(SHARED):
        parts.append('<c r="%s1" t="s"><v>%d</v></c>' % (col_letter(i), i))
    parts.append('</row>')
    for ri, row in enumerate(ROWS, start=2):
        parts.append('<row r="%d">' % ri)
        for ci, val in enumerate(row):
            parts.append('<c r="%s%d"><v>%s</v></c>' % (col_letter(ci), ri, val))
        parts.append('</row>')
    parts.append('</sheetData></worksheet>')
    return ''.join(parts)


CONTENT_TYPES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>'''

ROOT_RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''

WORKBOOK = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Данные" sheetId="1" r:id="rId1"/></sheets>
</workbook>'''

WORKBOOK_RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>'''

XLSX_PARTS = [
    ('[Content_Types].xml', CONTENT_TYPES),
    ('_rels/.rels', ROOT_RELS),
    ('xl/workbook.xml', WORKBOOK),
    ('xl/_rels/workbook.xml.rels', WORKBOOK_RELS),
    ('xl/worksheets/sheet1.xml', sheet_xml()),
    ('xl/sharedStrings.xml', shared_strings_xml()),
]

xlsx_path = os.path.join(HERE, 'data.xlsx')
with zipfile.ZipFile(xlsx_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for name, content in XLSX_PARTS:
        z.writestr(name, content.encode('utf-8'))
print('written: data.xlsx (deflate, sharedStrings)')
