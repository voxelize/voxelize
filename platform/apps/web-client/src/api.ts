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

export type LandPermissions = { build: boolean; containers: boolean; use: boolean; animals: boolean };
export type LandView = {
  id: string;
  name: string;
  world: string;
  dimension: string;
  min: [number, number];
  max: [number, number];
  chunks: number;
  owner: { id: string; name: string };
  guild: { id: string; name: string; tag: string } | null;
  members: { id: string; name: string; role: string }[];
  permissions: LandPermissions;
  sale_price: number | null;
  status: string;
};
export type PriceHistory = {
  item: string;
  sales: { count: number; price: number; unit_price: number; at: string }[];
  stats: { days: number; sales: number; items: number; average_unit_price: number | null; min_unit_price: number | null; max_unit_price: number | null };
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
  revision?: number;
  review_note?: string | null;
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

export type ContractView = {
  id: string;
  title: string;
  world: string;
  item: string;
  count: number;
  reward: number;
  currency: string;
  status: string;
  poster: { id: string; name: string };
  guild: { id: string; name: string; tag: string } | null;
  contractor: { id: string; name: string } | null;
  deadline_at: string;
  role: "poster" | "contractor" | null;
};

export type GuildSummary = { id: string; name: string; tag: string; leader: { id: string; name: string }; members: number };
export type GuildRole = "leader" | "officer" | "member";
export const GUILD_PERMISSIONS = ["invite", "kick", "treasury", "land", "contracts"] as const;
export type GuildPermission = (typeof GUILD_PERMISSIONS)[number];
export type GuildRank = { id: string; name: string; permissions: GuildPermission[] };
export type GuildView = GuildSummary & {
  roster: { id: string; name: string; role: GuildRole; rank: { id: string; name: string } | null }[];
  ranks: GuildRank[];
  my_permissions: GuildPermission[];
  treasury: number;
  currency: string;
  max_members: number;
  max_chunks: number;
  my_role: GuildRole | null;
  settlements: Settlement[];
  settlement_level: SettlementLevel;
  tax_bps: number;
  relations: GuildRelation[];
};
export type GuildRelation = {
  id: string;
  kind: "alliance" | "war";
  status: "proposed" | "active";
  with: { id: string; name: string; tag: string };
  initiated: boolean;
  fighting: boolean;
  starts_at: string | null;
  ends_at: string | null;
  score: { us: number; them: number } | null;
  peace_offered: "us" | "them" | null;
};
export type SettlementLevel = "none" | "village" | "town" | "city";
export type Settlement = {
  world: string;
  dimension: string;
  lands: string[];
  chunks: number;
  level: SettlementLevel;
  min: [number, number];
  max: [number, number];
};
export type GuildMessage = { id: number; from: { id: string; name: string }; body: string; at: string };

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
    listings: (world: string, filter: { item?: string; items?: string[]; kind?: string; mine?: boolean } = {}) => {
      const q = new URLSearchParams({ world });
      if (filter.item) q.set("item", filter.item);
      if (filter.items) q.set("items", filter.items.join(","));
      if (filter.kind) q.set("kind", filter.kind);
      if (filter.mine) q.set("mine", "1");
      return request<{ listings: Listing[] }>(`/market/listings?${q}`).then((r) => r.listings);
    },
    buy: (id: string) =>
      request<{ listing: Listing; balance: number }>(`/market/listings/${id}/buy`, { method: "POST" }),
    buyPart: (id: string, count: number, key: string) =>
      request<{ listing: Listing; balance: number }>(`/market/listings/${id}/buy`, {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify({ count }),
      }),
    history: (world: string, item: string) =>
      request<PriceHistory>(`/market/history?${new URLSearchParams({ world, item })}`),
    bid: (id: string, amount: number, key: string) =>
      request<{ listing: Listing; balance: number }>(`/market/listings/${id}/bids`, {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify({ amount }),
      }),
    cancel: (id: string) => request<{ cancelled: boolean }>(`/market/listings/${id}`, { method: "DELETE" }),
    deliveries: () => request<{ deliveries: DeliveryView[] }>("/deliveries").then((r) => r.deliveries),
  },

  contracts: {
    list: (world: string, mine = false) =>
      request<{ contracts: ContractView[] }>(`/contracts?world=${encodeURIComponent(world)}${mine ? "&mine=1" : ""}`).then((r) => r.contracts),
    post: (key: string, body: { world: string; title: string; item: string; count: number; reward: number; hours: number; guild?: string }) =>
      request<{ contract: ContractView; balance: number }>("/contracts", { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify(body) }),
    accept: (id: string) => request<{ contract: ContractView }>(`/contracts/${id}/accept`, { method: "POST" }),
    abandon: (id: string) => request<{ contract: ContractView }>(`/contracts/${id}/abandon`, { method: "POST" }),
    cancel: (id: string) => request<{ cancelled: boolean }>(`/contracts/${id}`, { method: "DELETE" }),
  },

  guilds: {
    search: (q = "") => request<{ guilds: GuildSummary[] }>(`/guilds${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => r.guilds),
    mine: () => request<{ guild: GuildView | null; invites: GuildSummary[] }>("/guilds/mine"),
    create: (key: string, name: string, tag: string) =>
      request<{ guild: GuildView; balance: number }>("/guilds", { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ name, tag }) }),
    invite: (id: string, player: string) => request<{ invited: boolean }>(`/guilds/${id}/invites`, { method: "POST", body: JSON.stringify({ player }) }),
    join: (id: string) => request<{ guild: GuildView }>(`/guilds/${id}/join`, { method: "POST" }),
    decline: (id: string) => request<{ declined: boolean }>(`/guilds/${id}/decline`, { method: "POST" }),
    leave: (id: string) => request<{ left: boolean }>(`/guilds/${id}/leave`, { method: "POST" }),
    kick: (id: string, player: string) =>
      request<{ guild: GuildView }>(`/guilds/${id}/members/${encodeURIComponent(player)}`, { method: "DELETE" }),
    setRole: (id: string, player: string, role: GuildRole) =>
      request<{ guild: GuildView }>(`/guilds/${id}/members/${encodeURIComponent(player)}/role`, { method: "PUT", body: JSON.stringify({ role }) }),
    deposit: (id: string, key: string, amount: number) =>
      request<{ treasury: number; balance: number }>(`/guilds/${id}/deposit`, { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ amount }) }),
    messages: (id: string, after = 0) =>
      request<{ messages: GuildMessage[] }>(`/guilds/${id}/messages${after ? `?after=${after}` : ""}`).then((r) => r.messages),
    say: (id: string, body: string) =>
      request<{ message: { id: number } }>(`/guilds/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
    createRank: (id: string, name: string, permissions: GuildPermission[]) =>
      request<{ guild: GuildView }>(`/guilds/${id}/ranks`, { method: "POST", body: JSON.stringify({ name, permissions }) }).then((r) => r.guild),
    updateRank: (id: string, rank: string, body: { name?: string; permissions?: GuildPermission[] }) =>
      request<{ guild: GuildView }>(`/guilds/${id}/ranks/${rank}`, { method: "PATCH", body: JSON.stringify(body) }).then((r) => r.guild),
    deleteRank: (id: string, rank: string) =>
      request<{ guild: GuildView }>(`/guilds/${id}/ranks/${rank}`, { method: "DELETE" }).then((r) => r.guild),
    assignRank: (id: string, player: string, rank: string | null) =>
      request<{ guild: GuildView }>(`/guilds/${id}/members/${encodeURIComponent(player)}/rank`, { method: "PUT", body: JSON.stringify({ rank }) }).then(
        (r) => r.guild,
      ),
    setTax: (id: string, bps: number) =>
      request<{ guild: GuildView }>(`/guilds/${id}/tax`, { method: "PUT", body: JSON.stringify({ bps }) }).then((r) => r.guild),
    ally: (id: string, other: string) =>
      request<{ relation: GuildRelation }>(`/guilds/${id}/alliances`, { method: "POST", body: JSON.stringify({ guild: other }) }).then((r) => r.relation),
    endAlliance: (id: string, other: string) =>
      request<{ ended: boolean }>(`/guilds/${id}/alliances/${encodeURIComponent(other)}`, { method: "DELETE" }),
    declareWar: (id: string, other: string) =>
      request<{ relation: GuildRelation }>(`/guilds/${id}/wars`, { method: "POST", body: JSON.stringify({ guild: other }) }).then((r) => r.relation),
    peace: (id: string, other: string) =>
      request<{ peace: boolean; offered: boolean }>(`/guilds/${id}/wars/${encodeURIComponent(other)}/peace`, { method: "POST" }),
    withdraw: (id: string, key: string, amount: number, to?: string) =>
      request<{ treasury: number }>(`/guilds/${id}/withdraw`, { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ amount, to }) }),
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
      body: { world: string; dimension: string; min: [number, number]; max: [number, number]; name: string; guild?: string },
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
    resize: (id: string, key: string, min: [number, number], max: [number, number]) =>
      request<{ land: LandView }>(`/lands/${id}/resize`, {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify({ min, max }),
      }).then((r) => r.land),
    offer: (id: string, price: number) =>
      request<{ land: LandView }>(`/lands/${id}/sale`, { method: "PUT", body: JSON.stringify({ price }) }).then((r) => r.land),
    withdraw: (id: string) => request<{ land: LandView }>(`/lands/${id}/sale`, { method: "DELETE" }).then((r) => r.land),
    buy: (id: string, key: string, price: number) =>
      request<{ land: LandView }>(`/lands/${id}/buy`, {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify({ price }),
      }).then((r) => r.land),
    removeMember: (id: string, player: string) =>
      request<{ land: LandView }>(`/lands/${id}/members/${encodeURIComponent(player)}`, { method: "DELETE" }).then(
        (r) => r.land,
      ),
  },
};
