#!/usr/bin/env bash
# Publica el panel en la rama gh-pages del remoto `origin` (GitHub Pages).
# NO crea el remoto: si no hay `origin`, sale sin hacer nada.
#
#   scripts/publicar.sh                       → versión pública SIN estrategia ni plan (privacidad por defecto)
#   PANEL_PUBLICO=1 scripts/publicar.sh       → incluye estrategia y plan
#   PANEL_DOMINIO=panel.midominio.cl scripts/publicar.sh → además escribe el CNAME para el dominio propio
#
# Construye en una carpeta temporal (index.html, app.js, estilo.css, data/) y la empuja como un único
# commit a gh-pages (rama de artefactos: se reescribe en cada publicación).
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"
if ! URL="$(git remote get-url origin 2>/dev/null)"; then
  echo "No hay remoto 'origin'. Crea el repo en GitHub y: git remote add origin <url>. Nada publicado." >&2
  exit 1
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp index.html "$TMP/"
cp -r avatares "$TMP/avatares"
node scripts/agregar.mjs --salida "$TMP/data" --publico
# la página nueva solo usa resumen.json: no se publica el resto
rm -rf "$TMP/data/panel.json" "$TMP/data/capturas"
touch "$TMP/.nojekyll"
[ -n "${PANEL_DOMINIO:-}" ] && echo "$PANEL_DOMINIO" > "$TMP/CNAME"
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$RAIZ" config user.name)" -c user.email="$(git -C "$RAIZ" config user.email)" \
  commit -q -m "panel: publicación $(date -Iseconds)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -q --force "$URL" gh-pages:gh-pages
echo "Publicado en gh-pages de $URL$( [ "${PANEL_PUBLICO:-}" = 1 ] && echo ' (con estrategia y plan)' || echo ' (sin estrategia ni plan)')."
