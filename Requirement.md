# Requirement

## 2026-10-12: Upgrade n8n to 2.42.6

- Upgrade `my-server` from 2.34.6 to the official `n8n@2.42.6` source.
- Original commit: `3f48f184f39cdd292a9707fb1e45659606caa648`.
- Original release: `d743b0ad2e` (2.34.6).
- Keep the Redis pipeline, Docker build, runner settings, and backend changes.
- Keep both Git histories in a merge commit. Create a backup branch first.
- Run the version and source checks before the upgrade. Confirm they fail. Run them again after the upgrade.
- Install dependencies from the official lockfile. Run the build, existing focused tests, package lint, and typecheck. Record each failure.
- Build the final custom n8n and runner images on `noam02`. Use the server's existing image naming and build conventions.
- Verify the image version and native modules before marking the task complete.
- This request authorizes image builds. A running-service rollout is a separate step.

### Acceptance criteria

1. The root and CLI versions are 2.42.6. All other release files match the official tag.
2. Existing local behavior remains available. Resolve conflicts against the new upstream structure.
3. No merge conflicts remain. The check script accepts release and source refs as arguments.
4. Update the feature, architecture, and issue documents with the result.
5. Produce verified 2.42.6 custom images on `noam02`. Record their names, image IDs, build path, and rollback references.

### Scope clarification

- 2026-10-12: The user confirmed that the final images must be built on `noam02`. Local compilation alone does not complete the task.
