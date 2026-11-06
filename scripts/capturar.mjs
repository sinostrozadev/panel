#!/usr/bin/env node
// Captura el panel a 375×812 (página completa) y 1280×800 con Playwright headless (el de bolita-lab).
// Uso: node scripts/capturar.mjs [url] → docs/capturas/panel-movil.png, panel-escritorio.png
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire('/home/santiago/projects/yt/bolita-lab/herramientas/navegador/package.json');
const { chromium } = require('playwright');
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'http://localhost:8790';
const nav = await chromium.launch({ headless: true });
for (const [nombre, vp, extra] of [['movil', { width: 375, height: 812 }, { deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['escritorio', { width: 1280, height: 800 }, {}]]) {
  const ctx = await nav.newContext({ viewport: vp, colorScheme: 'dark', reducedMotion: 'reduce', ...extra });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(RAIZ, 'docs', 'capturas', `panel-${nombre}.png`), fullPage: true });
  await p.screenshot({ path: path.join(RAIZ, 'docs', 'capturas', `panel-${nombre}-arriba.png`) });
  console.log(nombre, errores.length ? errores : 'sin errores');
  await ctx.close();
}
await nav.close();
