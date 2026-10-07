# Browser checks

Scripts that drive the real client in Chromium (playwright-core), against a
built client (`vite preview`) with the API and game server behind it.

| Script | Purpose |
| --- | --- |
| `phone.mjs` | the game on a phone, portrait and landscape: nothing scrolls sideways; sign-in, world browser and game by touch; tapping a hotbar slot selects it; the touch menu opens friends, quests, wardrobe and market and the controls step aside while a panel is open; the controls leave the vitals and hotbar clear; the inventory fits the screen |
| `account.mjs` | sign up; forgot password, reset from the emailed link and sign in with the new one; change the password in the account panel; report another player from the panel; download one's data; delete the account, after which sign-in fails. Needs the backend with `MAIL_MAILER=log` and `MAIL_LOG=<backend>/storage/logs/laravel.log` |
| `reports.mjs` | the admin panel's report queue: a moderator sees a player's report under Reports, resolves it with a note, finds it in the resolved list and on the reported player's page (needs the backend and `ROLE_CMD`) |
