import "./style.css";

import { linkIntent, resetForm } from "./account";
import { api, ApiError } from "./api";
import { Content } from "./content";
import { Hud } from "./hud";
import { baseWorld, chooseWorld, SERVER_KEY, serverOrigin, WORLD_KEY } from "./worlds";

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

const session = {
  get: (key: string) => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Private mode: travel between dimensions will not survive a reload.
    }
  },
};

async function enter() {
  document.getElementById("auth")!.hidden = true;
  // A tab already in a world (or travelling between its dimensions) stays
  // there; otherwise the player picks one.
  let engineWorld = session.get(WORLD_KEY);
  let server = session.get(SERVER_KEY) ?? "";
  if (!engineWorld || !/^[a-z0-9_]{1,64}$/.test(engineWorld)) {
    const chosen = await chooseWorld();
    engineWorld = chosen.key;
    server = chosen.official ? "" : (serverOrigin(chosen.url ?? "") ?? "");
    session.set(WORLD_KEY, engineWorld);
    session.set(SERVER_KEY, server);
  }
  const key = baseWorld(engineWorld);
  // Loaded once the world is known: the game module reads it on load.
  const { startGame } = await import("./game");
  const content = await Content.fetch();
  const hud = new Hud(content);
  // A fresh single-use ticket for every (re)connect. Official worlds are
  // reached through this site; others at their own game server.
  await startGame(content, async () => (await api.ticket(key)).ticket, hud, server || location.origin);
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

// Forgotten password: the address gets a link to the reset form.
document.getElementById("auth-forgot")?.addEventListener("click", async () => {
  const email = (prompt("Your account's email address:") ?? "").trim();
  if (!email) return;
  try {
    await api.account.forgot(email);
    error.textContent = "If that address has an account, a reset link is on its way.";
  } catch (e) {
    error.textContent = e instanceof ApiError ? e.message : "Could not reach the server";
  }
});

// Opened from an email link: reset the password, or note the confirmation.
const intent = linkIntent(location.search);
if (intent?.kind === "reset") {
  document.getElementById("auth")!.hidden = true;
  void resetForm(intent.token, intent.email).then(() => {
    document.getElementById("auth")!.hidden = false;
    error.textContent = "Password changed: sign in with the new one.";
  });
} else {
  if (intent?.kind === "verified") {
    error.textContent = intent.ok ? "Your email address is confirmed." : "That confirmation link is not valid.";
    history.replaceState(null, "", location.pathname);
  }
  if (api.hasSession()) {
    api
      .me()
      .then(() => enter())
      .catch(() => api.forget());
  }
}

// Installable app shell (PWA). Only in production builds served over a
// secure origin; failures leave the game working as a normal page.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}
