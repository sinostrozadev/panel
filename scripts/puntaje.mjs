// Puntaje por canal = promedio (ponderado, peso 1 por defecto) de los porcentajes de cada criterio.
// Criterios en data/criterios.json. Funciones puras: reciben las filas del historial y devuelven el desglose.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIA = 86_400_000;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function cargarCriterios(f = path.join(RAIZ, 'data', 'criterios.json')) {
  return JSON.parse(fs.readFileSync(f, 'utf8')).criterios;
}

const pct = (valor, meta) => (num(valor) == null || !(meta > 0)) ? null : Math.max(0, Math.min(100, (valor / meta) * 100));

// filas: del canal, ordenadas por ts ascendente. Devuelve la última con ts <= t.
const hasta = (filas, t) => { let r = null; for (const f of filas) { if (Date.parse(f.ts) <= t) r = f; else break; } return r; };

// Alza semanal de `campo` al instante t, escalada a 7 días. Base: última fila <= t-7d; si no hay, la primera
// (estimado). Con menos de 20 h de historia no hay dato.
function crecimientoSemanal(filas, campo, t) {
  const ahora = hasta(filas, t);
  if (!ahora || num(ahora[campo]) == null) return null;
  let base = hasta(filas.filter((f) => num(f[campo]) != null), t - 7 * DIA);
  let estimado = false;
  if (!base) { base = filas.find((f) => num(f[campo]) != null); estimado = true; }
  if (!base) return null;
  const span = t - Date.parse(base.ts);
  if (span < 20 * 3_600_000) return null;
  const dias = span / DIA;
  const delta = ahora[campo] - base[campo];
  return { valor: delta * (7 / Math.min(7, dias)) , estimado: estimado && dias < 6.5, nota: `${delta >= 0 ? '+' : ''}${delta} en ${dias.toFixed(1)} d` };
}

// Videos publicados en los 7 días hasta t: con la lista de fechas de publicación si es reciente; si no, alza del
// contador de videos del historial.
function publicados7d(filas, pubs, t) {
  if (Array.isArray(pubs) && pubs.length) {
    const ult = Math.max(...pubs);
    if (t - ult <= 2 * DIA || t < ult) {
      const n = pubs.filter((p) => p <= t && p > t - 7 * DIA).length;
      return { valor: n, estimado: false, nota: `${n} publicados` };
    }
  }
  const c = crecimientoSemanal(filas, 'videos', t);
  return c ? { valor: Math.max(0, c.valor), estimado: true, nota: `por contador de videos (${c.nota})` } : null;
}

function valorActual(filas, campo, t, fechaCreacion) {
  const f = hasta(filas, t);
  if (!f) return null;
  if (campo !== 'vistas90d') return num(f[campo]) == null ? null : { valor: f[campo], estimado: false };
  if (num(f.vistas90d) != null) return { valor: f.vistas90d, estimado: false, nota: 'Studio' };
  const vida = fechaCreacion ? (t - Date.parse(fechaCreacion + 'T00:00:00-03:00')) / DIA : null;
  if (vida != null && vida < 90 && num(f.vistas) != null) return { valor: f.vistas, estimado: true, nota: 'estimado: vistas totales (canal < 90 días)' };
  return null;
}

export function puntajeCanal(criterios, canal, t) {
  const { slug, filas, pubs, fechaCreacion } = canal;
  const out = [];
  for (const c of criterios) {
    const meta = c.metaPorCanal?.[slug] ?? c.meta;
    let r = null;
    if (c.calculo === 'valor') r = valorActual(filas, c.campo, t, fechaCreacion);
    else if (c.calculo === 'crecimiento_semanal') r = crecimientoSemanal(filas, c.campo, t);
    else if (c.calculo === 'publicados_7d') r = publicados7d(filas, pubs, t);
    const p = r ? pct(r.valor, meta) : null;
    out.push({
      id: c.id, grupo: c.grupo ?? 'monetizacion', nombre: c.nombre, unidad: c.unidad ?? null, peso: c.peso ?? 1, meta,
      valor: r ? Math.round(r.valor * 100) / 100 : null,
      pct: p == null ? null : Math.round(p * 100) / 100,
      estimado: !!r?.estimado, nota: r?.nota ?? null,
    });
  }
  const prom = (g) => {
    const con = out.filter((x) => x.grupo === g && x.pct != null);
    const pesoTot = con.reduce((s, x) => s + x.peso, 0);
    const tot = out.filter((x) => x.grupo === g).length;
    return { puntaje: pesoTot ? Math.round((con.reduce((s, x) => s + x.pct * x.peso, 0) / pesoTot) * 100) / 100 : null, n: con.length, total: tot };
  };
  const m = prom('monetizacion'), r = prom('ritmo');
  return { puntaje: m.puntaje, n: m.n, total: m.total, ritmo: r, criterios: out };
}

// Tabla de posiciones en el instante t (solo canales con puntaje). Desempate: subs.
export function tablaEn(criterios, canales, t) {
  const filas = canales.map((c) => {
    const p = puntajeCanal(criterios, c, t);
    return { slug: c.slug, subs: hasta(c.filas, t)?.subs ?? 0, ...p };
  }).filter((x) => x.puntaje != null);
  filas.sort((a, b) => b.puntaje - a.puntaje || b.subs - a.subs || a.slug.localeCompare(b.slug));
  filas.forEach((f, i) => { f.posicion = i + 1; });
  return filas;
}
