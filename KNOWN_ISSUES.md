# Known Issues and Deferred Items

Documented limitations shipped with v1. None block normal use; all are
deferred deliberately.

## Backend (Cloudflare Worker)

- **A1 - Rate limiter is best-effort.** The KV-backed rate limiter uses
  read-modify-write with no atomicity, so concurrent requests can race past
  the limit. It also shares the `DISPOSABLE_EMAIL_DOMAINS` KV namespace,
  storing counters under `rl:` keys.
- **A3 - Magic-link verify does an O(N) storage scan.** `userAuth` scans all
  stored tokens on verify. Fine at current scale; revisit if user counts grow.
- **A5 - WebSocket manager jobs map is in-memory.** `websocketManager` keeps
  its jobs map in memory only; it is not persisted across Durable Object
  restarts, so in-flight job routing state is lost on eviction.
- **A6 - Per-socket ping intervals.** The WS manager uses per-socket ping
  timers rather than the Durable Object WebSocket hibernation API, so
  connected sockets keep the DO resident.

## Worker (GPU)

- **Node callback (B5).** The pod-side `videoReady` POST from the custom
  output node can fail silently; the `rp_handler` fallback masks the failure.
  Fix pending in the Vidia-Open-Studio-Nodes repo.
- **`start.sh` deploy-key clone uses `StrictHostKeyChecking=no`** (around
  line 147) for the Nodes repo clone. The monorepo clone in `updater.sh`
  already uses `accept-new`; the Nodes clone should be aligned.
- **`test_local_mode.py` pre-existing assertion failure.** Expects
  `filename_prefix` `gen_test` but the code produces `gen_test_output`.
  Unrelated to recent changes.

## Product scope

- **Payments are decorative.** No live payment processor is wired up
  (`VIDIA_PAYMENTS_ENABLED=false`); the credits/checkout flow is UI only.
- **Restart endpoint returns 501.** Job restart is not implemented.
- **Build Mode is local-only.** Hidden when `VITE_API_BASE` is not localhost.
