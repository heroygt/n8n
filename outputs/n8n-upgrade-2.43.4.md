# Custom n8n upgrade to 2.43.4

Date: 2026-10-13. Status: source reconstructed. Server build and rollout are pending.

## Source and history

- Official release: [n8n@2.43.4](https://github.com/n8n-io/n8n/releases/tag/n8n%402.43.4), commit 69d73b9b6aab9654dcb53b2edf14c823e5f3709d.
- Customization source: pre-merge my-server HEAD 3f48f184f39cdd292a9707fb1e45659606caa648 on official 2.34.6.
- Redis replay: ff554c5047 to f939a51abd.
- Backend and runner replay: 3f48f184f3 to 56764d5053.
- One final manual commit follows both cherry-picks. It retains Docker adaptations, release helpers, prior evidence and this release record.
- Preserve the previous my-server tip f6640c2937 on GitHub before replacing the branch with an exact lease. Use GitHub my-server for server delivery.

## Versions retained from upstream

| Component | Previous 2.42.7 | Target 2.43.4 |
| --- | --- | --- |
| Application | 2.42.7 | 2.43.4 |
| Host Node minimum | 24.0.0 | 24.0.0 |
| Docker Node | 26.7.0 | 26.7.0 |
| pnpm | 12.4.2 | 12.4.2 |
| JS runner package | 2.42.5 | 2.43.2 |
| Runner launcher | 1.5.0 | 1.5.1 |
| Python series | 3.13 | 3.13 |
| Python runner package | 0.1.0 | 0.1.0 |

Component package versions do not have to equal the application version. All 102 target package manifests and the official lockfile are retained.

## Conflict and runner configuration

The only cherry-pick conflict is the n8n Dockerfile. The original custom commit targets the old single builder. The release uses the separate pinned Node toolchain and native builder.

Keep the official Dockerfile during the second cherry-pick. Apply its custom mirror and stable release type in the final manual commit. Keep the Node 26.7.0 image pins, native-builder stages, runtime copy rules, local Node headers and the native compile job cap. The upstream n8n Dockerfile is unchanged between 2.42.7 and 2.43.4, so the previously accepted adaptation remains valid.

The runner Dockerfile and JSON configuration merge automatically. Keep launcher 1.5.1 and the new upstream environment fields: JS graceful shutdown and force-kill margin, and Python graceful shutdown. Keep the original custom module allow settings with these additions. Do not restore the old complete runner configuration.

The backend and Redis patches apply without conflicts. Source verification confirms their original changes remain present.

## Deployment decisions

- Build both custom images on noam02. Verify candidate images before promoting the existing n8n-custom:latest and n8n-runner-custom:latest names.
- Pull exact accepted registry digests on noam88. Preserve its current legacy expression engine, concurrency, credentials and other runtime environment values.
- At 18:07 Asia/Shanghai, noam88 had 21 unique running containers. The previous interrupted recreation was recovered by the separately authorized legacy recovery.
- Preserve mounted storage on noam02. Copy and restore all unmounted .n8n directories on noam88 before starting new containers.
- The native deployment helper now rejects duplicate service containers, holds a stack lock and serializes Compose operations. Tests also cover literal dollar signs and absent runtime environment keys.
- Use the direct restart option requested by the user. Keep the native database and Redis processes. Preserve schema and non-execution data before migrations. Exclude execution-history rows from the noam88 dump, as requested in the previous rollout.
- The without-execution-history dump is not a full database backup. Do not describe it as one or use it for automatic full data restoration.

## Verification

- Before replay, the source/history gate failed as expected on absent custom changes and commit order.
- After porting, source checks pass: target manifests, allowed file differences, retained custom changes and no unresolved conflicts.
- Frozen dependency installation and the local workspace build pass. Local compilation took 168 seconds.
- The two deployment regression checks fail before the safety helpers exist and pass after implementation.
- Package lint and typechecks are recorded under work/upgrade-2.43.4. Comprehensive and performance tests are not repeated.
- Detailed build and live rollout results will be appended after completion.
