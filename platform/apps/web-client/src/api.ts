// Business API client (docs/API.md). The bearer token lives in
// sessionStorage: it survives reloads of this tab but not the browser
// session, and it never reaches the game server — only short-lived game
// tickets do.

const TOKEN_KEY = "platform.token";

export type User = { id: string; username: string; status: string };
export type Ticket = { ticket: string; expires_at: number; world: string; realm: string; url: string };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body?.error?.code ?? (response.status === 422 ? "invalid" : `http_${response.status}`);
    const message =
      body?.error?.message ??
      (body?.errors ? Object.values(body.errors).flat().join(" ") : body?.message) ??
      response.statusText;
    throw new ApiError(response.status, code, String(message));
  }
  return body as T;
}

export const api = {
  hasSession: () => sessionStorage.getItem(TOKEN_KEY) !== null,

  async login(login: string, password: string): Promise<User> {
    const result = await request<{ user: User; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ login, password }),
    });
    sessionStorage.setItem(TOKEN_KEY, result.token);
    return result.user;
  },

  async register(username: string, email: string, password: string): Promise<User> {
    const result = await request<{ user: User; token: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    });
    sessionStorage.setItem(TOKEN_KEY, result.token);
    return result.user;
  },

  me: () => request<{ user: User }>("/me").then((r) => r.user),

  ticket: (world: string) =>
    request<Ticket>("/game/tickets", { method: "POST", body: JSON.stringify({ world }) }),

  forget: () => sessionStorage.removeItem(TOKEN_KEY),
};
