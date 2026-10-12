#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
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
	!['all', ...stages].includes(values.stage)
) {
	console.log(
		'Usage: node scripts/build-custom-images.mjs --image REPOSITORY --runners-image REPOSITORY [--tag TAG] [--version VERSION] [--stage all|install|build|prepare|images|verify] [--builder NAME] [--platform PLATFORM] [--store DIR] [--log-dir DIR] [--concurrency NUMBER] [--memory MB]',
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
	summary.artifacts = images.map((image) => {
		const [info] = JSON.parse(capture('docker', ['image', 'inspect', image]));
		assert.equal(info.Architecture, values.platform.split('/')[1]);
		assert.equal(info.Config.Labels['org.opencontainers.image.version'], values.version);
		return { image, id: info.Id, architecture: info.Architecture, size: info.Size };
	});
}

try {
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
			await run(stage, 'docker', [
				'buildx',
				'bake',
				'-f',
				'docker/docker-bake.hcl',
				'n8n',
				'runners',
				...flags,
			]);
		}
		if (stage === 'verify') await verify();
	}
	summary.ok = true;
	console.log('SUCCESS custom image build');
} catch (error) {
	summary.error = error.message;
	console.error(`FAILURE ${error.message}`);
	process.exitCode = 1;
} finally {
	save();
}
