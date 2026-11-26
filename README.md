# Panel de canales

Página estática (HTML/CSS/JS sin framework ni build) con un **lateral izquierdo** y tres vistas:

- **Dashboard** (`#/`): la carrera de los canales hacia la monetización (tarjetas, tareas, permisos, campana).
- **Guiones** (`#/guiones[/<canal>]?s=<lunes>&f=falta|problema&r=<ranura>`): cada ranura de publicación de la semana
  (anterior, en curso, próxima, siguiente) y la línea de vida de su guion: idea → escrito → verificado → revisor →
  renderizado → programado → publicado (+ carátula en los largos). Al abrir una ficha: texto del guion, nota del
  revisor por criterio, verificación y enlaces a YouTube y GitHub.
- **Estrategia** (`#/estrategia/<canal>?t=comparativa|decisiones|arma|caratulas|titulos|arranque|sugerencias`):
  cómo se arma lo audiovisual de cada canal, prompts de carátula, comparativa con videos populares del nicho y
  decisiones/experimentos.

Público: **https://sinostrozadev.github.io/panel/**.

- Local: **http://localhost:8790** (`node scripts/servir.mjs`).
- Funciona offline: sin CDN, sin librerías, sin fuentes externas.

## Estructura

```
index.html                         la página: lateral + Dashboard (CSS y JS del Dashboard van dentro)
nav.js  lateral.css                lateral y enrutador por hash (SECCIONES = la lista de entradas)
ranuras.js  ranuras.css            vista Guiones (lee data/guiones/ranuras/)
estrategia.js  estrategia.css      vista Estrategia (lee data/estrategia/)
guiones.js  guiones.css            lector de guiones del diálogo "Guiones" de cada tarjeta del Dashboard
guiones.html                       redirige a #/guiones (enlaces viejos)
scripts/ranuras.mjs                → data/guiones/ranuras/index.json + <canal>.json
scripts/estrategia.mjs             → data/estrategia/index.json + <canal>.json
app.js  estilo.css                 versión anterior del panel (ya no se publica)
scripts/agregar.mjs                agregador → data/panel.json + data/capturas/
scripts/servir.mjs                 servidor estático :8790 (re-agrega si el JSON tiene > 5 min)
scripts/publicar.sh                empuja el sitio a gh-pages de origin (si existe)
scripts/capturar.mjs               capturas 375×812 y 1280×800 con Playwright de bolita-lab → docs/capturas/
cron.txt                           líneas sugeridas para el crontab (no se instalan solas)
data/                              generado (ignorado por git)
```

## Uso

```bash
node scripts/agregar.mjs                         # idempotente
nohup node scripts/servir.mjs >> /tmp/panel-servir.log 2>&1 &   # dejarlo corriendo
PANEL_PUERTO=8790 PANEL_HOST=0.0.0.0 node scripts/servir.mjs     # para verlo desde el celular en la misma red
node scripts/capturar.mjs                        # con el servidor arriba
```

Para pararlo: `kill <pid>` (el pid lo da `ss -ltnp | grep 8790`). Para que vuelva solo tras reiniciar: la línea `@reboot` de `cron.txt`.

## Fuentes (lo que lee el agregador)

Registro: `~/.claude/canales/canales.json` (`CANALES_DIR` lo cambia):

```json
{ "canales": [ { "slug": "linea-punteada", "nombre": "Línea Punteada", "handle": "@lineapunteada",
  "canalId": "UC…", "repo": "/home/santiago/projects/yt/linea-punteada", "color": "#d95926",
  "nicho": "Geografía narrada en español", "fechaCreacion": "2026-11-05" } ] }
```

Agregar un canal = agregar un objeto. Colores: paleta categórica validada para fondo oscuro, en este orden
(no inventar otros): `#3987e5` `#d95926` `#199e70` `#c98500` `#d55181` `#008300` `#9085e9` `#e66767`.

Por cada canal, todo opcional (lo que falta se muestra como "sin datos todavía", "sin plan", etc., sin romper):

| Archivo (en el repo del canal salvo indicación) | Qué se usa |
|---|---|
| `salida/metricas/AAAA-MM-DD/metricas.json` (skill `metricas-diarias`) | serie diaria: `subs`, `vistasTotales`, `horasTotales`, `progresoYPP.{vistasShorts90d,horas12m}`, `videos[]` (`id,titulo,vistas,publicadoEn,tipo`) del último día |
| `salida/metricas/*/1-overview.png`, `2-monetizacion.png` | la última de cada una se copia a `data/capturas/<slug>-overview.png` / `-monetizacion.png` (los `fallo-*` no) |
| `docs/PLAN-SEMANAL.md` (skill `plan-semanal`) | primer bloque ```` ```json ```` que sea un array o tenga `ranuras[]` |
| `docs/ESTRATEGIA.md` (skill `estrategia-viva`) | primera cita `>` = objetivo; sección `## 1…` = resumen (≤ 1.200 car.); fecha del último commit que la tocó |
| `salida/revisiones/AAAA-MM-DD.md` (o la ruta de `revisiones` en `canales.json`, relativa al repo; ej. Entender Chile: `"revisiones": "bitacora/mejoras"`) | sección **Mejoras**: archivos de los últimos 14 días (máx. 5, más reciente primero). H2 fijos `## Detectado`, `## Mejorado`, `## Herramientas exploradas`, `## Agregado` y opcional `## Pendiente`, con viñetas `- …` (se limpia `**negrita**` y enlaces). Sin esos H2, las viñetas de primer nivel van a `notas`. Sale en `canal.mejoras {ultima, dias[], totales}`, también en la versión pública |
| `salida/bandeja/*.json` | `titulo, estado, publicarEn` (o `programado`), `url`/`videoId`: lo que sale a futuro |
| `~/.claude/canales/estado/<slug>.json` | "trabajando ahora": `tarea, detalle, desde, agentes[{modelo,tarea}], actualizado`; > 6 h sin actualizar = sin sesión activa |
| `~/.claude/canales/calendario.json` | `ventanas[{desde,hasta,uso}]`, `cron[{canal,hora,dias,tarea}]`, `turnoNoche{lun…dom}`; si no existe, la sección se oculta |

## Contrato de salida: `data/panel.json`

```
version, generadoEn (ISO), zona, meta {subs:1000, vistas90d:1e7, horas:4000}, formulaProgreso,
publico (bool), omitido ([] o ["estrategia","plan"]), ranking [slug…], calendario (tal cual o null),
canales[] (ya ordenados por posición):
  slug, nombre, handle, canalId, color, nicho, fechaCreacion, url, diasDeVida, repoEncontrado,
  datos (bool), posicion (null si no hay datos), fechaDatos, generadoDatos,
  actual { subs, vistasTotales, horas, videosPublicados, vistas90d, fuenteVistas90d, fuenteNumeros },
  progreso { total, subs, vistas, horas, ruta: "shorts"|"horas" }        (fracciones 0–1)
  ritmo { subsDia, vistasDia, horasDia, base, llegada (AAAA-MM-DD|null), diasFaltan },
  tendencia { subs, vistas, vs } | null                                   (vs el día anterior con datos)
  serie [ { fecha, subs, vistas, horas } ],
  videos [ { id, titulo, vistas, publicadoEn, tipo, url } ]               (últimos 6 publicados)
  capturas [ { tipo: "monetizacion"|"overview", fecha, archivo } ],
  bandeja { proximos [ { id, titulo, estado, tipo, plantilla, publicarEn, url } ], totalProximos, enCola },
  plan { estado: "ok"|"sin plan"|"plan sin bloque json", actualizado, semanas, ranuras [ { fecha, hora, formato,
         plantilla, tema, tipo, serie, estado, fuente, contingencia, videoId, porQue, bloqueo } ] },
  estrategia { objetivo, tituloSeccion, resumen, actualizada, diasDesde } | null,
  trabajando { activo, motivo, tarea, detalle, desde, actualizado, agentes [ { modelo, tarea } ] }
```

### Reglas de cálculo

- **Progreso** = `0,5·min(1, subs/1000) + 0,5·min(1, max(vistas90d/10 M, horas/4000))`.
- **vistas90d**: la de Studio (`progresoYPP.vistasShorts90d`) si existe; si no, suma de los Shorts del JSON publicados en
  90 días; si no, vistas totales. `fuenteVistas90d` dice cuál se usó. **Vistas totales** = el mayor entre el total
  público y la suma por video (el total público llega con atraso).
- **Ranking**: progreso; desempate por subs/día. Canales sin datos al final, sin posición.
- **Ritmo**: diferencia de los últimos 7 días de la serie; con un solo día, promedio desde `fechaCreacion`.
- **Llegada estimada**: el día en que, a ese ritmo, se cumplen 1.000 subs **y** (10 M vistas **o** 4.000 h). Sin ritmo →
  "sin ritmo aún"; más de 50 años → "más de 50 años".

## Agregar una sección al lateral

1. En `nav.js`, agrega un objeto a `SECCIONES` (`id`, `nombre`, `ayuda`, `icono` = trazos SVG de 24×24).
2. En `index.html`, agrega `<section id="v-<id>" hidden></section>` dentro de `<main>` y los `<link>`/`<script>` de la
   vista (antes de `nav.js`, que va último).
3. En el JS de la vista: `window.Vistas = window.Vistas || {}; Vistas.<id> = { montar(el, ruta) {…}, refrescar() {…}, salir() {…} }`.
   `ruta` = `{ id, partes: [...segmentos], q: {query} }`; para cambiar filtros sin ensuciar el historial: `Nav.fijar(id, partes, q)`.
4. Agrega los archivos nuevos a la lista `cp` de `scripts/publicar.sh` y de `.github/workflows/actualizar.yml`.

## Vista Guiones: de dónde sale cada dato (`scripts/ranuras.mjs`)

Lee, solo lectura, el repo de cada canal del registro (`~/.claude/canales/canales.json`):

| Etapa | Fuente |
|---|---|
| ranuras | `docs/PLAN-SEMANAL.md` (bloque JSON) + `salida/bandeja/*.json` con `publicarEn` + `contenido/calendario.json` (las que nadie cubre, desde hoy, salen "vacías"). Entender Chile: `contenido/semana/<jue>/*.json` y `contenido/borradores-semana/<jue>/*.json`; ranuras Short 12:00 diario + largo mié 19:00 |
| idea | la ranura existe en el plan (`estado: descartado` = descartada, gris, no cuenta como faltante) |
| escrito | `guion` del plan, o el id de la bandeja en `contenido/{guiones,backlog,borradores,reserva,largos}` |
| verificado | `contenido/verificaciones/<id>.md` o `VERIFICACION-<id>.md`; si no, lo que dejó el revisor (`verificar-cifras`, hechos verificados); EC: `verificacion.md` de la semana |
| revisor | `salida/revisiones/guiones/<id>[.rondaN].json` (ronda más alta; nota = `promedio`, criterios = `puntajes`, `bloqueantes`, `motivos`, `cambios`). EC no tiene registro estructurado: lo que está en `semana/` pasó según su flujo (sin nota) y lo de `borradores-semana/` quedó rechazado |
| renderizado | `.mp4` en la bandeja, estado `subido/listo/privado`, `artefacto` (nube) o ya tiene `videoId` |
| programado | `videoId` + `publicarEn` (bandeja), plan `programado`, o EC `hechos/<pieza>.txt` |
| publicado | la hora pasó y estaba programado (confirmado por la API si el id está en `data/videos/<canal>.json`); si la hora pasó sin video: ✗ |

"Sin registro" (?) = no hay archivo que lo diga; no significa que falló. Stock = guiones en `backlog/` y `guiones/` que
ninguna ranura ni bandeja usa (mismo criterio que el tablero). El panel es público: solo salen rutas relativas al repo,
ids, textos (ya públicos en GitHub) y fechas; rutas `/home/…` y correos se recortan.

**Cómo se actualiza:** `agregar.mjs` (cron */30 del PC) lo regenera y `publicar.sh` lo sube a gh-pages; `servir.mjs`
lo regenera al vuelo si tiene > 2 min (para seguir en vivo el ritual del jueves en http://localhost:8790/#/guiones).
La nube (Actions) **no** tiene los repos de los canales: republica el último `data/guiones/` publicado desde el PC.
Con el PC apagado, la versión pública muestra el último estado y su hora de generación.

## Vista Estrategia (`scripts/estrategia.mjs`)

El contenido lo escribe la sesión de estrategia de Claude en `/home/santiago/projects/yt/_propuestas/estrategia-audiovisual/<slug>.json`
(`ESTRATEGIA_DIR` lo cambia). El script valida el esquema (claves que faltan → vacío + aviso), saca rutas locales, correos y
cualquier cosa con forma de token, y copia a `data/estrategia/`. Sin archivo, la vista muestra "contenido en preparación".
Miniaturas: por URL de `i.ytimg.com` (lazy, `no-referrer`), nunca se descargan; las de videos programados que aún no salen no se piden.

**Decidir desde el panel:** el sitio es estático y no guarda nada. Los botones **Aprobar / Descartar** (sugerencias) y
**Cambiar** (decisiones) abren `github.com/<repo del canal>/issues/new` con título `[panel] Aprobar: …` y el cuerpo ya
escrito; Santiago solo confirma con "Submit new issue". Protocolo: la sesión de Claude de cada canal revisa al abrir los
issues abiertos de su repo que empiezan con `[panel]` (`gh issue list -R <repo> --search "[panel] in:title"`), los aplica
y los cierra con un comentario.

## Avisos y autorizaciones (banner)

Banner arriba de todo, un bloque por aviso, con el color del canal. Las sesiones de Claude lo manejan con
`scripts/avisos.mjs` (formato de `~/.claude/canales/avisos.json` en el README de esa carpeta):

```bash
node scripts/avisos.mjs avisar --canal linea-punteada --id ID --titulo "..." --texto "..." [--vence ISO] [--sin-publicar]
node scripts/avisos.mjs pedir  --canal linea-punteada --id ID --titulo "..." --texto "..."   # botones Autorizar / No
node scripts/avisos.mjs cerrar --id ID
node scripts/avisos.mjs revisar     # lee la respuesta (issues "AUTORIZO <id>" / "RECHAZO <id>" de sinostrozadev) y la publica
```

Los botones del banner abren `github.com/sinostrozadev/panel/issues/new` con el título prellenado; Santiago solo
confirma con "Submit new issue". `revisar` marca el aviso, cierra el issue y republica. `avisar`/`pedir` publican
solos (`PANEL_PUBLICO=1 publicar.sh`). **Cron:** la línea `*/5 * * * * … avisos.mjs revisar` está comentada en
`cron.txt`; NO se instaló, la pega Santiago.

## Publicación (internet)

`scripts/publicar.sh` construye `index.html, app.js, estilo.css, data/` en una carpeta temporal y la empuja a la rama
`gh-pages` de `origin`. No crea el remoto ni publica nada si no existe. **Privacidad:** por defecto la versión pública
omite estrategia y plan (`omitido` en el JSON); con `PANEL_PUBLICO=1` los incluye. `PANEL_DOMINIO=…` escribe el
`CNAME`. Después, en GitHub: Settings → Pages → rama `gh-pages`, y en Cloudflare un CNAME al `<usuario>.github.io`.
Ojo: la versión pública sigue incluyendo "trabajando ahora" y las capturas de Studio.

## Diseño

- Oscuro, mobile-first (375 px), tipografía del sistema, acento por canal (paleta categórica validada con el
  validador de la skill `dataviz`: todos los pares pasan CVD y contraste ≥ 3:1 sobre el fondo).
- La identidad nunca depende solo del color: nombre al lado de cada punto/barra, posición numérica, medallas con texto.
- La barra de "¿Quién va ganando?" usa una escala redonda sobre el líder (5 %, 10 %, …, 100 %) y lo dice: al inicio los
  progresos son diminutos y a escala 100 % no se vería quién va adelante.
- Animaciones (barras que crecen, contadores) desactivadas con `prefers-reduced-motion`. Recarga sola cada 5 min.
