#!/usr/bin/env node
// Servidor estático del panel (sin dependencias). Puerto 8790 (PANEL_PUERTO), host 127.0.0.1 (PANEL_HOST).
// Al pedir /data/panel.json, si el archivo tiene más de 5 min, re-ejecuta el agregador antes de responder.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agregar } from './agregar.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = Number(process.env.PANEL_PUERTO || 8790);
const HOST = process.env.PANEL_HOST || '127.0.0.1';
const VIEJO_MS = 5 * 60 * 1000;
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
// Solo se sirve lo que es del sitio (nada de scripts/, .git, etc.).
const PERMITIDO = /^\/(index\.html|app\.js|estilo\.css|data\/[\w.\-/]+|docs\/capturas\/[\w.\-]+)$/;

let agregando = null;
async function refrescarSiViejo() {
  const f = path.join(RAIZ, 'data', 'panel.json');
  let edad = Infinity;
  try { edad = Date.now() - fs.statSync(f).mtimeMs; } catch { /* no existe */ }
  if (edad <= VIEJO_MS) return;
  agregando ??= Promise.resolve().then(() => agregar()).catch((e) => console.error('[agregar]', e)).finally(() => { agregando = null; });
  await agregando;
}

const servidor = http.createServer(async (req, res) => {
  try {
    let ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (ruta === '/') ruta = '/index.html';
    if (ruta.includes('..') || !PERMITIDO.test(ruta)) { res.writeHead(404).end('no encontrado'); return; }
    if (ruta === '/data/panel.json') await refrescarSiViejo();
    const archivo = path.join(RAIZ, ruta);
    const st = fs.statSync(archivo, { throwIfNoEntry: false });
    if (!st || !st.isFile()) { res.writeHead(404).end('no encontrado'); return; }
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(archivo)] || 'application/octet-stream',
      'cache-control': ruta.startsWith('/data/') ? 'no-store' : 'no-cache',
      'content-length': st.size,
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(archivo).pipe(res);
  } catch (e) {
    res.writeHead(500).end('error');
    console.error(e);
  }
});
servidor.listen(PUERTO, HOST, () => console.log(`Panel en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PUERTO}`));
