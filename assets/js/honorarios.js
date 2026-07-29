/* ============================================================
   GestoTrafic · Honorarios de la gestoría y total al cliente
   ------------------------------------------------------------
   Lo que el cliente PAGA no es lo que se liquida a Hacienda. En una
   transferencia hay tres conceptos que van juntos en la misma factura y
   tributan distinto:

     · ITP        — impuesto. Lo paga el comprador. SIN IVA.
     · Tasa DGT   — SUPLIDO: la gestoría lo adelanta en nombre del
                    cliente y se lo repercute tal cual. SIN IVA.
     · Honorarios — el servicio de la gestoría. CON IVA (21%).

   ⛔ LA REGLA QUE MANDA AQUÍ · el IVA se aplica SOLO a los honorarios.

   No es una preferencia de presentación: un suplido no forma parte de la
   base imponible del IVA (art. 78.Tres.3.º LIVA), y un impuesto no se
   grava con otro impuesto. Meter la tasa DGT o el ITP en la base del IVA
   le cobra al cliente un dinero que no debe y deja una factura mal
   emitida. Por eso el IVA se calcula sobre `honorarios` y sobre nada más,
   y esa multiplicación está en UN solo sitio: `calcular()`.

   ⛔ ANTI-INVENCIÓN · el ITP y la tasa NO se recalculan aquí. Se leen del
   expediente, que es donde los dejó el motor `gestotrafic-itp`. Si no se
   ha calculado el ITP, este módulo lo dice y suma lo que hay — nunca
   rellena un hueco con una cifra plausible.
   ============================================================ */
(function (global) {
  'use strict';

  /** Tipo general de IVA en España. Editable en la ficha por si un caso
      concreto lo requiere (Canarias liquida IGIC, y hay reducidos). */
  const IVA_DEFECTO = 21;

  /* Los importes se redondean a céntimo. En euros no existe la milésima:
     dejarla arrastrarse hace que la suma de las líneas no cuadre con el
     total impreso, y eso en una factura es un descuadre que hay que
     explicar. Se redondea cada línea y el total es la suma de las líneas
     ya redondeadas, que es como se emite una factura. */
  const centimos = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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

  /**
   * El desglose que se le enseña —y se le cobra— al cliente.
   *
   * @param exp expediente completo (con sus columnas y su `datos`)
   * @returns {{
   *   itp:number|null, tasaDgt:number|null, honorarios:number|null,
   *   ivaTipo:number, iva:number|null, honorariosConIva:number|null,
   *   total:number|null, hayCalculoItp:boolean, hayHonorarios:boolean,
   *   exentoItp:boolean, faltan:string[]
   * }}
   */
  function calcular(exp) {
    /* El ITP y la tasa salen del cálculo YA GUARDADO. `calculo_json` es la
       respuesta literal del motor y es la prueba de que se calculó: sin
       ella no hay importe que sumar, aunque `itp_importe` valga 0 —el
       toggle de exención lo pone a 0 sin que nadie haya calculado nada—. */
    const hayCalculoItp = !!(exp && exp.calculo_json);
    const exentoItp = leer(exp, 'itp_exento') === true;

    const itp = hayCalculoItp ? numero(exp.itp_importe) : null;
    const tasaDgt = hayCalculoItp ? numero(exp.tasa_dgt) : null;

    const honorarios = numero(leer(exp, 'honorarios'));
    const hayHonorarios = honorarios !== null;

    const tipoGuardado = numero(leer(exp, 'honorarios_iva_tipo'));
    const ivaTipo = tipoGuardado === null ? IVA_DEFECTO : tipoGuardado;

    /* ---- AQUÍ, Y SOLO AQUÍ, SE APLICA EL IVA ----
       La base es `honorarios`. Ni el ITP ni la tasa entran en esta cuenta,
       y no hay ninguna otra multiplicación por el tipo en todo el módulo. */
    const iva = hayHonorarios ? centimos(honorarios * (ivaTipo / 100)) : null;
    const honorariosConIva = hayHonorarios ? centimos(centimos(honorarios) + iva) : null;

    /* El total suma lo que HAY. Un concepto sin dato no suma cero
       disimuladamente: se queda fuera y se dice en `faltan`, para que el
       presupuesto no parezca cerrado cuando no lo está. */
    const lineas = [
      hayCalculoItp ? centimos(itp) : null,
      hayCalculoItp ? centimos(tasaDgt) : null,
      hayHonorarios ? centimos(honorarios) : null,
      iva
    ].filter(v => v !== null);

    const total = lineas.length
      ? centimos(lineas.reduce((a, b) => a + b, 0))
      : null;

    const faltan = [];
    if (!hayCalculoItp) faltan.push('el ITP y la tasa DGT (sin calcular)');
    if (!hayHonorarios) faltan.push('los honorarios de la gestoría');

    return {
      itp: hayCalculoItp ? centimos(itp) : null,
      tasaDgt: hayCalculoItp ? centimos(tasaDgt) : null,
      honorarios: hayHonorarios ? centimos(honorarios) : null,
      ivaTipo,
      iva,
      honorariosConIva,
      total,
      hayCalculoItp,
      hayHonorarios,
      exentoItp,
      faltan
    };
  }

  /**
   * `datos` con el total al cliente recalculado.
   *
   * El total es una cuenta de cuatro cifras que ya viven en el expediente,
   * así que guardarlo crea una QUINTA que puede contradecir a las otras:
   * recalcular el ITP dejaría el total anterior escrito y nadie lo notaría.
   * Por eso todo lo que toca esas cifras —guardar honorarios, calcular el
   * ITP, marcar la exención— pasa por aquí, y la pantalla siempre pinta
   * desde `calcular()`, nunca desde el valor guardado.
   *
   * Se guarda igualmente porque el presupuesto y la factura lo piden hecho,
   * no derivable.
   */
  function conTotal(exp, datos) {
    const d = Object.assign({}, datos || {});
    const r = calcular(Object.assign({}, exp, { datos: d }));
    if (r.total === null) delete d.honorarios_total_cliente;
    else d.honorarios_total_cliente = r.total;
    return d;
  }

  global.GTHonorarios = {
    calcular: calcular,
    conTotal: conTotal,
    IVA_DEFECTO: IVA_DEFECTO,
    centimos: centimos
  };
})(typeof window !== 'undefined' ? window : globalThis);
