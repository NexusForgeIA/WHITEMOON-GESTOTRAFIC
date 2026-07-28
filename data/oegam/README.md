# `data/oegam/`

Referencia de estructura para el exportador a OEGAM.

## `plantilla-transferencia.xml`

Fichero **FICTICIO** aportado por la gestoría: todos sus datos están
inventados y no corresponden a ninguna persona, empresa ni vehículo real.
Sirve **solo** como referencia de estructura.

De él salen, verbatim:

- los nombres de las 162 etiquetas y su **orden**,
- el anidamiento (`CABECERA` / `TRANSMISION` y sus seis bloques),
- la codificación `ISO-8859-1`,
- el formato de las fechas (cuerpo `DD/MM/AAAA`, atributo `FechaCreacion`
  `MM/DD/AAAA`),
- los tags vacíos self-closing,
- y las constantes de una transferencia estándar (`CONSTANTES` en
  `assets/js/oegam.js`).

`tools/verificar-oegam.js` compara contra este fichero: si la gestoría envía
una plantilla revisada, **se sustituye aquí** y el verificador dirá qué ha
cambiado.

> El fichero declara `ISO-8859-1` pero está guardado en UTF-8. Da igual: de
> él solo se leen nombres de etiqueta y valores ASCII, idénticos en las dos
> codificaciones. El XML que **genera** el CRM sí va en Latin-1 de verdad.

## Lo que NO está aquí y hace falta

Dos catálogos oficiales que publica OEGAM y que nadie nos ha pasado:

1. **Tipos de vía** → códigos de `SIGLAS_DIRECCION_*`. Sin él, ese campo sale
   vacío y marcado. Es el único hueco que impide un XML completo.
2. **Confirmación del código de Baleares, Girona y Ourense**, que tienen dos
   códigos históricos posibles.

No se deducen ni se aproximan: ver [`docs/OEGAM.md`](../../docs/OEGAM.md).
