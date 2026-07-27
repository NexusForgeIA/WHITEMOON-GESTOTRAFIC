/* ============================================================
   GestoTrafic · gestotrafic-borrar-expediente
   ------------------------------------------------------------
   Borra un expediente ENTERO: sus archivos, sus filas de
   documentos y el expediente. En ese orden, que no es opcional.

   POR QUÉ EL ORDEN IMPORTA
   La política del bucket autoriza el borrado comprobando que el
   expediente existe:

       exists (select 1 from gestotrafic_expedientes e
               where e.id::text = (storage.foldername(name))[1] ...)

   Borrar primero el expediente hace dos cosas a la vez: la FK en
   cascada se lleva las filas de `gestotrafic_documentos` —y con
   ellas el único registro de qué archivo era cuál— y la política
   deja de autorizar nada sobre esa carpeta. Los ficheros se quedan
   ahí, huérfanos y sin llave. Por eso los objetos van PRIMERO.

   Y si el borrado de los objetos falla, se para: mejor un
   expediente entero que se puede reintentar que medio expediente
   que ya no se puede arreglar.

   QUIÉN PUEDE
   El admin, cualquiera. Un gestor, solo los suyos. Es el mismo
   criterio que el RLS de `gestotrafic_expedientes`, comprobado
   aquí otra vez porque esta función usa el service_role y el RLS
   no la frena.
   ============================================================ */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BUCKET = 'gestotrafic-docs';
const PAGINA = 100;                      // tamaño de página al listar la carpeta

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const sb = createClient(URL_SB, SERVICE_KEY, { auth: { persistSession: false } });

    /** Todos los objetos de la carpeta del expediente, paginando. */
    const listarCarpeta = async (carpeta: string): Promise<string[]> => {
      const nombres: string[] = [];
      for (let desde = 0; ; desde += PAGINA) {
        const { data, error } = await sb.storage.from(BUCKET)
          .list(carpeta, { limit: PAGINA, offset: desde });
        if (error) throw new Error('No se pudo listar la carpeta del expediente: ' + error.message);
        if (!data || !data.length) break;
        for (const o of data) nombres.push(o.name);
        if (data.length < PAGINA) break;
      }
      return nombres;
    };

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

    const { expediente_id } = await req.json();
    if (!expediente_id) return json({ error: 'Falta el expediente' }, 400);

    // 2 · Suyo o de nadie. El admin sí puede con cualquiera.
    const { data: exp } = await sb
      .from('gestotrafic_expedientes')
      .select('id, referencia, gestor_id')
      .eq('id', expediente_id)
      .maybeSingle();
    if (!exp) return json({ error: 'El expediente no existe' }, 404);
    if (perfil.rol !== 'admin' && exp.gestor_id !== perfil.id) {
      return json({ error: 'Ese expediente no está asignado a tu usuario' }, 403);
    }

    /* 3 · Los objetos, con el expediente todavía en pie. Se listan de la
       carpeta, no de las filas: así caen también los que no tengan fila
       —restos de versiones anteriores— y la carpeta queda vacía de verdad. */
    const nombres = await listarCarpeta(expediente_id);
    let objetosBorrados = 0;

    if (nombres.length) {
      const rutas = nombres.map(n => `${expediente_id}/${n}`);
      const { data: quitados, error: errStorage } = await sb.storage.from(BUCKET).remove(rutas);
      if (errStorage) {
        return json({
          error: 'No se pudieron borrar los archivos: ' + errStorage.message,
          detalle: 'No se ha borrado nada más. El expediente sigue completo y se puede reintentar.'
        }, 500);
      }
      objetosBorrados = (quitados || []).length;

      /* Se comprueba que la carpeta ha quedado vacía ANTES de seguir. Sin esto
         un borrado a medias pasaría desapercibido y dejaría exactamente los
         huérfanos que esta función existe para evitar. */
      const quedan = await listarCarpeta(expediente_id);
      if (quedan.length) {
        return json({
          error: `Quedan ${quedan.length} archivo(s) en el bucket sin borrar.`,
          detalle: 'No se ha tocado el expediente: inténtalo otra vez.',
          pendientes: quedan
        }, 500);
      }
    }

    /* 4 · Las filas de documentos, explícitamente. La FK las borraría en
       cascada con el expediente, pero se hace aquí y por separado para poder
       contarlas y para que un fallo se vea en su sitio. */
    const { data: filas, error: errDocs } = await sb
      .from('gestotrafic_documentos')
      .delete()
      .eq('expediente_id', expediente_id)
      .select('id');
    if (errDocs) {
      return json({
        error: 'No se pudieron borrar los documentos: ' + errDocs.message,
        detalle: `Los ${objetosBorrados} archivos ya se borraron del bucket; el expediente sigue existiendo.`
      }, 500);
    }

    // 5 · Y el expediente.
    const { error: errExp } = await sb
      .from('gestotrafic_expedientes')
      .delete()
      .eq('id', expediente_id);
    if (errExp) {
      return json({
        error: 'No se pudo borrar el expediente: ' + errExp.message,
        detalle: 'Sus archivos y documentos ya se borraron.'
      }, 500);
    }

    return json({
      referencia: exp.referencia,
      objetos_borrados: objetosBorrados,
      filas_borradas: (filas || []).length,
      borrado_at: new Date().toISOString()
    });

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error inesperado' }, 500);
  }
});
