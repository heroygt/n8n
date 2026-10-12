#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
	options: {
		version: { type: 'string' },
		target: { type: 'string' },
		base: { type: 'string' },
		source: { type: 'string' },
		allow: { type: 'string', multiple: true, default: [] },
		ported: { type: 'string', multiple: true, default: [] },
		report: { type: 'string' },
		help: { type: 'boolean', short: 'h' },
	},
});

if (values.help || !values.version || !values.base || !values.source) {
	console.log(
		'Usage: node scripts/verify-n8n-upgrade.mjs --version VERSION --base REF --source REF [--target REF] [--allow FILE] [--ported FILE] [--report FILE]',
	);
	process.exit(values.help ? 0 : 2);
}

const root = resolve(import.meta.dirname, '..');
const target = values.target ?? `n8n@${values.version}`;
const checks = [];

function git(args) {
	const result = spawnSync('git', args, {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
	});
	if (result.status !== 0) throw new Error(result.stderr.trim());
	return result.stdout;
}

function check(name, ok, detail) {
	checks.push({ name, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
}

function paths(args) {
	return git(args).split('\0').filter(Boolean);
}

try {
	for (const file of ['package.json', 'packages/cli/package.json']) {
		const actual = JSON.parse(readFileSync(resolve(root, file), 'utf8')).version;
		check(file, actual === values.version, `expected ${values.version}, found ${actual}`);
	}

	git(['rev-parse', '--verify', `${target}^{commit}`]);
	const customFiles = paths(['diff', '--name-only', '-z', values.base, values.source, '--']);
	const allowed = new Set([...customFiles, ...values.allow]);
	const differences = paths(['diff', '--name-only', '-z', target, '--']);
	const unexpected = differences.filter((file) => !allowed.has(file));
	check(
		'official release files',
		unexpected.length === 0,
		unexpected.length
			? `${unexpected.length} unexpected differences: ${unexpected.slice(0, 10).join(', ')}`
			: `matches ${target} outside declared local files`,
	);

	const portedFiles = new Set(values.ported);
	check(
		'declared ports',
		values.ported.every((file) => customFiles.includes(file)),
		'ports must be original local files',
	);
	for (const file of customFiles) {
		const source = git(['show', `${values.source}:${file}`]);
		const current = readFileSync(resolve(root, file), 'utf8');
		const upstreamChanged =
			git(['diff', '--name-only', values.base, target, '--', file]).trim() !== '';
		if (!upstreamChanged || source === current) {
			check(`preserved ${file}`, source === current, 'matches original customization');
		} else {
			const patch = git(['diff', '--binary', values.base, values.source, '--', file]);
			const reverse = spawnSync('git', ['apply', '--reverse', '--check'], {
				cwd: root,
				encoding: 'utf8',
				input: patch,
			});
			const ported = portedFiles.has(file) && differences.includes(file);
			check(
				`retained ${file}`,
				reverse.status === 0 || ported,
				reverse.status === 0
					? 'original patch is present'
					: ported
						? 'declared port; verify behavior with its acceptance check'
						: reverse.stderr.trim(),
			);
		}
	}

	const unmerged = paths(['diff', '--name-only', '--diff-filter=U', '-z', '--']);
	check('merge conflicts', unmerged.length === 0, unmerged.length ? unmerged.join(', ') : 'none');
	const manifests = paths(['ls-tree', '-r', '--name-only', '-z', target]).filter((file) =>
		file.endsWith('package.json'),
	);
	const mismatches = manifests.filter((file) => {
		const expected = JSON.parse(git(['show', `${target}:${file}`])).version;
		return JSON.parse(readFileSync(resolve(root, file), 'utf8')).version !== expected;
	});
	check(
		'package versions',
		mismatches.length === 0,
		mismatches.length ? mismatches.join(', ') : `${manifests.length} manifests match release`,
	);
} catch (error) {
	check('verification completed', false, error.message);
}

const ok = checks.every((entry) => entry.ok);
const report = {
	ok,
	version: values.version,
	target,
	base: values.base,
	source: values.source,
	ported: values.ported,
	checks,
};
if (values.report) {
	const path = resolve(root, values.report);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`${ok ? 'SUCCESS' : 'FAILURE'} n8n upgrade verification`);
process.exitCode = ok ? 0 : 1;
