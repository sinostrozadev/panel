#!/usr/bin/env node
// Guiones legibles para humanos → data/guiones/index.json + data/guiones/<canal>.json
// Fuentes por canal (solo lectura): contenido/guiones, contenido/backlog, contenido/prototipos, salida/bandeja, docs/PLAN-SEMANAL.md.
// Ventana: lunes de la semana en curso → domingo de la siguiente (America/Santiago). Entender Chile: últimos 7 días (markdown).
// No se publican rutas locales: solo ids, textos y fechas. Idempotente. Node 22 sin dependencias.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZONA = 'America/Santiago';
const DIA = 864e5;
const leerJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const ls = (d, ext) => { try { return fs.readdirSync(d).filter((f) => f.endsWith(ext)).sort(); } catch { return []; } };
const fmtF = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
function partes(ms) { const o = {}; for (const p of fmtF.formatToParts(new Date(ms))) o[p.type] = p.value; return { fecha: `${o.year}-${o.month}-${o.day}`, hora: `${o.hour}:${o.minute}`, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) }; }
const sumaDias = (f, n) => new Date(Date.parse(f + 'T12:00:00Z') + n * DIA).toISOString().slice(0, 10);
const clave = (id) => String(id || '').replace(/^pendiente-/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
const S = (v) => (typeof v === 'string' ? v.trim() : '');
const P = (arr) => arr.map(S).filter(Boolean);

// ---------- extractores ----------
const fuentesDe = (f) => (Array.isArray(f) ? f.map((x) => (typeof x === 'string' ? x : [S(x.texto), S(x.url)].filter(Boolean).join(' — '))).filter(Boolean) : []);

function narrado(g) {
  const p = g.props || {}, b = [], ficha = [];
  const pl = g.plantilla;
  if (S(p.cabecera)) ficha.push(['Cabecera', S(p.cabecera)]);
  if (S(p.tarjetaTitulo?.texto)) ficha.push(['Tarjeta de título', S(p.tarjetaTitulo.texto)]);
  if (pl === 'tesis') {
    if (S(p.gancho?.texto)) b.push({ h: 'Gancho' + (S(p.gancho.rotulo) ? ` · ${p.gancho.rotulo}` : ''), t: [S(p.gancho.texto)] });
    if (S(p.promesa)) b.push({ h: 'Promesa', t: [S(p.promesa)] });
    (p.capitulos || []).forEach((c, i) => b.push({ h: `${i + 1}. ${S(c.titulo)}`, t: P((c.escenas || []).map((e) => e.texto)) }));
    if (S(p.numeroQueNadieMira?.texto)) b.push({ h: 'El número que nadie mira', t: [S(p.numeroQueNadieMira.texto)] });
    if (S(p.remate)) b.push({ h: 'Remate', t: [S(p.remate)] });
    if (S(p.siguiente)) b.push({ h: 'Siguiente video', t: [S(p.siguiente)] });
    if (Array.isArray(p.indice)) ficha.push(['Índice', p.indice.join(' · ')]);
    if (S(p.estructura)) ficha.push(['Estructura', S(p.estructura)]);
  } else {
    if (S(p.gancho?.texto)) b.push({ h: 'Gancho' + (S(p.gancho.rotulo) ? ` · ${p.gancho.rotulo}` : ''), t: [S(p.gancho.texto)] });
    const esc = P((p.escenas || []).map((e) => e.texto));
    if (esc.length) b.push({ h: 'Desarrollo', t: esc });
    if (S(p.remate)) b.push({ h: 'Remate', t: [S(p.remate)] });
  }
  return { bloques: b, ficha, fuentes: fuentesDe(p.fuentes) };
}

const sc = (o, ks) => ks.filter((k) => o[k] != null && typeof o[k] !== 'object').map((k) => [k, String(o[k])]);
const NOMBRE_NOTA = ['do', 'do#', 're', 're#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si'];
function ficha(g) {
  const p = g.props || {}, f = [], b = [];
  const pl = g.plantilla;
  if (S(p.gancho)) f.push(['Gancho', S(p.gancho)]);
  if (S(p.arriba)) f.push(['Texto de arriba', S(p.arriba)]);
  if (S(p.abajo)) f.push(['Texto de abajo', S(p.abajo)]);
  if (pl === 'carrera') {
    if (S(p.tema)) f.push(['Tema', S(p.tema)]);
    f.push(['Participantes', P((p.participantes || []).map((x) => (typeof x === 'string' ? x : x.etiqueta))).join(' · ')]);
  } else if (pl === 'colores') {
    f.push(['Equipos', (p.equipos || []).join(' · ')]);
    f.push(['Bolitas por equipo', String(p.bolasPorEquipo ?? '')]);
    f.push(['Arena', String(p.arena ?? '')]);
    f.push(['Votación de la audiencia', p.votacion ? 'sí' : 'no']);
  } else if (pl === 'dato') {
    const esc = (p.escenas || []).map((e) => {
      const v = e.visual || {};
      const vis = v.tipo === 'cifra' ? ` [${v.valor}${v.sufijo || ''} ${v.etiqueta || ''}]` : v.tipo ? ` [${v.tipo}]` : '';
      return S(e.texto) + vis;
    }).filter(Boolean);
    if (esc.length) b.push({ h: 'Textos en pantalla', t: esc });
    if (S(p.remate)) b.push({ h: 'Remate', t: [S(p.remate)] });
  } else if (pl === 'bola') {
    f.push(...sc(p, ['modo', 'bolas', 'timbre', 'acompanamiento']).map(([k, v]) => [{ modo: 'Modo', bolas: 'Bolitas', timbre: 'Timbre', acompanamiento: 'Acompañamiento' }[k], v]));
    if (S(p.melodia)) f.push(['Melodía', S(p.melodia)]);
    if (p.melodiaNotas) { const m = p.melodiaNotas; f.push(['Melodía (notas)', `${(m.notas || []).length} notas · ${m.bpm} bpm · tónica ${NOMBRE_NOTA[m.tonica % 12] ?? m.tonica}${m.menor ? ' menor' : ' mayor'}`]); }
  } else {
    f.push(...sc(p, Object.keys(p).filter((k) => !['id', 'gancho', 'arriba', 'abajo'].includes(k))).slice(0, 14).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v]));
    for (const [k, v] of Object.entries(p)) if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) f.push([k[0].toUpperCase() + k.slice(1), v.join(' · ')]);
  }
  if (p.juego) {
    const j = p.juego;
    f.push(['Juego', j.tipo || 'sí']);
    if (Array.isArray(j.pistas)) f.push(['Pistas', j.pistas.map((x) => `a los ${x.t} s: ${x.texto}`).join(' · ')]);
    for (const [k, v] of Object.entries(j)) if (!['tipo', 'pistas'].includes(k) && v != null && typeof v !== 'object') f.push([`Juego · ${k}`, String(v)]);
  }
  return { bloques: b, ficha: f.filter(([, v]) => v), fuentes: fuentesDe(p.fuentes) };
}

function extraer(g, canal) {
  const base = canal === 'bolita-lab' ? ficha(g) : narrado(g);
  const ficha0 = base.ficha;
  if (S(g.descripcion)) ficha0.push(['Descripción', S(g.descripcion)]);
  if (Array.isArray(g.hashtags) && g.hashtags.length) ficha0.push(['Hashtags', g.hashtags.join(' ')]);
  return { ...base, ficha: ficha0 };
}
const palabras = (bl) => bl.reduce((n, b) => n + b.t.join(' ').split(/\s+/).filter(Boolean).length, 0);

// ---------- por canal (repos con JSON) ----------
function canalJson(c, ahora, ini, fin) {
  const repo = c.repo;
  const items = new Map(); // clave -> item
  const get = (k) => { if (!items.has(k)) items.set(k, { k }); return items.get(k); };
  // 1. guiones (contenido)
  for (const [dir, tipo] of [['contenido/guiones', 'guion'], ['contenido/backlog', 'backlog'], ['contenido/prototipos', 'prototipo']]) {
    for (const f of ls(path.join(repo, dir), '.json')) {
      const g = leerJson(path.join(repo, dir, f));
      if (!g?.props) continue;
      const it = get(clave(g.id || f.replace(/\.json$/, '')));
      if (it.g && tipo === 'backlog') continue;
      it.g = g; it.tipo = tipo; it.fechaArchivo = (f.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
    }
  }
  // 1b. prototipos sin id propio (contenido/prototipos/**.json): se enlazan por nombre de archivo
  const protos = new Map();
  const rec = (d) => { for (const e of (() => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } })()) { const f = path.join(d, e.name); if (e.isDirectory()) rec(f); else if (e.name.endsWith('.json')) { const g = leerJson(f); if (g?.props) protos.set(e.name.replace(/\.json$/, ''), g); } } };
  rec(path.join(repo, 'contenido/prototipos'));
  // 2. bandeja (verdad de lo programado)
  for (const f of ls(path.join(repo, 'salida/bandeja'), '.json')) {
    const j = leerJson(path.join(repo, 'salida/bandeja', f));
    if (!j?.id || j.estado === 'reemplazado') continue;
    const it = get(clave(j.id)); it.b = j;
    if (!it.g) {
      const k = clave(j.id);
      const g = protos.get(k) || protos.get(k.replace(/-prototipo$/, '')) || protos.get(k.replace(/^[a-z0-9]+-/, ''));
      if (g) { it.g = g; it.tipo = 'prototipo'; }
    }
  }
  // versiones viejas reemplazadas por -vN no se listan como "sin asignar"
  for (const it of items.values()) if (!it.b && [...items.keys()].some((o) => o.startsWith(it.k + '-v'))) it.reemplazado = true;
  // 3. plan (solo como pista de ranura para lo no programado)
  try {
    const md = fs.readFileSync(path.join(repo, 'docs/PLAN-SEMANAL.md'), 'utf8');
    const plan = JSON.parse(md.match(/```json\n([\s\S]*?)```/)[1]);
    for (const r of plan.ranuras || []) {
      if (!r.guion) continue;
      const it = items.get(clave(path.basename(r.guion, '.json')));
      if (it) it.plan = r;
    }
  } catch {}
  const out = [];
  for (const it of items.values()) {
    let fecha = null, hora = null, estado, ranuraPlan = false, videoId = null;
    const b = it.b;
    if (b?.publicarEn && Date.parse(b.publicarEn)) { const p = partes(Date.parse(b.publicarEn)); fecha = p.fecha; hora = p.hora; estado = Date.parse(b.publicarEn) > ahora ? 'programado' : 'publicado'; videoId = b.videoId || null; }
    else if (b?.estado === 'privado') { estado = 'privado'; videoId = b.videoId || null; }
    else if (b) { estado = b.estado === 'listo' ? 'renderizado' : (b.estado || 'renderizado'); videoId = b.videoId || null; }
    else if (it.tipo === 'backlog') estado = 'en backlog';
    else estado = 'sin asignar';
    if (!fecha && it.plan?.fecha && it.plan.fecha >= ini && it.plan.estado !== 'publicado') { fecha = it.plan.fecha; hora = it.plan.hora; ranuraPlan = true; }
    // ventana
    const dentro = fecha ? fecha >= ini && fecha <= fin : (estado === 'en backlog' || (estado === 'sin asignar' && it.fechaArchivo && it.fechaArchivo >= ini) || estado === 'renderizado');
    if (!dentro) continue;
    if ((!it.g && !b) || (it.reemplazado && !b)) continue;
    const g = it.g || { plantilla: b.plantilla, titulo: b.titulo, descripcion: b.descripcion, hashtags: b.hashtags, props: {} };
    const ex = extraer(g, c.slug);
    const texto = ex.bloques.length > 0 || ex.ficha.length > 0;
    out.push({
      id: S(b?.id || it.g?.id) || it.k, titulo: S(g.titulo) || S(b?.titulo) || it.k, plantilla: g.plantilla || b?.plantilla || '', formato: b?.tipo || it.plan?.formato || null,
      fecha, hora, ranuraPlan, estado, videoId, url: videoId ? `https://youtube.com/${(b?.tipo || 'short') === 'long' || b?.tipo === 'largo' ? 'watch?v=' : 'shorts/'}${videoId}` : null,
      bloques: ex.bloques, ficha: ex.ficha, fuentes: ex.fuentes, palabras: palabras(ex.bloques), sinGuion: !it.g, texto,
    });
  }
  const ord = { programado: 0, publicado: 0, privado: 1, renderizado: 2, 'en backlog': 3, 'sin asignar': 4 };
  out.sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999') || (a.hora || '').localeCompare(b.hora || '') || (ord[a.estado] ?? 9) - (ord[b.estado] ?? 9) || a.id.localeCompare(b.id));
  return out;
}

// ---------- Entender Chile (markdown) ----------
function canalEC(c, ahora) {
  const hoy = partes(ahora).fecha, desde = sumaDias(hoy, -7);
  const out = [];
  for (const [carp, tipo] of [['informe', 'Informe del día'], ['claves', 'Claves']]) {
    for (const f of ls(path.join(c.repo, 'contenido/guiones', carp), '.md')) {
      if (f.endsWith('-imagenes.md')) continue;
      const fecha = (f.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
      if (!fecha || fecha < desde || fecha > hoy) continue;
      const md = fs.readFileSync(path.join(c.repo, 'contenido/guiones', carp, f), 'utf8');
      const tit = (md.match(/^T[ií]tulo sugerido:\s*(.+)$/m) || [])[1] || f.replace(/\.md$/, '');
      const desc = (md.match(/^Descripci[oó]n sugerida:\s*(.+)$/m) || [])[1];
      const car = (md.match(/^Car[aá]tula sugerida:\s*(.+)$/m) || [])[1];
      const cuerpo = md.split(/^Guion:\s*$/m)[1] ?? md;
      const bloques = [];
      let cur = { h: 'Inicio', t: [] };
      for (const l of cuerpo.split('\n')) {
        if (/^##\s+/.test(l)) { if (cur.t.length) bloques.push(cur); cur = { h: l.replace(/^##\s+/, '').trim(), t: [] }; continue; }
        const x = l.trim();
        if (!x) continue;
        cur.t.push(/^\[(FUENTE|TESIS|DATO|ESQUEMA|IMAGEN|CIFRA)/i.test(x) ? { x, m: 1 } : x);
      }
      if (cur.t.length) bloques.push(cur);
      const fi = [];
      if (desc) fi.push(['Descripción', desc.trim()]);
      if (car) fi.push(['Carátula', car.trim()]);
      out.push({ id: `${carp}-${f.replace(/\.md$/, '')}`, titulo: tit.trim(), plantilla: tipo, formato: null, fecha, hora: null, ranuraPlan: false, estado: 'guion del día', videoId: null, url: null, bloques, ficha: fi, fuentes: [], palabras: palabras(bloques.map((b) => ({ t: b.t.map((z) => (typeof z === 'string' ? z : '')) }))), sinGuion: false, texto: bloques.length > 0 });
    }
  }
  out.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.plantilla.localeCompare(b.plantilla));
  return out;
}

export function generarGuiones({ ahora = Date.now(), salida } = {}) {
  const registro = leerJson(path.join(process.env.HOME || '', '.claude', 'canales', 'canales.json'))?.canales ?? [];
  const hoy = partes(ahora);
  const lunes = sumaDias(hoy.fecha, -((hoy.dow + 6) % 7));
  const ini = lunes, fin = sumaDias(lunes, 13);
  const canales = [], archivos = {};
  for (const c of registro) {
    let items = [];
    try { items = c.slug === 'entender-chile' ? canalEC(c, ahora) : canalJson(c, ahora, ini, fin); } catch (e) { console.error('guiones', c.slug, e.message); }
    const cuerpo = { canal: c.slug, nombre: c.nombre, color: c.color, items };
    archivos[c.slug] = cuerpo;
    const cnt = {}; items.forEach((i) => { cnt[i.estado] = (cnt[i.estado] || 0) + 1; });
    canales.push({ slug: c.slug, nombre: c.nombre, color: c.color, total: items.length, porEstado: cnt, ventana: c.slug === 'entender-chile' ? 'últimos 7 días' : `${ini.slice(5)} → ${fin.slice(5)}`, fuente: c.slug === 'entender-chile' ? 'Markdown por fecha (informe y claves)' : 'guiones + backlog + bandeja' });
  }
  const index = { version: 1, generadoEn: new Date(ahora).toISOString(), zona: ZONA, ventana: { desde: ini, hasta: fin }, aprobacion: 'pendiente de activar', canales };
  if (salida) {
    const d = path.join(salida, 'guiones');
    fs.mkdirSync(d, { recursive: true });
    for (const f of ls(d, '.json')) fs.unlinkSync(path.join(d, f));
    fs.writeFileSync(path.join(d, 'index.json'), JSON.stringify(index) + '\n');
    for (const [slug, cu] of Object.entries(archivos)) fs.writeFileSync(path.join(d, slug + '.json'), JSON.stringify(cu) + '\n');
  }
  return { index, archivos };
}
export function digestGuiones(r) { return crypto.createHash('sha1').update(JSON.stringify(r.archivos)).digest('hex'); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--salida');
  const salida = i > 0 ? process.argv[i + 1] : path.join(RAIZ, 'data');
  const r = generarGuiones({ salida });
  for (const c of r.index.canales) console.log(`${c.nombre}: ${c.total} (${c.ventana}) ${JSON.stringify(c.porEstado)}`);
}
