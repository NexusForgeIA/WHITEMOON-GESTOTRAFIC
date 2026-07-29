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

/* `simple: true` → el campo NO es nullable en el esquema: se pide como cadena
   y "" significa «no está o no lo he leído».

   No es una excepción a la regla anti-invención, es lo que permite cumplirla.
   La API limita a 16 los parámetros con unión (`anyOf`) por esquema, y un
   `valor` nullable gasta uno. Los seis del DESGLOSE de la vía (número, piso,
   letra, escalera, puerta) van como cadena: son detalle estructural de una
   dirección que además se devuelve entera y verbatim en `direccion`, con su
   propia confianza. Lo que de verdad decide —nombre, apellidos, número de DNI,
   sexo, fechas, municipio, provincia, CP— sigue siendo nullable, que es donde
   `null` significa «no me lo inventes». */
type Campo = { etiqueta: string; pista: string; simple?: boolean };
type Cara = { id: string; label: string; contiene: string };
/* Un bloque es UNA llamada al modelo. Un perfil normal tiene uno; el DNI tiene
   uno por cara. Ver MAX_CAMPOS_ESQUEMA para el porqué. */
type Bloque = { cara?: string; campos: Record<string, Campo> };

/* Tope de campos por esquema. NO es el presupuesto de uniones `anyOf` (ese es
   16 y se sigue vigilando aparte): es el tamaño de la GRAMÁTICA compilada que
   la API construye para el structured output. Con la forma que usamos aquí
   —un objeto {valor, confianza, nota} por campo— medido contra la API:

       14 campos → compila     15 campos → 400 "compiled grammar is too large"

   El DNI necesita 17, así que se lee en DOS llamadas, una por cara (7 + 10).
   Es un detalle interno: la función devuelve UN solo resultado por documento,
   con los campos de las dos caras ya fusionados, así que el cliente no se
   entera. Cada bloque tiene que quedar por debajo de este tope. */
const MAX_CAMPOS_ESQUEMA = 14;

const PERFILES: Record<string, {
  titulo: string;
  bloques: Bloque[];
  caras?: Cara[];
}> = {
  dni: {
    titulo: 'DNI, NIE o pasaporte español',
    /* El DNI reparte sus datos entre las dos caras y puede llegar en dos
       archivos o en uno con las dos. Declararlas sirve para tres cosas: pedir
       al modelo que diga cuáles ha visto, poder avisar de la que falta en
       lugar de dejar el domicilio en blanco sin explicación, y repartir los
       campos en dos esquemas que sí compilan.

       Que cada bloque pregunte SOLO por lo que hay en su cara no es un apaño
       del tope: es la separación que el documento ya tiene. La llamada del
       anverso no ve el reverso, así que no puede confundir la provincia de
       nacimiento con la del domicilio — que es la trampa clásica de esta
       lectura y la que decide con qué tipo se liquida el ITP. */
    caras: [
      { id: 'anverso', label: 'anverso', contiene: 'fotografía, nombre, apellidos, sexo, fecha de nacimiento, fecha de caducidad y número de documento' },
      { id: 'reverso', label: 'reverso', contiene: 'domicilio, municipio, provincia, código postal, lugar de nacimiento y filiación' }
    ],
    bloques: [{
      cara: 'anverso',
      campos: {
        nombre:    { etiqueta: 'Nombre de pila',   pista: 'Solo el nombre, sin apellidos. Está en el anverso.' },
        /* Los dos apellidos van SEPARADOS porque el DNI los imprime separados.
           Pedirlos juntos obligaría luego a partir «DE LA FUENTE RUIZ» por un
           espacio, que es exactamente la clase de suposición que aquí no se
           hace. Si el documento solo trae uno, el segundo es null. */
        apellido1: { etiqueta: 'Primer apellido',  pista: 'SOLO el primer apellido, tal y como lo imprime el documento. Un apellido compuesto («DE LA FUENTE», «SAN JOSE») es UN apellido: devuélvelo entero.' },
        apellido2: { etiqueta: 'Segundo apellido', pista: 'SOLO el segundo apellido. Si el documento no tiene segundo apellido (habitual en NIE y extranjeros), devuelve null.' },
        numero:    { etiqueta: 'Número de DNI/NIE', pista: '8 dígitos + letra (DNI) o X/Y/Z + 7 dígitos + letra (NIE). Copia la letra tal cual aparece. Está en el anverso.' },
        /* Se pide la PALABRA, no la letra del documento. El DNI español imprime
           «M» de masculino y «F» de femenino, y el formato del Colegio usa
           V/H/X: pedir la letra directamente invita a copiar la «M» del DNI y
           cruzarla con la «M» de mujer. La traducción a V/H se hace en el
           cliente, donde es una tabla de dos entradas que se lee de un vistazo. */
        sexo:      { etiqueta: 'Sexo',             pista: 'Responde exactamente «hombre» o «mujer», en minúsculas y como palabra. NO copies la letra del documento (el DNI pone M de masculino y F de femenino, y se confunde con M de mujer). Si no lo lees con claridad, devuelve null.' },
        fecha_nacimiento: { etiqueta: 'Fecha de nacimiento', pista: 'Está en el ANVERSO. Devuélvela en formato AAAA-MM-DD. Ojo: no la confundas con la fecha de expedición ni con la de caducidad.' },
        fecha_caducidad:  { etiqueta: 'Fecha de caducidad',  pista: 'La fecha de VALIDEZ o CADUCIDAD del documento, en el anverso. Formato AAAA-MM-DD. No la confundas con la de nacimiento ni con la de expedición.' }
      }
    }, {
      cara: 'reverso',
      campos: {
        direccion: { etiqueta: 'Domicilio',        pista: 'La línea del domicilio ENTERA y verbatim, tal y como está impresa. Está en el REVERSO. Si no tienes el reverso a la vista, devuelve null: no lo deduzcas de ningún otro documento.' },

        /* Desglose de la vía. Lo hace el modelo, que está viendo el documento,
           y no una expresión regular sobre texto libre: en «SIETE VIENTOS 39
           PBJ» un regex no sabe si «PBJ» es parte del nombre de la calle. */
        via_nombre:   { etiqueta: 'Nombre de la vía', simple: true, pista: 'SOLO el nombre de la calle, SIN el tipo de vía (CALLE, AVENIDA, PLAZA…) y SIN el número ni el piso. De «C/ SIETE VIENTOS 39 PBJ» el nombre de la vía es «SIETE VIENTOS». Cadena vacía si no lo distingues.' },
        via_numero:   { etiqueta: 'Número de la vía', simple: true, pista: 'El número del portal, solo el número. Cadena vacía si no aparece.' },
        via_escalera: { etiqueta: 'Escalera',        simple: true, pista: 'Solo si aparece explícitamente («ESC», «ESCALERA»). Cadena vacía si no.' },
        via_piso:     { etiqueta: 'Piso',            simple: true, pista: 'La planta: «2», «BJ», «PBJ», «ENTLO»… Cópiala tal cual. Cadena vacía si no aparece.' },
        via_puerta:   { etiqueta: 'Puerta',          simple: true, pista: 'La puerta: «B», «IZQ», «DCHA», «2»… Cadena vacía si no aparece.' },
        via_letra:    { etiqueta: 'Letra del portal', simple: true, pista: 'La letra que acompaña al NÚMERO DEL PORTAL («13 B» → letra B), no la de la puerta. Cadena vacía si no aparece o si dudas de cuál de las dos es.' },

        municipio: { etiqueta: 'Municipio del domicilio', pista: 'El municipio del DOMICILIO actual, en el reverso. No el de nacimiento. Si no distingues cuál es cuál, devuelve null.' },
        /* De aquí sale la CCAA con la que se liquida el ITP, así que la
           confusión clásica del reverso —provincia de nacimiento vs. provincia
           del domicilio— cambiaría el impuesto. Ante la duda, null. */
        provincia: { etiqueta: 'Provincia del domicilio', pista: 'La provincia del DOMICILIO actual, no la de nacimiento: en el reverso aparecen las dos y se confunden con facilidad. Solo el nombre de la provincia. Si no distingues cuál es cuál, devuelve null.' },
        cp:        { etiqueta: 'Código postal',     pista: 'Los cinco dígitos del código postal del domicilio. Si no aparece, devuelve null: NO lo deduzcas del municipio.' }
      }
    }]
  },
  cif: {
    titulo: 'documento fiscal de una empresa (tarjeta de CIF, cabecera de factura)',
    bloques: [{ campos: {
      razon_social: { etiqueta: 'Razón social', pista: 'Nombre completo con su forma jurídica (S.L., S.A., …).' },
      cif:          { etiqueta: 'CIF',          pista: 'Letra + 8 caracteres. No lo confundas con un número de factura.' },
      domicilio:    { etiqueta: 'Domicilio social', pista: 'Dirección fiscal completa.' },
      // Misma función que en el DNI: de aquí sale la CCAA que liquida el ITP.
      provincia:    { etiqueta: 'Provincia del domicilio social', pista: 'Solo el nombre de la provincia del domicilio fiscal. Si no aparece, devuelve null: no la deduzcas del código postal ni del prefijo del teléfono.' }
    } }]
  },
  ficha_tecnica: {
    titulo: 'ficha técnica de un vehículo (tarjeta ITV / eITV)',
    bloques: [{ campos: {
      marca:               { etiqueta: 'Marca',            pista: 'Campo D.1.' },
      modelo:              { etiqueta: 'Modelo',           pista: 'Campo D.3. Incluye la versión si aparece.' },
      bastidor:            { etiqueta: 'Nº de bastidor',   pista: 'Campo E. 17 caracteres alfanuméricos (VIN). Ojo con confundir O/0 y I/1: si no lo lees con total claridad, devuelve null.' },
      matricula:           { etiqueta: 'Matrícula',        pista: 'Campo A. Formato 1234 ABC o el antiguo M-1234-AB.' },
      fecha_matriculacion: { etiqueta: '1ª matriculación', pista: 'Campo B. Devuélvela en formato AAAA-MM-DD.' },
      combustible:         { etiqueta: 'Combustible',      pista: 'Campo P.3. Normaliza a: Gasolina, Diésel, Híbrido, Híbrido enchufable, Eléctrico, GLP o GNC.' },
      cvf:                 { etiqueta: 'Potencia fiscal',  pista: 'Campo 7 o "CVF". Número con decimales, p. ej. 11,5. Devuelve el número con punto decimal.' },
      cilindrada:          { etiqueta: 'Cilindrada',       pista: 'Campo P.1, en c.c. Solo el número entero. En un vehículo eléctrico no existe: devuelve null.' },
      /* De esto sale en qué tabla del Anexo I se busca el precio medio, y
         turismo y autocaravana se deprecian con tablas distintas. Se copia lo
         que ponga el documento; traducirlo a los tipos del CRM es cosa del
         cliente, que ante una clasificación que no encaje deja que elija el
         gestor en vez de acercarse. */
      clasificacion:       { etiqueta: 'Clasificación',    pista: 'Campo J o "CLASIFICACIÓN": TURISMO, MOTOCICLETA, CICLOMOTOR, AUTOCARAVANA, VEHÍCULO MIXTO… Cópiala literal, sin interpretarla. Si no aparece, devuelve null: no la deduzcas de la marca ni del modelo.' },
      /* El CÓDIGO de clasificación, que es otra cosa que la palabra de
         arriba: es el número de cuatro dígitos que decide si un vehículo
         que cambia de servicio tiene que pasar por la ITV antes de
         transferirse (1000 particular y taxi, 1041 VTC, 1003 ASN). Se
         copia tal cual; leerlo mal manda a la ITV a quien no debe ir, o
         deja pasar una transferencia que la DGT devuelve. */
      clasificacion_codigo: { etiqueta: 'Código de clasificación', pista: 'El CÓDIGO numérico de la clasificación, normalmente cuatro dígitos junto al campo J o a "CLASIFICACIÓN" (p. ej. 1000, 1041, 1003). Solo los dígitos. Si no aparece un código numérico, devuelve null: NO lo deduzcas de la palabra de la clasificación ni del servicio del vehículo.' }
    } }]
  },
  permiso: {
    titulo: 'permiso de circulación de un vehículo',
    bloques: [{ campos: {
      titular:   { etiqueta: 'Titular',   pista: 'Nombre completo o razón social del titular actual.' },
      matricula: { etiqueta: 'Matrícula', pista: 'Formato 1234 ABC o el antiguo M-1234-AB.' }
    } }]
  },
  contrato: {
    titulo: 'contrato de compraventa o factura de venta de un vehículo',
    bloques: [{ campos: {
      precio:    { etiqueta: 'Precio',    pista: 'Importe total de la venta en euros. Solo el número, con punto decimal y sin símbolo. Si hay base imponible e importe con IVA, devuelve el TOTAL.' },
      fecha:     { etiqueta: 'Fecha',     pista: 'Fecha de la operación, en formato AAAA-MM-DD.' },
      vendedor:  { etiqueta: 'Vendedor',  pista: 'Nombre completo o razón social de quien vende.' },
      comprador: { etiqueta: 'Comprador', pista: 'Nombre completo o razón social de quien compra.' }
    } }]
  }
};

/* El tope de la gramática no se comprueba solo: un campo de más en un bloque
   tumba TODA lectura de ese documento con un 400, y se ve en producción, no
   en un test. Comprobarlo al arrancar convierte ese fallo en un error que
   salta en el primer despliegue. */
for (const [nombre, p] of Object.entries(PERFILES)) {
  for (const b of p.bloques) {
    const n = Object.keys(b.campos).length;
    if (n > MAX_CAMPOS_ESQUEMA) {
      throw new Error(
        `Perfil "${nombre}"${b.cara ? ` (${b.cara})` : ''}: ${n} campos supera el tope de ` +
        `${MAX_CAMPOS_ESQUEMA} por esquema. Reparte los campos en otro bloque.`);
    }
  }
}

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

/* Dos límites distintos, y los dos muerden con el mismo 400:

   1 · UNIONES · la API admite como mucho 16 parámetros con unión (`anyOf`) por
       esquema. Nullable se queda solo donde significa algo: `valor: null` es
       "esto no lo he leído con claridad", la pieza central de la regla
       anti-invención. La nota y la observación son cadena, vacía cuando no hay
       nada que decir: son texto de apoyo y la diferencia entre "" y null no
       aporta.
   2 · GRAMÁTICA · el esquema entero se compila a una gramática con un tamaño
       máximo, y ese tope se alcanza MUCHO antes que el de uniones: 14 campos
       compilan y 15 no, aunque solo la mitad gasten unión. Por eso el DNI se
       lee por bloques (ver MAX_CAMPOS_ESQUEMA), y cada bloque monta su propio
       esquema con SOLO sus campos. */
function esquema(bloque: Bloque) {
  const campos = bloque.campos;
  const props: Record<string, unknown> = {};
  for (const nombre of Object.keys(campos)) {
    props[nombre] = {
      type: 'object',
      properties: {
        // Los `simple` no gastan del presupuesto de 16 uniones: "" es su hueco.
        valor: campos[nombre].simple ? { type: 'string' } : nulable('string'),
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

  /* Si el bloque es de una cara, se le pregunta por ESA cara y solo por esa.
     Es un booleano, no una unión: no gasta del presupuesto. Preguntarlo
     explícitamente es más fiable que deducir la cara que falta de que un campo
     venga vacío — un domicilio ilegible y un reverso que nadie subió no son lo
     mismo, y solo el segundo se arregla subiendo un archivo. */
  if (bloque.cara) {
    salida.cara_vista = { type: 'boolean' };
    requeridos.push('cara_vista');
  }

  return {
    type: 'object',
    properties: salida,
    required: requeridos,
    additionalProperties: false
  };
}

function prompt(perfil: string, archivos: number, bloque: Bloque) {
  const p = PERFILES[perfil];
  const lista = Object.entries(bloque.campos)
    .map(([k, c]) => `- ${k} (${c.etiqueta}): ${c.pista}`)
    .join('\n');

  /* Con varios archivos hay que decirlo: son el MISMO documento por las dos
     caras, no dos documentos distintos. */
  const varios = archivos > 1
    ? `\nTe llegan ${archivos} archivos. Son ${p.caras ? 'las caras' : 'las páginas'} de UN SOLO documento, el mismo: léelos juntos y devuelve una sola respuesta combinando lo que veas en todos.\n`
    : '';

  /* Este bloque solo pregunta por una cara. Decirle cuál —y qué hay en ella—
     es lo que le permite responder «no la tengo delante» en vez de rellenar
     el hueco con lo que vea en la otra. */
  const cara = bloque.cara
    ? (() => {
        const c = (p.caras || []).find(x => x.id === bloque.cara);
        return `\nQUÉ CARA ESTÁS LEYENDO\nEste documento tiene dos caras y los datos están repartidos. Aquí se te piden SOLO los del ${c ? c.label : bloque.cara}: ${c ? c.contiene : ''}.\n\n`
          + `Puede que entre los archivos no esté esa cara. En "cara_vista" pon true SOLO si la estás viendo de verdad; si no, ponlo en false y devuelve TODOS los campos vacíos (null, o "" en los que no admiten null) con confianza "baja", explicando en la "nota" que falta esa cara. No los deduzcas de la otra cara ni de ningún otro documento.\n`;
      })()
    : '';

  return `Eres el motor de lectura documental de una gestoría de tráfico española. Vas a leer ${p.titulo} y extraer los datos que se te piden.
${varios}
Campos a extraer:
${lista}
${cara}

REGLA CRÍTICA — léela dos veces:
Los datos que extraes se usan para liquidar impuestos y para inscribir cambios de titularidad ante la DGT. Un dato inventado que parezca correcto causa un daño mayor que un hueco vacío, porque nadie lo revisará.

Por eso:
- Si un dato NO aparece en el documento, devuelve valor null.
- Si aparece pero no lo lees con total claridad (borroso, cortado, tapado, ambiguo), devuelve valor null y confianza "baja". NO adivines, NO completes, NO deduzcas a partir de otros campos.
- No rellenes un campo con un valor "plausible" ni con un ejemplo. Antes null que aproximado.
- Unos pocos campos del esquema no admiten null: en ellos el hueco es la cadena vacía "". Vale exactamente lo mismo — vacío antes que aproximado.

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
       y se devuelven como UN solo resultado, para que el domicilio del reverso
       caiga en el mismo registro que el número del anverso.

       Agrupa por tipo y SOLO por tipo. Cada documento sigue siendo una lectura
       aislada: el DNI del comprador nunca ve el del vendedor, así que no hay
       forma de que un dato de uno acabe en el otro.

       `cara` es opcional: el cliente la manda para que la llamada del anverso
       reciba solo el anverso. Si no viene, cada bloque ve todos los archivos y
       la lectura sale igual — solo cuesta más. */
    type Entrada = { tipo: string; storage_path: string; cara?: string };
    const grupos = new Map<string, { path: string; cara?: string }[]>();
    for (const d of documentos as Entrada[]) {
      if (!d || !d.tipo || !d.storage_path) continue;
      const archivos = grupos.get(d.tipo) || [];
      if (!archivos.some(a => a.path === d.storage_path)) {
        archivos.push({ path: d.storage_path, cara: d.cara });
      }
      grupos.set(d.tipo, archivos);
    }

    // 3 · Un documento, una lectura. En paralelo: son independientes.
    const lecturas = await Promise.all([...grupos.entries()].map(async ([tipo, todos]) => {
      // Con más archivos la petición se va de tamaño sin aportar nada: un DNI
      // son dos caras. Si llegan más, se leen los primeros y se dice cuántos.
      const elegidos = todos.slice(0, MAX_ARCHIVOS);
      const ignorados = todos.length - elegidos.length;

      const base = {
        tipo,
        storage_path: elegidos[0].path,
        storage_paths: elegidos.map(a => a.path),
        archivos: elegidos.length
      };
      const perfilDoc = perfilDe(tipo);
      if (!perfilDoc) return { ...base, extraido: false, motivo: 'Este tipo de documento no se lee automáticamente.' };

      // Se baja cada archivo UNA vez aunque lo usen los dos bloques.
      const bajadas = await Promise.all(elegidos.map(async (a) => {
        const r = await sb.storage.from(BUCKET).download(a.path);
        if (r.error || !r.data) return null;
        return { cara: a.cara, mime: r.data.type || 'application/octet-stream', datos: base64(await r.data.arrayBuffer()) };
      }));
      const archivos = bajadas.filter(Boolean) as { cara?: string; mime: string; datos: string }[];
      if (!archivos.length) {
        return { ...base, extraido: false, motivo: 'No se pudo leer el archivo del expediente.' };
      }

      /* Qué archivos ve cada bloque. Un archivo `completo` son las dos caras en
         uno, así que vale para todos; y si nadie declaró cara, todos ven todo.
         Si el filtro dejara un bloque sin archivos, se le dan todos: mejor que
         el modelo mire y diga que no ve la cara, a decidirlo aquí a ciegas. */
      const paraCara = (cara?: string) => {
        if (!cara || !archivos.some(a => a.cara)) return archivos;
        const suyos = archivos.filter(a => a.cara === cara || a.cara === 'completo' || !a.cara);
        return suyos.length ? suyos : archivos;
      };

      /* Una llamada por bloque, en paralelo. Para los perfiles normales es un
         solo bloque y esto es exactamente lo de antes; el DNI son dos. */
      type Salida = {
        campos: Record<string, unknown>;
        legible?: boolean;
        observacion?: string;
        cara_vista?: boolean;
      };
      type Parte = { bloque: Bloque; salida?: Salida; modelo?: string; error?: string };

      const bloques = PERFILES[perfilDoc].bloques;
      const partes: Parte[] = await Promise.all(bloques.map(async (bloque): Promise<Parte> => {
        const suyos = paraCara(bloque.cara);

        /* Cada archivo va precedido de su número para que el modelo sepa que son
           partes del mismo documento y no documentos sueltos. */
        const contenido: unknown[] = [];
        suyos.forEach((a, i) => {
          if (suyos.length > 1) {
            contenido.push({ type: 'text', text: `Archivo ${i + 1} de ${suyos.length} del mismo documento:` });
          }
          contenido.push(bloqueDocumento(a.mime, a.datos));
        });
        contenido.push({ type: 'text', text: prompt(perfilDoc, suyos.length, bloque) });

        try {
          const res = await anthropic.beta.messages.create({
            model: MODELO,
            max_tokens: 4096,
            // La extracción no es una tarea de razonamiento profundo: `medium`
            // da la misma lectura con bastante menos latencia que el gestor
            // pasa esperando delante de la pantalla.
            output_config: {
              effort: 'medium',
              format: { type: 'json_schema', schema: esquema(bloque) }
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
            return { bloque, error: 'El modelo declinó procesar este documento.' };
          }
          const texto = res.content.find((b: { type: string }) => b.type === 'text');
          if (!texto) return { bloque, error: 'El modelo no devolvió datos.' };

          const salida = JSON.parse((texto as { text: string }).text);
          return { bloque, salida, modelo: res.model };
        } catch (e) {
          return { bloque, error: 'Error al analizar: ' + (e instanceof Error ? e.message : 'desconocido') };
        }
      }));

      /* Si NINGÚN bloque salió, el documento no se ha leído. Si salió alguno,
         se devuelve lo que hay: los campos del bloque que falló quedan sin
         proponer —en blanco y señalados—, que es justo lo que toca. */
      const buenas = partes.filter((p): p is Parte & { salida: Salida } => !!p.salida);
      if (!buenas.length) {
        return { ...base, extraido: false, motivo: partes[0]?.error || 'No se pudo leer el documento.' };
      }

      const campos: Record<string, unknown> = {};
      for (const p of buenas) Object.assign(campos, p.salida.campos);

      /* Qué caras se han visto de verdad, reconstruido a partir de lo que dijo
         cada bloque. Un bloque que ni siquiera llegó a responder cuenta como
         cara no vista: no se ha leído, y eso es lo que hay que enseñar. */
      let carasVistas: Record<string, boolean> | null = null;
      if (PERFILES[perfilDoc].caras) {
        carasVistas = {};
        for (const p of partes) {
          if (p.bloque.cara) carasVistas[p.bloque.cara] = p.salida?.cara_vista === true;
        }
      }

      const fallos = partes.filter(p => p.error)
        .map(p => (p.bloque.cara ? `No se pudo leer el ${p.bloque.cara}: ` : '') + p.error);
      const notas = [
        ...buenas.map(p => p.salida.observacion).filter(Boolean),
        ...fallos,
        ignorados > 0 ? `Se han leído ${elegidos.length} archivos; ${ignorados} más no se han analizado.` : ''
      ].filter(Boolean);

      return {
        ...base,
        extraido: true,
        perfil: perfilDoc,
        // Legible si alguna de las lecturas que salieron lo dice.
        legible: buenas.some(p => p.salida.legible !== false),
        observacion: [...new Set(notas)].join(' '),
        campos,
        caras_vistas: carasVistas,
        caras_faltan: carasQueFaltan(perfilDoc, carasVistas),
        modelo: buenas[0].modelo
      };
    }));

    return json({ modelo: MODELO, documentos: lecturas });

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error inesperado' }, 500);
  }
});
