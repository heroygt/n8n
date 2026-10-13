# Memory

## 2026-10-13: Release and deployment safety

- Use the pinned pnpm 12.4.2 native wrapper when an older Corepack shim expects the removed `bin/pnpm.cjs`. Keep this override scoped to the release worktree.
- Retain upstream runner shutdown fields when replaying custom module settings. For 2.43.4, preserve JS runner 2.43.2 and launcher 1.5.1.
- Check for duplicate Compose service containers before stopping services. Serialize recreations and hold the stack deployment lock. A dictionary must not silently choose one of two containers for the same service.
- Preserve the current legacy expression engine on noam88. Do not reset it to an unset default while replacing images.

## 2026-10-12: Upgrade a release fork

- A compare link does not identify the installed source version. Read the root and CLI manifests first.
- This fork had two local commits on 2.34.6. The requested release was 2.42.6.
- Release branches can diverge through backports. A normal merge can retain old release files or create conflicts unrelated to local changes.
- Compare the result with the exact target tag. Keep differences only in the declared local files and delivery documents.
- Save local changes as a patch before the upgrade. Keep a backup ref until the new version is verified.
- Docker stage names and native build layouts can change between releases. Apply local mirror settings to the new stages.
- Component versions can differ from the root release version. Compare each manifest with the target tag.
- Node installers do not automatically use macOS proxy settings. Pass the configured proxy through `HTTP_PROXY` and `HTTPS_PROXY` when GitHub downloads fail.
- A failed ripgrep installer can leave an empty `bin/` directory. A retry can skip the download because that directory exists. Verify the binary and the official archive digest before the retry.
- The user expects final custom n8n images to be built on `noam02`. A local source upgrade and local build are intermediate checks.
- The user requires source transfer through GitHub's `my-server` branch. Push changes before pulling them on `noam02`; do not substitute Git bundles.
- Initial direct Git fetch failures on noam02 were temporarily handled with protocol 0 and HTTP/1.1. The existing server build history shows that outbound operations should use its HTTP proxy instead. Run detached Git operations under `setsid` so closing the JumpServer PTY cannot interrupt them.
- The pinned Alpine Node builder includes its headers under `/usr/local/include/node`. Point node-gyp at `/usr/local` when a separate header download stalls.
- noam02 build history uses `http://10.110.63.114:8080`. Export both uppercase and lowercase HTTP/HTTPS proxy variables for Git and dependency installs. Pass them into Docker build steps too. Exclude localhost and internal registry hosts with `NO_PROXY` and `no_proxy`.
- The user's custom image names use default `latest` tags. A versioned candidate alone does not complete an upgrade. After acceptance, update both existing custom tags and publish them, keeping rollback references.
- Queue mode with `OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=true` disables the main task broker in 2.42.6 (`commands/start.ts`). Do not require runner registration there; verify worker registration and actual execution. The retained main runner can remain healthy and idle.
- For the immediate 2.42.7 patch rollout, the user explicitly requested no repeated comprehensive tests. Reuse the validated pipeline and keep only build, source/version, image smoke, and startup checks.
- 2026-10-13: The user prefers a clean release replay: extract custom commits from the exact pre-merge `my-server` HEAD, cherry-pick them onto the target official tag, and place manual adaptations last. The merge-based upgrade approach is superseded.
- Preserve newer upstream Node/runner/launcher/package versions when porting Docker changes. Explain conflicts by old behavior, new structure, final placement, and retained version pins; do not copy the old Dockerfile wholesale.
