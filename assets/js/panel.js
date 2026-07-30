/* ============================================================
   GestoTrafic · Panel de gerencia · el CÁLCULO
   ------------------------------------------------------------
   Aquí no se pinta nada: se cuenta. La vista (app.js) recibe este
   modelo ya resuelto y lo dibuja, así que todo lo que decide un
   número se puede ejecutar en node y comprobar contra la base:

       node tools/verificar-panel.js

   ⛔ LA REGLA QUE MANDA AQUÍ · una métrica sin dato dice que no lo
   tiene. No devuelve 0, no devuelve una media de lo que hay «más o
   menos», no interpola.

   Un 0 y un «no se sabe» se pintan parecido y significan lo contrario:
   «0 días de media en documentación» es un equipo impecable, y lo que
   pasaba de verdad es que nadie había registrado todavía un cambio de
   estado. Por eso cada métrica que puede no tener respaldo viaja con
   `sinDatos: true` y un `motivo` en castellano, y la vista tiene que
   enseñar el motivo.

   DE DÓNDE SALE CADA COSA
   -----------------------
   · Altas, tipo de trámite, gestor, Gest-IA, honorarios
       → columnas del expediente. Datos de siempre.
   · Cuánto se tarda (tiempo medio, tiempos por estado, cierres)
       → gestotrafic_estado_historial, que lo escribe un trigger.
         `updated_at` NO sirve para esto: cambia al guardar cualquier
         cosa —los honorarios, el ITP— y usarlo daría tiempos cortos
         y creíbles que no ha medido nadie.

   LO QUE SE MIDE Y LO QUE NO
   --------------------------
   Las DURACIONES solo se calculan sobre expedientes de los que consta
   el alta (la fila con `estado_anterior === null`). De un expediente
   cuya historia empieza a la mitad se sabe lo que pasó desde entonces,
   pero no cuánto llevaba antes: meterlo en la media la acorta.

   Los CIERRES sí se cuentan todos —una fila «completado» es un cierre
   real, con alta registrada o sin ella—, pero si el historial empieza
   más tarde que el periodo se avisa de que los anteriores no constan.
   ============================================================ */
(function (global) {
  'use strict';

  const DIA_MS = 86400000;

  /* ------------------------------------------------------------
     Periodos
     ------------------------------------------------------------ */

  const PERIODOS = [
    { id: 'mes', label: 'Este mes' },
    { id: 'mes_ant', label: 'Mes anterior' },
    { id: 'trimestre', label: 'Este trimestre' }
  ];

  const inicioMes = (d, delta) => new Date(d.getFullYear(), d.getMonth() + (delta || 0), 1);
  const inicioTrim = (d, delta) =>
    new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3 * (delta || 0), 1);

  const etiquetaMes = (d) =>
    d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const etiquetaTrim = (d) => 'T' + (Math.floor(d.getMonth() / 3) + 1) + ' ' + d.getFullYear();

  /**
   * Ventana del periodo y la ventana anterior con la que se compara.
   *
   * Medio abiertas: `desde` incluido, `hasta` excluido. Con el mes cerrado por
   * ambos lados, un expediente dado de alta el día 1 a las 00:00 caería en dos
   * meses o en ninguno según cómo se escribiera la comparación.
   *
   * La ventana previa es siempre la equivalente inmediatamente anterior, para
   * que la variación compare periodos del mismo tipo: mes contra mes y
   * trimestre contra trimestre. Comparar un trimestre con un mes daría una
   * caída del 70% que solo existe en la aritmética.
   */
  function rango(periodoId, hoy) {
    const d = hoy ? new Date(hoy) : new Date();
    switch (periodoId) {
      case 'mes_ant':
        return {
          id: 'mes_ant',
          label: etiquetaMes(inicioMes(d, -1)),
          desde: inicioMes(d, -1), hasta: inicioMes(d, 0),
          previo: { desde: inicioMes(d, -2), hasta: inicioMes(d, -1), label: etiquetaMes(inicioMes(d, -2)) }
        };
      case 'trimestre':
        return {
          id: 'trimestre',
          label: etiquetaTrim(inicioTrim(d, 0)),
          desde: inicioTrim(d, 0), hasta: inicioTrim(d, 1),
          previo: { desde: inicioTrim(d, -1), hasta: inicioTrim(d, 0), label: etiquetaTrim(inicioTrim(d, -1)) }
        };
      default:
        return {
          id: 'mes',
          label: etiquetaMes(inicioMes(d, 0)),
          desde: inicioMes(d, 0), hasta: inicioMes(d, 1),
          previo: { desde: inicioMes(d, -1), hasta: inicioMes(d, 0), label: etiquetaMes(inicioMes(d, -1)) }
        };
    }
  }

  /* ------------------------------------------------------------
     Utilidades
     ------------------------------------------------------------ */

  const aFecha = (v) => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(+d) ? null : d;
  };

  /** ¿Cae la fecha dentro de la ventana [desde, hasta)? */
  const dentro = (v, r) => {
    const d = aFecha(v);
    return !!d && d >= r.desde && d < r.hasta;
  };

  /** Número utilizable, o `null`. Una cadena vacía no es un cero. */
  function numero(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  const leer = (exp, campo) => {
    const T = global.GTTramites;
    if (T && T.leer) return T.leer(exp, campo);
    if (!exp) return null;
    if (exp[campo] !== undefined && exp[campo] !== null) return exp[campo];
    return (exp.datos && exp.datos[campo] !== undefined) ? exp.datos[campo] : null;
  };

  const media = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const dias = (desde, hasta) => (hasta - desde) / DIA_MS;
  /** Un día no se parte: se redondea a una décima, que es lo que se enseña. */
  const decima = (n) => n === null ? null : Math.round(n * 10) / 10;
  const centimos = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  /* ------------------------------------------------------------
     Variación contra el periodo anterior
     ------------------------------------------------------------ */

  /**
   * Δ entre dos valores.
   *
   * `pct` es `null` cuando el periodo anterior valía 0: un aumento «infinito»
   * no es un porcentaje, y pintar +100% cuando se ha pasado de 0 a 7 dice algo
   * distinto de lo que pasó. En ese caso queda la diferencia absoluta, que sí
   * es cierta.
   *
   * `bueno` traduce la dirección a si es una buena noticia, porque no siempre
   * es la misma: más expedientes es mejor, más días de tramitación es peor.
   * `mejorSi` lo declara cada métrica.
   */
  function delta(actual, previo, mejorSi) {
    if (actual === null || previo === null) return null;
    const abs = centimos(actual - previo);
    const pct = previo === 0 ? null : Math.round((actual - previo) / Math.abs(previo) * 1000) / 10;
    const dir = abs > 0 ? 'sube' : (abs < 0 ? 'baja' : 'igual');
    return {
      abs, pct, dir,
      previo,
      bueno: dir === 'igual' ? null : (dir === (mejorSi || 'sube'))
    };
  }

  /* ------------------------------------------------------------
     Historial · recorrido de cada expediente
     ------------------------------------------------------------ */

  /** Historial agrupado por expediente y ordenado en el tiempo. */
  function porExpediente(historial) {
    const mapa = new Map();
    (historial || []).forEach(fila => {
      const f = aFecha(fila.created_at);
      if (!f) return;
      if (!mapa.has(fila.expediente_id)) mapa.set(fila.expediente_id, []);
      mapa.get(fila.expediente_id).push({
        estado: fila.estado,
        anterior: fila.estado_anterior === undefined ? null : fila.estado_anterior,
        gestor_id: fila.gestor_id || null,
        fecha: f
      });
    });
    mapa.forEach(filas => filas.sort((a, b) => a.fecha - b.fecha));
    return mapa;
  }

  /**
   * Tramos de estancia de un expediente: cada estado por el que pasó y cuánto
   * duró. El último tramo está ABIERTO si el expediente sigue ahí, y se mide
   * hasta hoy — un expediente lleva veinte días atascado en documentación
   * mientras está atascado, no cuando por fin sale.
   *
   * `completado` no genera tramo: no se sale de él, así que su duración sería
   * «lo que lleve archivado», que no es tiempo de trabajo de nadie.
   */
  function tramos(filas, hoy) {
    const out = [];
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i];
      if (f.estado === 'completado') continue;
      const fin = filas[i + 1] ? filas[i + 1].fecha : hoy;
      if (fin < f.fecha) continue;
      out.push({
        estado: f.estado,
        gestor_id: f.gestor_id,
        desde: f.fecha,
        dias: dias(f.fecha, fin),
        abierto: !filas[i + 1]
      });
    }
    return out;
  }

  /** ¿Consta el alta? Sin ella no se sabe cuándo entró: no se mide su duración. */
  const constaAlta = (filas) => !!(filas && filas.length && filas[0].anterior === null);

  /** Momento en que se cerró, o `null` si sigue abierto. */
  function cierre(filas) {
    for (let i = filas.length - 1; i >= 0; i--) if (filas[i].estado === 'completado') return filas[i].fecha;
    return null;
  }

  /* ------------------------------------------------------------
     Serie diaria para la mini-tendencia
     ------------------------------------------------------------ */

  /**
   * Un punto por día del periodo, hasta hoy.
   *
   * Se corta en hoy a propósito: rellenar lo que queda de mes con ceros dibuja
   * una caída a plomo que no ha ocurrido — es que el mes no ha terminado.
   */
  function serie(expedientes, r, hoy, valor) {
    const fin = new Date(Math.min(+r.hasta, +new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1)));
    if (fin <= r.desde) return [];
    const n = Math.max(1, Math.ceil(dias(r.desde, fin)));
    const puntos = new Array(n).fill(0);
    expedientes.forEach(e => {
      const f = aFecha(e.created_at);
      if (!f || f < r.desde || f >= fin) return;
      const i = Math.min(n - 1, Math.floor(dias(r.desde, f)));
      puntos[i] += valor(e);
    });
    return puntos.map(v => centimos(v));
  }

  /* ------------------------------------------------------------
     Alertas accionables
     ------------------------------------------------------------ */

  /** Días que se dejan pasar antes de reclamar un documento obligatorio. */
  const DIAS_DOC_PENDIENTE = 5;

  const PARTES_DNI = ['titular', 'vendedor', 'comprador'];

  /**
   * Lo que hay que hacer HOY, con nombre y apellidos.
   *
   * No se filtra por periodo: un DNI caducado no deja de estarlo porque haya
   * cambiado el mes. Sí respeta los filtros de gestor y de trámite, que es
   * quien mira el panel acotando su trabajo.
   *
   * Ninguna de las cuatro reglas se escribe aquí: se preguntan a los módulos
   * que ya las tienen —`GTServicio`, `GTValidaciones`, el catálogo de
   * trámites—, para que el panel no sea una segunda opinión que se desvía.
   */
  function alertas(expedientes, docsPorExp, hoy) {
    const T = global.GTTramites;
    const S = global.GTServicio;
    const V = global.GTValidaciones;

    const servicio = [], dniCaducado = [], docPendiente = [], validacion = [];

    expedientes.forEach(e => {
      const tr = T ? T.tramite(e.tipo_tramite) : null;
      const base = {
        id: e.id,
        referencia: e.referencia,
        gestor: e.gestor ? e.gestor.nombre : null,
        estado: e.estado
      };

      // 1 · Bloqueado por cambio de servicio (la regla es por CÓDIGO, no por
      //     etiqueta: la decide servicio.js, aquí solo se recoge).
      if (S) {
        const r = S.evaluar(e);
        if (r.bloqueado) servicio.push(Object.assign({ texto: r.aviso, motivo: r.motivo }, base));
      }

      // 2 · DNI caducado. Una empresa no tiene DNI que caduque: si la parte
      //     firma como empresa, una caducidad que quedara en `datos` de antes
      //     no es suya y no se reclama.
      PARTES_DNI.forEach(parte => {
        if (String(leer(e, parte + '_tipo') || '') === 'empresa') return;
        const f = aFecha(leer(e, parte + '_caducidad_nif'));
        if (f && f < hoy) {
          dniCaducado.push(Object.assign({
            parte,
            fecha: f,
            texto: 'El DNI del ' + parte + ' caducó el ' + f.toLocaleDateString('es-ES') + '.'
          }, base));
        }
      });

      // 3 · Documentación obligatoria que no llega. Se cuenta desde el alta, y
      //     un expediente ya completado no se reclama.
      if (tr && T && e.estado !== 'completado') {
        const alta = aFecha(e.created_at);
        const antiguedad = alta ? dias(alta, hoy) : 0;
        if (antiguedad > DIAS_DOC_PENDIENTE) {
          const tenemos = new Set((docsPorExp[e.id] || []).map(d => d.tipo));
          const faltan = T.docsDe(tr, e).filter(d => d.obligatorio && !tenemos.has(d.tipo));
          if (faltan.length) {
            docPendiente.push(Object.assign({
              dias: decima(antiguedad),
              faltan: faltan.map(d => d.label),
              texto: 'Lleva ' + Math.floor(antiguedad) + ' días sin '
                + (faltan.length === 1 ? faltan[0] : faltan.length + ' documentos obligatorios') + '.'
            }, base));
          }
        }
      }

      // 4 · Lo que no cuadra en los datos. Son AVISOS: no corrigen nada y
      //     no dicen cuál sería el valor bueno.
      if (tr && V) {
        const avisos = V.revisar(e, tr);
        if (avisos.length) {
          validacion.push(Object.assign({
            n: avisos.length,
            avisos: avisos.map(a => a.texto),
            texto: avisos.length === 1 ? avisos[0].texto : avisos.length + ' datos que no cuadran.'
          }, base));
        }
      }
    });

    const orden = (a, b) => String(a.referencia).localeCompare(String(b.referencia));
    [servicio, dniCaducado, docPendiente, validacion].forEach(l => l.sort(orden));

    return {
      servicio, dniCaducado, docPendiente, validacion,
      total: servicio.length + dniCaducado.length + docPendiente.length + validacion.length
    };
  }

  /* ------------------------------------------------------------
     El panel entero
     ------------------------------------------------------------ */

  /**
   * @param {object} d
   *   expedientes · los que el RLS haya dejado ver (con `gestor` embebido)
   *   historial   · filas de gestotrafic_estado_historial de esos expedientes
   *   documentos  · filas de gestotrafic_documentos (id, expediente_id, tipo)
   *   usuarios    · gestores visibles
   *   periodo     · 'mes' | 'mes_ant' | 'trimestre'
   *   filtros     · { gestor: id|'', tipo: id|'' }
   *   hoy         · Date (inyectable para poder verificar)
   */
  function calcular(d) {
    const hoy = d.hoy ? new Date(d.hoy) : new Date();
    const r = rango(d.periodo, hoy);
    const filtros = d.filtros || {};
    const todos = d.expedientes || [];

    // Los filtros se aplican ANTES de contar nada: todo lo que sale del panel
    // habla del mismo conjunto de expedientes.
    const exps = todos.filter(e =>
      (!filtros.gestor || e.gestor_id === filtros.gestor) &&
      (!filtros.tipo || e.tipo_tramite === filtros.tipo));

    const hist = porExpediente(d.historial);
    const docsPorExp = {};
    (d.documentos || []).forEach(doc => {
      (docsPorExp[doc.expediente_id] = docsPorExp[doc.expediente_id] || []).push(doc);
    });

    const delPeriodo = exps.filter(e => dentro(e.created_at, r));
    const delPrevio = exps.filter(e => dentro(e.created_at, r.previo));

    /* ---- Desde cuándo hay historial ----
       Si empezó más tarde que el periodo, los cierres anteriores a esa fecha
       no constan en ningún sitio. No invalida el recuento, pero hay que
       decirlo: un «3 cierres» sobre un historial que empezó anteayer se lee
       como si fueran los únicos tres del mes. */
    let inicioHistorial = null;
    (d.historial || []).forEach(f => {
      const x = aFecha(f.created_at);
      if (x && (!inicioHistorial || x < inicioHistorial)) inicioHistorial = x;
    });
    const historialParcial = !inicioHistorial || inicioHistorial > r.desde;

    /* ---- Facturación ----
       Honorarios SIN IVA: el IVA se repercute y se ingresa en Hacienda, no es
       facturación de la gestoría. Y NO se suma el ITP ni la tasa DGT, que son
       impuesto y suplido: dinero del cliente que solo pasa por caja, y que
       sumado aquí inflaría la facturación con lo que se le debe a otro.

       Quién es «los honorarios» de un expediente lo decide `GTHonorarios`, que
       es de donde sale la factura: si el panel lo leyera por su cuenta serían
       dos cifras que pueden separarse. */
    const honorariosDe = (e) => {
      const H = global.GTHonorarios;
      return H ? H.calcular(e).honorarios : numero(leer(e, 'honorarios'));
    };
    const honorarios = (e) => honorariosDe(e) || 0;
    const sumaHonorarios = (lista) => centimos(lista.reduce((a, e) => a + honorarios(e), 0));
    const conHonorarios = (lista) => lista.filter(e => honorariosDe(e) !== null).length;

    /* ---- Tiempo medio de tramitación ----
       Alta → cierre, y solo de los expedientes cerrados DENTRO del periodo de
       los que consta el alta. */
    function tiempoMedio(lista, ventana) {
      const medibles = [];
      let cerradosSinAlta = 0;
      lista.forEach(e => {
        const filas = hist.get(e.id);
        if (!filas) return;
        const fin = cierre(filas);
        if (!fin || fin < ventana.desde || fin >= ventana.hasta) return;
        if (!constaAlta(filas)) { cerradosSinAlta++; return; }
        medibles.push(dias(filas[0].fecha, fin));
      });
      return { valor: decima(media(medibles)), n: medibles.length, cerradosSinAlta };
    }

    /** Cierres registrados en la ventana, consten o no de alta. */
    function cierres(lista, ventana) {
      let n = 0;
      lista.forEach(e => {
        const filas = hist.get(e.id);
        if (!filas) return;
        filas.forEach(f => {
          if (f.estado === 'completado' && f.fecha >= ventana.desde && f.fecha < ventana.hasta) n++;
        });
      });
      return n;
    }

    const pctIa = (lista) => lista.length
      ? Math.round(lista.filter(e => !!e.ia_estado).length / lista.length * 1000) / 10
      : null;

    const tmAhora = tiempoMedio(exps, r);
    const tmAntes = tiempoMedio(exps, r.previo);

    /* ---- KPI cards ----
       `sinDatos` no es decorativo: la vista NO debe pintar el valor cuando
       está puesto, porque el valor en ese caso es `null` y un `null` formateado
       acaba siendo un «0». */
    const kpis = {
      nuevos: {
        etiqueta: 'Expedientes nuevos',
        valor: delPeriodo.length,
        formato: 'entero',
        delta: delta(delPeriodo.length, delPrevio.length, 'sube'),
        serie: serie(delPeriodo, r, hoy, () => 1),
        sinDatos: false,
        nota: 'dados de alta en el periodo'
      },
      tiempoMedio: {
        etiqueta: 'Tiempo medio de tramitación',
        valor: tmAhora.valor,
        formato: 'dias',
        // Menos días es mejor: la variación se colorea al revés que las demás.
        delta: delta(tmAhora.valor, tmAntes.valor, 'baja'),
        serie: [],
        sinDatos: tmAhora.valor === null,
        motivo: tmAhora.cerradosSinAlta
          ? 'Se cerraron ' + tmAhora.cerradosSinAlta + ' expediente(s) en el periodo, pero de '
            + 'ninguno consta el alta en el historial: no se sabe cuándo empezaron.'
          : 'Ningún expediente con alta registrada se ha cerrado en el periodo. '
            + 'El historial de estados se escribe desde que existe la tabla; hasta que '
            + 'un expediente lo recorra entero no hay duración que medir.',
        nota: tmAhora.n ? 'del alta al cierre · ' + tmAhora.n + ' expediente(s)' : null
      },
      facturacion: {
        etiqueta: 'Facturación',
        valor: sumaHonorarios(delPeriodo),
        formato: 'euros',
        delta: delta(sumaHonorarios(delPeriodo), sumaHonorarios(delPrevio), 'sube'),
        serie: serie(delPeriodo, r, hoy, honorarios),
        // Sin un solo expediente con honorarios, el 0 € es «nadie los ha
        // puesto todavía», no «este mes no se ha facturado».
        sinDatos: conHonorarios(delPeriodo) === 0,
        motivo: 'Ningún expediente del periodo tiene honorarios registrados. '
          + 'Se ponen en la pestaña de honorarios de cada expediente.',
        nota: 'honorarios sin IVA · ' + conHonorarios(delPeriodo) + ' de ' + delPeriodo.length + ' expedientes'
      },
      gestia: {
        etiqueta: 'Altas con Gest-IA',
        valor: pctIa(delPeriodo),
        formato: 'pct',
        delta: delta(pctIa(delPeriodo), pctIa(delPrevio), 'sube'),
        serie: serie(delPeriodo, r, hoy, (e) => e.ia_estado ? 1 : 0),
        sinDatos: delPeriodo.length === 0,
        motivo: 'No hay expedientes en el periodo sobre los que calcular el porcentaje.',
        nota: delPeriodo.length
          ? delPeriodo.filter(e => !!e.ia_estado).length + ' de ' + delPeriodo.length + ' leídos por Gest-IA'
          : null
      }
    };

    /* ---- Embudo por estado ----
       De los expedientes del PERIODO, en qué estado están HOY. No es el
       recorrido histórico: es dónde ha quedado cada uno. */
    const maxEstado = Math.max(1, ...(global.GT_ESTADOS || []).map(
      es => delPeriodo.filter(e => e.estado === es.id).length));
    const embudo = (global.GT_ESTADOS || []).map(es => {
      const n = delPeriodo.filter(e => e.estado === es.id).length;
      return {
        id: es.id, label: es.label, color: es.color, n,
        pct: delPeriodo.length ? Math.round(n / delPeriodo.length * 1000) / 10 : 0,
        rel: n / maxEstado
      };
    });

    /* ---- Por tipo de trámite ---- */
    const tiposTodos = (global.GT_TRAMITES || []).map(tr => ({
      id: tr.id, label: tr.corto || tr.nombre,
      n: delPeriodo.filter(e => e.tipo_tramite === tr.id).length
    }));
    const maxTipo = Math.max(1, ...tiposTodos.map(t => t.n));
    const tipos = tiposTodos
      .filter(t => t.n > 0)
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
      .map(t => Object.assign({ rel: t.n / maxTipo }, t));

    /* ---- Tabla por agente ----
       «Activos» es una foto de HOY y no lleva periodo: lo que un gestor tiene
       encima de la mesa ahora mismo no depende del mes que se esté mirando.
       Todo lo demás sí es del periodo.

       LA TABLA TIENE QUE SUMAR EL TOTAL. Un expediente sin `gestor_id`, o
       asignado a un usuario que ya no está en la lista —dado de baja, borrado—,
       no puede caerse de aquí en silencio: quien compare la columna «nuevos»
       con el indicador de arriba encontraría una diferencia sin explicación, y
       lo natural es pensar que el indicador está mal. Por eso los huérfanos
       tienen su propia fila, con nombre, en vez de desaparecer.

       Los gestores DESACTIVADOS que todavía tienen trabajo también salen: el
       expediente sigue existiendo aunque su gestor ya no entre. Lo que se
       filtra al final son las filas vacías, no las personas. */
    const usuarios = d.usuarios || [];
    const conocidos = new Set(usuarios.map(u => u.id));
    const huerfanos = exps.filter(e => !conocidos.has(e.gestor_id));

    const fila = (id, nombre, extra) => {
      const suyos = id === null ? huerfanos : exps.filter(e => e.gestor_id === id);
      const suyosPeriodo = suyos.filter(e => dentro(e.created_at, r));
      const tm = tiempoMedio(suyos, r);
      return Object.assign({
        id: id,
        nombre: nombre,
        activos: suyos.filter(e => e.estado !== 'completado').length,
        nuevos: suyosPeriodo.length,
        cerrados: cierres(suyos, r),
        tiempoMedio: tm.valor,
        tiempoMedioN: tm.n,
        pctIa: pctIa(suyosPeriodo),
        facturado: sumaHonorarios(suyosPeriodo),
        conHonorarios: conHonorarios(suyosPeriodo)
      }, extra || {});
    };

    const agentes = usuarios
      .map(u => fila(u.id, u.nombre, { rol: u.rol, inactivo: u.activo === false }))
      .concat(huerfanos.length ? [fila(null, 'Sin asignar', { huerfano: true })] : [])
      .filter(a => a.activos || a.nuevos || a.cerrados)
      .sort((a, b) => b.nuevos - a.nuevos || b.activos - a.activos || a.nombre.localeCompare(b.nombre));

    /* ---- Tiempos por estado · dónde se atasca ----
       Solo expedientes del periodo de los que consta el alta: de esos se
       conoce el recorrido entero y ningún tramo falta. */
    const conRecorrido = delPeriodo.filter(e => constaAlta(hist.get(e.id)));
    const porEstado = {};
    let abiertos = 0;
    conRecorrido.forEach(e => {
      tramos(hist.get(e.id), hoy).forEach(t => {
        (porEstado[t.estado] = porEstado[t.estado] || []).push(t.dias);
        if (t.abierto) abiertos++;
      });
    });
    const estadosMedidos = (global.GT_ESTADOS || [])
      .filter(es => es.id !== 'completado')
      .map(es => ({
        id: es.id, label: es.label, color: es.color,
        dias: decima(media(porEstado[es.id] || [])),
        n: (porEstado[es.id] || []).length
      }));
    const conDias = estadosMedidos.filter(e => e.dias !== null);
    const maxDias = conDias.length ? Math.max(...conDias.map(e => e.dias)) : 0;
    const tiempos = {
      sinDatos: conDias.length === 0,
      motivo: 'Ningún expediente del periodo tiene el alta registrada en el historial de '
        + 'estados. Los tiempos por estado se miden desde que el trigger existe: en cuanto '
        + 'los expedientes nuevos empiecen a moverse, esta gráfica se llena sola.',
      estados: estadosMedidos.map(e => Object.assign({
        rel: maxDias > 0 && e.dias !== null ? e.dias / maxDias : 0,
        cuello: e.dias !== null && maxDias > 0 && e.dias === maxDias
      }, e)),
      expedientes: conRecorrido.length,
      abiertos,
      cuello: conDias.length ? conDias.reduce((a, b) => b.dias > a.dias ? b : a).id : null
    };

    return {
      rango: r,
      esAdmin: !!d.esAdmin,
      filtros: { gestor: filtros.gestor || '', tipo: filtros.tipo || '' },
      totales: {
        visibles: exps.length,
        periodo: delPeriodo.length,
        gestores: agentes.length
      },
      historial: {
        filas: (d.historial || []).length,
        desde: inicioHistorial,
        parcial: historialParcial
      },
      kpis,
      embudo,
      tipos,
      agentes,
      tiempos,
      alertas: alertas(exps, docsPorExp, hoy)
    };
  }

  global.GTPanel = {
    PERIODOS: PERIODOS,
    DIAS_DOC_PENDIENTE: DIAS_DOC_PENDIENTE,
    rango: rango,
    delta: delta,
    tramos: tramos,
    porExpediente: porExpediente,
    alertas: alertas,
    calcular: calcular
  };
})(typeof window !== 'undefined' ? window : globalThis);
