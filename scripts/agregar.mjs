#!/usr/bin/env node
// Agregador del panel de canales. Node 22, sin dependencias. Idempotente.
// Lee ~/.claude/canales/canales.json y los repos de cada canal; escribe data/panel.json
// y copia las últimas capturas de Studio a data/capturas/.
//
// Uso:
//   node scripts/agregar.mjs                      → data/panel.json (completo, para local)
//   node scripts/agregar.mjs --salida <dir>       → <dir>/panel.json + <dir>/capturas/
//   node scripts/agregar.mjs --salida <dir> --publico
//       versión para internet: si PANEL_PUBLICO no es "1", omite estrategia y plan.
// Variables: CANALES_DIR (por defecto ~/.claude/canales).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const META = { subs: 1000, vistas90d: 10_000_000, horas: 4000 };
const HORAS_SIN_SESION = 6;
const DIA = 86_400_000;

function args(argv) {
  const a = { salida: path.join(RAIZ, 'data'), publico: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--salida') a.salida = path.resolve(argv[++i]);
    else if (argv[i] === '--publico') a.publico = true;
  }
  return a;
}

const leerJSON = (f) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
};
const leerTexto = (f) => {
  try { return fs.readFileSync(f, 'utf8'); } catch { return null; }
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dirs = (d) => {
  try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
};
const archivos = (d) => {
  try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name); } catch { return []; }
};
const fechaISO = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------- métricas ----------
function leerMetricas(repo) {
  const base = path.join(repo, 'salida', 'metricas');
  const dias = dirs(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const serie = [];
  let ultimo = null;
  let ultimoDir = null;
  for (const d of dias) {
    const m = leerJSON(path.join(base, d, 'metricas.json'));
    if (!m) continue;
    const p = m.progresoYPP || {};
    serie.push({
      fecha: m.fecha || d,
      subs: num(m.subs),
      vistas: vistasCanal(m),
      horas: num(p.horas12m) ?? num(m.horasTotales),
      vistas90d: num(p.vistasShorts90d),
      horas12m: num(p.horas12m),
    });
    ultimo = m;
    ultimoDir = path.join(base, d);
  }
  return { serie, ultimo, ultimoDir, base, dias };
}

// Vistas del canal: el total público llega con atraso respecto de la suma por video; se usa el mayor.
function vistasCanal(m) {
  const tot = num(m.vistasTotales);
  const vids = Array.isArray(m.videos) ? m.videos.map((v) => num(v.vistas)).filter((v) => v != null) : [];
  const suma = vids.length ? vids.reduce((a, b) => a + b, 0) : null;
  if (tot == null) return suma;
  return suma == null ? tot : Math.max(tot, suma);
}

// Vistas de Shorts en 90 días: la de Studio si existe; si no, suma de los Shorts del JSON
// publicados en los últimos 90 días; si no, vistas totales. Siempre dice de dónde salió.
function vistas90d(m, ahora) {
  const p = m.progresoYPP || {};
  if (num(p.vistasShorts90d) != null) return { valor: p.vistasShorts90d, fuente: 'Studio' };
  const vids = Array.isArray(m.videos) ? m.videos : [];
  const cortos = vids.filter((v) => v.tipo !== 'largo' && num(v.vistas) != null &&
    (!v.publicadoEn || ahora - Date.parse(v.publicadoEn) <= 90 * DIA));
  if (cortos.length) return { valor: cortos.reduce((s, v) => s + v.vistas, 0), fuente: 'suma de Shorts (90 d)' };
  if (num(m.vistasTotales) != null) return { valor: m.vistasTotales, fuente: 'vistas totales' };
  return { valor: null, fuente: null };
}

function calcularProgreso(subs, v90, horas) {
  const cS = Math.min(1, (subs ?? 0) / META.subs);
  const cV = Math.min(1, (v90 ?? 0) / META.vistas90d);
  const cH = Math.min(1, (horas ?? 0) / META.horas);
  const ruta = cH > cV ? 'horas' : 'shorts';
  return { total: 0.5 * cS + 0.5 * Math.max(cV, cH), subs: cS, vistas: cV, horas: cH, ruta };
}

// Ritmo de los últimos 7 días con la serie; con un solo punto, desde la creación del canal.
function calcularRitmo(serie, actual, fechaCreacion, ahora) {
  const conSubs = serie.filter((s) => s.subs != null);
  const ult = conSubs.at(-1);
  let subsDia = null, vistasDia = null, horasDia = null, base = null;
  if (ult) {
    const tUlt = Date.parse(ult.fecha);
    const desde = conSubs.filter((s) => Date.parse(s.fecha) >= tUlt - 7 * DIA);
    const ini = desde[0];
    const dias = (tUlt - Date.parse(ini.fecha)) / DIA;
    if (dias >= 1) {
      subsDia = (ult.subs - ini.subs) / dias;
      if (ult.vistas != null && ini.vistas != null) vistasDia = (ult.vistas - ini.vistas) / dias;
      if (ult.horas != null && ini.horas != null) horasDia = (ult.horas - ini.horas) / dias;
      base = `últimos ${Math.round(dias)} d`;
    } else if (fechaCreacion) {
      const vida = Math.max(1, (Date.parse(ult.fecha) - Date.parse(fechaCreacion)) / DIA + 1);
      subsDia = ult.subs / vida;
      if (ult.vistas != null) vistasDia = ult.vistas / vida;
      if (ult.horas != null) horasDia = ult.horas / vida;
      base = `desde la creación (${Math.round(vida)} d)`;
    }
  }
  // Fecha estimada: hace falta llegar a 1.000 subs Y a una de las dos rutas.
  let llegada = null, diasFaltan = null;
  if (subsDia > 0 && actual.subs != null) {
    const dSubs = Math.max(0, (META.subs - actual.subs) / subsDia);
    const rutas = [];
    if (vistasDia > 0 && actual.vistas90d != null) rutas.push(Math.max(0, (META.vistas90d - actual.vistas90d) / vistasDia));
    if (horasDia > 0 && actual.horas != null) rutas.push(Math.max(0, (META.horas - actual.horas) / horasDia));
    if (rutas.length) {
      diasFaltan = Math.ceil(Math.max(dSubs, Math.min(...rutas)));
      const desde = Date.parse(ult.fecha);
      if (diasFaltan < 365 * 50) llegada = fechaISO(desde + diasFaltan * DIA);
    }
  }
  return { subsDia, vistasDia, horasDia, base, llegada, diasFaltan };
}

// ---------- plan semanal ----------
function leerPlan(repo) {
  const t = leerTexto(path.join(repo, 'docs', 'PLAN-SEMANAL.md'));
  if (t == null) return { estado: 'sin plan', ranuras: [] };
  const bloques = [...t.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  for (const b of bloques) {
    try {
      const j = JSON.parse(b[1]);
      const arr = Array.isArray(j) ? j : (j.ranuras || j.semana || j.plan || null);
      if (Array.isArray(arr)) {
        const ranuras = arr.filter((r) => r && typeof r === 'object').map((r) => ({
          fecha: r.fecha ?? r.dia ?? null,
          hora: r.hora ?? null,
          formato: r.formato ?? null,
          plantilla: r.plantilla ?? null,
          tema: r.tema ?? r.titulo ?? r.idea ?? null,
          tipo: r.tipo ?? null,
          serie: r.serie ?? null,
          estado: r.estado ?? null,
          fuente: r.fuente ?? r.contingencia?.url ?? null,
          contingencia: r.contingencia?.hecho ?? null,
          videoId: r.videoId ?? null,
          porQue: r.porQue ?? null,
          bloqueo: r.bloqueo ?? null,
        })).sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
        const semanas = Array.isArray(j?.semanas) ? j.semanas : [];
        return { estado: 'ok', actualizado: j?.actualizado ?? null, semanas, ranuras };
      }
    } catch { /* bloque inválido: probar el siguiente */ }
  }
  return { estado: 'plan sin bloque json', ranuras: [] };
}

// ---------- estrategia ----------
function limpiarMd(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\p{Extended_Pictographic}️?/gu, '').replace(/[ \t]+/g, ' ').trim();
}
function recortar(s, max) {
  if (s.length <= max) return s;
  const c = s.slice(0, max);
  const corte = Math.max(c.lastIndexOf('\n'), c.lastIndexOf('. '));
  return (corte > max * 0.6 ? c.slice(0, corte + 1) : c).trimEnd() + ' …';
}
function leerEstrategia(repo, ahora) {
  const f = path.join(repo, 'docs', 'ESTRATEGIA.md');
  const t = leerTexto(f);
  if (t == null) return null;
  const lineas = t.split('\n');
  // objetivo = primera cita (líneas seguidas que empiezan con '>')
  let objetivo = null;
  const i0 = lineas.findIndex((l) => /^\s*>/.test(l));
  if (i0 >= 0) {
    const cita = [];
    for (let i = i0; i < lineas.length && /^\s*>/.test(lineas[i]); i++) cita.push(lineas[i].replace(/^\s*>\s?/, ''));
    objetivo = recortar(limpiarMd(cita.join(' ')), 500);
  }
  // resumen = sección "## 1"
  let resumen = null;
  const i1 = lineas.findIndex((l) => /^##\s*1\b/.test(l));
  if (i1 >= 0) {
    const cuerpo = [];
    for (let i = i1 + 1; i < lineas.length && !/^##\s/.test(lineas[i]); i++) cuerpo.push(lineas[i]);
    resumen = recortar(cuerpo.map((l) => limpiarMd(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim(), 1200);
  }
  const tituloSeccion = i1 >= 0 ? limpiarMd(lineas[i1].replace(/^##\s*/, '')) : null;
  let actualizada = null;
  try {
    actualizada = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%cI', '--', 'docs/ESTRATEGIA.md'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { /* sin git */ }
  if (!actualizada) { try { actualizada = fs.statSync(f).mtime.toISOString(); } catch { /* nada */ } }
  const diasDesde = actualizada ? Math.floor((ahora - Date.parse(actualizada)) / DIA) : null;
  return { objetivo, tituloSeccion, resumen, actualizada, diasDesde };
}

// ---------- bandeja ----------
function leerBandeja(repo, ahora) {
  const d = path.join(repo, 'salida', 'bandeja');
  const items = [];
  for (const f of archivos(d).filter((n) => n.endsWith('.json'))) {
    const j = leerJSON(path.join(d, f));
    if (!j) continue;
    const cuando = j.publicarEn || (j.programado ? j.programado.replace(' ', 'T') + ':00-03:00' : null);
    items.push({
      id: j.id || f.replace(/\.json$/, ''),
      titulo: j.titulo || null,
      estado: j.estado || null,
      tipo: j.tipo || null,
      plantilla: j.plantilla || null,
      publicarEn: cuando,
      url: j.url || (j.videoId ? `https://youtube.com/shorts/${j.videoId}` : null),
    });
  }
  const t = (x) => (x.publicarEn ? Date.parse(x.publicarEn) : NaN);
  const proximos = items.filter((x) => t(x) > ahora).sort((a, b) => t(a) - t(b));
  const sinFecha = items.filter((x) => !x.publicarEn && x.estado !== 'subido');
  return { proximos: proximos.slice(0, 8), totalProximos: proximos.length, enCola: sinFecha.length };
}

// ---------- trabajando ahora ----------
function leerEstado(dirCanales, slug, ahora) {
  const e = leerJSON(path.join(dirCanales, 'estado', `${slug}.json`));
  if (!e) return { activo: false, motivo: 'sin archivo de estado' };
  const t = Date.parse(e.actualizado || e.desde || '');
  const activo = Number.isFinite(t) && ahora - t <= HORAS_SIN_SESION * 3_600_000;
  return {
    activo,
    motivo: activo ? null : 'sin sesión activa',
    tarea: e.tarea ?? null,
    detalle: e.detalle ?? null,
    desde: e.desde ?? null,
    actualizado: e.actualizado ?? null,
    agentes: Array.isArray(e.agentes) ? e.agentes.map((a) => ({ modelo: a.modelo ?? null, tarea: a.tarea ?? null })) : [],
  };
}

// ---------- capturas ----------
function copiarCapturas(met, slug, destino) {
  const out = [];
  const tipos = [['monetizacion', /^2-monetizacion\.png$/], ['overview', /^1-overview\.png$/]];
  for (const [nombre, re] of tipos) {
    for (const d of [...met.dias].reverse()) {
      const f = archivos(path.join(met.base, d)).find((n) => re.test(n));
      if (!f) continue;
      const rel = `capturas/${slug}-${nombre}.png`;
      const dst = path.join(destino, rel);
      const src = path.join(met.base, d, f);
      const sst = fs.statSync(src);
      let dstSt = null; try { dstSt = fs.statSync(dst); } catch { /* no existe */ }
      if (!dstSt || dstSt.size !== sst.size || dstSt.mtimeMs < sst.mtimeMs) fs.copyFileSync(src, dst);
      out.push({ tipo: nombre, fecha: d, archivo: `data/${rel}` });
      break;
    }
  }
  return out;
}

// ---------- mejoras (revisiones en markdown) ----------
const SECCIONES_MEJORAS = { detectado: 'detectado', mejorado: 'mejorado', 'herramientas exploradas': 'herramientas', herramientas: 'herramientas', agregado: 'agregado', pendiente: 'pendiente' };
function parsearRevision(texto) {
  const dia = { detectado: [], mejorado: [], herramientas: [], agregado: [], pendiente: [], notas: [] };
  let clave = null, hayEncabezados = false, ultima = null;
  const libres = [];
  for (const l of texto.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) {
      const k = SECCIONES_MEJORAS[sinTilde(limpiarMd(h[1]))];
      clave = k ?? null; ultima = null;
      if (k) hayEncabezados = true;
      continue;
    }
    if (/^#{1,6}\s/.test(l)) { if (!/^#{3,}/.test(l)) { clave = null; } ultima = null; continue; }
    const b = /^[-*]\s+(.*\S)\s*$/.exec(l);
    if (b) {
      const v = limpiarMd(b[1]);
      ultima = v ? { lista: clave ? dia[clave] : libres, i: (clave ? dia[clave] : libres).push(v) - 1 } : null;
    } else if (ultima && /^\s+\S/.test(l) && !/^\s+[-*]\s/.test(l)) {
      ultima.lista[ultima.i] += ' ' + limpiarMd(l);   // continuación de una viñeta
    } else if (!/^\s+[-*]\s/.test(l)) ultima = null;
  }
  const hayAlgo = ['detectado', 'mejorado', 'herramientas', 'agregado', 'pendiente'].some((k) => dia[k].length);
  if (!hayEncabezados || !hayAlgo) dia.notas = libres.length ? libres : [];
  return dia;
}
function leerMejoras(repo, rutaRel, ahora) {
  const vacio = { ultima: null, dias: [], totales: { detectado: 0, mejorado: 0, herramientas: 0, agregado: 0 } };
  try {
    const dir = path.join(repo, rutaRel || 'salida/revisiones');
    if (!fs.existsSync(dir)) return vacio;
    const limite = ahora - 14 * DIA;
    const archivos = fs.readdirSync(dir).map((f) => /^(\d{4}-\d{2}-\d{2})\.md$/.exec(f)).filter(Boolean)
      .filter((m) => Date.parse(m[1] + 'T12:00:00-03:00') >= limite).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 5);
    const dias = [];
    for (const m of archivos) {
      const t = leerTexto(path.join(dir, m[0]));
      if (t == null) continue;
      dias.push({ fecha: m[1], ...parsearRevision(t) });
    }
    const totales = { detectado: 0, mejorado: 0, herramientas: 0, agregado: 0 };
    for (const d of dias) for (const k of Object.keys(totales)) totales[k] += d[k].length;
    return { ultima: dias[0]?.fecha ?? null, dias, totales };
  } catch { return vacio; }
}
const sinTilde = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// ---------- avisos y autorizaciones ----------
// Solo activos/pendientes y los respondidos/cerrados en las últimas 24 h; los vencidos no salen.
function leerAvisos(dirCanales, ahora) {
  const j = leerJSON(path.join(dirCanales, 'avisos.json'));
  const lista = Array.isArray(j?.avisos) ? j.avisos : [];
  return lista.filter((a) => {
    if (!a || !a.id) return false;
    if (a.vence && Date.parse(a.vence) <= ahora) return false;
    if (a.estado === 'activo' || a.estado === 'pendiente') return true;
    if (a.estado === 'autorizado' || a.estado === 'rechazado') return a.respondido && ahora - Date.parse(a.respondido) <= DIA;
    return false;
  }).sort((x, y) => (Date.parse(y.creado) || 0) - (Date.parse(x.creado) || 0));
}

// ---------- canal ----------
function armarCanal(c, dirCanales, destino, ahora) {
  const repoOk = c.repo && fs.existsSync(c.repo);
  const met = repoOk ? leerMetricas(c.repo) : { serie: [], ultimo: null, dias: [] };
  const m = met.ultimo;
  const canal = {
    slug: c.slug, nombre: c.nombre, handle: c.handle ?? null, canalId: c.canalId ?? null,
    color: c.color ?? '#898781', nicho: c.nicho ?? null, fechaCreacion: c.fechaCreacion ?? null,
    url: c.handle ? `https://www.youtube.com/${c.handle}` : (c.canalId ? `https://www.youtube.com/channel/${c.canalId}` : null),
    diasDeVida: c.fechaCreacion ? Math.floor((ahora - Date.parse(c.fechaCreacion + 'T00:00:00-03:00')) / DIA) + 1 : null,
    repoEncontrado: !!repoOk,
    datos: !!m,
  };
  if (m) {
    const v90 = vistas90d(m, ahora);
    const horas = num(m.progresoYPP?.horas12m) ?? num(m.horasTotales);
    canal.fechaDatos = m.fecha;
    canal.generadoDatos = m.generadoEn ?? null;
    canal.actual = {
      subs: num(m.subs), vistasTotales: vistasCanal(m), horas, videosPublicados: num(m.videosPublicados),
      vistas90d: v90.valor, fuenteVistas90d: v90.fuente, fuenteNumeros: m.fuentes?.numeros ?? null,
    };
    canal.vistas28d = num(m.vistas28d); canal.vistas48h = num(m.vistas48h);
    canal.progreso = calcularProgreso(canal.actual.subs, v90.valor, horas);
    canal.ritmo = calcularRitmo(met.serie, { subs: canal.actual.subs, vistas90d: v90.valor, horas }, c.fechaCreacion, ahora);
    const prev = met.serie.length > 1 ? met.serie.at(-2) : null;
    canal.tendencia = prev ? {
      subs: canal.actual.subs != null && prev.subs != null ? canal.actual.subs - prev.subs : null,
      vistas: canal.actual.vistasTotales != null && prev.vistas != null ? canal.actual.vistasTotales - prev.vistas : null,
      vs: prev.fecha,
    } : null;
    canal.serie = met.serie.map((s) => ({ fecha: s.fecha, subs: s.subs, vistas: s.vistas, horas: s.horas }));
    canal.videos = (Array.isArray(m.videos) ? m.videos : []).map((v) => ({
      id: v.id, titulo: v.titulo ?? null, vistas: num(v.vistas), publicadoEn: v.publicadoEn ?? null,
      tipo: v.tipo ?? null, url: v.id ? (v.tipo === 'largo' ? `https://youtu.be/${v.id}` : `https://youtube.com/shorts/${v.id}`) : null,
    })).filter((v) => v.publicadoEn && v.vistas != null)
      .sort((a, b) => (Date.parse(b.publicadoEn) || 0) - (Date.parse(a.publicadoEn) || 0)).slice(0, 6);
    canal.capturas = copiarCapturas(met, c.slug, destino);
  } else {
    canal.capturas = [];
    canal.videos = [];
    canal.serie = [];
  }
  canal.bandeja = repoOk ? leerBandeja(c.repo, ahora) : { proximos: [], totalProximos: 0, enCola: 0 };
  canal.plan = repoOk ? leerPlan(c.repo) : { estado: 'sin plan', ranuras: [] };
  canal.estrategia = repoOk ? leerEstrategia(c.repo, ahora) : null;
  canal.mejoras = repoOk ? leerMejoras(c.repo, c.revisiones, ahora) : leerMejoras('/nonexistent', null, ahora);
  canal.trabajando = leerEstado(dirCanales, c.slug, ahora);
  return canal;
}


// ---------- resumen para la página (data/resumen.json) ----------
function variacion(serie, campo, dias) {
  const ult = serie.filter((s) => s[campo] != null).at(-1);
  if (!ult) return null;
  const t = Date.parse(ult.fecha);
  const previos = serie.filter((s) => s[campo] != null && Date.parse(s.fecha) < t);
  if (!previos.length) return null;
  const objetivo = t - dias * DIA;
  const cand = previos.filter((s) => Date.parse(s.fecha) <= objetivo).at(-1) ?? previos[0];
  return { delta: ult[campo] - cand[campo], dias: Math.round((t - Date.parse(cand.fecha)) / DIA), desde: cand.fecha };
}
function resumenCanal(c, serieMin) {
  const a = c.actual || {};
  const vistas = a.vistasTotales && a.vistasTotales > 0 ? a.vistasTotales : null;
  // horas: dato inconsistente si hay horas pero cero vistas
  const horas = a.horas != null && (vistas != null || a.horas < 100) ? a.horas : null;
  const s = vistas == null ? [] : serieMin.filter((x) => x.vistas !== 0);
  return {
    slug: c.slug, nombre: c.nombre, handle: c.handle, url: c.url, color: c.color, nicho: c.nicho,
    avatar: `avatares/${c.slug}.jpg`,
    fechaDatos: c.fechaDatos ?? null, medidoEn: c.generadoDatos ?? null,
    subs: a.subs ?? null, vistas, videos: a.videosPublicados ?? null, horas,
    vistas28d: c.vistas28d ?? null, vistas48h: c.vistas48h ?? null,
    varSubs: { ayer: variacion(serieMin, 'subs', 1), sem: variacion(serieMin, 'subs', 7) },
    varVistas: { ayer: variacion(s, 'vistas', 1), sem: variacion(s, 'vistas', 7) },
  };
}

export function agregar(opciones = {}) {
  const a = { ...args([]), ...opciones };
  const ahora = Date.now();
  const dirCanales = process.env.CANALES_DIR || path.join(os.homedir(), '.claude', 'canales');
  const reg = leerJSON(path.join(dirCanales, 'canales.json'));
  const lista = Array.isArray(reg) ? reg : (reg?.canales ?? []);
  fs.mkdirSync(path.join(a.salida, 'capturas'), { recursive: true });

  const canales = lista.filter((c) => c && c.slug).map((c) => armarCanal(c, dirCanales, a.salida, ahora));

  // Ranking: progreso; desempate por subs/día (7 d). Sin datos, al final.
  const orden = [...canales].sort((x, y) => {
    if (x.datos !== y.datos) return x.datos ? -1 : 1;
    const d = (y.progreso?.total ?? 0) - (x.progreso?.total ?? 0);
    if (Math.abs(d) > 1e-12) return d;
    return (y.ritmo?.subsDia ?? 0) - (x.ritmo?.subsDia ?? 0);
  });
  orden.forEach((c, i) => { c.posicion = c.datos ? i + 1 : null; });

  const privado = a.publico && process.env.PANEL_PUBLICO !== '1';
  if (privado) for (const c of canales) { delete c.estrategia; delete c.plan; }

  const calendario = leerJSON(path.join(dirCanales, 'calendario.json'));
  const panel = {
    version: 1,
    generadoEn: new Date(ahora).toISOString(),
    zona: 'America/Santiago',
    meta: META,
    formulaProgreso: '0,5·min(1, subs/1000) + 0,5·min(1, max(vistas90d/10M, horas/4000))',
    publico: !!a.publico,
    omitido: privado ? ['estrategia', 'plan'] : [],
    ranking: orden.map((c) => c.slug),
    canales: orden,
    calendario: calendario ?? null,
    avisos: leerAvisos(dirCanales, ahora),
  };
  const res = canales.map((c) => resumenCanal(c, c.serie || []));
  const suma = (k) => res.reduce((t, r) => t + (r[k] ?? 0), 0);
  fs.writeFileSync(path.join(a.salida, 'resumen.json'), JSON.stringify({
    generadoEn: new Date(ahora).toISOString(), zona: 'America/Santiago',
    totales: { subs: suma('subs'), vistas: suma('vistas'), videos: suma('videos'), horas: suma('horas'), canales: res.length },
    canales: res,
  }, null, 2));
  const destino = path.join(a.salida, 'panel.json');
  const tmp = destino + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(panel, null, 2));
  fs.renameSync(tmp, destino);
  return { destino, panel };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { destino, panel } = agregar(args(process.argv.slice(2)));
  const res = panel.canales.map((c) => `${c.posicion ?? '-'} ${c.nombre}: ${c.datos ? `${(c.progreso.total * 100).toFixed(2)} % · ${c.actual.subs} subs` : 'sin datos todavía'}`);
  console.log(`panel.json → ${destino}\n  ${res.join('\n  ')}`);
}
