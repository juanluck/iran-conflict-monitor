const charts = {};

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    return new Date(`${y}-${m}-${d}T00:00:00Z`);
  }
  if (/^\d{6}$/.test(raw)) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    return new Date(`${y}-${m}-01T00:00:00Z`);
  }
  if (/^\d{4}-\d{2}$/.test(raw)) return new Date(`${raw}-01T00:00:00Z`);
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, includeTime = false) {
  if (!value) return 'Sin fecha';
  const date = parseDateValue(value);
  if (!date) return String(value);
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: includeTime ? 'short' : undefined,
  }).format(date);
}

function formatMonth(value) {
  const d = parseDateValue(value);
  return !d ? String(value) : new Intl.DateTimeFormat('es-ES', { month: 'short', year: '2-digit' }).format(d);
}

function formatCurrency(value, unit) {
  return value == null ? '—' : `${Number(value).toFixed(2)} ${unit}`;
}

function formatEuroL(value) {
  return value == null ? '—' : `${Number(value).toFixed(3)} €/L`;
}

function deltaPct(latest, previous) {
  if (latest == null || previous == null || previous === 0) return null;
  return ((latest - previous) / previous) * 100;
}

function sortPoints(points) {
  return [...(points || [])].sort((a, b) => {
    const da = parseDateValue(a.date)?.getTime() ?? 0;
    const db = parseDateValue(b.date)?.getTime() ?? 0;
    return da - db;
  });
}

function latestPoint(points) {
  return Array.isArray(points) && points.length ? sortPoints(points).at(-1) : null;
}

function pointDaysAgo(points, days) {
  if (!Array.isArray(points) || !points.length) return null;
  const sorted = sortPoints(points);
  const lastDate = parseDateValue(sorted.at(-1)?.date);
  if (!lastDate) return null;
  const target = new Date(lastDate);
  target.setUTCDate(target.getUTCDate() - days);
  let candidate = sorted[0];
  for (const p of sorted) {
    const pDate = parseDateValue(p.date);
    if (pDate && pDate <= target) candidate = p;
  }
  return candidate;
}

function yoy(points) {
  if (!Array.isArray(points) || points.length < 13) return null;
  const sorted = sortPoints(points);
  return deltaPct(sorted.at(-1)?.value, sorted.at(-13)?.value);
}

function byMetric(data, metricKey, geo) {
  return data?.inflation?.series?.find((s) => s.metricKey === metricKey && s.geo === geo) || null;
}

function byStock(data, type, geo) {
  return data?.stocks?.[type]?.find((s) => s.geo === geo) || null;
}

function kpi(label, value, subtext, delta) {
  const cls = delta == null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const deltaHtml = delta == null ? '' : `<div class="delta ${cls}">${delta > 0 ? '+' : ''}${delta.toFixed(1)}%</div>`;
  return `<article class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${deltaHtml}<div class="kpi-subtext">${subtext || ''}</div></article>`;
}

function destroyChart(id) {
  if (charts[id]) charts[id].destroy();
}

function replaceCanvasWithPlaceholder(canvasId, message) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  destroyChart(canvasId);
  const wrap = canvas.parentElement;
  if (wrap) {
    wrap.innerHTML = `<div class="placeholder">${message}</div>`;
  }
}

function hasAnyNumber(values) {
  return (values || []).some((v) => v != null && Number.isFinite(Number(v)));
}

function lineChart(id, labels, datasets, yTick, tooltip) {
  const canvas = document.getElementById(id);
  if (!canvas || !window.Chart) return;
  const hasData = datasets.some((dataset) => hasAnyNumber(dataset.data));
  if (!labels.length || !hasData) {
    replaceCanvasWithPlaceholder(id, 'Todavía no hay suficientes datos para esta gráfica.');
    return;
  }
  destroyChart(id);
  charts[id] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#d9e6f7', usePointStyle: true } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${tooltip(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: '#9fb0c5', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9fb0c5', callback: (v) => yTick(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

function barChart(id, labels, datasets, yTick, tooltip) {
  const canvas = document.getElementById(id);
  if (!canvas || !window.Chart) return;
  const hasData = datasets.some((dataset) => hasAnyNumber(dataset.data));
  if (!labels.length || !hasData) {
    replaceCanvasWithPlaceholder(id, 'Todavía no hay suficientes datos para esta gráfica.');
    return;
  }
  destroyChart(id);
  charts[id] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#d9e6f7', usePointStyle: true } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${tooltip(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: '#9fb0c5' }, grid: { display: false } },
        y: { ticks: { color: '#9fb0c5', callback: (v) => yTick(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

function mapSeries(series, orderedDates) {
  const lookup = new Map((series || []).map((p) => [String(p.date), p.value]));
  return orderedDates.map((d) => lookup.get(String(d)) ?? null);
}

function renderKPIs(data) {
  const brent = data.oil?.brent || [];
  const wti = data.oil?.wti || [];
  const brentLast = latestPoint(brent);
  const wtiLast = latestPoint(wti);
  const spain95 = data.fuelsSpain?.averages?.find((x) => x.key === 'gasolina95E5');
  const spainDiesel = data.fuelsSpain?.averages?.find((x) => x.key === 'gasoleoA');
  const eu95 = data.fuelsEurope?.averages?.find((x) => x.key === 'eurosuper95');
  const euDiesel = data.fuelsEurope?.averages?.find((x) => x.key === 'diesel');
  const esStock = latestPoint(byStock(data, 'emergency', 'ES')?.points || []);
  const esMin = latestPoint(byStock(data, 'minimum', 'ES')?.points || []);
  const foodEs = yoy(byMetric(data, 'food', 'ES')?.points || []);
  const energyEs = yoy(byMetric(data, 'energy', 'ES')?.points || []);
  const spread = brentLast && wtiLast ? brentLast.value - wtiLast.value : null;
  const aboveMin = esStock && esMin ? esStock.value - esMin.value : null;
  const html = [
    kpi('Brent spot', formatCurrency(brentLast?.value, '$/bbl'), brentLast ? `Dato: ${formatDate(brentLast.date)}` : 'Sin datos', deltaPct(brentLast?.value, pointDaysAgo(brent, 7)?.value)),
    kpi('WTI spot', formatCurrency(wtiLast?.value, '$/bbl'), wtiLast ? `Dato: ${formatDate(wtiLast.date)}` : 'Sin datos', deltaPct(wtiLast?.value, pointDaysAgo(wti, 7)?.value)),
    kpi('Spread Brent-WTI', spread == null ? '—' : formatCurrency(spread, '$/bbl'), 'Prima de referencia global.', null),
    kpi('Gasolina 95 España', formatEuroL(spain95?.value), spain95 ? `${spain95.stations} estaciones con dato` : 'Sin datos', null),
    kpi('Gasóleo A España', formatEuroL(spainDiesel?.value), spainDiesel ? `${spainDiesel.stations} estaciones con dato` : 'Sin datos', null),
    kpi('Gasolina 95 UE', formatEuroL(eu95?.euAverage), eu95 ? `España: ${formatEuroL(eu95.spain)}` : 'Sin datos', null),
    kpi('Diésel UE', formatEuroL(euDiesel?.euAverage), euDiesel ? `España: ${formatEuroL(euDiesel.spain)}` : 'Sin datos', null),
    kpi('Reserva España', esStock ? `${esStock.value.toFixed(1)} días` : '—', aboveMin == null ? 'Sin umbral' : `${aboveMin >= 0 ? '+' : ''}${aboveMin.toFixed(1)} días sobre mínimo`, null),
    kpi('Alimentos España YoY', foodEs == null ? '—' : `${foodEs > 0 ? '+' : ''}${foodEs.toFixed(1)}%`, 'Variación interanual HICP.', foodEs),
    kpi('Energía España YoY', energyEs == null ? '—' : `${energyEs > 0 ? '+' : ''}${energyEs.toFixed(1)}%`, 'Electricidad, gas y otros combustibles.', energyEs),
  ].join('');
  document.getElementById('kpiGrid').innerHTML = html;
}

function renderOil(data) {
  const brent = data.oil?.brent || [];
  const wti = data.oil?.wti || [];
  const orderedDates = [...new Set([...brent.map((p) => String(p.date)), ...wti.map((p) => String(p.date))])].sort((a, b) => {
    const da = parseDateValue(a)?.getTime() ?? 0;
    const db = parseDateValue(b)?.getTime() ?? 0;
    return da - db;
  });
  lineChart('oilChart', orderedDates.map(formatDate), [
    { label: 'Brent', data: mapSeries(brent, orderedDates), borderColor: '#5eead4', backgroundColor: 'rgba(94,234,212,0.18)', borderWidth: 2.5, pointRadius: 0, tension: 0.25 },
    { label: 'WTI', data: mapSeries(wti, orderedDates), borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.18)', borderWidth: 2.5, pointRadius: 0, tension: 0.25 },
  ], (v) => `$${Number(v).toFixed(0)}`, (v) => formatCurrency(v, '$/bbl'));
}

function renderStocks(data) {
  const esE = byStock(data, 'emergency', 'ES')?.points || [];
  const esM = byStock(data, 'minimum', 'ES')?.points || [];
  const euE = byStock(data, 'emergency', 'EU27_2020')?.points || [];
  const euM = byStock(data, 'minimum', 'EU27_2020')?.points || [];
  const orderedDates = [...new Set([...esE.map((p) => String(p.date)), ...esM.map((p) => String(p.date)), ...euE.map((p) => String(p.date)), ...euM.map((p) => String(p.date))])].sort((a, b) => {
    const da = parseDateValue(a)?.getTime() ?? 0;
    const db = parseDateValue(b)?.getTime() ?? 0;
    return da - db;
  });
  lineChart('stocksChart', orderedDates.map(formatMonth), [
    { label: 'España · existencias', data: mapSeries(esE, orderedDates), borderColor: '#5eead4', borderWidth: 2.5, pointRadius: 0, tension: 0.2 },
    { label: 'España · mínimo', data: mapSeries(esM, orderedDates), borderColor: 'rgba(94,234,212,0.65)', borderDash: [7, 6], borderWidth: 2, pointRadius: 0, tension: 0 },
    { label: 'UE · existencias', data: mapSeries(euE, orderedDates), borderColor: '#60a5fa', borderWidth: 2.5, pointRadius: 0, tension: 0.2 },
    { label: 'UE · mínimo', data: mapSeries(euM, orderedDates), borderColor: 'rgba(96,165,250,0.7)', borderDash: [7, 6], borderWidth: 2, pointRadius: 0, tension: 0 },
  ], (v) => `${Number(v).toFixed(0)} d`, (v) => `${Number(v).toFixed(1)} días`);
}

function renderFuels(data) {
  const spain = data.fuelsSpain?.averages || [];
  const order = ['gasolina95E5', 'gasoleoA', 'gasolina98E5', 'glp'];
  const chosen = order.map((k) => spain.find((x) => x.key === k)).filter(Boolean);
  barChart('fuelChart', chosen.map((x) => x.label), [{ label: 'España', data: chosen.map((x) => x.value), backgroundColor: ['#5eead4', '#60a5fa', '#f59e0b', '#f472b6'], borderRadius: 10 }], (v) => `${Number(v).toFixed(2)} €`, formatEuroL);
  document.getElementById('fuelStats').innerHTML = chosen.length
    ? chosen.map((x) => `<div class="stat"><span class="label">${x.label}</span><span class="value">${formatEuroL(x.value)}</span><div>${x.stations} estaciones con dato</div></div>`).join('')
    : '<div class="placeholder">Todavía no hay datos agregados de carburantes en España.</div>';

  const eu = data.fuelsEurope?.averages || [];
  const euChosen = [eu.find((x) => x.key === 'eurosuper95'), eu.find((x) => x.key === 'diesel')].filter(Boolean);
  barChart('euFuelChart', euChosen.map((x) => x.label), [
    { label: 'UE media', data: euChosen.map((x) => x.euAverage), backgroundColor: '#60a5fa', borderRadius: 10 },
    { label: 'España', data: euChosen.map((x) => x.spain), backgroundColor: '#5eead4', borderRadius: 10 },
  ], (v) => `${Number(v).toFixed(2)} €`, formatEuroL);
  document.getElementById('euFuelStats').innerHTML = euChosen.length
    ? euChosen.map((x) => `<div class="stat"><span class="label">${x.label}</span><span class="value">UE: ${formatEuroL(x.euAverage)}</span><div>España: ${formatEuroL(x.spain)}</div></div>`).join('')
    : '<div class="placeholder">No se pudieron extraer todavía los precios semanales del Weekly Oil Bulletin.</div>';
}

function renderMetricChart(canvasId, data, metricKey, label) {
  const es = byMetric(data, metricKey, 'ES')?.points || [];
  const eu = byMetric(data, metricKey, 'EU27_2020')?.points || [];
  const orderedDates = [...new Set([...es.map((p) => String(p.date)), ...eu.map((p) => String(p.date))])].sort((a, b) => {
    const da = parseDateValue(a)?.getTime() ?? 0;
    const db = parseDateValue(b)?.getTime() ?? 0;
    return da - db;
  });
  lineChart(canvasId, orderedDates.map(formatMonth), [
    { label: `España · ${label}`, data: mapSeries(es, orderedDates), borderColor: '#5eead4', backgroundColor: 'rgba(94,234,212,0.18)', borderWidth: 2.5, pointRadius: 0, tension: 0.22 },
    { label: `UE · ${label}`, data: mapSeries(eu, orderedDates), borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.18)', borderWidth: 2.5, pointRadius: 0, tension: 0.22 },
  ], (v) => Number(v).toFixed(0), (v) => Number(v).toFixed(1));
}

function renderInsights(data) {
  const items = [];
  const brent = data.oil?.brent || [];
  const brentLast = latestPoint(brent);
  const brentWoW = deltaPct(brentLast?.value, pointDaysAgo(brent, 7)?.value);
  if (brentWoW != null) items.push(brentWoW > 5 ? `El Brent sube ${brentWoW.toFixed(1)}% frente a hace una semana, señal de tensión relevante en el mercado global.` : brentWoW < -5 ? `El Brent cae ${brentWoW.toFixed(1)}% frente a hace una semana, con cierta relajación respecto al pico reciente.` : `El Brent se mueve ${brentWoW.toFixed(1)}% en una semana; por ahora no hay un salto extremo en la referencia global.`);
  const esStock = latestPoint(byStock(data, 'emergency', 'ES')?.points || []);
  const esMin = latestPoint(byStock(data, 'minimum', 'ES')?.points || []);
  if (esStock && esMin) {
    const gap = esStock.value - esMin.value;
    items.push(gap >= 0 ? `España aparece ${gap.toFixed(1)} días por encima del mínimo de cumplimiento en existencias estratégicas.` : `España aparece ${Math.abs(gap).toFixed(1)} días por debajo del mínimo de cumplimiento.`);
  }
  const eu95 = data.fuelsEurope?.averages?.find((x) => x.key === 'eurosuper95');
  if (eu95?.euAverage != null && eu95?.spain != null) {
    const diff = eu95.spain - eu95.euAverage;
    items.push(diff > 0.02 ? `La gasolina 95 en España está ${formatEuroL(diff)} por encima de la media UE.` : diff < -0.02 ? `La gasolina 95 en España está ${formatEuroL(Math.abs(diff))} por debajo de la media UE.` : 'La gasolina 95 en España está muy cerca de la media semanal de la UE.');
  }
  const foodEs = yoy(byMetric(data, 'food', 'ES')?.points || []);
  const foodEu = yoy(byMetric(data, 'food', 'EU27_2020')?.points || []);
  if (foodEs != null && foodEu != null) {
    const gap = foodEs - foodEu;
    items.push(gap > 1 ? `La presión interanual sobre alimentos es más alta en España que en la UE (+${gap.toFixed(1)} p. p.).` : gap < -1 ? `La presión interanual sobre alimentos es más baja en España que en la UE (${gap.toFixed(1)} p. p.).` : 'La inflación alimentaria de España y la UE se mantiene en un rango parecido.');
  }
  const energyEs = yoy(byMetric(data, 'energy', 'ES')?.points || []);
  const energyEu = yoy(byMetric(data, 'energy', 'EU27_2020')?.points || []);
  if (energyEs != null && energyEu != null) {
    const gap = energyEs - energyEu;
    items.push(gap > 1 ? `La energía al consumidor crece más deprisa en España que en la UE (+${gap.toFixed(1)} p. p.).` : gap < -1 ? `La energía al consumidor crece más despacio en España que en la UE (${gap.toFixed(1)} p. p.).` : 'La dinámica reciente del componente energético es similar entre España y la UE.');
  }
  document.getElementById('insights').innerHTML = items.length ? items.map((x) => `<div class="insight-item">${x}</div>`).join('') : '<div class="placeholder">Todavía no hay suficiente información para generar observaciones.</div>';
}

function renderReferences(data) {
  document.getElementById('references').innerHTML = (data.sources || []).map((s) => `<li><strong>[${s.id}] ${s.title}</strong>${s.description ? ` — ${s.description}` : ''} ${s.url ? `<a href="${s.url}" target="_blank" rel="noopener noreferrer">Abrir fuente</a>` : ''}</li>`).join('');
}

async function load() {
  try {
    const res = await fetch('./data/latest.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    document.getElementById('generatedAt').textContent = data.generatedAt ? formatDate(data.generatedAt, true) : 'Pendiente';
    renderKPIs(data);
    renderOil(data);
    renderStocks(data);
    renderFuels(data);
    renderMetricChart('energyChart', data, 'energy', 'energía');
    renderMetricChart('foodChart', data, 'food', 'alimentos');
    renderInsights(data);
    renderReferences(data);
  } catch (err) {
    console.error(err);
    document.getElementById('generatedAt').textContent = 'Error al cargar';
    document.querySelectorAll('canvas').forEach((canvas) => {
      canvas.parentElement.innerHTML = '<div class="placeholder">No se pudo cargar <code>data/latest.json</code>. Ejecuta el workflow de GitHub Actions para poblar datos oficiales.</div>';
    });
    document.getElementById('fuelStats').innerHTML = '';
    document.getElementById('euFuelStats').innerHTML = '';
    document.getElementById('insights').innerHTML = '<div class="placeholder">Sin lectura rápida disponible hasta que haya datos.</div>';
  }
}

load();
