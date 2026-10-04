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

export type LandPermissions = { build: boolean; containers: boolean; use: boolean };
export type LandView = {
  id: string;
  name: string;
  world: string;
  dimension: string;
  min: [number, number];
  max: [number, number];
  chunks: number;
  owner: { id: string; name: string };
  members: { id: string; name: string; role: string }[];
  permissions: LandPermissions;
  status: string;
};
export type LandQuote = { currency: string; price: number; max_side_chunks: number; max_chunks_per_player: number };

export type Listing = {
  id: string;
  kind: "fixed" | "auction";
  world: string;
  item: string;
  count: number;
  durability: number | null;
  currency: string;
  price: number;
  buyout: number | null;
  current_bid: number | null;
  bid_count: number;
  minimum_bid: number | null;
  seller: { id: string; name: string };
  status: string;
  ends_at: string;
};
export type DeliveryView = { id: string; world: string; item: string; count: number; reason: string };

export type BlueprintView = {
  id: string;
  name: string;
  world: string;
  size: [number, number, number];
  blocks: number;
  materials: Record<string, number>;
  creator: { id: string; name: string };
  status: string;
  price: number | null;
  max_copies: number | null;
  copies_sold: number;
  royalty_bps: number;
  mine: boolean;
  licensed: boolean;
};

export type Resale = {
  id: string;
  blueprint: string;
  name: string;
  seller: { id: string; name: string };
  price: number;
  royalty_bps: number;
  status: string;
};

/** A fresh key for one economic request; retries reuse it. */
export const idempotencyKey = () => crypto.randomUUID().replace(/-/g, "");

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

  wallets: () => request<{ wallets: { currency: string; balance: number }[] }>("/wallets").then((r) => r.wallets),

  market: {
    listings: (world: string, filter: { item?: string; kind?: string; mine?: boolean } = {}) => {
      const q = new URLSearchParams({ world });
      if (filter.item) q.set("item", filter.item);
      if (filter.kind) q.set("kind", filter.kind);
      if (filter.mine) q.set("mine", "1");
      return request<{ listings: Listing[] }>(`/market/listings?${q}`).then((r) => r.listings);
    },
    buy: (id: string) =>
      request<{ listing: Listing; balance: number }>(`/market/listings/${id}/buy`, { method: "POST" }),
    bid: (id: string, amount: number, key: string) =>
      request<{ listing: Listing; balance: number }>(`/market/listings/${id}/bids`, {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify({ amount }),
      }),
    cancel: (id: string) => request<{ cancelled: boolean }>(`/market/listings/${id}`, { method: "DELETE" }),
    deliveries: () => request<{ deliveries: DeliveryView[] }>("/deliveries").then((r) => r.deliveries),
  },

  blueprints: {
    published: (world: string) =>
      request<{ blueprints: BlueprintView[] }>(`/blueprints?world=${encodeURIComponent(world)}`).then((r) => r.blueprints),
    mine: () => request<{ blueprints: BlueprintView[] }>("/blueprints/mine").then((r) => r.blueprints),
    update: (id: string, body: { name?: string; price?: number; max_copies?: number; published?: boolean; royalty_bps?: number }) =>
      request<{ blueprint: BlueprintView }>(`/blueprints/${id}`, { method: "PATCH", body: JSON.stringify(body) }).then(
        (r) => r.blueprint,
      ),
    buy: (id: string) => request<{ blueprint: BlueprintView; balance: number }>(`/blueprints/${id}/buy`, { method: "POST" }),
    resales: (id: string) =>
      request<{ resales: Resale[] }>(`/blueprints/${id}/resales`).then((r) => r.resales),
    resell: (id: string, price: number) =>
      request<{ resale: Resale }>(`/blueprints/${id}/resales`, { method: "POST", body: JSON.stringify({ price }) }),
    buyResale: (id: string) => request<{ balance: number }>(`/blueprint-resales/${id}/buy`, { method: "POST" }),
  },

  lands: {
    list: (world: string, dimension: string, mine = false) =>
      request<{ lands: LandView[] }>(
        `/lands?world=${encodeURIComponent(world)}&dimension=${encodeURIComponent(dimension)}${mine ? "&mine=1" : ""}`,
      ).then((r) => r.lands),
    quote: (chunks: number) => request<LandQuote>(`/lands/quote?chunks=${chunks}`),
    claim: (
      key: string,
      body: { world: string; dimension: string; min: [number, number]; max: [number, number]; name: string },
    ) =>
      request<{ land: LandView; replayed: boolean }>("/lands", {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify(body),
      }).then((r) => r.land),
    update: (id: string, body: { name?: string; permissions?: Partial<LandPermissions> }) =>
      request<{ land: LandView }>(`/lands/${id}`, { method: "PATCH", body: JSON.stringify(body) }).then((r) => r.land),
    release: (id: string) => request<{ released: boolean }>(`/lands/${id}`, { method: "DELETE" }),
    addMember: (id: string, player: string, role: string) =>
      request<{ land: LandView }>(`/lands/${id}/members`, {
        method: "POST",
        body: JSON.stringify({ player, role }),
      }).then((r) => r.land),
    removeMember: (id: string, player: string) =>
      request<{ land: LandView }>(`/lands/${id}/members/${encodeURIComponent(player)}`, { method: "DELETE" }).then(
        (r) => r.land,
      ),
  },
};
