#!/usr/bin/env node
// Actualización en la nube (GitHub Actions), sin depender del PC. Trabaja SOLO con este repo:
// parte del último historial/resumen publicados en gh-pages (descargados a data/ por el workflow), pide
// channels.list?part=statistics con la API key del secreto YT_API_KEY, suma la medición y recalcula puntajes
// y adelantamientos con la misma lógica que el PC (scripts/ciclo.mjs). Horas de visionado y otros datos que
// solo existen en el PC se conservan del último valor conocido (fecha en horasFecha).
// Salida: escribe `publicar=true|false` en $GITHUB_OUTPUT. Sin YT_API_KEY o sin cambios: sale sin error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.PANEL_SIN_RED = '1';
const { refrescarVivo, procesar } = await import('./ciclo.mjs');

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(RAIZ, 'data');
const salir = (publicar, msg) => {
  console.log(msg);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `publicar=${publicar}\n`);
  process.exit(0);
};
const leer = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

const key = (process.env.YT_API_KEY || '').trim();
if (!key) salir(false, 'Falta el secreto YT_API_KEY: no se hace nada (sin error).');
if (!leer(path.join(DATA, 'historial.json')) || !leer(path.join(DATA, 'resumen.json')))
  salir(false, 'Todavía no hay historial/resumen publicados en gh-pages: primero publica desde el PC (PANEL_PUBLICO=1 bash scripts/publicar.sh).');

const hashAnterior = leer(path.join(DATA, 'puntajes.json'))?.hash ?? null;
const m = await refrescarVivo({ forzar: true, apiKey: key });
console.log('medición:', JSON.stringify(m));
if (!m.medido) salir(false, 'La API falló; se conserva lo último publicado.');
const r = procesar(DATA, Date.now(), { remoto: null });
if (r.hash === hashAnterior) salir(false, 'Sin cambios en los números: no se publica.');
salir(true, 'Cambió algo: se publica. ' + r.tabla.map((t) => `${t.posicion}. ${t.nombre} ${t.puntaje} %`).join(' · '));
