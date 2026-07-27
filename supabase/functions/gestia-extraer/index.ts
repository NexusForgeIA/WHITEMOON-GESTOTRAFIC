/* ============================================================
   GestoTrafic · gestia-extraer
   ------------------------------------------------------------
   Lee los documentos de un expediente con Claude (visión) y
   devuelve los campos extraídos con un nivel de confianza por
   campo. NO escribe en el expediente: eso lo hace el navegador
   tras el OK del gestor.

   Por qué vive aquí y no en el cliente:
     · la ANTHROPIC_API_KEY nunca sale del servidor
     · los documentos se descargan del bucket privado con el
       service_role, sin exponer URLs firmadas a nadie más
     · se vuelve a comprobar en el servidor que quien llama es un
       usuario activo y que el expediente es suyo (o es admin)

   RGPD · los documentos son DNI, permisos de circulación y
   contratos: datos personales. Aquí solo se leen en memoria para
   la llamada al modelo; no se persisten en la función ni se
   escriben en logs. Lo que se conserva es el resultado de la
   extracción, dentro del expediente y bajo su mismo RLS.

   La instrucción crítica del prompt es que un dato que no se lee
   con claridad se devuelve como null con confianza baja. Es dato
   fiscal y legal: un valor inventado con buena presencia es peor
   que un hueco.
   ============================================================ */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.68.0';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const MODELO = 'claude-opus-5';
const BUCKET = 'gestotrafic-docs';

/* Archivos que se leen como un mismo documento. Un DNI son dos caras y una
   ficha técnica dos páginas; el tope está para que un expediente con muchos
   archivos del mismo tipo no monte una petición desproporcionada. */
const MAX_ARCHIVOS = 4;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });

/* ---------------- Qué se extrae de cada tipo de documento ---------------- */

type Campo = { etiqueta: string; pista: string };
type Cara = { id: string; label: string; contiene: string };

const PERFILES: Record<string, {
  titulo: string;
  campos: Record<string, Campo>;
  caras?: Cara[];
}> = {
  dni: {
    titulo: 'DNI, NIE o pasaporte español',
    /* El DNI reparte sus datos entre las dos caras y puede llegar en dos
       archivos o en uno con las dos. Declararlas sirve para dos cosas: pedir
       al modelo que diga cuáles ha visto, y poder avisar de la que falta en
       lugar de dejar el domicilio en blanco sin explicación. */
    caras: [
      { id: 'anverso', label: 'anverso', contiene: 'fotografía, nombre, apellidos y número de documento' },
      { id: 'reverso', label: 'reverso', contiene: 'domicilio, lugar de nacimiento y filiación' }
    ],
    campos: {
      nombre:    { etiqueta: 'Nombre de pila',   pista: 'Solo el nombre, sin apellidos. Está en el anverso.' },
      apellidos: { etiqueta: 'Apellidos',        pista: 'Los dos apellidos, en su orden. Están en el anverso.' },
      numero:    { etiqueta: 'Número de DNI/NIE', pista: '8 dígitos + letra (DNI) o X/Y/Z + 7 dígitos + letra (NIE). Copia la letra tal cual aparece. Está en el anverso.' },
      direccion: { etiqueta: 'Domicilio',        pista: 'Está en el REVERSO. Si no tienes el reverso a la vista, devuelve null: no lo deduzcas de ningún otro documento.' }
    }
  },
  cif: {
    titulo: 'documento fiscal de una empresa (tarjeta de CIF, cabecera de factura)',
    campos: {
      razon_social: { etiqueta: 'Razón social', pista: 'Nombre completo con su forma jurídica (S.L., S.A., …).' },
      cif:          { etiqueta: 'CIF',          pista: 'Letra + 8 caracteres. No lo confundas con un número de factura.' },
      domicilio:    { etiqueta: 'Domicilio social', pista: 'Dirección fiscal completa.' }
    }
  },
  ficha_tecnica: {
    titulo: 'ficha técnica de un vehículo (tarjeta ITV / eITV)',
    campos: {
      marca:               { etiqueta: 'Marca',            pista: 'Campo D.1.' },
      modelo:              { etiqueta: 'Modelo',           pista: 'Campo D.3. Incluye la versión si aparece.' },
      bastidor:            { etiqueta: 'Nº de bastidor',   pista: 'Campo E. 17 caracteres alfanuméricos (VIN). Ojo con confundir O/0 y I/1: si no lo lees con total claridad, devuelve null.' },
      matricula:           { etiqueta: 'Matrícula',        pista: 'Campo A. Formato 1234 ABC o el antiguo M-1234-AB.' },
      fecha_matriculacion: { etiqueta: '1ª matriculación', pista: 'Campo B. Devuélvela en formato AAAA-MM-DD.' },
      combustible:         { etiqueta: 'Combustible',      pista: 'Campo P.3. Normaliza a: Gasolina, Diésel, Híbrido, Híbrido enchufable, Eléctrico, GLP o GNC.' },
      cvf:                 { etiqueta: 'Potencia fiscal',  pista: 'Campo 7 o "CVF". Número con decimales, p. ej. 11,5. Devuelve el número con punto decimal.' },
      cilindrada:          { etiqueta: 'Cilindrada',       pista: 'Campo P.1, en c.c. Solo el número entero. En un vehículo eléctrico no existe: devuelve null.' }
    }
  },
  permiso: {
    titulo: 'permiso de circulación de un vehículo',
    campos: {
      titular:   { etiqueta: 'Titular',   pista: 'Nombre completo o razón social del titular actual.' },
      matricula: { etiqueta: 'Matrícula', pista: 'Formato 1234 ABC o el antiguo M-1234-AB.' }
    }
  },
  contrato: {
    titulo: 'contrato de compraventa o factura de venta de un vehículo',
    campos: {
      precio:    { etiqueta: 'Precio',    pista: 'Importe total de la venta en euros. Solo el número, con punto decimal y sin símbolo. Si hay base imponible e importe con IVA, devuelve el TOTAL.' },
      fecha:     { etiqueta: 'Fecha',     pista: 'Fecha de la operación, en formato AAAA-MM-DD.' },
      vendedor:  { etiqueta: 'Vendedor',  pista: 'Nombre completo o razón social de quien vende.' },
      comprador: { etiqueta: 'Comprador', pista: 'Nombre completo o razón social de quien compra.' }
    }
  }
};

/** Los tipos del checklist se mapean a un perfil de extracción. */
function perfilDe(tipo: string): string | null {
  if (tipo.startsWith('dni_')) return 'dni';
  if (tipo.startsWith('cif_')) return 'cif';
  if (tipo === 'ficha_tecnica' || tipo === 'ficha_tecnica_coc' || tipo === 'itv' || tipo === 'itv_anterior') return 'ficha_tecnica';
  if (tipo === 'permiso_circulacion') return 'permiso';
  if (tipo === 'contrato' || tipo === 'contrato_venta' || tipo === 'factura_venta' || tipo === 'factura_compra') return 'contrato';
  return null;   // certificados, denuncias, "otros"… no se extraen
}

/** Caras declaradas del perfil que el modelo dice NO haber visto. */
function carasQueFaltan(perfil: string, vistas: Record<string, boolean> | null | undefined): string[] {
  const caras = PERFILES[perfil]?.caras;
  if (!caras || !vistas) return [];
  return caras.filter(c => vistas[c.id] !== true).map(c => c.id);
}

/* ---------------- Esquema de salida ---------------- */

const nulable = (t: string) => ({ anyOf: [{ type: t }, { type: 'null' }] });

/* La API limita a 16 los parámetros con unión (`anyOf`) por esquema. Con dos
   por campo (valor y nota) más la observación, la ficha técnica —8 campos— se
   iba a 17 y TODA lectura de fichas fallaba con un 400.

   Nullable se queda solo donde significa algo: `valor: null` es "esto no lo he
   leído con claridad", que es la pieza central de la regla anti-invención. La
   nota y la observación pasan a cadena, vacía cuando no hay nada que decir:
   son texto de apoyo y la diferencia entre "" y null no aporta. Así son 8
   uniones y quedan campos de sobra para crecer. */
function esquema(perfil: string) {
  const p = PERFILES[perfil];
  const campos = p.campos;
  const props: Record<string, unknown> = {};
  for (const nombre of Object.keys(campos)) {
    props[nombre] = {
      type: 'object',
      properties: {
        valor: nulable('string'),
        confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
        nota: { type: 'string' }
      },
      required: ['valor', 'confianza', 'nota'],
      additionalProperties: false
    };
  }

  const salida: Record<string, unknown> = {
    campos: {
      type: 'object',
      properties: props,
      required: Object.keys(campos),
      additionalProperties: false
    },
    legible: { type: 'boolean' },
    observacion: { type: 'string' }
  };
  const requeridos = ['campos', 'legible', 'observacion'];

  /* Qué caras ha visto. Son booleanos, no uniones: no gastan del presupuesto
     de 16 `anyOf` por esquema. Preguntarlo explícitamente es más fiable que
     deducir la cara que falta de que un campo venga vacío — un domicilio
     ilegible y un reverso que no se ha subido no son lo mismo. */
  if (p.caras) {
    const caras: Record<string, unknown> = {};
    for (const c of p.caras) caras[c.id] = { type: 'boolean' };
    salida.caras_vistas = {
      type: 'object',
      properties: caras,
      required: p.caras.map(c => c.id),
      additionalProperties: false
    };
    requeridos.push('caras_vistas');
  }

  return {
    type: 'object',
    properties: salida,
    required: requeridos,
    additionalProperties: false
  };
}

function prompt(perfil: string, archivos: number) {
  const p = PERFILES[perfil];
  const lista = Object.entries(p.campos)
    .map(([k, c]) => `- ${k} (${c.etiqueta}): ${c.pista}`)
    .join('\n');

  /* Con varios archivos hay que decirlo: son el MISMO documento por las dos
     caras, no dos documentos distintos. */
  const varios = archivos > 1
    ? `\nTe llegan ${archivos} archivos. Son ${p.caras ? 'las caras' : 'las páginas'} de UN SOLO documento, el mismo: léelos juntos y devuelve una sola respuesta combinando lo que veas en todos.\n`
    : '';

  const caras = p.caras
    ? `\nCARAS DEL DOCUMENTO\nEste documento tiene ${p.caras.length} caras y los datos están repartidos:\n`
      + p.caras.map(c => `- ${c.label}: ${c.contiene}`).join('\n')
      + `\n\nEn "caras_vistas" marca true SOLO las caras que estés viendo de verdad en los archivos. Si falta una, sus datos NO existen para ti: devuélvelos null con confianza "baja" y explica en su "nota" que falta esa cara. No los deduzcas ni los completes con lo que veas en la otra.\n`
    : '';

  return `Eres el motor de lectura documental de una gestoría de tráfico española. Vas a leer ${p.titulo} y extraer los datos que se te piden.
${varios}
Campos a extraer:
${lista}
${caras}

REGLA CRÍTICA — léela dos veces:
Los datos que extraes se usan para liquidar impuestos y para inscribir cambios de titularidad ante la DGT. Un dato inventado que parezca correcto causa un daño mayor que un hueco vacío, porque nadie lo revisará.

Por eso:
- Si un dato NO aparece en el documento, devuelve valor null.
- Si aparece pero no lo lees con total claridad (borroso, cortado, tapado, ambiguo), devuelve valor null y confianza "baja". NO adivines, NO completes, NO deduzcas a partir de otros campos.
- No rellenes un campo con un valor "plausible" ni con un ejemplo. Antes null que aproximado.

Confianza:
- "alta": el dato se lee nítido y sin ambigüedad posible.
- "media": se lee, pero hay algún carácter dudoso o el formato no es el esperado.
- "baja": no se lee, no aparece, o no estás seguro. En este caso el valor debe ser null.

En "nota" explica en pocas palabras por qué un campo es dudoso o falta. Déjala vacía ("") si el campo salió limpio.
En "legible" indica si el documento se puede leer en general. En "observacion" señala si el documento no es del tipo esperado, o déjala vacía ("").

Responde solo con el JSON del esquema.`;
}

/* ---------------- Contenido para el modelo ---------------- */

const MIMES_IMAGEN = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  const CH = 0x8000;                       // por trozos: evita desbordar el stack
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

function bloqueDocumento(mime: string, datos: string) {
  if (mime === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: datos } };
  }
  const tipo = MIMES_IMAGEN.includes(mime) ? mime : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: tipo, data: datos } };
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

    const { expediente_id, documentos } = await req.json();
    if (!expediente_id || !Array.isArray(documentos) || !documentos.length) {
      return json({ error: 'Faltan el expediente o los documentos' }, 400);
    }

    // 2 · El expediente tiene que ser suyo (o ser admin). Mismo criterio que el RLS.
    const { data: exp } = await sb
      .from('gestotrafic_expedientes')
      .select('id, gestor_id')
      .eq('id', expediente_id)
      .maybeSingle();
    if (!exp) return json({ error: 'El expediente no existe' }, 404);
    if (perfil.rol !== 'admin' && exp.gestor_id !== perfil.id) {
      return json({ error: 'Ese expediente no está asignado a tu usuario' }, 403);
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    /* Un documento del checklist puede llegar en VARIOS archivos: el DNI tiene
       dos caras y el domicilio solo está en el reverso. Se agrupan por `tipo`
       y se leen en UNA sola llamada, para que el domicilio del reverso caiga
       en el mismo registro que el número del anverso.

       Agrupa por tipo y SOLO por tipo. Cada documento sigue siendo una lectura
       aislada con su propia llamada: el DNI del comprador nunca ve el del
       vendedor, así que no hay forma de que un dato de uno acabe en el otro. */
    const grupos = new Map<string, string[]>();
    for (const d of documentos as { tipo: string; storage_path: string }[]) {
      if (!d || !d.tipo || !d.storage_path) continue;
      const paths = grupos.get(d.tipo) || [];
      if (paths.indexOf(d.storage_path) === -1) paths.push(d.storage_path);
      grupos.set(d.tipo, paths);
    }

    // 3 · Un documento, una lectura. En paralelo: son independientes.
    const lecturas = await Promise.all([...grupos.entries()].map(async ([tipo, todos]) => {
      // Con más archivos la petición se va de tamaño sin aportar nada: un DNI
      // son dos caras. Si llegan más, se leen los primeros y se dice cuántos.
      const paths = todos.slice(0, MAX_ARCHIVOS);
      const ignorados = todos.length - paths.length;

      const base = {
        tipo,
        storage_path: paths[0],
        storage_paths: paths,
        archivos: paths.length
      };
      const perfilDoc = perfilDe(tipo);
      if (!perfilDoc) return { ...base, extraido: false, motivo: 'Este tipo de documento no se lee automáticamente.' };

      const bajadas = await Promise.all(paths.map(async (p) => {
        const r = await sb.storage.from(BUCKET).download(p);
        if (r.error || !r.data) return null;
        return { mime: r.data.type || 'application/octet-stream', datos: base64(await r.data.arrayBuffer()) };
      }));
      const archivos = bajadas.filter(Boolean) as { mime: string; datos: string }[];
      if (!archivos.length) {
        return { ...base, extraido: false, motivo: 'No se pudo leer el archivo del expediente.' };
      }

      /* Cada archivo va precedido de su número para que el modelo sepa que son
         partes del mismo documento y no documentos sueltos. */
      const contenido: unknown[] = [];
      archivos.forEach((a, i) => {
        if (archivos.length > 1) {
          contenido.push({ type: 'text', text: `Archivo ${i + 1} de ${archivos.length} del mismo documento:` });
        }
        contenido.push(bloqueDocumento(a.mime, a.datos));
      });
      contenido.push({ type: 'text', text: prompt(perfilDoc, archivos.length) });

      try {
        const res = await anthropic.beta.messages.create({
          model: MODELO,
          max_tokens: 4096,
          // La extracción no es una tarea de razonamiento profundo: `medium`
          // da la misma lectura con bastante menos latencia que el gestor
          // pasa esperando delante de la pantalla.
          output_config: {
            effort: 'medium',
            format: { type: 'json_schema', schema: esquema(perfilDoc) }
          },
          // Un documento de identidad puede hacer saltar un clasificador;
          // con esto la petición se reintenta sola en vez de morir.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          messages: [{ role: 'user', content: contenido }]
        } as Parameters<typeof anthropic.beta.messages.create>[0]);

        // Hay que mirar stop_reason ANTES de tocar content: en un rechazo
        // viene vacío y `content[0].text` reventaría.
        if (res.stop_reason === 'refusal') {
          return { ...base, extraido: false, motivo: 'El modelo declinó procesar este documento.' };
        }

        const texto = res.content.find((b: { type: string }) => b.type === 'text');
        if (!texto) return { ...base, extraido: false, motivo: 'El modelo no devolvió datos.' };

        const salida = JSON.parse((texto as { text: string }).text);
        const nota = ignorados > 0
          ? `Se han leído ${paths.length} archivos; ${ignorados} más no se han analizado.`
          : '';

        return {
          ...base,
          extraido: true,
          perfil: perfilDoc,
          legible: salida.legible,
          observacion: [salida.observacion, nota].filter(Boolean).join(' '),
          campos: salida.campos,
          caras_vistas: salida.caras_vistas || null,
          caras_faltan: carasQueFaltan(perfilDoc, salida.caras_vistas),
          modelo: res.model
        };
      } catch (e) {
        return {
          ...base,
          extraido: false,
          motivo: 'Error al analizar: ' + (e instanceof Error ? e.message : 'desconocido')
        };
      }
    }));

    return json({ modelo: MODELO, documentos: lecturas });

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error inesperado' }, 500);
  }
});
