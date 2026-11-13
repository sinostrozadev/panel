// Comentarios recientes y últimos 3 videos publicados de cada canal (para los diálogos del panel).
//   data/comentarios/<slug>.json → hasta 30 comentarios, más recientes primero (commentThreads.list, 1 unidad)
//   data/videos/<slug>.json      → últimos 3 videos públicos ya publicados con vistas/me gusta/comentarios y,
//                                  si hay token con scope analytics, suscriptores ganados por video.
// Solo datos públicos de YouTube: se guardan autor visible, texto, fecha y me gusta; nunca correos, ids de
// canal de los autores ni ids de comentario. Si una llamada falla, se conserva el archivo anterior.
// Sin token (nube / API key) los suscriptores ganados se conservan del último valor conocido.
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://www.googleapis.com/youtube/v3';
const leerJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const escribir = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1)); fs.renameSync(t, f); };
const nulo = (v) => { const n = Number(v); return v != null && Number.isFinite(n) ? n : null; };

async function pedir(url, token, key) {
  const u = url + (key ? '&key=' + encodeURIComponent(key) : '');
  const r = await fetch(u, { headers: token ? { Authorization: 'Bearer ' + token } : {}, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(url.split('?')[0].split('/').pop() + ' HTTP ' + r.status);
  return r.json();
}

async function titulos(ids, token, key) {
  const m = new Map();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 50) {
    const j = await pedir(`${API}/videos?part=snippet&id=${unicos.slice(i, i + 50).join(',')}`, token, key);
    for (const v of j.items ?? []) m.set(v.id, v.snippet?.title ?? '');
  }
  return m;
}

export async function comentariosDe(canal, token, key) {
  const j = await pedir(`${API}/commentThreads?part=snippet,replies&allThreadsRelatedToChannelId=${canal.canalId}&order=time&maxResults=30&textFormat=plainText`, token, key);
  const th = j.items ?? [];
  const tit = await titulos(th.map((t) => t.snippet?.videoId).filter(Boolean), token, key);
  const items = th.map((t) => {
    const s = t.snippet?.topLevelComment?.snippet ?? {};
    const vid = t.snippet?.videoId ?? s.videoId ?? null;
    const resp = (t.replies?.comments ?? []).map((r) => r.snippet).find((r) => r?.authorChannelId?.value === canal.canalId);
    return {
      autor: s.authorDisplayName ?? 'Anónimo',
      texto: String(s.textDisplay ?? s.textOriginal ?? '').slice(0, 1200),
      fecha: s.publishedAt ?? null,
      videoId: vid, videoTitulo: tit.get(vid) ?? '',
      likes: nulo(s.likeCount) ?? 0,
      respuestas: nulo(t.snippet?.totalReplyCount) ?? 0,
      delCanal: s.authorChannelId?.value === canal.canalId,
      respuestaCanal: resp ? { texto: String(resp.textDisplay ?? '').slice(0, 600), fecha: resp.publishedAt ?? null } : null,
    };
  }).filter((c) => c.fecha);
  return items.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 30);
}

export async function videosDe(canal, token, key, ahora, previo, propio = false) {
  const j = await pedir(`${API}/playlistItems?part=contentDetails&maxResults=50&playlistId=${'UU' + canal.canalId.slice(2)}`, token, key);
  const ids = (j.items ?? []).map((i) => i.contentDetails?.videoId).filter(Boolean);
  const vs = [];
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50).join(',');
    let r; try { r = await pedir(`${API}/videos?part=statistics,snippet,status&id=${lote}`, token, key); } catch { r = await pedir(`${API}/videos?part=statistics,snippet&id=${lote}`, token, key); }
    vs.push(...(r.items ?? []));
  }
  // solo públicos ya publicados (los programados son privados con publishAt; con API key ni aparecen)
  const pub = vs.filter((v) => (!v.status || (v.status.privacyStatus === 'public' && !v.status.publishAt)) && Date.parse(v.snippet?.publishedAt) <= ahora)
    .sort((a, b) => b.snippet.publishedAt.localeCompare(a.snippet.publishedAt)).slice(0, 3);
  const items = pub.map((v) => ({
    id: v.id, titulo: v.snippet.title, publicadoEn: v.snippet.publishedAt,
    vistas: nulo(v.statistics?.viewCount), likes: nulo(v.statistics?.likeCount), comentarios: nulo(v.statistics?.commentCount),
    subsGanados: previo?.items?.find((x) => x.id === v.id)?.subsGanados ?? null,
  }));
  let subsMedido = false;
  if (propio && token && items.length) {
    try {
      const d = (ms) => new Date(ms).toISOString().slice(0, 10);
      const ini = items.map((x) => x.publicadoEn.slice(0, 10)).sort()[0];
      const u = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${ini}&endDate=${d(ahora)}&metrics=subscribersGained&dimensions=video&filters=video==${items.map((x) => x.id).join(',')}&maxResults=10&sort=-subscribersGained`;
      const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error('analytics HTTP ' + r.status);
      const filas = new Map(((await r.json()).rows ?? []).map((x) => [x[0], Number(x[1])]));
      for (const it of items) it.subsGanados = filas.has(it.id) ? filas.get(it.id) : 0; // video sin fila = 0 ganados
      subsMedido = true;
    } catch (e) { /* se conserva el último valor */ }
  }
  return { items, subsMedido: subsMedido || items.some((x) => x.subsGanados != null) };
}

// tokens: Map canalId → access_token (solo canales con token propio). key: API key (nube).
export async function medirComunidad({ lista, dir, tokens = new Map(), key = null, ahora = Date.now() }) {
  const informe = {};
  const medidoEn = new Date(ahora).toISOString();
  for (const c of lista) {
    if (!c.canalId || !c.slug) continue;
    const propio = tokens.get(c.canalId) ?? null;          // token del propio canal: permite Analytics
    const t = propio ?? (key ? null : [...tokens.values()][0] ?? null); // sin token propio: datos públicos con otro token o con la API key
    informe[c.slug] = {};
    try {
      const items = await comentariosDe(c, t, key);
      escribir(path.join(dir, 'comentarios', c.slug + '.json'), { slug: c.slug, medidoEn, items });
      informe[c.slug].comentarios = items.length;
    } catch (e) { informe[c.slug].errorComentarios = e.message; }
    try {
      const f = path.join(dir, 'videos', c.slug + '.json');
      const v = await videosDe(c, t, key, ahora, leerJSON(f), !!propio);
      escribir(f, { slug: c.slug, medidoEn, subsMedido: v.subsMedido, items: v.items });
      informe[c.slug].videos = v.items.length;
    } catch (e) { informe[c.slug].errorVideos = e.message; }
  }
  return informe;
}

// Copia data/comentarios y data/videos a la carpeta de salida (publicación) y devuelve un resumen para el hash.
export function copiarComunidad(dir, salida) {
  const firma = [];
  for (const k of ['comentarios', 'videos']) {
    const o = path.join(dir, k);
    if (!fs.existsSync(o)) continue;
    for (const f of fs.readdirSync(o).filter((x) => x.endsWith('.json')).sort()) {
      const j = leerJSON(path.join(o, f)); if (!j) continue;
      firma.push(k === 'videos' ? [f, j.items.map((x) => [x.id, x.vistas, x.likes, x.comentarios, x.subsGanados])] : [f, j.items.map((x) => [x.fecha, x.likes, x.respuestas, !!x.respuestaCanal])]);
      if (path.resolve(salida) !== path.resolve(dir)) { fs.mkdirSync(path.join(salida, k), { recursive: true }); fs.copyFileSync(path.join(o, f), path.join(salida, k, f)); }
    }
  }
  return JSON.stringify(firma);
}
