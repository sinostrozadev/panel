#!/usr/bin/env node
// Tablero de tareas, permisos/salud y notificaciones. SOLO LECTURA sobre los repos de los canales.
// Escribe data/tablero.json (o --salida <dir>). Lo llama scripts/agregar.mjs (y por tanto el ciclo y publicar.sh).
// Nunca imprime ni guarda valores de tokens: solo estados y fechas.
//
// Supuestos (documentados también en el JSON, campo `supuestos`):
//  - "Ranura" = (día, hora) de contenido/calendario.json (`ranuras`, o `ranurasDoble` hasta `dobleHasta`; `ranurasLargo` para largos).
//  - Una ranura está "programada" si hay una entrada de salida/bandeja/*.json con estado subido|privado y `publicarEn` a ≤ 30 min de la
//    ranura (una entrada cubre una sola ranura; si trae `tipo` debe coincidir con el tipo de la ranura), o si el bloque JSON de
//    docs/PLAN-SEMANAL.md la marca `programado`/`publicado` en esa fecha y hora.
//  - Una ranura tiene "guion" si está programada, o si el plan le asigna un guion que existe; lo que falta se completa con el stock de
//    guiones sin asignar (backlog/, bandeja `listo` y guiones/ sin entrada de bandeja).
//  - Semana objetivo: desde ahora hasta el domingo próximo 23:59 (America/Santiago). Semana siguiente: lunes→domingo después de ésa.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZONA = 'America/Santiago';
const HORA = 3600e3, DIA = 864e5, MARGEN = 30 * 60e3;
const leer = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const existe = (f) => { try { fs.accessSync(f); return true; } catch { return false; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return null; } };

// ---------- fechas en Chile ----------
const fmtP = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
function partes(ms) {
  const o = Object.fromEntries(fmtP.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
}
const p2 = (n) => String(n).padStart(2, '0');
const ymd = (ms) => { const p = partes(ms); return `${p.y}-${p2(p.m)}-${p2(p.d)}`; };
function chileAMs(y, m, d, h, mi) {
  let t = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) { const p = partes(t); t += Date.UTC(y, m - 1, d, h, mi) - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi); }
  return t;
}
const ddmm = (ms) => { const p = partes(ms); return `${p2(p.d)}-${p2(p.m)}`; };
const ddmmhm = (ms) => { const p = partes(ms); return `${p2(p.d)}-${p2(p.m)} ${p2(p.h)}:${p2(p.mi)}`; };
const DIAS_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const diaHora = (ms) => { const p = partes(ms); return `${DIAS_ES[p.dow]} ${p2(p.d)}-${p2(p.m)} ${p2(p.h)}:${p2(p.mi)}`; };

// ---------- ranuras ----------
function ranurasDe(cal, desdeMs, hastaMs) {
  const out = [];
  const pIni = partes(desdeMs);
  const base = Date.UTC(pIni.y, pIni.m - 1, pIni.d);
  for (let k = 0; k <= Math.ceil((hastaMs - desdeMs) / DIA) + 1; k++) {
    const dt = new Date(base + k * DIA);
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate(), dow = dt.getUTCDay();
    const fecha = `${y}-${p2(m)}-${p2(d)}`;
    const doble = cal.dobleHasta && fecha <= cal.dobleHasta;
    const cortas = doble ? (cal.ranurasDoble ?? cal.ranuras) : cal.ranuras;
    const largas = cal.ranurasLargo ?? [{ dias: [0], hora: '10:00' }];
    for (const [lista, tipo] of [[cortas ?? [], 'short'], [largas, 'largo']]) {
      for (const r of lista) {
        if (!r.dias.includes(dow)) continue;
        const [hh, mm] = r.hora.split(':').map(Number);
        const ms = chileAMs(y, m, d, hh, mm);
        if (ms > desdeMs && ms <= hastaMs) out.push({ ms, fecha, hora: r.hora, tipo, cubierta: false, guion: false });
      }
    }
  }
  return out.sort((a, b) => a.ms - b.ms || (a.tipo < b.tipo ? -1 : 1));
}

// ---------- lectura de un repo de canal ----------
function bandeja(repo) {
  const dir = path.join(repo, 'salida', 'bandeja');
  let fs_ = [];
  try { fs_ = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return null; }
  return fs_.map((f) => { const d = leer(path.join(dir, f)); return d && { ...d, _id: d.id || f.replace(/\.json$/, '') }; }).filter(Boolean);
}
function plan(repo) {
  try {
    const t = fs.readFileSync(path.join(repo, 'docs', 'PLAN-SEMANAL.md'), 'utf8');
    const m = [...t.matchAll(/```json\n([\s\S]*?)```/g)];
    for (const x of m) { try { const d = JSON.parse(x[1]); if (Array.isArray(d.ranuras)) return d; } catch {} }
  } catch {}
  return null;
}
function stockGuiones(repo, ban, pl) {
  const usados = new Set((ban ?? []).map((e) => e._id));
  for (const r of pl?.ranuras ?? []) if (r.guion) usados.add(path.basename(r.guion, '.json'));
  const lista = (d) => { try { return fs.readdirSync(path.join(repo, 'contenido', d)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')); } catch { return []; } };
  const set = new Set(lista('backlog'));
  for (const e of ban ?? []) if (e.estado === 'listo' && !e.publicarEn) set.add(e._id);
  for (const g of lista('guiones')) if (!usados.has(g)) set.add(g);
  return set.size;
}

function analizarCanal(c, cal, ban, pl, ahora, finSemana, finSiguiente) {
  const horizonte = ahora + 35 * DIA;
  const todas = ranurasDe(cal, ahora, horizonte);
  // cobertura por bandeja
  const prog = (ban ?? []).filter((e) => (e.estado === 'subido' || e.estado === 'privado') && e.publicarEn).map((e) => ({ ms: Date.parse(e.publicarEn), tipo: e.tipo || null, e })).filter((x) => Number.isFinite(x.ms)).sort((a, b) => a.ms - b.ms);
  const usadoE = new Set();
  for (const s of todas) {
    let mejor = null;
    for (const x of prog) {
      if (usadoE.has(x)) continue;
      if (x.tipo && x.tipo !== s.tipo) continue;
      const d = Math.abs(x.ms - s.ms);
      if (d <= MARGEN && (!mejor || d < mejor.d)) mejor = { x, d };
    }
    if (mejor) { usadoE.add(mejor.x); s.cubierta = true; s.guion = true; s.entrada = mejor.x.e; }
  }
  // plan
  for (const r of pl?.ranuras ?? []) {
    const [hh, mm] = (r.hora || '00:00').split(':').map(Number);
    const [y, m, d] = (r.fecha || '').split('-').map(Number);
    if (!y) continue;
    const ms = chileAMs(y, m, d, hh, mm);
    const tipo = r.formato === 'largo' ? 'largo' : 'short';
    const s = todas.find((z) => z.ms === ms && z.tipo === tipo);
    if (!s) continue;
    if (!s.cubierta && (r.estado === 'programado' || r.estado === 'publicado')) { s.cubierta = true; s.guion = true; }
    if (!s.guion && r.guion && existe(path.join(c.repo, r.guion))) s.guion = true;
  }
  const enSemana = todas.filter((s) => s.ms <= finSemana);
  const sig = todas.filter((s) => s.ms > finSemana && s.ms <= finSiguiente);
  const conteo = (l, k) => l.filter((s) => s[k]).length;
  // stock para completar guiones de la semana siguiente
  const stock = stockGuiones(c.repo, ban, pl);
  const sinGuionSig = sig.filter((s) => !s.guion).length;
  const completadas = Math.min(stock, sinGuionSig);
  const primeraVacia = todas.find((s) => !s.cubierta) || null;
  const largosProg = (ban ?? []).filter((e) => (e.estado === 'subido' || e.estado === 'privado') && e.tipo === 'largo' && e.publicarEn && Date.parse(e.publicarEn) > ahora);
  const largosPlan = (pl?.ranuras ?? []).filter((r) => r.formato === 'largo' && (r.estado === 'programado') && !largosProg.length);
  return { todas, enSemana, sig, conteo, stock, completadas, primeraVacia, largosProg, largosPlan };
}

// ---------- celdas ----------
const celda = (estado, texto, detalle) => ({ estado, texto, ...(detalle ? { detalle } : {}) });
const semaforoRatio = (n, t) => (t === 0 ? 'na' : n === t ? 'ok' : n / t >= 0.5 ? 'warn' : 'bad');

export function generarTablero({ ahora = Date.now(), salida } = {}) {
  const reg = leer(path.join(RAIZ, 'config', 'canales.json'))?.canales ?? [];
  const registro = leer(path.join(process.env.HOME || '', '.claude', 'canales', 'canales.json'))?.canales ?? reg;
  const perm = leer(path.join(RAIZ, 'config', 'permisos.json')) ?? {};
  const canales = registro.map((c) => ({ ...c, repo: c.repo }));
  const p = partes(ahora);
  const hoy = ymd(ahora);
  // domingo próximo (inclusive)
  const diasHastaDom = (7 - p.dow) % 7;
  const domMs = chileAMs(p.y, p.m, p.d + diasHastaDom, 23, 59) + 59e3;
  const sigIni = domMs + 1000, sigFin = domMs + 7 * DIA;
  const domFecha = ymd(domMs - 1000);
  const sigFecha = { desde: ymd(sigIni + HORA), hasta: ymd(sigFin - HORA) };

  const filasTareas = [
    { id: 'programados', nombre: 'Programados hasta el domingo', ayuda: 'Ranuras de Shorts del calendario, desde ahora hasta el domingo 23:59, que ya tienen video programado en YouTube. Verde solo si están todas.', celdas: {} },
    { id: 'largos', nombre: 'Largos de la semana', ayuda: 'Ranuras de videos largos hasta el domingo con video programado.', celdas: {} },
    { id: 'guiones', nombre: 'Guiones de la próxima semana', ayuda: 'Ranuras de lunes a domingo de la semana siguiente que ya tienen guion (asignado en el plan, programado o disponible en el stock de guiones).', celdas: {} },
    { id: 'aprobados', nombre: 'Guiones aprobados', ayuda: 'Pendiente de activar: aún no existe un registro de aprobación de guiones.', celdas: {} },
    { id: 'metricas', nombre: 'Métricas de hoy', ayuda: 'Existe salida/metricas/<hoy>/metricas.json (las capturas corren a las 08:15).', celdas: {} },
    { id: 'caratulas', nombre: 'Carátulas de largos', ayuda: 'Largos programados que ya tienen miniatura asignada.', celdas: {} },
    { id: 'colchon', nombre: 'Colchón', ayuda: 'Tiempo hasta la primera ranura sin video programado. Verde desde 4 días, ámbar 2 a 4, rojo menos de 2.', celdas: {} },
  ];
  const T = Object.fromEntries(filasTareas.map((t) => [t.id, t]));
  const filasPerm = [];
  const notis = [];
  const sup = {};
  const aud = existe('/home/santiago/projects/yt/bolita-lab/secrets/api-auditada');

  // clave del panel (global)
  let claveEst = 'sd', claveTxt = 'sin dato', claveDet = '';
  try {
    const sec = execFileSync('gh', ['secret', 'list', '-R', 'sinostrozadev/panel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 });
    const tiene = /^YT_API_KEY\b/m.test(sec);
    let ult = '';
    try { ult = execFileSync('gh', ['run', 'list', '-R', 'sinostrozadev/panel', '-w', 'Actualizar panel', '-L', '1', '--json', 'conclusion,createdAt'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }); } catch {}
    const run = (() => { try { return JSON.parse(ult)[0]; } catch { return null; } })();
    if (tiene) { claveEst = 'ok'; claveTxt = 'cargada'; claveDet = run ? `última corrida de la nube: ${run.conclusion || 'en curso'} (${ddmm(Date.parse(run.createdAt))})` : 'la nube aún no corre'; }
    else { claveEst = 'bad'; claveTxt = 'falta'; claveDet = 'sin el secreto YT_API_KEY la nube no mide cuando el PC está apagado'; }
  } catch { /* gh no disponible: sin dato */ }

  for (const c of canales) {
    const repo = c.repo;
    const cal = leer(path.join(repo, 'contenido', 'calendario.json'));
    const ban = repo ? bandeja(repo) : null;
    const pl = repo ? plan(repo) : null;
    const A = cal && ban ? analizarCanal(c, cal, ban, pl, ahora, domMs, sigFin) : null;
    if (!A) sup[c.slug] = 'Sin contenido/calendario.json ni salida/bandeja: estructura distinta; solo se llenan métricas, repo y workflows.';

    // 1 programados
    if (A) {
      const cortas = A.enSemana.filter((s) => s.tipo === 'short'), largas = A.enSemana.filter((s) => s.tipo === 'largo');
      const nc = cortas.filter((s) => s.cubierta).length, nl = largas.filter((s) => s.cubierta).length;
      T.programados.celdas[c.slug] = celda(semaforoRatio(nc, cortas.length), `${nc}/${cortas.length}`, cortas.length === 0 ? 'sin ranuras de Shorts' : nc === cortas.length ? 'todas programadas' : `faltan ${cortas.length - nc}; primera: ${diaHora(cortas.find((s) => !s.cubierta).ms)}`);
      T.largos.celdas[c.slug] = celda(semaforoRatio(nl, largas.length), largas.length ? `${nl}/${largas.length}` : '–', largas.length === 0 ? 'sin ranura de largo hasta el domingo' : nl === largas.length ? 'todos programados' : `faltan ${largas.length - nl}; primero: ${diaHora(largas.find((s) => !s.cubierta).ms)}`);
      const total = A.sig.length, con = A.sig.filter((s) => s.guion).length + A.completadas;
      T.guiones.celdas[c.slug] = celda(semaforoRatio(con, total), `${con}/${total}`, `${A.sig.filter((s) => s.guion).length} asignados + ${A.completadas} del stock (${A.stock} guiones sin asignar)`);
      // carátulas
      const L = A.largosProg;
      if (L.length) {
        const con2 = L.filter((e) => e.miniatura || e.miniaturaPuesta).length;
        T.caratulas.celdas[c.slug] = celda(con2 === L.length ? 'ok' : con2 ? 'warn' : 'bad', `${con2}/${L.length}`, con2 === L.length ? 'todos con carátula' : `sin carátula: ${L.filter((e) => !(e.miniatura || e.miniaturaPuesta)).length}`);
      } else T.caratulas.celdas[c.slug] = celda('na', '–', 'sin largos programados');
      // colchón
      if (A.primeraVacia) {
        const dias = (A.primeraVacia.ms - ahora) / DIA;
        const d = Math.floor(dias);
        T.colchon.celdas[c.slug] = celda(dias >= 4 ? 'ok' : dias >= 2 ? 'warn' : 'bad', d < 1 ? `${Math.max(0, Math.floor(dias * 24))} h` : `${d} d`, `primera ranura vacía: ${diaHora(A.primeraVacia.ms)}`);
        A.colchonDias = dias;
      } else T.colchon.celdas[c.slug] = celda('ok', '+35 d', 'todas las ranuras de 35 días cubiertas');
    } else {
      for (const id of ['programados', 'largos', 'guiones', 'caratulas', 'colchon']) T[id].celdas[c.slug] = celda('sd', 'sin dato');
    }
    T.aprobados.celdas[c.slug] = celda('na', 'pendiente', 'pendiente de activar');
    // métricas
    const mf = path.join(repo, 'salida', 'metricas', hoy, 'metricas.json');
    const mHoy = existe(mf);
    const mDirs = (() => { try { return fs.readdirSync(path.join(repo, 'salida', 'metricas')).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort(); } catch { return []; } })();
    const mUlt = mDirs.at(-1) || null;
    const antes9 = p.h < 9;
    T.metricas.celdas[c.slug] = mHoy ? celda('ok', '✓', `medidas ${hoy.slice(5).split('-').reverse().join('-')}`) : celda(antes9 ? 'warn' : 'bad', antes9 ? 'aún no' : 'falta', mUlt ? `última: ${mUlt.slice(5).split('-').reverse().join('-')}` : 'nunca medidas');

    // ---------- permisos ----------
    const tk = leer(path.join(repo, 'secrets', 'youtube-token.json'));
    let token;
    if (!tk) token = { estado: c.slug === 'entender-chile' ? 'sd' : 'bad', texto: c.slug === 'entender-chile' ? 'sin dato' : 'ausente', detalle: c.slug === 'entender-chile' ? 'no hay archivo local de token' : 'no existe secrets/youtube-token.json' };
    else if (aud) token = { estado: 'ok', texto: 'sin caducidad', detalle: 'API auditada' };
    else if (tk.emitido_en) {
      const vence = tk.emitido_en + (perm.tokenCaducaDias ?? 7) * DIA;
      const rest = (vence - ahora) / DIA;
      token = { estado: rest > 3 ? 'ok' : rest > 0 ? 'warn' : 'bad', texto: rest > 0 ? `vence ${ddmmhm(vence)}` : `venció ${ddmmhm(vence)}`, detalle: rest > 0 ? `quedan ${Math.floor(rest)} d ${Math.floor((rest % 1) * 24)} h` : 'hay que reautorizar', venceMs: vence };
    } else token = { estado: 'warn', texto: 'sin fecha', detalle: 'el archivo no trae emitido_en' };
    const sc = (tk?.scope || '').split(/\s+/);
    const tiene = (s) => sc.some((x) => x.endsWith(s));
    const scopes = tk ? { upload: tiene('/youtube') || tiene('/youtube.upload'), comentarios: tiene('/youtube.force-ssl'), analytics: tiene('/yt-analytics.readonly') } : null;
    const scopesFila = scopes ? { estado: scopes.upload && scopes.comentarios && scopes.analytics ? 'ok' : scopes.upload ? 'warn' : 'bad', texto: [scopes.upload ? 'subir' : null, scopes.comentarios ? 'comentarios' : null, scopes.analytics ? 'analytics' : null].filter(Boolean).join(' · ') || 'ninguno', faltan: [!scopes.upload && 'subir', !scopes.comentarios && 'comentarios', !scopes.analytics && 'analytics'].filter(Boolean) } : { estado: 'sd', texto: 'sin dato', faltan: [] };
    const tel = perm.telefono?.[c.slug];
    const telefono = tel?.verificado === true ? { estado: 'ok', texto: `verificado ${tel.fecha ? ddmmFecha(tel.fecha) : ''}`.trim(), detalle: tel.nota || '' } : tel?.verificado === false ? { estado: 'bad', texto: 'no verificado', detalle: tel.nota || '' } : { estado: 'sd', texto: 'desconocido', detalle: tel?.nota || '' };
    const auditoria = aud ? { estado: 'ok', texto: 'aprobada', detalle: '' } : { estado: 'bad', texto: `en revisión desde ${ddmmFecha(perm.auditoriaApi?.desde || '2026-11-05')}`, detalle: 'no existe bolita-lab/secrets/api-auditada' };
    // repo público
    let repoEst;
    let remoto = '';
    try { remoto = execFileSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
    const mm = remoto.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
    if (!mm) repoEst = { estado: 'bad', texto: 'sin remoto', detalle: 'el repo es solo local' };
    else {
      let vis = null;
      try { vis = JSON.parse(execFileSync('gh', ['repo', 'view', `${mm[1]}/${mm[2]}`, '--json', 'isPrivate'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 })).isPrivate; } catch {}
      if (vis != null) repoEst = vis === false ? { estado: 'ok', texto: 'público', detalle: `${mm[1]}/${mm[2]}` } : { estado: 'warn', texto: 'privado', detalle: `${mm[1]}/${mm[2]}` };
      else if (perm.repoPublicoRespaldo?.[c.slug] != null) repoEst = { estado: perm.repoPublicoRespaldo[c.slug] ? 'ok' : 'warn', texto: perm.repoPublicoRespaldo[c.slug] ? 'público' : 'privado', detalle: 'según config (gh no respondió)' };
      else repoEst = { estado: 'sd', texto: 'sin dato', detalle: `${mm[1]}/${mm[2]}` };
    }
    const wf = ['producir.yml', 'edicion-diaria.yml'].find((f) => existe(path.join(repo, '.github', 'workflows', f)));
    const nube = wf && mm ? { estado: 'ok', texto: 'disponible', detalle: wf } : wf ? { estado: 'warn', texto: 'sin remoto', detalle: wf + ' existe pero el repo no está en GitHub' } : { estado: 'bad', texto: 'no hay', detalle: 'sin .github/workflows/producir.yml' };
    // última corrida
    const logs = (() => { try { return fs.readdirSync(path.join(repo, 'salida', 'logs')).filter((f) => f.endsWith('.log')).map((f) => mtime(path.join(repo, 'salida', 'logs', f))).filter(Boolean); } catch { return []; } })();
    const cronMs = mtime(path.join(repo, 'salida', 'logs', 'cron.log')) ?? mtime(path.join(repo, 'salida', 'cron.log'));
    const logMs = logs.length ? Math.max(...logs) : null;
    const ultMetMs = mUlt ? chileAMs(+mUlt.slice(0, 4), +mUlt.slice(5, 7), +mUlt.slice(8, 10), 23, 59) : null;
    const atras = ultMetMs == null ? 99 : (ahora - ultMetMs) / DIA;
    const ultima = { estado: atras < 1 ? 'ok' : atras < 2 ? 'warn' : 'bad', texto: `métricas ${mUlt ? ddmmFecha(mUlt) : '—'}`, detalle: [cronMs ? `cron.log ${ddmmhm(cronMs)}` : null, logMs ? `último log ${ddmmhm(logMs)}` : null].filter(Boolean).join(' · ') || 'sin logs' };
    filasPerm.push({ slug: c.slug, items: { token, scopes: scopesFila, telefono, auditoria, repo: repoEst, nube, ultima } });

    // ---------- notificaciones ----------
    const N = (sev, texto, limiteMs, extra = {}) => notis.push({ severidad: sev, canal: c.nombre, slug: c.slug, texto, limite: limiteMs ? new Date(limiteMs).toISOString() : null, limiteTxt: limiteMs ? ddmmhm(limiteMs) : null, ...extra });
    if (token.venceMs != null && token.estado !== 'ok') {
      const rest = (token.venceMs - ahora) / DIA;
      if (rest <= 0) N('critica', `el token de YouTube venció el ${ddmmhm(token.venceMs)}`, token.venceMs, { tipo: 'token' });
      else N(rest <= 2 ? 'critica' : 'aviso', `el token de YouTube vence el ${ddmmhm(token.venceMs)}`, token.venceMs, { tipo: 'token' });
    } else if (token.estado === 'bad') N('aviso', 'sin token de YouTube (autorizar la API)', null, { tipo: 'token' });
    if (A) {
      if (A.colchonDias != null && A.colchonDias < 2) N(A.colchonDias < 1 ? 'critica' : 'aviso', `colchón de ${A.colchonDias < 1 ? 'menos de 1 día' : Math.floor(A.colchonDias) + ' d'}: primera ranura vacía ${diaHora(A.primeraVacia.ms)}`, A.primeraVacia.ms, { tipo: 'colchon' });
      const falt = A.enSemana.filter((s) => !s.cubierta);
      if (falt.length) N((falt[0].ms - ahora) < DIA ? 'critica' : 'aviso', `semana sin cubrir: faltan ${falt.length} de ${A.enSemana.length} ranuras hasta el domingo ${ddmm(domMs - 1000)}`, domMs, { tipo: 'semana' });
    }
    if (!mHoy && !antes9) N('aviso', `sin métricas de hoy (última: ${mUlt ? ddmmFecha(mUlt) : 'nunca'})`, null, { tipo: 'metricas' });
  }
  if (!aud) notis.push({ severidad: 'info', canal: 'Todos los canales', slug: null, tipo: 'auditoria', texto: `auditoría de la API de YouTube pendiente (en revisión desde ${ddmmFecha(perm.auditoriaApi?.desde || '2026-11-05')}; los tokens caducan cada 7 días)`, limite: null, limiteTxt: null });
  if (claveEst === 'bad') notis.push({ severidad: 'aviso', canal: 'Panel', slug: null, tipo: 'clave', texto: 'falta la clave YT_API_KEY del panel: la nube no mide con el PC apagado', limite: null, limiteTxt: null });

  const orden = { critica: 0, aviso: 1, info: 2 };
  notis.sort((a, b) => orden[a.severidad] - orden[b.severidad] || (a.limite ? Date.parse(a.limite) : Infinity) - (b.limite ? Date.parse(b.limite) : Infinity));
  notis.forEach((n, i) => { n.id = `${n.tipo || 'n'}-${n.slug || 'global'}`; });

  const out = {
    version: 1,
    generadoEn: new Date(ahora).toISOString(),
    zona: ZONA,
    semana: { hasta: domFecha, siguiente: sigFecha },
    canales: canales.map((c) => ({ slug: c.slug, nombre: c.nombre, color: c.color })),
    tareas: filasTareas,
    permisos: { filas: filasPerm, globales: { ytApiKey: { estado: claveEst, texto: claveTxt, detalle: claveDet } } },
    notificaciones: notis,
    supuestos: { general: 'Ver comentario de cabecera de scripts/tablero.mjs: ranura = día+hora del calendario del canal; programada = entrada de bandeja subida con publicarEn a ≤30 min o plan marcado programado/publicado; semana = hasta el domingo 23:59 Chile.', porCanal: sup },
  };
  if (salida) {
    fs.mkdirSync(salida, { recursive: true });
    fs.writeFileSync(path.join(salida, 'tablero.json'), JSON.stringify(out, null, 2) + '\n');
  }
  return out;
}
function ddmmFecha(f) { const [y, m, d] = f.split('-'); return `${d}-${m}`; }

/** Resumen estable (sin marca de tiempo) para decidir si hay que republicar. */
export function digestTablero(t) {
  const { generadoEn, ...resto } = t;
  return crypto.createHash('sha1').update(JSON.stringify(resto)).digest('hex');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--salida');
  const salida = i > 0 ? process.argv[i + 1] : path.join(RAIZ, 'data');
  const t = generarTablero({ salida });
  console.log(`tablero.json → ${salida} · ${t.notificaciones.length} notificaciones (${t.notificaciones.filter((n) => n.severidad === 'critica').length} críticas)`);
}
