#!/usr/bin/env node
// Vista "Guiones" del panel: cada ranura de publicación de cada canal y la línea de vida de su guion
//   idea → escrito → verificado → revisor → renderizado → programado → publicado (+ carátula en los largos).
// Escribe data/guiones/ranuras/index.json (resumen liviano, lo pinta la grilla) y data/guiones/ranuras/<canal>.json
// (detalle por ranura: texto del guion, revisor por criterio, verificación). Lo llama scripts/agregar.mjs (cron cada 30 min y
// publicar.sh) y scripts/servir.mjs (re-genera al vuelo si tiene > 2 min). SOLO LECTURA sobre los repos de los canales.
//
// Fuentes por canal (rutas relativas al repo del canal):
//   plan              docs/PLAN-SEMANAL.md (primer bloque ```json con ranuras[]); Entender Chile: contenido/semana/<jue>/*.json
//                     (+ contenido/borradores-semana/<jue>/*.json = rechazados por el revisor)
//   calendario        contenido/calendario.json (ranuras esperadas desde hoy; Entender Chile: Short 12:00 diario + largo mié 19:00)
//   guion             la ruta `guion` del plan, o el id de la bandeja buscado en contenido/{guiones,backlog,borradores,reserva,largos}
//   verificación      contenido/verificaciones/<id>.md | VERIFICACION-<id>.md; si no, lo que dejó el revisor (verificar-cifras,
//                     hechos verificados); Entender Chile: contenido/semana/<jue>/verificacion.md
//   revisor           salida/revisiones/guiones/<id>[.rondaN].json (se toma la ronda más alta); Entender Chile no tiene registro
//                     estructurado: lo que está en contenido/semana/ pasó el revisor según su flujo (docs/FLUJO.md), sin nota
//   render/programado salida/bandeja/<id>.json (+ .mp4), `videoId`/`publicarEn`; Entender Chile: contenido/semana/<jue>/hechos/<pieza>.txt
//   publicado         hora programada ya pasada (y confirmado con data/videos/<canal>.json cuando el id está ahí)
// Privacidad: el panel es público. Solo salen rutas relativas al repo, ids, textos de guiones (ya públicos en GitHub) y fechas;
// cualquier ruta /home/... o correo que aparezca dentro de un texto se recorta.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extraer, palabras } from './guiones.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZONA = 'America/Santiago';
const DIA = 864e5, MARGEN = 30 * 60e3;
const PALABRAS_POR_SEG = 2.5; // voz sintética en español, medida en los largos (≈150 palabras/min)

const leerJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const leerTxt = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const existe = (f) => { try { fs.accessSync(f); return true; } catch { return false; } };
const ls = (d, re = /\.json$/) => { try { return fs.readdirSync(d).filter((f) => re.test(f)).sort(); } catch { return []; } };
const lsDirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; } };
const S = (v) => (typeof v === 'string' ? v.trim() : '');

// ---------- fechas en Chile ----------
const fmtP = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
function partes(ms) {
  const o = Object.fromEntries(fmtP.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { fecha: `${o.year}-${o.month}-${o.day}`, hora: `${o.hour}:${o.minute}`, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
}
function chileAMs(fecha, hora = '12:00') {
  const [y, m, d] = fecha.split('-').map(Number), [hh, mm] = hora.split(':').map(Number);
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) { const p = partes(t); const [py, pm, pd] = p.fecha.split('-').map(Number); const [ph, pmi] = p.hora.split(':').map(Number); t += Date.UTC(y, m - 1, d, hh, mm) - Date.UTC(py, pm - 1, pd, ph, pmi); }
  return t;
}
const sumaDias = (f, n) => new Date(Date.parse(f + 'T12:00:00Z') + n * DIA).toISOString().slice(0, 10);
const dowDe = (f) => new Date(f + 'T12:00:00Z').getUTCDay();
const minDe = (h) => { const [a, b] = String(h || '00:00').split(':').map(Number); return a * 60 + (b || 0); };

// ---------- ids ----------
const clave = (id) => String(id || '').replace(/\.json$/, '').replace(/^pendiente-/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
const variantes = (id) => { const k = clave(id); return [...new Set([k, k.replace(/-v\d+$/, ''), k.replace(/-\d+$/, ''), k.replace(/-prototipo$/, '')])].filter(Boolean); };
const sinPlantilla = (k) => k.replace(/^[a-z]+-/, '');

// ---------- privacidad ----------
const limpiar = (s) => s.replace(/\/home\/[a-z0-9_-]+\/projects\//gi, '').replace(/\/home\/[a-z0-9_-]+\//gi, '~/').replace(/\/mnt\/c\/Users\/[^/\s]+\//gi, '~/').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]');
const sanear = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'string' ? limpiar(v) : v)));
const corta = (s, n) => { const t = S(s); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

// ---------- repo ----------
const sh = (args) => { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).trim(); } catch { return ''; } };
function github(repo) {
  const m = sh(['-C', repo, 'remote', 'get-url', 'origin']).match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
  if (!m) return null;
  return { repo: `${m[1]}/${m[2]}`, rama: sh(['-C', repo, 'branch', '--show-current']) || 'main' };
}
function criterios(repo) {
  const md = leerTxt(path.join(repo, 'docs', 'CRITERIOS-GUION.md')) || '';
  const o = {};
  for (const l of md.split('\n')) { const m = l.match(/^\|\s*\**(B\d+)\**\s*\|\s*([^|]+)\|/); if (m && !o[m[1]]) o[m[1]] = corta(m[2].replace(/`/g, ''), 90); }
  return o;
}

function indiceRepo(repo) {
  const guiones = new Map(); // variante -> { g, ruta, carpeta }
  const poner = (k, v) => { if (k && !guiones.has(k)) guiones.set(k, v); };
  for (const dir of ['contenido/guiones', 'contenido/backlog', 'contenido/borradores', 'contenido/reserva', 'contenido/largos', 'contenido/prototipos']) {
    const rec = (rel) => {
      for (const f of ls(path.join(repo, rel))) {
        const g = leerJson(path.join(repo, rel, f));
        if (!g?.props) continue;
        const v = { g, ruta: `${rel}/${f}`, carpeta: dir.split('/')[1] };
        for (const k of [...variantes(f), ...variantes(g.id)]) poner(k, v);
      }
      for (const d of lsDirs(path.join(repo, rel))) if (rel.split('/').length < 4) rec(`${rel}/${d}`);
    };
    rec(dir);
  }
  const bandeja = [];
  const mp4 = new Set(ls(path.join(repo, 'salida', 'bandeja'), /\.mp4$/).map((f) => f.replace(/\.mp4$/, '')));
  for (const f of ls(path.join(repo, 'salida', 'bandeja'))) {
    const j = leerJson(path.join(repo, 'salida', 'bandeja', f));
    if (!j || j.estado === 'reemplazado') continue;
    const id = j.id || f.replace(/\.json$/, '');
    bandeja.push({ ...j, _id: id, _ruta: `salida/bandeja/${f}`, _mp4: mp4.has(f.replace(/\.json$/, '')), _ms: Date.parse(j.publicarEn || '') || null });
  }
  const revisiones = new Map(); // clave -> [rec…] ordenado de la ronda más alta a la más baja
  for (const f of ls(path.join(repo, 'salida', 'revisiones', 'guiones'))) {
    const r = leerJson(path.join(repo, 'salida', 'revisiones', 'guiones', f));
    if (!r || typeof r !== 'object') continue;
    const k = clave(r.id || f.replace(/\.(ronda|r)\d+\.json$/, ''));
    if (!revisiones.has(k)) revisiones.set(k, []);
    revisiones.get(k).push({ ...r, _ruta: `salida/revisiones/guiones/${f}` });
  }
  for (const l of revisiones.values()) l.sort((a, b) => (b.ronda ?? 0) - (a.ronda ?? 0) || String(b.fecha || '').localeCompare(String(a.fecha || '')) || (a._ruta.length - b._ruta.length));
  const verif = new Map();
  for (const f of ls(path.join(repo, 'contenido', 'verificaciones'), /\.md$/)) {
    const k = f.replace(/\.md$/, '').replace(/^VERIFICACION-/, '');
    verif.set(clave(k), `contenido/verificaciones/${f}`);
  }
  let plan = null;
  const md = leerTxt(path.join(repo, 'docs', 'PLAN-SEMANAL.md'));
  if (md) for (const x of md.matchAll(/```json\n([\s\S]*?)```/g)) { try { const d = JSON.parse(x[1]); if (Array.isArray(d.ranuras)) { plan = d; break; } } catch {} }
  return { guiones, bandeja, revisiones, verif, plan, cal: leerJson(path.join(repo, 'contenido', 'calendario.json')) };
}
const buscar = (mapa, id) => { for (const k of variantes(id)) if (mapa.has(k)) return mapa.get(k); return null; };
const buscarVerif = (I, id) => { for (const k of variantes(id)) { if (I.verif.has(k)) return I.verif.get(k); if (I.verif.has(sinPlantilla(k))) return I.verif.get(sinPlantilla(k)); } return null; };

// ---------- ranuras esperadas por calendario ----------
function esperadas(cal, desde, hasta) {
  const out = [];
  for (let f = desde; f <= hasta; f = sumaDias(f, 1)) {
    const dow = dowDe(f);
    const doble = cal.dobleHasta && f <= cal.dobleHasta;
    const cortas = cal.shortsActivos === false ? [] : (doble ? (cal.ranurasDoble ?? cal.ranuras) : cal.ranuras) ?? [];
    for (const [lista, formato] of [[cortas, 'short'], [cal.ranurasLargo ?? [], 'largo']]) for (const r of lista) if (r.dias.includes(dow)) out.push({ fecha: f, hora: r.hora, formato });
  }
  return out;
}
const CAL_EC = { ranuras: [{ dias: [0, 1, 2, 3, 4, 5, 6], hora: '12:00' }], ranurasLargo: [{ dias: [3], hora: '19:00' }] };

// ---------- Entender Chile: piezas semanales como "plan" ----------
function piezasEC(repo) {
  const out = [];
  for (const [carp, origen] of [['contenido/semana', 'semana'], ['contenido/borradores-semana', 'borrador']]) {
    for (const sm of lsDirs(path.join(repo, carp))) {
      const dir = `${carp}/${sm}`;
      const verifMd = ls(path.join(repo, dir), /^verificacion.*\.md$/).map((f) => `${dir}/${f}`);
      const veredictos = existe(path.join(repo, dir, 'revisiones', 'README-veredictos.md')) ? `${dir}/revisiones/README-veredictos.md` : null;
      for (const f of ls(path.join(repo, dir))) {
        const m = f.match(/^(\d{4}-\d{2}-\d{2})-(short|largo)-(.+)\.json$/);
        if (!m) continue;
        const g = leerJson(path.join(repo, dir, f));
        if (!g) continue;
        const pub = S(g.publicar).match(/T(\d{2}:\d{2})/);
        const hechos = leerTxt(path.join(repo, dir, 'hechos', f.replace(/\.json$/, '.txt'))) || '';
        const prog = [...hechos.matchAll(/^(\S+)\s+programado\s+(\S+)/gm)].pop();
        const vid = prog?.[1] || (hechos.match(/^([\w-]{11})\s/m) || [])[1] || null;
        out.push({
          fecha: m[1], hora: pub ? pub[1] : (m[2] === 'largo' ? '19:00' : '12:00'), formato: m[2], origen, semana: sm,
          g, ruta: `${dir}/${f}`, verifMd, veredictos,
          videoId: vid, programadoMs: prog ? Date.parse(prog[2]) : null,
          caratula: existe(path.join(repo, dir, 'hechos', f.replace(/\.json$/, '.caratula.txt'))),
        });
      }
    }
  }
  // si una pieza está en semana/ y también en borradores (se movió), gana semana/
  const visto = new Set(out.filter((p) => p.origen === 'semana').map((p) => clave(p.ruta.split('/').pop())));
  return out.filter((p) => p.origen === 'semana' || !visto.has(clave(p.ruta.split('/').pop())));
}

// ---------- etapas ----------
export const ETAPAS = [
  { id: 'idea', nombre: 'Idea' }, { id: 'escrito', nombre: 'Escrito' }, { id: 'verificado', nombre: 'Verificado' },
  { id: 'revisor', nombre: 'Revisor' }, { id: 'render', nombre: 'Renderizado' }, { id: 'programado', nombre: 'Programado' }, { id: 'publicado', nombre: 'Publicado' },
];
const E = (e, t) => ({ e, t }); // e: ok | fallo | pend | sd (sin registro) | na (no aplica)
const num = (x) => (x == null || x === '' || Number.isNaN(+x) ? null : Math.round(+x * 100) / 100);
const coma = (x) => String(x).replace('.', ',');
const hoyDdmm = (ms) => { const p = partes(ms); return `${p.fecha.slice(8)}-${p.fecha.slice(5, 7)} ${p.hora}`; };

function verificacion(slug, I, id, rev, g, extra) {
  if (extra) return extra;
  const ruta = id ? buscarVerif(I, id) : null;
  if (ruta) return { est: E('ok', 'informe de verificación'), ruta };
  const m = rev?.maquina || {};
  const vc = typeof m['verificar-cifras'] === 'string' ? m['verificar-cifras'] : null;
  if (vc) return /exit 0|CUADRAN/i.test(vc) ? { est: E('ok', 'cifras cuadran (verificar-cifras)'), texto: vc } : { est: E('fallo', 'cifras no cuadran'), texto: vc };
  const hv = m.hechos_verificados || m.verificacionIndependiente || rev?.verificacion_web || rev?.fuentes_revisor;
  if (hv) return { est: E('ok', 'verificado por el revisor'), texto: Array.isArray(hv) ? hv.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') : String(hv) };
  if (slug === 'bolita-lab' && g && g.plantilla !== 'dato') return { est: E('na', 'sin hechos que verificar') };
  if (!g) return { est: E('pend', 'falta el guion') };
  return { est: E('sd', 'sin registro') };
}

function revisorDe(I, id, ec) {
  if (ec) {
    if (ec.origen === 'semana') return { est: E('ok', 'aprobado (sin nota registrada)'), nota: null, flujo: true, ruta: ec.veredictos };
    return { est: E('fallo', 'rechazado: sigue en borradores'), nota: null, flujo: true, ruta: ec.veredictos };
  }
  const l = id ? buscar(I.revisiones, id) : null;
  if (!l?.length) return null;
  const r = l[0];
  const nota = num(r.promedio);
  const fallidos = Object.entries(r.bloqueantes && typeof r.bloqueantes === 'object' ? r.bloqueantes : {}).filter(([, v]) => v === false).map(([k]) => k);
  let est;
  if (r.descartado) est = E('fallo', 'descartado por el revisor');
  else if (r.aprobado) est = E('ok', nota != null ? `nota ${coma(nota)}` : 'aprobado');
  else est = E('fallo', `rechazado${nota != null ? ` · ${coma(nota)}` : ''}${r.ronda ? ` · ronda ${r.ronda}` : ''}`);
  return { est, nota, r, fallidos, rondas: l.map((x) => ({ ronda: x.ronda ?? null, aprobado: !!x.aprobado, promedio: num(x.promedio), ruta: x._ruta })) };
}

// ---------- un canal ----------
function canal(c, ahora, ventana, semanas, vistos) {
  const repo = c.repo;
  const I = indiceRepo(repo);
  const gh = github(repo);
  const crit = criterios(repo);
  const esEC = c.slug === 'entender-chile';
  const hoy = partes(ahora).fecha;
  const { desde, hasta } = ventana;
  const slots = [];
  const enVentana = (f) => f >= desde && f <= hasta;

  // 1. plan
  if (esEC) {
    for (const p of piezasEC(repo)) if (enVentana(p.fecha)) slots.push({ fecha: p.fecha, hora: p.hora, formato: p.formato, ec: p });
  } else {
    for (const r of I.plan?.ranuras ?? []) {
      if (!r.fecha || !enVentana(r.fecha)) continue;
      slots.push({ fecha: r.fecha, hora: r.hora || '00:00', formato: r.formato === 'largo' ? 'largo' : 'short', plan: r });
    }
  }
  // 2. bandeja (lo subido o renderizado con fecha)
  const usadosB = new Set();
  for (const b of I.bandeja) {
    if (!b._ms) continue;
    const p = partes(b._ms);
    if (!enVentana(p.fecha)) continue;
    const formato = b.tipo === 'largo' || b.tipo === 'long' ? 'largo' : 'short';
    let s = slots.find((x) => !x.b && b.videoId && x.plan?.videoId === b.videoId)
      || slots.find((x) => !x.b && x.plan?.guion && variantes(path.basename(x.plan.guion)).some((k) => variantes(b._id).includes(k)))
      || slots.find((x) => !x.b && x.formato === formato && x.fecha === p.fecha && Math.abs(minDe(x.hora) - minDe(p.hora)) * 60e3 <= MARGEN && !(x.plan?.videoId && b.videoId && x.plan.videoId !== b.videoId));
    if (!s) { s = { fecha: p.fecha, hora: p.hora, formato }; slots.push(s); }
    s.b = b; usadosB.add(b._id);
  }
  // 3. calendario: ranuras esperadas desde hoy que nadie cubre
  const cal = esEC ? CAL_EC : I.cal;
  if (cal) for (const x of esperadas(cal, hoy > desde ? hoy : desde, hasta)) {
    if (chileAMs(x.fecha, x.hora) <= ahora) continue;
    if (slots.some((s) => s.fecha === x.fecha && s.formato === x.formato && Math.abs(minDe(s.hora) - minDe(x.hora)) <= 30)) continue;
    slots.push({ ...x, cal: true });
  }
  slots.sort((a, b) => a.fecha.localeCompare(b.fecha) || minDe(a.hora) - minDe(b.hora) || (a.formato === 'largo') - (b.formato === 'largo'));

  const publicadosApi = new Set((vistos?.items || []).map((v) => v.id));
  const url = (ruta) => (gh && ruta ? `https://github.com/${gh.repo}/blob/${gh.rama}/${ruta.split('/').map(encodeURIComponent).join('/')}` : null);
  const ranuras = [], detalles = {};
  const usadosG = new Set();

  for (const s of slots) {
    const ms = chileAMs(s.fecha, s.hora);
    const pl = s.plan, b = s.b, ec = s.ec;
    // guion
    let G = null;
    if (ec) G = { g: ec.g, ruta: ec.ruta, carpeta: ec.origen };
    if (!G && pl?.guion) {
      const g = leerJson(path.join(repo, pl.guion));
      if (g?.props) G = { g, ruta: pl.guion, carpeta: pl.guion.split('/')[1] };
      else G = buscar(I.guiones, path.basename(pl.guion));
    }
    if (!G && b) G = buscar(I.guiones, b._id);
    if (G) usadosG.add(G.ruta);
    const id = G?.g?.id || b?._id || (pl?.guion ? path.basename(pl.guion, '.json') : null);
    const videoId = b?.videoId || pl?.videoId || ec?.videoId || null;
    const descartada = pl?.estado === 'descartado';
    const titulo = S(G?.g?.titulo) || S(b?.titulo) || S(pl?.tema) || '';
    const vacia = !pl && !b && !ec;
    const ex = G?.g ? extraer(G.g, c.slug) : null;
    const nPal = ex ? palabras(ex.bloques) : 0;
    const durSeg = b?.duracionSeg ? Math.round(b.duracionSeg) : nPal ? Math.round(nPal / PALABRAS_POR_SEG) : null;
    const rv = revisorDe(I, id, ec);
    const ve = verificacion(c.slug, I, id, rv?.r, G?.g, ec ? (ec.verifMd.length ? { est: E('ok', 'verificación de la semana'), ruta: ec.verifMd.at(-1) } : { est: E('sd', 'sin registro') }) : null);

    const et = {};
    et.idea = vacia ? E('pend', s.cal ? 'sin plan' : 'vacía') : E('ok', pl?.tema ? corta(pl.tema, 80) : 'en el plan');
    if (descartada) for (const k of ETAPAS) et[k.id] = E('na', 'descartada');
    else {
      const sinArchivo = !G && (b || videoId); // ya hay video, pero el guion no quedó en el repo
      et.escrito = G ? E('ok', nPal ? `${nPal} palabras` : 'guion en el repo') : sinArchivo ? E('sd', 'guion fuera del repo') : E('pend', pl?.estado && pl.estado !== 'idea' ? pl.estado : 'falta escribir');
      et.verificado = sinArchivo && ve.est.e === 'pend' ? E('sd', 'sin registro') : ve.est;
      et.revisor = rv ? rv.est : (G || sinArchivo ? E('sd', 'sin registro') : E('pend', 'falta el guion'));
      const renderOk = !!(b && (b._mp4 || ['subido', 'privado', 'listo', 'renderizado'].includes(b.estado) || b.artefacto)) || !!videoId;
      et.render = renderOk ? E('ok', b?._mp4 ? 'mp4 en bandeja' : b?.artefacto ? 'render en la nube' : videoId ? 'video subido' : 'renderizado') : E('pend', pl?.estado === 'renderizando' ? 'renderizando…' : 'pendiente');
      const progMs = b?._ms || ec?.programadoMs || (pl?.estado === 'programado' || pl?.estado === 'publicado' ? ms : null);
      if (videoId && progMs && (b ? b.estado !== 'privado' || b.publicarEn : true)) et.programado = E('ok', hoyDdmm(progMs));
      else if (b?.estado === 'privado') et.programado = E('fallo', 'subido privado, sin fecha');
      else et.programado = E('pend', 'sin programar');
      if (ms <= ahora) {
        if (et.programado.e === 'ok') et.publicado = E('ok', publicadosApi.has(videoId) ? 'confirmado por la API' : 'salió a su hora');
        else et.publicado = E('fallo', 'pasó la hora sin video');
      } else et.publicado = E('pend', 'aún no');
    }
    // carátula (solo largos)
    let caratula = null;
    if (s.formato === 'largo' && !descartada) {
      const tiene = !!(b?.miniatura || b?.miniaturaPuesta || ec?.caratula);
      caratula = tiene ? E('ok', 'con carátula') : (et.programado.e === 'ok' ? E('fallo', 'sin carátula') : E('pend', 'sin carátula aún'));
    }
    // estado global
    const fallo = ETAPAS.find((k) => et[k.id]?.e === 'fallo') || (caratula?.e === 'fallo' ? { id: 'caratula', nombre: 'Carátula' } : null);
    let estado;
    if (descartada) estado = 'descartada';
    else if (vacia) estado = 'vacia';
    else if (fallo && !(fallo.id === 'revisor' && et.programado.e === 'ok')) estado = 'problema';
    else if (et.publicado.e === 'ok') estado = 'publicada';
    else if (et.programado.e === 'ok') estado = fallo ? 'problema' : 'lista';
    else estado = 'en-curso';
    const avance = ETAPAS.reduce((n, k, i) => (et[k.id]?.e === 'ok' ? i + 1 : n), 0);
    const rid = `${s.fecha}-${s.hora.replace(':', '')}-${s.formato}`;
    const semana = semanas.find((w) => s.fecha >= w.desde && s.fecha <= w.hasta)?.id;
    ranuras.push({
      id: rid, semana, fecha: s.fecha, hora: s.hora, formato: s.formato, plantilla: G?.g?.plantilla || b?.plantilla || pl?.plantilla || null,
      titulo: corta(titulo, 140), tema: pl?.tema && pl.tema !== titulo ? corta(pl.tema, 160) : null, estadoPlan: pl?.estado || (ec ? ec.origen : null),
      estado, vacia, descartada, motivo: descartada ? corta(pl.porQue || '', 200) : null, bloqueo: pl?.bloqueo ? corta(pl.bloqueo, 200) : null,
      videoId, url: videoId ? (s.formato === 'largo' ? `https://www.youtube.com/watch?v=${videoId}` : `https://www.youtube.com/shorts/${videoId}`) : null,
      etapas: et, caratula, nota: rv?.nota ?? null, avance, fallo: fallo ? fallo.id : null, palabras: nPal || null, durSeg,
    });
    if (!vacia) {
      const r = rv?.r;
      detalles[rid] = {
        guionId: id, plantilla: G?.g?.plantilla || null, descripcion: corta(G?.g?.descripcion || b?.descripcion || '', 1200) || null,
        bloques: ex?.bloques || [], ficha: (ex?.ficha || []).filter(([k]) => k !== 'Descripción'), fuentes: ex?.fuentes || [],
        porQue: pl?.porQue ? corta(pl.porQue, 400) : null, referente: pl?.referente ? corta(pl.referente, 300) : null,
        verificacion: { ...ve.est, texto: ve.texto ? corta(ve.texto, 3000) : (ve.ruta && !esEC ? corta(leerTxt(path.join(repo, ve.ruta)) || '', 3000) : null), url: url(ve.ruta) },
        revisor: rv ? {
          ...rv.est, flujo: !!rv.flujo, url: url(rv.ruta || r?._ruta), nota: rv.nota, ronda: r?.ronda ?? null, aprobado: r ? !!r.aprobado : rv.est.e === 'ok', modelo: S(r?.revisor) || null, fecha: S(r?.fecha) || null,
          puntajes: r?.puntajes && typeof r.puntajes === 'object' ? Object.entries(r.puntajes).filter(([, v]) => typeof v === 'number').map(([k, v]) => ({ k: k.replace(/_/g, ' '), v })) : [],
          bloqueantes: r?.bloqueantes && typeof r.bloqueantes === 'object' ? Object.entries(r.bloqueantes).map(([k, v]) => ({ k, ok: v === true, nombre: crit[k] || null })) : [],
          motivos: (Array.isArray(r?.motivos) ? r.motivos : []).map((x) => corta(typeof x === 'string' ? x : JSON.stringify(x), 700)).slice(0, 12),
          cambios: (Array.isArray(r?.cambios) ? r.cambios : []).map((x) => corta(typeof x === 'string' ? x : JSON.stringify(x), 500)).slice(0, 12),
          resumen: S(r?.resumen) ? corta(r.resumen, 800) : null, rondas: rv.rondas || [],
        } : null,
        archivos: [
          G && { nombre: 'Guion', url: url(G.ruta), ruta: G.ruta },
          b && { nombre: 'Bandeja', url: url(b._ruta), ruta: b._ruta },
          ve.ruta && { nombre: 'Verificación', url: url(ve.ruta), ruta: ve.ruta },
          (rv?.r?._ruta || rv?.ruta) && { nombre: 'Revisor', url: url(rv.r?._ruta || rv.ruta), ruta: rv.r?._ruta || rv.ruta },
          !esEC && { nombre: 'Plan semanal', url: url('docs/PLAN-SEMANAL.md'), ruta: 'docs/PLAN-SEMANAL.md' },
        ].filter((x) => x && x.url),
      };
    }
  }

  // stock: guiones escritos sin ranura (mismo criterio que el tablero: backlog + guiones/ sin bandeja + bandeja "listo" sin fecha)
  let stock = null;
  if (!esEC) {
    const usadosId = new Set();
    for (const b of I.bandeja) for (const k of variantes(b._id)) usadosId.add(k);
    for (const r of I.plan?.ranuras ?? []) if (r.guion) for (const k of variantes(path.basename(r.guion))) usadosId.add(k);
    const items = new Map(), vistosK = new Set();
    for (const v of new Set(I.guiones.values())) {
      const kk = variantes(v.g.id || v.ruta.split('/').pop());
      if (kk.some((k) => vistosK.has(k))) continue;
      kk.forEach((k) => vistosK.add(k));
      if (usadosG.has(v.ruta) || !['backlog', 'guiones'].includes(v.carpeta)) continue;
      if (variantes(v.ruta.split('/').pop()).some((k) => usadosId.has(k)) || variantes(v.g.id).some((k) => usadosId.has(k))) continue;
      const rv = revisorDe(I, v.g.id || v.ruta.split('/').pop(), null);
      if (rv?.r?.descartado) continue;
      items.set(v.ruta, { titulo: corta(v.g.titulo || v.ruta.split('/').pop(), 120), carpeta: v.carpeta, plantilla: v.g.plantilla || null, revisor: rv ? rv.est : E('sd', 'sin registro'), url: url(v.ruta) });
    }
    for (const b of I.bandeja) if (b.estado === 'listo' && !b.publicarEn && !items.has(b._ruta)) items.set(b._ruta, { titulo: corta(b.titulo || b._id, 120), carpeta: 'bandeja', plantilla: b.plantilla || null, revisor: E('sd', 'renderizado sin fecha'), url: url(b._ruta) });
    stock = { n: items.size, items: [...items.values()].sort((a, b) => a.carpeta.localeCompare(b.carpeta) || a.titulo.localeCompare(b.titulo)).slice(0, 60) };
  }

  const resumen = {};
  for (const w of semanas) {
    const rs = ranuras.filter((r) => r.semana === w.id && !r.descartada);
    resumen[w.id] = {
      total: rs.length,
      conGuion: rs.filter((r) => r.etapas.escrito?.e === 'ok').length,
      aprobados: rs.filter((r) => r.etapas.revisor?.e === 'ok').length,
      programados: rs.filter((r) => r.etapas.programado?.e === 'ok').length,
      problemas: rs.filter((r) => r.estado === 'problema').length,
      vacias: rs.filter((r) => r.vacia).length,
      descartadas: ranuras.filter((r) => r.semana === w.id && r.descartada).length,
    };
  }
  return {
    resumen: { slug: c.slug, nombre: c.nombre, color: c.color, github: gh ? `https://github.com/${gh.repo}` : null, flujo: esEC ? 'semanal (jue → mié), piezas en contenido/semana/' : 'plan semanal + bandeja', semanas: resumen, stock, ranuras },
    detalles,
  };
}

export function generarRanuras({ ahora = Date.now(), salida } = {}) {
  const registro = leerJson(path.join(process.env.HOME || '', '.claude', 'canales', 'canales.json'))?.canales ?? [];
  const hoy = partes(ahora);
  const lunes = sumaDias(hoy.fecha, -((hoy.dow + 6) % 7));
  const semanas = [-1, 0, 1, 2].map((k) => {
    const d = sumaDias(lunes, 7 * k);
    return { id: d, desde: d, hasta: sumaDias(d, 6), rol: ['anterior', 'en-curso', 'proxima', 'subsiguiente'][k + 1] };
  });
  const ventana = { desde: semanas[0].desde, hasta: semanas.at(-1).hasta };
  const canales = [], archivos = {};
  for (const c of registro) {
    if (!c.repo || !existe(c.repo)) continue;
    try {
      const vistos = leerJson(path.join(RAIZ, 'data', 'videos', c.slug + '.json'));
      const r = canal(c, ahora, ventana, semanas, vistos);
      canales.push(r.resumen);
      archivos[c.slug] = { canal: c.slug, detalles: r.detalles };
    } catch (e) {
      console.error('ranuras', c.slug, e.stack || e.message);
      canales.push({ slug: c.slug, nombre: c.nombre, color: c.color, error: 'no se pudo leer el repo del canal', semanas: {}, stock: null, ranuras: [] });
    }
  }
  const index = sanear({
    version: 1, generadoEn: new Date(ahora).toISOString(), zona: ZONA, hoy: hoy.fecha, semanas, etapas: ETAPAS,
    nota: 'Revisor: salida/revisiones/guiones/ de cada repo (ronda más alta). Entender Chile no tiene registro estructurado: lo que está en contenido/semana/ pasó el revisor según su flujo. "sin registro" = no hay archivo que lo diga, no que haya fallado.',
    canales,
  });
  if (salida) {
    const d = path.join(salida, 'guiones', 'ranuras');
    fs.mkdirSync(d, { recursive: true });
    for (const f of ls(d)) fs.unlinkSync(path.join(d, f));
    for (const [slug, cu] of Object.entries(archivos)) fs.writeFileSync(path.join(d, slug + '.json'), JSON.stringify(sanear(cu)) + '\n');
    const tmp = path.join(d, 'index.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(index) + '\n');
    fs.renameSync(tmp, path.join(d, 'index.json'));
  }
  return { index, archivos };
}
export function digestRanuras(r) { const { generadoEn, ...resto } = r.index; return crypto.createHash('sha1').update(JSON.stringify(resto) + JSON.stringify(r.archivos)).digest('hex'); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--salida');
  const salida = i > 0 ? process.argv[i + 1] : path.join(RAIZ, 'data');
  const r = generarRanuras({ salida });
  for (const c of r.index.canales) {
    const t = r.index.semanas.map((w) => { const x = c.semanas[w.id]; return x ? `${w.rol} ${x.conGuion}/${x.total}` : `${w.rol} –`; }).join(' · ');
    console.log(`${c.nombre}: ${t} · stock ${c.stock ? c.stock.n : 'n/a'}${c.error ? ' · ERROR ' + c.error : ''}`);
  }
}
