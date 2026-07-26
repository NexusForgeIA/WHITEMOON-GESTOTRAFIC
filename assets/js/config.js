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
  TABLA_USUARIOS: 'gestotrafic_usuarios',
  BUCKET_DOCS: 'gestotrafic-docs',

  // Motor de cálculo ITP (BOE 2026 · Orden HAC/1501/2025)
  FN_ITP: 'gestotrafic-itp',

  // Login y alta de gestores (verifica bcrypt y emite la sesión)
  FN_AUTH: 'gestotrafic-auth',

  // Gest-IA · lectura de documentos con Claude (visión)
  FN_GESTIA: 'gestia-extraer',

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

/* Tipos de vehículo a efectos del Anexo I.
   Los que NO son turismo se tarifan por TRAMO de cilindrada (o de kW en
   eléctricas): el motor resuelve el valor base solo y el campo manual sobra,
   por eso van con `auto: true`.

   El turismo se tarifa por marca/modelo/versión sobre las 61.634 filas del
   Anexo I. NO lleva `auto: true` a propósito: el valor base solo se rellena
   cuando el gestor elige una versión concreta en el desplegable, y mientras
   tanto el campo sigue editable a mano. Dos versiones del mismo modelo pueden
   diferir en más de mil euros, así que esa elección no se automatiza. */
window.GT_TIPOS_VEHICULO = [
  { id: 'coche',          label: 'Turismo',          auto: false, por: 'marca_modelo' },
  { id: 'moto',           label: 'Motocicleta',      auto: true,  por: 'cilindrada' },
  { id: 'moto_electrica', label: 'Moto eléctrica',   auto: true,  por: 'kw' },
  { id: 'quad',           label: 'Quad',             auto: true,  por: 'cilindrada' },
  { id: 'buggy',          label: 'Buggy',            auto: true,  por: 'cilindrada' }
];

/* Etiquetas DGT · las usa el panel de cálculo ITP */
window.GT_ETIQUETAS = [
  { id: '',    label: 'Sin etiqueta / no aplica' },
  { id: 'B',   label: 'B (amarilla)' },
  { id: 'C',   label: 'C (verde)' },
  { id: 'ECO', label: 'ECO (azul y verde)' },
  { id: '0',   label: '0 emisiones (azul)' }
];

/* Los campos y el checklist documental de cada trámite viven en
   assets/js/tramites.js (GT_TRAMITES). Añadir un trámite nuevo es
   añadir una entrada allí: no hay que tocar formularios ni BD. */
