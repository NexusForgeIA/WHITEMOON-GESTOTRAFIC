/* ============================================================
   GestoTrafic · CATÁLOGO DE TRÁMITES
   ------------------------------------------------------------
   Añadir un trámite nuevo = añadir una entrada a GT_TRAMITES.
   No hay que tocar ni el formulario, ni el Kanban, ni la subida
   de documentos, ni la base de datos.

   Cada trámite declara:
     id        · clave estable (se guarda en expedientes.tipo_tramite)
     nombre    · etiqueta larga
     corto     · etiqueta para tablas y tarjetas
     icono     · path SVG (24x24, stroke)
     calculo   · 'itp' | null   → pestaña de cálculo fiscal
     genera    · 'contrato' | 'comunicacion' | null → documento descargable
     aviso     · nota destacada dentro del expediente (opcional)
     secciones · grupos de campos del formulario
     docs      · checklist documental

   Cada CAMPO declara:
     n     · nombre. Con col:1 se guarda en su columna; si no, en datos jsonb
     l     · etiqueta
     t     · text | date | number | select | textarea | empresa
             'empresa' = desplegable de clientes-empresa del CRM
     req   · obligatorio
     ph    · placeholder
     op    · opciones (para select)
     full  · ocupa el ancho completo
     soloSi· { campo, valor } → el campo solo se muestra si otro campo
             del formulario tiene ese valor (visibilidad condicional)
     autoSi· 'empresa' → en ese modo lo rellena la aplicación (solo lectura)
     lSi   · etiqueta alternativa cuando la parte del campo (vendedor_tipo,
             comprador_tipo…) vale 'empresa': "DNI / NIF" pasa a "CIF"

   Cada DOCUMENTO declara:
     tipo, label, obligatorio y opcionalmente:
     si    · función que recibe el expediente y decide si aplica
     caras · partes en que puede llegar (anverso y reverso de un DNI,
             páginas de una ficha). Son varios archivos del MISMO tipo,
             y Gest-IA los lee juntos como un solo documento.
   ============================================================ */
(function (global) {
  'use strict';

  /* --- Campos reutilizables --- */
  const marca      = { n: 'marca',     l: 'Marca',     t: 'text', col: 1, req: 1, ph: 'Seat' };
  const modelo     = { n: 'modelo',    l: 'Modelo',    t: 'text', col: 1, req: 1, ph: 'León 1.5 TSI' };
  const matricula  = { n: 'matricula', l: 'Matrícula', t: 'text', col: 1, req: 1, ph: '1234 ABC' };
  const combustible = {
    n: 'combustible', l: 'Combustible', t: 'select', col: 1,
    op: ['Gasolina', 'Diésel', 'Híbrido', 'Híbrido enchufable', 'Eléctrico', 'GLP', 'GNC']
  };

  const titular = [
    { n: 'titular_nombre',    l: 'Nombre o razón social', t: 'text', col: 1, req: 1, ph: 'María García López' },
    { n: 'titular_nif',       l: 'DNI / NIF / CIF',       t: 'text', col: 1, req: 1, ph: '12345678Z' },
    { n: 'titular_direccion', l: 'Domicilio',             t: 'text', col: 1, ph: 'Calle Mieses 1, Majadahonda' },
    { n: 'titular_telefono',  l: 'Teléfono',              t: 'text', col: 1, ph: '600 000 000' }
  ];

  const vendedor = [
    { n: 'vendedor_nombre',    l: 'Nombre y apellidos', t: 'text', col: 1, ph: 'Antonio Ruiz Pérez' },
    { n: 'vendedor_nif',       l: 'DNI / NIF',          t: 'text', col: 1, ph: '11223344A' },
    { n: 'vendedor_direccion', l: 'Domicilio',          t: 'text', col: 1, ph: 'Av. de España 22, Madrid' },
    { n: 'vendedor_telefono',  l: 'Teléfono',           t: 'text', col: 1, ph: '600 111 222' }
  ];

  /* Vendedor de una TRANSFERENCIA: puede ser particular o empresa.
     Si es empresa, el gestor elige la empresa vendedora del listado de
     clientes del CRM y los tres campos de identidad se vuelcan solos. */
  /* Partes de una operación que pueden firmar como particular o como
     empresa. Cada una se declara con un campo `<parte>_tipo` y lleva
     asociados los documentos `dni_<parte>` y `cif_<parte>`. */
  const PARTES = ['vendedor', 'comprador'];

  const opTipoParte = [
    { v: 'particular', l: 'Particular' },
    { v: 'empresa',    l: 'Empresa / concesionario' }
  ];

  const vendedorTipo = {
    n: 'vendedor_tipo', l: '¿Quién vende el vehículo?', t: 'select', full: 1, def: 'particular',
    op: opTipoParte
  };

  const vendedorEmpresaSel = {
    n: 'vendedor_empresa_id', l: 'Empresa vendedora (clientes del CRM)', t: 'empresa', full: 1,
    soloSi: { campo: 'vendedor_tipo', valor: 'empresa' }
  };

  /* Los datos de identidad son los mismos campos de siempre (mismas columnas):
     con vendedor particular se escriben a mano, con empresa se vuelcan. */
  const vendedorTransferencia = [
    vendedorTipo,
    vendedorEmpresaSel,
    { n: 'vendedor_nombre',    l: 'Nombre y apellidos', t: 'text', col: 1, ph: 'Antonio Ruiz Pérez', autoSi: 'empresa', lSi: 'Razón social' },
    { n: 'vendedor_nif',       l: 'DNI / NIF',          t: 'text', col: 1, ph: '11223344A',          autoSi: 'empresa', lSi: 'CIF' },
    { n: 'vendedor_direccion', l: 'Domicilio',          t: 'text', col: 1, ph: 'Av. de España 22, Madrid', autoSi: 'empresa', lSi: 'Domicilio social' },
    { n: 'vendedor_telefono',  l: 'Teléfono',           t: 'text', col: 1, ph: '600 111 222',        autoSi: 'empresa' }
  ];

  const comprador = [
    { n: 'comprador_nombre',    l: 'Nombre y apellidos', t: 'text', col: 1, ph: 'María García López' },
    { n: 'comprador_nif',       l: 'DNI / NIF',          t: 'text', col: 1, ph: '12345678Z' },
    { n: 'comprador_direccion', l: 'Domicilio',          t: 'text', col: 1, ph: 'Calle Mieses 1, Majadahonda' },
    { n: 'comprador_telefono',  l: 'Teléfono',           t: 'text', col: 1, ph: '600 333 444' }
  ];

  /* El comprador de una transferencia también puede ser una empresa (un
     concesionario que compra para stock). No hay volcado desde el CRM como
     en el vendedor —se escribe o se copia del cliente—, pero el tipo sí
     decide la etiqueta de los campos y qué documento pide el checklist. */
  const compradorTipo = {
    n: 'comprador_tipo', l: '¿Quién compra el vehículo?', t: 'select', full: 1, def: 'particular',
    op: opTipoParte
  };

  const compradorTransferencia = [
    compradorTipo,
    { n: 'comprador_nombre',    l: 'Nombre y apellidos', t: 'text', col: 1, ph: 'María García López',        lSi: 'Razón social' },
    { n: 'comprador_nif',       l: 'DNI / NIF',          t: 'text', col: 1, ph: '12345678Z',                 lSi: 'CIF' },
    { n: 'comprador_direccion', l: 'Domicilio',          t: 'text', col: 1, ph: 'Calle Mieses 1, Majadahonda', lSi: 'Domicilio social' },
    { n: 'comprador_telefono',  l: 'Teléfono',           t: 'text', col: 1, ph: '600 333 444' }
  ];

  /* --- Documentos que llegan en varias caras ---
     Un DNI reparte sus datos entre las dos caras: el número y el nombre están
     en el anverso y el DOMICILIO en el reverso. Con una sola cara, Gest-IA se
     queda sin la otra mitad, así que el hueco admite las dos.

     `caras` son las partes que se esperan. Siempre vale además subir un único
     archivo con todo (un PDF de las dos caras): esa es la cara `completo`, que
     no se enumera aquí porque no es una parte, es el documento entero. */
  const CARAS = {
    dosCaras: [
      { id: 'anverso', label: 'Anverso (cara A)', pista: 'Foto, nombre y número' },
      { id: 'reverso', label: 'Reverso (cara B)', pista: 'Domicilio y filiación' }
    ],
    dosPaginas: [
      { id: 'pagina_1', label: 'Página 1', pista: 'Identificación del vehículo' },
      { id: 'pagina_2', label: 'Página 2', pista: 'Características y reformas' }
    ]
  };

  /** La cara que representa el documento entero en un solo archivo. */
  const CARA_COMPLETO = { id: 'completo', label: 'Documento completo', pista: 'Las dos caras en un archivo' };

  /* --- Documentos reutilizables --- */
  const D = {
    dniTitular:   { tipo: 'dni_titular',         label: 'DNI / NIE / CIF del titular', obligatorio: true, caras: CARAS.dosCaras },
    dniVendedor:  { tipo: 'dni_vendedor',        label: 'DNI / NIE del vendedor',      obligatorio: true, caras: CARAS.dosCaras },
    dniComprador: { tipo: 'dni_comprador',       label: 'DNI / NIE del comprador',     obligatorio: true, caras: CARAS.dosCaras },
    permiso:      { tipo: 'permiso_circulacion', label: 'Permiso de circulación',      obligatorio: true, caras: CARAS.dosCaras },
    fichaTecnica: { tipo: 'ficha_tecnica',       label: 'Ficha técnica (ITV)',         obligatorio: true, caras: CARAS.dosPaginas },
    otros:        { tipo: 'otros',               label: 'Otros documentos',            obligatorio: false }
  };

  /* --- Iconos (path SVG 24x24) --- */
  const ICO = {
    coche:     '<path d="M5 14l1.6-5h10.8l1.6 5"/><rect x="3" y="14" width="18" height="4" rx="1"/><circle cx="8" cy="18" r="1.4"/><circle cx="16" cy="18" r="1.4"/>',
    matricula: '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 11h.01M10 11h4M18 11h.01M6 14h12"/>',
    venta:     '<path d="M3 6h18l-2 9H5z"/><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 6 2 3"/>',
    pausa:     '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
    baja:      '<circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>',
    duplicado: '<rect x="8" y="3" width="13" height="15" rx="2"/><path d="M16 21H5a2 2 0 0 1-2-2V7"/>',
    ficha:     '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>'
  };

  const TRAMITES = [

    /* ---------------- 1 · TRANSFERENCIA (existente, intacta) ---------------- */
    {
      id: 'transferencia',
      nombre: 'Transferencia de vehículo',
      corto: 'Transferencia',
      descripcion: 'Cambio de titularidad entre vendedor y comprador. Calcula el ITP.',
      icono: ICO.coche,
      calculo: 'itp',
      genera: 'contrato',
      secciones: [
        {
          t: 'Datos del vehículo',
          campos: [
            marca, modelo, matricula,
            { n: 'fecha_matriculacion', l: 'Fecha 1ª matriculación', t: 'date', col: 1, req: 1 },
            combustible,
            { n: 'cilindrada', l: 'Cilindrada (c.c.)', t: 'number', col: 1, ph: '1498' },
            { n: 'cvf', l: 'Potencia fiscal (CVf)', t: 'number', paso: '0.01', col: 1, ph: '11.5' },
            {
              n: 'etiqueta_dgt', l: 'Etiqueta DGT', t: 'select', col: 1,
              op: [
                { v: '',    l: 'Sin etiqueta / no aplica' },
                { v: 'B',   l: 'B (amarilla)' },
                { v: 'C',   l: 'C (verde)' },
                { v: 'ECO', l: 'ECO (azul y verde)' },
                { v: '0',   l: '0 emisiones (azul)' }
              ]
            }
          ]
        },
        { t: 'Vendedor', campos: vendedorTransferencia },
        { t: 'Comprador', campos: compradorTransferencia, copiarCliente: true },
        {
          t: 'Fiscalidad',
          campos: [
            { n: 'ccaa', l: 'CCAA del comprador', t: 'select', col: 1, req: 1, op: global.GT_CCAA, def: 'Comunidad de Madrid' },
            { n: 'valor_boe', l: 'Valor BOE Anexo I (€)', t: 'number', paso: '0.01', col: 1, ph: '21000' },
            { n: 'precio_contrato', l: 'Precio de contrato (€)', t: 'number', paso: '0.01', col: 1, ph: '8500' }
          ]
        }
      ],
      docs: [
        /* Una persona se identifica con su DNI/NIE; una empresa, con su CIF.
           Pedir el documento que no es deja el expediente sin la identidad
           fiscal correcta de esa parte. */
        {
          tipo: 'dni_comprador', label: 'DNI / NIE del comprador', obligatorio: true,
          caras: CARAS.dosCaras,
          si: (exp) => !esCompradorEmpresa(exp)
        },
        {
          tipo: 'cif_comprador', label: 'CIF de la empresa compradora', obligatorio: true,
          si: (exp) => esCompradorEmpresa(exp)
        },
        {
          tipo: 'dni_vendedor', label: 'DNI / NIE del vendedor', obligatorio: true,
          caras: CARAS.dosCaras,
          si: (exp) => !esVendedorEmpresa(exp)
        },
        {
          tipo: 'cif_vendedor', label: 'CIF de la empresa vendedora', obligatorio: true,
          si: (exp) => esVendedorEmpresa(exp)
        },
        D.permiso, D.fichaTecnica,
        /* Un particular firma contrato de compraventa; una empresa emite factura. */
        {
          tipo: 'contrato', label: 'Contrato de compraventa', obligatorio: true,
          si: (exp) => !esVendedorEmpresa(exp)
        },
        {
          tipo: 'factura_venta', label: 'Factura de venta (empresa vendedora)', obligatorio: true,
          si: (exp) => esVendedorEmpresa(exp)
        },
        { tipo: 'itv', label: 'ITV en vigor', obligatorio: false },
        D.otros
      ]
    },

    /* ---------------- 2 · MATRICULACIÓN ---------------- */
    {
      id: 'matriculacion',
      nombre: 'Matriculación',
      corto: 'Matriculación',
      descripcion: 'Alta de un vehículo nuevo o importado. El IEDMT lo aporta la gestoría.',
      icono: ICO.matricula,
      calculo: null,
      genera: null,
      aviso: 'El <b>IEDMT</b> (impuesto de matriculación) es un impuesto distinto del ITP y el motor de cálculo de GestoTrafic no lo cubre. Introduce el importe manualmente: <b>lo calcula y lo aporta la gestoría</b>.',
      secciones: [
        {
          t: 'Datos del vehículo',
          campos: [
            marca, modelo,
            { n: 'bastidor', l: 'Nº de bastidor (VIN)', t: 'text', req: 1, ph: 'VSSZZZ1KZAW000000' },
            { n: 'matricula', l: 'Matrícula (si ya asignada)', t: 'text', col: 1, ph: 'Pendiente de asignar' },
            combustible,
            { n: 'co2', l: 'Emisiones CO₂ (g/km)', t: 'number', paso: '0.1', ph: '118' }
          ]
        },
        { t: 'Titular', campos: titular, copiarCliente: true },
        {
          t: 'IEDMT · impuesto de matriculación',
          campos: [
            { n: 'iedmt_importe', l: 'Importe IEDMT (€) · manual', t: 'number', paso: '0.01', ph: 'Lo aporta la gestoría' },
            { n: 'iedmt_nota', l: 'Nota sobre el cálculo', t: 'text', ph: 'Tipo aplicado, exención, base…' }
          ]
        }
      ],
      docs: [
        { tipo: 'ficha_tecnica_coc',  label: 'Ficha técnica / CoC',              obligatorio: true },
        { tipo: 'factura_compra',     label: 'Factura de compra',                obligatorio: true },
        { tipo: 'dua',                label: 'DUA (solo si es importado)',       obligatorio: false },
        { tipo: 'itv',                label: 'ITV',                              obligatorio: true },
        D.dniTitular,
        { tipo: 'justificante_iedmt', label: 'Justificante IEDMT / IVA',         obligatorio: true },
        D.otros
      ]
    },

    /* ---------------- 3 · NOTIFICACIÓN DE VENTA ---------------- */
    {
      id: 'notificacion_venta',
      nombre: 'Notificación de venta',
      corto: 'Notif. venta',
      descripcion: 'El vendedor comunica la venta para dejar de responder por el vehículo.',
      icono: ICO.venta,
      calculo: null,
      genera: 'comunicacion',
      secciones: [
        { t: 'Datos del vehículo', campos: [marca, modelo, matricula] },
        { t: 'Vendedor', campos: vendedor, copiarCliente: true },
        { t: 'Comprador', campos: comprador },
        {
          t: 'Venta',
          campos: [{ n: 'fecha_venta', l: 'Fecha de la venta', t: 'date', req: 1 }]
        }
      ],
      docs: [
        D.dniVendedor, D.dniComprador, D.permiso,
        { tipo: 'contrato_venta', label: 'Contrato o factura de venta', obligatorio: true },
        D.otros
      ]
    },

    /* ---------------- 4 · BAJA TEMPORAL ---------------- */
    {
      id: 'baja_temporal',
      nombre: 'Baja temporal',
      corto: 'Baja temporal',
      descripcion: 'El vehículo deja de circular temporalmente y puede volver a darse de alta.',
      icono: ICO.pausa,
      calculo: null,
      genera: null,
      secciones: [
        { t: 'Datos del vehículo', campos: [marca, modelo, matricula] },
        { t: 'Titular', campos: titular, copiarCliente: true },
        {
          t: 'Motivo de la baja',
          campos: [{
            n: 'motivo', l: 'Motivo', t: 'select', req: 1,
            op: [
              { v: '',              l: '— Selecciona el motivo —' },
              { v: 'no_uso',        l: 'Vehículo sin uso temporal' },
              { v: 'extranjero',    l: 'Estancia en el extranjero' },
              { v: 'deposito',      l: 'En depósito o almacén de un compraventa' },
              { v: 'sustraccion',   l: 'Sustracción (robo)' },
              { v: 'otro',          l: 'Otro' }
            ]
          }]
        }
      ],
      docs: [D.dniTitular, D.permiso, D.fichaTecnica, D.otros]
    },

    /* ---------------- 5 · BAJA DEFINITIVA ---------------- */
    {
      id: 'baja_definitiva',
      nombre: 'Baja definitiva',
      corto: 'Baja definitiva',
      descripcion: 'El vehículo se destruye en un CAT o se exporta. No admite vuelta al alta.',
      icono: ICO.baja,
      calculo: null,
      genera: null,
      secciones: [
        { t: 'Datos del vehículo', campos: [marca, modelo, matricula] },
        { t: 'Titular', campos: titular, copiarCliente: true },
        {
          t: 'Motivo de la baja',
          campos: [{
            n: 'motivo', l: 'Motivo', t: 'select', req: 1,
            op: [
              { v: '',            l: '— Selecciona el motivo —' },
              { v: 'destruccion', l: 'Destrucción en CAT (desguace)' },
              { v: 'exportacion', l: 'Exportación o traslado a otro país' }
            ]
          }]
        }
      ],
      docs: [
        D.dniTitular, D.permiso, D.fichaTecnica,
        {
          tipo: 'certificado_destruccion', label: 'Certificado de destrucción (CAT)', obligatorio: true,
          si: (exp) => leer(exp, 'motivo') === 'destruccion'
        },
        {
          tipo: 'justificante_exportacion', label: 'Justificante de exportación', obligatorio: true,
          si: (exp) => leer(exp, 'motivo') === 'exportacion'
        },
        D.otros
      ]
    },

    /* ---------------- 6 · DUPLICADO PERMISO DE CIRCULACIÓN ---------------- */
    {
      id: 'duplicado_permiso',
      nombre: 'Duplicado del permiso de circulación',
      corto: 'Dup. permiso',
      descripcion: 'Nuevo permiso por pérdida, deterioro, robo o cambio de datos.',
      icono: ICO.duplicado,
      calculo: null,
      genera: null,
      secciones: [
        { t: 'Datos del vehículo', campos: [marca, modelo, matricula] },
        { t: 'Titular', campos: titular, copiarCliente: true },
        {
          t: 'Motivo del duplicado',
          campos: [{
            n: 'motivo', l: 'Motivo', t: 'select', req: 1,
            op: [
              { v: '',              l: '— Selecciona el motivo —' },
              { v: 'perdida',       l: 'Pérdida o extravío' },
              { v: 'deterioro',     l: 'Deterioro' },
              { v: 'robo',          l: 'Robo o sustracción' },
              { v: 'cambio_datos',  l: 'Cambio de datos del titular' }
            ]
          }]
        }
      ],
      docs: [
        D.dniTitular, D.fichaTecnica,
        {
          tipo: 'denuncia_robo', label: 'Denuncia por robo', obligatorio: true,
          si: (exp) => leer(exp, 'motivo') === 'robo'
        },
        D.otros
      ]
    },

    /* ---------------- 7 · DUPLICADO DE FICHA TÉCNICA (eITV) ---------------- */
    {
      id: 'duplicado_ficha',
      nombre: 'Duplicado de ficha técnica (eITV)',
      corto: 'Dup. ficha téc.',
      descripcion: 'Nueva ficha técnica electrónica del vehículo.',
      icono: ICO.ficha,
      calculo: null,
      genera: null,
      secciones: [
        { t: 'Datos del vehículo', campos: [marca, modelo, matricula] },
        { t: 'Titular', campos: titular, copiarCliente: true }
      ],
      docs: [
        D.dniTitular, D.permiso,
        { tipo: 'itv_anterior', label: 'ITV anterior (si se conserva)', obligatorio: false },
        D.otros
      ]
    }
  ];

  /* ---------------- Utilidades del catálogo ---------------- */

  /** Devuelve el trámite por id; si no existe, cae a transferencia. */
  function tramite(id) {
    return TRAMITES.find(t => t.id === id) || TRAMITES[0];
  }

  /** ¿El vendedor del expediente es una empresa / concesionario? */
  function esVendedorEmpresa(exp) {
    return leer(exp, 'vendedor_tipo') === 'empresa';
  }

  /** ¿Y el comprador? */
  function esCompradorEmpresa(exp) {
    return leer(exp, 'comprador_tipo') === 'empresa';
  }

  /** ¿El gestor ha confirmado que la operación está exenta de ITP? */
  function esExentoITP(exp) {
    return leer(exp, 'itp_exento') === true;
  }

  /** Lee el valor de un campo, esté en columna propia o en `datos`. */
  function leer(exp, nombre) {
    if (!exp) return null;
    if (exp[nombre] !== undefined && exp[nombre] !== null) return exp[nombre];
    return (exp.datos && exp.datos[nombre] !== undefined) ? exp.datos[nombre] : null;
  }

  /** Campos '<parte>_tipo' que declara el trámite, en orden. Son los que
      deciden si esa parte firma como particular o como empresa. */
  function camposTipoParte(t) {
    return campos(t).filter(c => PARTES.indexOf(c.n.replace(/_tipo$/, '')) !== -1 && /_tipo$/.test(c.n));
  }

  /** Todos los campos de un trámite, en orden. */
  function campos(t) {
    return t.secciones.reduce((acc, s) => acc.concat(s.campos), []);
  }

  /** Checklist aplicable a un expediente concreto (resuelve los `si`). */
  function docsDe(t, exp) {
    return t.docs.filter(d => typeof d.si !== 'function' || d.si(exp));
  }

  /* ---------------- Documentos de varias caras ---------------- */

  /** Caras que se esperan de un documento, con la de «documento completo» al
      final. Un documento normal devuelve solo esa: un archivo y ya está. */
  function carasDe(doc) {
    return (doc && doc.caras ? doc.caras : []).concat([CARA_COMPLETO]);
  }

  /** ¿Este documento puede llegar en varios archivos? */
  function admiteVariasCaras(doc) {
    return !!(doc && doc.caras && doc.caras.length);
  }

  /** Etiqueta de una cara ('reverso' → 'Reverso (cara B)'). */
  function etiquetaCara(doc, cara) {
    const c = carasDe(doc).find(x => x.id === cara);
    return c ? c.label : cara;
  }

  /**
   * Qué caras del documento hay y cuáles faltan, dada la lista de archivos
   * subidos (cada uno con su `cara`). Un archivo `completo` cubre el
   * documento entero: quien manda las dos caras en un PDF no debe nada.
   */
  function estadoCaras(doc, archivos) {
    const subidas = (archivos || []).map(a => a.cara || 'completo');
    const completo = subidas.indexOf('completo') !== -1;
    const esperadas = (doc && doc.caras) || [];
    return {
      completo: completo || (esperadas.length > 0 && esperadas.every(c => subidas.indexOf(c.id) !== -1)),
      presentes: esperadas.filter(c => completo || subidas.indexOf(c.id) !== -1).map(c => c.id),
      faltan: completo ? [] : esperadas.filter(c => subidas.indexOf(c.id) === -1).map(c => c.id),
      conArchivoCompleto: completo
    };
  }

  /** Etiqueta legible del valor de un select. */
  function etiquetaOpcion(campo, valor) {
    if (!campo || !campo.op) return valor;
    for (const o of campo.op) {
      if (typeof o === 'string') { if (o === valor) return o; }
      else if (o.v === valor) return o.l;
    }
    return valor;
  }

  global.GT_TRAMITES = TRAMITES;
  global.GTTramites = {
    PARTES: PARTES,
    tramite: tramite,
    leer: leer,
    campos: campos,
    camposTipoParte: camposTipoParte,
    docsDe: docsDe,
    carasDe: carasDe,
    admiteVariasCaras: admiteVariasCaras,
    etiquetaCara: etiquetaCara,
    estadoCaras: estadoCaras,
    etiquetaOpcion: etiquetaOpcion,
    esVendedorEmpresa: esVendedorEmpresa,
    esCompradorEmpresa: esCompradorEmpresa,
    esExentoITP: esExentoITP
  };
})(window);
