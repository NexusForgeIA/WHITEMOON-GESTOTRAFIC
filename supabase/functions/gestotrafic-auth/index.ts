/* ============================================================
   GestoTrafic · gestotrafic-auth
   ------------------------------------------------------------
   Autenticación del CRM. Tres acciones:

     login   · verifica usuario + contraseña contra
               gestotrafic_usuarios.password_hash (bcrypt, pgcrypto)
               y devuelve una sesión de Supabase real.
     crear   · alta de gestor. Solo admin. Hashea la contraseña.
     clave   · cambio de contraseña de un gestor. Solo admin.

   Por qué hay una sesión de Supabase detrás: el RLS de
   gestotrafic_expedientes se apoya en auth.uid(), que es lo que hace
   que el aislamiento entre gestores lo imponga el servidor y no el
   navegador. La contraseña la seguimos verificando nosotros con
   bcrypt; auth.users solo aporta el JWT firmado de la sesión.

   La contraseña nunca viaja fuera de esta función: el hash se calcula
   y se compara con funciones SECURITY DEFINER que solo puede ejecutar
   el service_role.
   ============================================================ */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

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

const admin = () => createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Correo interno del usuario: solo existe para sostener la sesión. */
const correo = (usuario: string) => `${usuario.trim().toLowerCase()}@gestotrafic.demo`;

/** Emite una sesión de Supabase sin conocer la contraseña de auth.users. */
async function emitirSesion(sb: ReturnType<typeof admin>, email: string) {
  const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error('No se pudo emitir la sesión: ' + error.message);

  const publico = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const verificado = await publico.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: 'email'
  });
  if (verificado.error) throw new Error('No se pudo emitir la sesión: ' + verificado.error.message);
  return verificado.data.session;
}

/** Identifica a quien llama a partir de su JWT y exige que sea admin. */
async function exigirAdmin(req: Request, sb: ReturnType<typeof admin>) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Sesión no válida');

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) throw new Error('Sesión no válida');

  const { data: perfil } = await sb
    .from('gestotrafic_usuarios')
    .select('id, rol, activo')
    .eq('id', data.user.id)
    .single();

  if (!perfil || !perfil.activo || perfil.rol !== 'admin') {
    throw new Error('Solo un administrador puede hacer esto');
  }
  return perfil;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { accion, usuario, password, nombre, rol } = await req.json();
    const sb = admin();

    /* ---------------- login ---------------- */
    if (accion === 'login') {
      if (!usuario || !password) return json({ error: 'Faltan usuario y contraseña' }, 400);

      const { data: filas, error } = await sb.rpc('gestotrafic_verificar_credenciales', {
        p_usuario: String(usuario),
        p_password: String(password)
      });
      if (error) return json({ error: 'No se pudo verificar: ' + error.message }, 500);

      const u = Array.isArray(filas) ? filas[0] : filas;
      // Mismo mensaje para usuario inexistente, inactivo o contraseña mala:
      // no se le dice a nadie qué usuarios existen.
      if (!u) return json({ error: 'Usuario o contraseña incorrectos' }, 401);

      const session = await emitirSesion(sb, u.email);
      return json({
        session,
        perfil: { id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol }
      });
    }

    /* ---------------- crear gestor (solo admin) ---------------- */
    if (accion === 'crear') {
      await exigirAdmin(req, sb);

      const login = String(usuario || '').trim().toLowerCase();
      if (!nombre || !login || !password) return json({ error: 'Faltan nombre, usuario o contraseña' }, 400);
      if (!/^[a-z0-9._-]{3,32}$/.test(login)) {
        return json({ error: 'El usuario admite 3-32 caracteres: letras, números, punto, guion y guion bajo' }, 400);
      }
      if (String(password).length < 4) return json({ error: 'La contraseña es demasiado corta' }, 400);

      const rolFinal = rol === 'admin' ? 'admin' : 'gestor';
      const email = correo(login);

      const { data: yaExiste } = await sb
        .from('gestotrafic_usuarios').select('id').eq('usuario', login).maybeSingle();
      if (yaExiste) return json({ error: 'Ya existe un usuario con ese nombre de acceso' }, 409);

      // 1 · usuario de auth (soporte de sesión, con contraseña interna aleatoria)
      const { data: creado, error: errAuth } = await sb.auth.admin.createUser({
        email,
        password: crypto.randomUUID() + crypto.randomUUID(),
        email_confirm: true
      });
      if (errAuth || !creado.user) return json({ error: 'No se pudo crear el usuario: ' + (errAuth?.message || '') }, 500);

      // 2 · hash bcrypt de la contraseña real
      const { data: hash, error: errHash } = await sb.rpc('gestotrafic_hash_password', {
        p_password: String(password)
      });
      if (errHash) {
        await sb.auth.admin.deleteUser(creado.user.id);
        return json({ error: 'No se pudo cifrar la contraseña' }, 500);
      }

      // 3 · perfil
      const { data: perfil, error: errPerfil } = await sb
        .from('gestotrafic_usuarios')
        .insert({ id: creado.user.id, nombre, usuario: login, email, password_hash: hash, rol: rolFinal })
        .select('id, nombre, usuario, rol, activo, created_at')
        .single();

      if (errPerfil) {
        await sb.auth.admin.deleteUser(creado.user.id);   // sin perfil no queda usuario huérfano
        return json({ error: 'No se pudo crear el gestor: ' + errPerfil.message }, 500);
      }

      return json({ usuario: perfil });
    }

    /* ---------------- cambiar contraseña (solo admin) ---------------- */
    if (accion === 'clave') {
      await exigirAdmin(req, sb);
      if (!usuario || !password) return json({ error: 'Faltan usuario y contraseña' }, 400);
      if (String(password).length < 4) return json({ error: 'La contraseña es demasiado corta' }, 400);

      const { data: hash, error: errHash } = await sb.rpc('gestotrafic_hash_password', {
        p_password: String(password)
      });
      if (errHash) return json({ error: 'No se pudo cifrar la contraseña' }, 500);

      const { error } = await sb
        .from('gestotrafic_usuarios')
        .update({ password_hash: hash, updated_at: new Date().toISOString() })
        .eq('id', usuario);
      if (error) return json({ error: error.message }, 500);

      return json({ ok: true });
    }

    return json({ error: 'Acción no reconocida' }, 400);

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error inesperado' }, 400);
  }
});
