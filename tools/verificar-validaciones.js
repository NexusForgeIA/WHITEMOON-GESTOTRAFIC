#!/usr/bin/env node
/* ============================================================
   Verificación de las validaciones previas
   ------------------------------------------------------------
   Son AVISOS, no bloqueos, y por eso hay que comprobar las dos caras:

     · que CAZAN el error   — un NIF con la letra mal, una matrícula
       rara, un bastidor de 16, un obligatorio en blanco;
     · que NO molestan      — un expediente correcto no genera ni un
       aviso. Un validador que avisa de más se ignora, y entonces deja
       de avisar de lo que importa.

   Y sobre todo: que NO CORRIGE nada. Calcular la letra buena de un NIF y
   escribirla es exactamente cómo se inscribe a la persona equivocada.

       node tools/verificar-validaciones.js

   Sale con código 1 a la primera discrepancia.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

global.window = globalThis;
['config', 'servicio', 'tramites', 'validaciones'].forEach(m =>
  (0, eval)(fs.readFileSync(path.join(RAIZ, 'assets', 'js', m + '.js'), 'utf8')));

const V = globalThis.GTValidaciones;
const TR = globalThis.GTTramites;
if (!V || !TR) { console.error('No se pudieron cargar los módulos'); process.exit(2); }

let fallos = 0;
function ok(cond, titulo, detalle) {
  if (cond) { console.log('  ✓ ' + titulo); return true; }
  fallos++;
  console.log('  ✗ ' + titulo + (detalle ? '\n      ' + detalle : ''));
  return false;
}

console.log('\nVerificación de las validaciones previas\n' + '='.repeat(52));

/* ============================================================
   1 · NIF · la letra de control
   ============================================================ */
console.log('\n1 · DNI · letra de control');

/* 12345678 % 23 = 14 → 'Z' en TRWAGMYFPDXBNJZSQVHLCKE. Es el ejemplo que
   usa el propio CRM como placeholder, así que más vale que salga bien. */
ok(V.documento('12345678Z').valido === true, '12345678Z es válido');
ok(V.documento('12345678A').valido === false, '12345678A NO lo es (la letra buena es la Z)');
ok(/letra de control/.test(V.documento('12345678A').motivo || ''),
  'y el motivo dice que es la letra de control', V.documento('12345678A').motivo);

/* Los de la DEMO. Son ficticios, pero llevan su letra de control BIEN
   calculada a propósito: si no, todos los expedientes de demostración
   saldrían con un aviso encima y lo primero que vería quien la mira sería
   un fallo que no es un fallo. Que sigan pasando es la comprobación de
   que nadie los ha vuelto a tocar a ojo. */
ok(V.documento('00000001R').valido === true, '00000001R es válido  (1 % 23 = 1 → R)');
ok(V.documento('00000002W').valido === true, '00000002W es válido  (2 % 23 = 2 → W)');
ok(V.documento('14308839X').valido === true, '14308839X (cliente de la demo) es válido');
ok(V.documento('71640935Y').valido === true, '71640935Y (el del buscador) es válido');
ok(V.documento('39485712W').valido === true, '39485712W (Nuria Beltrán) es válido');
ok(V.documento('47712608M').valido === true, '47712608M (Rocío Palomares) es válido');
ok(V.documento('52098431G').valido === true, '52098431G (Íñigo Arrieta) es válido');
ok(V.documento('05639274L').valido === true, '05639274L (Damián Escobar) es válido');
ok(V.documento('70059284L').valido === true, '70059284L es válido');
ok(V.documento('11223344B').valido === true, '11223344B (placeholder del vendedor) es válido');

/* Y las mismas cifras con la letra cambiada NO pasan: es lo que demuestra
   que el validador sigue cazando una errata y que arriba no está diciendo
   que sí a todo. */
ok(V.documento('00000002S').valido === false, '00000002S no pasa: le corresponde la W');
ok(V.documento('71640935D').valido === false, '71640935D tampoco: le corresponde la Y');
ok(V.documento('39485712H').valido === false, '39485712H tampoco: le corresponde la W');

// Formato flexible: se teclea con puntos y guiones, y eso no es un error.
ok(V.documento('12.345.678-Z').valido === true, 'con puntos y guiones sigue siendo válido');
ok(V.documento('12345678z').valido === true, 'en minúsculas también');

/* ============================================================
   2 · NIE
   ============================================================ */
console.log('\n2 · NIE · la letra inicial cuenta como dígito');

// X1234567 → 01234567 % 23 = 10 → 'L'
ok(V.documento('X1234567L').valido === true, 'X1234567L es válido');
ok(V.documento('X1234567X').valido === false, 'X1234567X no lo es');
// Y1234567 → 11234567 % 23 = 6 → 'Y'   ·   Z1234567 → 21234567 % 23 = 2 → 'W'
ok(V.documento('Y1234567X').valido === true, 'Y1234567X es válido');
ok(V.documento('Z1234567R').valido === true, 'Z1234567R es válido');
ok(V.documento('X1234567L').tipo === 'nie', 'y se identifica como NIE', V.documento('X1234567L').tipo);

/* Un NIE y un DNI con el mismo número NO llevan la misma letra: si el
   prefijo no se convirtiera a dígito, esto pasaría por bueno. */
ok(V.documento('X1234567Z').valido === false,
  'la letra del DNI 12345678Z no vale para el NIE X1234567: el prefijo cuenta');

/* ============================================================
   3 · CIF · otro algoritmo, no un NIF con otra letra
   ============================================================ */
console.log('\n3 · CIF');

// B00000001: dígitos 0000000 → suma 0 → control 0. B admite dígito.
ok(V.documento('B00000001').valido === false, 'B00000001 no cuadra (el control sería 0)');
ok(V.documento('B00000000').valido === true, 'B00000000 sí');
ok(V.documento('B00000000').tipo === 'cif', 'y se identifica como CIF');
// Los CIF de las dos empresas de la demo, con su control bien calculado.
ok(V.documento('B85017424').valido === true, 'B85017424 (Automoción Vega del Henares) es válido');
ok(V.documento('B84720911').valido === true, 'B84720911 (Talleres Norte Motor) es válido');
// Y con el control cambiado, no pasan.
ok(V.documento('B85017423').valido === false, 'B85017423 no pasa: el control sería 4');
ok(V.documento('B84720915').valido === false, 'B84720915 tampoco: el control sería 1');
/* Las organizaciones tipo P, Q, S, N, W y R llevan LETRA de control. */
ok(V.documento('P0000000J').valido === true, 'P0000000J es válido (control por letra)');
ok(V.documento('P00000000').valido === false, 'P00000000 no: esa organización no lleva dígito');

/* ============================================================
   4 · Lo que NO se puede juzgar, no se juzga
   ============================================================ */
console.log('\n4 · Sin veredicto cuando no lo hay');

ok(V.documento('').valido === null, 'un campo vacío no es ni válido ni inválido');
ok(V.documento(null).valido === null, 'ni un null');
const raro = V.documento('AB123456');
ok(raro.valido === null, 'un documento extranjero no se declara inválido', String(raro.valido));
ok(/no tiene forma de/.test(raro.motivo || ''), 'se dice que no se reconoce el formato', raro.motivo);

/* ============================================================
   5 · Matrícula
   ============================================================ */
console.log('\n5 · Matrícula');

ok(V.matricula('4821NBH').valido === true, '4821NBH · formato europeo');
ok(V.matricula('4821 NBH').valido === true, 'con el espacio que se teclea, igual');
ok(V.matricula('4821NBH').formato === 'europea', 'y se identifica como europea');
ok(V.matricula('M0000XX').valido === true, 'M0000XX · provincial antiguo');
ok(V.matricula('M-1234-AB').valido === true, 'M-1234-AB también');
ok(V.matricula('M0000XX').formato === 'provincial', 'y se identifica como provincial');

ok(V.matricula('ABC1234').valido === false, 'ABC1234 no encaja con ninguno');
ok(V.matricula('482NBH').valido === false, '482NBH tampoco (faltan dígitos)');
ok(V.matricula('coche del cliente').valido === false, 'ni una frase suelta');
/* Las vocales no se usan en las matrículas europeas: 4821AEI sería una
   lectura mal hecha, no una matrícula. */
ok(V.matricula('4821AEI').valido === false, '4821AEI no: la serie europea no lleva vocales');
ok(V.matricula('').valido === null, 'vacía no se juzga');

/* ============================================================
   6 · Bastidor (VIN)
   ============================================================ */
console.log('\n6 · Bastidor');

ok(V.bastidor('WDD1760121J000000').valido === true, 'WDD1760121J000000 · 17 caracteres');
ok(V.bastidor('VSSZZZ1KZAW000000').valido === true, 'VSSZZZ1KZAW000000 también');

const corto = V.bastidor('WDD176012J000000');          // 16
ok(corto.valido === false, 'uno de 16 caracteres avisa', String(corto.valido));
ok(/16 caracteres/.test(corto.motivo || ''), 'y dice cuántos tiene', corto.motivo);
ok(V.bastidor('WDD1760121J0000000').valido === false, 'uno de 18 también');
ok(V.bastidor('WDD-176012-J00000').valido === false, 'con guiones, también');

/* I, O y Q no existen en un VIN: la norma las excluye para que no se
   confundan con 1 y 0. Encontrarlas es señal de lectura mal hecha. */
const conO = V.bastidor('WDD176O121J000000');
ok(conO.valido === false, 'un VIN de 17 con una O avisa igual', String(conO.valido));
ok(/I, O o Q/.test(conO.motivo || ''), 'y explica por qué', conO.motivo);
ok(conO.longitudOk === true, 'señalando que la longitud sí es correcta');
ok(V.bastidor('').valido === null, 'vacío no se juzga');

/* ============================================================
   7 · El repaso completo de un expediente
   ============================================================ */
console.log('\n7 · Repaso de un expediente de transferencia');

const trTransfer = TR.tramite('transferencia');

/* Un expediente CORRECTO no produce ni un aviso. Es la mitad que se
   olvida: un validador que avisa de más se acaba ignorando. */
const bueno = {
  marca: 'Mercedes-Benz', modelo: 'Clase A 180 d', matricula: '4821 NBH',
  fecha_matriculacion: '2019-06-10', ccaa: 'Comunidad de Madrid',
  comprador_nombre: 'Lucia Ferrer', comprador_nif: '00000002W',
  vendedor_nombre: 'Andres De La Fuente', vendedor_nif: '00000001R',
  datos: {
    bastidor: 'WDD1760121J000000',
    comprador_tipo: 'particular', vendedor_tipo: 'particular',
    cambio_servicio: 'no'
  }
};
const limpio = V.revisar(bueno, trTransfer);
ok(limpio.length === 0, 'un expediente correcto NO genera ningún aviso',
  JSON.stringify(limpio.map(a => a.campo + ': ' + a.texto)));

/* `caducidad_nif` acaba en `_nif` y es una FECHA. Un filtro por sufijo la
   metía en la revisión de documentos y sacaba dos avisos falsos por
   expediente — y un validador que avisa de más se ignora entero. */
const conCaducidad = JSON.parse(JSON.stringify(bueno));
conCaducidad.datos.comprador_caducidad_nif = '2032-05-20';
conCaducidad.datos.vendedor_caducidad_nif = '2030-01-01';
conCaducidad.datos.comprador_nacimiento = '1985-03-14';
ok(V.revisar(conCaducidad, trTransfer).length === 0,
  'las fechas de caducidad del DNI no se revisan como si fueran documentos',
  JSON.stringify(V.revisar(conCaducidad, trTransfer).map(a => a.campo + ': ' + a.texto)));

/* Y ahora el mismo con cuatro erratas: una por cada comprobación. */
const malo = JSON.parse(JSON.stringify(bueno));
malo.comprador_nif = '12345678A';          // letra mal
malo.matricula = 'ABC1234';                // formato raro
malo.datos.bastidor = 'WDD176012J000000';  // 16 caracteres
malo.fecha_matriculacion = null;           // obligatorio en blanco

const sucio = V.revisar(malo, trTransfer);
const tipos = sucio.map(a => a.tipo);
ok(sucio.length === 4, 'los cuatro errores se cazan', JSON.stringify(sucio.map(a => a.campo)));
['documento', 'matricula', 'bastidor', 'obligatorio'].forEach(t => {
  ok(tipos.indexOf(t) !== -1, `se avisa del tipo «${t}»`, JSON.stringify(tipos));
});

/* El NIF del VENDEDOR también se revisa, no solo el del comprador. */
const vendedorMal = JSON.parse(JSON.stringify(bueno));
vendedorMal.vendedor_nif = '00000001A';
const avV = V.revisar(vendedorMal, trTransfer);
ok(avV.length === 1 && avV[0].campo === 'vendedor_nif',
  'el NIF del vendedor se revisa igual que el del comprador',
  JSON.stringify(avV.map(a => a.campo)));
ok(/Nombre y apellidos|DNI|NIF/i.test(avV[0].etiqueta),
  'y el aviso trae la etiqueta del campo', avV[0].etiqueta);

/* ============================================================
   8 · Campos condicionales por trámite
   ============================================================ */
console.log('\n8 · Obligatorios por trámite');

const dup = TR.tramite('duplicado_permiso');
const sinMotivo = {
  marca: 'Seat', modelo: 'Ibiza', matricula: '4821NBH',
  titular_nombre: 'María García', titular_nif: '12345678Z', datos: {}
};
const avDup = V.revisar(sinMotivo, dup);
ok(avDup.some(a => a.campo === 'motivo'),
  'un duplicado sin motivo avisa', JSON.stringify(avDup.map(a => a.campo)));
ok(/Motivo/.test((avDup.find(a => a.campo === 'motivo') || {}).texto || ''),
  'y el aviso nombra el campo que falta');

const conMotivo = Object.assign({}, sinMotivo, { datos: { motivo: 'perdida' } });
ok(V.revisar(conMotivo, dup).length === 0, 'con el motivo puesto, sin avisos',
  JSON.stringify(V.revisar(conMotivo, dup)));

const bajaT = TR.tramite('baja_temporal');
ok(V.revisar(sinMotivo, bajaT).some(a => a.campo === 'motivo'),
  'una baja temporal sin motivo avisa igual');
ok(V.revisar(Object.assign({}, sinMotivo, { datos: { motivo: 'no_uso' } }), bajaT).length === 0,
  'y con el motivo, sin avisos');

const bajaD = TR.tramite('baja_definitiva');
ok(V.revisar(sinMotivo, bajaD).some(a => a.campo === 'motivo'),
  'la baja definitiva, lo mismo');

/* Un obligatorio OCULTO no se reclama: no se le está pidiendo a nadie. */
const trVendeEmpresa = JSON.parse(JSON.stringify(bueno));
trVendeEmpresa.datos.vendedor_tipo = 'empresa';
ok(V.revisar(trVendeEmpresa, trTransfer).every(a => a.tipo !== 'obligatorio'),
  'un obligatorio que ahora está oculto no se reclama',
  JSON.stringify(V.revisar(trVendeEmpresa, trTransfer)));

/* ============================================================
   9 · No corrige nada
   ============================================================ */
console.log('\n9 · Avisa, no corrige');

const antes = JSON.parse(JSON.stringify(malo));
V.revisar(malo, trTransfer);
ok(JSON.stringify(malo) === JSON.stringify(antes),
  'revisar() no toca el expediente: ni un carácter');

/* El aviso NO dice cuál sería la letra buena. Decirla invita a escribirla
   sin mirar el documento, que es justo el error que se quiere evitar. */
const avisoNif = V.revisar(malo, trTransfer).find(a => a.tipo === 'documento');
ok(!/\bZ\b/.test(avisoNif.texto.replace('12345678A', '')),
  'el aviso no sugiere la letra «correcta»: se comprueba con el documento',
  avisoNif.texto);
ok(/documento delante/.test(avisoNif.texto), 'y manda mirar el documento', avisoNif.texto);

/* ============================================================
   10 · Los datos de vehículo de la DEMO
   ------------------------------------------------------------
   Igual que los NIF del punto 1: son ficticios, pero están elegidos para
   PASAR. Dos expedientes de demostración se quedaron a medias —uno sin
   vehículo y una baja temporal sin motivo— y quien abría la demo veía un
   aviso encima antes que nada.

   Los datos viven en la base de la demo, no en el repo, así que lo que se
   puede fijar aquí es que las cifras concretas que se eligieron siguen
   siendo válidas. Si alguien las retoca a ojo, salta aquí y no en la demo.
   ============================================================ */
console.log('\n10 · Datos de vehículo de la demo');

/* EXP-2026-0013 · la transferencia que estaba vacía. */
ok(V.matricula('1234 KLM').valido === true, '1234 KLM es una matrícula europea válida');
ok(V.bastidor('VSSZZZ5FZLR123456').valido === true,
  'VSSZZZ5FZLR123456 · 17 caracteres y sin I, O ni Q',
  V.bastidor('VSSZZZ5FZLR123456').motivo);

const demo13 = {
  marca: 'SEAT', modelo: 'LEON', matricula: '1234 KLM',
  fecha_matriculacion: '2019-06-15', ccaa: 'Comunidad de Madrid',
  datos: { bastidor: 'VSSZZZ5FZLR123456' }
};
ok(V.revisar(demo13, trTransfer).length === 0,
  'EXP-2026-0013 con su vehículo asignado no genera ningún aviso',
  JSON.stringify(V.revisar(demo13, trTransfer).map(a => a.campo + ': ' + a.texto)));

/* La `ccaa` es obligatoria y NO se hereda del `def` del formulario: un
   expediente guardado sin ella avisa igual que si faltara la matrícula. */
const demo13SinCcaa = Object.assign({}, demo13, { ccaa: null });
ok(V.revisar(demo13SinCcaa, trTransfer).some(a => a.campo === 'ccaa'),
  'y sin CCAA vuelve a avisar: el valor por defecto del formulario no cuenta');

/* EXP-2026-0015 · la baja temporal sin motivo. El titular es el del
   buscador, con su letra ya correcta desde el arreglo de los NIF. */
const demo15 = {
  marca: 'RENAULT', modelo: 'MEGANE 1.3 TCe LIMITED', matricula: '4821 NBH',
  titular_nombre: 'ALEJANDRO SAAVEDRA MONTORO', titular_nif: '71640935Y',
  datos: { motivo: 'no_uso' }
};
ok(V.revisar(demo15, bajaT).length === 0,
  'EXP-2026-0015 con el motivo puesto no genera ningún aviso',
  JSON.stringify(V.revisar(demo15, bajaT).map(a => a.campo + ': ' + a.texto)));

/* El motivo sale de una lista CERRADA. Un texto libre por bonito que sea
   deja el desplegable sin nada seleccionado y el siguiente guardado lo
   borra: el aviso se iría de la vista sin que el dato exista de verdad.
   Por eso lo que se guarda es la clave del catálogo, no la frase. */
ok(TR.etiquetaOpcion(TR.campos(bajaT).find(c => c.n === 'motivo'), 'no_uso')
   === 'Vehículo sin uso temporal',
  'y «no_uso» es una clave del catálogo, con su etiqueta',
  TR.etiquetaOpcion(TR.campos(bajaT).find(c => c.n === 'motivo'), 'no_uso'));

/* ============================================================ */
console.log('\n' + '='.repeat(52));
if (fallos) {
  console.log(`${fallos} comprobación(es) FALLIDA(S). No se mergea.\n`);
  process.exit(1);
}
console.log('Todo correcto: avisa de lo que no cuadra y no corrige nada.\n');
