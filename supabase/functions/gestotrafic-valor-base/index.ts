/* ============================================================
   GestoTrafic · gestotrafic-valor-base
   ------------------------------------------------------------
   Propone el valor base del Anexo I a partir de lo que Gest-IA
   leyó de la ficha técnica.

   PROPONE. No decide. La regla de oro del proyecto es que ningún
   importe fiscal se inventa, y aquí eso significa tres cosas:

     · el importe SIEMPRE sale de una fila real de
       `gestotrafic_precios_medios`; esta función no calcula ni
       estima nada,
     · si encaja más de una versión NO se elige ninguna: se
       devuelven todas para que el gestor fije la fila (por id),
       porque dos versiones del mismo modelo pueden separarse por
       más de mil euros,
     · si no encaja ninguna se dice, y el campo se queda manual.

   Por qué vive en el servidor: las funciones de búsqueda
   (`gestotrafic_buscar_valor_base*`) solo tienen `execute` para
   `authenticated` y `service_role`, y la tabla son ~71.000 filas
   que no tienen por qué viajar al navegador. Aquí se consultan con
   el service_role, tras comprobar que quien llama es un usuario
   activo — igual que hace gestia-extraer.
   ============================================================ */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

/* Tope del desplegable. Un modelo con muchas motorizaciones pasa del centenar
   de versiones (el Golf diésel de 2018 da 101), así que recortar corto dejaría
   fuera la buena sin que se note. Cuando se recorta, se avisa. */
const MAX_CANDIDATOS = 150;

/* Códigos de la leyenda del Anexo I según el combustible de la ficha.
   "Híbrido" a secas no dice si es de gasolina o de diésel, así que valen los
   tres no enchufables: estrechar de menos es inocuo, estrechar de más esconde
   la versión correcta. El GNC no tiene código propio: no se filtra por él. */
const COMBUSTIBLES: Record<string, string[]> = {
  'gasolina': ['G'],
  'diésel': ['D'], 'diesel': ['D'],
  'eléctrico': ['Elc'], 'electrico': ['Elc'],
  'híbrido enchufable': ['PHEV'], 'hibrido enchufable': ['PHEV'],
  'híbrido': ['GyE', 'DyE', 'SyE'], 'hibrido': ['GyE', 'DyE', 'SyE'],
  'glp': ['S']
};

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9.]+/g, ' ').trim();

const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.').replace(/[^\d.]/g, ''));
  return isFinite(n) && n > 0 ? n : null;
};

type Fila = Record<string, unknown>;

/**
 * Reduce las versiones del modelo a las que encajan con la ficha técnica.
 *
 * Todos los filtros usan datos REALMENTE leídos del documento —cilindrada,
 * combustible y las palabras de la denominación—; ninguno elige un precio. Un
 * filtro que deje la lista vacía se descarta: la ficha puede venir mal leída y
 * es preferible ofrecer de más que esconder la versión correcta.
 *
 * La denominación se compara por PALABRAS SUELTAS, no por subcadena: el BOE
 * escribe «GOLF VII 1.5 TSI EVO Advance 5p», así que una ficha que ponga
 * «Golf 1.5 TSI» no aparece como subcadena por culpa del «VII».
 */
function estrechar(
  todas: Fila[],
  ficha: { denominacion: string; cilindrada: number | null; combustible: string | null }
) {
  const aplicar = (lista: Fila[], f: (r: Fila) => boolean) => {
    const out = lista.filter(f);
    return out.length ? out : lista;
  };

  let filas = todas;
  const usados: string[] = [];

  if (ficha.cilindrada) {
    const antes = filas.length;
    filas = aplicar(filas, (r) => Number(r.cilindrada) === ficha.cilindrada);
    if (filas.length !== antes) usados.push('cilindrada');
  }

  const codigos = COMBUSTIBLES[(ficha.combustible || '').toLowerCase().trim()];
  if (codigos && codigos.length) {
    const antes = filas.length;
    filas = aplicar(filas, (r) => codigos.includes(String(r.combustible)));
    if (filas.length !== antes) usados.push('combustible');
  }

  // Palabras de la denominación leída: primero todas, luego menos.
  const tokens = normalizar(ficha.denominacion).split(' ').filter(Boolean);
  for (let n = tokens.length; n >= 1; n--) {
    const pedidos = tokens.slice(0, n);
    const cuadran = filas.filter((r) => {
      const palabras = normalizar(String(r.denominacion || '')).split(' ');
      return pedidos.every((t) => palabras.includes(t));
    });
    if (cuadran.length) {
      return {
        filas: cuadran,
        criterio: usados.concat(n === tokens.length ? 'denominacion' : 'denominacion_parcial').join('+'),
        palabras_usadas: n,
        palabras_leidas: tokens.length
      };
    }
  }

  return {
    filas,
    criterio: usados.concat('modelo').join('+'),
    palabras_usadas: 0,
    palabras_leidas: tokens.length
  };
}

async function proponer(sb: ReturnType<typeof createClient>, v: Record<string, unknown>) {
  const tipo = String(v.tipo_vehiculo || 'coche');
  const tipoBoe = tipo === 'autocaravana' ? 'autocaravana'
    : (tipo === 'coche' || tipo === 'turismo') ? 'turismo' : tipo;

  const cilindrada = num(v.cilindrada);
  const kw = num(v.potencia_kw);
  const fecha = v.fecha_matriculacion ? String(v.fecha_matriculacion) : null;

  /* Motos, quads y buggys: el Anexo I tarifa por TRAMO, así que no hay
     versiones entre las que elegir. Sale una fila o ninguna. */
  if (tipoBoe === 'moto' || tipoBoe === 'moto_electrica' || tipoBoe === 'quad' || tipoBoe === 'buggy') {
    if (!cilindrada && !kw) return { estado: 'sin_datos', tipo_vehiculo: tipo };
    const { data, error } = await sb.rpc('gestotrafic_buscar_valor_base_tramo', {
      p_tipo_vehiculo: tipoBoe,
      p_cilindrada: cilindrada,
      p_potencia_kw: kw
    });
    const fila = !error && Array.isArray(data) ? data[0] : null;
    if (!fila || !fila.encontrado) return { estado: 'sin_match', tipo_vehiculo: tipo };
    return {
      estado: 'propuesta', tipo_vehiculo: tipo, criterio: 'tramo',
      total: 1, fila, candidatos: [fila]
    };
  }

  /* Turismos y autocaravanas: por marca / modelo / versión. */
  const marca = v.marca ? String(v.marca).trim() : '';
  const modeloLeido = v.modelo ? String(v.modelo).trim() : '';
  if (!marca || !modeloLeido) return { estado: 'sin_datos', tipo_vehiculo: tipo };

  // En la tabla, `modelo` es el primer token de la denominación del BOE.
  const { data, error } = await sb.rpc('gestotrafic_buscar_valor_base', {
    p_marca: marca,
    p_modelo: modeloLeido.split(/\s+/)[0],
    p_version: null,            // se estrecha aquí, no con un LIKE contiguo
    p_fecha_matriculacion: fecha,
    p_id: null,
    p_tipo_vehiculo: tipoBoe
  });
  if (error) return { estado: 'error', tipo_vehiculo: tipo, motivo: error.message };

  const todas = Array.isArray(data) ? data.filter((f: Fila) => f.id !== null) : [];
  if (!todas.length) return { estado: 'sin_match', tipo_vehiculo: tipo };

  const est = estrechar(todas, {
    denominacion: modeloLeido,
    cilindrada,
    combustible: v.combustible ? String(v.combustible) : null
  });

  const total = est.filas.length;
  const recortado = total > MAX_CANDIDATOS;

  return {
    // Una sola fila se propone; varias se ofrecen SIN elegir ninguna.
    estado: total === 1 ? 'propuesta' : 'varios',
    tipo_vehiculo: tipo,
    criterio: est.criterio,
    palabras_usadas: est.palabras_usadas,
    palabras_leidas: est.palabras_leidas,
    del_modelo: todas.length,
    total,
    recortado,
    fila: total === 1 ? est.filas[0] : null,
    candidatos: recortado ? est.filas.slice(0, MAX_CANDIDATOS) : est.filas
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const sb = createClient(URL_SB, SERVICE_KEY, { auth: { persistSession: false } });

    /* Quién llama. `verify_jwt` solo garantiza que el token es del proyecto y
       la clave anon también lo es, así que hay que identificar al usuario. */
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth, error: errAuth } = await sb.auth.getUser(token);
    if (errAuth || !auth.user) return json({ error: 'Sesión no válida' }, 401);

    const { data: perfil } = await sb
      .from('gestotrafic_usuarios')
      .select('id, activo')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (!perfil || !perfil.activo) return json({ error: 'Usuario no autorizado' }, 403);

    const cuerpo = await req.json();
    return json(await proponer(sb, cuerpo ?? {}));

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error inesperado' }, 500);
  }
});
