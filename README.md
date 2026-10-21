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
