# Browser checks

Scripts that drive the real client in Chromium (playwright-core), against a
built client (`vite preview`) with the API and game server behind it.

| Script | Purpose |
| --- | --- |
| `phone.mjs` | the game on a phone, portrait and landscape: nothing scrolls sideways; sign-in, world browser and game by touch; tapping a hotbar slot selects it; the touch menu opens friends, quests, wardrobe and market and the controls step aside while a panel is open; the controls leave the vitals and hotbar clear; the inventory fits the screen |
