# Publication artifact boundary

`publish-artifact-boundary.patch` targets the host services in `/opt/bolt/publish`,
which are not part of this application's Git repository. It is **not applied by
building this application**.

It rejects symlinks and special files when copying sandbox output to published or
private-preview directories. File-descriptor-relative opens with `O_NOFOLLOW`
prevent host-side symlink dereferencing. It also keeps sandbox policy enabled when
the build token disappears: missing credentials return a bounded build failure,
not an implicit host-side subprocess.

Before delivery, compare the target against the latest host services, preserve
concurrent edits, and apply this patch to a separate copy first:

```sh
patch --batch -p1 -d <isolated-service-copy> < patches/publish-artifact-boundary.patch
BOLT_BUILD_SANDBOX=0 python3 -m unittest discover -s <isolated-service-copy> -p 'test_*.py' -q
```

The environment switch above disables live sandbox integration tests for this
**isolated unit-test run only**. Never set it on the production units.

Verified on a fresh service copy: 64 tests, 2 skipped, no failures. The two skipped
tests are not production verification. The patch preserves the host service's
concurrent `parse_publish_body` validation changes. It does not yet fix publication
ownership, concurrent builds of one slug, or atomic promotion after a failed build.

Production replacement/restart and authenticated browser verification remain
separate delivery steps; neither is implied by the presence of this patch.

## Runtime WebSocket envelope

`runtime-websocket-envelope.patch` targets the separate `/opt/bolt/runtime`
repository at base `4653b46`. It prevents a JSON `null` frame from throwing before
the request error handler and terminating Node. The new tests validate malformed
envelopes and use an ephemeral real HTTP/WebSocket server (no Docker or live
service) to prove that a valid operation still receives an answer after `null`.

Verified: runtime build succeeds; 27 unit tests pass. Commit `19e42fe` is on the
local `audit/runtime-personal` branch; this separate repository has no configured
remote. The patch here provides a GitHub-backed copy. Apply only after comparing
the current runtime sources and run its build plus unit tests before deployment.
