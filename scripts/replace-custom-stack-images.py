#!/usr/bin/env python3
"""Replace equivalent custom images. Preserve the live environment and storage."""
import argparse
import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-file", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--accepted-report", required=True)
    parser.add_argument("--comparison-report", required=True)
    parser.add_argument("--log-dir", required=True)
    parser.add_argument("--url")
    parser.add_argument("--proxy", default="n8n-proxy")
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--stop-timeout", type=int, default=20)
    parser.add_argument("--stage", choices=["preflight", "all"], default="preflight")
    args = parser.parse_args()
    os.umask(0o077)
    root = Path(__file__).resolve().parents[1]
    logs = Path(args.log_dir).resolve()
    logs.mkdir(parents=True, exist_ok=True)
    file = Path(args.compose_file).resolve()
    base = ["docker", "compose", "-p", args.project, "-f", str(file)]
    summary = {"ok": False, "project": args.project, "stage": args.stage, "steps": []}
    previous, apps, stopped, created = {}, [], False, False

    def save():
        (logs / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")

    def capture(cmd):
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(cmd[0] + " failed; inspect the private step log")
        return result.stdout.strip()

    def run(name, cmd, source=None, target=None):
        print("RUN " + name, flush=True)
        item = {"name": name, "status": "running"}
        summary["steps"].append(item)
        save()
        with (logs / (name + ".log")).open("wb") as log:
            inp = Path(source).open("rb") if source else subprocess.DEVNULL
            out = Path(target).open("wb") if target else log
            try:
                result = subprocess.run(cmd, stdin=inp, stdout=out, stderr=log)
            finally:
                if source:
                    inp.close()
                if target:
                    out.close()
        item["status"] = "passed" if result.returncode == 0 else "failed"
        save()
        if result.returncode:
            raise RuntimeError(name + " failed")
        print("PASS " + name, flush=True)

    def inventory():
        ids = capture(base + ["ps", "-aq"]).split()
        return {c["Config"]["Labels"]["com.docker.compose.service"]: c
                for c in json.loads(capture(["docker", "inspect"] + ids))}

    def environment(c):
        return dict(x.split("=", 1) for x in c["Config"]["Env"])

    def brief(cs):
        return {s: {"id": c["Id"], "imageId": c["Image"],
                    "running": c["State"]["Running"], "restartCount": c["RestartCount"]}
                for s, c in cs.items()}

    def ready(c, port, path):
        code = ('fetch("http://127.0.0.1:' + str(port) + path
                + '",{signal:AbortSignal.timeout(2000)}).then(r=>{process.exitCode=r.ok?0:1})'
                  '.catch(()=>{process.exitCode=1})')
        return subprocess.run(["docker", "exec", c["Id"], "node", "-e", code],
                              capture_output=True).returncode == 0

    try:
        accepted = json.loads(Path(args.accepted_report).read_text())
        comparison = json.loads(Path(args.comparison_report).read_text())
        assert accepted["ok"] and accepted["sourceVerified"], "accepted images required"
        assert comparison["conclusion"]["runtimeContentEquivalent"], "equivalent runtime required"
        expected = {a["image"]: a["id"] for a in accepted["artifacts"]}
        compared = {a["candidateId"] for a in comparison["imageComparison"]["images"]}
        assert set(expected.values()) == compared, "receipt image IDs differ"
        summary["version"] = accepted["version"]
        summary["buildSourceCommit"] = accepted["sourceCommit"]
        revision = capture(["git", "-C", str(root), "rev-parse", "HEAD"])
        assert revision == capture(["git", "-C", str(root), "rev-parse", "origin/my-server"])
        assert not capture(["git", "-C", str(root), "status", "--porcelain", "--untracked-files=no"])
        summary["deploymentSourceCommit"] = revision
        cfg = json.loads(capture(base + ["config", "--format", "json"]))
        apps = [s for s, c in cfg["services"].items() if c.get("image") in expected]
        assert apps, "no target services"
        previous = inventory()
        n8n = [s for s in apps if "/n8n-custom:" in cfg["services"][s]["image"]]
        runners = [s for s in apps if s not in n8n]
        allowed_old = {a["baselineId"] for a in comparison["imageComparison"]["images"]} | compared
        for image, image_id in expected.items():
            info = json.loads(capture(["docker", "image", "inspect", image]))[0]
            assert info["Id"] == image_id, "default tag differs"
        for s in apps:
            c = previous[s]
            assert c["State"]["Running"], s + " is not running"
            assert c["Image"] in allowed_old, s + " has an unreviewed image"
            assert c["Config"]["Labels"]["org.opencontainers.image.version"] == accepted["version"]
        assert "n8n" in n8n, "main service required"
        summary.update(before=brief(previous), services=apps)
        save()
        if args.stage == "preflight":
            summary["ok"] = True
            print("SUCCESS equivalent image refresh preflight", flush=True)
            return

        for name, obj in [("original-containers.private.json", previous),
                          ("resolved-compose.private.json", cfg)]:
            (logs / name).write_text(json.dumps(obj))
        shutil.copyfile(file, logs / "docker-compose.private.yml")
        if (file.parent / ".env").exists():
            shutil.copyfile(file.parent / ".env", logs / "environment.private.env")
        overrides = {"services": {}}
        for s in apps:
            old_env = environment(previous[s])
            env = {k: None for k in cfg["services"][s].get("environment", {})}
            env.update(old_env)
            overrides["services"][s] = {
                "environment": env, "command": previous[s]["Config"]["Cmd"],
                "entrypoint": previous[s]["Config"]["Entrypoint"]}
        override = logs / "runtime-override.private.json"
        override.write_text(json.dumps(overrides))
        compose = base + ["-f", str(override)]
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        for i, image_id in enumerate(sorted({previous[s]["Image"] for s in apps})):
            run("preserve-image-" + str(i),
                ["docker", "tag", image_id, "n8n-refresh-rollback:" + stamp + "-" + str(i)])
        assert json.loads(capture(base + ["config", "--format", "json"])) == cfg, "configuration changed"
        assert all(inventory()[s]["Id"] == previous[s]["Id"] for s in apps), "container changed"

        stopped = True
        run("stop-applications", compose + ["stop", "--timeout", str(args.stop_timeout)] + apps)
        storage = []
        for s in n8n:
            mounted = any("/home/node/.n8n" == m["Destination"]
                          or "/home/node/.n8n".startswith(m["Destination"].rstrip("/") + "/")
                          for m in previous[s]["Mounts"])
            if not mounted:
                storage.append(s)
                run("preserve-storage-" + s,
                    ["docker", "cp", previous[s]["Id"] + ":/home/node/.n8n", "-"],
                    target=logs / (s + "-storage.private.tar"))
        summary["restoredStorageServices"] = storage
        assert json.loads(capture(base + ["config", "--format", "json"])) == cfg, "configuration changed"
        created = True
        run("create-applications", compose
            + ["up", "--no-start", "--no-deps", "--force-recreate", "--pull", "never"] + apps)
        fresh = inventory()
        for s in storage:
            run("restore-storage-" + s, ["docker", "cp", "-a", "-", fresh[s]["Id"] + ":/home/node"],
                source=logs / (s + "-storage.private.tar"))
        for s in apps:
            assert environment(fresh[s]) == environment(previous[s]), s + " environment differs"
            assert fresh[s]["Config"]["Cmd"] == previous[s]["Config"]["Cmd"], s + " command differs"
            assert fresh[s]["Image"] == expected[cfg["services"][s]["image"]], s + " image differs"
        run("start-main", ["docker", "start", fresh["n8n"]["Id"]])
        run("start-other-applications", ["docker", "start"] + [fresh[s]["Id"] for s in apps if s != "n8n"])

        deadline = time.monotonic() + args.timeout
        while True:
            fresh = inventory()
            pending = [s for s in apps if not fresh[s]["State"]["Running"]]
            pending += [s for s in n8n if not ready(fresh[s], 5678, "/healthz/readiness")]
            pending += [s for s in runners if not ready(fresh[s], 5680, "/healthz")]
            if not pending:
                break
            assert time.monotonic() < deadline, "readiness pending: " + ",".join(sorted(set(pending)))
            time.sleep(2)
        fresh = inventory()
        for s in apps:
            assert fresh[s]["Image"] == expected[cfg["services"][s]["image"]]
            assert fresh[s]["RestartCount"] == 0, s + " restarted"
            assert environment(fresh[s]) == environment(previous[s]), s + " environment differs"
        for s in set(previous) - set(apps):
            assert fresh[s]["Id"] == previous[s]["Id"], s + " was recreated"
        workers = [s for s in n8n if (fresh[s]["Config"]["Cmd"] or [""])[0] == "worker"]
        for s in workers:
            log = subprocess.run(["docker", "logs", "--since", fresh[s]["State"]["StartedAt"], fresh[s]["Id"]],
                                 capture_output=True, text=True)
            text = log.stdout + log.stderr
            assert re.search(r"Registered runner.*(launcher-javascript|JS Task Runner)", text), s + " JS runner missing"
            assert re.search(r"Registered runner.*(launcher-python|Python Task Runner)", text), s + " Python runner missing"
        assert capture(["docker", "exec", fresh["n8n"]["Id"], "n8n", "--version"]) == accepted["version"]
        if args.proxy in fresh:
            run("reload-proxy", ["docker", "exec", fresh[args.proxy]["Id"], "nginx", "-s", "reload"])
        if args.url:
            run("public-route", ["curl", "--noproxy", "*", "--max-time", "15", "-fsS",
                                 "--output", "/dev/null", "--write-out", "%{http_code}", args.url])
        summary.update(ok=True, after=brief(fresh), environmentPreserved=True,
                       completedAt=datetime.now(timezone.utc).isoformat())
        print("SUCCESS equivalent custom image replacement", flush=True)
    except Exception as error:
        summary["error"] = str(error) or type(error).__name__
        print("FAILURE " + summary["error"], flush=True)
        if stopped and not created:
            try:
                run("resume-original-applications", ["docker", "start"] + [previous[s]["Id"] for s in apps])
            except Exception:
                pass
        raise SystemExit(1) from error
    finally:
        save()

if __name__ == "__main__":
    main()
