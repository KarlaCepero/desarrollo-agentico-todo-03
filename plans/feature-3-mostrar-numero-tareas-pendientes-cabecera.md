# Feature: mostrar el número de tareas pendientes en la cabecera

## Encargo y criterios de aceptación

Encargo: issue #3 (https://github.com/KarlaCepero/desarrollo-agentico-todo-03/issues/3), «Mostrar el número de tareas pendientes en la cabecera». La cabecera de la lista muestra solo el total («3 tareas en tu lista»); se pide mostrar junto al total cuántas siguen pendientes, p. ej. «3 tareas en tu lista · 2 pendientes».

Criterios de aceptación (explícitos en la issue):

1. Con tareas pendientes, la cabecera muestra el número de pendientes junto al total.
2. Singular y plural correctos: «1 pendiente» / «2 pendientes».
3. Si todas están completadas, se muestra «0 pendientes».
4. Con la lista vacía se mantiene el estado vacío actual.
5. Tests de acciones que cubran los casos anteriores.

Inferencias (no explícitas en la issue):

- «Se mantiene el estado vacío actual» se interpreta como: con 0 tareas la cabecera sigue mostrando exactamente «0 tareas en tu lista», **sin** el sufijo de pendientes, y el mensaje «No hay tareas todavía…» no cambia.
- El separador es ` · ` (espacio, punto medio U+00B7, espacio), tal como aparece en el ejemplo de la issue.
- «Pendiente» = tarea con `Completed == false`.

## Comportamiento actual y propuesta

Actual (`templates/tasks/index.plush.html:3-5`):

```html
<p class="list-count">
  <%= len(tasks) %> <%= if (len(tasks) == 1) { %>tarea en tu lista<% } else { %>tareas en tu lista<% } %>
</p>
```

La plantilla la renderizan dos acciones: `TasksIndex` (GET `/`) y la rama de error de validación de `TasksCreate` (422), ambas en `actions/tasks.go`, y ambas pasan `tasks` (`models.Tasks`) al contexto.

Propuesta: añadir a `models.Tasks` un método `PendingCount() int` y usarlo desde la plantilla. Con eso, las dos acciones que renderizan la plantilla obtienen el contador sin cambios en `actions/tasks.go`. Tampoco hace falta otra consulta SQL: las tareas ya están cargadas.

Resultado esperado por caso:

| Tareas (pendientes/total) | Cabecera |
|---|---|
| 0/0 | `0 tareas en tu lista` (sin cambios) |
| 1/1 | `1 tarea en tu lista · 1 pendiente` |
| 2/3 | `3 tareas en tu lista · 2 pendientes` |
| 0/2 | `2 tareas en tu lista · 0 pendientes` |

## Alcance

Incluido:

- Método `PendingCount` en `models.Tasks`.
- Texto de pendientes en la cabecera de `templates/tasks/index.plush.html`.
- Tests de acciones para los cuatro casos de la tabla y un test unitario del método.

Excluido (por la issue o por innecesario):

- Filtros por estado.
- Actualizar el contador en el navegador sin recargar al completar una tarea (`public/assets/app.js` no se toca).
- Cambios de CSS: el texto reutiliza `.list-count`.
- Migraciones, rutas o cambios en las acciones.

## Diseño por capas

- **Modelo** (`models/task.go`): `func (t Tasks) PendingCount() int` recorre la colección y cuenta las tareas con `!Completed`. Es una función pura y no usa la base de datos.
- **Plantilla** (`templates/tasks/index.plush.html`): con `len(tasks) > 0`, añade tras el total ` · N pendiente` o ` · N pendientes` (singular solo si N == 1). El texto debe quedar contiguo en el HTML generado, sin saltos de línea entre el total y el sufijo, para que los tests puedan buscar la cadena exacta.

## Archivos relevantes

- `models/task.go`: define `Task` y `Tasks`. Aquí va `PendingCount`.
- `models/task_test.go`: tests del modelo (`ModelSuite`). Aquí va el test de `PendingCount`.
- `templates/tasks/index.plush.html`: cabecera `.list-count`. Aquí va el cambio visible.
- `actions/tasks.go`: `TasksIndex` y `TasksCreate` (rama 422) renderizan la plantilla. Solo se consulta, no se modifica.
- `actions/tasks_test.go`: tests de acciones (`ActionSuite`). Aquí van los tests nuevos.
- `fixtures/tasks.toml`: escenario «tres tareas» (2 pendientes, 1 completada). Se reutiliza.

## Implementación paso a paso

1. En `models/task.go`, tras `type Tasks []Task`, añadir:

   ```go
   // PendingCount devuelve cuántas tareas de la colección siguen sin completar.
   func (t Tasks) PendingCount() int {
       n := 0
       for _, task := range t {
           if !task.Completed {
               n++
           }
       }
       return n
   }
   ```

2. En `templates/tasks/index.plush.html`, sustituir el contenido de `<p class="list-count">` por una sola línea equivalente a:

   ```html
   <p class="list-count">
     <%= len(tasks) %> <%= if (len(tasks) == 1) { %>tarea en tu lista<% } else { %>tareas en tu lista<% } %><%= if (len(tasks) > 0) { %><% let pending = tasks.PendingCount() %> · <%= pending %> <%= if (pending == 1) { %>pendiente<% } else { %>pendientes<% } %><% } %>
   </p>
   ```

   Si Plush no resuelve la llamada al método sobre `tasks`, recurrir a la alternativa mínima: `c.Set("pending", tasks.PendingCount())` en `TasksIndex` y en la rama 422 de `TasksCreate`, y usar `pending` en la plantilla. Mismo comportamiento.

3. En `models/task_test.go`, añadir `Test_Tasks_PendingCount`. Con una colección vacía devuelve 0; con `Tasks{{Completed: false}, {Completed: true}, {Completed: false}}` devuelve 2; con todas completadas devuelve 0.

4. En `actions/tasks_test.go`, añadir:
   - `Test_TasksIndex_PendingCount`: `LoadFixture("tres tareas")`, GET `/`, 200, el cuerpo contiene `3 tareas en tu lista · 2 pendientes`.
   - `Test_TasksIndex_PendingCount_Singular`: crear una tarea pendiente, GET `/`, el cuerpo contiene `1 tarea en tu lista · 1 pendiente` y no contiene `1 pendientes`.
   - `Test_TasksIndex_PendingCount_AllCompleted`: crear dos tareas con `Completed: true`, GET `/`, el cuerpo contiene `2 tareas en tu lista · 0 pendientes`.
   - Ampliar `Test_TasksIndex_EmptyState`: además del mensaje vacío, el cuerpo contiene `0 tareas en tu lista` y no contiene `pendiente`.
   - `Test_TasksCreate_Invalid_ShowsPendingCount`: con el fixture, POST `/tasks` con título vacío, 422, el cuerpo contiene `3 tareas en tu lista · 2 pendientes`. Cubre la segunda acción que renderiza la plantilla.

## Tests y validación

Requieren PostgreSQL con `todo_test` y sus migraciones (`soda migrate -e test`), `GO_ENV=test`.

- `gofmt -l .` → salida vacía.
- `go vet ./...`.
- `go test -count=1 -p 1 ./...`: los tests nuevos pasan y los existentes siguen en verde, en especial `Test_TasksIndex_ListsTasks` y `Test_TasksIndex_EmptyState`.
- `go build ./...`.

Comprobación manual opcional: abrir `/` con tareas mixtas y verificar el texto de la cabecera.

## Riesgos y recuperación

- **Llamada a método en Plush**: si `tasks.PendingCount()` no se evalúa en la plantilla, se aplica la alternativa del paso 2 (`c.Set("pending", …)` en las dos acciones). El síntoma sería un error de render en los tests de acciones.
- **Espacios en el HTML**: si la plantilla parte el texto en varias líneas, los `Contains` exactos fallan. Mantener el total y el sufijo en la misma línea.
- **Codificación del «·»**: el archivo es UTF-8 y el layout ya sirve texto con tildes; el test compara la misma cadena UTF-8. Si se escapara como entidad HTML, el test fallaría y habría que usar el carácter literal.
- **Contador desactualizado tras el toggle asíncrono**: `app.js` actualiza la tarea sin recargar, así que el contador queda desfasado hasta recargar. La issue lo excluye de forma explícita; queda como pendiente conocido.
- Recuperación: el cambio no toca datos ni esquema. Revertir el commit lo deshace por completo.
