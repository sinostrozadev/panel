// Vista "Estrategia" (#/estrategia/<canal>?t=<pestaña>): cómo se arma lo audiovisual de cada canal, carátulas (con el prompt
// literal), títulos, arranque, comparativa con videos populares del nicho, decisiones/experimentos y sugerencias.
// Datos: data/estrategia/index.json + data/estrategia/<canal>.json (scripts/estrategia.mjs). El sitio es estático: para decidir,
// los botones abren un issue prellenado en el repo del canal ("[panel] Aprobar: …"); la sesión de Claude del canal lo lee.
'use strict';
window.Vistas = window.Vistas || {};
(() => {
  const BASE = 'data/estrategia/';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const j = (u) => fetch(u + '?t=' + Date.now(), { cache: 'no-store' }).then((x) => { if (!x.ok) throw new Error(u + ' respondió ' + x.status); return x.json(); });
  const N = new Intl.NumberFormat('es-CL');
  const num = (v) => (typeof v === 'number' ? N.format(v) : esc(v ?? '–'));
  const corta = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const PESTANAS = [
    ['comparativa', 'Comparativa'], ['decisiones', 'Decisiones'], ['arma', 'Cómo se arma'], ['caratulas', 'Carátulas'],
    ['titulos', 'Títulos'], ['arranque', 'Arranque'], ['sugerencias', 'Sugerencias'],
  ];
  const yt = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const mini = (id, alt, cls = '', prog = false) => (prog ? `<span class="es-mini sin ${cls}">miniatura visible cuando se publique</span>` : id ? `<a class="es-mini ${cls}" href="${yt(id)}" target="_blank" rel="noopener"><img src="https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer" width="480" height="360" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'es-ph',textContent:'miniatura no disponible'}))"></a>` : `<span class="es-mini sin ${cls}">sin miniatura</span>`);
  const SVG = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    persona: SVG('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    auto: SVG('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    copiar: SVG('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    issue: SVG('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5"/>'),
  };
  // quién decide: persona o automático (texto libre del json; se muestra siempre el texto)
  const quien = (t) => { const s = String(t || ''); const p = /claude|santiago|revisor|sesi[oó]n|gpt|persona|romi/i.test(s), a = /autom|script|cron|workflow|actions|m[aá]quina|validador|c[oó]digo|nadie|remotion|edge/i.test(s); return p && a ? 'mixto' : p ? 'persona' : a ? 'auto' : 'persona'; };
  // estado de una decisión (texto libre) → clase
  function clase(e) {
    const s = String(e || '').toLowerCase();
    if (/^(le[ií]da|cerrad|cumpli|funcion|ganó|éxito)/.test(s)) return ['cerrada', 'Leída'];
    if (/desactualiz|sin aprobaci|no se cumple|fall|no funcion/.test(s)) return ['alerta', 'Revisar'];
    if (/^en curso|pendiente|sin datos/.test(s)) return ['curso', 'En curso'];
    if (/^(vigente|aplicad)/.test(s)) return ['vigente', 'Vigente'];
    return ['curso', 'En curso'];
  }
  const fechaDe = (s) => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null; };
  const dias = (f) => Math.round((Date.parse(f + 'T12:00:00-03:00') - Date.now()) / 864e5);

  let IDX = null, EL = null, R = null, error = null;
  const DAT = {};
  const params = () => {
    const slug = R?.partes[0] && IDX?.canales.some((c) => c.slug === R.partes[0]) ? R.partes[0] : (IDX?.canales.find((c) => c.slug === 'linea-punteada' && c.estado === 'listo') || IDX?.canales.find((c) => c.estado === 'listo') || IDX?.canales[0])?.slug;
    const t = PESTANAS.some(([k]) => k === R?.q.t) ? R.q.t : 'comparativa';
    return { slug, t };
  };
  function issue(c, accion, texto, extra, d) {
    if (!c.github) return '';
    const titulo = `[panel] ${accion}: ${corta(texto, 90)}`;
    const cuerpo = `${accion}: ${texto}\n\nCanal: ${c.nombre}\n${extra ? extra + '\n' : ''}\nDesde: panel → Estrategia (${d?.actualizado || 'sin fecha'}).\nEscribe abajo si quieres matizar algo y confirma con "Submit new issue".\n\n— La sesión de Claude del canal lee los issues abiertos que empiezan con "[panel]" y los cierra al aplicarlos.`;
    const u = `https://github.com/${c.github}/issues/new?title=${encodeURIComponent(titulo)}&body=${encodeURIComponent(corta(cuerpo, 3000))}`;
    return `<a class="es-is" href="${esc(u)}" target="_blank" rel="noopener" title="Abre un issue prellenado en ${esc(c.github)}; solo falta confirmarlo">${IC.issue}${esc(accion)}</a>`;
  }
  const copiable = (texto, etiqueta) => `<div class="es-cp"><div class="es-cp-h"><span>${esc(etiqueta)}</span><button type="button" class="es-cb" data-copiar>${IC.copiar}Copiar</button></div><pre tabindex="0">${esc(texto)}</pre></div>`;
  const lista = (a) => (a && a.length ? `<ul class="es-ul">${a.map((x) => `<li>${esc(typeof x === 'string' ? x : x.texto ?? JSON.stringify(x))}${x?.archivo ? ` <code>${esc(x.archivo)}</code>` : ''}</li>`).join('')}</ul>` : '<p class="es-0">Sin datos.</p>');

  // ---------- pestañas ----------
  function comparativa(c, d) {
    const R = d.referentes;
    let h = `<p class="es-intro">Cada referente es un video popular del nicho, emparejado con el video nuestro más comparable. Las miniaturas se cargan desde YouTube.</p>`;
    h += R.length ? `<div class="es-cmp">${R.map((r) => {
      const n = r.nuestro || {};
      return `<article class="cmp"><div class="cmp-l"><div class="cmp-lado ref"><span class="cmp-et">Referente</span>${mini(r.id, `Miniatura del video referente: ${r.titulo}`, '', r.programado)}<h4>${r.id ? `<a href="${yt(r.id)}" target="_blank" rel="noopener">${esc(r.titulo)}</a>` : esc(r.titulo)}</h4><p class="cmp-m">${esc(r.canal || '')}</p><dl><dt>Vistas</dt><dd>${num(r.vistas)}</dd><dt>Duración</dt><dd>${esc(r.duracion || '–')}</dd><dt>Fecha</dt><dd>${esc(r.fecha || '–')}</dd></dl></div>
        <div class="cmp-lado nos"><span class="cmp-et">Nuestro</span>${mini(n.id, `Miniatura de nuestro video: ${n.titulo || ''}`, '', n.programado)}<h4>${n.id ? `<a href="${yt(n.id)}" target="_blank" rel="noopener">${esc(n.titulo || n.id)}</a>` : esc(n.titulo || '–')}</h4><dl><dt>Vistas</dt><dd>${num(n.vistas)}</dd></dl>${n.nota ? `<p class="cmp-m">${esc(n.nota)}</p>` : ''}</div></div>
        <div class="cmp-d"><b>Qué hace distinto</b><p>${esc(r.queHaceDistinto || '–')}</p>${r.primeraFrase ? `<details><summary>Primeros segundos</summary><p><b>Primera frase:</b> ${esc(r.primeraFrase)}</p>${r.seg0_5 ? `<p><b>0–5 s:</b> ${esc(r.seg0_5)}</p>` : ''}${r.seg3 ? `<p><b>Segundo 3:</b> ${esc(r.seg3)}</p>` : ''}</details>` : ''}</div></article>`;
    }).join('')}</div>` : '<p class="es-0">Sin referentes todavía.</p>';
    h += `<h3>Brechas</h3>`;
    h += d.brechas.length ? `<div class="es-br">${d.brechas.map((b) => `<article class="br"><h4>${esc(b.dimension)}</h4><div class="br-2"><div><span>Referente</span><p>${esc(b.referente)}</p></div><div><span>Nosotros</span><p>${esc(b.nosotros)}</p></div></div><p class="br-b"><b>Brecha:</b> ${esc(b.brecha)}</p>${b.evidencia ? `<p class="br-e">${esc(b.evidencia)}</p>` : ''}</article>`).join('')}</div>` : '<p class="es-0">Sin brechas registradas.</p>';
    return h;
  }
  function decisiones(c, d) {
    const D = d.decisionesVigentes;
    if (!D.length) return '<p class="es-0">Sin decisiones registradas.</p>';
    const cs = D.map((x) => clase(x.estado));
    const cnt = {}; cs.forEach(([k, t]) => { cnt[t] = (cnt[t] || 0) + 1; });
    let h = `<p class="es-intro">Cada decisión es un experimento: qué se cambió, cómo se mide, el umbral y cuándo se lee. ${Object.entries(cnt).map(([t, n]) => `<span class="es-ch">${n} ${esc(t.toLowerCase())}</span>`).join(' ')}</p><div class="es-dec">`;
    h += D.map((x, i) => {
      const [k, t] = cs[i];
      const fl = fechaDe(x.fechaLectura);
      const dd = fl != null ? dias(fl) : null;
      const vence = dd == null ? '' : dd > 0 ? `en ${dd} día${dd === 1 ? '' : 's'}` : dd === 0 ? 'hoy' : `hace ${-dd} día${dd === -1 ? '' : 's'}`;
      const tarde = dd != null && dd < 0 && k === 'curso';
      return `<article class="dc dc-${k}"><header><span class="dc-e">${esc(t)}</span><time>${esc(x.fecha || '')}</time></header><h4>${esc(x.decision)}</h4><dl><dt>Se mide</dt><dd>${esc(x.comoSeMide || '–')}</dd><dt>Umbral</dt><dd>${esc(x.umbral || '–')}</dd><dt>Lectura</dt><dd${tarde ? ' class="dn"' : ''}>${esc(x.fechaLectura || '–')}${vence ? ` <small>(${tarde ? 'lectura atrasada, ' : ''}${vence})</small>` : ''}</dd></dl><p class="dc-s"><b>Estado:</b> ${esc(x.estado || '–')}</p>${x.resultado ? `<p class="dc-r"><b>Resultado:</b> ${esc(x.resultado)}</p>` : ''}<footer>${x.fuente ? `<small>${esc(x.fuente)}</small>` : '<span></span>'}${issue(c, 'Cambiar', x.decision, `Decisión del ${x.fecha || '?'} · umbral: ${x.umbral || '?'} · lectura: ${x.fechaLectura || '?'} · estado: ${x.estado || '?'}`, d)}</footer></article>`;
    }).join('');
    return h + '</div>';
  }
  function arma(c, d) {
    const A = d.comoSeArma, Q = d.queDefineLoVisual || {};
    const p = R.q.f === 'largo' ? 'largo' : 'short';
    const pasos = A[p] || [];
    let h = '';
    if (Q.respuestaCorta) h += `<div class="es-def"><h3>¿Qué define lo visual?</h3><p class="es-def-r">${esc(Q.respuestaCorta)}</p><div class="es-def-g">${[['plantilla', 'La plantilla (código)'], ['guion', 'El guion'], ['voz', 'La voz'], ['nadie', 'Nadie lo decide (sale solo)']].filter(([k]) => Q[k]?.length).map(([k, t]) => `<div><h4>${t}</h4>${lista(Q[k])}</div>`).join('')}</div>${Q.ejemplo ? `<details class="es-ej"><summary>Ejemplo: del guion a la pantalla</summary><p><code>${esc(Q.ejemplo.archivo || '')}</code></p>${copiable(Q.ejemplo.fragmento || '', 'Fragmento del guion')}<p><b>Qué se ve:</b> ${esc(Q.ejemplo.queSeVe || '')}</p></details>` : ''}</div>`;
    h += `<h3>La cadena, paso a paso</h3>${A.resumen ? `<p class="es-intro">${esc(A.resumen)}</p>` : ''}<div class="seg es-seg" role="group" aria-label="Formato">${['short', 'largo'].map((k) => `<button type="button" data-f="${k}" aria-pressed="${p === k}"><b>${k === 'short' ? 'Short' : 'Largo'}</b><small>${(A[k] || []).length} pasos</small></button>`).join('')}</div>`;
    h += pasos.length ? `<ol class="es-cad">${pasos.map((x) => { const q = quien(x.quienDecide); return `<li><details><summary><span class="cad-n">${esc(x.paso)}</span><span class="cad-t"><b>${esc(x.etapa)}</b><span class="cad-h">${esc(x.herramienta || '')}</span></span><span class="cad-q q-${q}" title="Quién decide">${q === 'auto' ? IC.auto : IC.persona}${q === 'auto' ? 'automático' : q === 'mixto' ? 'persona + máquina' : 'decide alguien'}</span></summary><div class="cad-b"><p>${esc(x.que || '')}</p>${x.detalle ? `<p class="cad-d">${esc(x.detalle)}</p>` : ''}<dl><dt>Herramienta</dt><dd>${esc(x.herramienta || '–')}</dd><dt>Archivo</dt><dd><code>${esc(x.archivo || '–')}</code></dd><dt>Quién decide</dt><dd>${esc(x.quienDecide || '–')}</dd></dl></div></details></li>`; }).join('')}</ol>` : '<p class="es-0">Sin pasos para este formato.</p>';
    if (d.herramientas.length) h += `<h3>Herramientas en uso</h3><div class="es-her">${d.herramientas.map((x) => `<article><h4>${esc(x.nombre)}</h4><p>${esc(x.paraQue || '')}</p><p class="es-m">${esc(x.licenciaCosto || '')}${x.archivo ? ` · <code>${esc(x.archivo)}</code>` : ''}</p></article>`).join('')}</div>`;
    return h;
  }
  function caratulas(c, d) {
    const K = d.caratulas || {};
    let h = K.comoSePide ? `<p class="es-intro">${esc(K.comoSePide)}</p>` : '';
    if (K.plantillaPrompt?.texto) h += `<h3>Prompt molde</h3>${copiable(K.plantillaPrompt.texto, K.plantillaPrompt.archivo || 'Molde')}`;
    if (K.pedidosReales?.length) h += `<h3>Pedidos reales y su resultado</h3><div class="es-ped">${K.pedidosReales.map((x) => `<article>${mini(x.videoId, `Carátula que quedó en: ${x.titulo || ''}`, '', x.programado)}<div><h4>${esc(x.titulo || '')}</h4><p class="es-m">${esc(x.fecha || '')}${x.archivo ? ` · <code>${esc(x.archivo)}</code>` : ''}</p>${copiable(x.prompt || '', 'Prompt enviado a GPT')}</div></article>`).join('')}</div>`;
    h += `<div class="es-2"><div><h3>Fórmula</h3>${lista(K.formula)}</div><div><h3>Cómo se verifica</h3>${lista(K.verificacion)}</div></div>`;
    if (K.shorts) h += `<h3>Shorts</h3><p>${esc(K.shorts.queHaceDeCaratula || '')}</p><p>${esc(K.shorts.comoSeCompone || '')}</p>`;
    if (d.referentes.length) h += `<h3>Galería: referentes vs nuestras</h3><div class="es-gal">${d.referentes.map((r) => `<figure>${mini(r.id, `Referente: ${r.titulo}`, '', r.programado)}${mini(r.nuestro?.id, `Nuestro: ${r.nuestro?.titulo || ''}`, '', r.nuestro?.programado)}<figcaption><span>${esc(corta(r.titulo, 60))}</span><span>${esc(corta(r.nuestro?.titulo || '', 60))}</span></figcaption></figure>`).join('')}</div>`;
    return h;
  }
  function titulos(c, d) {
    const T = d.titulos;
    let h = `<h3>Molde vigente</h3>${lista(T.reglas)}`;
    if (T.retitulados?.length) h += `<h3>Antes y después</h3><div class="es-ret">${T.retitulados.map((x) => `<article><p class="ret-a"><span>Antes</span>${esc(x.antes)}</p><p class="ret-d"><span>Después</span>${esc(x.despues)}</p><p class="es-m">${esc(x.fecha || '')}${x.id ? ` · <a href="${yt(x.id)}" target="_blank" rel="noopener">ver video</a>` : ''}${x.fuente ? ` · ${esc(x.fuente)}` : ''}</p></article>`).join('')}</div>`;
    if (T.ejemplos?.length) h += `<h3>Ejemplos con sus vistas</h3><div class="es-tit">${[...T.ejemplos].sort((a, b) => (+b.vistas || 0) - (+a.vistas || 0)).map((x) => `<article>${mini(x.id, `Miniatura: ${x.titulo}`, 'p', x.programado)}<div><h4>${esc(x.titulo)}</h4><p class="es-m"><b>${num(x.vistas)}</b> vistas${x.fuenteVistas ? ` · ${esc(x.fuenteVistas)}` : ''}</p></div></article>`).join('')}</div>`;
    return h;
  }
  function arranque(c, d) {
    const A = d.arranque;
    let h = `<h3>La regla</h3>${lista(A.regla)}<div class="es-2"><div><h3>Nuestros arranques</h3>`;
    h += A.ejemplos?.length ? A.ejemplos.map((x) => `<blockquote class="es-q nos"><p>${esc(x.primeraFrase)}</p><footer>${x.id ? `<a href="${yt(x.id)}" target="_blank" rel="noopener">${esc(x.titulo || x.id)}</a>` : esc(x.titulo || '')}</footer></blockquote>`).join('') : '<p class="es-0">Sin ejemplos.</p>';
    h += `</div><div><h3>Arranques de los referentes</h3>`;
    const rs = d.referentes.filter((r) => r.primeraFrase);
    h += rs.length ? rs.map((r) => `<blockquote class="es-q ref"><p>${esc(r.primeraFrase)}</p><footer>${r.id ? `<a href="${yt(r.id)}" target="_blank" rel="noopener">${esc(r.titulo)}</a>` : esc(r.titulo)} · ${num(r.vistas)} vistas</footer></blockquote>`).join('') : '<p class="es-0">Sin datos.</p>';
    return h + '</div></div>';
  }
  function sugerencias(c, d) {
    const S = [...d.sugerencias].sort((a, b) => (a.prioridad ?? 99) - (b.prioridad ?? 99));
    if (!S.length) return '<p class="es-0">Sin sugerencias.</p>';
    return `<p class="es-intro">Ordenadas por prioridad. "Aprobar" o "Descartar" abre un issue prellenado en el repo del canal; solo falta confirmarlo.</p><ol class="es-sug">${S.map((x) => `<li><span class="sg-p" aria-label="Prioridad ${esc(x.prioridad)}">${esc(x.prioridad ?? '–')}</span><div><h4>${esc(x.propuesta)}</h4>${x.enCurso ? '<span class="es-ch on">en curso</span>' : ''}<dl><dt>Herramienta</dt><dd>${esc(x.herramienta || '–')}</dd><dt>Costo</dt><dd>${esc(x.costo || '–')}</dd><dt>Cómo se mide</dt><dd>${esc(x.comoSeMide || '–')}</dd></dl>${x.nota ? `<p class="es-m">${esc(x.nota)}</p>` : ''}<p class="sg-b">${issue(c, 'Aprobar', x.propuesta, `Prioridad ${x.prioridad ?? '?'} · costo: ${x.costo || '?'} · se mide: ${x.comoSeMide || '?'}`, d)}${issue(c, 'Descartar', x.propuesta, `Prioridad ${x.prioridad ?? '?'}`, d)}</p></div></li>`).join('')}</ol>`;
  }
  const FN = { comparativa, decisiones, arma, caratulas, titulos, arranque, sugerencias };

  async function pintar() {
    if (!EL) return;
    if (!IDX) { EL.innerHTML = `<div class="gv"><h1 class="gv-t">Estrategia</h1><p class="gv-err">${error ? `No se pudo cargar la estrategia (${esc(error)}).` : 'Cargando…'}</p></div>`; return; }
    const { slug, t } = params();
    const c = IDX.canales.find((x) => x.slug === slug);
    let cuerpo;
    if (!c || c.estado !== 'listo') cuerpo = `<div class="es-vac"><b>${c?.estado === 'con error' ? 'El archivo de estrategia de este canal tiene un error' : 'Contenido en preparación'}</b><p>${c?.estado === 'con error' ? esc(c.avisos.join('; ')) : 'La sesión de estrategia todavía no deja el análisis de este canal. Aparecerá aquí en la próxima actualización del panel.'}</p></div>`;
    else {
      try { DAT[slug] ??= await j(BASE + encodeURIComponent(slug) + '.json'); } catch (e) { cuerpo = `<p class="gv-err">No se pudo cargar (${esc(e.message)}).</p>`; }
      const d = DAT[slug];
      if (d) {
        cuerpo = `<div class="tabs-es" role="tablist" aria-label="Secciones de la estrategia">${PESTANAS.map(([k, n]) => `<button type="button" role="tab" id="es-t-${k}" aria-controls="es-panel" aria-selected="${k === t}" tabindex="${k === t ? 0 : -1}" data-t="${k}">${n}</button>`).join('')}</div>
        <section id="es-panel" role="tabpanel" aria-labelledby="es-t-${t}" class="es-p">${FN[t](c, d)}</section>
        <footer class="es-pie">${d.noEncontrado?.length ? `<div class="es-falta"><h3>Lo que falta medir (${d.noEncontrado.length})</h3><p class="es-m">Datos que el análisis buscó y no encontró registrados en el repo del canal.</p>${lista(d.noEncontrado)}</div>` : ''}${d.fuentes?.length ? `<details><summary>Fuentes (${d.fuentes.length})</summary>${lista(d.fuentes)}</details>` : ''}</footer>`;
      }
    }
    EL.innerHTML = `<div class="gv es" style="--c:${esc(c?.color || '#111827')}">
      <div class="gv-cab"><div><h1 class="gv-t">Estrategia</h1><p class="gv-sub">Cómo se arma lo audiovisual de cada canal y qué estamos probando.${c?.actualizado ? ` Análisis al ${esc(c.actualizado)}.` : ''}${c?.github ? ' Los botones abren un issue en GitHub para decidir.' : ''}</p></div></div>
      <div class="chips" role="group" aria-label="Canal">${IDX.canales.map((x) => `<button type="button" data-canal="${esc(x.slug)}" aria-pressed="${x.slug === slug}" style="--c:${esc(x.color)}"><span class="pt" aria-hidden="true"></span>${esc(x.nombre)}${x.estado !== 'listo' ? ' <small>(en preparación)</small>' : ''}</button>`).join('')}</div>
      ${cuerpo}
    </div>`;
  }
  function ir(cambios) {
    const p = { ...params(), f: R.q.f, ...cambios };
    Nav.fijar('estrategia', [p.slug], { t: p.t, f: p.f });
    R = Nav.ruta();
    pintar();
  }
  function enlazar(el) {
    el.addEventListener('click', async (e) => {
      const cb = e.target.closest('[data-canal]'); if (cb) { ir({ slug: cb.dataset.canal }); return; }
      const tb = e.target.closest('[data-t]'); if (tb) { ir({ t: tb.dataset.t }); document.getElementById('es-t-' + tb.dataset.t)?.focus(); return; }
      const fb = e.target.closest('[data-f]'); if (fb) { ir({ f: fb.dataset.f }); return; }
      const cp = e.target.closest('[data-copiar]');
      if (cp) {
        const txt = cp.closest('.es-cp').querySelector('pre').textContent;
        try { await navigator.clipboard.writeText(txt); cp.lastChild.textContent = 'Copiado'; } catch { const r = document.createRange(); r.selectNodeContents(cp.closest('.es-cp').querySelector('pre')); getSelection().removeAllRanges(); getSelection().addRange(r); cp.lastChild.textContent = 'Seleccionado: Ctrl+C'; }
        document.getElementById('es-vivo').textContent = 'Prompt copiado';
        setTimeout(() => { cp.lastChild.textContent = 'Copiar'; }, 2000);
      }
    });
    el.addEventListener('keydown', (e) => {
      const tb = e.target.closest('[role=tab]'); if (!tb || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const ks = PESTANAS.map(([k]) => k), i = ks.indexOf(tb.dataset.t);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? ks.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + ks.length) % ks.length;
      ir({ t: ks[n] }); document.getElementById('es-t-' + ks[n])?.focus();
    });
  }
  Vistas.estrategia = {
    async montar(el, ruta) {
      if (EL !== el) { EL = el; enlazar(el); if (!document.getElementById('es-vivo')) document.body.insertAdjacentHTML('beforeend', '<div id="es-vivo" class="sr-only" aria-live="polite"></div>'); }
      R = ruta;
      if (!IDX) { pintar(); try { IDX = await j(BASE + 'index.json'); } catch (e) { error = e.message; } }
      pintar();
    },
    async refrescar() { try { IDX = await j(BASE + 'index.json'); for (const k in DAT) delete DAT[k]; error = null; } catch (e) { error = e.message; } pintar(); },
  };
})();
