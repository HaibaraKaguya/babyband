# BabyBand 集成版本

当前状态与实际验证请先阅读 [集成交付说明](docs/INTEGRATION-REVIEW.md)。

# Baby Band App

A uni-app (Vue 3) client for the Baby Band infant monitoring project.

## Requirements

- Node.js 18 or newer
- npm
- HBuilderX or the uni-app CLI toolchain

## Install

```sh
npm ci
```

## Run

```sh
npm run dev:h5
npm run dev:mp-weixin
```

## Build

```sh
npm run build:h5
npm run build:mp-weixin
```

Application source is in `src/`. Page registrations are in `src/pages.json`; platform permissions and metadata are in `src/manifest.json`.

The homepage currently supports simulated sensor frames and a Bluetooth connection path. Hardware integration depends on matching the embedded device protocol and its BLE service/characteristic UUIDs.

## Architecture layer (phase 1)

This worktree adds a page-independent architecture layer:

- `src/types/` — JSDoc contracts, quaternion normalization, SensorSample/PoseFrame builders.
- `src/services/` — ingestion facade and explicit object→array conversion for the algorithm layer.
- `src/repositories/` — chunked, quota-aware local session storage plus a documented App SQLite boundary.
- `docs/architecture/` — architecture, data contracts, storage, protocol conflicts, dependency audit and frontend integration API.
- `tests/architecture/` — dependency-free `node --test` tests.

The existing pages, BLE manager, protocol parser and algorithms are intentionally unchanged. The parent integration must switch the pages to the new APIs; see `docs/architecture/integration-api.md`.

### Tests

```sh
node --test tests/architecture/*.test.mjs
```

The architecture modules have no runtime dependencies and do not import `uni` at module load, so the tests run in plain Node.js 18+.

### Documentation

- [Architecture overview](docs/architecture/README.md)
- [Data contracts](docs/architecture/data-contracts.md)
- [Storage and App SQLite boundary](docs/architecture/storage.md)
- [Protocol conflicts and uncertainties](docs/architecture/protocol-conflicts.md)
- [Frontend integration API](docs/architecture/integration-api.md)
- [Dependency audit](docs/architecture/dependency-audit.md)

