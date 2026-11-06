// Panel de canales — lee data/panel.json y arma la página. Sin dependencias.
'use strict';

const ZONA = 'America/Santiago';
const RECARGA_MS = 5 * 60 * 1000;
const MEDALLAS = ['🥇', '🥈', '🥉'];
const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('es-CL');
const n = (v) => (v == null ? '—' : nf.format(Math.round(v)));
const compacto = (v) => {
  if (v == null) return '—';
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })} M`;
  if (v >= 1e4) return `${(v / 1e3).toLocaleString('es-CL', { maximumFractionDigits: 1 })} k`;
  return nf.format(Math.round(v));
};
const dec = (v, d = 1) => (v == null ? '—' : v.toLocaleString('es-CL', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const pct = (f) => {
  if (f == null) return '—';
  const p = f * 100;
  const d = p >= 10 ? 0 : p >= 1 ? 1 : 2;
  return `${p.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
};
const inicial = (nombre) => (nombre || '?').trim().charAt(0).toUpperCase();
const fmtFecha = (iso, op) => new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, hourCycle: 'h23', ...op }).format(new Date(iso));
const fechaCorta = (iso) => fmtFecha(iso, { day: 'numeric', month: 'short' });
const fechaHora = (iso) => fmtFecha(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const diaISO = (s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T12:00:00-03:00' : s);
function hace(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

let datos = null;

// ---------- carga ----------
async function cargar() {
  const b = $('#actualizar');
  b.setAttribute('aria-busy', 'true');
  b.textContent = 'Actualizando…';
  try {
    const r = await fetch(`data/panel.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    datos = await r.json();
    pintar(datos);
  } catch (e) {
    $('#bajada').textContent = `No se pudieron leer los datos (${e.message}). ¿Corriste node scripts/agregar.mjs?`;
  } finally {
    b.removeAttribute('aria-busy');
    b.textContent = 'Actualizar';
  }
}

function pintar(d) {
  const canales = d.canales || [];
  const conDatos = canales.filter((c) => c.datos);
  const lider = conDatos[0];
  $('#bajada').innerHTML = lider
    ? `${canales.length} canales en carrera. Va ganando <b>${esc(lider.nombre)}</b> con ${pct(lider.progreso.total)} del camino.`
    : `${canales.length} canales registrados; todavía sin métricas.`;
  pintarPodio(conDatos);
  pintarCarrera(conDatos);
  pintarTabla(canales);
  pintarMejoras(canales);
  pintarTarjetas(canales);
  pintarTrabajos(canales);
  pintarCalendario(d.calendario, canales);
  $('#pie-fecha').textContent = `Datos generados el ${fechaHora(d.generadoEn)} (${hace(d.generadoEn)})${d.publico ? ' · versión pública' : ''}.`;
  animar();
}

// ---------- 1. podio ----------
function ritmoCorto(c) {
  const r = c.ritmo;
  if (!r || r.subsDia == null) return 'sin ritmo aún';
  return `+${dec(r.subsDia)} subs/día`;
}
function pintarPodio(lista) {
  const top = lista.slice(0, 3);
  // orden visual: 2.º, 1.º, 3.º
  const vis = [top[1], top[0], top[2]].map((c, i) => [c, [2, 1, 3][i]]).filter(([c]) => c);
  $('#podio-pasos').innerHTML = vis.map(([c, p]) => `
    <div class="escalon p${p}" style="--c:${esc(c.color)}">
      <div class="medalla" role="img" aria-label="${p}.º lugar">${MEDALLAS[p - 1]}</div>
      <div class="avatar" aria-hidden="true">${esc(inicial(c.nombre))}</div>
      <div class="nombre">${esc(c.nombre)}</div>
      <div class="ritmo">${esc(ritmoCorto(c))}</div>
      <div class="bloque">
        <div class="pct" data-contar="${c.progreso.total * 100}" data-dec="${c.progreso.total * 100 >= 10 ? 0 : c.progreso.total * 100 >= 1 ? 1 : 2}">${pct(c.progreso.total).replace(' %', '')}<small> %</small></div>
        <div class="lugar">${p}.º lugar</div>
      </div>
    </div>`).join('') || '<p class="vacio">Aún no hay canales con métricas.</p>';
}

// Escala de la carrera: hasta el siguiente valor "redondo" sobre el líder, para que las diferencias se vean.
function escalaRedonda(max) {
  const pasos = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 0.75, 1];
  return pasos.find((p) => p >= max * 1.05) ?? 1;
}
function pintarCarrera(lista) {
  const el = $('#carrera');
  if (!lista.length) { el.innerHTML = ''; return; }
  const tope = escalaRedonda(lista[0].progreso.total);
  el.className = 'carrera caja';
  el.innerHTML = `
    <h3>¿Quién va ganando?</h3>
    <p class="escala">Barra llena = ${pct(tope)} del camino${tope < 1 ? ' (la meta es 100 %; la escala se agranda a medida que avanzan)' : ''}.</p>
    ${lista.map((c) => `
      <div class="fila-carrera" style="--c:${esc(c.color)}">
        <div class="quien"><span class="pos">${c.posicion}.</span><span class="punto" aria-hidden="true"></span>${esc(c.nombre)}</div>
        <div class="valor">${pct(c.progreso.total)}</div>
        <div class="pista" role="img" aria-label="${esc(c.nombre)}: ${pct(c.progreso.total)} del camino al YPP"
             data-tip="${esc(c.nombre)} · ${pct(c.progreso.total)} · ${n(c.actual.subs)} subs · ${compacto(c.actual.vistas90d)} vistas">
          <div class="relleno" data-ancho="${Math.min(100, (c.progreso.total / tope) * 100)}"></div>
        </div>
      </div>`).join('')}`;
}

// ---------- 2. tabla ----------
function llegadaTexto(r) {
  if (!r || r.subsDia == null) return 'sin ritmo aún';
  if (r.llegada) return fmtFecha(diaISO(r.llegada), { month: 'short', year: 'numeric' });
  if (r.diasFaltan != null) return 'más de 50 años';
  return 'sin ritmo aún';
}
function tendencia(c) {
  const t = c.tendencia;
  if (!t || t.subs == null) return '<span class="tend igual" title="Hace falta un segundo día de datos">— <span class="tenue">sin ayer</span></span>';
  if (t.subs > 0) return `<span class="tend sube">▲ +${n(t.subs)}</span>`;
  if (t.subs < 0) return `<span class="tend baja">▼ ${n(t.subs)}</span>`;
  return '<span class="tend igual">= 0</span>';
}
function pintarTabla(canales) {
  const tope = escalaRedonda(Math.max(0.0001, ...canales.filter((c) => c.datos).map((c) => c.progreso.total)));
  $('#tabla-posiciones').innerHTML = `
    <caption class="saltar">Tabla de posiciones de los canales</caption>
    <thead><tr>
      <th class="col-pos" scope="col">#</th><th class="col-canal" scope="col">Canal</th>
      <th scope="col">% YPP</th><th scope="col">Subs</th><th scope="col">Vistas</th>
      <th scope="col">Subs/día</th><th scope="col">Vistas/día</th><th scope="col">Llegada estimada</th><th scope="col">vs ayer</th>
    </tr></thead>
    <tbody>${canales.map((c) => `
      <tr style="--c:${esc(c.color)}">
        <th class="col-pos" scope="row">${c.posicion ?? '–'}</th>
        <td class="col-canal"><a href="#canal-${esc(c.slug)}"><span class="punto" aria-hidden="true"></span>${esc(c.nombre)}</a></td>
        ${c.datos ? `
        <td class="fuerte">${pct(c.progreso.total)}<span class="mini-pct" aria-hidden="true"><i style="width:${Math.min(100, (c.progreso.total / tope) * 100)}%"></i></span></td>
        <td>${n(c.actual.subs)}</td>
        <td>${compacto(c.actual.vistasTotales)}</td>
        <td>${c.ritmo?.subsDia != null ? dec(c.ritmo.subsDia) : '—'}</td>
        <td>${c.ritmo?.vistasDia != null ? compacto(c.ritmo.vistasDia) : '—'}</td>
        <td>${esc(llegadaTexto(c.ritmo))}</td>
        <td>${tendencia(c)}</td>` : '<td colspan="7" class="tenue" style="text-align:left">sin datos todavía</td>'}
      </tr>`).join('')}</tbody>`;
  const bases = [...new Set(canales.map((c) => c.ritmo?.base).filter(Boolean))];
  $('#nota-tabla').textContent = `Ritmo: últimos 7 días cuando hay serie; si no, promedio desde la creación del canal. ` +
    `La llegada estimada extrapola ese ritmo a 1.000 subs y 10 M de vistas. Mini-barra: escala 0–${pct(tope)}.`
    + (bases.length ? '' : '');
}

// ---------- 3. tarjetas ----------
function barraMeta(etiqueta, valor, meta, c, formato = n) {
  if (valor == null) return `<div class="meta-barra"><div class="rotulo"><b>${etiqueta}</b><span>sin dato todavía</span></div><div class="pista fina"></div></div>`;
  const f = Math.min(1, valor / meta);
  const falta = Math.max(0, meta - valor);
  return `<div class="meta-barra">
    <div class="rotulo"><b>${etiqueta}</b><span>${formato(valor)} de ${formato(meta)} · ${pct(f)}</span></div>
    <div class="pista fina" role="img" aria-label="${etiqueta}: ${formato(valor)} de ${formato(meta)}" data-tip="${etiqueta}: ${formato(valor)} / ${formato(meta)}"><div class="relleno" data-ancho="${f * 100}"></div></div>
    <div class="falta">${falta > 0 ? `faltan ${formato(falta)}` : 'meta cumplida'}</div>
  </div>`;
}

function grafico(c) {
  const s = (c.serie || []).filter((p) => p.subs != null);
  if (!s.length) return '<p class="vacio">Sin serie todavía.</p>';
  const W = 320, H = 120, pad = { l: 34, r: 14, t: 12, b: 22 };
  const xs = s.map((_, i) => (s.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (s.length - 1)) * (W - pad.l - pad.r)) + pad.l);
  const max = Math.max(1, ...s.map((p) => p.subs));
  const top = Math.ceil(max / (max > 50 ? 10 : 5)) * (max > 50 ? 10 : 5);
  const y = (v) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const pts = s.map((p, i) => `${xs[i].toFixed(1)},${y(p.subs).toFixed(1)}`);
  const area = s.length > 1 ? `<path d="M${pts[0]} L${pts.join(' L')} L${xs.at(-1)},${y(0)} L${xs[0]},${y(0)} Z" fill="${c.color}" opacity=".12"/>` : '';
  const linea = s.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${c.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  const last = s.at(-1);
  const golpes = s.map((p, i) => {
    const x0 = s.length === 1 ? pad.l : i === 0 ? pad.l : (xs[i - 1] + xs[i]) / 2;
    const x1 = s.length === 1 ? W - pad.r : i === s.length - 1 ? W - pad.r : (xs[i] + xs[i + 1]) / 2;
    return `<rect x="${x0}" y="0" width="${x1 - x0}" height="${H}" fill="transparent" data-tip="${esc(fechaCorta(diaISO(p.fecha)))} · ${n(p.subs)} subs · ${compacto(p.vistas)} vistas" data-x="${xs[i]}"/>`;
  }).join('');
  return `<div class="grafico">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Suscriptores por día: ${s.map((p) => `${p.fecha} ${p.subs}`).join(', ')}">
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(top)}" y2="${y(top)}" stroke="var(--grilla)" stroke-width="1"/>
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--base)" stroke-width="1"/>
      <text x="${pad.l - 6}" y="${y(top) + 4}" text-anchor="end" font-size="11" fill="var(--tinta-3)">${n(top)}</text>
      <text x="${pad.l - 6}" y="${y(0) + 4}" text-anchor="end" font-size="11" fill="var(--tinta-3)">0</text>
      <text x="${pad.l}" y="${H - 4}" font-size="11" fill="var(--tinta-3)">${esc(fechaCorta(diaISO(s[0].fecha)))}</text>
      ${s.length > 1 ? `<text x="${W - pad.r}" y="${H - 4}" text-anchor="end" font-size="11" fill="var(--tinta-3)">${esc(fechaCorta(diaISO(last.fecha)))}</text>` : ''}
      ${area}${linea}
      <line class="cruz" x1="0" x2="0" y1="${pad.t}" y2="${y(0)}" stroke="var(--tinta-3)" stroke-width="1" visibility="hidden"/>
      <circle cx="${xs.at(-1)}" cy="${y(last.subs)}" r="5" fill="${c.color}" stroke="var(--superficie)" stroke-width="2"/>
      <text x="${Math.min(xs.at(-1) + 9, W - pad.r)}" y="${y(last.subs) - 9}" text-anchor="${s.length > 1 ? 'end' : 'start'}" font-size="12" font-weight="700" fill="var(--tinta)">${n(last.subs)}</text>
      ${golpes}
    </svg>
    ${s.length < 2 ? '<p class="sin-curva">Un día de datos: la curva aparece desde mañana.</p>' : ''}
  </div>`;
}

function estadoBandeja(x) {
  if (x.estado === 'subido') return 'programado';
  return x.estado || '—';
}

function tarjeta(c) {
  const cab = `
    <div class="tarjeta-cab">
      <div class="fila">
        <div class="avatar" aria-hidden="true">${esc(inicial(c.nombre))}</div>
        <div>
          <h3>${esc(c.nombre)}</h3>
          <div class="meta">${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.handle || 'canal')}</a>` : esc(c.handle || '')}${c.diasDeVida ? ` · día ${n(c.diasDeVida)}` : ''}</div>
        </div>
        <span class="insignia">${c.posicion ? `${c.posicion}.º lugar` : 'sin datos'}</span>
      </div>
      ${c.nicho ? `<div class="meta" style="margin-top:8px">${esc(c.nicho)}</div>` : ''}
      ${c.datos ? `<div class="cifras">
        <div class="cifra"><div class="n" data-contar="${c.actual.subs ?? 0}">${n(c.actual.subs)}</div><div class="l">suscriptores</div></div>
        <div class="cifra"><div class="n" data-contar="${c.actual.vistasTotales ?? 0}" data-compacto="1">${compacto(c.actual.vistasTotales)}</div><div class="l">vistas</div></div>
        <div class="cifra"><div class="n">${pct(c.progreso.total)}</div><div class="l">camino al YPP</div></div>
      </div>` : ''}
    </div>`;

  const bloques = [];
  if (c.datos) {
    const r = c.ritmo || {};
    bloques.push(`<div class="bloque-t"><h4>Camino a la monetización</h4>
      ${barraMeta('Suscriptores', c.actual.subs, 1000, c)}
      ${barraMeta('Vistas Shorts 90 d', c.actual.vistas90d, 1e7, c, compacto)}
      ${barraMeta('Horas vistas', c.actual.horas, 4000, c, (v) => dec(v, v < 10 ? 1 : 0))}
      <div class="ritmo-linea"><span><b>${r.subsDia != null ? '+' + dec(r.subsDia) : '—'}</b> subs/día</span><span><b>${r.vistasDia != null ? '+' + compacto(r.vistasDia) : '—'}</b> vistas/día</span></div>
      <div class="llegada">A este ritmo llega al YPP: <b>${esc(llegadaTexto(r))}</b>${r.base ? `<div class="tenue" style="font-size:13px">ritmo ${esc(r.base)}</div>` : ''}</div>
      <p class="tenue" style="font-size:12.5px;margin:8px 0 0">Datos del ${esc(fechaCorta(diaISO(c.fechaDatos)))} · vistas 90 d: ${esc(c.actual.fuenteVistas90d || '—')}</p>
    </div>`);
    bloques.push(`<div class="bloque-t"><h4>Suscriptores día a día</h4>${grafico(c)}</div>`);
    const maxV = Math.max(1, ...c.videos.map((v) => v.vistas || 0));
    bloques.push(`<div class="bloque-t"><h4>Últimos videos</h4>${c.videos.length ? `<ul class="lista">${c.videos.map((v) => `
      <li><span class="tit">${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.titulo || v.id)}</a>` : esc(v.titulo || v.id)}</span>
        <span class="der">${n(v.vistas)}</span>
        <span class="vbar" aria-hidden="true"><i data-ancho="${(v.vistas / maxV) * 100}"></i></span>
        <span class="sub">${esc(fechaCorta(diaISO(v.publicadoEn)))} · vistas</span></li>`).join('')}</ul>` : '<p class="vacio">Sin videos medidos.</p>'}</div>`);
  } else {
    bloques.push(`<div class="bloque-t ancho"><p class="vacio">Sin datos todavía: el canal aún no guarda <code>salida/metricas/</code>.</p></div>`);
  }

  const b = c.bandeja || { proximos: [] };
  bloques.push(`<div class="bloque-t"><h4>Próximos programados${b.totalProximos > b.proximos.length ? ` · ${b.totalProximos}` : ''}</h4>${b.proximos.length ? `<ul class="lista">${b.proximos.slice(0, 6).map((x) => `
    <li><span class="tit">${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.titulo || x.id)}</a>` : esc(x.titulo || x.id)}</span>
      <span class="der" style="font-weight:600;font-size:13px;color:var(--tinta-2)">${esc(fechaHora(x.publicarEn))}</span>
      <span class="sub"><span class="chip ok">${esc(estadoBandeja(x))}</span>${x.plantilla ? `<span class="chip">${esc(x.plantilla)}</span>` : ''}</span></li>`).join('')}</ul>`
    : `<p class="vacio">Nada programado a futuro${b.enCola ? ` (${b.enCola} en la bandeja sin fecha)` : ''}.</p>`}</div>`);

  if (c.plan !== undefined) {
    const p = c.plan;
    bloques.push(`<div class="bloque-t ancho"><h4>Plan de la semana</h4>${p.estado === 'ok' && p.ranuras.length ? `
      ${p.actualizado ? `<p class="tenue" style="font-size:13px;margin:0 0 6px">Actualizado ${esc(hace(p.actualizado))}</p>` : ''}
      <ul class="lista">${p.ranuras.filter((r) => !r.fecha || Date.parse(diaISO(r.fecha)) >= Date.now() - 86400000).slice(0, 14).map((r) => `
      <li><span class="tit">${esc(r.tema || '(sin tema)')}</span>
        <span class="der" style="font-weight:600;font-size:13px;color:var(--tinta-2)">${r.fecha ? esc(fmtFecha(diaISO(r.fecha), { weekday: 'short', day: 'numeric' })) : ''} ${esc(r.hora || '')}</span>
        <span class="sub">
          ${r.tipo ? `<span class="chip ${r.tipo === 'contingente' ? 'contingente' : r.tipo === 'serie' ? 'serie' : ''}">${esc(r.tipo)}</span>` : ''}
          ${r.estado ? `<span class="chip ${['programado', 'publicado'].includes(r.estado) ? 'ok' : ''}">${esc(r.estado)}</span>` : ''}
          ${r.plantilla ? `<span class="chip">${esc(r.plantilla)}</span>` : ''}
          ${r.serie ? `<span>serie: ${esc(r.serie)}</span>` : ''}
          ${r.bloqueo ? `<span class="chip bloqueo">bloqueo: ${esc(r.bloqueo)}</span>` : ''}
          ${r.contingencia ? `<span>${r.fuente ? `<a href="${esc(r.fuente)}" target="_blank" rel="noopener">${esc(r.contingencia)}</a>` : esc(r.contingencia)}</span>` : ''}
        </span></li>`).join('')}</ul>`
      : `<p class="vacio">${p.estado === 'ok' ? 'Plan sin ranuras.' : 'Sin plan semanal todavía (docs/PLAN-SEMANAL.md).'}</p>`}</div>`);
  }

  bloques.push(bloqueMejoras(c));

  if (c.estrategia !== undefined) {
    const e = c.estrategia;
    bloques.push(`<div class="bloque-t ancho"><h4>Estrategia${e?.actualizada ? ` · actualizada ${e.diasDesde === 0 ? 'hoy' : e.diasDesde === 1 ? 'ayer' : `hace ${e.diasDesde} días`}` : ''}</h4>${e ? `
      ${e.objetivo ? `<p class="objetivo">${esc(e.objetivo)}</p>` : ''}
      ${e.resumen ? `<details><summary>${esc(e.tituloSeccion || 'Resumen')}</summary><p class="resumen">${esc(e.resumen)}</p></details>` : ''}`
      : '<p class="vacio">Sin docs/ESTRATEGIA.md en el repo.</p>'}</div>`);
  }

  if (c.capturas?.length) {
    bloques.push(`<div class="bloque-t ancho"><h4>Última captura de Studio</h4>${c.capturas.map((k) => `
      <details${k.tipo === 'monetizacion' ? ' open' : ''}><summary>${k.tipo === 'monetizacion' ? 'Monetización' : 'Resumen'} · ${esc(fechaCorta(diaISO(k.fecha)))}</summary>
        <figure class="captura" style="margin:0"><img loading="lazy" src="${esc(k.archivo)}" alt="Captura de YouTube Studio (${k.tipo === 'monetizacion' ? 'progreso al Programa de Partners' : 'resumen de estadísticas'}) de ${esc(c.nombre)}, ${esc(k.fecha)}"></figure>
      </details>`).join('')}</div>`);
  }

  return `<article class="tarjeta caja" id="canal-${esc(c.slug)}" style="--c:${esc(c.color)}" aria-labelledby="h-${esc(c.slug)}">
    ${cab.replace('<h3>', `<h3 id="h-${esc(c.slug)}">`)}
    <div class="tarjeta-cuerpo">${bloques.join('')}</div>
  </article>`;
}

function pintarTarjetas(canales) {
  $('#saltos').innerHTML = canales.map((c) => `<a href="#canal-${esc(c.slug)}" style="--c:${esc(c.color)}"><span class="punto" aria-hidden="true"></span>${esc(c.nombre)}</a>`).join('');
  $('#tarjetas').innerHTML = canales.map(tarjeta).join('');
}

// ---------- mejoras ----------
const LISTAS_MEJ = [['detectado', 'Detectado'], ['mejorado', 'Mejorado'], ['herramientas', 'Herramientas exploradas'], ['agregado', 'Agregado'], ['pendiente', 'Pendiente'], ['notas', 'Notas']];
function contadoresMej(t) {
  const x = t || {};
  return `<div class="contadores-mej">${[['detectado', 'detectadas'], ['mejorado', 'mejoradas'], ['herramientas', 'herramientas'], ['agregado', 'agregadas']].map(([k, l]) =>
    `<div class="cm"><b>${n(x[k] ?? 0)}</b><span>${l}</span></div>`).join('')}</div>`;
}
function diaMej(d, abrirMejorado) {
  return LISTAS_MEJ.filter(([k]) => d[k]?.length).map(([k, t]) =>
    `<details${k === 'mejorado' || (k === 'notas' && abrirMejorado) ? ' open' : ''}><summary>${t} · ${d[k].length}</summary><ul class="vinetas">${d[k].map((v) => `<li>${esc(v)}</li>`).join('')}</ul></details>`).join('');
}
function bloqueMejoras(c) {
  const m = c.mejoras;
  if (!m || !m.dias?.length) return `<div class="bloque-t ancho"><h4>Mejoras</h4><p class="vacio">Sin revisiones todavía (salida/revisiones/AAAA-MM-DD.md).</p></div>`;
  const [u, ...resto] = m.dias;
  return `<div class="bloque-t ancho"><h4>Mejoras · última revisión ${esc(fechaCorta(diaISO(u.fecha)))}</h4>
    ${contadoresMej(m.totales)}
    <p class="tenue" style="font-size:12.5px;margin:6px 0 8px">Totales de los últimos ${m.dias.length} día(s) con revisión.</p>
    ${diaMej(u, true)}
    ${resto.length ? `<details><summary>Días anteriores · ${resto.length}</summary>${resto.map((d) => `<div class="dia-ant"><h5>${esc(fechaCorta(diaISO(d.fecha)))}</h5>${diaMej(d, false) || '<p class="vacio">Vacío.</p>'}</div>`).join('')}</details>` : ''}
  </div>`;
}
function pintarMejoras(canales) {
  $('#mejoras-filas').innerHTML = canales.map((c) => {
    const m = c.mejoras;
    const u = m?.dias?.[0];
    const top = (u?.mejorado?.length ? u.mejorado : u?.notas || []).slice(0, 3);
    return `<div class="fila-mej caja" style="--c:${esc(c.color)}">
      <div class="cab"><span class="nombre">${esc(c.nombre)}</span><span class="tenue">${u ? 'revisión del ' + esc(fechaCorta(diaISO(u.fecha))) : 'sin revisiones'}</span></div>
      ${u ? contadoresMej(m.totales) : ''}
      ${top.length ? `<ul class="vinetas">${top.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : '<p class="vacio">Sin revisiones todavía (salida/revisiones/AAAA-MM-DD.md).</p>'}
    </div>`;
  }).join('');
}

// ---------- 4. trabajando ahora ----------
function pintarTrabajos(canales) {
  $('#trabajos').innerHTML = canales.map((c) => {
    const t = c.trabajando || {};
    const activo = t.activo && t.tarea && t.tarea !== 'sin sesión';
    return `<div class="trabajo caja" style="--c:${esc(c.color)}">
      <div class="cab"><span class="nombre">${esc(c.nombre)}</span>
        <span class="estado-vivo ${activo ? 'activo' : ''}"><i aria-hidden="true"></i>${activo ? 'trabajando' : 'sin sesión activa'}</span></div>
      ${activo ? `
        <p class="tarea">${esc(t.tarea)}</p>
        ${t.detalle ? `<p class="detalle">${esc(t.detalle)}</p>` : ''}
        <div class="cuando">${t.desde ? `desde ${esc(fmtFecha(t.desde, { hour: '2-digit', minute: '2-digit' }))}` : ''}${t.actualizado ? ` · actualizado ${esc(hace(t.actualizado))}` : ''}</div>
        ${t.agentes?.length ? `<div class="agentes">${t.agentes.map((a) => `<span class="agente"><b>${esc(a.modelo || 'agente')}</b> · ${esc(a.tarea || '')}</span>`).join('')}</div>` : ''}`
        : `<p class="detalle" style="margin-top:8px">${t.tarea && t.actualizado ? `Última tarea: ${esc(t.tarea)} (${esc(hace(t.actualizado))}).` : 'Nadie trabajando en este proyecto ahora.'}</p>`}
    </div>`;
  }).join('');
}

// ---------- 5. calendario ----------
const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const sinTilde = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const minutos = (hhmm) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? +m[1] * 60 + +m[2] : null; };
function ahoraSantiago() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { dia: DIAS[dia], min: (+p.hour % 24) * 60 + +p.minute };
}
function enVentana(v, ahora) {
  const a = minutos(v.desde), b = minutos(v.hasta);
  if (a == null || b == null) return false;
  return a <= b ? ahora >= a && ahora < b : ahora >= a || ahora < b;
}
function pintarCalendario(cal, canales) {
  const sec = $('#calendario');
  if (!cal) { sec.hidden = true; return; }
  sec.hidden = false;
  const { dia, min } = ahoraSantiago();
  const colorDe = Object.fromEntries(canales.map((c) => [c.slug, c.color]));
  const nombreDe = Object.fromEntries(canales.map((c) => [c.slug, c.nombre]));
  const crons = (cal.cron || []).filter((k) => {
    const d = sinTilde(k.dias);
    return d === '*' || d === '' || d.split(/[ ,]+/).includes(dia);
  }).sort((a, b) => (minutos(a.hora) ?? 9999) - (minutos(b.hora) ?? 9999));
  const ventanas = cal.ventanas || [];
  const pos = (m) => `${(m / 1440) * 100}%`;
  const franjas = ventanas.flatMap((v) => {
    const a = minutos(v.desde), b = minutos(v.hasta);
    if (a == null || b == null) return [];
    const partes = a <= b ? [[a, b]] : [[a, 1440], [0, b]];
    const cls = enVentana(v, min) ? 'franja ahora' : 'franja';
    return partes.map(([x, y]) => `<div class="${cls}" style="left:${pos(x)};width:calc(${pos(y - x)} - 2px)" data-tip="${esc(v.desde)}–${esc(v.hasta)} · ${esc(v.uso.split(': ')[0])}"></div>`);
  }).join('');
  const marcas = crons.map((k) => {
    const m = minutos(k.hora);
    if (m == null) return '';
    return `<div class="marca" style="left:${pos(m)};--c:${esc(colorDe[k.canal] || '#898781')}" data-tip="${esc(k.hora)} · ${esc(nombreDe[k.canal] || k.canal)} · ${esc(k.tarea)}"></div>`;
  }).join('');
  const horas = [0, 6, 12, 18, 24].map((h) => `<span class="hora" style="left:${pos(h * 60)}">${h}:00</span>`).join('');
  const presentes = [...new Set(crons.map((k) => k.canal))];
  const turnoMap = cal.turnoNoche || {};
  const turno = turnoMap[dia] ?? turnoMap[Object.keys(turnoMap).find((k) => sinTilde(k) === dia)];
  sec.querySelector('#cal').innerHTML = `
    <div class="cal-caja caja">
      <p class="nota-seccion" style="margin:0">Hoy (${esc(fmtFecha(new Date().toISOString(), { weekday: 'long', day: 'numeric', month: 'long' }))}), hora de Chile.</p>
      <div class="leyenda">${presentes.map((s) => `<span><span class="punto" style="--c:${esc(colorDe[s] || '#898781')}"></span>${esc(nombreDe[s] || s)}</span>`).join('')}</div>
      <div class="dia-strip" role="img" aria-label="Línea del día con las ventanas de trabajo y las tareas automáticas">${franjas}${marcas}<div class="aguja" style="left:${pos(min)}"></div>${horas}</div>
      ${ventanas.map((v) => {
        const m = /^(.+?): (.*)$/s.exec(v.uso);
        const titulo = m ? m[1] : null, resto = m ? [' ' + m[2]] : [];
        return `<div class="ventana ${enVentana(v, min) ? 'ahora' : ''}"><span class="h">${esc(v.desde)}–${esc(v.hasta)}</span>
          <span class="u">${resto.length ? `<b style="color:var(--tinta)">${esc(titulo)}</b>:${esc(resto.join(':'))}` : esc(v.uso)}${enVentana(v, min) ? ' <span class="chip ok">ahora</span>' : ''}</span></div>`;
      }).join('')}
      <h4 style="margin:16px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--tinta-3)">Tareas automáticas de hoy</h4>
      <ul class="lista">${crons.map((k) => `<li><span class="tit"><span class="punto" style="--c:${esc(colorDe[k.canal] || '#898781')};margin-right:8px" aria-hidden="true"></span>${esc(nombreDe[k.canal] || k.canal)} · ${esc(k.tarea)}</span><span class="der" style="font-size:14px">${esc(k.hora)}</span></li>`).join('')}</ul>
      ${turno ? `<div class="turno">Turno sugerido de esta noche: <b>${esc(nombreDe[turno] || turno)}</b></div>` : ''}
    </div>`;
}

// ---------- animaciones y tooltip ----------
function animar() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('[data-ancho]').forEach((el) => { el.style.width = `${el.dataset.ancho}%`; });
  }));
  if (quieto) return;
  document.querySelectorAll('[data-contar]').forEach((el) => {
    const fin = parseFloat(el.dataset.contar);
    if (!Number.isFinite(fin) || fin <= 0) return;
    const decs = el.dataset.dec != null ? +el.dataset.dec : 0;
    const final = el.innerHTML;
    const t0 = performance.now(), dur = 1100;
    const paso = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const v = fin * (1 - Math.pow(1 - k, 3));
      if (k >= 1) { el.innerHTML = final; return; }
      const txt = el.dataset.compacto ? compacto(v) : v.toLocaleString('es-CL', { minimumFractionDigits: decs, maximumFractionDigits: decs });
      el.innerHTML = el.dataset.dec != null ? `${txt}<small> %</small>` : txt;
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  });
}

const tip = $('#tooltip');
function mostrarTip(e) {
  const el = e.target.closest?.('[data-tip]');
  if (!el) { tip.hidden = true; ocultarCruz(); return; }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const x = e.clientX ?? el.getBoundingClientRect().left;
  const y = e.clientY ?? el.getBoundingClientRect().top;
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2))}px`;
  tip.style.top = `${Math.max(8, y - 42)}px`;
  const svg = el.closest('svg');
  ocultarCruz();
  if (svg && el.dataset.x) {
    const cruz = svg.querySelector('.cruz');
    cruz.setAttribute('x1', el.dataset.x); cruz.setAttribute('x2', el.dataset.x); cruz.setAttribute('visibility', 'visible');
  }
}
function ocultarCruz() { document.querySelectorAll('.cruz').forEach((c) => c.setAttribute('visibility', 'hidden')); }
document.addEventListener('pointermove', mostrarTip);
document.addEventListener('pointerdown', mostrarTip);
document.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

$('#actualizar').addEventListener('click', cargar);
setInterval(() => { if (!document.hidden) cargar(); }, RECARGA_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && datos && Date.now() - Date.parse(datos.generadoEn) > RECARGA_MS) cargar();
});
cargar();
