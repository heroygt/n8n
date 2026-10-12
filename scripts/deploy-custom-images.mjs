#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
	chmodSync,
	closeSync,
	copyFileSync,
	createReadStream,
	mkdirSync,
	openSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
	options: {
		'compose-file': { type: 'string' },
		project: { type: 'string' },
		'accepted-report': { type: 'string' },
		'backup-root': { type: 'string' },
		'log-dir': { type: 'string', default: 'work/custom-deployment' },
		version: {
			type: 'string',
			default: JSON.parse(readFileSync(resolve(root, 'package.json'))).version,
		},
		main: { type: 'string', default: 'n8n' },
		worker: { type: 'string', default: 'n8n-worker' },
		runners: { type: 'string', default: 'runner-main,runner-worker' },
		postgres: { type: 'string', default: 'postgres' },
		redis: { type: 'string', default: 'redis' },
		'public-url': { type: 'string' },
		timeout: { type: 'string', default: '180' },
		'stop-timeout': { type: 'string', default: '120' },
		'source-ref': { type: 'string', default: 'origin/my-server' },
		stage: { type: 'string', default: 'preflight' },
		help: { type: 'boolean', short: 'h' },
	},
});
if (
	values.help ||
	!values['compose-file'] ||
	!values.project ||
	!values['accepted-report'] ||
	!['preflight', 'all', 'verify'].includes(values.stage) ||
	(values.stage === 'all' && !values['backup-root'])
) {
	console.log(
		'Usage: node scripts/deploy-custom-images.mjs --compose-file FILE --project NAME --accepted-report FILE [--stage preflight|all|verify] [--backup-root DIR (all stage)] [--log-dir DIR] [--version VERSION] [--main SERVICE] [--worker SERVICE] [--runners SERVICE,SERVICE] [--postgres SERVICE] [--redis SERVICE] [--public-url URL] [--timeout SECONDS] [--stop-timeout SECONDS] [--source-ref REF]',
	);
	process.exit(values.help ? 0 : 2);
}
const timeout = Number(values.timeout);
assert.ok(Number.isInteger(timeout) && timeout > 0);
const composeFile = resolve(values['compose-file']);
const logDir = resolve(root, values['log-dir']);
mkdirSync(logDir, { recursive: true });
const compose = [
	'compose',
	'--project-directory',
	dirname(composeFile),
	'-p',
	values.project,
	'-f',
	composeFile,
];
const runnerServices = values.runners.split(',');
assert.equal(runnerServices.length, 2);
const apps = [values.main, values.worker, ...runnerServices];
const services = [...apps, values.postgres, values.redis];
const summary = {
	ok: false,
	version: values.version,
	project: values.project,
	composeFile,
	steps: [],
};
const save = () =>
	writeFileSync(resolve(logDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
const envMap = (container) =>
	Object.fromEntries(
		container.Config.Env.map((entry) => {
			const split = entry.indexOf('=');
			return [entry.slice(0, split), entry.slice(split + 1)];
		}),
	);

function capture(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
		...options,
	});
	if (result.status !== 0)
		throw new Error(`${command} failed: ${result.stderr?.trim().slice(-500)}`);
	return result.stdout.trim();
}
const inspect = (name) => JSON.parse(capture('docker', ['inspect', name]))[0];
function containers() {
	return Object.fromEntries(
		services.map((service) => {
			const id = capture('docker', [...compose, 'ps', '--all', '--quiet', service]);
			assert.ok(id && !id.includes('\n'), `expected one container for ${service}`);
			return [service, inspect(id)];
		}),
	);
}
async function run(name, command, args, { inputFile, outputFile } = {}) {
	const log = resolve(logDir, `${name}.log`);
	const fd = openSync(log, 'w', 0o600);
	const input = inputFile ? openSync(inputFile, 'r') : 'ignore';
	const output = outputFile ? openSync(outputFile, 'wx', 0o600) : fd;
	const step = { name, status: 'running', log, startedAt: new Date().toISOString() };
	summary.steps.push(step);
	save();
	console.log(`RUN ${name}`);
	const code = await new Promise((done) => {
		const child = spawn(command, args, { cwd: root, stdio: [input, output, fd] });
		child.once('error', () => done(1));
		child.once('close', (status) => done(status ?? 1));
	});
	closeSync(fd);
	if (inputFile) closeSync(input);
	if (outputFile) closeSync(output);
	Object.assign(step, {
		status: code === 0 ? 'passed' : 'failed',
		exitCode: code,
		finishedAt: new Date().toISOString(),
	});
	save();
	if (code !== 0) throw new Error(`${name} failed; see ${log}`);
	console.log(`PASS ${name}`);
}
function dbCounts(pg) {
	const sql =
		"SELECT json_build_object('database',current_database(),'bytes',pg_database_size(current_database()),'workflows',(SELECT count(*) FROM workflow_entity),'activeWorkflows',(SELECT count(*) FROM workflow_entity WHERE active),'credentials',(SELECT count(*) FROM credentials_entity),'migrations',(SELECT count(*) FROM migrations));";
	return JSON.parse(
		capture(
			'docker',
			[
				'exec',
				'-i',
				pg.Id,
				'sh',
				'-c',
				'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1',
			],
			{ input: sql },
		),
	);
}
const activeJobs = (redis) =>
	Number(capture('docker', ['exec', redis.Id, 'redis-cli', 'LLEN', 'bull:jobs:active']));
async function waitFor(label, check) {
	const end = Date.now() + timeout * 1000;
	while (Date.now() < end) {
		try {
			if (await check()) {
				console.log(`PASS ${label}`);
				return;
			}
		} catch {}
		await delay(2000);
	}
	throw new Error(`${label} did not pass within ${timeout}s`);
}
function ready(container, port, path) {
	const code = `fetch('http://127.0.0.1:${port}${path}', {signal: AbortSignal.timeout(3000)}).then(r => {console.log(r.status); process.exitCode = r.ok ? 0 : 1;}).catch(() => {process.exitCode=1;});`;
	return capture('docker', ['exec', container.Id, 'node', '-e', code]) === '200';
}
async function digest(file) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(file)) hash.update(chunk);
	return { file, bytes: statSync(file).size, sha256: hash.digest('hex') };
}

let previous;
let schemaStarted = false;
try {
	const accepted = JSON.parse(readFileSync(resolve(root, values['accepted-report']), 'utf8'));
	assert.equal(accepted.ok, true, 'a passed image acceptance report is required');
	assert.equal(accepted.sourceVerified, true);
	assert.equal(accepted.version, values.version);
	summary.sourceCommit = capture('git', ['rev-parse', 'HEAD']);
	assert.equal(
		summary.sourceCommit,
		capture('git', ['rev-parse', `${values['source-ref']}^{commit}`]),
	);
	assert.equal(
		capture('git', ['status', '--porcelain', '--untracked-files=no']),
		'',
		'fetch a clean GitHub source branch first',
	);
	const cfg = JSON.parse(capture('docker', [...compose, 'config', '--format', 'json']));
	previous = containers();
	for (const [index, service] of apps.entries()) {
		const artifact = accepted.artifacts[index < 2 ? 0 : 1];
		assert.equal(cfg.services[service].image, artifact.image);
		assert.equal(
			inspect(artifact.image).Id,
			artifact.id,
			'default tag must still identify the accepted image',
		);
		assert.equal(previous[service].Config.Labels['com.docker.compose.project'], values.project);
		assert.equal(previous[service].State.Running, true);
	}
	assert.equal(envMap(previous[values.main]).DB_TYPE, 'postgresdb');
	assert.equal(envMap(previous[values.main]).EXECUTIONS_MODE, 'queue');
	assert.equal(
		envMap(previous[values.main]).DB_POSTGRESDB_DATABASE,
		envMap(previous[values.postgres]).POSTGRES_DB,
	);
	assert.equal(envMap(previous[values.worker]).QUEUE_HEALTH_CHECK_ACTIVE, 'true');
	assert.ok(
		!envMap(previous[values.main]).QUEUE_BULL_PREFIX ||
			envMap(previous[values.main]).QUEUE_BULL_PREFIX === 'bull',
	);
	summary.before = Object.fromEntries(
		services.map((s) => [
			s,
			{ container: previous[s].Name, id: previous[s].Id, imageId: previous[s].Image },
		]),
	);
	summary.beforeDatabase = dbCounts(previous[values.postgres]);
	summary.beforeActiveJobs = activeJobs(previous[values.redis]);
	summary.acceptedImageSource = accepted.verifiedSourceCommit ?? accepted.sourceCommit;
	console.log('PASS image references, Compose topology, source, and database preflight');
	if (values.stage !== 'verify') {
		assert.ok(ready(previous[values.main], 5678, '/healthz/readiness'));
		assert.ok(ready(previous[values.worker], 5678, '/healthz/readiness'));
	}

	if (values.stage === 'all') {
		const stamp = new Date().toISOString().replaceAll(/[^\d]/g, '').slice(0, 14);
		const backupDir = resolve(values['backup-root'], `n8n-${values.version}-${stamp}`);
		mkdirSync(backupDir, { recursive: true, mode: 0o700 });
		chmodSync(backupDir, 0o700);
		summary.backupDir = backupDir;
		for (const file of [composeFile, resolve(dirname(composeFile), '.env')]) {
			const target = resolve(
				backupDir,
				file.endsWith('.env') ? 'environment.env' : 'docker-compose.yml',
			);
			copyFileSync(file, target);
			chmodSync(target, 0o600);
		}
		writeFileSync(resolve(backupDir, 'resolved-compose.json'), JSON.stringify(cfg), {
			mode: 0o600,
		});
		writeFileSync(resolve(backupDir, 'original-containers.json'), JSON.stringify(previous), {
			mode: 0o600,
		});
		await run('stop-main', 'docker', [
			...compose,
			'stop',
			'--timeout',
			values['stop-timeout'],
			values.main,
		]);
		summary.maintenance = true;
		await waitFor('active queue jobs drained', () => activeJobs(previous[values.redis]) === 0);
		await run('stop-worker-runners', 'docker', [
			...compose,
			'stop',
			'--timeout',
			values['stop-timeout'],
			values.worker,
			...runnerServices,
		]);
		summary.beforeDatabase = dbCounts(previous[values.postgres]);
		const databaseFile = resolve(backupDir, 'postgres.dump');
		await run(
			'backup-postgres',
			'docker',
			[
				'exec',
				previous[values.postgres].Id,
				'sh',
				'-c',
				'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-password',
			],
			{ outputFile: databaseFile },
		);
		await run(
			'check-postgres-archive',
			'docker',
			['exec', '-i', previous[values.postgres].Id, 'pg_restore', '--list'],
			{ inputFile: databaseFile },
		);
		await run('save-redis', 'docker', ['exec', previous[values.redis].Id, 'redis-cli', 'SAVE']);
		const acceptedImage = accepted.artifacts[0].image;
		const dataFile = resolve(backupDir, 'n8n-storage.tar.gz');
		await run(
			'backup-n8n-storage',
			'docker',
			[
				'run',
				'--rm',
				'--pull=never',
				'--network=none',
				'--user',
				'0',
				'--volumes-from',
				`${previous[values.main].Id}:ro`,
				'--entrypoint',
				'tar',
				acceptedImage,
				'-czf',
				'-',
				'-C',
				'/home/node',
				'.n8n',
			],
			{ outputFile: dataFile },
		);
		const redisFile = resolve(backupDir, 'redis-storage.tar.gz');
		await run(
			'backup-redis-storage',
			'docker',
			[
				'run',
				'--rm',
				'--pull=never',
				'--network=none',
				'--user',
				'0',
				'--volumes-from',
				`${previous[values.redis].Id}:ro`,
				'--entrypoint',
				'tar',
				acceptedImage,
				'-czf',
				'-',
				'-C',
				'/data',
				'.',
			],
			{ outputFile: redisFile },
		);
		await run('check-n8n-archive', 'gzip', ['--test', dataFile]);
		await run('check-redis-archive', 'gzip', ['--test', redisFile]);
		summary.backups = await Promise.all([databaseFile, dataFile, redisFile].map(digest));
		writeFileSync(
			resolve(backupDir, 'backup-receipt.json'),
			JSON.stringify({ database: summary.beforeDatabase, backups: summary.backups }, null, 2),
			{ mode: 0o600 },
		);
		save();
		schemaStarted = true;
		await run('start-main', 'docker', [
			...compose,
			'up',
			'-d',
			'--no-deps',
			'--force-recreate',
			'--pull',
			'never',
			values.main,
		]);
		await waitFor('main database readiness', () =>
			ready(containers()[values.main], 5678, '/healthz/readiness'),
		);
		await run('start-worker-runners', 'docker', [
			...compose,
			'up',
			'-d',
			'--no-deps',
			'--force-recreate',
			'--pull',
			'never',
			values.worker,
			...runnerServices,
		]);
	}

	if (values.stage !== 'preflight') {
		await waitFor('main database readiness', () =>
			ready(containers()[values.main], 5678, '/healthz/readiness'),
		);
		await waitFor('worker database and Redis readiness', () =>
			ready(containers()[values.worker], 5678, '/healthz/readiness'),
		);
		const current = containers();
		for (const [index, service] of apps.entries()) {
			assert.equal(current[service].Image, accepted.artifacts[index < 2 ? 0 : 1].id);
			assert.equal(current[service].State.Running, true);
			assert.equal(current[service].RestartCount, 0);
			const expectedEnv = cfg.services[service].environment;
			const actualEnv = envMap(current[service]);
			for (const [key, value] of Object.entries(expectedEnv))
				assert.equal(
					actualEnv[key],
					String(value),
					`configured ${key} must be preserved for ${service}`,
				);
			if (index < 2)
				assert.equal(
					capture('docker', ['exec', current[service].Id, 'n8n', '--version']),
					values.version,
				);
			else
				await waitFor(`${service} launcher health`, () =>
					ready(current[service], 5680, '/healthz'),
				);
		}
		for (const service of [values.postgres, values.redis]) {
			assert.equal(current[service].Id, previous[service].Id, `${service} must not be recreated`);
			assert.equal(current[service].State.Health.Status, 'healthy');
		}
		const mainEnv = envMap(current[values.main]);
		summary.mainBrokerRequired = !(
			mainEnv.EXECUTIONS_MODE === 'queue' && mainEnv.OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS === 'true'
		);
		const brokerServices = summary.mainBrokerRequired
			? [values.main, values.worker]
			: [values.worker];
		if (!summary.mainBrokerRequired)
			console.log('PASS main execution offloading; worker broker handles tasks');
		for (const service of brokerServices) {
			await waitFor(`${service} JS and Python launcher registration`, () => {
				const r = spawnSync(
					'docker',
					['logs', '--since', current[service].State.StartedAt, current[service].Id],
					{ encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
				);
				const log = `${r.stdout}${r.stderr}`;
				return (
					/Registered runner.*(launcher-javascript|JS Task Runner)/.test(log) &&
					/Registered runner.*(launcher-python|Python Task Runner)/.test(log)
				);
			});
		}
		summary.afterDatabase = dbCounts(current[values.postgres]);
		assert.equal(summary.afterDatabase.workflows, summary.beforeDatabase.workflows);
		assert.equal(summary.afterDatabase.credentials, summary.beforeDatabase.credentials);
		assert.equal(summary.afterDatabase.activeWorkflows, summary.beforeDatabase.activeWorkflows);
		assert.ok(summary.afterDatabase.migrations >= summary.beforeDatabase.migrations);
		if (values['public-url'])
			await run('public-route', 'curl', [
				'--noproxy',
				'*',
				'--max-time',
				'20',
				'--fail',
				'--silent',
				'--show-error',
				'--location',
				'--output',
				'/dev/null',
				'--write-out',
				'%{http_code}',
				values['public-url'],
			]);
		summary.after = Object.fromEntries(
			services.map((s) => [
				s,
				{
					container: current[s].Name,
					id: current[s].Id,
					imageId: current[s].Image,
					restartCount: current[s].RestartCount,
				},
			]),
		);
		summary.maintenance = false;
	}
	summary.ok = true;
	console.log(`SUCCESS ${values.stage === 'all' ? 'custom service deployment' : values.stage}`);
} catch (error) {
	summary.error = error.message;
	console.error(`FAILURE ${error.message}`);
	if (summary.maintenance && !schemaStarted && previous) {
		try {
			await run('resume-original-services', 'docker', [
				'start',
				...apps.map((s) => previous[s].Id),
			]);
			summary.originalServicesResumed = true;
		} catch {
			summary.originalServicesResumed = false;
		}
	}
	process.exitCode = 1;
} finally {
	save();
}
