import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT = path.join(DATA_DIR, 'latest.json');
const EIA_API_KEY = process.env.EIA_API_KEY || '';

const SOURCES = [
  {
    id: 1,
    title: 'EIA Open Data API',
    description: 'Series diarias de Brent y WTI obtenidas desde la API abierta de la U.S. Energy Information Administration.',
    url: 'https://www.eia.gov/opendata/'
  },
  {
    id: 2,
    title: 'Eurostat API',
    description: 'API pública usada para HICP y otras estadísticas europeas.',
    url: 'https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-introduction'
  },
  {
    id: 3,
    title: 'Eurostat dataset nrg_stk_oem',
    description: 'Existencias petrolíferas en días equivalentes, incluyendo existencias de emergencia y nivel mínimo.',
    url: 'https://ec.europa.eu/eurostat/databrowser/view/nrg_stk_oem/default/table?lang=en'
  },
  {
    id: 4,
    title: 'MITECO / Geoportal de Hidrocarburos — precios de carburantes',
    description: 'Servicio público con precios diarios de estaciones de servicio en España.',
    url: 'https://datos.gob.es/es/catalogo/e05068001-precio-de-carburantes-en-las-gasolineras-espanolas'
  },
  {
    id: 5,
    title: 'Comisión Europea — Weekly Oil Bulletin',
    description: 'Boletín semanal oficial con precios al consumidor de productos petrolíferos en la UE.',
    url: 'https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en'
  },
  {
    id: 6,
    title: 'Eurostat dataset prc_hicp_midx',
    description: 'Índice armonizado de precios al consumo para alimentos, energía, electricidad, gas y combustibles líquidos.',
    url: 'https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_midx/default/table?lang=en'
  },
  {
    id: 7,
    title: 'VesselFinder Embed Map',
    description: 'Documentación oficial del mapa embebible usado para visualizar tráfico AIS en el Estrecho de Ormuz.',
    url: 'https://www.vesselfinder.com/embed'
  }
];

function isoNow() {
  return new Date().toISOString();
}

function makeError(scope, error) {
  return {
    scope,
    message: error?.message || String(error),
  };
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} al consultar ${url}`);
  }
  return res.json();
}

async function fetchText(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} al consultar ${url}`);
  }
  return res.text();
}

async function fetchBuffer(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} al descargar ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function toNumberEs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .trim()
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.+-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toNumberLoose(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).trim().replace(/[^0-9.+-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeEuroLitre(value) {
  if (value == null) return null;
  let n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 20) n = n / 1000;
  else if (n > 5) n = n / 100;
  return Number(n.toFixed(3));
}

function normalizePeriod(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{6}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
  return raw;
}

function periodTimestamp(value) {
  const raw = normalizePeriod(value);
  if (!raw) return 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return Date.parse(`${raw}T00:00:00Z`) || 0;
  if (/^\d{4}-\d{2}$/.test(raw)) return Date.parse(`${raw}-01T00:00:00Z`) || 0;
  return Date.parse(raw) || 0;
}

function sortByDateAsc(points) {
  return [...points].sort((a, b) => periodTimestamp(a.date) - periodTimestamp(b.date));
}

function dedupePoints(points) {
  const map = new Map();
  for (const p of points) {
    const date = normalizePeriod(p?.date);
    if (!date || p.value == null || !Number.isFinite(Number(p.value))) continue;
    map.set(String(date), { date: String(date), value: Number(p.value) });
  }
  return sortByDateAsc([...map.values()]);
}

function lastPoint(points) {
  if (!Array.isArray(points) || !points.length) return null;
  return sortByDateAsc(points).at(-1) || null;
}

function jsonStatToRows(dataset) {
  if (!dataset?.dimension) return [];
  const ids = dataset.id || Object.keys(dataset.dimension);
  const dims = ids.map((id, idx) => {
    const dim = dataset.dimension[id];
    const category = dim.category || {};
    const labels = category.label || {};
    const indexObj = category.index || {};
    const keys = Array.isArray(indexObj)
      ? indexObj
      : Object.keys(indexObj).sort((a, b) => Number(indexObj[a]) - Number(indexObj[b]));
    const size = dataset.size?.[idx] ?? keys.length;
    return { id, keys, labels, size };
  });

  const total = dims.reduce((acc, d) => acc * d.size, 1);
  const rows = [];
  for (let linear = 0; linear < total; linear++) {
    const rawValue = Array.isArray(dataset.value) ? dataset.value[linear] : dataset.value?.[String(linear)];
    if (rawValue == null) continue;
    let remainder = linear;
    const row = { value: Number(rawValue) };
    for (let i = dims.length - 1; i >= 0; i--) {
      const dim = dims[i];
      const idx = remainder % dim.size;
      remainder = Math.floor(remainder / dim.size);
      const key = dim.keys[idx];
      row[dim.id] = key;
      row[`${dim.id}Label`] = dim.labels?.[key] ?? key;
    }
    rows.push(row);
  }
  return rows;
}

function buildSeriesFromRows(rows, metricKeyMap) {
  const map = new Map();
  for (const row of rows) {
    const sourceMetric = row.coicop || row.coicopLabel || '';
    const metricKey = metricKeyMap[sourceMetric] || metricKeyMap[row.coicopLabel] || metricKeyMap[row.coicop] || null;
    if (!metricKey) continue;
    const geo = row.geo;
    const geoLabel = row.geoLabel || geo;
    const date = normalizePeriod(row.time || row.TIME_PERIOD || row.timeLabel || row.period);
    const value = Number(row.value);
    if (!geo || !date || !Number.isFinite(value)) continue;
    const id = `${metricKey}::${geo}`;
    if (!map.has(id)) {
      map.set(id, { metricKey, label: metricLabel(metricKey), geo, geoLabel, points: [] });
    }
    map.get(id).points.push({ date, value });
  }
  return [...map.values()].map((entry) => ({ ...entry, points: dedupePoints(entry.points) }));
}

function metricLabel(metricKey) {
  return {
    food: 'Alimentos y bebidas no alcohólicas',
    energy: 'Electricidad, gas y otros combustibles',
    electricity: 'Electricidad',
    gas: 'Gas',
    liquidFuels: 'Combustibles líquidos',
  }[metricKey] || metricKey;
}

function avg(values) {
  const clean = values.filter((n) => n != null && Number.isFinite(n));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function parseEiaV2Payload(payload) {
  const rows = payload?.response?.data || [];
  return dedupePoints(
    rows
      .map((row) => {
        const date = normalizePeriod(row.period || row.date || row.week || row.month);
        const value = Number(row.value ?? row.price ?? row.PET_RWTC_D ?? row.PET_RBRTE_D);
        return date && Number.isFinite(value) ? { date, value } : null;
      })
      .filter(Boolean)
  );
}

function parseEiaV1Payload(payload) {
  const raw = payload?.series?.[0]?.data || [];
  return dedupePoints(
    raw
      .map((row) => {
        if (!Array.isArray(row) || row.length < 2) return null;
        const date = normalizePeriod(row[0]);
        const value = Number(row[1]);
        return date && Number.isFinite(value) ? { date, value } : null;
      })
      .filter(Boolean)
  );
}

async function fetchEIASeries(seriesId) {
  if (!EIA_API_KEY) throw new Error('Falta EIA_API_KEY');

  const v2Url = new URL(`https://api.eia.gov/v2/seriesid/${seriesId}`);
  v2Url.searchParams.set('api_key', EIA_API_KEY);
  v2Url.searchParams.set('out', 'json');
  v2Url.searchParams.set('sort[0][column]', 'period');
  v2Url.searchParams.set('sort[0][direction]', 'asc');
  v2Url.searchParams.set('offset', '0');
  v2Url.searchParams.set('length', '365');

  try {
    const payload = await fetchJson(v2Url.toString());
    const points = parseEiaV2Payload(payload);
    if (points.length) return points;
  } catch {
    // fallback below
  }

  const v1Url = new URL('https://api.eia.gov/series/');
  v1Url.searchParams.set('api_key', EIA_API_KEY);
  v1Url.searchParams.set('series_id', seriesId);
  const fallbackPayload = await fetchJson(v1Url.toString());
  const fallbackPoints = parseEiaV1Payload(fallbackPayload);
  if (!fallbackPoints.length) {
    throw new Error(`La EIA no devolvió observaciones para ${seriesId}`);
  }
  return fallbackPoints;
}

async function fetchSpainFuels() {
  const url = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
  const payload = await fetchJson(url);
  const rows = payload?.ListaEESSPrecio || payload?.listaEESSPrecio || [];
  const fuels = [
    ['gasolina95E5', 'Gasolina 95 E5', 'Precio Gasolina 95 E5'],
    ['gasolina98E5', 'Gasolina 98 E5', 'Precio Gasolina 98 E5'],
    ['gasoleoA', 'Gasóleo A', 'Precio Gasoleo A'],
    ['glp', 'GLP', 'Precio Gases licuados del petróleo'],
  ];

  const averages = fuels.map(([key, label, field]) => {
    const values = rows.map((row) => toNumberEs(row[field])).filter((x) => x != null && x > 0);
    return {
      key,
      label,
      value: values.length ? Number(avg(values).toFixed(3)) : null,
      stations: values.length,
    };
  });

  return {
    updatedAt: isoNow(),
    rawDate: payload?.Fecha || payload?.fecha || null,
    stationCount: rows.length,
    averages,
    url,
  };
}

async function fetchEurostatInflation() {
  const url = new URL('https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_midx');
  url.searchParams.set('format', 'JSON');
  url.searchParams.set('lang', 'EN');
  url.searchParams.set('freq', 'M');
  url.searchParams.set('unit', 'I15');
  url.searchParams.append('geo', 'ES');
  url.searchParams.append('geo', 'EU27_2020');
  ['CP01', 'CP045', 'CP0451', 'CP0452', 'CP04521', 'CP0453'].forEach((c) => url.searchParams.append('coicop', c));
  url.searchParams.set('lastTimePeriod', '24');
  const payload = await fetchJson(url.toString());
  const rows = jsonStatToRows(payload);
  const metricMap = {
    CP01: 'food',
    CP045: 'energy',
    CP0451: 'electricity',
    CP0452: 'gas',
    CP04521: 'gas',
    CP0453: 'liquidFuels',
    'Food and non-alcoholic beverages': 'food',
    'Electricity, gas and other fuels': 'energy',
    Electricity: 'electricity',
    'Natural gas and town gas': 'gas',
    Gas: 'gas',
    'Liquid fuels': 'liquidFuels',
  };
  return {
    updatedAt: isoNow(),
    series: buildSeriesFromRows(rows, metricMap),
    url: url.toString(),
  };
}

function labelBag(row) {
  return Object.entries(row)
    .filter(([k]) => /Label$/.test(k) || ['stock_flow', 'stock_flowLabel', 'siec', 'siecLabel', 'nrg_bal', 'nrg_balLabel'].includes(k))
    .map(([, v]) => String(v))
    .join(' | ')
    .toLowerCase();
}

function stockSeries(rows, typeLabelRegex, typeKey) {
  const grouped = new Map();
  for (const row of rows) {
    const bag = labelBag(row);
    if (!typeLabelRegex.test(bag)) continue;
    const geo = row.geo;
    const geoLabel = row.geoLabel || geo;
    const date = normalizePeriod(row.time || row.period || row.TIME_PERIOD);
    const value = Number(row.value);
    if (!geo || !date || !Number.isFinite(value)) continue;
    if (!grouped.has(geo)) grouped.set(geo, { geo, geoLabel, type: typeKey, points: [] });
    grouped.get(geo).points.push({ date, value });
  }
  return [...grouped.values()].map((entry) => ({ ...entry, points: dedupePoints(entry.points) }));
}

async function fetchEurostatStocks() {
  const url = new URL('https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_stk_oem');
  url.searchParams.set('format', 'JSON');
  url.searchParams.set('lang', 'EN');
  url.searchParams.set('freq', 'M');
  url.searchParams.set('unit', 'NR');
  url.searchParams.append('geo', 'ES');
  url.searchParams.append('geo', 'EU27_2020');
  url.searchParams.set('lastTimePeriod', '24');
  const payload = await fetchJson(url.toString());
  const rows = jsonStatToRows(payload);
  const emergency = stockSeries(rows, /emergency stocks held/, 'emergency');
  const minimum = stockSeries(rows, /minimum stock level/, 'minimum');
  return {
    updatedAt: isoNow(),
    emergency,
    minimum,
    url: url.toString(),
  };
}

function extractHrefs(html) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ href, text });
  }
  return out;
}

function resolveUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function findWobLinks(html, baseUrl) {
  const links = extractHrefs(html).map((x) => ({ ...x, href: resolveUrl(baseUrl, x.href) }));
  const xlsxLinks = links.filter((x) => /\.xlsx\b/i.test(x.href) || /filename=.*\.xlsx/i.test(x.href));
  const latest = xlsxLinks.find((x) => /prices with taxes latest prices|latest prices/i.test(`${x.text} ${x.href}`.toLowerCase()));
  const history = xlsxLinks.find((x) => /price developments 2005 onwards|history/i.test(`${x.text} ${x.href}`.toLowerCase()));
  return {
    latest: latest?.href || null,
    history: history?.href || null,
    all: xlsxLinks,
  };
}

function workbookRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
}

function sanitizeCell(v) {
  return String(v ?? '').trim();
}

function findHeaderIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const line = rows[i].map(sanitizeCell).join(' | ').toLowerCase();
    if ((/country|member state|member states|countries/.test(line)) && (/diesel|gasoil|euro.?super|petrol|unleaded/.test(line))) {
      return i;
    }
  }
  return -1;
}

function headerToMap(header) {
  return header.map((cell, idx) => ({ idx, text: sanitizeCell(cell), low: sanitizeCell(cell).toLowerCase() }));
}

function findColumn(cols, regexes) {
  for (const re of regexes) {
    const hit = cols.find((c) => re.test(c.low));
    if (hit) return hit.idx;
  }
  return -1;
}

function parseWeeklyOilBulletinRows(rows) {
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) throw new Error('No se encontró cabecera reconocible en el XLSX del Weekly Oil Bulletin');
  const cols = headerToMap(rows[headerIndex]);
  const countryCol = findColumn(cols, [/^country$/, /member state/, /countries/]);
  const petrolCol = findColumn(cols, [/euro.?super\s*95/, /unleaded\s*95/, /gasoline\s*95/, /petrol\s*95/]);
  const dieselCol = findColumn(cols, [/gasoil.*automobile/, /automotive diesel/, /^diesel$/, /diesel/i]);
  if (countryCol < 0 || petrolCol < 0 || dieselCol < 0) {
    throw new Error('No se localizaron las columnas de país, gasolina 95 y diésel');
  }

  const records = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const country = sanitizeCell(row[countryCol]);
    if (!country) continue;
    if (/^source|^notes?|^weekly oil bulletin/i.test(country.toLowerCase())) continue;
    const petrol = normalizeEuroLitre(toNumberLoose(row[petrolCol]));
    const diesel = normalizeEuroLitre(toNumberLoose(row[dieselCol]));
    if (petrol == null && diesel == null) continue;
    records.push({ country, petrol, diesel });
  }
  return records;
}

function pickCountry(records, patterns) {
  return records.find((r) => patterns.some((re) => re.test(r.country.toLowerCase()))) || null;
}

async function fetchWeeklyOilBulletin() {
  const pageUrl = 'https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en';
  const html = await fetchText(pageUrl);
  const links = findWobLinks(html, pageUrl);
  const latestUrl = links.latest;
  const historyFallback = links.history || null;

  const tryUrls = [latestUrl, historyFallback].filter(Boolean);
  let parseErrors = [];
  let records = [];
  let usedUrl = null;

  for (const url of tryUrls) {
    try {
      const buffer = await fetchBuffer(url);
      const candidate = parseWeeklyOilBulletinRows(workbookRows(buffer));
      if (candidate.length) {
        records = candidate;
        usedUrl = url;
        break;
      }
    } catch (error) {
      parseErrors.push(makeError(`weeklyOilBulletin.${url === latestUrl ? 'latest' : 'history'}`, error));
    }
  }

  const spain = pickCountry(records, [/^spain$/, /^espa(ñ|n)a$/]);
  const eu = pickCountry(records, [/european union/, /eu average/, /eu weighted average/, /eu weekly average/, /^eu\s*27$/, /^eur\s*27/, /^eu$/]);

  return {
    updatedAt: isoNow(),
    pageUrl,
    xlsxUrl: usedUrl,
    averages: [
      {
        key: 'eurosuper95',
        label: 'Gasolina 95',
        euAverage: eu?.petrol ?? null,
        spain: spain?.petrol ?? null,
      },
      {
        key: 'diesel',
        label: 'Diésel',
        euAverage: eu?.diesel ?? null,
        spain: spain?.diesel ?? null,
      },
    ],
    parseErrors,
  };
}

function summarize(result) {
  const brent = lastPoint(result.oil?.brent || []);
  const wti = lastPoint(result.oil?.wti || []);
  const sp95 = result.fuelsSpain?.averages?.find((x) => x.key === 'gasolina95E5')?.value ?? null;
  const sd = result.fuelsSpain?.averages?.find((x) => x.key === 'gasoleoA')?.value ?? null;
  const eu95 = result.fuelsEurope?.averages?.find((x) => x.key === 'eurosuper95')?.euAverage ?? null;
  const euDiesel = result.fuelsEurope?.averages?.find((x) => x.key === 'diesel')?.euAverage ?? null;
  const esStock = lastPoint(result.stocks?.emergency?.find((x) => x.geo === 'ES')?.points || []);
  const euStock = lastPoint(result.stocks?.emergency?.find((x) => x.geo === 'EU27_2020')?.points || []);
  return {
    brentSpotUsdBbl: brent?.value ?? null,
    wtiSpotUsdBbl: wti?.value ?? null,
    spainGasoline95EurL: sp95,
    spainDieselEurL: sd,
    euGasoline95EurL: eu95,
    euDieselEurL: euDiesel,
    spainEmergencyStocksDays: esStock?.value ?? null,
    euEmergencyStocksDays: euStock?.value ?? null,
  };
}

async function main() {
  await ensureDir(DATA_DIR);
  const errors = [];
  const result = {
    generatedAt: isoNow(),
    sources: SOURCES,
    oil: { brent: [], wti: [] },
    fuelsSpain: { updatedAt: null, rawDate: null, stationCount: 0, averages: [], url: null },
    fuelsEurope: { updatedAt: null, pageUrl: null, xlsxUrl: null, averages: [], parseErrors: [] },
    inflation: { updatedAt: null, series: [], url: null },
    stocks: { updatedAt: null, emergency: [], minimum: [], url: null },
    errors,
    summary: {},
  };

  try {
    result.oil.brent = await fetchEIASeries('PET.RBRTE.D');
  } catch (error) {
    errors.push(makeError('eia.brent', error));
  }

  try {
    result.oil.wti = await fetchEIASeries('PET.RWTC.D');
  } catch (error) {
    errors.push(makeError('eia.wti', error));
  }

  try {
    result.fuelsSpain = await fetchSpainFuels();
  } catch (error) {
    errors.push(makeError('miteco.fuelsSpain', error));
  }

  try {
    result.fuelsEurope = await fetchWeeklyOilBulletin();
    if (Array.isArray(result.fuelsEurope.parseErrors) && result.fuelsEurope.parseErrors.length) {
      errors.push(...result.fuelsEurope.parseErrors);
    }
  } catch (error) {
    errors.push(makeError('eu.weeklyOilBulletin', error));
  }

  try {
    result.inflation = await fetchEurostatInflation();
  } catch (error) {
    errors.push(makeError('eurostat.inflation', error));
  }

  try {
    result.stocks = await fetchEurostatStocks();
  } catch (error) {
    errors.push(makeError('eurostat.stocks', error));
  }

  result.summary = summarize(result);
  await fs.writeFile(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`Escrito ${OUTPUT}`);
  if (errors.length) {
    console.log(`Con ${errors.length} incidencias:`);
    for (const error of errors) {
      console.log(`- ${error.scope}: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
