#!/usr/bin/env python3
"""Resume a quiesced custom stack without waiting for execution-history backup."""
import argparse
import hashlib
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--compose-file', required=True)
p.add_argument('--project', required=True)
p.add_argument('--accepted-report', required=True)
p.add_argument('--resume-report', required=True)
p.add_argument('--log-dir', required=True)
p.add_argument('--database-host', required=True)
p.add_argument('--main', default='n8n')
p.add_argument('--proxy', default='n8n-proxy')
p.add_argument('--url', default='http://127.0.0.1:5678/')
a = p.parse_args()
root = Path(__file__).resolve().parents[1]
logs = Path(a.log_dir).resolve()
logs.mkdir(parents=True, exist_ok=True, mode=0o700)
old_report = json.loads(Path(a.resume_report).read_text())
backup = Path(old_report['backupDir'])
old = json.loads((backup / 'original-containers.json').read_text())
cfg = json.loads((backup / 'resolved-compose.json').read_text())
accepted = json.loads(Path(a.accepted_report).read_text())
assert accepted['ok'] and accepted['sourceVerified']
image_ids = {x['image']: x['id'] for x in accepted['images']}
apps = [s for s, c in cfg['services'].items() if c.get('image') in image_ids]
n8n = [s for s in apps if cfg['services'][s]['image'] == accepted['images'][0]['image']]
workers = [s for s in n8n if (cfg['services'][s].get('command') or [''])[0] == 'worker']
compose = ['docker', 'compose', '-p', a.project, '-f', a.compose_file]
summary = {'ok': False, 'version': accepted['version'], 'backupDir': str(backup),
           'fullHistoryBackupCompleted': False, 'steps': [], 'beforeDatabase': old_report['beforeDatabase'],
           'rollbackImages': old_report['rollbackImages'], 'before': old_report['before']}

def save():
    (logs / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')

def run(label, cmd, stdin=None, output=None, env=None):
    print('RUN ' + label, flush=True)
    with (logs / (label + '.log')).open('wb') as log:
        inp = Path(stdin).open('rb') if stdin else subprocess.DEVNULL
        out = Path(output).open('wb') if output else log
        if output:
            os.chmod(output, 0o600)
        try:
            r = subprocess.run(cmd, stdin=inp, stdout=out, stderr=log, env=env)
        finally:
            if stdin: inp.close()
            if output: out.close()
    summary['steps'].append({'name': label, 'status': 'passed' if r.returncode == 0 else 'failed'})
    save()
    assert r.returncode == 0, label + ' failed; see ' + str(logs / (label + '.log'))
    print('PASS ' + label, flush=True)

def capture(cmd, **kw):
    return subprocess.check_output(cmd, text=True, **kw).strip()

def containers():
    ids = capture(compose + ['ps', '--all', '--quiet']).split()
    return {c['Config']['Labels']['com.docker.compose.service']: c
            for c in json.loads(capture(['docker', 'inspect'] + ids))}

def envmap(c):
    return dict(x.split('=', 1) for x in c['Config']['Env'])

def ready(c, port, path):
    code = f'fetch("http://127.0.0.1:{port}{path}",{{signal:AbortSignal.timeout(3000)}}).then(r=>{{process.exitCode=r.ok?0:1}}).catch(()=>{{process.exitCode=1}})'
    return subprocess.run(['docker', 'exec', c['Id'], 'node', '-e', code], capture_output=True).returncode == 0

try:
    summary['sourceCommit'] = capture(['git', '-C', str(root), 'rev-parse', 'HEAD'])
    assert summary['sourceCommit'] == capture(['git', '-C', str(root), 'rev-parse', 'origin/my-server'])
    assert not capture(['git', '-C', str(root), 'status', '--porcelain', '--untracked-files=no'])
    current = containers()
    for s in apps:
        assert current[s]['Id'] == old[s]['Id'] and not current[s]['State']['Running']
        assert json.loads(capture(['docker', 'image', 'inspect', cfg['services'][s]['image']]))[0]['Id'] == image_ids[cfg['services'][s]['image']]
    e = envmap(old[a.main])
    pg_env = {**os.environ, 'PGHOST': a.database_host, 'PGPORT': e.get('DB_POSTGRESDB_PORT', '5432'),
              'PGUSER': e['DB_POSTGRESDB_USER'], 'PGPASSWORD': e['DB_POSTGRESDB_PASSWORD'],
              'PGDATABASE': e['DB_POSTGRESDB_DATABASE']}
    metadata, schema = backup / 'metadata.dump', backup / 'schema.dump'
    run('backup-metadata', ['pg_dump', '--format=custom', '--compress=zstd:1', '--table=workflow_entity', '--table=credentials_entity', '--table=settings', '--table=migrations', '--no-password'], output=metadata, env=pg_env)
    run('backup-schema', ['pg_dump', '--format=custom', '--schema-only', '--no-password'], output=schema, env=pg_env)
    for s in n8n:
        run('backup-storage-' + s, ['docker', 'cp', old[s]['Id'] + ':/home/node/.n8n', '-'], output=backup / (s + '-storage.tar'))
    run('create-applications', compose + ['up', '--no-start', '--no-deps', '--force-recreate', '--pull', 'never'] + apps)
    current = containers()
    for s in n8n:
        run('restore-storage-' + s, ['docker', 'cp', '-a', '-', current[s]['Id'] + ':/home/node'], stdin=backup / (s + '-storage.tar'))
    run('start-main', ['docker', 'start', current[a.main]['Id']])
    deadline = time.monotonic() + 180
    while not ready(current[a.main], 5678, '/healthz/readiness'):
        assert time.monotonic() < deadline, 'main readiness timed out'
        time.sleep(2)
    run('start-other-applications', ['docker', 'start'] + [current[s]['Id'] for s in apps if s != a.main])
    deadline = time.monotonic() + 180
    while True:
        current = containers()
        pending = [s for s in apps if not ready(current[s], 5678 if s in n8n else 5680, '/healthz/readiness' if s in n8n else '/healthz')]
        if not pending: break
        assert time.monotonic() < deadline, 'readiness pending: ' + ','.join(pending)
        time.sleep(2)
    assert capture(['docker', 'exec', current[a.main]['Id'], 'n8n', '--version']) == accepted['version']
    deadline = time.monotonic() + 60
    while True:
        pending = []
        for s in workers:
            r = subprocess.run(['docker', 'logs', '--since', current[s]['State']['StartedAt'], current[s]['Id']], capture_output=True, text=True)
            if 'Registered runner "launcher-javascript"' not in r.stdout or 'Registered runner "launcher-python"' not in r.stdout:
                pending.append(s)
        if not pending: break
        assert time.monotonic() < deadline, 'runner registration pending: ' + ','.join(pending)
        time.sleep(2)
    if not old_report['queueWasPaused']:
        code = 'const Bull=require("bull");const e=process.env;const q=new Bull("jobs",{prefix:e.QUEUE_BULL_PREFIX||"bull",redis:{host:e.QUEUE_BULL_REDIS_HOST,port:Number(e.QUEUE_BULL_REDIS_PORT||6379),db:Number(e.QUEUE_BULL_REDIS_DB||0),password:e.QUEUE_BULL_REDIS_PASSWORD}});(async()=>{await q.resume();await q.close();console.log("queue resumed")})().catch(e=>{console.error(e.message);process.exitCode=1})'
        run('resume-queue', ['docker', 'exec', '-w', '/usr/local/lib/node_modules/n8n', current[workers[0]]['Id'], 'node', '-e', code])
    assert current[a.proxy]['Id'] == old[a.proxy]['Id']
    run('reload-proxy', ['docker', 'exec', current[a.proxy]['Id'], 'nginx', '-s', 'reload'])
    run('public-route', ['curl', '--noproxy', '*', '--max-time', '15', '--fail', '--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}', a.url])
    sql = "SELECT json_build_object('workflows',(SELECT count(*) FROM workflow_entity),'activeWorkflows',(SELECT count(*) FROM workflow_entity WHERE active),'credentials',(SELECT count(*) FROM credentials_entity),'migrations',(SELECT count(*) FROM migrations));"
    summary['afterDatabase'] = json.loads(capture(['psql', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], env=pg_env))
    for k in ['workflows', 'activeWorkflows', 'credentials']:
        assert summary['afterDatabase'][k] == summary['beforeDatabase'][k]
    summary['after'] = {}
    for s in apps:
        c = current[s]
        assert c['Image'] == image_ids[cfg['services'][s]['image']] and c['State']['Running'] and c['RestartCount'] == 0
        assert all(envmap(c).get(k) == str(v) for k, v in cfg['services'][s]['environment'].items())
        before, after = envmap(old[s]), envmap(c)
        assert all(before[k] == after.get(k) for k in before if 'PASSWORD' in k or 'TOKEN' in k or 'ENCRYPTION_KEY' in k)
        summary['after'][s] = {'id': c['Id'], 'imageId': c['Image'], 'restartCount': c['RestartCount'], 'sensitiveSettingsPreserved': True}
    summary.update(ok=True, queueResumed=not old_report['queueWasPaused'],
                   completedAt=datetime.now(timezone.utc).isoformat())
    print('SUCCESS native stack resumed on ' + accepted['version'], flush=True)
except Exception as error:
    summary['error'] = str(error)
    print('FAILURE ' + str(error), flush=True)
    raise SystemExit(1) from error
finally:
    save()
