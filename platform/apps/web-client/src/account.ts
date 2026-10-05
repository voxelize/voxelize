// The player's own account: "forgot password" and the reset form an email
// link opens, the notice after confirming the address, and the account
// panel (password, confirmation email, reporting a player, taking one's
// data away, deleting the account).

import { api, ApiError, REPORT_CATEGORIES, type MyReport, type ReportCategory } from "./api";

/** What the page was opened for, from an email link's query string. */
export function linkIntent(search: string): { kind: "reset"; token: string; email: string } | { kind: "verified"; ok: boolean } | null {
  const q = new URLSearchParams(search);
  const token = q.get("reset");
  const email = q.get("email");
  if (token && email) return { kind: "reset", token, email };
  const verified = q.get("verified");
  if (verified !== null) return { kind: "verified", ok: verified === "1" };
  return null;
}

const ERRORS: Record<string, string> = {
  invalid_reset: "That reset link is not valid any more: ask for a new one.",
  wrong_password: "That is not your password.",
  leader_must_hand_over: "Make another member leader of your guild first.",
  auction_has_bids: "An auction of yours has bids: it must run to its end.",
  leading_bid: "You lead an auction: wait until it ends.",
  contract_in_progress: "A contract of yours is being worked on.",
  already_reported: "You reported this player a moment ago; a moderator will look at it.",
  too_many_reports: "You have sent many reports this hour; try again later.",
  self: "You cannot report yourself.",
  player_not_found: "There is no player by that name.",
};

/** One of my reports in a line: "bob · griefing · a moderator dealt with it". */
export function myReportLine(r: MyReport): string {
  const outcome = { open: "waiting for a moderator", resolved: "a moderator dealt with it", dismissed: "a moderator looked and took no action" }[r.status];
  return `${r.player} · ${r.category} · ${outcome}`;
}

export const accountError = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ?? e.message) : "Could not reach the server");

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** The reset form an email link opens; resolves once the password is set. */
export function resetForm(token: string, email: string): Promise<void> {
  return new Promise((resolve) => {
    const root = h("section", { id: "reset", className: "panel" });
    const password = h("input", { type: "password", placeholder: "New password (10 characters or more)", minLength: 10, required: true, autocomplete: "new-password" });
    const status = h("p", { className: "worlds-status" });
    const form = h("form", { className: "account-form" }, h("h2", { textContent: "Choose a new password" }), h("p", { textContent: email }), password, h("button", { type: "submit", textContent: "Save" }), status);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api.account.reset(email, token, password.value);
        root.remove();
        history.replaceState(null, "", location.pathname);
        resolve();
      } catch (e) {
        status.textContent = accountError(e);
      }
    });
    root.append(form);
    document.body.append(root);
  });
}

/** The account panel (from the settings). */
export function accountPanel(user: { username: string; email_verified?: boolean }): HTMLElement {
  const root = h("section", { id: "account", className: "panel", hidden: true });
  const status = h("p", { className: "account-status" });
  const run = async (action: () => Promise<string>) => {
    status.textContent = "…";
    try {
      status.textContent = await action();
    } catch (e) {
      status.textContent = accountError(e);
    }
  };
  const field = (placeholder: string, autocomplete: string) => h("input", { type: "password", placeholder, autocomplete });

  const current = field("Current password", "current-password");
  const next = field("New password (10 or more)", "new-password");
  const change = h("form", { className: "account-form" }, h("h3", { textContent: "Password" }), current, next, h("button", { type: "submit", textContent: "Change password" }));
  change.addEventListener("submit", (e) => {
    e.preventDefault();
    void run(async () => {
      await api.account.changePassword(current.value, next.value);
      current.value = next.value = "";
      return "Password changed. Other devices are signed out.";
    });
  });

  const email = h("div", { className: "account-form" }, h("h3", { textContent: "Email" }));
  if (user.email_verified) email.append(h("p", { textContent: "Your address is confirmed." }));
  else
    email.append(
      h("p", { textContent: "Your address is not confirmed yet." }),
      h("button", { type: "button", textContent: "Send the confirmation again", onclick: () => void run(async () => ((await api.account.resendVerification()).verified ? "Already confirmed." : "Sent: check your inbox.")) }),
    );

  const exportButton = h("button", {
    type: "button",
    textContent: "Download my data",
    onclick: () =>
      void run(async () => {
        const data = await api.account.export();
        const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })), download: `${user.username}-account.json` });
        a.click();
        URL.revokeObjectURL(a.href);
        return "Downloaded.";
      }),
  });

  const target = h("input", { placeholder: "Player name", autocomplete: "off", maxLength: 24 });
  const category = h("select", {}, ...REPORT_CATEGORIES.map((c) => h("option", { value: c, textContent: c })));
  const details = h("textarea", { placeholder: "What happened, where and when", maxLength: 500, rows: 3 });
  const mine = h("ul", { className: "account-reports" });
  const showMine = async () => {
    try {
      const reports = await api.reports.mine();
      mine.replaceChildren(...reports.slice(0, 10).map((r) => h("li", { textContent: myReportLine(r) })));
    } catch {
      mine.replaceChildren();
    }
  };
  const report = h("form", { className: "account-form" },
    h("h3", { textContent: "Report a player" }),
    h("p", { textContent: "In the game you can also type /report <name> <what happened>." }),
    target,
    category,
    details,
    h("button", { type: "submit", textContent: "Send report" }),
    mine,
  );
  report.addEventListener("submit", (e) => {
    e.preventDefault();
    void run(async () => {
      await api.reports.file(target.value.trim(), category.value as ReportCategory, details.value.trim());
      target.value = details.value = "";
      void showMine();
      return "Report sent. A moderator will look at it; thank you.";
    });
  });
  void showMine();

  const confirm = field("Your password, to delete the account", "current-password");
  const del = h("form", { className: "account-form danger-zone" },
    h("h3", { textContent: "Delete the account" }),
    h("p", { textContent: "Your name, address, game state, friends and worlds are removed and your lands released. This cannot be undone." }),
    confirm,
    h("button", { type: "submit", className: "danger", textContent: "Delete my account" }),
  );
  del.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!globalThis.confirm(`Delete ${user.username} for good?`)) return;
    void run(async () => {
      await api.account.delete(confirm.value);
      api.forget();
      try {
        sessionStorage.clear();
      } catch {
        // Nothing stored.
      }
      setTimeout(() => location.assign("/"), 1500);
      return "Your account is deleted. Goodbye.";
    });
  });

  root.append(
    h("h2", { textContent: `Account · ${user.username}` }),
    change,
    email,
    report,
    h("div", { className: "account-form" }, h("h3", { textContent: "Your data" }), exportButton),
    del,
    status,
    h("button", { type: "button", textContent: "Done", onclick: () => (root.hidden = true) }),
  );
  document.body.append(root);
  return root;
}
