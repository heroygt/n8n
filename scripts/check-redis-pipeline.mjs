#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
	options: {
		host: { type: 'string', default: '127.0.0.1' },
		port: { type: 'string' },
		database: { type: 'string', default: '0' },
		'node-file': { type: 'string', default: 'packages/nodes-base/dist/nodes/Redis/Redis.node.js' },
		report: { type: 'string' },
		help: { type: 'boolean', short: 'h' },
	},
});

if (values.help || !values.port) {
	console.log(
		'Usage: node scripts/check-redis-pipeline.mjs --port PORT [--host HOST] [--database NUMBER] [--node-file FILE] [--report FILE]',
	);
	process.exit(values.help ? 0 : 2);
}

const root = resolve(import.meta.dirname, '..');
const nodeFile = resolve(root, values['node-file']);
const require = createRequire(nodeFile);
const { createClient } = require('redis');
const { Redis } = await import(pathToFileURL(nodeFile).href);
const node = new Redis();
const credentials = {
	host: values.host,
	port: Number(values.port),
	database: Number(values.database),
};
const client = createClient({
	socket: { host: credentials.host, port: credentials.port, reconnectStrategy: false },
	database: credentials.database,
});
client.on('error', () => {});
const prefix = `n8n-upgrade-check:${randomUUID()}`;
const checks = [];

async function execute(operation, parameters) {
	const items = parameters.map(() => ({ json: {} }));
	const context = {
		getCredentials: async () => credentials,
		getInputData: () => items,
		getNodeParameter: (name, index, fallback) =>
			name === 'operation' ? operation : (parameters[index][name] ?? fallback),
		continueOnFail: () => false,
		getNode: () => ({
			name: 'Redis acceptance',
			type: 'n8n-nodes-base.redis',
			typeVersion: 1,
			parameters: {},
		}),
	};
	const [output] = await node.execute.call(context);
	return output;
}

async function check(name, run) {
	try {
		await run();
		checks.push({ name, ok: true });
		console.log(`PASS ${name}`);
	} catch (error) {
		checks.push({ name, ok: false, detail: error.message });
		console.error(`FAIL ${name}: ${error.message}`);
	}
}

try {
	await client.connect();
	await check('batch set and automatic get preserve item order', async () => {
		await execute('set', [
			{ key: `${prefix}:a`, value: 'alpha', keyType: 'string' },
			{ key: `${prefix}:b`, value: 'beta', keyType: 'string' },
		]);
		const output = await execute(
			'get',
			['a', 'missing', 'b'].map((key) => ({
				key: `${prefix}:${key}`,
				keyType: 'automatic',
				propertyName: 'value',
			})),
		);
		assert.deepEqual(
			output.map((item) => item.json.value),
			['alpha', null, 'beta'],
		);
		assert.deepEqual(
			output.map((item) => item.pairedItem),
			[{ item: 0 }, { item: 1 }, { item: 2 }],
		);
	});
	await check('mset and mget preserve values and missing keys', async () => {
		await execute('mset', [
			{
				keyValues: { [`${prefix}:multi-a`]: 'one', [`${prefix}:multi-b`]: 'two' },
				expire: true,
				ttl: 60,
			},
		]);
		const output = await execute('mget', [
			{
				keys: [`${prefix}:multi-a`, `${prefix}:missing`, `${prefix}:multi-b`],
				propertyName: 'values',
			},
		]);
		assert.deepEqual(output[0].json.values, ['one', null, 'two']);
		assert.ok((await client.ttl(`${prefix}:multi-a`)) > 0);
	});
	await check('automatic get supports hash, list, and set values', async () => {
		await client.hSet(`${prefix}:hash`, { field: 'value' });
		await client.rPush(`${prefix}:list`, ['first', 'second']);
		await client.sAdd(`${prefix}:set`, ['member']);
		const output = await execute(
			'get',
			['hash', 'list', 'set'].map((key) => ({
				key: `${prefix}:${key}`,
				keyType: 'automatic',
				propertyName: 'value',
			})),
		);
		assert.deepEqual({ ...output[0].json.value }, { field: 'value' });
		assert.deepEqual(output[1].json.value, ['first', 'second']);
		assert.deepEqual(output[2].json.value, ['member']);
	});
	await check('list lengths retain batch order and missing-list zeros', async () => {
		await client.rPush(`${prefix}:length-a`, ['one', 'two']);
		await client.rPush(`${prefix}:length-b`, ['one', 'two', 'three']);
		const keys = ['length-a', 'missing-list', 'length-b'].map((key) => `${prefix}:${key}`);
		const output = await execute(
			'llen',
			keys.map((list) => ({ list })),
		);
		assert.deepEqual(
			output.map((item) => item.json),
			[{ [keys[0]]: 2 }, { [keys[1]]: 0 }, { [keys[2]]: 3 }],
		);
	});
	await check('keys retrieves values through the pipeline', async () => {
		const [output] = await execute('keys', [{ keyPattern: `${prefix}:multi-*`, getValues: true }]);
		assert.deepEqual(output.json.keys.sort(), [`${prefix}:multi-a`, `${prefix}:multi-b`]);
		assert.deepEqual(output.json.values, {
			[`${prefix}:multi-a`]: 'one',
			[`${prefix}:multi-b`]: 'two',
		});
	});
	await check('incr and delete execute batch commands', async () => {
		const output = await execute('incr', [{ key: `${prefix}:counter`, expire: true, ttl: 60 }]);
		assert.equal(output[0].json[`${prefix}:counter`], 1);
		assert.ok((await client.ttl(`${prefix}:counter`)) > 0);
		await execute('delete', [{ key: [`${prefix}:a`, `${prefix}:b`] }]);
		assert.equal(await client.exists([`${prefix}:a`, `${prefix}:b`]), 0);
	});
} catch (error) {
	checks.push({ name: 'Redis connection', ok: false, detail: error.message });
	console.error(`FAIL Redis connection: ${error.message}`);
} finally {
	if (client.isOpen) {
		for await (const key of client.scanIterator({ MATCH: `${prefix}:*` })) await client.del(key);
		await client.quit();
	}
}

const ok = checks.length > 0 && checks.every((entry) => entry.ok);
if (values.report) {
	const path = resolve(root, values.report);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ ok, checks }, null, 2)}\n`);
}
console.log(`${ok ? 'SUCCESS' : 'FAILURE'} Redis pipeline acceptance`);
process.exitCode = ok ? 0 : 1;
