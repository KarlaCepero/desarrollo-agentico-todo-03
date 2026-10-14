// Refleja en la tarea el estado de completada indicado.
function renderCompletion(form, completed) {
  var task = form.closest(".task");
  var button = form.querySelector("button");
  var status = task.querySelector(".task-status");

  var label = completed ? "Reabrir" : "Completar";
  button.querySelector(".toggle-label").textContent = label;
  button.setAttribute("aria-pressed", String(completed));
  button.setAttribute("aria-label", label + " tarea: " + task.querySelector(".task-title").textContent);
  button.setAttribute("title", label + " tarea");

  if (completed && !status) {
    status = document.createElement("span");
    status.className = "task-status";
    status.textContent = "Completada";
    task.insertBefore(status, task.querySelector(".task-actions"));
  } else if (!completed && status) {
    status.remove();
  }
}

// Pide confirmación antes de enviar formularios marcados con data-confirm.
document.addEventListener("submit", function (event) {
  var form = event.target;
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
    event.preventDefault();
  }

  if (!form.matches("[data-task-toggle]")) {
    return;
  }

  event.preventDefault();

  var task = form.closest(".task");
  var completed = task.classList.toggle("task-completed");
  renderCompletion(form, completed);

  // Envía la misma petición que el formulario (POST con _method=PUT y token CSRF)
  // y revierte la pantalla si el servidor no la confirma.
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
});
