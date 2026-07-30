/* ============================================================
   GestoTrafic · gestotrafic-credenciales
   ------------------------------------------------------------
   Credenciales de la gestoría para operar con el Colegio (ICOGAM):
   certificado colegial, su contraseña, clave API y token.

   Tres acciones, todas de admin salvo `listo`:

     estado  · metadatos: qué hay configurado, cuándo y una pista.
               NUNCA devuelve un secreto.
     guardar · cifra y guarda. Reemplaza lo que hubiera.
     borrar  · pone a null una pieza concreta.
     listo   · booleano para el gating. Lo puede pedir cualquier sesión.

   ⛔ POR QUÉ ESTO ES WRITE-ONLY

   No existe ninguna acción que devuelva un secreto ya guardado, y no
   se debe añadir. Una credencial que se puede leer desde la aplicación
   es una credencial que se puede exfiltrar con una sesión robada o un
   XSS. Se reemplaza y se borra; no se consulta.

   Cuando llegue el momento de USARLA contra ICOGAM, quien descifre
   tiene que ser la Edge Function que hace esa llamada —en el servidor,
   con el secreto en memoria y sin devolverlo al cliente—. Para eso está
   `descifrar()` exportada aquí abajo.

   ⛔ LA CLAVE DE CIFRADO

   Vive en la variable de entorno GESTOTRAFIC_CRED_KEY (32 bytes en
   base64) y NUNCA en la base de datos ni en el repositorio. Que la
   clave esté fuera de Postgres es lo que hace que un volcado de la base
   no baste para descifrar nada.

     openssl rand -base64 32
     supabase secrets set GESTOTRAFIC_CRED_KEY='...' --project-ref <ref>

   Si se pierde, los secretos guardados son irrecuperables: se vuelven a
   subir. Es el comportamiento correcto, no un fallo.

   Desplegar SIEMPRE con --no-verify-jwt: la función valida el JWT ella
   misma con getUser() y necesita responder al preflight CORS.
   ============================================================ */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRED_KEY = Deno.env.get('GESTOTRAFIC_CRED_KEY') || '';

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

const admin = () => createClient(URL_SB, SERVICE_KEY, { auth: { persistSession: false } });

/* Un .p12 de colegiado ronda los pocos KB. El tope existe para que un
   POST no pueda usarse para llenar la tabla. */
const MAX_CERT_BYTES = 256 * 1024;
const MAX_TEXTO = 4096;

/* ---------------- Cifrado ---------------- */

/** Clave AES-GCM a partir de la variable de entorno. */
async function claveAES(): Promise<CryptoKey> {
  if (!CRED_KEY) {
    throw new Error(
      'Falta GESTOTRAFIC_CRED_KEY: sin ella no se puede cifrar. ' +
      'Genera una con `openssl rand -base64 32` y ponla como secreto del proyecto.'
    );
  }
  const bruto = Uint8Array.from(atob(CRED_KEY), c => c.charCodeAt(0));
  if (bruto.length !== 32) throw new Error('GESTOTRAFIC_CRED_KEY debe ser de 32 bytes en base64');
  return crypto.subtle.importKey('raw', bruto, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * AES-256-GCM. Devuelve [IV de 12 bytes][ciphertext+tag] en base64, que es
 * lo que se guarda en la columna `bytea`.
 *
 * IV aleatorio por campo: reutilizarlo con GCM rompe la confidencialidad,
 * así que no se deriva ni se reaprovecha entre campos.
 */
async function cifrar(texto: Uint8Array): Promise<string> {
  const key = await claveAES();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, texto));
  const todo = new Uint8Array(iv.length + ct.length);
  todo.set(iv, 0);
  todo.set(ct, iv.length);
  return '\\x' + Array.from(todo).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Inversa de `cifrar`. NO se usa en esta función a propósito: aquí no se
 * devuelve nunca un secreto. La exporta para la futura Edge Function que
 * llame a ICOGAM, que descifrará en memoria y en el servidor.
 */
export async function descifrar(hex: string): Promise<Uint8Array> {
  const bytes = Uint8Array.from(
    (hex.startsWith('\\x') ? hex.slice(2) : hex).match(/.{2}/g)!.map(h => parseInt(h, 16))
  );
  const key = await claveAES();
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}

/** Últimos 4 caracteres, para reconocer una clave sin poder reconstruirla. */
const pista = (s: string) => (s.length <= 4 ? '····' : '····' + s.slice(-4));

/* ---------------- Identidad ---------------- */

/** Devuelve el perfil de quien llama, o lanza si la sesión no vale. */
async function quienLlama(req: Request, sb: ReturnType<typeof admin>) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Sesión no válida');

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) throw new Error('Sesión no válida');

  const { data: perfil } = await sb
    .from('gestotrafic_usuarios')
    .select('id, nombre, rol, activo')
    .eq('id', data.user.id)
    .single();

  if (!perfil || !perfil.activo) throw new Error('Sesión no válida');
  return perfil;
}

/** Como `quienLlama`, pero exige rol admin. */
async function exigirAdmin(req: Request, sb: ReturnType<typeof admin>) {
  const perfil = await quienLlama(req, sb);
  if (perfil.rol !== 'admin') {
    throw new Error('Solo un administrador puede gestionar las credenciales');
  }
  return perfil;
}

/* ---------------- Handler ---------------- */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const cuerpo = await req.json();
    const accion = cuerpo?.accion;
    const sb = admin();

    /* ---------- listo · gating, cualquier sesión ---------- */
    if (accion === 'listo') {
      await quienLlama(req, sb);
      const { data, error } = await sb.rpc('gestotrafic_credenciales_listo');
      if (error) throw new Error(error.message);
      return json({ listo: data === true });
    }

    /* ---------- estado · metadatos, solo admin ---------- */
    if (accion === 'estado') {
      await exigirAdmin(req, sb);
      const { data, error } = await sb.rpc('gestotrafic_credenciales_estado');
      if (error) throw new Error(error.message);
      // Sin fila todavía: nada configurado.
      const e = Array.isArray(data) ? data[0] : data;
      return json({
        estado: e ?? {
          cert_configurado: false,
          cert_pass_configurada: false,
          api_key_configurada: false,
          token_configurado: false,
          listo: false
        }
      });
    }

    /* ---------- guardar · solo admin ---------- */
    if (accion === 'guardar') {
      const perfil = await exigirAdmin(req, sb);

      const { cert_b64, cert_nombre, cert_pass, api_key, token } = cuerpo;
      const fila: Record<string, unknown> = {
        clave: 'icogam',
        actualizado_at: new Date().toISOString(),
        actualizado_por: perfil.id
      };

      if (cert_b64) {
        const bytes = Uint8Array.from(atob(cert_b64), c => c.charCodeAt(0));
        if (bytes.length > MAX_CERT_BYTES) {
          return json({ error: `El certificado supera ${MAX_CERT_BYTES / 1024} KB` }, 400);
        }
        if (!bytes.length) return json({ error: 'El certificado está vacío' }, 400);
        fila.cert_cifrado = await cifrar(bytes);
        fila.cert_nombre = String(cert_nombre || 'certificado').slice(0, 200);
        fila.cert_bytes = bytes.length;
        fila.cert_subido_at = new Date().toISOString();
      }

      const texto = async (v: unknown) => {
        const s = String(v).trim();
        if (!s) return null;
        if (s.length > MAX_TEXTO) throw new Error('El valor es demasiado largo');
        return { cifrado: await cifrar(new TextEncoder().encode(s)), pista: pista(s) };
      };

      if (cert_pass) {
        const r = await texto(cert_pass);
        if (r) fila.cert_pass_cifrada = r.cifrado;
      }
      if (api_key) {
        const r = await texto(api_key);
        if (r) { fila.api_key_cifrada = r.cifrado; fila.api_key_pista = r.pista; }
      }
      if (token) {
        const r = await texto(token);
        if (r) { fila.token_cifrado = r.cifrado; fila.token_pista = r.pista; }
      }

      if (Object.keys(fila).length <= 3) {
        return json({ error: 'No has enviado ninguna credencial que guardar' }, 400);
      }

      const { error } = await sb
        .from('gestotrafic_credenciales')
        .upsert(fila, { onConflict: 'clave' });
      if (error) throw new Error(error.message);

      // Se responde con el estado, nunca con lo guardado.
      const { data } = await sb.rpc('gestotrafic_credenciales_estado');
      return json({ ok: true, estado: Array.isArray(data) ? data[0] : data });
    }

    /* ---------- borrar · solo admin ---------- */
    if (accion === 'borrar') {
      const perfil = await exigirAdmin(req, sb);
      const PIEZAS: Record<string, Record<string, null>> = {
        certificado: { cert_cifrado: null, cert_nombre: null, cert_bytes: null, cert_subido_at: null, cert_pass_cifrada: null },
        api_key: { api_key_cifrada: null, api_key_pista: null },
        token: { token_cifrado: null, token_pista: null }
      };
      const campos = PIEZAS[String(cuerpo?.pieza)];
      if (!campos) return json({ error: 'Pieza desconocida' }, 400);

      const { error } = await sb
        .from('gestotrafic_credenciales')
        .update({ ...campos, actualizado_at: new Date().toISOString(), actualizado_por: perfil.id })
        .eq('clave', 'icogam');
      if (error) throw new Error(error.message);

      const { data } = await sb.rpc('gestotrafic_credenciales_estado');
      return json({ ok: true, estado: Array.isArray(data) ? data[0] : data });
    }

    return json({ error: 'Acción no reconocida' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado';
    // 403 para los cortes de permiso, 500 para lo demás.
    const status = /sesión|administrador/i.test(msg) ? 403 : 500;
    console.error('[gestotrafic-credenciales]', msg);
    return json({ error: msg }, status);
  }
});
