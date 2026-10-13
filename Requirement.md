# Requirement

## 2026-10-13: Upgrade the custom fork to stable 2.43.4

- Use official `n8n@2.43.4` as the release base. Replay the two original custom commits from the exact pre-merge 2.34.6 HEAD. Place manual adaptations last.
- Preserve upstream package, Node, runner and launcher versions. Keep the new runner shutdown allowlist entries with the existing custom module settings.
- Send source through GitHub `my-server`. Build both custom images on noam02. Publish the existing `n8n-custom:latest` and `n8n-runner-custom:latest` names.
- Replace and restart the custom services on noam02 and noam88. Preserve current configuration, credentials, storage and the noam88 legacy expression engine.
- Run source fidelity, build, focused checks, image smoke and startup checks. Do not repeat comprehensive or performance tests. Preserve database schema and relevant metadata before migrations.

## 2026-10-12: Upgrade n8n to 2.42.6

- Upgrade `my-server` from 2.34.6 to the official `n8n@2.42.6` source.
- Original commit: `3f48f184f39cdd292a9707fb1e45659606caa648`.
- Original release: `d743b0ad2e` (2.34.6).
- Keep the Redis pipeline, Docker build, runner settings, and backend changes.
- Historical requirement: keep both Git histories in a merge commit. Superseded by the 2026-10-13 linear replay requirement below. Preserve the merged history in a backup branch.
- Run the version and source checks before the upgrade. Confirm they fail. Run them again after the upgrade.
- Install dependencies from the official lockfile. Run the build, existing focused tests, package lint, and typecheck. Record each failure.
- Build the final custom n8n and runner images on `noam02`. Use the server's existing image naming and build conventions.
- Publish code to GitHub's `my-server` branch first. The server must fetch that branch before building. Do not use bundles for later source delivery.
- Update the existing `n8n-custom` and `n8n-runner-custom` default `latest` tags. Versioned candidate tags are intermediate acceptance artifacts, not the final delivery names. Preserve rollback image references before updating the default tags.
- Verify the image version and native modules before marking the task complete.
- Original scope: image builds only. Superseded by the noam02 rollout authorization below.

### Acceptance criteria

1. The root and CLI versions are 2.42.6. All other release files match the official tag.
2. Existing local behavior remains available. Resolve conflicts against the new upstream structure.
3. No merge conflicts remain. The check script accepts release and source refs as arguments.
4. Update the feature, architecture, and issue documents with the result.
5. Produce verified 2.42.6 custom images on `noam02`. Record their names, image IDs, build path, and rollback references.

### Completion

- 2026-10-12: All acceptance criteria passed. Both existing custom `latest` tags were updated and pushed to the server registry. Final evidence is recorded in `outputs/n8n-upgrade-2.42.6.md` and its JSON receipts.

### Scope clarification

- 2026-10-12: The user confirmed that the final images must be built on `noam02`. Local compilation alone does not complete the task.
- 2026-10-12: The user requires GitHub `my-server` as the source transfer path. Align the server checkout with `origin/my-server` before continuing.
- 2026-10-12: The user clarified that their custom images use the default tag, without release version tags. Publish the accepted images under the existing `latest` names.

## 2026-10-12: Deploy on noam02 before considering noam88

- Upgrade the running n8n main, worker, and both runner services on noam02 to the accepted custom default images.
- Inspect the active Compose topology and persistent storage first. Preserve deployment configuration and a database backup before migrations.
- Verify version, database readiness, main/worker health, runner connectivity, and the existing frontend route after deployment.
- Record the result and rollback references. Ask the user to confirm the noam02 result after these checks pass.
- Do not upgrade noam88 until the user confirms noam02 and explicitly decides to proceed there.

### Runtime result

- 2026-10-12: noam02 was restarted on 2.42.6. Main/worker readiness, worker JS/Python registration, both launcher health endpoints, and the public route passed. Preserved 232 workflows, 125 active workflows, and 33 credentials. A private backup was taken before 47 migrations (241 to 288).
- User review was superseded by the immediate 2.42.7 upgrade request below. noam88 remains untouched.

## 2026-10-12: Immediate patch upgrade to 2.42.7

- Merge official `n8n@2.42.7`, preserve all custom changes, and deliver source through GitHub `my-server`.
- Rebuild and publish the existing custom default images on noam02, then restart its main, worker, and runner services.
- The user explicitly requests a simpler patch upgrade: do not repeat comprehensive tests. Use source/version checks, the required build, image smoke checks, and runtime readiness verification.
- Preserve rollback images and a private pre-restart backup. Continue to leave noam88 unchanged until separately authorized.

### Completion

- 2026-10-12: 2.42.7 code was pushed to GitHub `my-server` and fetched on noam02 before building. Both accepted custom defaults were published, and all four application services restarted successfully.
- Main/worker readiness, launcher health, worker JS/Python registration, and public HTTP 200 passed. Counts remain 232 workflows, 125 active workflows, 33 credentials, and 288 migrations. No comprehensive tests were repeated.
- Backup and rollback references are recorded in `outputs/n8n-upgrade-2.42.7.md` and the sanitized deployment receipt. User review of noam02 remains pending; noam88 is unchanged.

## 2026-10-12: Authorized noam88 rollout

- The user now explicitly authorizes upgrading noam88 to the accepted 2.42.7 custom images. This supersedes the earlier noam88 hold.
- Pull the exact image digests built and published on noam02. Preserve default image names and deliver deployment code through GitHub `my-server`.
- Upgrade its main, two webhook processors, eight workers, and nine runners; retain native PostgreSQL/Redis and the proxy configuration.
- Preserve a private database/configuration backup, the writable `.n8n` directories, queue state, and rollback images before migrations. Verify versions, readiness, worker runner registration, and the existing proxy route; do not repeat comprehensive tests.
- User subsequently instructed immediate restart. Cancel the long full execution-history dump; retain metadata/schema, configuration, queue, writable storage, and image rollback backups, then start the accepted release directly.

## 2026-10-13: Rebuild upgrade history from the pre-merge HEAD

- Extract customizations from `my-server` immediately before its first upgrade merge: `3f48f184f39cdd292a9707fb1e45659606caa648` (2.34.6), verified as `3ddc4d99f4^1`.
- Use the two commits on its 2.34.6 baseline: `ff554c5047` then `3f48f184f3`. Cherry-pick them with provenance onto official `n8n@2.42.7`; the previous upgrade merges are not replay inputs.
- Keep a linear history: official 2.42.7, Redis customization, backend/runner customization, then one final manual compatibility/tooling/documentation commit.
- Preserve all target Node, runner, launcher, pnpm, package and lockfile versions. Document every conflict and how original behavior is ported to the new structure.
- Preserve the prior merged branch and the exact pre-merge source on GitHub before replacing `my-server` with an exact force-with-lease.
- Verify official manifests, all custom patches, product-tree equivalence, linear history and final manual commit placement. Existing deployment receipts remain historical evidence for their original hashes.
- Version and conflict decisions, commit mapping and backup refs are recorded in `outputs/n8n-2.42.7-cherry-pick.md`.

### Completion

- Two original custom commits were cherry-picked with provenance onto official 2.42.7, followed by one final manual adjustment commit. Source/version and history checks passed; application, Docker and dependency files match the previously accepted custom release.
- Both old refs were saved on GitHub before replacement. Detailed Node/runner version decisions and Docker conflict resolution are recorded in the replay report.
