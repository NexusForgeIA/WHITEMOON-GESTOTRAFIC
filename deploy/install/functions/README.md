# Edge Functions · dónde está el código

**Aquí no hay copias.** El código de las seis funciones vive en un solo sitio:

```
supabase/functions/
  gestotrafic-auth/index.ts          login, alta de gestores, cambio de clave
  gestotrafic-itp/index.ts           motor fiscal (Anexo IV + tipos autonómicos)
  gestotrafic-valor-base/index.ts    propone el valor base del Anexo I a Gest-IA
  gestia-extraer/index.ts            lectura de documentos con Claude
  gestotrafic-expediente/index.ts    expediente completo para el Colegio (HTML + PDF)
  gestotrafic-borrar-expediente/index.ts  borra un expediente entero, sin dejar huérfanos
```

`provision.sh` despliega desde ahí.

## Por qué no se duplican aquí

Tener dos copias del mismo fichero es tener dos ficheros que **se
desincronizan**. Y una de estas seis es `gestotrafic-itp`, que lleva la tabla
de depreciación del Anexo IV y los tipos de las 19 comunidades: si una copia se
queda atrás, la instalación de un cliente liquida impuestos con cifras viejas y
no lo detecta nadie, porque el resultado sigue *pareciendo* correcto.

El kit es igual de autocontenido: `provision.sh` sale del propio repositorio, así
que el código siempre viaja con él.

## verify_jwt de cada una

`provision.sh` lo aplica solo. Se documenta aquí porque desplegar a mano con el
valor equivocado abre o rompe el acceso:

| Función | verify_jwt | Por qué |
|---|---|---|
| `gestotrafic-auth` | **off** | Es el propio login: aún no hay sesión que verificar |
| `gestotrafic-itp` | **off** | Calculadora pura, sin datos personales ni acceso a expedientes |
| `gestia-extraer` | **on** | Lee documentos del bucket privado; además comprueba el usuario y la propiedad del expediente |
| `gestotrafic-valor-base` | **on** | Consulta las tablas de precios; además comprueba que el usuario existe y está activo |
| `gestotrafic-expediente` | **on** | Lee TODOS los documentos del expediente del bucket privado y firma los enlaces del resultado; comprueba usuario y propiedad |
| `gestotrafic-borrar-expediente` | **on** | Borra archivos, documentos y expediente; comprueba usuario y propiedad (admin cualquiera, gestor los suyos) |

Que `verify_jwt` esté en `on` **no basta**: la clave anon también es un token
válido del proyecto. Por eso las funciones sensibles vuelven a identificar al
usuario contra `gestotrafic_usuarios` antes de hacer nada.

## Variables de entorno

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` las inyecta
Supabase automáticamente en toda Edge Function: no hay que ponerlas.

La única que se configura a mano es `ANTHROPIC_API_KEY`, que usa
`gestia-extraer`. Sin ella el CRM funciona entero salvo el alta con Gest-IA.
