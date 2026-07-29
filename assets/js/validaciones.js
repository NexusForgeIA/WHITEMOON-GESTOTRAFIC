/* ============================================================
   GestoTrafic · Validaciones previas del expediente
   ------------------------------------------------------------
   Comprobaciones estándar sobre los datos que ya hay, para cazar el
   error ANTES de tramitar o de generar el XML — no en la ventanilla.

   Son AVISOS, no bloqueos. Es una diferencia deliberada:

     · Un NIF cuya letra no cuadra casi siempre es un dígito mal tecleado,
       pero puede ser un documento raro que el gestor tiene delante.
     · Una matrícula con formato extraño suele ser una errata, pero
       existen matrículas especiales, históricas y de otros países.

   Quien decide es el gestor, con el documento a la vista. Lo que hace
   este módulo es que no se le pase.

   ⛔ ANTI-INVENCIÓN · aquí NO se corrige nada. No se calcula la letra
   «correcta» de un NIF para escribirla, ni se reformatea una matrícula,
   ni se rellena un hueco. Se dice lo que no cuadra y ya. Corregir un
   documento de identidad a partir de un algoritmo es exactamente cómo se
   inscribe a la persona equivocada.

   No toca el ITP ni el exportador de OEGAM: solo lee.
   ============================================================ */
(function (global) {
  'use strict';

  /* --- NIF / NIE · letra de control ------------------------------------
     Algoritmo oficial: el resto de dividir el número entre 23 indexa esta
     cadena. En un NIE la letra inicial vale por un dígito (X=0, Y=1, Z=2)
     y a partir de ahí es el mismo cálculo. */
  const LETRAS_NIF = 'TRWAGMYFPDXBNJZSQVHLCKE';
  const NIE_PREFIJO = { X: '0', Y: '1', Z: '2' };

  /* --- CIF · dígito de control -----------------------------------------
     Otro algoritmo distinto, y por eso va aparte: un CIF no es un NIF con
     otra letra. Las organizaciones cuyo control es una LETRA usan esta
     cadena indexada por el dígito calculado. */
  const LETRAS_CIF = 'JABCDEFGHI';
  const CIF_TIPOS = 'ABCDEFGHJNPQRSUVW';
  const CIF_SOLO_LETRA = 'PQRSNW';       // su control es siempre letra
  const CIF_SOLO_DIGITO = 'ABEH';        // su control es siempre dígito

  /** Mayúsculas y sin espacios ni guiones, que es como se teclea de verdad. */
  function norm(v) {
    if (v === null || v === undefined) return '';
    return String(v).toUpperCase().replace(/[\s.\-/]/g, '');
  }

  /**
   * Comprueba un documento de identidad español.
   * @returns {{tipo:string, valido:boolean|null, motivo:string|null}}
   *          `valido: null` = no se reconoce el formato, así que no se
   *          puede decir ni que está bien ni que está mal.
   */
  function documento(valor) {
    const v = norm(valor);
    if (!v) return { tipo: 'vacio', valido: null, motivo: null };

    // DNI · 8 dígitos + letra
    let m = /^(\d{8})([A-Z])$/.exec(v);
    if (m) {
      const esperada = LETRAS_NIF[Number(m[1]) % 23];
      return m[2] === esperada
        ? { tipo: 'dni', valido: true, motivo: null }
        : { tipo: 'dni', valido: false, motivo: 'la letra de control no corresponde al número' };
    }

    // NIE · X/Y/Z + 7 dígitos + letra
    m = /^([XYZ])(\d{7})([A-Z])$/.exec(v);
    if (m) {
      const esperada = LETRAS_NIF[Number(NIE_PREFIJO[m[1]] + m[2]) % 23];
      return m[3] === esperada
        ? { tipo: 'nie', valido: true, motivo: null }
        : { tipo: 'nie', valido: false, motivo: 'la letra de control no corresponde al número' };
    }

    // CIF · letra de tipo + 7 dígitos + control (dígito o letra)
    m = new RegExp('^([' + CIF_TIPOS + '])(\\d{7})([0-9A-J])$').exec(v);
    if (m) return cif(m[1], m[2], m[3]);

    return {
      tipo: 'desconocido', valido: null,
      motivo: 'no tiene forma de DNI (8 dígitos + letra), NIE (X/Y/Z + 7 dígitos + letra) ni CIF'
    };
  }

  /* Control de un CIF: se suman los dígitos de las posiciones pares y, en
     las impares, los dígitos del resultado de multiplicarlos por dos. */
  function cif(tipo, digitos, control) {
    let suma = 0;
    for (let i = 0; i < 7; i++) {
      const n = Number(digitos[i]);
      if (i % 2 === 0) {                 // posiciones 1, 3, 5, 7 (impares humanas)
        const doble = n * 2;
        suma += Math.floor(doble / 10) + (doble % 10);
      } else {
        suma += n;
      }
    }
    const digito = (10 - (suma % 10)) % 10;
    const letra = LETRAS_CIF[digito];

    /* Según la letra inicial, el control es un dígito, una letra, o
       cualquiera de los dos. Se acepta el que corresponda. */
    let ok;
    if (CIF_SOLO_LETRA.indexOf(tipo) !== -1) ok = control === letra;
    else if (CIF_SOLO_DIGITO.indexOf(tipo) !== -1) ok = control === String(digito);
    else ok = control === letra || control === String(digito);

    return ok
      ? { tipo: 'cif', valido: true, motivo: null }
      : { tipo: 'cif', valido: false, motivo: 'el carácter de control no corresponde al número' };
  }

  /* --- Matrícula --------------------------------------------------------
     Dos formatos, los dos en circulación:
       · Europeo (desde 2000) · 0000 BBB — cuatro dígitos y tres letras,
         SIN vocales y sin Ñ, Q ni las que se confunden.
       · Provincial (anterior) · M 0000 XX — una o dos letras de provincia,
         cuatro dígitos y una o dos letras.

     Hay más: históricas, remolques, ciclomotores, temporales, especiales y
     las de otros países. Por eso esto AVISA y no rechaza: lo que no encaja
     puede ser una errata o puede ser perfectamente válido. */
  const MATRICULA_EUROPEA = /^\d{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/;
  const MATRICULA_PROVINCIAL = /^[A-Z]{1,2}\d{4}[A-Z]{1,2}$/;

  function matricula(valor) {
    const v = norm(valor);
    if (!v) return { valido: null, formato: null };
    if (MATRICULA_EUROPEA.test(v)) return { valido: true, formato: 'europea' };
    if (MATRICULA_PROVINCIAL.test(v)) return { valido: true, formato: 'provincial' };
    return { valido: false, formato: null };
  }

  /* --- Bastidor (VIN) ---------------------------------------------------
     17 caracteres alfanuméricos. Y NUNCA I, O ni Q: la norma las excluye
     precisamente para que no se confundan con 1 y 0. Encontrarlas casi
     siempre significa que el número se ha leído mal —es el error que el
     propio Gest-IA tiene avisado en su prompt—, así que se señala aparte:
     la longitud es correcta y aun así hay algo que mirar. */
  const VIN_PROHIBIDAS = /[IOQ]/;

  function bastidor(valor) {
    const v = norm(valor);
    if (!v) return { valido: null, motivo: null };
    if (!/^[A-Z0-9]{17}$/.test(v)) {
      return {
        valido: false,
        motivo: /^[A-Z0-9]+$/.test(v)
          ? 'tiene ' + v.length + ' caracteres y un bastidor tiene exactamente 17'
          : 'tiene caracteres que no son letras ni números'
      };
    }
    if (VIN_PROHIBIDAS.test(v)) {
      return {
        valido: false, longitudOk: true,
        motivo: 'lleva I, O o Q, y un bastidor no las usa nunca: '
          + 'suelen ser un 1 o un 0 leídos mal'
      };
    }
    return { valido: true, motivo: null };
  }

  /* ============================================================
     El repaso completo de un expediente
     ============================================================ */

  const leer = (exp, campo) => {
    const T = global.GTTramites;
    if (T && T.leer) return T.leer(exp, campo);
    if (!exp) return null;
    if (exp[campo] !== undefined && exp[campo] !== null) return exp[campo];
    return (exp.datos && exp.datos[campo] !== undefined) ? exp.datos[campo] : null;
  };

  const vacio = (v) => v === null || v === undefined || String(v).trim() === '';

  /**
   * Todo lo que no cuadra en un expediente, en orden de aparición.
   *
   * @param exp expediente completo
   * @param tr  trámite del catálogo (GT_TRAMITES)
   * @returns {Array<{campo:string, etiqueta:string, texto:string, tipo:string}>}
   */
  function revisar(exp, tr) {
    const avisos = [];
    const T = global.GTTramites;
    if (!exp || !tr || !T) return avisos;

    const campos = T.campos(tr);
    const porNombre = {};
    campos.forEach(c => { porNombre[c.n] = c; });

    const add = (campo, tipo, texto) => avisos.push({
      campo,
      etiqueta: (porNombre[campo] && porNombre[campo].l) || campo,
      tipo, texto
    });

    /* 1 · Documentos de identidad de TODOS los intervinientes. Se recorren
       los campos `*_nif` que declare el trámite, así que vale igual para
       titular, comprador, vendedor y para el que se añada mañana.

       El tipo del campo es lo que separa el NÚMERO del documento de las
       fechas que llevan su mismo sufijo: `caducidad_nif` acaba en `_nif`
       y es una fecha. Sin este filtro, cada expediente con la caducidad
       leída sacaba dos avisos falsos — y un validador que avisa de más
       se acaba ignorando entero. */
    campos.filter(c => c.t !== 'date' && (/_nif$/.test(c.n) || c.n === 'nif')).forEach(c => {
      const valor = leer(exp, c.n);
      if (vacio(valor)) return;                // un hueco lo cazan los obligatorios
      const r = documento(valor);
      if (r.valido === false) {
        add(c.n, 'documento', '«' + String(valor).trim() + '» no es un '
          + r.tipo.toUpperCase() + ' válido: ' + r.motivo
          + '. Compruébalo con el documento delante.');
      } else if (r.valido === null && r.motivo) {
        add(c.n, 'documento', '«' + String(valor).trim() + '» ' + r.motivo
          + '. Si es un documento extranjero, ignora este aviso.');
      }
    });

    // 2 · Matrícula
    if (porNombre.matricula) {
      const valor = leer(exp, 'matricula');
      if (!vacio(valor) && matricula(valor).valido === false) {
        add('matricula', 'matricula', '«' + String(valor).trim() + '» no encaja con el '
          + 'formato europeo (0000 BBB) ni con el provincial antiguo (M 0000 XX). '
          + 'Puede ser una errata, o una matrícula especial, histórica o extranjera.');
      }
    }

    // 3 · Bastidor (VIN)
    if (porNombre.bastidor) {
      const valor = leer(exp, 'bastidor');
      const r = bastidor(valor);
      if (!vacio(valor) && r.valido === false) {
        add('bastidor', 'bastidor', 'El bastidor «' + String(valor).trim() + '» ' + r.motivo + '.');
      }
    }

    /* 4 · Obligatorios del trámite que están en blanco. Sale del catálogo,
       así que el «motivo» del duplicado y el de la baja entran solos — y
       cualquier obligatorio que se declare después, también. */
    campos.filter(c => c.req).forEach(c => {
      if (!vacio(leer(exp, c.n))) return;
      /* Un campo que ahora mismo está oculto no se le está pidiendo a
         nadie: avisar de que falta sería avisar de un hueco que no existe. */
      if (c.soloSi) {
        const dep = leer(exp, c.soloSi.campo);
        const igual = String(dep === null || dep === undefined ? '' : dep) === String(c.soloSi.valor);
        if (c.soloSi.no ? igual : !igual) return;
      }
      add(c.n, 'obligatorio', 'Falta «' + c.l + '», que este trámite exige.');
    });

    return avisos;
  }

  global.GTValidaciones = {
    revisar: revisar,
    documento: documento,
    matricula: matricula,
    bastidor: bastidor
  };
})(typeof window !== 'undefined' ? window : globalThis);
