# chart.js — заметки для интеграции

Движок графиков на canvas. Глобальный `window.ChartKit`, без зависимостей.
Файл: `MK-main/chart.js`. Тестовая страница: `MK-main/_tests/chart.html` (открыть как файл, без сервера).

## API

```js
var chart = ChartKit.line(container, cfg);     // контейнер — DOM-элемент, не jQuery
var phase = ChartKit.phase3d(container, cfg);

chart.update(cfg);          // частичное обновление (объекты сливаются, массивы заменяются)
chart.destroy();            // снять ResizeObserver/обработчики, убрать canvas
chart.toDataURL();          // PNG dataURL, белый фон
chart.resize();           // принудительная перерисовка (без анимации)
chart.setSeriesVisible(i, false);  // скрыть/показать серию (у phase3d — траекторию)
```

`line` и `phase3d` возвращают одинаковый набор методов `{update, destroy, toDataURL, resize, setSeriesVisible}`.

## cfg для line

```js
{
  height: 380,
  xLabel: 't', yLabel: 'значение',
  xFormat: v => ..., yFormat: v => ...,
  series: [{
    name: 'xₜ', color: '#2563eb', data: [[0, 1.2], ...],
    kind: 'line' | 'area' | 'scatter',
    width: 2.6, dash: null | [6, 4], markers: false,
    fillOpacity: 0.14,
    smooth: true,
    preserveOrder: false      // true — НЕ сортировать точки по x (фазовые портреты)
  }],
  yZero: false, animate: true, legend: true, tooltip: true,
  grid: { x: true, y: true },
  emptyText: 'Нет данных для отображения'
}
```

- `preserveOrder: true` — точки рисуются в исходном порядке (x может быть немонотонным),
  Catmull-Rom по умолчанию выключен, тултип ищет ближайшую точку по 2D-расстоянию.
  Для фазовых портретов (x–y, x–z, y–z) передавать `preserveOrder: true, smooth: false`.
  Без флага точки сортируются по x (обычные временные ряды).
- Оси: диапазон = данные + отступ (X 2 %, Y 4.5 %); подписи — «круглые» 1/2/5×10ⁿ внутри
  диапазона, поэтому нет пустого «воздуха» до −5…15 при данных 0.37…12.
- Прореживание: при >~2.2 точках на пиксель рисуется прореженный набор, тултип/легенда
  работают по исходным данным.
- Пустые/битые данные (`NaN`, `null`, отсутствие серий) не ломают отрисовку.

## cfg для phase3d

```js
{
  points: [[x, y, z], ...],       // траектория в порядке интегрирования
  labels: { x: 'x', y: 'y', z: 'z' },
  height: 460,
  autoRotate: true, autoRotateSpeed: 0.28,
  animate: true,
  colorFrom: '#38bdf8', colorTo: '#1d4ed8',   // градиент по времени
  axes: true, tooltip: false,
  startYaw: 0.45, startPitch: 0.3,
  maxPoints: 3200,
  emptyText: 'Нет данных для отображения'
}
```

- Масштаб автоматически подгоняется под фактический bounding box спроецированных точек
  (отступы ~4–9 %), поэтому аттрактор заполняет карточку; колесо мыши умножает этот масштаб
  (`zoom` 0.45…3.5), drag — вращение, двойной клик — сброс вида.
- Точки сортируются по глубине, цвет — линейный градиент по времени, старт/конец помечены.
- Рамка-параллелепипед с делениями и подписями осей; подписи прижимаются внутрь canvas.

## Ограничения

- Числа на осях по умолчанию форматируются `trimNum` (точка как десятичный разделитель),
  формат можно переопределить через `xFormat`/`yFormat`.
- `tooltip` рисуется на canvas (не DOM), поэтому вне canvas подсказок нет.
- Шрифт — системный Segoe UI/Inter; внешних ресурсов нет.
- `toDataURL` возвращает PNG текущего состояния при DPR устройства.
