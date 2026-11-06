#!/usr/bin/env node
// Avisos y autorizaciones del panel. Node 22, sin dependencias.
//   node scripts/avisos.mjs avisar --canal X --id ID --titulo "..." --texto "..." [--vence ISO] [--sin-publicar]
//   node scripts/avisos.mjs pedir  --canal X --id ID --titulo "..." --texto "..." [--vence ISO] [--sin-publicar]
//   node scripts/avisos.mjs cerrar --id ID [--publicar]
//   node scripts/avisos.mjs revisar [--publicar]     (lee issues "AUTORIZO <id>" / "RECHAZO <id>" de sinostrozadev)
// Archivo: ~/.claude/canales/avisos.json (CANALES_DIR lo cambia). Publica con PANEL_PUBLICO=1 scripts/publicar.sh.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.CANALES_DIR || path.join(os.homedir(), '.claude', 'canales');
const ARCHIVO = path.join(DIR, 'avisos.json');
const REPO = 'sinostrozadev/panel';
const USUARIO = 'sinostrozadev';

function leer() {
  try { const j = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')); if (Array.isArray(j.avisos)) return j; } catch { /* nuevo */ }
  return { avisos: [] };
}
function guardar(j) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(ARCHIVO + '.tmp', JSON.stringify(j, null, 2) + '\n');
  fs.renameSync(ARCHIVO + '.tmp', ARCHIVO);
}
function parsear(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const sig = argv[i + 1];
      if (sig === undefined || sig.startsWith('--')) o[k] = true; else { o[k] = sig; i++; }
    } else o._.push(argv[i]);
  }
  return o;
}
function publicar(forzar) {
  try {
    execFileSync('node', ['scripts/agregar.mjs'], { cwd: RAIZ, stdio: 'inherit' });
    if (forzar) {
      execFileSync('bash', ['scripts/publicar.sh'], { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, PANEL_PUBLICO: '1' } });
    }
  } catch (e) { console.error('No se pudo re-agregar/publicar:', e.message); }
}
function falta(o, ...ks) {
  const f = ks.filter((k) => !o[k] || o[k] === true);
  if (f.length) { console.error(`Faltan: ${f.map((k) => '--' + k).join(', ')}`); process.exit(2); }
}
function agregarAviso(o, tipo) {
  falta(o, 'canal', 'id', 'titulo', 'texto');
  if (o.vence && !Number.isFinite(Date.parse(o.vence))) { console.error('--vence no es una fecha ISO válida'); process.exit(2); }
  const j = leer();
  const nuevo = {
    id: o.id, canal: o.canal, tipo, titulo: o.titulo, texto: o.texto, creado: new Date().toISOString(),
    vence: o.vence || null, estado: tipo === 'aviso' ? 'activo' : 'pendiente', respondido: null, issue: null,
  };
  const i = j.avisos.findIndex((a) => a.id === o.id);
  if (i >= 0) j.avisos[i] = nuevo; else j.avisos.push(nuevo);
  guardar(j);
  console.log(`${tipo} ${o.id}: ${nuevo.estado}`);
  publicar(!o['sin-publicar']);
}

function gh(args) { return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }); }

function revisar(o) {
  const j = leer();
  const pend = j.avisos.filter((a) => a.tipo === 'autorizacion' && a.estado === 'pendiente');
  if (!pend.length) { console.log('sin cambios (no hay autorizaciones pendientes)'); return; }
  let issues;
  try {
    issues = JSON.parse(gh(['issue', 'list', '-R', REPO, '--state', 'all', '--limit', '50', '--json', 'number,title,url,createdAt,state,author']));
  } catch (e) { console.error('gh falló:', (e.stderr || e.message).toString().trim()); return; }
  let cambios = 0;
  for (const a of pend) {
    const cand = issues.filter((i) => i.author?.login === USUARIO && (i.title.trim().startsWith('AUTORIZO ' + a.id) || i.title.trim().startsWith('RECHAZO ' + a.id)))
      .filter((i) => !a.creado || Date.parse(i.createdAt) >= Date.parse(a.creado) - 60_000)
      .sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));
    const r = cand[0];
    if (!r) continue;
    a.estado = r.title.trim().startsWith('AUTORIZO') ? 'autorizado' : 'rechazado';
    a.respondido = r.createdAt;
    a.issue = r.url;
    cambios++;
    console.log(`${a.id}: ${a.estado} (${r.url})`);
    if (r.state === 'OPEN') {
      try { gh(['issue', 'close', String(r.number), '-R', REPO, '-c', 'Registrado por el panel']); }
      catch (e) { console.error('no se pudo cerrar el issue:', (e.stderr || e.message).toString().trim()); }
    }
  }
  if (!cambios) { console.log('sin cambios'); return; }
  guardar(j);
  publicar(process.env.PANEL_PUBLICO === '1' || !!o.publicar || !o['sin-publicar']);
}

const [cmd, ...resto] = process.argv.slice(2);
const o = parsear(resto);
try {
  if (cmd === 'avisar') agregarAviso(o, 'aviso');
  else if (cmd === 'pedir') agregarAviso(o, 'autorizacion');
  else if (cmd === 'cerrar') {
    falta(o, 'id');
    const j = leer(); const a = j.avisos.find((x) => x.id === o.id);
    if (!a) { console.error('No existe ese id'); process.exit(1); }
    a.estado = 'cerrado'; guardar(j); console.log(`${o.id}: cerrado`);
    publicar(process.env.PANEL_PUBLICO === '1' || !!o.publicar);
  } else if (cmd === 'revisar') revisar(o);
  else { console.error('Uso: avisos.mjs avisar|pedir|cerrar|revisar (ver cabecera del archivo)'); process.exit(2); }
} catch (e) {
  if (cmd === 'revisar') { console.error('error:', e.message); process.exit(0); }
  throw e;
}
