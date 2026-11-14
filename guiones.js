// Lista por día y lector de guiones (flechas ‹ ›). Lo usan guiones.html (página) y el diálogo del panel (index.html).
//   Guiones.montar(host, { slug, idx, scroller, esc, id, onLeer(id), onLista() })
// idx = data/guiones/index.json. host recibe la lista o el lector. scroller = elemento que desplaza (por defecto la ventana).
'use strict';
window.Guiones = (() => {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const j = (u) => fetch(u + '?t=' + Date.now(), { cache: 'no-store' }).then((x) => { if (!x.ok) throw new Error(u + ' ' + x.status); return x.json(); });
  const DS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const fecha = (f) => { if (!f) return null; const d = new Date(f + 'T12:00:00'); return `${DS[d.getDay()]} ${f.slice(8)}-${f.slice(5, 7)}`; };
  const cls = (e) => esc(String(e).replace(/\s+/g, '-'));
  const cache = {};
  const canal = async (slug) => (cache[slug] ??= await j('data/guiones/' + slug + '.json'));
  const arriba = (o) => { const s = o.scroller; if (s) s.scrollTop = 0; else window.scrollTo(0, 0); };

  async function montar(host, o) {
    const c = o.idx.canales.find((x) => x.slug === o.slug);
    const d = await canal(o.slug);
    const LIST = d.items; let POS = 0;
    if (host._gzKey) document.removeEventListener('keydown', host._gzKey);

    function lista() {
      POS = -1;
      const por = Object.entries(c?.porEstado ?? {}).map(([k, v]) => v + ' ' + k).join(' · ') || 'sin guiones';
      let h = `<div class="gz"><div class="gz-cnt">${esc(c?.ventana ?? '')} · ${esc(por)}</div>`;
      if (!LIST.length) h += '<div class="gz-vacio">Sin guiones en esta ventana.</div>';
      let ult = null;
      LIST.forEach((i, n) => {
        const k = i.fecha || 'sin';
        if (k !== ult) { ult = k; h += `<div class="gz-dia">${i.fecha ? esc(fecha(i.fecha)) : 'Sin fecha asignada'}</div>`; }
        h += `<button type="button" class="gz-it" style="--c:${esc(d.color)}" data-n="${n}"><b>${esc(i.titulo)}</b><div class="gz-meta"><span class="gz-bd ${cls(i.estado)}">${esc(i.estado)}</span>${i.hora ? `<span>${esc(i.hora)}${i.ranuraPlan ? ' (según plan)' : ''}</span>` : ''}<span>${esc(i.plantilla)}${i.formato ? ' · ' + esc(i.formato) : ''}</span>${i.palabras ? `<span>${i.palabras} palabras</span>` : ''}</div></button>`;
      });
      host.innerHTML = h + '</div>';
      arriba(o);
      if (o.onLista) o.onLista();
    }
    function leer(n) {
      POS = n; const i = LIST[n];
      const par = (p) => typeof p === 'string' ? `<p>${esc(p)}</p>` : `<p class="gz-m">${esc(p.x)}</p>`;
      let h = `<div class="gz"><div class="gz-rb"><button type="button" data-a="cx">← Lista</button><button type="button" data-a="pv" aria-label="Anterior" ${n <= 0 ? 'disabled' : ''}>‹</button><button type="button" data-a="nx" aria-label="Siguiente" ${n >= LIST.length - 1 ? 'disabled' : ''}>›</button><span class="gz-sp"></span><small>${n + 1}/${LIST.length}</small></div>`;
      h += `<div class="gz-meta" style="margin:0"><span class="gz-bd ${cls(i.estado)}">${esc(i.estado)}</span>${i.fecha ? `<span>${esc(fecha(i.fecha))}${i.hora ? ' · ' + esc(i.hora) : ''}${i.ranuraPlan ? ' (según plan)' : ''}</span>` : ''}<span>${esc(i.plantilla)}${i.formato ? ' · ' + esc(i.formato) : ''}</span></div>`;
      h += `<h2>${esc(i.titulo)}</h2>`;
      if (i.url) h += `<p style="font-size:16px"><a href="${esc(i.url)}" target="_blank" rel="noopener">▶ Ver en YouTube</a></p>`;
      h += `<div class="gz-ap"><b>Aprobación:</b> pendiente de activar</div>`;
      if (i.bloques.length) h += i.bloques.map((b) => `<h3>${esc(b.h)}</h3>${b.t.map(par).join('')}`).join('');
      if (i.ficha.length) h += `<h3>${i.bloques.length ? 'Datos' : 'Ficha'}</h3>` + i.ficha.map(([k, v]) => `<div class="gz-fk"><span>${esc(k)}</span><div>${esc(v)}</div></div>`).join('');
      if (i.fuentes && i.fuentes.length) h += `<h3>Fuentes</h3>` + i.fuentes.map((s) => { const m = s.match(/https?:\/\/\S+/); return `<p class="gz-src">${m ? esc(s.slice(0, m.index)) + `<a href="${esc(m[0])}" target="_blank" rel="noopener">${esc(m[0])}</a>` : esc(s)}</p>`; }).join('');
      if (i.sinGuion) h += `<p class="gz-m">El guion completo de este video no está en el repo; solo se muestra la ficha de la bandeja.</p>`;
      host.innerHTML = h + '</div>';
      arriba(o);
      if (o.onLeer) o.onLeer(i.id);
    }
    host.onclick = (e) => {
      const it = e.target.closest('.gz-it'); if (it) { leer(+it.dataset.n); return; }
      const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
      if (b.dataset.a === 'cx') lista(); else if (b.dataset.a === 'pv' && POS > 0) leer(POS - 1); else if (b.dataset.a === 'nx' && POS < LIST.length - 1) leer(POS + 1);
    };
    host._gzKey = (e) => {
      if (!host.isConnected) { document.removeEventListener('keydown', host._gzKey); return; }
      if (POS < 0 || e.defaultPrevented || e.target.closest?.('input,textarea')) return;
      if (e.key === 'ArrowLeft' && POS > 0) leer(POS - 1);
      else if (e.key === 'ArrowRight' && POS < LIST.length - 1) leer(POS + 1);
      else if (e.key === 'Escape' && o.esc) { e.preventDefault(); lista(); }
    };
    document.addEventListener('keydown', host._gzKey);
    const k = o.id ? LIST.findIndex((i) => i.id === o.id) : -1;
    if (k >= 0) leer(k); else lista();
  }
  return { montar, j };
})();
