// Ciclo de datos del panel: medición horaria (API de YouTube), historial, puntajes y adelantamientos.
// Lo llama scripts/agregar.mjs (cron cada 30 min). Node 22, sin dependencias. Idempotente.
//
//   refrescarVivo()   → pide channels.list?part=statistics (1 unidad, los 4 canales en una llamada) como mucho
//                       1 vez por hora; guarda data/vivo.json. Si la API falla, queda lo último conocido.
//   procesar(salida)  → actualiza data/historial.json (sin duplicar), calcula puntajes y adelantamientos y
//                       los escribe en <salida>/ (+ parcha <salida>/resumen.json). Devuelve un hash de contenido.
//   publicarSiCambio  → si el hash cambió desde la última publicación, ejecuta scripts/publicar.sh.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cargarCriterios, tablaEn } from './puntaje.mjs';
import { medirComunidad, copiarComunidad } from './comunidad.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(RAIZ, 'data');
const DIA = 86_400_000, HORA = 3_600_000;
const INTERVALO_MIN = 55 * 60_000;       // no medir más de 1 vez por hora (el cron corre cada 30 min)
const REINTENTO_MIN = 10 * 60_000;       // tras un fallo de la API
// Repos con token de YouTube (el primero que sirva). Nunca se copia ni se reescribe: solo se lee.
const REPOS_TOKEN = ['/home/santiago/projects/yt/linea-punteada', '/home/santiago/projects/yt/bolita-lab'];

const leerJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const escribirJSON = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1)); fs.renameSync(t, f); };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dirCanales = () => process.env.CANALES_DIR || path.join(os.homedir(), '.claude', 'canales');
const CONFIG = path.join(RAIZ, 'config', 'canales.json');
// Lista de canales: el registro local (~/.claude/canales); en la nube, la copia pública config/canales.json.
const listaCanales = () => {
  const r = leerJSON(path.join(dirCanales(), 'canales.json'));
  const l = (Array.isArray(r) ? r : r?.canales ?? []).filter((c) => c && c.slug);
  if (l.length) {
    const pub = l.map(({ slug, nombre, handle, canalId, color, nicho, fechaCreacion }) => ({ slug, nombre, handle, canalId, color, nicho, fechaCreacion }));
    if (JSON.stringify(leerJSON(CONFIG)?.canales) !== JSON.stringify(pub)) escribirJSON(CONFIG, { _doc: 'Copia pública (sin rutas) del registro de canales; la usa el workflow de la nube. La regenera scripts/ciclo.mjs.', canales: pub });
    return l;
  }
  return leerJSON(CONFIG)?.canales ?? [];
};

// ---------- medición viva ----------
async function accessToken(repo) {
  const tok = leerJSON(path.join(repo, 'secrets', 'youtube-token.json'));
  const cli = leerJSON(path.join(repo, 'secrets', 'youtube-client.json'))?.installed;
  if (!tok || !cli) return null;
  if (tok.access_token && num(tok.expiry_date) && tok.expiry_date - Date.now() > 120_000) return tok.access_token;
  if (!tok.refresh_token) return null;
  const r = await fetch(cli.token_uri, { method: 'POST', signal: AbortSignal.timeout(20_000),
    body: new URLSearchParams({ client_id: cli.client_id, client_secret: cli.client_secret, refresh_token: tok.refresh_token, grant_type: 'refresh_token' }) });
  if (!r.ok) return null;
  return (await r.json()).access_token ?? null;
}

// Me gusta y comentarios totales = suma de statistics de TODOS los videos públicos del canal
// (lista de la playlist de subidas + videos.list en lotes de 50; ~2 unidades por cada 50 videos).
// Con token propio la playlist incluye privados/programados: se filtran por status.privacyStatus.
async function totalesDeVideos(id, headers, key) {
  const k = key ? '&key=' + encodeURIComponent(key) : '';
  const get = async (u) => { const r = await fetch(u + k, { headers, signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(u.split('?')[0].split('/').pop() + ' HTTP ' + r.status); return r.json(); };
  const ids = []; let pt = '';
  for (let i = 0; i < 40; i++) {
    const j = await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${'UU' + id.slice(2)}${pt ? '&pageToken=' + pt : ''}`);
    for (const it of j.items ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
    pt = j.nextPageToken; if (!pt) break;
  }
  let likes = 0, comentarios = 0, n = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50).join(',');
    let j; try { j = await get(`https://www.googleapis.com/youtube/v3/videos?part=statistics,status&id=${lote}`); } catch { j = await get(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${lote}`); }
    for (const v of j.items ?? []) {
      if (v.status && v.status.privacyStatus !== 'public') continue;
      likes += Number(v.statistics?.likeCount) || 0; comentarios += Number(v.statistics?.commentCount) || 0; n++;
    }
  }
  return { likes, comentarios, videosContados: n };
}

// Horas que YouTube cuenta para el YPP: minutos vistos en 365 días de todo lo que NO es Short
// (creatorContentType = videoOnDemand + liveStream; 'shorts' no cuenta). Solo con token con scope analytics.
async function horasValidasAnalytics(at, ahora) {
  const f = (ms) => new Date(ms).toISOString().slice(0, 10);
  const u = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${f(ahora - 365 * DIA)}&endDate=${f(ahora)}&metrics=estimatedMinutesWatched&dimensions=creatorContentType`;
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + at }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error('analytics HTTP ' + r.status);
  const j = await r.json();
  const min = (j.rows ?? []).filter((x) => x[0] !== 'shorts').reduce((t, x) => t + (Number(x[1]) || 0), 0);
  return Math.round(min / 60 * 100) / 100;
}

export async function refrescarVivo({ forzar = false, ahora = Date.now(), apiKey = null } = {}) {
  const f = path.join(DATA, 'vivo.json');
  const vivo = leerJSON(f) ?? { canales: {} };
  const medido = Date.parse(vivo.medidoEn || '');
  const intento = Date.parse(vivo.intentoEn || '');
  if (!forzar && Number.isFinite(medido) && ahora - medido < INTERVALO_MIN) return { medido: false, razon: 'medido hace < 55 min' };
  if (!forzar && vivo.error && Number.isFinite(intento) && ahora - intento < REINTENTO_MIN) return { medido: false, razon: 'reintento pendiente' };
  const ids = listaCanales().map((c) => c.canalId).filter(Boolean);
  vivo.intentoEn = new Date(ahora).toISOString();
  try {
    let at = null;
    if (!apiKey) {
      for (const repo of REPOS_TOKEN) { try { at = await accessToken(repo); } catch { /* siguiente */ } if (at) break; }
      if (!at) throw new Error('sin token de YouTube utilizable');
    }
    const cab = at ? { Authorization: 'Bearer ' + at } : {};
    const url = 'https://www.googleapis.com/youtube/v3/channels?part=statistics&id=' + ids.join(',') + (apiKey ? '&key=' + encodeURIComponent(apiKey) : '');
    const r = await fetch(url, { headers: at ? { Authorization: 'Bearer ' + at } : {}, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error('channels.list HTTP ' + r.status);
    const j = await r.json();
    const canales = {};
    for (const it of j.items ?? []) {
      const s = it.statistics ?? {};
      canales[it.id] = { subs: s.hiddenSubscriberCount ? null : Number(s.subscriberCount), vistas: Number(s.viewCount), videos: Number(s.videoCount) };
    }
    if (!Object.keys(canales).length) throw new Error('respuesta sin canales');
    // me gusta / comentarios totales (si falla un canal se conserva su último valor)
    const avisos = [];
    for (const id of Object.keys(canales)) {
      try { Object.assign(canales[id], await totalesDeVideos(id, cab, apiKey)); } catch (e) { avisos.push(`totales ${id}: ${e.message}`); }
    }
    // horas válidas para monetizar: cada token mide SU canal (channels.mine); sin token, se conserva el último valor
    const tokens = new Map();
    if (!apiKey) {
      const repos = [...new Set([...REPOS_TOKEN, ...listaCanales().map((c) => c.repo).filter(Boolean)])];
      for (const repo of repos) {
        try {
          const t = await accessToken(repo); if (!t) continue;
          const m = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', { headers: { Authorization: 'Bearer ' + t }, signal: AbortSignal.timeout(20_000) });
          const mid = (await m.json()).items?.[0]?.id;
          if (!mid || !canales[mid]) continue;
          tokens.set(mid, t);
          canales[mid].horasValidas = await horasValidasAnalytics(t, ahora);
          canales[mid].horasValidasEn = new Date(ahora).toISOString();
        } catch (e) { avisos.push(`horas ${path.basename(repo)}: ${e.message}`); }
      }
    }
    // comentarios recientes y últimos 3 videos (diálogos del panel); si falla un canal se conserva su archivo anterior
    try {
      const inf = await medirComunidad({ lista: listaCanales(), dir: DATA, tokens, key: apiKey, ahora });
      for (const [s, o] of Object.entries(inf)) for (const [k, v] of Object.entries(o)) if (k.startsWith('error')) avisos.push(`${s} ${k}: ${v}`);
    } catch (e) { avisos.push('comunidad: ' + e.message); }
    for (const [id, v] of Object.entries(canales)) vivo.canales[id] = { ...(vivo.canales[id] ?? {}), ...v };
    if (avisos.length) vivo.avisos = avisos.slice(0, 5); else delete vivo.avisos;
    vivo.medidoEn = new Date(ahora).toISOString();
    delete vivo.error;
    escribirJSON(f, vivo);
    return { medido: true, n: Object.keys(canales).length };
  } catch (e) {
    vivo.error = String(e.message || e).slice(0, 200);
    escribirJSON(f, vivo);
    return { medido: false, razon: 'API falló: ' + vivo.error + ' (se usa lo último conocido)' };
  }
}

// ---------- historial ----------
const CAMPOS = ['subs', 'vistas', 'videos', 'horas', 'vistas90d', 'likes', 'comentarios', 'horasValidas'];
function filasDeMetricas(c) {
  if (!c.repo) return { filas: [], ultimo: null };
  const base = path.join(c.repo, 'salida', 'metricas');
  let dias = [];
  try { dias = fs.readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort(); } catch { return { filas: [], ultimo: null }; }
  const filas = []; let ultimo = null;
  // Entender Chile: su repo estima las horas de LARGOS (vistas × duración × 40 %) en proyeccion.json
  const proy = new Map((leerJSON(path.join(base, 'proyeccion.json')) ?? []).filter((x) => x?.fecha && num(x.horasEst) != null).map((x) => [x.fecha, x.horasEst]));
  for (const d of dias) {
    const m = leerJSON(path.join(base, d, 'metricas.json'));
    if (!m || num(m.subs) == null) continue;
    const vids = Array.isArray(m.videos) ? m.videos.map((v) => num(v.vistas)).filter((v) => v != null) : [];
    const suma = vids.length ? vids.reduce((a, b) => a + b, 0) : null;
    const tot = num(m.vistasTotales);
    const t = Date.parse(m.generadoEn || '');
    const p = m.progresoYPP || {};
    filas.push({
      canal: c.slug, fuente: 'metricas', fecha: m.fecha || d,
      ts: new Date(Number.isFinite(t) ? t : Date.parse((m.fecha || d) + 'T12:00:00-03:00')).toISOString(),
      subs: num(m.subs), vistas: (() => { const v = tot == null ? suma : (suma == null ? tot : Math.max(tot, suma)); return v ? v : null; })(), // 0 = dato roto, no se guarda
      videos: num(m.videosPublicados), horas: num(p.horas12m) ?? num(m.horasTotales), vistas90d: num(p.vistasShorts90d),
      vistas28d: num(m.vistas28d),
      ...(proy.has(m.fecha || d) ? { horasValidas: proy.get(m.fecha || d), horasValidasFuente: 'estimado' } : {}),
    });
    ultimo = { m, d };
  }
  return { filas, ultimo };
}
// Fechas de publicación (ms) de los videos del último metricas.json, solo los ya publicados.
function publicaciones(ultimo) {
  const v = Array.isArray(ultimo?.m?.videos) ? ultimo.m.videos : [];
  return v.filter((x) => x && x.privado !== true).map((x) => Date.parse(x.publicadoEn || '')).filter(Number.isFinite);
}

// Entender Chile no tiene token de Analytics en el panel: usa lo que su repo ya estima (bitacora/metricas/proyeccion.json,
// horas de LARGOS = vistas × duración × 40 %). Devuelve el último valor, o null si el canal no tiene ese archivo.
function horasDeProyeccion(c) {
  if (!c.repo) return null;
  const l = leerJSON(path.join(c.repo, 'bitacora', 'metricas', 'proyeccion.json'));
  const u = Array.isArray(l) ? l.filter((x) => num(x?.horasEst) != null).at(-1) : null;
  return u ? { valor: u.horasEst, fecha: u.fecha } : null;
}

function actualizarHistorial(lista, vivo, remoto = null) {
  const f = path.join(DATA, 'historial.json');
  const h = leerJSON(f) ?? { version: 1, filas: [] };
  // las filas de metricas se reemplazan por (canal, fecha): una por día, siempre con el último contenido
  const propias = new Map(); // clave -> fila
  const clave = (r) => (r.fuente === 'metricas' ? `${r.canal}|m|${r.fecha}` : `${r.canal}|${r.ts}`);
  // filas publicadas (p. ej. por la nube) que este PC todavía no tiene; las locales mandan en los conflictos
  for (const r of remoto?.filas ?? []) propias.set(clave(r), r);
  for (const r of h.filas) propias.set(r.fuente === 'metricas' ? `${r.canal}|m|${r.fecha}` : `${r.canal}|${r.ts}`, r);
  const pubs = { ...(remoto?.publicaciones ?? {}), ...(h.publicaciones ?? {}) }, ultimos = {};
  for (const c of lista) {
    const { filas, ultimo } = filasDeMetricas(c);
    if (c.repo) { pubs[c.slug] = publicaciones(ultimo); ultimos[c.slug] = ultimo; }
    for (const r of filas) propias.set(`${c.slug}|m|${r.fecha}`, r);
  }
  let todas = [...propias.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  // filas vivas (API): solo si cambió algo respecto de la fila anterior del canal
  if (vivo?.medidoEn) {
    for (const c of lista) {
      const v = vivo.canales?.[c.canalId];
      if (!v || num(v.vistas) == null) continue;
      const ts = vivo.medidoEn;
      const previas = todas.filter((r) => r.canal === c.slug && r.ts <= ts);
      const ant = previas.at(-1);
      if (ant && ant.ts === ts) continue;
      const conHoras = [...previas].reverse();
      const acarrear = (k) => conHoras.find((r) => num(r[k]) != null)?.[k] ?? null;
      const proy = horasDeProyeccion(c);
      const horasDe = conHoras.find((r) => num(r.horas) != null);
      const fila = { canal: c.slug, fuente: 'api', ts, subs: num(v.subs) ?? ant?.subs ?? null, vistas: v.vistas, videos: num(v.videos),
        horas: acarrear('horas'), horasDe: horasDe ? (horasDe.horasDe ?? horasDe.ts) : null, vistas90d: acarrear('vistas90d'),
        likes: num(v.likes) ?? acarrear('likes'), comentarios: num(v.comentarios) ?? acarrear('comentarios'),
        horasValidas: num(v.horasValidas) ?? proy?.valor ?? acarrear('horasValidas'),
        horasValidasFuente: num(v.horasValidas) != null ? 'analytics' : proy ? 'estimado' : (conHoras.find((r) => num(r.horasValidas) != null)?.horasValidasFuente ?? null) };
      if (ant && CAMPOS.every((k) => (ant[k] ?? null) === (fila[k] ?? null))) continue;
      // el contador público de videos no cuenta programados/privados: si la fila anterior viene de métricas con otro conteo, se conserva el de métricas
      todas.push(fila); todas.sort((a, b) => a.ts.localeCompare(b.ts));
    }
  }
  const nuevo = { version: 1, nota: 'Una fila por canal y medición. fuente=metricas (1 por día, salida/metricas) o api (cada hora, solo si cambió).', publicaciones: pubs, filas: todas };
  if (JSON.stringify(nuevo.filas) !== JSON.stringify(h.filas) || JSON.stringify(pubs) !== JSON.stringify(h.publicaciones)) escribirJSON(f, nuevo);
  return { historial: nuevo, pubs, ultimos };
}

// ---------- puntajes, posiciones y adelantamientos ----------
const fechaHora = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms)).map((x) => [x.type, x.value.padStart(2, '0')]));
  return `${p.day}-${p.month} ${p.hour}:${p.minute}`;
};

function cambio(actual, antes, slug) {
  if (!antes) return { estado: 'sin-datos' };
  const a = antes.tabla.find((x) => x.slug === slug);
  if (!a) return { estado: 'nuevo', desde: antes.t };
  const d = a.posicion - actual.posicion; // positivo = subió
  return { estado: d > 0 ? 'sube' : d < 0 ? 'baja' : 'igual', puestos: Math.abs(d), posicion: a.posicion, puntos: Math.round((actual.puntaje - a.puntaje) * 100) / 100, desde: antes.t };
}

function calcular(lista, historial, pubs, ahora) {
  const criterios = cargarCriterios();
  const canales = lista.map((c) => ({ slug: c.slug, fechaCreacion: c.fechaCreacion, filas: historial.filas.filter((r) => r.canal === c.slug), pubs: pubs[c.slug] }));
  // instantes: cada hora redondeada donde hubo alguna fila
  const porHora = new Map();
  for (const r of historial.filas) { const t = Date.parse(r.ts); const k = Math.floor(t / HORA); porHora.set(k, Math.max(porHora.get(k) ?? 0, t)); }
  const ticks = [...porHora.values()].filter((t) => t <= ahora).sort((a, b) => a - b);
  const snaps = ticks.map((t) => ({ t, tabla: tablaEn(criterios, canales, t) }));
  const adelantamientos = [];
  for (let i = 1; i < snaps.length; i++) {
    const A = snaps[i - 1].tabla, B = snaps[i].tabla;
    for (const x of B) for (const y of B) {
      if (x.slug === y.slug || x.posicion >= y.posicion) continue; // x ahora está por delante de y
      const ax = A.find((z) => z.slug === x.slug), ay = A.find((z) => z.slug === y.slug);
      if (ax && ay && ax.posicion > ay.posicion) {
        const nx = lista.find((c) => c.slug === x.slug).nombre, ny = lista.find((c) => c.slug === y.slug).nombre;
        adelantamientos.push({ ts: new Date(snaps[i].t).toISOString(), cuando: fechaHora(snaps[i].t), supera: x.slug, a: y.slug, texto: `${nx} superó a ${ny}`, puntajes: { [x.slug]: x.puntaje, [y.slug]: y.puntaje } });
      }
    }
  }
  const actualTabla = tablaEn(criterios, canales, ahora);
  const antesDe = (ms) => {
    const objetivo = ahora - ms;
    const cand = [...snaps].reverse().find((s) => s.t <= objetivo && s.tabla.length);
    if (cand) return cand;
    const primero = snaps.find((s) => s.tabla.length);
    return primero && primero.t < ahora - ms * 0.4 ? primero : null; // historia más corta: se compara con lo más antiguo
  };
  // "vs. ayer": última medición ANTES de las 00:00 de hoy en America/Santiago (una comparación por día).
  const inicioDia = (ms) => {
    const f = (t) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t)).map((x) => [x.type, +x.value]));
    const p = f(ms);
    return ms - (((p.hour % 24) * 60 + p.minute) * 60 + p.second) * 1000 - (ms % 1000);
  };
  const medianoche = inicioDia(ahora);
  const sAyer = [...snaps].reverse().find((s) => s.t < medianoche && s.tabla.length) ?? null;
  const s24 = sAyer, s7 = antesDe(7 * DIA);
  const tabla = actualTabla.map((f) => {
    const c = lista.find((x) => x.slug === f.slug);
    return { ...f, nombre: c.nombre, handle: c.handle ?? null, color: c.color ?? '#888', avatar: `avatares/${c.slug}.jpg`,
      cambio24h: cambio(f, s24, f.slug), cambio7d: cambio(f, s7, f.slug) };
  });
  const ganador = tabla.filter((t) => t.ritmo?.puntaje != null).sort((a, b) => b.ritmo.puntaje - a.ritmo.puntaje)[0] ?? null;
  return { criterios, tabla, adelantamientos: adelantamientos.slice(-100).reverse(),
    ganadorSemana: ganador ? { slug: ganador.slug, nombre: ganador.nombre, ritmo: ganador.ritmo.puntaje, n: ganador.ritmo.n } : null,
    historialPuntajes: snaps.map((s) => ({ ts: new Date(s.t).toISOString(), p: Object.fromEntries(s.tabla.map((x) => [x.slug, x.puntaje])), r: Object.fromEntries(s.tabla.map((x) => [x.slug, x.ritmo.puntaje])) })) };
}

// ---------- parche del resumen ----------
function ultimaFila(filas, slug) { return filas.filter((r) => r.canal === slug).at(-1) ?? null; }
function variacion(filas, slug, campo, ms, ahora) {
  const fs_ = filas.filter((r) => r.canal === slug && num(r[campo]) != null);
  const ult = fs_.at(-1);
  if (!ult || fs_.length < 2) return null;
  const tUlt = Date.parse(ult.ts);
  const prev = fs_.filter((r) => Date.parse(r.ts) <= tUlt - ms).at(-1) ?? (tUlt - Date.parse(fs_[0].ts) >= ms * 0.4 ? fs_[0] : null);
  if (!prev) return null;
  return { delta: ult[campo] - prev[campo], dias: Math.max(1, Math.round((tUlt - Date.parse(prev.ts)) / DIA)), desde: prev.ts.slice(0, 10) };
}

// Historial ya publicado en gh-pages (p. ej. por el workflow de la nube): se funde antes de publicar desde el PC.
export function leerRemoto() {
  if (process.env.PANEL_SIN_RED) return null;
  try {
    const o = { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 };
    execFileSync('git', ['fetch', '-q', 'origin', 'gh-pages'], o);
    return JSON.parse(execFileSync('git', ['show', 'FETCH_HEAD:data/historial.json'], { ...o, maxBuffer: 64 << 20 }));
  } catch { return null; }
}

export function procesar(salida, ahora = Date.now(), { remoto = leerRemoto() } = {}) {
  const lista = listaCanales();
  const vivo = leerJSON(path.join(DATA, 'vivo.json'));
  const { historial, pubs } = actualizarHistorial(lista, vivo, remoto);
  const calc = calcular(lista, historial, pubs, ahora);
  fs.mkdirSync(salida, { recursive: true });
  const generadoEn = new Date(ahora).toISOString();
  escribirJSON(path.join(salida, 'historial.json'), historial);
  escribirJSON(path.join(salida, 'adelantamientos.json'), { generadoEn, eventos: calc.adelantamientos });
  const ult = historial.filas.at(-1)?.ts ?? null;
  const medidoEn = vivo?.medidoEn ?? ult;
  const proxima = medidoEn ? (() => { const m = Date.parse(medidoEn) + HORA; return new Date(Math.ceil(m / (30 * 60_000)) * 30 * 60_000).toISOString(); })() : null;
  // parche de resumen.json (lo escribe agregar.mjs justo antes)
  const fr = path.join(salida, 'resumen.json');
  const res = leerJSON(fr);
  if (res?.canales) {
    for (const c of res.canales) {
      const u = ultimaFila(historial.filas, c.slug);
      if (!u) continue;
      const tRes = Date.parse(c.medidoEn || ''), tU = Date.parse(u.ts);
      if (!Number.isFinite(tRes) || tU > tRes) {
        c.subs = u.subs ?? c.subs; c.vistas = u.vistas ?? c.vistas; c.videos = u.videos ?? c.videos; c.medidoEn = u.ts;
        if (u.horas != null && c.horas == null) c.horas = u.horas;
      }
      const hr = historial.filas.filter((r) => r.canal === c.slug && num(r.horas) != null).at(-1);
      if (hr) c.horasFecha = (hr.horasDe ?? hr.ts).slice(0, 10);
      const vs = (campo, ms) => variacion(historial.filas, c.slug, campo, ms, ahora);
      const ac = (k) => historial.filas.filter((r) => r.canal === c.slug && num(r[k]) != null).at(-1);
      c.likes = ac('likes')?.likes ?? null; c.comentarios = ac('comentarios')?.comentarios ?? null;
      const hv = ac('horasValidas');
      c.horasValidas = hv?.horasValidas ?? null; c.horasValidasFuente = hv?.horasValidasFuente ?? null; c.horasValidasFecha = hv ? hv.ts.slice(0, 10) : null;
      c.varSubs = { ayer: vs('subs', DIA), sem: vs('subs', 7 * DIA) };
      c.varVistas = { ayer: vs('vistas', DIA), sem: vs('vistas', 7 * DIA) };
    }
    const suma = (k) => res.canales.reduce((t, r) => t + (r[k] ?? 0), 0);
    res.totales = { subs: suma('subs'), vistas: suma('vistas'), videos: suma('videos'), horas: suma('horas'), likes: suma('likes'), comentarios: suma('comentarios'), canales: res.canales.length };
    res.actualizacion = { medidoEn, proxima, intervaloMin: 60, ultimaFila: ult, error: vivo?.error ?? null };
    res.generadoEn = generadoEn;
    escribirJSON(fr, res);
  }
  const firmaComunidad = copiarComunidad(DATA, salida);
  // hash de contenido: sin marcas de tiempo, para publicar solo si algo cambió
  const sig = JSON.stringify({
    c: (res?.canales ?? []).map((c) => [c.slug, c.subs, c.vistas, c.videos, c.horas, c.vistas28d, c.vistas48h, c.likes, c.comentarios, c.horasValidas]),
    p: calc.tabla.map((t) => [t.slug, t.puntaje, t.posicion, t.n]), a: calc.adelantamientos.map((a) => a.ts + a.texto), r: calc.tabla.map((t) => t.ritmo.puntaje), u: firmaComunidad,
  });
  const hash = crypto.createHash('sha1').update(sig).digest('hex');
  escribirJSON(path.join(salida, 'puntajes.json'), {
    hash, generadoEn, formula: 'promedio simple de los porcentajes de cada criterio con dato (data/criterios.json), cada uno con tope 100 %',
    criterios: calc.criterios, tabla: calc.tabla, ganadorSemana: calc.ganadorSemana, historial: calc.historialPuntajes.slice(-400),
  });
  return { hash, tabla: calc.tabla, ganador: calc.ganadorSemana, adelantamientos: calc.adelantamientos };
}

// ---------- publicación ----------
export function publicarSiCambio(hash) {
  const f = path.join(DATA, 'publicado.json');
  const est = leerJSON(f) ?? {};
  if (est.hash === hash) return { publicado: false, razon: 'sin cambios desde la última publicación' };
  const r = spawnSync('bash', [path.join(RAIZ, 'scripts', 'publicar.sh')], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, PANEL_PUBLICO: '1', PANEL_SIN_CICLO: '1' } });
  if (r.status !== 0) return { publicado: false, razon: 'publicar.sh falló: ' + (r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' | ') };
  escribirJSON(f, { hash, publicadoEn: new Date().toISOString() });
  return { publicado: true };
}
