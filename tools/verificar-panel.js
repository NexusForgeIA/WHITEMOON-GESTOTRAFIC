#!/usr/bin/env node
/* ============================================================
   Verificación del panel de gerencia
   ------------------------------------------------------------
   El panel es la pantalla que se mira para decidir, y su forma de
   fallar es silenciosa: un número redondo y creíble donde no había
   dato. Nadie audita un «4,2 días de media» que suena bien.

   Por eso lo que más se comprueba aquí no es que las cuentas salgan
   —que también—, sino que las que NO se pueden hacer NO se hagan:

     · sin historial de estados no hay tiempo medio; hay `sinDatos`
     · un expediente sin el alta registrada no entra en las medias
     · la facturación son los honorarios y nada más: ni ITP, ni tasa
       DGT, ni IVA

   Se ejecuta el módulo real (assets/js/panel.js) y los módulos reales
   de los que depende, no copias.

       node tools/verificar-panel.js

   Sale con código 1 ante cualquier discrepancia.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

/* Los módulos del CRM son IIFE sobre `window`: se ejecutan tal cual.
   El orden es el de app.html, y hace falta entero: el panel pregunta las
   reglas a `GTServicio`, `GTValidaciones`, `GTHonorarios` y al catálogo de
   trámites en vez de tener su propia versión de cada una. */
global.window = globalThis;
['config', 'servicio', 'tramites', 'honorarios', 'validaciones', 'panel'].forEach(m =>
  (0, eval)(fs.readFileSync(path.join(RAIZ, 'assets', 'js', m + '.js'), 'utf8')));

const P = globalThis.GTPanel;
if (!P) { console.error('No se pudo cargar assets/js/panel.js'); process.exit(2); }

let fallos = 0;
function ok(cond, titulo, detalle) {
  if (cond) { console.log('  ✓ ' + titulo); return true; }
  fallos++;
  console.log('  ✗ ' + titulo + (detalle ? '\n      ' + detalle : ''));
  return false;
}

/* ------------------------------------------------------------
   Fixtures · un jueves cualquiera de julio de 2026
   ------------------------------------------------------------ */
/* Todo a las 12:00 —fixtures y «hoy»— para que las duraciones salgan en días
   redondos y las comprobaciones digan «10 días» en vez de «10,1». La hora no
   es parte de lo que se verifica; que se cuele en el resultado esperado sí
   sería un problema, porque escondería un error de un par de horas. */
const HOY = new Date(2026, 6, 30, 12, 0, 0);          // 30 de julio de 2026
const iso = (a, m, d, h) => new Date(a, m - 1, d, h === undefined ? 12 : h).toISOString();

const GESTOR_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const GESTOR_B = 'bbbbbbbb-0000-0000-0000-000000000002';

const USUARIOS = [
  { id: GESTOR_A, nombre: 'Ana Gil', rol: 'gestor', activo: true },
  { id: GESTOR_B, nombre: 'Beto Sanz', rol: 'gestor', activo: true }
];

let n = 0;
/**
 * Expediente mínimo y CORRECTO: no saca ni un aviso de validación salvo los
 * que le pida cada caso. Las letras de control son las buenas (12345678**Z**,
 * 11223344**B**) y están todos los obligatorios de la transferencia; si
 * faltara uno, media verificación de alertas mediría el fixture y no el
 * código.
 */
function exp(extra) {
  n++;
  return Object.assign({
    id: 'exp-' + n,
    referencia: 'EXP-2026-' + String(1000 + n),
    tipo_tramite: 'transferencia',
    estado: 'nuevo',
    gestor_id: GESTOR_A,
    gestor: { id: GESTOR_A, nombre: 'Ana Gil' },
    created_at: iso(2026, 7, 10),
    ia_estado: null,
    marca: 'Seat', modelo: 'León', matricula: '1234 BCD',
    fecha_matriculacion: '2019-04-15',
    ccaa: 'Comunidad de Madrid',
    vendedor_nombre: 'Antonio Ruiz', vendedor_nif: '11223344B',
    comprador_nombre: 'María García', comprador_nif: '12345678Z',
    datos: {}
  }, extra || {});
}

const paso = (id, estado, anterior, fecha, gestor) => ({
  expediente_id: id, estado, estado_anterior: anterior,
  gestor_id: gestor || GESTOR_A, created_at: fecha
});

const panel = (d) => P.calcular(Object.assign({
  expedientes: [], historial: [], documentos: [], usuarios: USUARIOS,
  periodo: 'mes', hoy: HOY, esAdmin: true
}, d));

console.log('\nVerificación del panel de gerencia\n' + '='.repeat(56));

/* ============================================================
   1 · Periodos y ventana de comparación
   ============================================================ */
console.log('\n1 · Periodos · la ventana y con qué se compara');

const rMes = P.rango('mes', HOY);
ok(+rMes.desde === +new Date(2026, 6, 1) && +rMes.hasta === +new Date(2026, 7, 1),
  '«Este mes» va del 1 de julio al 1 de agosto (hasta excluido)',
  rMes.desde + ' → ' + rMes.hasta);
ok(+rMes.previo.desde === +new Date(2026, 5, 1) && +rMes.previo.hasta === +new Date(2026, 6, 1),
  'y se compara con junio entero');

const rAnt = P.rango('mes_ant', HOY);
ok(+rAnt.desde === +new Date(2026, 5, 1) && +rAnt.hasta === +new Date(2026, 6, 1),
  '«Mes anterior» es junio…');
ok(+rAnt.previo.desde === +new Date(2026, 4, 1),
  '…y se compara con mayo, no con julio');

const rTri = P.rango('trimestre', HOY);
ok(+rTri.desde === +new Date(2026, 6, 1) && +rTri.hasta === +new Date(2026, 9, 1),
  '«Este trimestre» es julio–septiembre');
ok(+rTri.previo.desde === +new Date(2026, 3, 1) && +rTri.previo.hasta === +new Date(2026, 6, 1),
  'y se compara con el trimestre anterior, no con el mes anterior',
  'comparar un trimestre contra un mes inventa una caída del 70%');

/* La frontera: medio abierta. Con el intervalo cerrado por los dos lados, un
   expediente dado de alta el día 1 a las 00:00 contaría en dos meses. */
const frontera = panel({
  expedientes: [
    exp({ created_at: new Date(2026, 6, 1, 0, 0, 0).toISOString() }),
    exp({ created_at: new Date(2026, 5, 30, 23, 59, 59).toISOString() })
  ]
});
ok(frontera.kpis.nuevos.valor === 1 && frontera.kpis.nuevos.delta.previo === 1,
  'el 1 de julio a las 00:00 cuenta en julio y NO en junio',
  'julio=' + frontera.kpis.nuevos.valor + ' junio=' + frontera.kpis.nuevos.delta.previo);

/* ============================================================
   2 · Variación contra el periodo anterior
   ============================================================ */
console.log('\n2 · Δ vs periodo anterior');

const d1 = P.delta(12, 8, 'sube');
ok(d1.abs === 4 && d1.pct === 50 && d1.dir === 'sube' && d1.bueno === true,
  'de 8 a 12 son +4 y +50%, y es buena noticia', JSON.stringify(d1));

const d2 = P.delta(7, 0, 'sube');
ok(d2.abs === 7 && d2.pct === null,
  'de 0 a 7 no es «+100%»: el porcentaje se queda en null y manda el absoluto',
  JSON.stringify(d2));

const d3 = P.delta(9.5, 4.2, 'baja');
ok(d3.dir === 'sube' && d3.bueno === false,
  'en el tiempo medio, SUBIR es mala noticia (se colorea al revés)', JSON.stringify(d3));

ok(P.delta(5, null, 'sube') === null,
  'sin valor con el que comparar no hay Δ: null, no 0');

/* ============================================================
   3 · Facturación · honorarios y nada más
   ============================================================ */
console.log('\n3 · Facturación · ni ITP, ni tasa DGT, ni IVA');

const conCuentas = exp({
  created_at: iso(2026, 7, 12),
  itp_importe: 112.8, tasa_dgt: 55.7,
  calculo_json: { itp: 112.8, tasa_dgt: 55.7 },
  datos: { honorarios: 200 }
});
const fact = panel({ expedientes: [conCuentas] });
ok(fact.kpis.facturacion.valor === 200,
  'un expediente con 200 € de honorarios factura 200 €',
  'ha salido ' + fact.kpis.facturacion.valor
    + ' (368,50 = suma el ITP y la tasa · 242 = le mete el IVA)');
ok(fact.kpis.facturacion.sinDatos === false,
  'y la métrica se da por buena porque hay honorarios puestos');

const sinHon = panel({ expedientes: [exp({ created_at: iso(2026, 7, 12), itp_importe: 340 })] });
ok(sinHon.kpis.facturacion.sinDatos === true && sinHon.kpis.facturacion.valor === 0,
  'sin ningún honorario registrado la métrica va marcada `sinDatos`',
  'un 0 € sin marcar se lee como «este mes no se ha facturado»');

/* ============================================================
   4 · Sin historial NO hay tiempos · y no hay ceros
   ============================================================ */
console.log('\n4 · Sin historial de estados no se inventa una duración');

const mudo = panel({ expedientes: [exp({ estado: 'completado' }), exp()] });
ok(mudo.kpis.tiempoMedio.sinDatos === true && mudo.kpis.tiempoMedio.valor === null,
  'el tiempo medio de tramitación es `sinDatos` + valor null, no 0',
  JSON.stringify({ v: mudo.kpis.tiempoMedio.valor, s: mudo.kpis.tiempoMedio.sinDatos }));
ok(!!mudo.kpis.tiempoMedio.motivo,
  'y viene con un motivo en castellano para poder enseñarlo');
ok(mudo.tiempos.sinDatos === true && mudo.tiempos.estados.every(e => e.dias === null),
  'los tiempos por estado tampoco salen: todos los estados a null');
ok(mudo.tiempos.cuello === null,
  'y no se señala ningún cuello de botella cuando no se ha medido nada');

/* ============================================================
   5 · Con historial · las cuentas
   ============================================================ */
console.log('\n5 · Con historial · duración, tramos y cuello de botella');

const A = exp({ id: 'A', referencia: 'EXP-2026-0001', estado: 'completado', created_at: iso(2026, 7, 1) });
const histA = [
  paso('A', 'nuevo', null, iso(2026, 7, 1)),
  paso('A', 'documentacion', 'nuevo', iso(2026, 7, 3)),
  paso('A', 'tramitacion', 'documentacion', iso(2026, 7, 6)),
  paso('A', 'completado', 'tramitacion', iso(2026, 7, 11))
];
const pA = panel({ expedientes: [A], historial: histA });

ok(pA.kpis.tiempoMedio.valor === 10,
  'del alta (1 jul) al cierre (11 jul) son 10 días', String(pA.kpis.tiempoMedio.valor));

const t = (id) => pA.tiempos.estados.find(e => e.id === id);
ok(t('nuevo').dias === 2 && t('documentacion').dias === 3 && t('tramitacion').dias === 5,
  'los tramos salen 2 / 3 / 5 días',
  JSON.stringify(pA.tiempos.estados.map(e => e.id + '=' + e.dias)));
ok(pA.tiempos.cuello === 'tramitacion' && t('tramitacion').cuello === true,
  'el cuello de botella es «tramitación», que es donde más se estuvo');
ok(!pA.tiempos.estados.some(e => e.id === 'completado'),
  '«completado» no genera tramo: de ahí no se sale y no es tiempo de trabajo');

/* El tramo abierto se mide hasta HOY: un expediente está atascado mientras
   lo está, no cuando por fin se desatasca. */
const C = exp({ id: 'C', estado: 'documentacion', created_at: iso(2026, 7, 25) });
const pC = panel({
  expedientes: [C],
  historial: [paso('C', 'nuevo', null, iso(2026, 7, 25)), paso('C', 'documentacion', 'nuevo', iso(2026, 7, 27))]
});
ok(pC.tiempos.estados.find(e => e.id === 'documentacion').dias === 3,
  'un expediente que lleva 3 días parado en documentación cuenta 3 días YA',
  String(pC.tiempos.estados.find(e => e.id === 'documentacion').dias));
ok(pC.tiempos.abiertos === 1, 'y el tramo se marca como abierto');

/* ============================================================
   6 · Un expediente sin alta registrada NO entra en las medias
   ============================================================ */
console.log('\n6 · Historia que empieza a la mitad · se cuenta el cierre, no la duración');

const B = exp({ id: 'B', referencia: 'EXP-2026-0002', estado: 'completado', created_at: iso(2026, 7, 2) });
const histB = [
  // Primera fila con `estado_anterior` puesto: el alta no se registró.
  paso('B', 'tramitacion', 'documentacion', iso(2026, 7, 20)),
  paso('B', 'completado', 'tramitacion', iso(2026, 7, 22))
];
const pB = panel({ expedientes: [B], historial: histB });

ok(pB.kpis.tiempoMedio.sinDatos === true,
  'de un expediente cuya historia empieza a la mitad no se mide la duración',
  'medirla desde la primera fila daría 2 días en vez de los 20 que llevaba');
ok(/consta el alta/.test(pB.kpis.tiempoMedio.motivo),
  'y el motivo dice exactamente eso, no «no hay datos»');
ok(pB.agentes[0].cerrados === 1,
  'pero el CIERRE sí se cuenta: es un cierre real', JSON.stringify(pB.agentes[0]));

// Mezclados, la media solo promedia el que se puede medir.
const pAB = panel({ expedientes: [A, B], historial: histA.concat(histB) });
ok(pAB.kpis.tiempoMedio.valor === 10 && pAB.agentes[0].cerrados === 2,
  'con los dos juntos: media de 10 días (solo A) y 2 cierres (A y B)',
  JSON.stringify({ media: pAB.kpis.tiempoMedio.valor, cierres: pAB.agentes[0].cerrados }));

/* ============================================================
   7 · Embudo, tipos y % Gest-IA
   ============================================================ */
console.log('\n7 · Embudo, tipos de trámite y Gest-IA');

const mezcla = [
  exp({ estado: 'nuevo', created_at: iso(2026, 7, 5), ia_estado: 'validado' }),
  exp({ estado: 'nuevo', created_at: iso(2026, 7, 6) }),
  exp({ estado: 'tramitacion', created_at: iso(2026, 7, 7), ia_estado: 'pendiente_validacion' }),
  exp({ estado: 'completado', created_at: iso(2026, 7, 8), tipo_tramite: 'baja_temporal' })
];
const pM = panel({ expedientes: mezcla });

ok(pM.embudo.find(e => e.id === 'nuevo').n === 2 && pM.embudo.find(e => e.id === 'completado').n === 1,
  'el embudo reparte los 4 expedientes del periodo por su estado de hoy');
ok(pM.kpis.gestia.valor === 50,
  '2 de 4 leídos por Gest-IA son el 50%', String(pM.kpis.gestia.valor));
ok(pM.tipos.length === 2 && pM.tipos[0].id === 'transferencia' && pM.tipos[0].n === 3,
  'los tipos salen ordenados por volumen y sin los que están a cero',
  JSON.stringify(pM.tipos.map(x => x.id + '=' + x.n)));
ok(pM.kpis.nuevos.serie.length > 0 && pM.kpis.nuevos.serie.reduce((a, b) => a + b, 0) === 4,
  'la mini-tendencia suma exactamente los 4 expedientes del periodo');
ok(pM.kpis.nuevos.serie.length === 30,
  'y llega hasta hoy (30 de julio), sin rellenar de ceros lo que queda de mes',
  'puntos = ' + pM.kpis.nuevos.serie.length);

/* ============================================================
   8 · Filtros
   ============================================================ */
console.log('\n8 · Filtros de agente y de trámite');

const dosGestores = [
  exp({ created_at: iso(2026, 7, 5) }),
  exp({ created_at: iso(2026, 7, 6), gestor_id: GESTOR_B, gestor: { id: GESTOR_B, nombre: 'Beto Sanz' } }),
  exp({ created_at: iso(2026, 7, 7), gestor_id: GESTOR_B, gestor: { id: GESTOR_B, nombre: 'Beto Sanz' }, tipo_tramite: 'baja_temporal' })
];
ok(panel({ expedientes: dosGestores, filtros: { gestor: GESTOR_B } }).kpis.nuevos.valor === 2,
  'filtrando por Beto quedan sus 2 expedientes');
ok(panel({ expedientes: dosGestores, filtros: { tipo: 'baja_temporal' } }).kpis.nuevos.valor === 1,
  'filtrando por baja temporal queda 1');
ok(panel({ expedientes: dosGestores, filtros: { gestor: GESTOR_B, tipo: 'transferencia' } }).kpis.nuevos.valor === 1,
  'los dos filtros se acumulan');

const pAg = panel({ expedientes: dosGestores });
ok(pAg.agentes.length === 2 && pAg.agentes[0].id === GESTOR_B && pAg.agentes[0].nuevos === 2,
  'la tabla por agente ordena por volumen del periodo',
  JSON.stringify(pAg.agentes.map(a => a.nombre + '=' + a.nuevos)));

/* La tabla TIENE que sumar el indicador de arriba. Si un expediente se cae de
   ella —sin gestor, o de un gestor que ya no está en la lista— la columna deja
   de cuadrar con «Expedientes nuevos» y lo lógico es pensar que el KPI miente. */
const sueltos = dosGestores.concat([
  exp({ created_at: iso(2026, 7, 8), gestor_id: null, gestor: null }),
  exp({ created_at: iso(2026, 7, 9), gestor_id: 'cccccccc-borrado', gestor: null })
]);
const pSueltos = panel({ expedientes: sueltos });
const huerfana = pSueltos.agentes.find(a => a.huerfano);
ok(!!huerfana && huerfana.nuevos === 2,
  'un expediente sin gestor y otro de un usuario que ya no existe van a una fila «Sin asignar»',
  JSON.stringify(pSueltos.agentes.map(a => a.nombre + '=' + a.nuevos)));
ok(pSueltos.agentes.reduce((s, a) => s + a.nuevos, 0) === pSueltos.kpis.nuevos.valor,
  'y la columna «nuevos» suma exactamente el indicador de arriba (' + pSueltos.kpis.nuevos.valor + ')',
  'suma = ' + pSueltos.agentes.reduce((s, a) => s + a.nuevos, 0));

// Un gestor desactivado con trabajo pendiente sigue saliendo: el expediente
// existe aunque él ya no entre. Lo que se filtra son las filas vacías.
const pBaja = P.calcular({
  expedientes: [exp({ created_at: iso(2026, 7, 5), gestor_id: GESTOR_B, gestor: null })],
  historial: [], documentos: [], periodo: 'mes', hoy: HOY, esAdmin: true,
  usuarios: [USUARIOS[0], Object.assign({}, USUARIOS[1], { activo: false })]
});
ok(pBaja.agentes.length === 1 && pBaja.agentes[0].id === GESTOR_B && pBaja.agentes[0].inactivo === true,
  'un gestor desactivado con expedientes sale marcado, no desaparece',
  JSON.stringify(pBaja.agentes));

/* ============================================================
   9 · Alertas accionables
   ============================================================ */
console.log('\n9 · Alertas · las cuatro, y ningún falso positivo');

// 9.1 · Cambio de servicio. VTC (1041) → particular (1000) con la ficha aún
//       en 1041: hay que pasar por la ITV antes.
const bloqueado = exp({
  datos: {
    cambio_servicio: true, servicio_anterior: 'vtc', servicio_destino: 'particular',
    clasificacion_codigo: '1041'
  }
});
ok(panel({ expedientes: [bloqueado] }).alertas.servicio.length === 1,
  'un VTC → particular con la ficha sin cambiar sale como bloqueado');

// Taxi → particular cambia de servicio pero NO de código: no bloquea.
const taxi = exp({
  datos: {
    cambio_servicio: true, servicio_anterior: 'taxi', servicio_destino: 'particular',
    clasificacion_codigo: '1000'
  }
});
ok(panel({ expedientes: [taxi] }).alertas.servicio.length === 0,
  'taxi → particular NO sale: mismo código 1000, no hay que ir a la ITV',
  'mandar a la ITV a quien no tiene que ir es un error tan real como el otro');

// 9.2 · DNI caducado
const caducado = exp({ datos: { comprador_caducidad_nif: '2025-03-14' } });
const aCad = panel({ expedientes: [caducado] }).alertas.dniCaducado;
ok(aCad.length === 1 && aCad[0].parte === 'comprador',
  'un DNI caducado en 2025 sale como alerta del comprador');
ok(panel({ expedientes: [exp({ datos: { comprador_caducidad_nif: '2030-03-14' } }) ] })
  .alertas.dniCaducado.length === 0,
  'y uno en vigor hasta 2030 no sale');
ok(panel({ expedientes: [exp({ datos: { comprador_tipo: 'empresa', comprador_caducidad_nif: '2025-03-14' } })] })
  .alertas.dniCaducado.length === 0,
  'a una empresa no le caduca el DNI: si la parte firma como empresa, no se reclama',
  'la fecha puede haber quedado en `datos` de cuando era particular');

// 9.3 · Documentación pendiente. Transferencia particular→particular exige
//       5 documentos; con 20 días y ninguno, se reclama.
const viejo = exp({ created_at: iso(2026, 7, 10), estado: 'documentacion' });
ok(panel({ expedientes: [viejo] }).alertas.docPendiente.length === 1,
  'un expediente de hace 20 días sin documentación obligatoria se reclama');
ok(panel({ expedientes: [exp({ created_at: iso(2026, 7, 28), estado: 'documentacion' })] })
  .alertas.docPendiente.length === 0,
  'uno de hace 2 días no: por debajo de ' + P.DIAS_DOC_PENDIENTE + ' días no se molesta a nadie');
ok(panel({ expedientes: [exp({ created_at: iso(2026, 7, 10), estado: 'completado' })] })
  .alertas.docPendiente.length === 0,
  'y a un expediente ya completado no se le reclama nada');

const docsCompletos = ['dni_comprador', 'dni_vendedor', 'permiso_circulacion', 'ficha_tecnica', 'contrato']
  .map((tipo, i) => ({ id: 'd' + i, expediente_id: viejo.id, tipo }));
ok(panel({ expedientes: [viejo], documentos: docsCompletos }).alertas.docPendiente.length === 0,
  'con los 5 obligatorios subidos deja de reclamarse');

// 9.4 · Validaciones. La letra de control del NIF no cuadra.
const nifMalo = exp({ comprador_nif: '12345678A' });   // la buena es Z
const aVal = panel({ expedientes: [nifMalo] }).alertas.validacion;
ok(aVal.length === 1, 'un NIF con la letra mal sale en los avisos de validación');
ok(!/\bZ\b/.test(aVal[0].texto),
  'y el aviso NO dice cuál sería la letra buena',
  'decirla invita a escribirla sin mirar el documento: ' + aVal[0].texto);

// Un expediente correcto no saca NI UN aviso. Un panel que avisa de más se
// ignora entero, y entonces deja de avisar de lo que importa.
const limpio = panel({ expedientes: [exp({ created_at: iso(2026, 7, 28) })], documentos: [] });
ok(limpio.alertas.total === 0,
  'un expediente correcto y reciente no genera NINGUNA alerta',
  JSON.stringify(limpio.alertas));

/* ============================================================
   10 · El historial parcial se avisa
   ============================================================ */
console.log('\n10 · Historial más joven que el periodo');

/* La pregunta que responde `parcial` es: ¿pudo cerrarse algo en este periodo
   sin que quedara registrado? Se contesta comparando el inicio del historial
   con el del periodo, y se peca de conservador a propósito. */
ok(panel({ expedientes: [C], historial: [paso('C', 'nuevo', null, iso(2026, 7, 25))] }).historial.parcial === true,
  'si el historial empieza el 25 de julio, julio va marcado como PARCIAL',
  'los cierres anteriores a esa fecha no constan en ningún sitio');

// Con una fila de junio, julio ya está cubierto de principio a fin.
const conJunio = panel({ expedientes: [A], historial: [paso('A', 'nuevo', null, iso(2026, 6, 20))].concat(histA) });
ok(conJunio.historial.parcial === false,
  'con el historial arrancando en junio, julio está cubierto entero');
ok(+conJunio.historial.desde === +new Date(iso(2026, 6, 20)),
  'y se informa de desde cuándo hay historial, para poder decirlo en pantalla');

ok(panel({ expedientes: [A] }).historial.parcial === true,
  'sin ninguna fila de historial, el periodo es parcial por definición');

/* ============================================================ */
console.log('\n' + '='.repeat(56));
if (fallos) {
  console.log(`${fallos} comprobación(es) FALLIDA(S). No se mergea.\n`);
  process.exit(1);
}
console.log('Todo correcto: el panel cuenta lo que hay y calla lo que no.\n');
