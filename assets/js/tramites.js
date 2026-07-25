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
     n    · nombre. Con col:1 se guarda en su columna; si no, en datos jsonb
     l    · etiqueta
     t    · text | date | number | select | textarea
     req  · obligatorio
     ph   · placeholder
     op   · opciones (para select)
     full · ocupa el ancho completo

   Cada DOCUMENTO declara:
     tipo, label, obligatorio y opcionalmente `si`: función que
     recibe el expediente y decide si el documento aplica.
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

  const comprador = [
    { n: 'comprador_nombre',    l: 'Nombre y apellidos', t: 'text', col: 1, ph: 'María García López' },
    { n: 'comprador_nif',       l: 'DNI / NIF',          t: 'text', col: 1, ph: '12345678Z' },
    { n: 'comprador_direccion', l: 'Domicilio',          t: 'text', col: 1, ph: 'Calle Mieses 1, Majadahonda' },
    { n: 'comprador_telefono',  l: 'Teléfono',           t: 'text', col: 1, ph: '600 333 444' }
  ];

  /* --- Documentos reutilizables --- */
  const D = {
    dniTitular:   { tipo: 'dni_titular',         label: 'DNI / NIE / CIF del titular', obligatorio: true },
    dniVendedor:  { tipo: 'dni_vendedor',        label: 'DNI / NIE del vendedor',      obligatorio: true },
    dniComprador: { tipo: 'dni_comprador',       label: 'DNI / NIE del comprador',     obligatorio: true },
    permiso:      { tipo: 'permiso_circulacion', label: 'Permiso de circulación',      obligatorio: true },
    fichaTecnica: { tipo: 'ficha_tecnica',       label: 'Ficha técnica (ITV)',         obligatorio: true },
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
        { t: 'Vendedor', campos: vendedor },
        { t: 'Comprador', campos: comprador, copiarCliente: true },
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
        D.dniComprador, D.dniVendedor, D.permiso, D.fichaTecnica,
        { tipo: 'contrato', label: 'Contrato de compraventa', obligatorio: true },
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

  /** Lee el valor de un campo, esté en columna propia o en `datos`. */
  function leer(exp, nombre) {
    if (!exp) return null;
    if (exp[nombre] !== undefined && exp[nombre] !== null) return exp[nombre];
    return (exp.datos && exp.datos[nombre] !== undefined) ? exp.datos[nombre] : null;
  }

  /** Todos los campos de un trámite, en orden. */
  function campos(t) {
    return t.secciones.reduce((acc, s) => acc.concat(s.campos), []);
  }

  /** Checklist aplicable a un expediente concreto (resuelve los `si`). */
  function docsDe(t, exp) {
    return t.docs.filter(d => typeof d.si !== 'function' || d.si(exp));
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
    tramite: tramite,
    leer: leer,
    campos: campos,
    docsDe: docsDe,
    etiquetaOpcion: etiquetaOpcion
  };
})(window);
