// Vista "Guiones" (#/guiones[/<canal>]?s=<lunes>&f=<filtro>&r=<ranura>): de un vistazo, en qué etapa va el guion de cada ranura.
// Datos: data/guiones/ranuras/index.json (resumen) y data/guiones/ranuras/<canal>.json (detalle, al abrir una ficha).
// Generados por scripts/ranuras.mjs. Se vuelve a pedir el índice cada minuto mientras la vista está visible.
'use strict';
window.Vistas = window.Vistas || {};
(() => {
  const BASE = 'data/guiones/ranuras/';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const j = (u) => fetch(u + '?t=' + Date.now(), { cache: 'no-store' }).then((x) => { if (!x.ok) throw new Error(u + ' respondió ' + x.status); return x.json(); });
  const DS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'], DL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const dia = (f) => new Date(f + 'T12:00:00Z').getUTCDay();
  const dm = (f) => `${+f.slice(8)} ${MS[+f.slice(5, 7) - 1]}`;
  const rango = (w) => (w.desde.slice(5, 7) === w.hasta.slice(5, 7) ? `${+w.desde.slice(8)}–${dm(w.hasta)}` : `${dm(w.desde)} – ${dm(w.hasta)}`);
  const sumaDias = (f, n) => new Date(Date.parse(f + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const ROL = { anterior: 'Anterior', 'en-curso': 'En curso', proxima: 'Próxima', subsiguiente: 'Siguiente' };
  const SV = (d) => `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const SIM = { ok: SV('M2.5 6.5l2.3 2.2L9.5 3.5'), fallo: SV('M3 3l6 6M9 3l-6 6'), pend: '', sd: '?', na: '–' };
  const PAL = { ok: 'hecho', fallo: 'falló', pend: 'pendiente', sd: 'sin registro', na: 'no aplica' };
  const EST = { lista: 'Lista', publicada: 'Publicada', 'en-curso': 'En curso', problema: 'Con problema', vacia: 'Vacía', descartada: 'Descartada' };
  const FILTROS = [['', 'Todas las ranuras'], ['falta', 'Solo lo que falta'], ['problema', 'Solo con problema']];
  const mmss = (s) => (s == null ? null : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
  const coma = (x) => String(x).replace('.', ',');
  const hace = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 6e4); if (!(m >= 0)) return ''; if (m < 1) return 'recién'; if (m < 60) return `hace ${m} min`; const h = Math.floor(m / 60); return h < 48 ? `hace ${h} h ${m % 60} min` : `hace ${Math.round(h / 24)} días`; };
  const horaCl = (iso) => new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  let IDX = null, EL = null, R = null, timer = null, error = null, cargando = null;
  const DET = {};

  async function cargar(forzar) {
    if (cargando) return cargando;
    cargando = (async () => {
      try {
        const n = await j(BASE + 'index.json');
        const cambio = !IDX || n.generadoEn !== IDX.generadoEn;
        IDX = n; error = null;
        if (cambio) for (const k in DET) delete DET[k];
        return cambio || forzar;
      } catch (e) { error = e.message; return true; } finally { cargando = null; }
    })();
    return cargando;
  }
  const params = () => ({ canal: R?.partes[0] || '', s: R?.q.s || '', f: R?.q.f || '', r: R?.q.r || '' });
  function semanaSel() {
    const p = params();
    return IDX.semanas.find((w) => w.id === p.s) || IDX.semanas.find((w) => w.rol === 'en-curso') || IDX.semanas[0];
  }
  function fijar(cambios) {
    const p = { ...params(), ...cambios };
    Nav.fijar('guiones', p.canal ? [p.canal] : [], { s: p.s, f: p.f, r: p.r });
    R = Nav.ruta();
  }

  // ---------- piezas ----------
  function vida(rn, grande) {
    return `<span class="vida${grande ? ' g' : ''}" aria-hidden="true">${IDX.etapas.map((k) => { const e = rn.etapas[k.id] || { e: 'pend' }; return `<i class="s-${e.e}" title="${esc(k.nombre)}: ${esc(e.t || PAL[e.e])}">${SIM[e.e]}</i>`; }).join('')}</span>`;
  }
  function estadoTxt(rn) {
    if (rn.descartada) return { c: 'na', t: 'Descartada' + (rn.motivo ? ': ' + rn.motivo : '') };
    if (rn.vacia) return { c: 'pend', t: 'Vacía: falta todo' };
    if (rn.fallo) {
      const k = IDX.etapas.find((x) => x.id === rn.fallo);
      const e = rn.fallo === 'caratula' ? rn.caratula : rn.etapas[rn.fallo];
      return { c: 'fallo', t: `${k ? k.nombre : 'Carátula'}: ${e?.t || 'falló'}` };
    }
    const hechas = IDX.etapas.filter((k) => rn.etapas[k.id]?.e === 'ok');
    const sig = IDX.etapas.find((k) => rn.etapas[k.id]?.e === 'pend');
    const ult = hechas.at(-1);
    if (!ult) return { c: 'pend', t: 'Sin empezar' };
    if (ult.id === 'publicado') return { c: 'ok', t: 'Publicado' };
    if (ult.id === 'programado') return { c: 'ok', t: `Programado ${rn.etapas.programado.t || ''}` };
    return { c: 'cur', t: `${ult.nombre}${sig ? ` · falta ${sig.nombre.toLowerCase()}` : ''}` };
  }
  function aria(c, rn) {
    const est = estadoTxt(rn).t;
    const et = rn.vacia || rn.descartada ? '' : ' Etapas: ' + IDX.etapas.map((k) => `${k.nombre} ${PAL[rn.etapas[k.id]?.e || 'pend']}`).join(', ') + '.';
    return `${c.nombre}, ${DL[dia(rn.fecha)]} ${+rn.fecha.slice(8)} a las ${rn.hora}, ${rn.formato === 'largo' ? 'largo' : 'Short'}: ${rn.titulo || 'sin título'}. ${est}.${rn.nota != null ? ` Nota del revisor ${coma(rn.nota)}.` : ''}${et}`;
  }
  function ficha(c, rn) {
    const tipo = `<span class="tp ${rn.formato}">${rn.formato === 'largo' ? 'Largo' : 'Short'}</span>`;
    const st = estadoTxt(rn);
    const top = `<span class="fi-top"><time>${esc(rn.hora)}</time>${tipo}${rn.nota != null ? `<span class="nt" title="Nota del revisor">${esc(coma(rn.nota))}</span>` : ''}</span>`;
    if (rn.vacia) return `<div class="fi vacia" role="note" aria-label="${esc(aria(c, rn))}">${top}<span class="fi-tit">Vacía</span><span class="fi-est pend">Sin plan ni guion</span></div>`;
    const tit = rn.titulo || rn.tema || 'Sin título';
    const alerta = rn.caratula?.e === 'fallo' && rn.fallo !== 'caratula' ? '<span class="fi-al">⚠ sin carátula</span>' : '';
    return `<button type="button" class="fi e-${rn.estado}" data-r="${esc(rn.id)}" data-c="${esc(c.slug)}" aria-haspopup="dialog" aria-label="${esc(aria(c, rn))}">${top}<span class="fi-tit" title="${esc(tit)}">${esc(tit)}</span>${rn.descartada ? '' : vida(rn)}<span class="fi-est ${st.c}">${st.c === 'fallo' ? SIM.fallo : st.c === 'ok' || st.c === 'cur' ? SIM.ok : ''}${esc(st.t)}</span>${alerta}</button>`;
  }
  const barra = (n, t, cls = '') => `<span class="bar ${cls}" aria-hidden="true"><u style="width:${t ? Math.round((n / t) * 100) : 0}%"></u></span>`;
  function resumenCanal(c) {
    if (c.error) return `<article class="rc" style="--c:${esc(c.color)}"><h3>${esc(c.nombre)}</h3><p class="rc-err">⚠ ${esc(c.error)}</p></article>`;
    const fila = (rol) => {
      const w = IDX.semanas.find((x) => x.rol === rol); const x = c.semanas[w.id]; if (!x) return '';
      const comp = x.total && x.conGuion === x.total;
      return `<div class="rc-f"><span class="rc-l">${ROL[rol]} <small>${esc(rango(w))}</small></span><b>${x.conGuion}/${x.total}</b>${barra(x.conGuion, x.total, comp ? 'ok' : '')}<small class="rc-d">guiones escritos · ${x.programados} programados${x.problemas ? ` · <span class="dn">${x.problemas} con problema</span>` : ''}</small></div>`;
    };
    const st = c.stock;
    const stock = st ? `<details class="rc-st"><summary>Stock: <b>${st.n}</b> guion${st.n === 1 ? '' : 'es'} sin asignar</summary>${st.items.length ? `<ul>${st.items.map((i) => `<li>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.titulo)}</a>` : esc(i.titulo)} <small>${esc(i.carpeta)}${i.revisor ? ' · revisor: ' + esc(i.revisor.t) : ''}</small></li>`).join('')}</ul>` : '<p>Ninguno.</p>'}</details>` : '<p class="rc-st na">Stock: no aplica (flujo semanal: cada guion nace para su ranura)</p>';
    const sel = params().canal === c.slug;
    return `<article class="rc${sel ? ' sel' : ''}" style="--c:${esc(c.color)}"><h3><button type="button" class="rc-b" data-canal="${esc(c.slug)}" aria-pressed="${sel}">${esc(c.nombre)}<span class="sr-only">: ver solo este canal</span></button></h3>${fila('en-curso')}${fila('proxima')}${stock}</article>`;
  }
  function grilla(c, w, f) {
    if (c.error) return '';
    const dias = Array.from({ length: 7 }, (_, i) => sumaDias(w.desde, i));
    const deSem = c.ranuras.filter((r) => r.semana === w.id);
    const pasa = (r) => !f || (f === 'problema' ? r.estado === 'problema' : ['vacia', 'en-curso', 'problema'].includes(r.estado));
    const vis = deSem.filter(pasa);
    const x = c.semanas[w.id] || {};
    const cab = `<header class="gc-h"><h2><span class="pt" style="background:${esc(c.color)}" aria-hidden="true"></span>${esc(c.nombre)}</h2><p>${x.total ? `${x.conGuion}/${x.total} con guion · ${x.aprobados} aprobados por el revisor · ${x.programados} programados` : 'Sin ranuras esta semana'}${x.descartadas ? ` · ${x.descartadas} descartada${x.descartadas > 1 ? 's' : ''}` : ''}</p></header>`;
    if (!vis.length) return `<section class="gc" style="--c:${esc(c.color)}">${cab}<p class="gc-vacio">${deSem.length ? (f === 'problema' ? 'Ninguna ranura con problema esta semana.' : 'No falta nada esta semana.') : 'No hay ranuras en el plan ni en el calendario para esta semana.'}</p></section>`;
    const col = dias.map((d) => {
      const rs = vis.filter((r) => r.fecha === d);
      const hoy = d === IDX.hoy;
      return `<div class="gd${hoy ? ' hoy' : ''}${d < IDX.hoy ? ' pas' : ''}${rs.length ? '' : ' sin'}"><h3 class="gd-h"><span>${DS[dia(d)]}</span> ${+d.slice(8)}${hoy ? ' <em>hoy</em>' : ''}</h3><div class="gd-l">${rs.map((r) => ficha(c, r)).join('') || '<span class="gd-0">—</span>'}</div></div>`;
    }).join('');
    return `<section class="gc" style="--c:${esc(c.color)}">${cab}<div class="gs">${col}</div></section>`;
  }
  function leyenda() {
    return `<details class="ley"><summary>Cómo leer la línea de vida</summary><div><ol class="ley-e">${IDX.etapas.map((k, i) => `<li><span class="vida"><i class="s-ok">${i + 1}</i></span> ${esc(k.nombre)}</li>`).join('')}</ol><ul class="ley-s"><li><span class="vida"><i class="s-ok">${SIM.ok}</i></span> hecho</li><li><span class="vida"><i class="s-fallo">${SIM.fallo}</i></span> falló (rechazado, validador en rojo, pasó la hora sin video)</li><li><span class="vida"><i class="s-pend"></i></span> pendiente</li><li><span class="vida"><i class="s-sd">?</i></span> sin registro (no hay archivo que lo diga; no significa que falló)</li><li><span class="vida"><i class="s-na">–</i></span> no aplica</li></ul><p>${esc(IDX.nota || '')}</p></div></details>`;
  }

  function pintar() {
    if (!EL) return;
    if (!IDX) { EL.innerHTML = `<div class="gv"><h1 class="gv-t">Guiones</h1><p class="gv-err">${error ? `No se pudieron cargar los datos de guiones (${esc(error)}). En el PC se generan con <code>node scripts/ranuras.mjs</code>; en la versión pública llegan con la próxima publicación.` : 'Cargando…'}</p></div>`; return; }
    const p = params(), w = semanaSel();
    const canales = IDX.canales.filter((c) => !p.canal || c.slug === p.canal);
    const y0 = window.scrollY;
    EL.innerHTML = `<div class="gv">
      <div class="gv-cab"><div><h1 class="gv-t">Guiones</h1><p class="gv-sub">Cada ranura de publicación y en qué etapa va su guion. Datos generados ${esc(horaCl(IDX.generadoEn))} (<span id="gv-hace">${esc(hace(IDX.generadoEn))}</span>)${error ? ` · <span class="dn">no se pudo actualizar: ${esc(error)}</span>` : ''}. Se vuelven a pedir cada minuto.</p></div></div>
      <section class="rcs" aria-label="Resumen por canal">${IDX.canales.map(resumenCanal).join('')}</section>
      <div class="ctl" role="group" aria-label="Filtros">
        <div class="seg" role="group" aria-label="Semana">${IDX.semanas.map((x) => `<button type="button" data-s="${esc(x.id)}" aria-pressed="${x.id === w.id}"><b>${ROL[x.rol]}</b><small>${esc(rango(x))}</small></button>`).join('')}</div>
        <div class="chips" role="group" aria-label="Canal"><button type="button" data-canal="" aria-pressed="${!p.canal}">Todos</button>${IDX.canales.map((c) => `<button type="button" data-canal="${esc(c.slug)}" aria-pressed="${p.canal === c.slug}" style="--c:${esc(c.color)}"><span class="pt" aria-hidden="true"></span>${esc(c.nombre)}</button>`).join('')}</div>
        <label class="fsel">Mostrar <select id="gv-f">${FILTROS.map(([v, t]) => `<option value="${v}"${p.f === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      ${leyenda()}
      <h2 class="sr-only">Semana ${esc(ROL[w.rol])}, ${esc(rango(w))}</h2>
      ${canales.map((c) => grilla(c, w, p.f)).join('')}
    </div>`;
    window.scrollTo(0, y0);
  }

  // ---------- detalle ----------
  async function abrir(slug, rid) {
    const c = IDX.canales.find((x) => x.slug === slug); if (!c) return;
    const rn = c.ranuras.find((x) => x.id === rid); if (!rn) return;
    fijar({ r: rid });
    const sub = `${DL[dia(rn.fecha)]} ${+rn.fecha.slice(8)} ${MS[+rn.fecha.slice(5, 7) - 1]} · ${rn.hora} · ${rn.formato === 'largo' ? 'Largo' : 'Short'}${rn.plantilla ? ' · ' + rn.plantilla : ''}`;
    const cerrado = () => { if (Nav.actual() === 'guiones') fijar({ r: '' }); };
    const host = Modal.abrir({ titulo: rn.titulo || rn.tema || 'Ranura', sub: `${c.nombre} · ${sub}`, color: c.color, html: '<div class="mvac">Cargando…</div>', cerrado });
    let d = null;
    try { DET[slug] ??= await j(BASE + encodeURIComponent(slug) + '.json'); d = DET[slug].detalles[rid] || null; } catch (e) { d = null; }
    if (!host.isConnected || host.innerHTML === '') return;
    host.innerHTML = detalle(c, rn, d);
    host.scrollTop = 0;
  }
  const li = (arr) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const linkTxt = (s) => { const m = String(s).match(/https?:\/\/\S+/); return m ? esc(s.slice(0, m.index)) + `<a href="${esc(m[0])}" target="_blank" rel="noopener">${esc(m[0])}</a>` + esc(s.slice(m.index + m[0].length)) : esc(s); };
  function detalle(c, rn, d) {
    const meta = [rn.palabras ? `${rn.palabras} palabras` : null, rn.durSeg ? `${mmss(rn.durSeg)} ${rn.durReal ? '(render)' : 'estimada'}` : null, rn.estadoPlan ? `plan: ${rn.estadoPlan}` : null].filter(Boolean);
    const links = [rn.url && `<a class="lk yt" href="${esc(rn.url)}" target="_blank" rel="noopener">▶ Ver en YouTube</a>`, ...(d?.archivos || []).map((a) => `<a class="lk" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.ruta)}">${esc(a.nombre)} en GitHub ↗</a>`)].filter(Boolean);
    const etapas = [...IDX.etapas, ...(rn.caratula ? [{ id: 'caratula', nombre: 'Carátula' }] : [])].map((k) => { const e = k.id === 'caratula' ? rn.caratula : rn.etapas[k.id] || { e: 'pend' }; return `<li class="s-${e.e}"><span class="vida g"><i class="s-${e.e}">${SIM[e.e]}</i></span><b>${esc(k.nombre)}</b><span>${esc(e.t || PAL[e.e])}</span><small>${PAL[e.e]}</small></li>`; }).join('');
    let h = `<div class="dt">`;
    if (meta.length) h += `<p class="dt-meta">${meta.map(esc).join(' · ')}</p>`;
    if (rn.tema) h += `<p class="dt-tema"><b>Tema en el plan:</b> ${esc(rn.tema)}</p>`;
    if (rn.bloqueo) h += `<p class="dt-al">⚠ ${esc(rn.bloqueo)}</p>`;
    if (rn.descartada) h += `<p class="dt-al na">Descartada en el plan${rn.motivo ? ': ' + esc(rn.motivo) : ''}</p>`;
    if (links.length) h += `<p class="dt-lk">${links.join('')}</p>`;
    h += `<h3>Línea de vida</h3><ol class="dt-v">${etapas}</ol>`;
    if (!d) return h + `<p class="mvac">No se encontró el detalle de esta ranura (el archivo del canal no cargó o aún no se regenera).</p></div>`;
    // revisor
    const rv = d.revisor;
    h += `<h3>Revisor independiente</h3>`;
    if (!rv) h += `<p class="dt-sd">Sin registro: no hay archivo en <code>salida/revisiones/guiones/</code> para este guion.</p>`;
    else if (rv.flujo) h += `<p class="dt-sd">${esc(rv.t)}. Este canal no guarda una nota estructurada por guion: ${rv.e === 'ok' ? 'la pieza está en <code>contenido/semana/</code>, que su flujo reserva a lo aprobado' : 'la pieza quedó en <code>contenido/borradores-semana/</code> porque no pasó'}.${rv.url ? ` <a href="${esc(rv.url)}" target="_blank" rel="noopener">Veredictos ↗</a>` : ''}</p>`;
    else {
      h += `<div class="rv"><div class="rv-n ${rv.e}"><b>${rv.nota != null ? esc(coma(rv.nota)) : '–'}</b><span>${rv.aprobado ? 'aprobado' : 'rechazado'}${rv.ronda ? ` · ronda ${rv.ronda}` : ''}</span>${rv.modelo || rv.fecha ? `<small>${esc([rv.modelo, rv.fecha && rv.fecha.slice(0, 10)].filter(Boolean).join(' · '))}</small>` : ''}</div>`;
      if (rv.puntajes.length) h += `<div class="rv-p">${rv.puntajes.map((p) => `<div><span>${esc(p.k)}</span><span class="bar ${p.v < 3 ? 'bad' : p.v < 4 ? 'warn' : 'ok'}" aria-hidden="true"><u style="width:${Math.min(100, p.v * 20)}%"></u></span><b>${esc(coma(p.v))}</b></div>`).join('')}</div>`;
      h += `</div>`;
      const fal = rv.bloqueantes.filter((b) => !b.ok);
      if (rv.bloqueantes.length) h += `<p class="rv-b">${fal.length ? `<span class="dn">Bloqueantes que fallan:</span> ${fal.map((b) => `<b>${esc(b.k)}</b>${b.nombre ? ` (${esc(b.nombre)})` : ''}`).join(' · ')}` : `Los ${rv.bloqueantes.length} bloqueantes se cumplen`}</p>`;
      if (rv.rondas.length > 1) h += `<p class="rv-r">Rondas: ${rv.rondas.slice().reverse().map((r) => `ronda ${r.ronda ?? '?'}: ${r.aprobado ? 'aprobado' : 'rechazado'}${r.promedio != null ? ' ' + coma(r.promedio) : ''}`).join(' · ')}</p>`;
      if (rv.resumen) h += `<p>${esc(rv.resumen)}</p>`;
      if (rv.motivos.length) h += `<h4>Observaciones</h4>${li(rv.motivos)}`;
      if (rv.cambios.length) h += `<h4>Cambios pedidos</h4>${li(rv.cambios)}`;
      if (rv.url) h += `<p><a href="${esc(rv.url)}" target="_blank" rel="noopener">Registro completo del revisor ↗</a></p>`;
    }
    // verificación
    const ve = d.verificacion;
    h += `<h3>Verificación de hechos</h3><p class="dt-sd dt-ve"><span class="vida g"><i class="s-${ve.e}">${SIM[ve.e] || ''}</i></span> ${esc(ve.t || PAL[ve.e])}${ve.url ? ` · <a href="${esc(ve.url)}" target="_blank" rel="noopener">abrir ↗</a>` : ''}</p>`;
    if (ve.texto) h += `<details class="dt-x"><summary>Ver el informe</summary><pre>${esc(ve.texto)}</pre></details>`;
    // guion
    h += `<h3>Guion${rn.palabras ? ` · ${rn.palabras} palabras` : ''}</h3>`;
    if (d.bloques.length) h += `<div class="gz dt-g">${d.bloques.map((b) => `<h4>${esc(b.h)}</h4>${b.t.map((p) => (typeof p === 'string' ? `<p>${esc(p)}</p>` : `<p class="gz-m">${esc(p.x)}</p>`)).join('')}`).join('')}</div>`;
    else if (!d.ficha.length) h += `<p class="dt-sd">Sin texto de guion en el repo.</p>`;
    if (d.ficha.length) h += `<dl class="dt-f">${d.ficha.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    if (d.fuentes.length) h += `<h4>Fuentes</h4><ul class="dt-src">${d.fuentes.map((s) => `<li>${linkTxt(s)}</li>`).join('')}</ul>`;
    if (d.descripcion) h += `<details class="dt-x"><summary>Descripción para YouTube</summary><pre>${esc(d.descripcion)}</pre></details>`;
    if (d.porQue || d.referente) h += `<h4>Por qué está en el plan</h4>${d.porQue ? `<p>${esc(d.porQue)}</p>` : ''}${d.referente ? `<p>Referente: ${linkTxt(d.referente)}</p>` : ''}`;
    return h + '</div>';
  }

  // ---------- eventos ----------
  function enlazar(el) {
    el.addEventListener('click', (e) => {
      const fi = e.target.closest('.fi[data-r]'); if (fi) { abrir(fi.dataset.c, fi.dataset.r); return; }
      const s = e.target.closest('[data-s]'); if (s) { fijar({ s: s.dataset.s }); pintar(); return; }
      const cb = e.target.closest('[data-canal]'); if (cb) { const v = cb.dataset.canal; fijar({ canal: params().canal === v && cb.classList.contains('rc-b') ? '' : v }); pintar(); return; }
    });
    el.addEventListener('change', (e) => { if (e.target.id === 'gv-f') { fijar({ f: e.target.value }); pintar(); } });
  }
  function reloj() { const x = document.getElementById('gv-hace'); if (x && IDX) x.textContent = hace(IDX.generadoEn); }
  Vistas.guiones = {
    async montar(el, ruta) {
      if (EL !== el) { EL = el; enlazar(el); }
      R = ruta;
      if (!IDX) { pintar(); await cargar(); }
      pintar();
      if (R.q.r && R.partes[0] && document.getElementById('mod').hidden) abrir(R.partes[0], R.q.r);
      else if (R.q.r && !R.partes[0]) { const c = IDX?.canales.find((x) => x.ranuras.some((y) => y.id === R.q.r)); if (c) abrir(c.slug, R.q.r); }
      clearInterval(timer);
      timer = setInterval(async () => { reloj(); if (document.hidden) return; if (await cargar()) { if (document.getElementById('mod').hidden) pintar(); } }, 60000);
    },
    async refrescar() { const bt = document.getElementById('bt'); bt.classList.add('gira'); await cargar(true); pintar(); setTimeout(() => bt.classList.remove('gira'), 500); },
    salir() { clearInterval(timer); timer = null; },
  };
})();
