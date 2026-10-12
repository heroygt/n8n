# Function

## 2026-10-12: n8n 2.42.6

Status: local source checks passed. The final custom image build on `noam02` is pending.

- The root and CLI versions are 2.42.6. All 96 release manifests match the target tag.
- Keep Redis batch commands, `mget`, `mset`, automatic type lookup, and missing-key handling.
- Keep the existing relative resume URL fallback and backend settings.
- Keep the Alpine mirrors, stable image release type, and runner module settings.
- The new release blocks additions or changes to deprecated nodes by default. Saved workflows with these nodes can still run. `N8N_DEPRECATED_NODES_BLOCK=false` permits older imports when required.
- The Gemini image model list includes the new upstream models.

Validation details belong in `outputs/n8n-upgrade-2.42.6.md`. Detailed logs belong in `work/n8n-upgrade-2.42.6/`.
