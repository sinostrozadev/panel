// Navegación lateral y enrutador por hash (#/, #/guiones, #/guiones/<canal>?s=<semana>&f=<filtro>&r=<ranura>, #/estrategia/<canal>).
// Para sumar una sección: agrega un objeto a SECCIONES y una <section id="v-<id>" hidden> en index.html; el módulo de la vista
// se registra con  Vistas.<id> = { montar(el, ruta), refrescar(), salir() }  (el Dashboard es el script de index.html).
'use strict';
window.Vistas = window.Vistas || {};
const SECCIONES = [
  { id: 'dashboard', nombre: 'Dashboard', ayuda: 'Carrera hacia la monetización', icono: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>' },
  { id: 'guiones', nombre: 'Guiones', ayuda: 'Cada ranura y su etapa', icono: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>' },
  { id: 'estrategia', nombre: 'Estrategia', ayuda: 'Cómo se arma lo audiovisual', icono: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>' },
];
const Nav = (() => {
  const lat = document.getElementById('lat'), hamb = document.getElementById('hamb'), velo = document.getElementById('velo');
  const angosto = matchMedia('(max-width: 1023px)');
  let actual = null;

  function ruta() {
    const h = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
    const [camino, q = ''] = h.split('?');
    const partes = camino.split('/').filter(Boolean);
    const id = SECCIONES.some((s) => s.id === partes[0]) ? partes[0] : 'dashboard';
    return { id, partes: id === partes[0] ? partes.slice(1) : [], q: Object.fromEntries(new URLSearchParams(q)) };
  }
  // reemplaza el hash sin crear entrada en el historial (filtros, ficha abierta)
  function fijar(id, partes = [], q = {}) {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '')).toString();
    const h = '#/' + [id === 'dashboard' ? '' : id, ...partes].filter(Boolean).map(encodeURIComponent).join('/') + (qs ? '?' + qs : '');
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function pintarMenu(id) {
    document.getElementById('secs').innerHTML = SECCIONES.map((s) => `<li><a href="#/${s.id === 'dashboard' ? '' : s.id}" data-sec="${s.id}"${s.id === id ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s.icono}</svg><span>${s.nombre}<small>${s.ayuda}</small></span></a></li>`).join('');
  }
  function abrirMenu(si) {
    if (!angosto.matches) si = false;
    document.body.classList.toggle('lat-on', si);
    hamb.setAttribute('aria-expanded', si);
    lat.inert = angosto.matches && !si;
    velo.hidden = !si;
    if (si) lat.querySelector('a[aria-current]')?.focus();
  }
  function ir() {
    const r = ruta();
    if (actual && actual !== r.id) Vistas[actual]?.salir?.();
    for (const s of SECCIONES) { const el = document.getElementById('v-' + s.id); if (el) el.hidden = s.id !== r.id; }
    document.body.dataset.vista = r.id;
    const s = SECCIONES.find((x) => x.id === r.id);
    document.getElementById('vtit').textContent = s.nombre;
    document.title = (r.id === 'dashboard' ? '' : s.nombre + ' · ') + 'Canales';
    pintarMenu(r.id);
    const cambio = actual !== r.id;
    actual = r.id;
    if (r.id !== 'dashboard') Vistas[r.id]?.montar?.(document.getElementById('v-' + r.id), r);
    if (cambio) { window.scrollTo(0, 0); abrirMenu(false); }
  }
  hamb.addEventListener('click', () => abrirMenu(!document.body.classList.contains('lat-on')));
  velo.addEventListener('click', () => abrirMenu(false));
  lat.addEventListener('click', (e) => { if (e.target.closest('a')) abrirMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('lat-on')) { abrirMenu(false); hamb.focus(); } });
  angosto.addEventListener('change', () => abrirMenu(false));
  addEventListener('hashchange', ir);
  // ⟳ de la barra: refresca la vista visible
  const bt = document.getElementById('bt'), cargarDash = bt.onclick;
  bt.onclick = () => (actual === 'dashboard' || !Vistas[actual]?.refrescar ? cargarDash && cargarDash() : Vistas[actual].refrescar());
  // compatibilidad: guiones.html#<canal>/<id> redirige a #/guiones/<canal>
  abrirMenu(false);
  ir();
  return { ruta, fijar, actual: () => actual };
})();
