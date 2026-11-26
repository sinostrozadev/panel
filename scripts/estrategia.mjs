#!/usr/bin/env node
// Vista "Estrategia" del panel → data/estrategia/index.json + data/estrategia/<canal>.json
// Fuente: un json por canal que escribe la sesión de estrategia en ESTRATEGIA_DIR
// (por defecto /home/santiago/projects/yt/_propuestas/estrategia-audiovisual/<slug>.json). Este script NO escribe contenido:
// valida el esquema, completa lo que falte con vacíos, agrega el repo de GitHub del canal (para los botones "Aprobar/Cambiar",
// que abren un issue prellenado) y saca rutas locales, correos y cualquier cosa con forma de token. Solo canales del registro
// (~/.claude/canales/canales.json): nada de repos privados. Lo llama scripts/agregar.mjs. Idempotente; Node 22 sin dependencias.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUENTE = process.env.ESTRATEGIA_DIR || '/home/santiago/projects/yt/_propuestas/estrategia-audiovisual';
const leer = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return e.code === 'ENOENT' ? null : { _error: e.message }; } };

const limpiar = (s) => s
  .replace(/\/home\/[a-z0-9_-]+\/projects\//gi, '').replace(/\/home\/[a-z0-9_-]+\//gi, '~/').replace(/\/mnt\/c\/Users\/[^/\s]+\//gi, '~/')
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]')
  .replace(/\b(ghp_|gho_|github_pat_|ya29\.|sk-|AIza|xox[bp]-)[\w.-]{8,}/g, '[oculto]')
  .replace(/\b(1\/\/0[\w-]{20,})/g, '[oculto]');
const sanear = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'string' ? limpiar(v) : v)));

// esquema mínimo: clave → valor por defecto (si falta o tiene otro tipo, se usa el defecto y se avisa)
const ESQUEMA = {
  actualizado: '', fuentes: [], comoSeArma: { short: [], largo: [] }, queDefineLoVisual: {}, herramientas: [],
  caratulas: {}, titulos: { reglas: [], ejemplos: [], retitulados: [] }, arranque: { regla: [], ejemplos: [] },
  referentes: [], brechas: [], decisionesVigentes: [], sugerencias: [], noEncontrado: [],
};
const tipo = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
const ytId = /^[\w-]{11}$/;

function validar(d, slug, futuros = new Set()) {
  const avisos = [];
  if (!d || typeof d !== 'object' || d._error) return { ok: false, avisos: [d?._error ? 'json inválido: ' + d._error : 'no es un objeto'] };
  if (d.canal?.slug && d.canal.slug !== slug) avisos.push(`canal.slug = ${d.canal.slug}, se esperaba ${slug}`);
  const out = { canal: d.canal || {} };
  for (const [k, def] of Object.entries(ESQUEMA)) {
    if (d[k] == null) { out[k] = def; avisos.push(`falta ${k}`); continue; }
    if (tipo(d[k]) !== tipo(def)) { out[k] = def; avisos.push(`${k} es ${tipo(d[k])}, se esperaba ${tipo(def)}`); continue; }
    out[k] = d[k];
  }
  // miniaturas: solo de i.ytimg.com (se enlazan, nunca se descargan)
  for (const r of out.referentes) {
    for (const x of [r, r.nuestro].filter(Boolean)) {
      if (x.id && !ytId.test(x.id)) { avisos.push(`id de video raro: ${x.id}`); x.id = null; }
      x.miniatura = x.id ? `https://i.ytimg.com/vi/${x.id}/hqdefault.jpg` : null;
      if (x.id && futuros.has(x.id)) x.programado = true; // aún no es público: YouTube no sirve su miniatura
    }
  }
  for (const x of [...(out.titulos?.ejemplos ?? []), ...(out.caratulas?.pedidosReales ?? []), ...(out.arranque?.ejemplos ?? [])]) {
    const id = x.id || x.videoId;
    if (id && futuros.has(id)) x.programado = true;
  }
  return { ok: true, avisos, d: out };
}

function github(repo) {
  try {
    const u = execFileSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).trim();
    const m = u.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch { return null; }
}

export function generarEstrategia({ ahora = Date.now(), salida } = {}) {
  const registro = leer(path.join(process.env.HOME || '', '.claude', 'canales', 'canales.json'))?.canales ?? [];
  const canales = [], archivos = {};
  const hayFuente = fs.existsSync(FUENTE);
  // videos programados que aún no salen (sus miniaturas dan 404): de la vista Guiones si ya se generó
  const futuros = new Set();
  const rIdx = leer(path.join(salida || path.join(RAIZ, 'data'), 'guiones', 'ranuras', 'index.json'));
  for (const c of rIdx?.canales ?? []) for (const r of c.ranuras ?? []) if (r.videoId && r.etapas?.publicado?.e !== 'ok') futuros.add(r.videoId);
  for (const c of registro) {
    const crudo = hayFuente ? leer(path.join(FUENTE, c.slug + '.json')) : null;
    const base = { slug: c.slug, nombre: c.nombre, color: c.color, github: c.repo ? github(c.repo) : null };
    if (!crudo) { canales.push({ ...base, estado: 'en preparación', avisos: [] }); continue; }
    const v = validar(crudo, c.slug, futuros);
    if (!v.ok) { canales.push({ ...base, estado: 'con error', avisos: v.avisos }); continue; }
    archivos[c.slug] = sanear({ ...v.d, canal: { ...v.d.canal, ...base } });
    canales.push({ ...base, estado: 'listo', actualizado: archivos[c.slug].actualizado || null, avisos: v.avisos,
      cuenta: { pasos: v.d.comoSeArma.short.length + v.d.comoSeArma.largo.length, referentes: v.d.referentes.length, decisiones: v.d.decisionesVigentes.length, sugerencias: v.d.sugerencias.length } });
  }
  const index = sanear({ version: 1, generadoEn: new Date(ahora).toISOString(), canales,
    nota: 'Contenido escrito por la sesión de estrategia de Claude; el panel solo lo muestra. Los botones abren un issue prellenado en el repo del canal: la sesión del canal lo lee al abrir.' });
  if (salida) {
    const d = path.join(salida, 'estrategia');
    fs.mkdirSync(d, { recursive: true });
    for (const f of fs.readdirSync(d)) if (f.endsWith('.json')) fs.unlinkSync(path.join(d, f));
    for (const [slug, cu] of Object.entries(archivos)) fs.writeFileSync(path.join(d, slug + '.json'), JSON.stringify(cu) + '\n');
    fs.writeFileSync(path.join(d, 'index.json'), JSON.stringify(index) + '\n');
  }
  return { index, archivos };
}
export function digestEstrategia(r) { const { generadoEn, ...resto } = r.index; return crypto.createHash('sha1').update(JSON.stringify(resto) + JSON.stringify(r.archivos)).digest('hex'); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--salida');
  const r = generarEstrategia({ salida: i > 0 ? process.argv[i + 1] : path.join(RAIZ, 'data') });
  for (const c of r.index.canales) console.log(`${c.nombre}: ${c.estado}${c.avisos.length ? ' · avisos: ' + c.avisos.join('; ') : ''}`);
}
