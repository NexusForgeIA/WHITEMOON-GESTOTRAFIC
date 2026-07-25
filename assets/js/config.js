/* ============================================================
   GestoTrafic · Configuración
   ------------------------------------------------------------
   Backend Supabase con tablas AISLADAS y namespaced:
     gestotrafic_clientes · gestotrafic_expedientes · gestotrafic_documentos
   No comparte tablas, FKs ni triggers con ningún otro sistema.
   La clave publicable (anon) es pública por diseño: el acceso lo
   controla RLS en el servidor.
   ============================================================ */
window.GT_CONFIG = {
  SUPABASE_URL: 'https://mlaqtniujnvfxcvcourm.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sYXF0bml1am52ZnhjdmNvdXJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MzUyMzIsImV4cCI6MjA5MzQxMTIzMn0.Neh7VUS8ADsxf0DPab0JoJyGXOAXnLIaXzXbKzj2BGs',

  TABLA_CLIENTES: 'gestotrafic_clientes',
  TABLA_EXPEDIENTES: 'gestotrafic_expedientes',
  TABLA_DOCUMENTOS: 'gestotrafic_documentos',
  BUCKET_DOCS: 'gestotrafic-docs',

  // Motor de cálculo ITP (BOE 2026 · Orden HAC/1501/2025)
  FN_ITP: 'gestotrafic-itp',

  // Datos de la gestoría que aparecen en el contrato generado
  GESTORIA: {
    nombre: 'GestoTrafic · Gestoría de Tráfico',
    ciudad: 'Majadahonda, Madrid'
  }
};

/* --- Catálogos --- */

window.GT_ESTADOS = [
  { id: 'nuevo',         label: 'Nuevo',                 color: '#8888a0' },
  { id: 'documentacion', label: 'Documentación pendiente', color: '#ffb45c' },
  { id: 'tramitacion',   label: 'En tramitación',        color: '#7c4dff' },
  { id: 'presentado',    label: 'Presentado',            color: '#7cb8ff' },
  { id: 'completado',    label: 'Completado',            color: '#00d4aa' }
];

window.GT_CCAA = [
  'Andalucía', 'Aragón', 'Asturias', 'Baleares', 'Canarias (IGIC)', 'Cantabria',
  'Castilla-La Mancha', 'Castilla y León', 'Cataluña', 'Ceuta', 'Comunidad de Madrid',
  'Comunidad Valenciana', 'Extremadura', 'Galicia', 'La Rioja', 'Melilla',
  'Murcia', 'Navarra', 'País Vasco'
];

window.GT_COMBUSTIBLES = ['Gasolina', 'Diésel', 'Híbrido', 'Híbrido enchufable', 'Eléctrico', 'GLP', 'GNC'];

window.GT_ETIQUETAS = [
  { id: '',    label: 'Sin etiqueta / no aplica' },
  { id: 'B',   label: 'B (amarilla)' },
  { id: 'C',   label: 'C (verde)' },
  { id: 'ECO', label: 'ECO (azul y verde)' },
  { id: '0',   label: '0 emisiones (azul)' }
];

/* Checklist documental del trámite de transferencia */
window.GT_DOCS_TRANSFERENCIA = [
  { tipo: 'dni_comprador',       label: 'DNI / NIE del comprador',   obligatorio: true },
  { tipo: 'dni_vendedor',        label: 'DNI / NIE del vendedor',    obligatorio: true },
  { tipo: 'permiso_circulacion', label: 'Permiso de circulación',    obligatorio: true },
  { tipo: 'ficha_tecnica',       label: 'Ficha técnica (ITV)',       obligatorio: true },
  { tipo: 'contrato',            label: 'Contrato de compraventa',   obligatorio: true },
  { tipo: 'itv',                 label: 'ITV en vigor',              obligatorio: false },
  { tipo: 'otros',               label: 'Otros documentos',          obligatorio: false }
];
