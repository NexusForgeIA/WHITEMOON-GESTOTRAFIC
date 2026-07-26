#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extrae los precios medios de turismos y todo terreno del Anexo I del BOE.

    python data/boe/parse_anexo1.py data/boe/precios-medios-2026.xml \
           data/boe/anexo1-turismos-2026.tsv

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
El documento trae 204 <table> con celdas reales (no imágenes). Las 112
primeras son los turismos y todo terreno, una por marca ("Marca: ABARTH" …
"Marca: ZHIDOU"). A partir de la 112 empieza otra sección —autocaravanas—,
que reinicia el alfabeto y tiene su PROPIA tabla de depreciación en el
Anexo IV, así que no se carga aquí.

Las 10 columnas de cada fila, en orden:

    0 Modelo-Tipo   1 Inicio   2 Fin   3 C.C.   4 N.º cilind.
    5 Tipo motor    6 P kW     7 cvf   8 cv     9 Valor euros

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
CODIGOS_MOTOR = {'G', 'D', 'M', 'S', 'Elc', 'H', 'PHEV', 'GyE', 'DyE', 'SyE'}

PRIMERA_TABLA_TURISMO = 0
ULTIMA_TABLA_TURISMO = 111          # inclusive; la 112 ya es autocaravanas

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


def extraer(ruta_xml):
    data = io.open(ruta_xml, encoding='utf-8').read()
    cuerpo = data[data.find('<texto>'):]
    tablas = [m.group(0) for m in re.finditer(r'<table\b.*?</table>', cuerpo, re.S)]

    ex = Extractor()
    filas = []
    descartadas = 0

    for ti in range(PRIMERA_TABLA_TURISMO, ULTIMA_TABLA_TURISMO + 1):
        if ti >= len(tablas):
            ex.anota((ti, '?', '-'), 'tabla', '', 'el documento tiene menos tablas de las esperadas')
            break
        tabla = tablas[ti]

        cabecera = re.search(r'<th\b[^>]*>(.*?)</th>', tabla, re.S)
        cabecera = limpiar(cabecera.group(1)) if cabecera else ''
        m = re.fullmatch(r'Marca:\s*(.+)', cabecera)
        if not m:
            # Si esto salta, la sección de turismos ya no acaba en la tabla 111:
            # hay que volver a mirar el documento antes de cargar nada.
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

    return filas, descartadas, ex.anomalias


def escribir_tsv(filas, ruta):
    with io.open(ruta, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\t'.join(COLUMNAS) + '\n')
        for fila in filas:
            f.write('\t'.join('' if fila[c] is None else str(fila[c]) for c in COLUMNAS) + '\n')


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    ruta_xml, ruta_tsv = sys.argv[1], sys.argv[2]

    filas, descartadas, anomalias = extraer(ruta_xml)

    # Ninguna denominación puede llevar tabulador o salto: rompería el TSV.
    for fila in filas:
        if '\t' in fila['denominacion'] or '\n' in fila['denominacion']:
            anomalias.append(f'denominación con tabulador o salto: {fila["denominacion"]!r}')

    escribir_tsv(filas, ruta_tsv)

    marcas = sorted({f['marca'] for f in filas})
    print(f'Filas          : {len(filas)}')
    print(f'Descartadas    : {descartadas}')
    print(f'Marcas         : {len(marcas)}')
    print(f'Combustible    : {dict(Counter(f["combustible"] for f in filas).most_common())}')
    print(f'Valor min/max  : {min(f["valor_base_euros"] for f in filas)} / '
          f'{max(f["valor_base_euros"] for f in filas)}')
    print(f'Salida         : {ruta_tsv}')

    if anomalias:
        print(f'\nANOMALÍAS ({len(anomalias)}) — revisar antes de cargar:')
        for a in anomalias[:50]:
            print('  ' + a)
        return 1
    print('\nSin anomalías.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
