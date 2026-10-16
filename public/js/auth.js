// Páginas de inicio de sesión y registro.
import { api, slugify } from "./api.js";
import { clearFieldErrors, formAlert, readForm, render, setBusy, showErrors } from "./ui.js";

const page = document.body.dataset.page;

/** Solo se permite volver a páginas del panel (evita redirecciones abiertas a otros sitios). */
function nextUrl() {
  const next = new URLSearchParams(location.search).get("next");
  return next && /^\/(panel|admin)(\/|\?|#|$)/.test(next) ? next : "/panel";
}

function setupPasswordToggles() {
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    const input = document.getElementById(button.dataset.togglePassword);
    button.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
      button.querySelector("use").setAttribute("href", `/assets/icons/sprite.svg#i-${show ? "eye-off" : "eye"}`);
      input.focus();
    });
  });
}

function setupForm(form, submit) {
  render(form.querySelector('[data-slot="alert"]'), formAlert());
  form.addEventListener("input", (event) => {
    const input = event.target;
    if (input.getAttribute("aria-invalid") === "true") {
      input.removeAttribute("aria-invalid");
      form.querySelector(`[data-error-for="${CSS.escape(input.name)}"]`)?.remove();
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    clearFieldErrors(form);
    setBusy(button, true);
    try {
      await submit(readForm(form));
    } catch (error) {
      setBusy(button, false);
      showErrors(form, error);
    }
  });
}

/** Vista previa del enlace público mientras se escribe el nombre del negocio. */
function setupStorePreview() {
  const input = document.getElementById("businessName");
  const host = location.host || "pedifyai.com";
  document.querySelectorAll("[data-store-host]").forEach((element) => (element.textContent = host));
  const update = () => {
    const slug = slugify(input.value) || "tu-negocio";
    document.querySelectorAll("[data-store-slug]").forEach((element) => (element.textContent = slug));
    document.querySelectorAll("[data-store-preview]").forEach((element) => (element.textContent = `${host}/tienda/${slug}`));
  };
  input.addEventListener("input", update);
  update();
}

document.querySelectorAll("[data-year]").forEach((element) => (element.textContent = new Date().getFullYear()));
setupPasswordToggles();

// Si ya hay una sesión válida, ir directo al panel (en recuperar/restablecer se deja seguir).
if (page === "login" || page === "register") {
  api("/auth/me")
    .then(() => location.replace(nextUrl()))
    .catch(() => {});
}

if (page === "login") {
  setupForm(document.getElementById("login-form"), async (data) => {
    await api("/auth/login", { method: "POST", body: { email: data.email, password: data.password } });
    location.assign(nextUrl());
  });
}

if (page === "register") {
  setupStorePreview();
  setupForm(document.getElementById("register-form"), async (data) => {
    await api("/auth/register", { method: "POST", body: data });
    location.assign("/panel?bienvenida=1");
  });
}

if (page === "forgot") {
  const form = document.getElementById("forgot-form");
  setupForm(form, async (data) => {
    await api("/auth/forgot-password", { method: "POST", body: { email: data.email } });
    // Misma respuesta exista o no la cuenta.
    document.querySelector("[data-sent-email]").textContent = data.email;
    form.classList.add("hidden");
    const sent = document.getElementById("forgot-sent");
    sent.classList.replace("hidden", "grid");
  });
}

if (page === "reset") {
  // El token viaja en la URL; se quita de la barra de direcciones para que no quede en el historial.
  const token = new URLSearchParams(location.search).get("token") ?? "";
  history.replaceState(null, "", "/restablecer");
  document.querySelector("[data-token]").value = token;
  setupForm(document.getElementById("reset-form"), async (data) => {
    await api("/auth/reset-password", { method: "POST", body: { token: data.token, newPassword: data.newPassword } });
    location.assign("/login?restablecida=1");
  });
}

if (page === "login" && new URLSearchParams(location.search).has("restablecida")) {
  const alert = document.createElement("p");
  alert.className = "rounded-[10px] border border-leaf/25 bg-leaf-soft px-3.5 py-3 text-[0.9375rem] font-medium text-leaf";
  alert.setAttribute("role", "status");
  alert.textContent = "Listo: tu contraseña cambió. Inicia sesión con la nueva.";
  document.getElementById("login-form").prepend(alert);
}
