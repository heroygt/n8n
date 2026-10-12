#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const { values } = parseArgs({
	options: {
		image: { type: 'string' },
		'runners-image': { type: 'string' },
		tag: { type: 'string', default: pkg.version },
		version: { type: 'string', default: pkg.version },
		stage: { type: 'string', default: 'all' },
		'source-ref': { type: 'string', default: 'origin/my-server' },
		push: { type: 'boolean', default: false },
		builder: { type: 'string' },
		platform: { type: 'string', default: 'linux/amd64' },
		store: { type: 'string' },
		'log-dir': { type: 'string', default: 'work/custom-images' },
		concurrency: { type: 'string', default: '2' },
		memory: { type: 'string', default: '4096' },
		help: { type: 'boolean', short: 'h' },
	},
});
const stages = ['install', 'build', 'prepare', 'images', 'verify'];
if (
	values.help ||
	!values.image ||
	!values['runners-image'] ||
	!['all', 'source', ...stages].includes(values.stage) ||
	(values.push && !['all', 'verify'].includes(values.stage))
) {
	console.log(
		'Usage: node scripts/build-custom-images.mjs --image REPOSITORY --runners-image REPOSITORY [--tag TAG] [--version VERSION] [--stage all|source|install|build|prepare|images|verify] [--source-ref REF] [--push (all or verify stages)] [--builder NAME] [--platform PLATFORM] [--store DIR] [--log-dir DIR] [--concurrency NUMBER] [--memory MB]',
	);
	process.exit(values.help ? 0 : 2);
}
assert.equal(pkg.version, values.version, 'source version must match the requested version');
const logDir = resolve(root, values['log-dir']);
mkdirSync(logDir, { recursive: true });
const images = [`${values.image}:${values.tag}`, `${values['runners-image']}:${values.tag}`];
const env = {
	...process.env,
	NODE_OPTIONS: `--max-old-space-size=${values.memory} --no-node-snapshot`,
	N8N_VERSION: values.version,
	N8N_RELEASE_TYPE: 'stable',
	IMAGE_BASE_NAME: values.image,
	RUNNERS_IMAGE_BASE_NAME: values['runners-image'],
	IMAGE_TAG: values.tag,
	PLATFORMS: values.platform,
	...(values.store && { PNPM_CONFIG_STORE_DIR: resolve(root, values.store) }),
	...(values.builder && { BUILDX_BUILDER: values.builder }),
};
const summary = {
	ok: false,
	version: values.version,
	images,
	platform: values.platform,
	sourceCommit: capture('git', ['rev-parse', 'HEAD']),
	sourceRef: values['source-ref'],
	steps: [],
};
const save = () =>
	writeFileSync(resolve(logDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

function capture(command, args) {
	const result = spawnSync(command, args, {
		cwd: root,
		env,
		encoding: 'utf8',
		maxBuffer: 8 * 1024 * 1024,
	});
	if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.trim()}`);
	return result.stdout.trim();
}

async function run(name, command, args) {
	const log = resolve(logDir, `${name}.log`);
	const fd = openSync(log, 'w');
	const step = { name, status: 'running', log, startedAt: new Date().toISOString() };
	summary.steps.push(step);
	save();
	console.log(`RUN ${name}`);
	const code = await new Promise((done) => {
		const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', fd, fd] });
		child.once('error', () => done(1));
		child.once('close', (result) => done(result ?? 1));
	});
	closeSync(fd);
	step.status = code === 0 ? 'passed' : 'failed';
	step.exitCode = code;
	step.finishedAt = new Date().toISOString();
	save();
	if (code !== 0) throw new Error(`${name} failed; see ${log}`);
	console.log(`PASS ${name}`);
}

async function verify() {
	const dockerRun = ['run', '--rm', '--pull=never', '--network=none'];
	assert.equal(
		capture('docker', [...dockerRun, '--entrypoint', 'n8n', images[0], '--version']),
		values.version,
	);
	const native = `const assert = require('node:assert/strict'); const sqlite = require('sqlite3'); const ivm = require('isolated-vm'); (async () => { const db = new sqlite.Database(':memory:'); await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())); const isolate = new ivm.Isolate({memoryLimit: 16}); const context = await isolate.createContext(); assert.equal(await context.eval('21 * 2'), 42); isolate.dispose(); console.log('PASS sqlite3 and isolated-vm'); })().catch(error => {console.error(error); process.exitCode = 1;});`;
	await run('verify-native', 'docker', [
		...dockerRun,
		'--workdir',
		'/usr/local/lib/node_modules/n8n',
		'--env',
		'NODE_OPTIONS=--no-node-snapshot',
		'--entrypoint',
		'node',
		images[0],
		'-e',
		native,
	]);
	await run('verify-kafka', 'docker', [
		...dockerRun,
		'--entrypoint',
		'node',
		'--volume',
		`${resolve(root, '.github/scripts/docker/kafka-native-smoke-check.mjs')}:/tmp/kafka-check.mjs:ro`,
		images[0],
		'/tmp/kafka-check.mjs',
	]);
	await run('verify-runner-node', 'docker', [
		...dockerRun,
		'--entrypoint',
		'/usr/local/bin/node',
		images[1],
		'--version',
	]);
	await run('verify-runner-python', 'docker', [
		...dockerRun,
		'--entrypoint',
		'/opt/runners/task-runner-python/.venv/bin/python',
		images[1],
		'--version',
	]);
	assert.equal(
		capture('docker', [...dockerRun, '--entrypoint', 'pnpm', images[1], '--version']),
		pkg.packageManager.replace('pnpm@', ''),
	);
	const config = readFileSync(resolve(root, 'docker/images/runners/n8n-task-runners.json'), 'utf8');
	assert.equal(
		capture('docker', [
			...dockerRun,
			'--entrypoint',
			'/usr/local/bin/node',
			images[1],
			'-e',
			"process.stdout.write(require('node:fs').readFileSync('/etc/n8n-task-runners.json', 'utf8'))",
		]),
		config.trim(),
		'runner configuration must match the custom source file',
	);

	const container = `n8n-upgrade-smoke-${process.pid}`;
	const readiness = `const {setTimeout: delay} = require('node:timers/promises'); (async () => { for (let attempt = 0; attempt < 60; attempt++) { try { const response = await fetch('http://127.0.0.1:5678/healthz/readiness', {signal: AbortSignal.timeout(1000)}); if (response.ok) { console.log('PASS application startup and database readiness'); return; } } catch {} await delay(1000); } throw new Error('application did not become ready within 60 attempts'); })().catch(error => {console.error(error); process.exitCode = 1;});`;
	capture('docker', [
		'run',
		'--detach',
		'--pull=never',
		'--network=none',
		'--name',
		container,
		'--env',
		'N8N_DIAGNOSTICS_ENABLED=false',
		'--env',
		'N8N_VERSION_NOTIFICATIONS_ENABLED=false',
		'--env',
		'N8N_TEMPLATES_ENABLED=false',
		images[0],
	]);
	try {
		await run('verify-startup', 'docker', ['exec', container, 'node', '-e', readiness]);
	} finally {
		try {
			await run('verify-startup-log', 'docker', ['logs', container]);
		} finally {
			capture('docker', ['rm', '--force', container]);
		}
	}
	summary.artifacts = images.map((image) => {
		const [info] = JSON.parse(capture('docker', ['image', 'inspect', image]));
		assert.equal(info.Architecture, values.platform.split('/')[1]);
		assert.equal(info.Config.Labels['org.opencontainers.image.version'], values.version);
		return { image, id: info.Id, architecture: info.Architecture, size: info.Size };
	});
}

try {
	assert.equal(
		summary.sourceCommit,
		capture('git', ['rev-parse', `${values['source-ref']}^{commit}`]),
		'fetch and fast-forward the GitHub source branch before building',
	);
	assert.equal(
		capture('git', ['status', '--porcelain', '--untracked-files=no']),
		'',
		'commit and push tracked changes before building',
	);
	summary.sourceVerified = true;
	console.log(`PASS source matches ${values['source-ref']} with a clean tracked checkout`);
	for (const stage of values.stage === 'all' ? stages : [values.stage]) {
		if (stage === 'install')
			await run(stage, 'pnpm', [
				'agent:setup',
				'install',
				'--mem',
				values.memory,
				'--log-dir',
				resolve(logDir, 'setup-install'),
			]);
		if (stage === 'build')
			await run(stage, 'pnpm', [
				'agent:setup',
				'build',
				'--mem',
				values.memory,
				'--concurrency',
				values.concurrency,
				'--log-dir',
				resolve(logDir, 'setup-build'),
			]);
		if (stage === 'prepare') await run(stage, 'pnpm', ['build:deploy']);
		if (stage === 'images') {
			assert.equal(
				JSON.parse(readFileSync(resolve(root, 'compiled/package.json'), 'utf8')).version,
				values.version,
			);
			const driver = capture('docker', ['buildx', 'inspect']).match(/Driver:\s+(\S+)/)?.[1];
			const flags = driver === 'docker' ? [] : ['--load', '--provenance=false'];
			const proxyKeys = [
				'HTTP_PROXY',
				'HTTPS_PROXY',
				'http_proxy',
				'https_proxy',
				'NO_PROXY',
				'no_proxy',
				'ALL_PROXY',
				'all_proxy',
			];
			const proxyArgs = Object.fromEntries(
				proxyKeys.filter((key) => env[key]).map((key) => [key, env[key]]),
			);
			const proxyFile = resolve(logDir, 'bake-proxy.json');
			const files = ['-f', 'docker/docker-bake.hcl'];
			if (Object.keys(proxyArgs).length > 0) {
				writeFileSync(
					proxyFile,
					JSON.stringify({ target: { n8n: { args: proxyArgs }, runners: { args: proxyArgs } } }),
					{ mode: 0o600 },
				);
				files.push('-f', proxyFile);
			}
			try {
				await run(stage, 'docker', ['buildx', 'bake', ...files, 'n8n', 'runners', ...flags]);
			} finally {
				if (files.length > 2) unlinkSync(proxyFile);
			}
		}
		if (stage === 'verify') await verify();
	}
	if (values.push) {
		for (const [index, image] of images.entries()) {
			await run(`publish-${index === 0 ? 'n8n' : 'runners'}`, 'docker', ['push', image]);
			const [info] = JSON.parse(capture('docker', ['image', 'inspect', image]));
			assert.equal(info.Id, summary.artifacts[index].id);
			assert.ok(info.RepoDigests.length > 0, 'published image must have a registry digest');
			summary.artifacts[index].digests = info.RepoDigests;
		}
	}
	summary.ok = true;
	console.log(`SUCCESS ${values.stage === 'all' ? 'custom image build' : `${values.stage} stage`}`);
} catch (error) {
	summary.error = error.message;
	console.error(`FAILURE ${error.message}`);
	process.exitCode = 1;
} finally {
	save();
}
