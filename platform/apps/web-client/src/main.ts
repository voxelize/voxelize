import "./style.css";

import { api, ApiError } from "./api";
import { Content } from "./content";
import { startGame } from "./game";
import { Hud } from "./hud";

const form = document.getElementById("auth-form") as HTMLFormElement;
const error = document.getElementById("auth-error") as HTMLElement;
const toggle = document.getElementById("auth-toggle") as HTMLButtonElement;
const submit = document.getElementById("auth-submit") as HTMLButtonElement;
let registering = false;

toggle.addEventListener("click", () => {
  registering = !registering;
  document.body.classList.toggle("registering", registering);
  submit.textContent = registering ? "Create account" : "Sign in";
  toggle.textContent = registering ? "I already have an account" : "Create an account";
  (form.elements.namedItem("login") as HTMLInputElement).previousSibling!.textContent = registering
    ? "Username "
    : "Username or email ";
});

async function enter() {
  document.getElementById("auth")!.hidden = true;
  const content = await Content.fetch();
  const hud = new Hud(content);
  // A fresh single-use ticket for every (re)connect.
  await startGame(content, async () => (await api.ticket("main")).ticket, hud);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  const data = new FormData(form);
  const login = String(data.get("login") ?? "").trim();
  const password = String(data.get("password") ?? "");
  submit.disabled = true;
  try {
    if (registering) await api.register(login, String(data.get("email") ?? "").trim(), password);
    else await api.login(login, password);
    await enter();
  } catch (e) {
    error.textContent = e instanceof ApiError ? e.message : `Could not connect: ${(e as Error).message}`;
    document.getElementById("auth")!.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

if (api.hasSession()) {
  api
    .me()
    .then(() => enter())
    .catch(() => api.forget());
}

// Installable app shell (PWA). Only in production builds served over a
// secure origin; failures leave the game working as a normal page.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}
