# Bug: completar o reabrir una tarea desde la lista no se guarda

## Encargo y resultado esperado

Encargo (literal): «Al marcar una tarea como completada (o reabrirla) desde la lista, el cambio solo se ve en pantalla y no se guarda; al recargar la página la tarea vuelve a su estado anterior.»

Resultado esperado:

1. Pulsar el botón de completar/reabrir de una tarea cambia su estado en pantalla **y** lo persiste en la base de datos.
2. Al recargar la página, la tarea conserva el estado elegido.
3. Si la petición al servidor falla, la pantalla no puede quedarse mostrando un estado que no se ha guardado: se revierte el cambio visual.

## Evidencia y causa raíz

Hechos observados:

- `public/assets/app.js` intercepta el envío de los formularios `[data-task-toggle]`, hace `event.preventDefault()`, actualiza la interfaz de forma optimista y termina con `fetch(form.action);`. `fetch` sin opciones envía **GET** sin cuerpo.
- `templates/tasks/index.plush.html`: el formulario de toggle es `method="POST"` con los campos ocultos `authenticity_token` y `_method=PUT`.
- `actions/app.go`: la única ruta de toggle es `app.PUT("/tasks/{task_id}/toggle", TasksToggle)`. No hay ruta GET.
- Buffalo v1.1.4 (`method_override.go`) solo convierte la petición a PUT si llega como **POST** con `_method` en el formulario.
- El middleware CSRF (`gobuffalo/middleware` v1.0.0, `csrf.go`) valida en peticiones no seguras la cabecera `X-CSRF-Token` o el campo `authenticity_token` del formulario (`PostFormValue`). En `GO_ENV=test` no se ejecuta.
- Reproducción realizada contra la app en marcha: `GET /tasks/3fa0d1cd-4b3e-4b1f-b577-91a9903ebb5f/toggle` → **404**, y `completed` sigue `false` en `todo_development`.
- `fetch` no rechaza la promesa ante un 404 y el código no inspecciona la respuesta, así que el fallo es silencioso.
- `templates/application.plush.html` carga `/assets/app.js?v=2`; el sufijo `?v=` es el mecanismo existente para invalidar la caché del navegador (el CSS usa `?v=3`).

Causa raíz: la petición asíncrona del toggle no reproduce la petición del formulario. Envía GET sin cuerpo, en lugar de POST con `_method=PUT` y `authenticity_token`, y por eso nunca alcanza `TasksToggle`.

Incertidumbres:

- No hay infraestructura de tests de JavaScript en el repositorio (no existe `package.json` ni runner). La regresión del JS se cubre con un test Go que inspecciona el asset embebido y con una comprobación manual end-to-end; ninguno de los dos ejecuta el JS en un navegador real dentro de la suite.
- No se ha verificado en qué navegadores los usuarios tienen cacheado `app.js?v=2`; por eso se sube la versión.

Reproducción mínima:

1. Abrir `/` con al menos una tarea pendiente.
2. Pulsar «Completar»: la tarea aparece completada.
3. Recargar: vuelve a pendiente. En la consola de red se ve `GET /tasks/<id>/toggle` → 404.

## Alcance

Incluido:

- Corregir la petición de `app.js` para que sea idéntica a la del formulario: `POST` a `form.action` con el cuerpo del formulario (`authenticity_token` y `_method=PUT`) codificado como `application/x-www-form-urlencoded`.
- Comprobar la respuesta y revertir el cambio visual si falla (respuesta no `ok` o error de red).
- Subir la versión del script en el layout a `app.js?v=3`.
- Tests de regresión.

Excluido:

- Cambiar rutas, `TasksToggle`, el formulario HTML o el CSS.
- Añadir dependencias o un runner de tests de JavaScript.
- Cambiar la respuesta del servidor (sigue redirigiendo 303 a `/`; `fetch` la sigue y obtiene 200).
- El flujo sin JavaScript, que ya funciona: el formulario envía POST con `_method=PUT`.

## Archivos relevantes

| Ruta | Responsabilidad |
| --- | --- |
| `public/assets/app.js` | Intercepta el toggle; contiene el bug |
| `templates/application.plush.html` | Carga `app.js?v=2`; hay que subir la versión |
| `templates/tasks/index.plush.html` | Formulario de toggle (POST, `_method=PUT`, `authenticity_token`); sin cambios |
| `actions/app.go` | Ruta `PUT /tasks/{task_id}/toggle`; sin cambios |
| `actions/tasks.go` | `TasksToggle`; sin cambios |
| `actions/tasks_test.go` | Tests de regresión nuevos |
| `public/embed.go` | `public.FS()`, que los tests usan para leer el asset embebido |

## Implementación paso a paso

1. **Tests de regresión primero** (`actions/tasks_test.go`); deben fallar antes del arreglo (ver «Tests y validación»).
2. **`public/assets/app.js`**:
   - Extraer la actualización visual actual (clase `task-completed`, `toggle-label`, `aria-pressed`, `aria-label`, `title`, alta/baja de `.task-status`) a una función `renderCompletion(form, completed)` que aplique un estado dado. No cambiar lo que hace, solo encapsularlo.
   - En el manejador: calcular `completed` con `task.classList.toggle("task-completed")` como hoy, llamar a `renderCompletion(form, completed)` y sustituir `fetch(form.action);` por:

     ```js
     fetch(form.action, {
       method: "POST",
       body: new URLSearchParams(new FormData(form)),
       credentials: "same-origin",
     })
       .then(function (response) {
         if (!response.ok) {
           throw new Error("toggle failed: " + response.status);
         }
       })
       .catch(function () {
         task.classList.toggle("task-completed", !completed);
         renderCompletion(form, !completed);
       });
     ```

   - Mantener el estilo del archivo: `var`, funciones `function`, comentarios en español, sin dependencias.
3. **`templates/application.plush.html`**: cambiar `/assets/app.js?v=2` por `/assets/app.js?v=3`.
4. Ejecutar la validación.

## Tests y validación

Tests nuevos en `actions/tasks_test.go`:

- `Test_TasksToggle_FormPostWithMethodOverride`: crea una tarea pendiente y envía `POST /tasks/{id}/toggle` con cuerpo de formulario `_method=PUT` (la misma petición que debe hacer el JS; usar `as.HTML("/tasks/%s/toggle", id).Post(url.Values{"_method": {"PUT"}})`). Espera 303 y `completed == true` tras recargar. Fija el contrato del servidor del que depende el JS.
- `Test_TasksToggle_GetIsNotRouted`: `GET /tasks/{id}/toggle` responde 404 y no modifica la tarea. Documenta que el toggle nunca debe hacerse con GET.
- `Test_AppJS_ToggleUsesFormPost` (**regresión; falla antes del arreglo**): lee `assets/app.js` desde `public.FS()` con `fs.ReadFile` y comprueba que contiene `method: "POST"` y `new FormData(form)`, y que no contiene la llamada sin opciones `fetch(form.action);`.
- `Test_Layout_LoadsCurrentAppJS`: `GET /` contiene `/assets/app.js?v=3`.

Validación (contenedor `golang` Debian si no hay Go en el host, con `DB_HOST=db` y `GO_ENV=test`):

- `gofmt -l .` → vacío
- `go vet ./...`
- `soda migrate -e test`
- `go test -count=1 -p 1 ./...`
- `go build ./...`

Comprobación end-to-end (CSRF activo, solo fuera de `test`), con la app levantada mediante `docker compose up --build -d`:

1. `curl -c jar -b jar http://localhost:<puerto>/`, extraer el `authenticity_token` del HTML y el `id` de una tarea pendiente.
2. `curl -c jar -b jar -X POST -d "authenticity_token=<token>&_method=PUT" http://localhost:<puerto>/tasks/<id>/toggle` → 303.
3. `psql`: la tarea tiene `completed = true`. Repetir el paso 2 para dejarla como estaba.
4. Comprobar en el navegador: completar una tarea, recargar y ver que sigue completada.

## Riesgos y recuperación

- **Caché del navegador**: si no se sube `?v=`, los usuarios seguirían ejecutando el JS roto. El paso 3 lo cubre.
- **CSRF**: el token viaja en el cuerpo (`authenticity_token`), igual que en el formulario; el middleware lo lee con `PostFormValue`, que admite `application/x-www-form-urlencoded`. Si en el futuro se envía JSON, habría que usar la cabecera `X-CSRF-Token`.
- **Test de asset frágil**: `Test_AppJS_ToggleUsesFormPost` busca texto en el JS; un refactor legítimo puede romperlo. Es la única forma de regresión automática sin introducir un runner de JS. Si molesta, se ajusta el patrón buscado, no se elimina.
- **Respuesta tras redirección**: `fetch` sigue el 303 y descarga `/` completa. Es tráfico innecesario pero inofensivo; optimizarlo queda fuera de alcance.
- **Recuperación**: el cambio se limita a `app.js`, al layout y a los tests; revertir el commit restaura el comportamiento anterior sin migraciones ni datos afectados.
