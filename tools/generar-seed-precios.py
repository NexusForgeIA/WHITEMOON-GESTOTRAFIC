#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera deploy/install/02_seed_precios_medios.sql.

    python tools/generar-seed-precios.py

Compone el seed a partir de dos fuentes, ninguna recalculada:

  · los 45 TRAMOS (motos, motos eléctricas, quads, buggys) van embebidos
    literalmente tal y como se exportaron de `gestotrafic_precios_medios`
    del proyecto de referencia. Se cargaron a mano en su día y no salen de
    ningún fichero;
  · las 70.886 filas que tarifan POR MODELO (turismos y autocaravanas)
    salen de los TSV de `data/boe/`, que son el volcado verificado del XML
    del BOE y la fuente exacta con la que se cargó la tabla.

Al terminar imprime los agregados del seed generado. Deben coincidir con
los de la tabla real; `tools/verificar-seed.sql` trae la consulta que los
saca del servidor para comparar.

Formato: `COPY ... FROM stdin` en vez de INSERTs. Un INSERT por fila haría
un fichero mucho más grande y una carga bastante más lenta; COPY es lo que
usa cualquier volcado de Postgres.
"""
import io
import os
import sys
import hashlib

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, 'deploy', 'install', '02_seed_precios_medios.sql')

FUENTES = [
    ('turismo',      'anexo1-turismos-2026.tsv',      'BOE-A-2025-26357 · Anexo I · turismos y todo terreno'),
    ('autocaravana', 'anexo1-autocaravanas-2026.tsv', 'BOE-A-2025-26357 · Anexo I · autocaravanas'),
]

ORDEN_BOE = 'HAC/1501/2025'

# Export literal de las filas por tramo del proyecto de referencia.
TRAMOS = """('buggy',0,250,null,null,'Hasta 250 c.c.','1650.00','HAC/1501/2025'),
  ('buggy',251,450,null,null,'De 250,01 a 450 c.c.','3950.00','HAC/1501/2025'),
  ('buggy',451,550,null,null,'De 450,01 a 550 c.c.','9650.00','HAC/1501/2025'),
  ('buggy',551,750,null,null,'De 550,01 a 750 c.c.','13600.00','HAC/1501/2025'),
  ('buggy',751,1000,null,null,'De 750,01 a 1.000 c.c.','18000.00','HAC/1501/2025'),
  ('buggy',1001,null,null,null,'De 1.000,01 c.c. y superior','23150.00','HAC/1501/2025'),
  ('moto',0,50,null,null,'Hasta 50 c.c.','950.00','HAC/1501/2025'),
  ('moto',51,75,null,null,'De 50,01 a 75 c.c.','1150.00','HAC/1501/2025'),
  ('moto',76,125,null,null,'De 75,01 a 125 c.c.','1600.00','HAC/1501/2025'),
  ('moto',126,150,null,null,'De 125,01 a 150 c.c.','1700.00','HAC/1501/2025'),
  ('moto',151,200,null,null,'De 150,01 a 200 c.c.','1900.00','HAC/1501/2025'),
  ('moto',201,250,null,null,'De 200,01 a 250 c.c.','2250.00','HAC/1501/2025'),
  ('moto',251,350,null,null,'De 250,01 a 350 c.c.','3100.00','HAC/1501/2025'),
  ('moto',351,450,null,null,'De 350,01 a 450 c.c.','3800.00','HAC/1501/2025'),
  ('moto',451,550,null,null,'De 450,01 a 550 c.c.','4150.00','HAC/1501/2025'),
  ('moto',551,750,null,null,'De 550,01 a 750 c.c.','6700.00','HAC/1501/2025'),
  ('moto',751,1000,null,null,'De 750,01 a 1.000 c.c.','10000.00','HAC/1501/2025'),
  ('moto',1001,1200,null,null,'De 1.000,01 a 1.200 c.c.','12550.00','HAC/1501/2025'),
  ('moto',1201,null,null,null,'De 1.200,01 c.c. y superior','15500.00','HAC/1501/2025'),
  ('moto_electrica',null,null,0.00,2.00,'Hasta 2 kW (2,71 cv)','1400.00','HAC/1501/2025'),
  ('moto_electrica',null,null,2.01,4.00,'De 2,01 a 4 kW (5,4 cv)','2000.00','HAC/1501/2025'),
  ('moto_electrica',null,null,4.01,6.00,'De 4,01 a 6 kW (8,2 cv)','2700.00','HAC/1501/2025'),
  ('moto_electrica',null,null,6.01,9.00,'De 6,01 a 9 kW (12 cv)','3700.00','HAC/1501/2025'),
  ('moto_electrica',null,null,9.01,12.00,'De 9,01 a 12 kW (16 cv)','4500.00','HAC/1501/2025'),
  ('moto_electrica',null,null,12.01,15.00,'De 12,01 a 15 kW (20 cv)','5200.00','HAC/1501/2025'),
  ('moto_electrica',null,null,15.01,20.00,'De 15,01 a 20 kW (27 cv)','6000.00','HAC/1501/2025'),
  ('moto_electrica',null,null,20.01,25.00,'De 20,01 a 25 kW (34 cv)','6700.00','HAC/1501/2025'),
  ('moto_electrica',null,null,25.01,30.00,'De 25,01 a 30 kW (41 cv)','8500.00','HAC/1501/2025'),
  ('moto_electrica',null,null,30.01,40.00,'De 30,01 a 40 kW (54 cv)','10900.00','HAC/1501/2025'),
  ('moto_electrica',null,null,40.01,55.00,'De 40,01 a 55 kW (75 cv)','12300.00','HAC/1501/2025'),
  ('moto_electrica',null,null,55.01,75.00,'De 55,01 a 75 kW (102 cv)','17800.00','HAC/1501/2025'),
  ('moto_electrica',null,null,75.01,90.00,'De 75,01 a 90 kW (122 cv)','20300.00','HAC/1501/2025'),
  ('moto_electrica',null,null,90.01,null,'De 90,01 kW y superior','24400.00','HAC/1501/2025'),
  ('quad',0,50,null,null,'Hasta 50 c.c.','1250.00','HAC/1501/2025'),
  ('quad',51,75,null,null,'De 50,01 a 75 c.c.','1650.00','HAC/1501/2025'),
  ('quad',76,125,null,null,'De 75,01 a 125 c.c.','2150.00','HAC/1501/2025'),
  ('quad',126,150,null,null,'De 125,01 a 150 c.c.','2750.00','HAC/1501/2025'),
  ('quad',151,200,null,null,'De 150,01 a 200 c.c.','3400.00','HAC/1501/2025'),
  ('quad',201,250,null,null,'De 200,01 a 250 c.c.','4350.00','HAC/1501/2025'),
  ('quad',251,350,null,null,'De 250,01 a 350 c.c.','5600.00','HAC/1501/2025'),
  ('quad',351,450,null,null,'De 350,01 a 450 c.c.','7200.00','HAC/1501/2025'),
  ('quad',451,550,null,null,'De 450,01 a 550 c.c.','8900.00','HAC/1501/2025'),
  ('quad',551,750,null,null,'De 550,01 a 750 c.c.','11450.00','HAC/1501/2025'),
  ('quad',751,1000,null,null,'De 750,01 a 1.000 c.c.','15400.00','HAC/1501/2025'),
  ('quad',1001,null,null,null,'De 1.000,01 c.c. y superior','19150.00','HAC/1501/2025')"""

# Orden de columnas del COPY. `id` y `created_at` se dejan a la base: son
# claves internas, no las referencia nada entre instalaciones.
COLUMNAS = ['tipo_vehiculo', 'marca', 'modelo', 'denominacion',
            'periodo_desde', 'periodo_hasta', 'cilindrada', 'num_cilindros',
            'combustible', 'potencia_kw', 'cvf', 'potencia_cv',
            'valor_base_euros', 'orden_boe', 'fuente']

CABECERA = """-- ============================================================
-- GestoTrafic · precios medios del Anexo I
-- ------------------------------------------------------------
-- Orden HAC/1501/2025 (BOE-A-2025-26357), vigente desde 2026-01-01.
--
-- {total} filas:
--   {turismo:>6}  turismo        marca / modelo / version
--   {autocaravana:>6}  autocaravana   marca / modelo / version
--       45  tramos         moto, moto_electrica, quad, buggy
--
-- Generado por tools/generar-seed-precios.py. NO editar a mano: si hay
-- que rehacerlo, se regenera desde los TSV de data/boe/.
--
-- IDEMPOTENTE por Orden: borra lo que ya hubiera de HAC/1501/2025 antes
-- de cargar, asi que aplicarlo dos veces deja las mismas {total} filas.
-- Las filas de OTRAS Ordenes no se tocan: un expediente abierto puede
-- estar calculado con la anterior.
--
-- Aplicar:  psql "$DB_URL" -v ON_ERROR_STOP=1 -f 02_seed_precios_medios.sql
-- ============================================================

begin;

delete from public.gestotrafic_precios_medios where orden_boe = '{orden}';

-- Tramos: export literal del proyecto de referencia.
insert into public.gestotrafic_precios_medios
  (tipo_vehiculo, cilindrada_min, cilindrada_max, potencia_kw_min, potencia_kw_max,
   tramo_etiqueta, valor_base_euros, orden_boe)
values
  {tramos};

-- Turismos y autocaravanas. COPY en vez de INSERT: mismo dato, fichero
-- mucho mas pequeno y carga bastante mas rapida.
copy public.gestotrafic_precios_medios
  ({columnas})
from stdin;
"""

PIE = """\\.

commit;

-- Comprobacion rapida tras cargar:
--   select tipo_vehiculo, count(*) from gestotrafic_precios_medios
--   where orden_boe = '{orden}' group by 1 order by 1;
"""


def escapar(v):
    """Formato texto de COPY: \\N para nulo y escape de los separadores."""
    if v == '':
        return '\\N'
    return (v.replace('\\', '\\\\').replace('\t', '\\t')
             .replace('\n', '\\n').replace('\r', '\\r'))


def main():
    filas_por_tipo = {}
    lineas = []
    # Agregados para poder comparar el seed con la tabla real.
    agr = {'n': 0, 'texto': hashlib.md5(),
           'sumas': {c: 0.0 for c in ['cilindrada', 'num_cilindros', 'potencia_kw',
                                      'cvf', 'potencia_cv', 'valor_base_euros',
                                      'periodo_desde', 'periodo_hasta']},
           'nulos': {c: 0 for c in COLUMNAS}}

    for tipo, fichero, fuente in FUENTES:
        ruta = os.path.join(RAIZ, 'data', 'boe', fichero)
        if not os.path.exists(ruta):
            print(f'FALTA el fichero de origen: {ruta}', file=sys.stderr)
            return 2
        with io.open(ruta, encoding='utf-8') as f:
            cab = f.readline().rstrip('\n').split('\t')
            idx = {c: i for i, c in enumerate(cab)}
            n = 0
            for linea in f:
                p = linea.rstrip('\n').split('\t')
                if len(p) != len(cab):
                    print(f'fila con {len(p)} campos en {fichero}', file=sys.stderr)
                    return 1
                # COLUMNAS[1:13] = de `marca` a `valor_base_euros`; los dos
                # últimos (orden_boe y fuente) no vienen del TSV.
                valores = [tipo] + [p[idx[c]] for c in COLUMNAS[1:13]] + [ORDEN_BOE, fuente]
                assert len(valores) == len(COLUMNAS)
                lineas.append('\t'.join(escapar(v) for v in valores))
                n += 1

                agr['n'] += 1
                agr['texto'].update(('|'.join(valores[:4])).encode('utf-8'))
                for c in agr['sumas']:
                    v = p[idx[c]] if c in idx else ''
                    if v:
                        agr['sumas'][c] += float(v)
                for i, c in enumerate(COLUMNAS):
                    if valores[i] == '':
                        agr['nulos'][c] += 1
        filas_por_tipo[tipo] = n

    total = sum(filas_por_tipo.values()) + 45
    with io.open(SALIDA, 'w', encoding='utf-8', newline='\n') as f:
        f.write(CABECERA.format(total=total, orden=ORDEN_BOE, tramos=TRAMOS,
                                columnas=', '.join(COLUMNAS), **filas_por_tipo))
        f.write('\n'.join(lineas))
        f.write('\n')
        f.write(PIE.format(orden=ORDEN_BOE))

    print(f'Escrito  : {SALIDA}')
    print(f'Tamano   : {os.path.getsize(SALIDA) // 1024} KB')
    print(f'Filas    : {total}  ({filas_por_tipo} + 45 tramos)')
    print()
    print('--- agregados de turismo + autocaravana (comparar con la tabla real) ---')
    print(f'filas          : {agr["n"]}')
    print(f'md5 del texto  : {agr["texto"].hexdigest()}')
    for c, v in agr['sumas'].items():
        print(f'suma {c:<16}: {v:.2f}')
    print('nulos          : ' + str({k: v for k, v in agr['nulos'].items() if v}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
