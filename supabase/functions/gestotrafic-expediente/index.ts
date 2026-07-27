/* ============================================================
   GestoTrafic · gestotrafic-expediente
   ------------------------------------------------------------
   Reúne toda la documentación de un expediente en UN documento,
   en dos formatos:

     · HTML  — autocontenido, para el acceso de expedientes del
               Colegio. Las imágenes van embebidas en base64 y los
               PDF incrustados: un solo archivo que se abre solo,
               sin depender de nada externo.
     · PDF   — mismo contenido y orden. Cada imagen es una página
               y los PDF aportados se anexan PÁGINA A PÁGINA con
               pdf-lib, no como una miniatura.

   Por qué vive aquí y no en el cliente:
     · los documentos están en un bucket PRIVADO y se bajan con el
       service_role, sin repartir URLs firmadas de cada archivo
     · se vuelve a comprobar en el servidor que quien llama es un
       usuario activo y que el expediente es suyo (o es admin),
       igual que hace el RLS
     · el resultado se sube al mismo bucket privado y lo único que
       sale de aquí son dos URLs firmadas que caducan

   REGLA DE LA CASA · lo que falta, falta. Un documento que no se
   ha aportado NO genera una página en blanco ni un hueco disimulado:
   aparece en el índice como "pendiente". El expediente que ve el
   Colegio dice la verdad sobre lo que lleva dentro.
   ============================================================ */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BUCKET = 'gestotrafic-docs';
const CADUCIDAD = 3600;                  // 1 h, como el resto de enlaces firmados

/* El documento se devuelve en el cuerpo, así que el resumen de lo que lleva
   dentro va en una cabecera propia. Sin `Expose-Headers` el navegador la
   esconde: en una respuesta de otro origen solo se leen las de la lista. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Disposition, X-Expediente-Resumen'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });

/* ---------------- Tipos ---------------- */

type Seccion = { tipo: string; label: string; obligatorio?: boolean };
type Archivo = {
  nombre: string;
  mime: string;
  bytes: Uint8Array;
  cara: string;
};
type Bloque = {
  tipo: string;
  label: string;
  obligatorio: boolean;
  archivos: Archivo[];
};

/* ---------------- Utilidades ---------------- */

const esc = (v: unknown) =>
  (v === null || v === undefined) ? '' : String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Un guion cuando no hay dato. Nunca un valor de relleno. */
const oGuion = (v: unknown) =>
  (v === null || v === undefined || v === '') ? '—' : String(v);

function base64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;                     // por trozos: evita desbordar el stack
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

const IMAGENES = ['image/jpeg', 'image/jpg', 'image/png'];
const esImagen = (m: string) => IMAGENES.indexOf((m || '').toLowerCase()) !== -1;
const esPdf = (m: string) => (m || '').toLowerCase() === 'application/pdf';

/** La cara viaja en el nombre del objeto: `<exp>/<tipo>.<cara>-<ts>.<ext>`. */
function caraDe(path: string): string {
  const m = /\/[^/]+?\.([a-z0-9_]+)-\d+\.[^.]+$/.exec(path || '');
  return m ? m[1] : 'completo';
}

const ETIQUETA_CARA: Record<string, string> = {
  anverso: 'Anverso',
  reverso: 'Reverso',
  pagina_1: 'Página 1',
  pagina_2: 'Página 2',
  completo: 'Documento completo'
};

function fechaLarga(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const valida = isNaN(+d) ? new Date() : d;
  return valida.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* Las fuentes estándar de pdf-lib son WinAnsi y revientan con lo que no
   entra ahí. Los acentos y la Ñ sí están; las comillas tipográficas y algún
   guion largo, no siempre. Se sustituyen antes de dibujar, que es mejor que
   quedarse sin portada por una comilla. */
function winansi(s: string): string {
  return (s || '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, '?');
}

/* ---------------- Portada · datos ---------------- */

type Cabecera = {
  gestoria: { nombre?: string; ciudad?: string; provincia?: string; num_colegiado?: string };
  colegio: { provincia?: string; nombre?: string | null };
};

function filasCabecera(exp: Record<string, any>, cab: Cabecera, tramite: string) {
  const cliente = exp.cliente || {};
  const nombreCliente = cliente.razon_social
    || [cliente.nombre, cliente.apellidos].filter(Boolean).join(' ')
    || null;

  return [
    ['Expediente', exp.referencia],
    ['Trámite', tramite],
    ['Estado', exp.estado],
    ['Matrícula', exp.matricula],
    ['Vehículo', [exp.marca, exp.modelo].filter(Boolean).join(' ') || null],
    ['Comprador', exp.comprador_nombre],
    ['NIF del comprador', exp.comprador_nif],
    ['Vendedor', exp.vendedor_nombre],
    ['NIF del vendedor', exp.vendedor_nif],
    ['Cliente del expediente', nombreCliente],
    ['Fecha de apertura', exp.created_at ? fechaLarga(exp.created_at) : null],
    ['Fecha de este documento', fechaLarga(null)]
  ] as [string, unknown][];
}

/* ---------------- HTML autocontenido ---------------- */

function construirHTML(
  exp: Record<string, any>,
  cab: Cabecera,
  tramite: string,
  bloques: Bloque[]
): string {
  const incluidos = bloques.filter(b => b.archivos.length);
  const faltan = bloques.filter(b => !b.archivos.length);

  const indice = bloques.map((b, i) => {
    const hay = b.archivos.length;
    const detalle = hay
      ? b.archivos.map(a => ETIQUETA_CARA[a.cara] || a.cara).join(' · ')
      : (b.obligatorio ? 'PENDIENTE · obligatorio' : 'pendiente · opcional');
    return `<tr class="${hay ? '' : 'falta'}">
      <td class="n">${i + 1}</td>
      <td>${hay ? `<a href="#doc-${esc(b.tipo)}">${esc(b.label)}</a>` : esc(b.label)}</td>
      <td class="d">${esc(detalle)}</td>
      <td class="e">${hay ? `${hay} archivo${hay === 1 ? '' : 's'}` : '—'}</td>
    </tr>`;
  }).join('');

  const seccionArchivo = (a: Archivo) => {
    const cara = ETIQUETA_CARA[a.cara] || a.cara;
    const datos = `data:${a.mime};base64,${base64(a.bytes)}`;

    if (esImagen(a.mime)) {
      return `<figure>
        <img src="${datos}" alt="${esc(a.nombre)}">
        <figcaption>${esc(cara)} · ${esc(a.nombre)}</figcaption>
      </figure>`;
    }
    if (esPdf(a.mime)) {
      /* El PDF va incrustado con sus datos dentro del propio archivo: se ve
         sin salir de aquí y conserva el texto original en lugar de una foto
         de él. El enlace de debajo lo abre suelto si el visor falla. */
      return `<figure>
        <object class="pdf" type="application/pdf" data="${datos}">
          <p>Tu visor no muestra PDF incrustados.
             <a href="${datos}" download="${esc(a.nombre)}">Abrir ${esc(a.nombre)}</a></p>
        </object>
        <figcaption>${esc(cara)} · ${esc(a.nombre)} · PDF incrustado
          (<a href="${datos}" download="${esc(a.nombre)}">descargar</a>)</figcaption>
      </figure>`;
    }
    return `<figure>
      <div class="nover">Formato <b>${esc(a.mime || 'desconocido')}</b>: no se puede mostrar aquí.
        <a href="${datos}" download="${esc(a.nombre)}">Descargar ${esc(a.nombre)}</a></div>
      <figcaption>${esc(cara)} · ${esc(a.nombre)}</figcaption>
    </figure>`;
  };

  const cuerpo = incluidos.map((b, i) => `
    <section id="doc-${esc(b.tipo)}">
      <h2><span class="num">${i + 1}</span> ${esc(b.label)}</h2>
      ${b.archivos.map(seccionArchivo).join('')}
    </section>`).join('');

  const colegio = cab.colegio.nombre
    ? esc(cab.colegio.nombre)
    : `<span class="pend">Colegio de ${esc(cab.colegio.provincia || 'la provincia')} · pendiente de configurar</span>`;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Expediente ${esc(exp.referencia)} · documentación completa</title>
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:11pt;line-height:1.55;color:#14161c;background:#fff;margin:0 auto;padding:30px;max-width:900px}
header{border-bottom:3px solid #14161c;padding-bottom:16px;margin-bottom:22px}
.org{font-size:12.5pt;font-weight:700}
.col{font-size:10pt;color:#444;margin-top:2px}
.pend{color:#a4442c;font-weight:600}
h1{font-size:17pt;margin:18px 0 3px}
.ref{font-family:ui-monospace,"SF Mono",Consolas,monospace;font-size:10.5pt;color:#555}
h2{font-size:12.5pt;margin:0 0 12px;padding-bottom:7px;border-bottom:2px solid #14161c;
  display:flex;align-items:center;gap:10px}
h2 .num{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;
  background:#14161c;color:#fff;font-size:11pt;flex-shrink:0}
h3{font-size:11pt;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.5px;color:#444}
table{width:100%;border-collapse:collapse;margin:0 0 8px}
td,th{border:1px solid #c8ccd4;padding:6px 9px;font-size:10pt;text-align:left;vertical-align:top}
th{background:#eef0f4;font-weight:700}
td.k{background:#f5f6f9;width:34%;font-weight:600}
td.n{width:34px;text-align:center;color:#666}
td.d{color:#444;font-size:9.4pt}
td.e{width:88px;color:#444;font-size:9.4pt;white-space:nowrap}
tr.falta td{background:#fdf3f0;color:#8d3a24}
tr.falta td.d{color:#a4442c;font-weight:600}
section{page-break-before:always;margin-top:34px}
figure{margin:0 0 20px;page-break-inside:avoid}
figure img{max-width:100%;height:auto;border:1px solid #c8ccd4;display:block}
figure .pdf{width:100%;height:1000px;border:1px solid #c8ccd4;display:block}
figcaption{font-size:9pt;color:#555;margin-top:5px;padding-bottom:3px;border-bottom:1px solid #e4e6ec}
.nover{border:1px dashed #c8ccd4;padding:18px;font-size:10pt;color:#555;background:#fafbfc}
.aviso{border:1px solid #e0c9a2;background:#fcf7ec;padding:11px 14px;font-size:9.6pt;color:#6b5626;margin:16px 0}
footer{margin-top:34px;padding-top:12px;border-top:1px solid #d4d8e0;font-size:8.6pt;color:#666;text-align:center}
@media print{body{padding:0;max-width:none}figure .pdf{height:auto;min-height:620px}}
</style></head>
<body>

<header>
  <div class="org">${esc(cab.gestoria.nombre || 'Gestoría')}</div>
  <div class="col">${colegio}${cab.gestoria.num_colegiado
    ? ' · Colegiado nº ' + esc(cab.gestoria.num_colegiado) : ''}</div>
  <h1>Expediente completo · ${esc(tramite)}</h1>
  <div class="ref">${esc(exp.referencia)}</div>
</header>

<h3>Datos del expediente</h3>
<table>
${filasCabecera(exp, cab, tramite).map(([k, v]) =>
  `<tr><td class="k">${esc(k)}</td><td>${esc(oGuion(v))}</td></tr>`).join('')}
</table>

<h3>Índice de documentación</h3>
<table>
<tr><th class="n">#</th><th>Documento</th><th>Contenido</th><th>Archivos</th></tr>
${indice}
</table>

${faltan.length ? `<div class="aviso">
  <b>Este expediente se presenta sin ${faltan.length} documento${faltan.length === 1 ? '' : 's'}</b>:
  ${esc(faltan.map(b => b.label).join(', '))}.
  No se ha generado ninguna página por ellos — lo que no se ha aportado consta como pendiente.
</div>` : ''}

${cuerpo}

<footer>
  Expediente ${esc(exp.referencia)} · ${esc(cab.gestoria.nombre || 'Gestoría')} ·
  generado el ${esc(fechaLarga(null))}<br>
  Documento de DEMOSTRACIÓN · GestoTrafic no conecta con la DGT ni con Hacienda
</footer>

</body></html>`;
}

/* ---------------- PDF ---------------- */

async function construirPDF(
  exp: Record<string, any>,
  cab: Cabecera,
  tramite: string,
  bloques: Bloque[]
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Expediente ${exp.referencia} · documentación completa`);
  pdf.setCreator('GestoTrafic');

  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);

  const A4: [number, number] = [595.28, 841.89];
  const M = 48;                                   // margen
  const tinta = rgb(0.08, 0.09, 0.11);
  const gris = rgb(0.37, 0.39, 0.44);
  const rojo = rgb(0.55, 0.22, 0.13);

  /* --- Portada e índice --- */
  let pag = pdf.addPage(A4);
  let y = A4[1] - M;

  const escribir = (txt: string, opt: { size?: number; font?: any; color?: any; x?: number } = {}) => {
    const size = opt.size || 10;
    const font = opt.font || normal;
    if (y < M + size) { pag = pdf.addPage(A4); y = A4[1] - M; }
    pag.drawText(winansi(txt), { x: opt.x ?? M, y, size, font, color: opt.color || tinta });
    y -= size + 5;
  };
  const salto = (n = 1) => { y -= 8 * n; };
  const linea = () => {
    if (y < M + 12) { pag = pdf.addPage(A4); y = A4[1] - M; }
    pag.drawRectangle({ x: M, y: y + 4, width: A4[0] - M * 2, height: 1.2, color: tinta });
    y -= 14;
  };

  escribir(cab.gestoria.nombre || 'Gestoría', { size: 13, font: negrita });
  escribir(cab.colegio.nombre || `Colegio de ${cab.colegio.provincia || 'la provincia'} · pendiente de configurar`,
    { size: 9.5, color: cab.colegio.nombre ? gris : rojo });
  if (cab.gestoria.num_colegiado) escribir('Colegiado n.o ' + cab.gestoria.num_colegiado, { size: 9.5, color: gris });
  linea();
  salto();
  escribir('Expediente completo · ' + tramite, { size: 16, font: negrita });
  escribir(String(exp.referencia || ''), { size: 11, color: gris });
  salto(2);

  escribir('DATOS DEL EXPEDIENTE', { size: 10, font: negrita, color: gris });
  salto();
  for (const [k, v] of filasCabecera(exp, cab, tramite)) {
    if (y < M + 30) { pag = pdf.addPage(A4); y = A4[1] - M; }
    pag.drawText(winansi(k), { x: M, y, size: 9.5, font: negrita, color: gris });
    pag.drawText(winansi(oGuion(v)), { x: M + 175, y, size: 9.5, font: normal, color: tinta });
    y -= 15;
  }
  salto(2);

  escribir('INDICE DE DOCUMENTACION', { size: 10, font: negrita, color: gris });
  salto();
  bloques.forEach((b, i) => {
    if (y < M + 30) { pag = pdf.addPage(A4); y = A4[1] - M; }
    const hay = b.archivos.length;
    const detalle = hay
      ? b.archivos.map(a => ETIQUETA_CARA[a.cara] || a.cara).join(' · ')
      : (b.obligatorio ? 'PENDIENTE · obligatorio' : 'pendiente · opcional');
    pag.drawText(winansi(`${i + 1}.`), { x: M, y, size: 9.5, font: normal, color: gris });
    pag.drawText(winansi(b.label), { x: M + 20, y, size: 9.5, font: hay ? negrita : normal, color: hay ? tinta : rojo });
    pag.drawText(winansi(detalle), { x: M + 300, y, size: 9, font: normal, color: hay ? gris : rojo });
    y -= 15;
  });

  const faltan = bloques.filter(b => !b.archivos.length);
  if (faltan.length) {
    salto(2);
    escribir('Este expediente se presenta sin ' + faltan.length + ' documento'
      + (faltan.length === 1 ? '' : 's') + '.', { size: 9.5, font: negrita, color: rojo });
    escribir('No se ha generado ninguna pagina por ellos: lo que no se ha aportado consta', { size: 9, color: rojo });
    escribir('como pendiente.', { size: 9, color: rojo });
  }

  /* --- Un separador y el contenido de cada documento --- */
  let n = 0;
  for (const b of bloques) {
    if (!b.archivos.length) continue;              // lo que falta no ocupa página
    n++;

    const sep = pdf.addPage(A4);
    sep.drawText(winansi(String(n)), { x: M, y: A4[1] / 2 + 30, size: 44, font: negrita, color: rgb(0.85, 0.86, 0.89) });
    sep.drawText(winansi(b.label), { x: M, y: A4[1] / 2 - 10, size: 17, font: negrita, color: tinta });
    sep.drawText(winansi(`Expediente ${exp.referencia || ''}`), { x: M, y: A4[1] / 2 - 34, size: 10, font: normal, color: gris });

    for (const a of b.archivos) {
      const pie = `${ETIQUETA_CARA[a.cara] || a.cara} · ${a.nombre}`;

      if (esImagen(a.mime)) {
        try {
          const img = (a.mime.toLowerCase() === 'image/png')
            ? await pdf.embedPng(a.bytes)
            : await pdf.embedJpg(a.bytes);

          // Se encaja dentro del margen conservando la proporción.
          const maxW = A4[0] - M * 2;
          const maxH = A4[1] - M * 2 - 22;
          const escala = Math.min(maxW / img.width, maxH / img.height, 1);
          const w = img.width * escala, hh = img.height * escala;

          const p = pdf.addPage(A4);
          p.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - hh) / 2 + 10, width: w, height: hh });
          p.drawText(winansi(pie), { x: M, y: M - 14, size: 8.5, font: normal, color: gris });
        } catch {
          const p = pdf.addPage(A4);
          p.drawText(winansi('No se pudo incrustar la imagen: ' + a.nombre),
            { x: M, y: A4[1] / 2, size: 11, font: negrita, color: rojo });
        }
        continue;
      }

      if (esPdf(a.mime)) {
        /* Página a página, no como miniatura: lo que aportó el cliente entra
           en el expediente tal cual, con su texto y su resolución. */
        try {
          const src = await PDFDocument.load(a.bytes, { ignoreEncryption: true });
          const copiadas = await pdf.copyPages(src, src.getPageIndices());
          copiadas.forEach((p) => {
            pdf.addPage(p);
            p.drawText(winansi(pie), { x: 20, y: 14, size: 7.5, font: normal, color: gris });
          });
        } catch {
          const p = pdf.addPage(A4);
          p.drawText(winansi('No se pudo anexar el PDF: ' + a.nombre),
            { x: M, y: A4[1] / 2, size: 11, font: negrita, color: rojo });
          p.drawText(winansi('Esta en el expediente y se puede descargar suelto.'),
            { x: M, y: A4[1] / 2 - 18, size: 9.5, font: normal, color: gris });
        }
        continue;
      }

      const p = pdf.addPage(A4);
      p.drawText(winansi('Formato no incrustable: ' + (a.mime || 'desconocido')),
        { x: M, y: A4[1] / 2, size: 11, font: negrita, color: tinta });
      p.drawText(winansi(a.nombre), { x: M, y: A4[1] / 2 - 18, size: 9.5, font: normal, color: gris });
    }
  }

  return await pdf.save();
}

/* ---------------- Función ---------------- */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const sb = createClient(URL_SB, SERVICE_KEY, { auth: { persistSession: false } });

    // 1 · Quién llama. verify_jwt solo garantiza que el token es del proyecto;
    //     la clave anon también lo es, así que hay que identificar al usuario.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth, error: errAuth } = await sb.auth.getUser(token);
    if (errAuth || !auth.user) return json({ error: 'Sesión no válida' }, 401);

    const { data: perfil } = await sb
      .from('gestotrafic_usuarios')
      .select('id, rol, activo')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (!perfil || !perfil.activo) return json({ error: 'Usuario no autorizado' }, 403);

    const cuerpo = await req.json();
    const expedienteId = cuerpo.expediente_id;
    const secciones: Seccion[] = Array.isArray(cuerpo.secciones) ? cuerpo.secciones : [];
    const cab: Cabecera = {
      gestoria: cuerpo.gestoria || {},
      colegio: cuerpo.colegio || {}
    };
    const tramite = String(cuerpo.tramite || 'Expediente');
    const guardar = cuerpo.guardar === true;
    const formato = cuerpo.formato === 'pdf' ? 'pdf' : 'html';

    if (!expedienteId || !secciones.length) {
      return json({ error: 'Faltan el expediente o las secciones del trámite' }, 400);
    }
    if (cuerpo.formato !== 'pdf' && cuerpo.formato !== 'html') {
      return json({ error: 'El formato pedido tiene que ser "html" o "pdf"' }, 400);
    }

    // 2 · El expediente tiene que ser suyo (o ser admin). Mismo criterio que el RLS.
    const { data: exp } = await sb
      .from('gestotrafic_expedientes')
      .select('*, cliente:gestotrafic_clientes(nombre, apellidos, razon_social, nif, tipo)')
      .eq('id', expedienteId)
      .maybeSingle();
    if (!exp) return json({ error: 'El expediente no existe' }, 404);
    if (perfil.rol !== 'admin' && exp.gestor_id !== perfil.id) {
      return json({ error: 'Ese expediente no está asignado a tu usuario' }, 403);
    }

    // 3 · Sus documentos. Se leen del bucket privado con el service_role: en
    //     ningún momento se firma un enlace por archivo suelto.
    const { data: docs } = await sb
      .from('gestotrafic_documentos')
      .select('tipo, nombre_archivo, storage_path, mime, created_at')
      .eq('expediente_id', expedienteId)
      .order('created_at', { ascending: true });

    const porTipo = new Map<string, typeof docs>();
    for (const d of (docs || [])) {
      const lista = porTipo.get(d.tipo) || [];
      lista.push(d);
      porTipo.set(d.tipo, lista as never);
    }

    /* El ORDEN lo manda el catálogo del trámite, que llega en `secciones`. No
       se reordena aquí: el catálogo es la única fuente de ese orden y así
       añadir un documento nuevo sigue siendo tocar un solo fichero. */
    const bloques: Bloque[] = [];
    for (const s of secciones) {
      const filas = porTipo.get(s.tipo) || [];
      const archivos: Archivo[] = [];

      for (const f of filas) {
        if (!f.storage_path) continue;
        const r = await sb.storage.from(BUCKET).download(f.storage_path);
        if (r.error || !r.data) continue;          // un archivo ilegible no inventa página
        archivos.push({
          nombre: f.nombre_archivo || 'documento',
          mime: (f.mime || r.data.type || '').toLowerCase(),
          bytes: new Uint8Array(await r.data.arrayBuffer()),
          cara: caraDe(f.storage_path)
        });
      }

      // Anverso antes que reverso, y el resto por orden de subida.
      const peso = (c: string) => (c === 'anverso' || c === 'pagina_1') ? 0 : (c === 'completo' ? 2 : 1);
      archivos.sort((a, b) => peso(a.cara) - peso(b.cara));

      bloques.push({
        tipo: s.tipo,
        label: s.label || s.tipo,
        obligatorio: s.obligatorio === true,
        archivos
      });
    }

    // 4 · Se construye SOLO el formato que se ha pedido.
    const cuerpoDoc: Uint8Array = formato === 'pdf'
      ? await construirPDF(exp, cab, tramite, bloques)
      : new TextEncoder().encode(construirHTML(exp, cab, tramite, bloques));

    const mime = formato === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8';
    const nombre = `expediente-completo-${exp.referencia || expedienteId}.${formato}`;

    /* 5 · El bucket solo se toca si se guarda copia.
       Antes se escribía siempre, porque el documento se entregaba por enlace
       firmado y el enlace necesita que el objeto exista. El precio era que
       cada generación descartada dejaba un fichero sin fila que lo reclamara
       —y, borrado el expediente, sin política que permitiera ya borrarlo—.
       Ahora el documento se devuelve en el cuerpo de esta misma respuesta:
       sin guardar copia no se escribe nada, así que no hay huérfanos que
       limpiar. No es que se limpien: es que no llegan a existir. */
    let guardado: { ruta: string; url: string | null } | null = null;

    if (guardar) {
      const sello = new Date().toISOString().replace(/[:.]/g, '-');
      const ruta = `${expedienteId}/expediente-completo-${sello}.${formato}`;

      const subida = await sb.storage.from(BUCKET).upload(ruta, cuerpoDoc, {
        contentType: mime, upsert: false
      });
      if (subida.error) {
        return json({ error: 'No se pudo guardar la copia: ' + subida.error.message }, 500);
      }

      /* La fila va DESPUÉS del objeto y, si falla, se retira el objeto: un
         fichero sin fila es exactamente lo que veníamos a evitar. */
      const ins = await sb.from('gestotrafic_documentos').insert({
        expediente_id: expedienteId,
        tipo: 'expediente_completo',
        estado: 'recibido',
        nombre_archivo: nombre,
        storage_path: ruta,
        mime: formato === 'pdf' ? 'application/pdf' : 'text/html',
        tamano: cuerpoDoc.length
      });
      if (ins.error) {
        await sb.storage.from(BUCKET).remove([ruta]);
        return json({ error: 'No se pudo registrar la copia: ' + ins.error.message }, 500);
      }

      // El bucket sigue siendo privado: la copia se recupera firmada.
      const firmada = await sb.storage.from(BUCKET).createSignedUrl(ruta, CADUCIDAD);
      guardado = { ruta, url: firmada.data?.signedUrl || null };
    }

    /* El resumen —qué ha entrado y qué falta— viaja en una cabecera, porque
       el cuerpo es el documento. En base64 para que quepa en un header: lleva
       acentos y una cabecera HTTP solo admite ASCII. */
    const resumen = {
      referencia: exp.referencia,
      formato,
      generado_at: new Date().toISOString(),
      bytes: cuerpoDoc.length,
      guardado,
      incluidos: bloques.filter(b => b.archivos.length)
        .map(b => ({ tipo: b.tipo, label: b.label, archivos: b.archivos.length })),
      faltan: bloques.filter(b => !b.archivos.length)
        .map(b => ({ tipo: b.tipo, label: b.label, obligatorio: b.obligatorio }))
    };

    /* `slice()` copia la vista a un buffer propio: sin eso, TypeScript no da
       el Uint8Array por cuerpo válido y, si la vista fuera parcial, se
       enviarían bytes de más. */
    return new Response(cuerpoDoc.slice().buffer as ArrayBuffer, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'X-Expediente-Resumen': base64(new TextEncoder().encode(JSON.stringify(resumen))),
        'Cache-Control': 'no-store'
      }
    });

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error inesperado' }, 500);
  }
});
