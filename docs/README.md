# Voxelize Docs

The documentation site for Voxelize, built with [Docusaurus](https://docusaurus.io/).

## Local Development

```bash
pnpm install
pnpm start
```

Serves on port 3040 with TypeDoc watch enabled.

## Build

```bash
pnpm build
```

Runs TypeDoc generation, then builds static output into `build/`. Serve it with `pnpm serve`.

## Content

| Path              | Contents                                                         |
| ----------------- | ---------------------------------------------------------------- |
| `docs/tutorials/` | Step-by-step guides                                              |
| `docs/wiki/`      | Concept and pattern explanations                                 |
| `docs/api/`       | Generated from TypeDoc — edit the JSDoc in `packages/`, not here |

See `AGENT.md` for writing style and structure conventions.
