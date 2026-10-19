# Self-hosted Bolt: fork architecture and delivery

This guide describes `alexandre-leng/bolt.diy`, not an unmodified upstream release.
Source code and tests describe the implementation; a GitHub push does not describe
what a running service has loaded.

## Architecture

- **Application:** React 19 and React Router 8, built as a Cloudflare Worker with
  `react-router build`. UnoCSS supplies the interface styles; nanostores hold the
  workbench state. See `package.json` for the declared versions.
- **Project execution:** server-side `bolt-runtime` sandboxes use Docker/gVisor.
  The browser client is in `app/lib/runtime/server/`; it connects over the
  session-gated `/api/runtime` WebSocket. StackBlitz WebContainer has been removed.
- **Preview:** separate preview origins, signed preview access, and a proxy route
  to the project's dev server. The Bolt application container itself need not use
  gVisor; the sandbox running generated project code must be checked separately.
- **Accounts:** a separate account service owns sessions, preferences and encrypted
  integration secrets. Browser caches are not the account source of truth.
- **History:** a separate PostgreSQL-backed service synchronizes conversations.
  IndexedDB remains a local cache and stores snapshots; these are distinct from
  persisted server-side project files.
- **Publication/private preview:** separate host services build and serve output.
  Their source and configuration are not automatically deployed by an app build.
- **Screenshot-to-code:** an independently deployed backend supplies the conversion
  stream. Design mockup generation uses the app's image-generation route and
  requires its own server-side provider configuration.

A new browser defaults to OpenCode Go / `deepseek-v4.1-flash` when built with the
self-hosted defaults. Keys are never inherited from a clone of this public fork.

## Repository and external-service boundary

The app repository contains the UI, its API routes, runtime client and tests.
The existing installation also maintains separate source trees for the account,
history, publication, runtime and screenshot services, plus nginx/systemd/Compose
configuration. A clone of this repository alone does **not** reproduce all of
those services or provide a working execution backend.

Service fixes from the audit are backed up as reviewed patches:

- [`publish-artifact-boundary.patch`](../../patches/publish-artifact-boundary.patch):
  reject linked/special build output and fail closed if sandbox credentials vanish.
- [`runtime-websocket-envelope.patch`](../../patches/runtime-websocket-envelope.patch):
  reject malformed envelopes before accessing fields in the runtime handler.
- [Patch instructions and limitations](../../patches/README.md).

These files are delivery artifacts, **not automatically applied changes**. Compare
against current service sources and test in an isolated copy before applying.
The runtime patch records base `4653b46` and local fix commit `19e42fe`; the separate
runtime repository had no configured remote when the patch was captured.

## Development and validation

Use Node >= 22.12.0 and the pnpm version declared in `packageManager`.

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

This starts the application, not all external services. A full project-generation
or Preview test requires the account/proxy/runtime configuration above.

Run the app gates from its repository root:

```sh
pnpm exec tsc --noEmit -p .
pnpm exec eslint app --quiet
pnpm exec vitest run --no-file-parallelism
pnpm run build
```

Vitest has separate `node` and `dom` projects. Register new browser tests in
`DOM_TESTS` in `vitest.config.ts`; never hide a failing production test by adding
an exclusion. Run runtime and Python service suites independently: app tests do
not execute a service patch or prove that it is installed.

## Production serving

The self-hosted Worker is served with `wrangler dev` against the generated
`build/server` directory behind an authenticated reverse proxy. The installation
uses an external Compose file and entrypoint to pass selected server variables.
The historical `vite preview` / `dockerstart` scripts and the repository's generic
production Compose example do **not** reproduce this Worker deployment.

Build the application image with the `bolt-ai-production` target only after the
source gates pass. Before a production change:

1. Confirm the intended host and preserve a rollback image/configuration.
2. Reconcile concurrent source changes without discarding another session's work.
3. Validate proxy configuration and external-service prerequisites separately.
4. Deploy once; compare the running container image ID with the built image ID.
5. Verify a fresh-browser build/discuss flow, rendered Preview, conversation
   reopening, authenticated APIs, and publication on the actual affected browser.
6. Record the deployed revision and distinguish it from later source/doc commits.

Publishing to GitHub is not approval to restart services. No live deployment is
claimed by this documentation update.

## Audit corrections and evidence

The first app audit wave validated 1196 tests, TypeScript, ESLint and a production
build. The runtime validation passed 27 tests including an ephemeral real socket.
The publication patch applied to a fresh service copy ran 64 tests with 2 skips.
Those counts describe those specific runs, not a promise about every future tree.

Verified corrections include:

- Unsent runtime requests survive reconnect; explicit close settles pending waits.
- ZIP text survives the real action parser byte for byte through encoded actions.
  Binary ZIP/folder imports are still skipped; this correction does not add them.
- The streaming performance fixture updates one React root instead of mounting
  100 roots. The original 16.67 ms budget is unchanged.
- Host-side artifact copying rejects symlinks and special files rather than
  dereferencing them outside the sandbox; missing credentials no longer infer an
  unsafe host-execution fallback. These changes require applying the service patch.
- A JSON `null` WebSocket frame no longer terminates the runtime in the isolated
  reproduction. The runtime patch must be deployed independently.

The follow-up publishing batch passed **1201 tests in 145 files**, TypeScript,
ESLint, and the app production build. It also includes reviewed changes from another
session: connector responses no longer return the deployment GitHub token or
Supabase stack traces; GitLab rejects literal private/local base URLs; shared
dialogues and the palette have mobile sizing and keyboard-access improvements.
A post-commit full rerun reported 1200 passes and one mixed-content streaming
performance failure (30.49 ms versus 16.67 ms). Rerunning that performance file
alone passed all 9 tests. This is recorded as timing sensitivity, not hidden by an
exclusion or a raised budget; the earlier 1201-pass run is a separate result.
GitLab hostname validation is **not complete SSRF protection**: redirect/DNS
handling and network egress require separate review. UI source checks are not a
physical-device or live-browser proof.

## Preview-server restart verification

The terminal's circular-arrow control restarts the project preview server; it does
not merely clear or reattach xterm. It preserves the launch command, prevents
concurrent restarts, and reports runtime failures. Commit `79a7d1b` fixes an OSC
handoff race: consume the preceding prompt before sending Ctrl+C, then consume
its acknowledgement before launching the next command. Otherwise exit 130 can be
attributed to a still-running new server and the next restart hits its occupied port.

Verified on the deployed image using controlled, temporary projects (no model call):

- Chromium: two real restarts, preview PID 41 → 62 → 83; reopen PID 117.
- Firefox: two real restarts, PID 151 → 172 → 193; reopen PID 227.
- Mobile Chromium, 390 × 844, Vite project: PID 120 → 152 → 183; reopen PID 214.
  Open the compact header's preview control first; an off-screen workbench is not
  evidence that its restart button is broken.
- Full live smoke: 8/8 (login, account profile, onboarding state, French UI,
  direct-link restore, publish/served output, mobile settings, browser errors).
- Clean committed-tree verification: 1256/1256 tests in 156 files; TypeScript,
  ESLint and production image build passed. The earlier overlay-container run
  counted 1266 tests because it retained three obsolete spec files (10 tests)
  absent from git; no tests were excluded or budgets changed for this fix.

The three temporary conversations and published test site were removed and their
absence checked. These results verify the named journeys, not an exhaustive audit
or a physical-phone test.

## Remaining work and operational cautions

The audit is not complete. Open work includes publication ownership and concurrent
builds, build-output/disk limits, folder/binary import behavior, provider-stream
error/retry paths, complete UI/browser journeys, CI and Electron delivery.
Static findings require reproduction before being called confirmed defects.

- Never publish credentials, browser storage, production logs or real user data.
- Keep service environment files private. Worker environment bindings and host
  process environments are different mechanisms; inspect configured key names,
  never dump their values for debugging.
- Generated project code stays in sandboxes. Never fall back to a host build when
  the runtime or its credentials are unavailable.
- Audit disk usage read-only first. Count snapshots/image layers as shared storage,
  not one full image size per tag. Do not delete `containerd` directories manually.
- A directory called `cache` can hold installed tools or active work. Resolve
  executable symlinks, check active consumers, retain diagnostics/rollback data,
  and use package-manager cleanup commands instead of broad recursive deletion.
- Check SSH access before changing authentication settings; never disable password
  access without a separately proven key-based login.

See [`AGENTS.md`](../../AGENTS.md) for repository rules and
[`memory.md`](../../memory.md) for the append-only evidence journal.
