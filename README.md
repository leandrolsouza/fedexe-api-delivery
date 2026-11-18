# Fedexe API

Fedexe API is a local HTTP client for Windows. Organize requests, test APIs interactively, and run saved workflows from the desktop app or in CI. The app uses Rust and Tauri 2 with React, TypeScript, Vite, and Tailwind CSS. It requires no account or cloud service.

## Install on Windows

Download and run the Windows x64 `*-setup.exe` from the [latest stable release](https://github.com/leandrolsouza/fedexe-api-delivery/releases/latest). The NSIS installer installs the app for the current Windows user.

Fedexe opens in English on a new profile. To switch languages, go to **Settings → Interface language** and select **Português (Brasil)**. The app saves the choice locally.

Published builds with the updater enabled check for stable releases on startup and in **Settings → Updates**. If you're upgrading from 1.0.x, run the [1.1.0 installer](https://github.com/leandrolsouza/fedexe-api-delivery/releases/tag/v1.1.0) over your existing installation to get in-app updates.

## What you can do

- Organize requests into collections and folders. Work across tabs with independent drafts, history, a desktop request console, and global search.
- Configure query parameters, headers, authentication, request bodies, and per-request timeouts. Reuse values with `{{variable}}` references.
- Inspect formatted responses and headers, copy the preview, or save the full response body on Windows.
- Validate responses with declarative checks and pass extracted values to later requests. Add pre-request and post-response JavaScript in the editor and desktop collection runner.
- Run a saved collection or folder against an environment, repeat it, and export results. Run load tests with virtual users, live metrics, and optional p99 and error-rate thresholds.
- Import cURL commands, Postman collections and environments, or OpenAPI 3.0 and 3.1 definitions. Export collection data and back up your workspace as JSON.
- Choose a light or dark theme, follow the system theme, or use the compact layout.

Press `Ctrl+S` to save a request, `Ctrl+Enter` to send it, or `Ctrl+K` to search. The runner uses saved requests.

### Local data and request behavior

The Windows app saves the workspace as JSON using atomic replacement and stores recognized credentials and environment secrets in Windows Credential Manager. Workspace backups omit stored secret values. The browser preview keeps its own workspace in browser storage and keeps secrets in session storage.

The default timeout is 30 seconds. The desktop engine verifies TLS certificates and can optionally follow same-origin redirects. Response previews are limited to 256 KiB, and runner JSON validation supports bodies up to 16 MiB. The runner can stop on the first failure and preserves partial results when canceled.

Google Drive backup is optional and disabled in standard builds. See the [interface guide](docs/INTERFACE.md) for setup and feature details.

## Run from source

For Windows desktop development, install Node.js 22.17 or later, Rust with the MSVC toolchain, Microsoft C++ Build Tools, and WebView2. Run these commands in PowerShell from the repository root.

```powershell
npm ci
npm run tauri dev
```

### Try the sample API

In a second terminal, run `node tools/test-server.mjs`. In Fedexe, select the **Local** environment, open **Acme API**, and send **List users**. You can also open the collection runner and run the whole collection. Send `GET http://127.0.0.1:8787/large` to try a large response. The sample server listens on loopback, uses fictional data, and discards changes.

### Browser preview

```powershell
npm run dev
```

Open `http://127.0.0.1:1420`. Requests use the browser's `fetch` API and are subject to CORS. Use the desktop app to test the Rust HTTP engine, Windows Credential Manager, or the updater.

## Run collections in CI

Download the `*_cli_windows-x64.zip` from the [latest stable release](https://github.com/leandrolsouza/fedexe-api-delivery/releases/latest), or build it with `npm run build:cli` after `npm ci`. Use Node.js 22.17 or later and keep `fedexe.mjs` and `fedexe-runner.exe` in the same folder. A local build places them in `dist-cli`.

Export a collection and an environment from Fedexe. Use an empty environment export for collections that have no environment variables.

```powershell
node dist-cli/fedexe.mjs run --collection ./collection.json --environment ./environment.json --report ./fedexe-report.json
```

The report path must point to a new file. For load testing, export a scenario from the desktop runner and use the CLI's `load` command. See the [CLI guide](docs/CLI.md) for secrets, performance thresholds, exit codes, and a GitHub Actions example.

## Build and verify

Run the frontend build before the Rust tests because Tauri embeds `dist` when compiling with `custom-protocol`.

```powershell
npm run build
npm test
cargo test --locked --features custom-protocol
npm run format:check
```

After the frontend build, run `cargo run --release --locked --features custom-protocol` to start the release build locally. To package the Windows installer, run `.\node_modules\.bin\tauri.cmd build --ci -- --locked`. The installer is written to `target/release/bundle/nsis`, and its version comes from `tauri.conf.json`.

The [Windows installer workflow](.github/workflows/windows.yml) checks that the Tauri, npm, and Cargo versions match, builds the package, and verifies installation and workspace preservation. Follow the [updater publishing guide](docs/UPDATER.md) to sign and publish a stable release.

The Rust test suite includes a 100-request local scenario that checks token extraction and reuse, validation of 10 MiB JSON responses, and preview truncation.

For manual installer validation on a second Windows machine:

1. Compare the first column of the attached `.sha256` file with the output of `Get-FileHash -LiteralPath "<installer.exe>" -Algorithm SHA256`.
2. Import a Postman collection and two test environments. Run the collection against both and verify that requests reach the expected destinations, extracted values reach the next step, and a deliberately failing check appears in the report.
3. Reopen the app and confirm that your workspace is restored. Export a backup and verify that stored environment secrets are absent from the JSON.
4. Install a newer build over the existing one and rerun the collection. Record both app versions, the Windows build, and the results.

## Project links

- [Interface and feature guide](docs/INTERFACE.md), [CLI reference](docs/CLI.md), [updater publishing guide](docs/UPDATER.md), and [roadmap](ROADMAP.md) are in Brazilian Portuguese.
- Fedexe API is available under the [MIT License](LICENSE).
