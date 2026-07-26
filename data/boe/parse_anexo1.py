#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extrae del Anexo I del BOE los precios medios que se tarifan por modelo.

    python data/boe/parse_anexo1.py <xml> turismo      data/boe/anexo1-turismos-2026.tsv
    python data/boe/parse_anexo1.py <xml> autocaravana data/boe/anexo1-autocaravanas-2026.tsv

Fuente: Orden HAC/1501/2025 (BOE-A-2025-26357), vigente desde el 1-1-2026.
Descarga:
    curl -L -o data/boe/precios-medios-2026.xml \
      "https://www.boe.es/diario_boe/xml.php?id=BOE-A-2025-26357"

REGLA DE ORO
------------
No se genera, estima ni interpola ningún valor. Toda celda que no encaje con
su patrón esperado se registra como anomalía y su campo queda a NULL; si la
celda que falla es el importe o la denominación, la fila entera se descarta.
El script termina con código 1 si aparece cualquier anomalía, para que una
recarga anual no pase inadvertida.

ESTRUCTURA DEL ANEXO I (verificada sobre el XML, no supuesta)
------------------------------------------------------------
El documento trae 204 <table> con celdas reales (no imágenes), en este orden:

    0-111    turismos y todo terreno, una tabla por marca (ABARTH … ZHIDOU)
    112-188  autocaravanas, que reinician el alfabeto (ACE … WINGAMM)
    189-192  motos eléctricas, motos de combustión, quads y buggys (por tramo)
    193-203  Anexos II y III (náutica) y las tablas de depreciación

Las dos primeras secciones se tarifan por marca/modelo y son las que saca este
script. Comparten estructura: 10 columnas por fila, en orden

    0 Modelo-Tipo   1 Inicio   2 Fin   3 C.C.   4 N.º cilind.
    5 Tipo motor    6 P kW     7 cvf   8 cv     9 Valor euros

pero **NO comparten depreciación**: el Anexo IV aplica a las autocaravanas una
tabla propia de 18 tramos, distinta de la de 13 de los turismos. Por eso salen
a ficheros separados y se cargan con `tipo_vehiculo` distinto.

El punto es separador de millares tanto en el importe como en cv (los únicos
cv con punto son 1.001, 1.020 y 1.080, de coches de más de 700 kW; el máximo
de P kW del anexo es 794, así que ningún kW llega a los millares).
"""
import html
import io
import re
import sys
from collections import Counter

# Códigos de la leyenda del propio Anexo I:
#   G/D/M/S/Elc/H = Gasolina/Diésel/Etanol+Gasolina o Bio/Gasolina GLP/
#                   Eléctrico/Hidrógeno
#   PHEV = híbrido enchufable · GyE/DyE/SyE = híbridos no enchufables
# (la sección de autocaravanas usa un subconjunto: no lista PHEV, H ni SyE)
CODIGOS_MOTOR = {'G', 'D', 'M', 'S', 'Elc', 'H', 'PHEV', 'GyE', 'DyE', 'SyE'}

# Ningún código difiere de otro solo por la caja, así que se puede reconocer
# sin distinguirla. Hace falta: el BOE escribe 'd' en la VW California 1.9D.
CODIGOS_POR_CAJA = {c.lower(): c for c in CODIGOS_MOTOR}

# Límites de cada sección, ambos inclusive. Verificados contra los títulos del
# propio documento: la 111 es "Marca: ZHIDOU" y justo después viene el epígrafe
# "Precios medios de autocaravanas usadas…"; la 188 es "Marca: WINGAMM" y la
# 189 ya es la tabla de ciclomotores eléctricos.
SECCIONES = {
    'turismo':      (0, 111),
    'autocaravana': (112, 188),
}

COLUMNAS = ['marca', 'modelo', 'denominacion', 'periodo_desde', 'periodo_hasta',
            'cilindrada', 'num_cilindros', 'combustible', 'potencia_kw', 'cvf',
            'potencia_cv', 'valor_base_euros']


def limpiar(fragmento):
    """Quita etiquetas, resuelve entidades y normaliza espacios (incl. nbsp)."""
    s = html.unescape(re.sub(r'<[^>]+>', '', fragmento))
    s = s.replace('\xa0', ' ').replace(' ', ' ').replace(' ', ' ')
    return re.sub(r'\s+', ' ', s).strip()


class Extractor:
    def __init__(self):
        self.anomalias = []
        self.normalizados = []      # códigos reconocidos salvando la caja

    def anota(self, ctx, campo, crudo, motivo):
        tabla, marca, fila = ctx
        self.anomalias.append(
            f'tabla {tabla} ({marca}) fila {fila} · {campo}: {motivo} · crudo={crudo!r}')

    def entero(self, v, ctx, campo):
        if v == '':
            return None
        if re.fullmatch(r'\d+', v):
            return int(v)
        self.anota(ctx, campo, v, 'no es un entero')
        return None

    def anio(self, v, ctx, campo):
        if v == '':
            return None
        if re.fullmatch(r'(19|20)\d{2}', v):
            return int(v)
        self.anota(ctx, campo, v, 'no es un año de 4 dígitos')
        return None

    def decimal(self, v, ctx, campo):
        """'10,61' -> '10.61'. Coma decimal, sin separador de millares."""
        if v == '':
            return None
        if re.fullmatch(r'\d+,\d+', v):
            return v.replace(',', '.')
        if re.fullmatch(r'\d+', v):
            return v
        self.anota(ctx, campo, v, 'no es un decimal con coma')
        return None

    def millares(self, v, ctx, campo, obligatorio):
        """'33.400' -> 33400. El punto solo puede ser separador de millares."""
        if v == '':
            if obligatorio:
                self.anota(ctx, campo, v, 'vacío en un campo obligatorio')
            return None
        if re.fullmatch(r'\d{1,3}(\.\d{3})*', v):
            return int(v.replace('.', ''))
        self.anota(ctx, campo, v, 'formato numérico no reconocido')
        return None


def extraer(ruta_xml, seccion):
    primera, ultima = SECCIONES[seccion]
    data = io.open(ruta_xml, encoding='utf-8').read()
    cuerpo = data[data.find('<texto>'):]
    tablas = [m.group(0) for m in re.finditer(r'<table\b.*?</table>', cuerpo, re.S)]

    ex = Extractor()
    filas = []
    descartadas = 0

    for ti in range(primera, ultima + 1):
        if ti >= len(tablas):
            ex.anota((ti, '?', '-'), 'tabla', '', 'el documento tiene menos tablas de las esperadas')
            break
        tabla = tablas[ti]

        cabecera = re.search(r'<th\b[^>]*>(.*?)</th>', tabla, re.S)
        cabecera = limpiar(cabecera.group(1)) if cabecera else ''
        m = re.fullmatch(r'Marca:\s*(.+)', cabecera)
        if not m:
            # Si esto salta, los límites de la sección han cambiado en la Orden
            # nueva: hay que volver a mirar el documento antes de cargar nada.
            ex.anota((ti, '?', '-'), 'cabecera', cabecera, 'la tabla no declara una marca')
            continue
        marca = m.group(1).strip()

        cuerpo_tabla = re.search(r'<tbody.*?</tbody>', tabla, re.S)
        if not cuerpo_tabla:
            ex.anota((ti, marca, '-'), 'tbody', '', 'tabla sin cuerpo')
            continue

        for fi, tr in enumerate(re.findall(r'<tr\b.*?</tr>', cuerpo_tabla.group(0), re.S)):
            celdas = [limpiar(c) for c in re.findall(r'<td\b[^>]*>(.*?)</td>', tr, re.S)]
            ctx = (ti, marca, fi)

            if len(celdas) != 10:
                ex.anota(ctx, 'fila', ' | '.join(celdas), f'{len(celdas)} celdas, se esperaban 10')
                descartadas += 1
                continue

            modelo_tipo = celdas[0]
            if not modelo_tipo:
                ex.anota(ctx, 'modelo_tipo', '', 'denominación vacía')
                descartadas += 1
                continue

            motor = celdas[5]
            if motor not in CODIGOS_MOTOR:
                canonico = CODIGOS_POR_CAJA.get(motor.lower())
                if canonico:
                    # Solo cambia la caja: el código sigue siendo el del BOE.
                    ex.normalizados.append(f'{marca} · {celdas[0]}: {motor!r} -> {canonico!r}')
                    motor = canonico
                else:
                    ex.anota(ctx, 'tipo_motor', motor, 'código fuera de la leyenda del anexo')
                    motor = None

            valor = ex.millares(celdas[9], ctx, 'valor', obligatorio=True)
            if valor is None:
                descartadas += 1
                continue

            filas.append({
                'marca': marca,
                # Agrupador de NAVEGACIÓN: primer token literal de Modelo-Tipo.
                # El BOE no descompone el modelo, así que esto no es un dato
                # suyo y NUNCA interviene en la valoración: solo sirve para
                # que el desplegable del CRM no liste 61.000 denominaciones.
                'modelo': modelo_tipo.split(' ')[0],
                # Identidad fiscal: la cadena Modelo-Tipo tal cual la publica el BOE.
                'denominacion': modelo_tipo,
                'periodo_desde': ex.anio(celdas[1], ctx, 'inicio'),
                'periodo_hasta': ex.anio(celdas[2], ctx, 'fin'),
                'cilindrada': ex.entero(celdas[3], ctx, 'cc'),
                'num_cilindros': ex.entero(celdas[4], ctx, 'cilindros'),
                'combustible': motor,
                'potencia_kw': ex.entero(celdas[6], ctx, 'kw'),
                'cvf': ex.decimal(celdas[7], ctx, 'cvf'),
                'potencia_cv': ex.millares(celdas[8], ctx, 'cv', obligatorio=False),
                'valor_base_euros': valor,
            })

    return filas, descartadas, ex


def escribir_tsv(filas, ruta):
    with io.open(ruta, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\t'.join(COLUMNAS) + '\n')
        for fila in filas:
            f.write('\t'.join('' if fila[c] is None else str(fila[c]) for c in COLUMNAS) + '\n')


def main():
    if len(sys.argv) != 4 or sys.argv[2] not in SECCIONES:
        print(__doc__)
        print(f'Secciones válidas: {", ".join(SECCIONES)}')
        return 2
    ruta_xml, seccion, ruta_tsv = sys.argv[1], sys.argv[2], sys.argv[3]

    filas, descartadas, ex = extraer(ruta_xml, seccion)
    anomalias = ex.anomalias

    # Ninguna denominación puede llevar tabulador o salto: rompería el TSV.
    for fila in filas:
        if '\t' in fila['denominacion'] or '\n' in fila['denominacion']:
            anomalias.append(f'denominación con tabulador o salto: {fila["denominacion"]!r}')

    escribir_tsv(filas, ruta_tsv)

    marcas = sorted({f['marca'] for f in filas})
    print(f'Sección        : {seccion} (tablas {SECCIONES[seccion][0]}-{SECCIONES[seccion][1]})')
    print(f'Filas          : {len(filas)}')
    print(f'Descartadas    : {descartadas}')
    print(f'Marcas         : {len(marcas)}')
    print(f'Combustible    : {dict(Counter(f["combustible"] for f in filas).most_common())}')
    print(f'Valor min/max  : {min(f["valor_base_euros"] for f in filas)} / '
          f'{max(f["valor_base_euros"] for f in filas)}')
    print(f'Salida         : {ruta_tsv}')

    if ex.normalizados:
        # No es una anomalía —el código es el del BOE— pero se deja constancia.
        print(f'\nCódigos de motor normalizados de caja ({len(ex.normalizados)}):')
        for n in ex.normalizados[:20]:
            print('  ' + n)

    if anomalias:
        print(f'\nANOMALÍAS ({len(anomalias)}) — revisar antes de cargar:')
        for a in anomalias[:50]:
            print('  ' + a)
        return 1
    print('\nSin anomalías.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
