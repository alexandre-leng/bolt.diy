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
