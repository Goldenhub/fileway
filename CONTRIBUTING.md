# Contributing to Fileway

Thanks for helping. Fileway is a small project, so every issue, fix and idea makes a difference. This guide covers how to get set up, the rules the code follows, and how changes get merged.

By taking part, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug:** open an [issue](https://github.com/Goldenhub/fileway/issues) with the driver, runtime (Node, Bun, Deno, Workers...), Fileway version and a minimal example.
- **Ask a question or share an idea:** use [GitHub Discussions](https://github.com/Goldenhub/fileway/discussions).
- **Improve the docs:** the site lives in `apps/docs/content/docs`. Typo fixes and clearer examples are always welcome.
- **Fix a bug or add a feature:** small, focused pull requests are easiest to review.
- **Build a driver or a plugin:** see the checklist below, or publish a plugin as your own package.

## What lives in this repository

This repository is the **Fileway Framework**: the free, MIT-licensed `@fileway/*` packages and the documentation site.

**Fileway Infrastructure** (the hosted dashboard and the `@fileway/infra` plugin) is developed in a separate private repository. Please share questions and feedback about it in Discussions rather than opening pull requests here.

## Bigger changes start with an RFC

For anything that adds or changes public API (a new client method, a driver contract change, a new package), please open an issue or a Discussion first. If the idea needs a design, it becomes an RFC in [`rfcs/`](rfcs/). See the existing ones for the format:

- [RFC 0001: list, stat, copy and move](rfcs/0001-list-copy-move.md)
- [RFC 0002: plugins and `@fileway/infra`](rfcs/0002-infra-plugin.md)
- [RFC 0003: WebDAV driver](rfcs/0003-webdav-driver.md)
- [RFC 0004: app-signed links](rfcs/0004-app-signed-links.md)

Bug fixes, docs and small improvements don't need an RFC.

## Setup

You need **Node.js 20 or later** and **pnpm 11** (the exact version is pinned in `packageManager` in `package.json`; `corepack enable` picks it up).

```bash
pnpm install
pnpm build       # build every @fileway/* package
pnpm typecheck   # strict TypeScript across the packages
pnpm test        # unit tests for every package
```

Run one package's tests while you work:

```bash
pnpm --filter @fileway/s3 test
```

### Integration tests

These run in CI on every push. To run them locally:

- **S3 against MinIO:** start MinIO (CI uses `cgr.dev/chainguard/minio:latest` on port 9000 with `minioadmin` / `minioadmin`), then run `pnpm test:integration`.
- **Azure against Azurite:** start Azurite on port 10000, with Docker (`mcr.microsoft.com/azure-storage/azurite`, command `azurite-blob --blobHost 0.0.0.0 --skipApiVersionCheck`) or the `azurite` npm package, then run `pnpm test:integration:azure`.
- **Google Cloud Storage and Supabase (optional, live):** these run only when you set credentials, against your own test bucket:
  - GCS: `GCS_TEST_BUCKET` and `GCS_SERVICE_ACCOUNT_JSON`, then `pnpm --filter @fileway/gcs test`.
  - Supabase: `SUPABASE_URL`, `SUPABASE_KEY` and `SUPABASE_BUCKET`, then `pnpm --filter @fileway/supabase test`.

### Documentation site

```bash
pnpm --filter @fileway/docs dev
```

## Project rules

These keep Fileway small and able to run everywhere. Pull requests that break them can't be merged.

- **No runtime dependencies in `@fileway/core`.** Drivers depend only on `@fileway/core`.
- **No `node:*` imports in universal packages** (`core`, `s3`, `gcs`, `azure`, `supabase`, `cloudinary`). Use `fetch`, Web Streams, `crypto.subtle`, `TextEncoder` and `TextDecoder`. Only `@fileway/local` may use Node built-ins.
- **Stream, don't buffer.** Files move as `ReadableStream<Uint8Array>`. Never read a whole file into memory; hold at most one part or chunk at a time.
- **Strict TypeScript.** `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on; no `any` in public types.
- **Typed errors.** Failures are `StorageError`s with a `code` from the `StorageErrorCode` union; aborts stay `AbortError`.
- **Tests for every behavior.** Unit tests mock `fetch` (or use a temp directory for `@fileway/local`). New universal drivers run their tests in the `edge-runtime` environment (see `packages/azure/vitest.config.ts`), so edge compatibility is tested.
- **Writing style:** no em dashes or en dashes in code, comments, docs or changelogs. Use commas, colons, parentheses or separate sentences.

## Adding a driver

1. Copy the layout of an existing universal driver, for example `packages/azure` (`package.json` exports map, `tsup.config.ts`, `tsconfig.json`, `vitest.config.ts`, `README.md`, `LICENSE`).
2. Implement `BaseDriver` from `packages/core/src/types.ts`: `upload`, `delete`, `getUrl`, `get`, and where the provider allows, `getPresignedUrl`, `pathFor` + `head` (upload recovery and status), `isPending`, `list`, `copy`, `move`, and `capabilities` (`range`, `maxUploadBytes`).
3. Map provider errors to `StorageError` codes in one classifier, and pass `options.signal` to every request.
4. Add unit tests, and an integration or opt-in live test if the provider has an emulator or free tier.
5. Wire it in: the `typecheck` filter in the root `package.json`, the build filter in `.github/workflows/ci.yml`, and the version check and build filter in `.github/workflows/release.yml`.
6. Document it: a page in `apps/docs/content/docs/drivers/` (and `drivers/meta.json`), the capabilities matrix and per-driver tables in `guide/`, and the README driver tables.

## Pull requests

1. Fork the repository and branch off `main`.
2. Keep the change focused; split unrelated changes into separate pull requests.
3. Use [Conventional Commit](https://www.conventionalcommits.org/) messages, matching the history: `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`, with a scope when it helps (`feat(core): ...`).
4. Update tests and docs, and add an entry under `## Unreleased` in both `CHANGELOG.md` and `apps/docs/content/docs/reference/changelog.mdx` for anything users will notice.
5. Make sure `pnpm build`, `pnpm typecheck` and `pnpm test` pass locally. CI also runs the MinIO and Azurite suites and the docs typecheck.
6. Open the pull request with a short description of what changed and why.

Maintainers handle version bumps and releases; please don't change package versions in a pull request.

## Reporting security issues

Please don't report security problems in public issues. Use GitHub's [private vulnerability reporting](https://github.com/Goldenhub/fileway/security/advisories/new) for this repository instead. We'll acknowledge the report and keep you updated while it's fixed.

## License

Fileway is released under the [MIT License](LICENSE). By contributing, you agree that your contributions are licensed under the same terms. There is no separate contributor agreement to sign.
