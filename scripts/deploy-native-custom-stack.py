#!/usr/bin/env python3
"""Deploy accepted custom images to a Compose queue stack with native PG/Redis."""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compose-file', required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--accepted-report', required=True)
    parser.add_argument('--backup-root', required=True)
    parser.add_argument('--log-dir', required=True)
    parser.add_argument('--main', default='n8n')
    parser.add_argument('--proxy', default='n8n-proxy')
    parser.add_argument('--url', default='http://127.0.0.1:5678/')
    parser.add_argument('--version', default='2.42.7')
    parser.add_argument('--stage', choices=['preflight', 'all'], default='preflight')
    parser.add_argument('--timeout', type=int, default=180)
    parser.add_argument('--allow-config-change', action='append', default=[])
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    logs = Path(args.log_dir).resolve()
    logs.mkdir(parents=True, exist_ok=True, mode=0o700)
    compose_file = Path(args.compose_file).resolve()
    compose = ['docker', 'compose', '-p', args.project, '-f', str(compose_file)]
    summary = {'ok': False, 'version': args.version, 'project': args.project, 'steps': []}
    previous, apps, workers = {}, [], []
    paused, schema_started, stopped = False, False, False

    def save():
        (logs / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')

    def capture(cmd, **kw):
        result = subprocess.run(cmd, capture_output=True, text=True, check=False, **kw)
        if result.returncode:
            raise RuntimeError(f'{cmd[0]} failed: {result.stderr[-400:]}')
        return result.stdout.strip()

    def step(name, cmd, input_file=None, output_file=None, env=None):
        item = {'name': name, 'status': 'running', 'startedAt': datetime.now(timezone.utc).isoformat()}
        summary['steps'].append(item)
        save()
        print('RUN ' + name, flush=True)
        with (logs / (name + '.log')).open('wb') as log:
            inp = Path(input_file).open('rb') if input_file else subprocess.DEVNULL
            out = Path(output_file).open('wb') if output_file else log
            if output_file:
                os.chmod(output_file, 0o600)
            try:
                result = subprocess.run(cmd, stdin=inp, stdout=out, stderr=log, env=env, check=False)
            finally:
                if input_file:
                    inp.close()
                if output_file:
                    out.close()
        item.update(status='passed' if result.returncode == 0 else 'failed',
                    exitCode=result.returncode, finishedAt=datetime.now(timezone.utc).isoformat())
        save()
        if result.returncode:
            raise RuntimeError(name + ' failed; see ' + str(logs / (name + '.log')))
        print('PASS ' + name, flush=True)

    def containers():
        ids = capture(compose + ['ps', '--all', '--quiet']).split()
        records = json.loads(capture(['docker', 'inspect'] + ids))
        return {c['Config']['Labels']['com.docker.compose.service']: c for c in records}

    def envmap(container):
        return dict(entry.split('=', 1) for entry in container['Config']['Env'])

    def wait(label, check):
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            try:
                if check():
                    print('PASS ' + label, flush=True)
                    return
            except (RuntimeError, subprocess.SubprocessError):
                pass
            time.sleep(2)
        raise RuntimeError(label + ' timed out')

    def ready(c, port, path):
        js = f'fetch("http://127.0.0.1:{port}{path}",{{signal:AbortSignal.timeout(3000)}}).then(r=>{{console.log(r.status);process.exitCode=r.ok?0:1}}).catch(()=>{{process.exitCode=1}})'
        return capture(['docker', 'exec', c['Id'], 'node', '-e', js]) == '200'

    def brief(records):
        return {s: {'id': c['Id'], 'imageId': c['Image'], 'restartCount': c['RestartCount']}
                for s, c in records.items()}

    def digest(file):
        h = hashlib.sha256()
        with file.open('rb') as stream:
            for data in iter(lambda: stream.read(4 * 1024 * 1024), b''):
                h.update(data)
        return {'file': str(file), 'bytes': file.stat().st_size, 'sha256': h.hexdigest()}

    try:
        accepted = json.loads(Path(args.accepted_report).read_text())
        assert accepted['ok'] and accepted['sourceVerified']
        assert accepted['version'] == args.version
        summary['sourceCommit'] = capture(['git', '-C', str(root), 'rev-parse', 'HEAD'])
        assert summary['sourceCommit'] == capture(['git', '-C', str(root), 'rev-parse', 'origin/my-server'])
        assert not capture(['git', '-C', str(root), 'status', '--porcelain', '--untracked-files=no'])
        cfg = json.loads(capture(compose + ['config', '--format', 'json']))
        images = accepted['images']
        ids = {a['image']: a['id'] for a in images}
        for image, expected in ids.items():
            assert json.loads(capture(['docker', 'image', 'inspect', image]))[0]['Id'] == expected
        apps = [s for s, c in cfg['services'].items() if c.get('image') in ids]
        n8n_services = [s for s in apps if cfg['services'][s]['image'] == images[0]['image']]
        runners = [s for s in apps if s not in n8n_services]
        workers = [s for s in n8n_services if (cfg['services'][s].get('command') or [''])[0] == 'worker']
        ingress = [s for s in n8n_services if s not in workers]
        assert args.main in ingress and workers and runners
        previous = containers()
        summary['configuredEnvironmentChanges'] = {}
        for s in apps:
            assert previous[s]['State']['Running']
            expected_env, actual_env = cfg['services'][s]['environment'], envmap(previous[s])
            changed = [k for k, v in expected_env.items() if actual_env.get(k) != str(v)]
            assert all(k in args.allow_config_change for k in changed), f'{s}: configured keys differ: {changed}'
            assert not any('PASSWORD' in k or 'TOKEN' in k or 'ENCRYPTION_KEY' in k for k in changed)
            if changed:
                summary['configuredEnvironmentChanges'][s] = changed
        e = envmap(previous[args.main])
        assert e['DB_TYPE'] == 'postgresdb' and e['EXECUTIONS_MODE'] == 'queue'
        dns = 'require("node:dns").lookup(process.env.DB_POSTGRESDB_HOST,(e,a)=>{if(e)throw e;console.log(a)})'
        db_host = capture(['docker', 'exec', previous[args.main]['Id'], 'node', '-e', dns])
        redis_dns = dns.replace('DB_POSTGRESDB_HOST', 'QUEUE_BULL_REDIS_HOST')
        redis_host = capture(['docker', 'exec', previous[args.main]['Id'], 'node', '-e', redis_dns])
        pg_env = {**os.environ, 'PGHOST': db_host, 'PGPORT': e.get('DB_POSTGRESDB_PORT', '5432'),
                  'PGUSER': e['DB_POSTGRESDB_USER'], 'PGPASSWORD': e['DB_POSTGRESDB_PASSWORD'],
                  'PGDATABASE': e['DB_POSTGRESDB_DATABASE']}
        redis_env = {**os.environ, 'REDISCLI_AUTH': e.get('QUEUE_BULL_REDIS_PASSWORD', '')}
        redis = ['redis-cli', '--no-auth-warning', '-h', redis_host, '-p', e.get('QUEUE_BULL_REDIS_PORT', '6379'), '-n', e.get('QUEUE_BULL_REDIS_DB', '0')]
        prefix = e.get('QUEUE_BULL_PREFIX', 'bull') + ':jobs:'
        schema = e.get('DB_POSTGRESDB_SCHEMA', 'public').replace('"', '""')
        sql = f'''SELECT json_build_object('bytes',pg_database_size(current_database()),'workflows',(SELECT count(*) FROM "{schema}".workflow_entity),'activeWorkflows',(SELECT count(*) FROM "{schema}".workflow_entity WHERE active),'credentials',(SELECT count(*) FROM "{schema}".credentials_entity),'migrations',(SELECT count(*) FROM "{schema}".migrations));'''

        def counts():
            return json.loads(capture(['psql', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], env=pg_env))

        bull = '''const Bull=require('bull');const e=process.env;const q=new Bull('jobs',{prefix:e.QUEUE_BULL_PREFIX||'bull',redis:{host:e.QUEUE_BULL_REDIS_HOST,port:Number(e.QUEUE_BULL_REDIS_PORT||6379),db:Number(e.QUEUE_BULL_REDIS_DB||0),password:e.QUEUE_BULL_REDIS_PASSWORD||undefined}});'''

        def queue_code(c, code):
            return ['docker', 'exec', '-w', '/usr/local/lib/node_modules/n8n', c['Id'], 'node', '-e', bull + '(async()=>{' + code + ';await q.close()})().catch(e=>{console.error(e.message);process.exitCode=1})']

        summary.update(before=brief(previous), beforeDatabase=counts(), services=apps,
                       workerServices=workers, ingressServices=ingress, runnerServices=runners)
        summary['queueWasPaused'] = capture(redis + ['EXISTS', prefix + 'meta-paused'], env=redis_env) == '1'
        summary['beforeActiveJobs'] = int(capture(redis + ['LLEN', prefix + 'active'], env=redis_env))
        assert ready(previous[args.main], 5678, '/healthz/readiness')
        print('PASS accepted images, GitHub source, topology, database and queue', flush=True)
        save()
        if args.stage == 'preflight':
            summary['ok'] = True
            return

        stamp = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
        backup = Path(args.backup_root).resolve() / ('n8n-' + args.version + '-' + stamp)
        backup.mkdir(parents=True, mode=0o700)
        summary['backupDir'] = str(backup)
        for source, target in [(compose_file, 'docker-compose.yml'), (compose_file.parent / '.env', 'environment.env')]:
            shutil.copyfile(source, backup / target)
            os.chmod(backup / target, 0o600)
        for name, data in [('original-containers.json', previous), ('resolved-compose.json', cfg)]:
            file = backup / name
            file.write_text(json.dumps(data))
            os.chmod(file, 0o600)
        summary['rollbackImages'] = []
        for index, s in enumerate([args.main, runners[0]]):
            tag = images[index]['image'] + '-rollback-' + stamp
            step('preserve-image-' + str(index), ['docker', 'tag', previous[s]['Image'], tag])
            summary['rollbackImages'].append({'image': tag, 'id': previous[s]['Image']})
        step('pause-queue', queue_code(previous[args.main], 'await q.pause();console.log("queue paused")'))
        paused = True
        step('stop-ingress', compose + ['stop', '--timeout', '120'] + ingress)
        stopped = True
        wait('active jobs drained', lambda: capture(redis + ['LLEN', prefix + 'active'], env=redis_env) == '0')
        snapshot = '''const r=await q.client;let cursor='0';const keys=[];do{const x=await r.scan(cursor,'MATCH',(e.QUEUE_BULL_PREFIX||'bull')+':jobs:*','COUNT',500);cursor=x[0];keys.push(...x[1])}while(cursor!=='0');const records=[];for(let i=0;i<keys.length;i+=250){const batch=keys.slice(i,i+250);const p=r.pipeline();for(const k of batch){p.dumpBuffer(k);p.pttl(k)}const out=await p.exec();for(let j=0;j<batch.length;j++){if(out[j*2][0]||out[j*2+1][0])throw new Error('queue snapshot failed');records.push({key:batch[j],dump:out[j*2][1]?.toString('base64'),ttl:out[j*2+1][1]})}}process.stdout.write(JSON.stringify(records))'''
        queue_file = backup / 'queue-state.json'
        step('backup-queue', queue_code(previous[workers[0]], snapshot), output_file=queue_file)
        json.loads(queue_file.read_text())
        step('stop-workers-runners', compose + ['stop', '--timeout', '120'] + workers + runners)
        summary['beforeDatabase'] = counts()
        database_file = backup / 'postgres.dump'
        step('backup-postgres', ['pg_dump', '--format=custom', '--compress=zstd:1', '--no-password'], output_file=database_file, env=pg_env)
        step('check-postgres-archive', ['pg_restore', '--list', str(database_file)])
        archives = []
        for s in n8n_services:
            file = backup / (s + '-storage.tar')
            step('backup-storage-' + s, ['docker', 'cp', previous[s]['Id'] + ':/home/node/.n8n', '-'], output_file=file)
            with tarfile.open(file) as archive:
                assert archive.getmembers()
            archives.append(file)
        summary['backups'] = [digest(f) for f in [database_file, queue_file] + archives]
        save()

        def recreate(selected):
            step('create-' + selected[0], compose + ['up', '--no-start', '--no-deps', '--force-recreate', '--pull', 'never'] + selected)
            fresh = containers()
            for s in selected:
                if s in n8n_services:
                    step('restore-storage-' + s, ['docker', 'cp', '-a', '-', fresh[s]['Id'] + ':/home/node'], input_file=backup / (s + '-storage.tar'))
            step('start-' + selected[0], ['docker', 'start'] + [fresh[s]['Id'] for s in selected])
            return containers()

        schema_started = True
        current = recreate([args.main])
        wait('main database readiness', lambda: ready(current[args.main], 5678, '/healthz/readiness'))
        current = recreate([s for s in apps if s != args.main])
        for s in n8n_services:
            wait(s + ' readiness', lambda s=s: ready(current[s], 5678, '/healthz/readiness'))
            assert capture(['docker', 'exec', current[s]['Id'], 'n8n', '--version']) == args.version
        for s in runners:
            wait(s + ' launcher health', lambda s=s: ready(current[s], 5680, '/healthz'))
        for s in workers:
            def registered(s=s):
                r = subprocess.run(['docker', 'logs', '--since', current[s]['State']['StartedAt'], current[s]['Id']], capture_output=True, text=True)
                log = r.stdout + r.stderr
                return bool(re.search(r'Registered runner.*(launcher-javascript|JS Task Runner)', log)
                            and re.search(r'Registered runner.*(launcher-python|Python Task Runner)', log))
            wait(s + ' JS/Python registration', registered)
        current = containers()
        for s in apps:
            assert current[s]['Image'] == ids[cfg['services'][s]['image']]
            assert current[s]['State']['Running'] and current[s]['RestartCount'] == 0
            assert all(envmap(current[s]).get(k) == str(v) for k, v in cfg['services'][s]['environment'].items())
        if not summary['queueWasPaused']:
            step('resume-queue', queue_code(current[workers[0]], 'await q.resume();console.log("queue resumed")'))
            paused = False
        if args.proxy in current:
            assert current[args.proxy]['Id'] == previous[args.proxy]['Id']
            step('reload-proxy', ['docker', 'exec', current[args.proxy]['Id'], 'nginx', '-s', 'reload'])
        step('public-route', ['curl', '--noproxy', '*', '--max-time', '15', '--fail', '--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}', args.url])
        summary['afterDatabase'] = counts()
        for k in ['workflows', 'activeWorkflows', 'credentials']:
            assert summary['afterDatabase'][k] == summary['beforeDatabase'][k]
        assert summary['afterDatabase']['migrations'] >= summary['beforeDatabase']['migrations']
        summary.update(after=brief(current), ok=True, queuePaused=paused)
        print('SUCCESS native queue stack deployment', flush=True)
    except Exception as error:
        frame = traceback.extract_tb(error.__traceback__)[-1]
        summary['error'] = str(error) or f'{type(error).__name__} at {frame.name}:{frame.lineno}'
        print('FAILURE ' + summary['error'], flush=True)
        if not schema_started and (stopped or paused):
            try:
                step('resume-original-services', ['docker', 'start'] + [previous[s]['Id'] for s in apps])
                if paused and not summary.get('queueWasPaused'):
                    step('resume-original-queue', queue_code(previous[workers[0]], 'await q.resume()'))
                summary['originalServicesResumed'] = True
            except Exception:
                summary['originalServicesResumed'] = False
        raise SystemExit(1) from error
    finally:
        save()


if __name__ == '__main__':
    main()
