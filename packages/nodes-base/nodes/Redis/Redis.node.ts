import set from 'lodash/set';
import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import type { RedisCredential } from './types';
import { setupRedisClient, redisConnectionTest, convertInfoToObject } from './utils';

export class Redis implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Redis',
		name: 'redis',
		icon: 'file:redis.svg',
		group: ['input'],
		version: 1,
		description: 'Get, send and update data in Redis',
		defaults: {
			name: 'Redis',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'redis',
				required: true,
				testedBy: 'redisConnectionTest',
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a key from Redis',
						action: 'Delete a key from Redis',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get the value of a key from Redis',
						action: 'Get the value of a key from Redis',
					},
					{
						name: 'Increment',
						value: 'incr',
						description: 'Atomically increments a key by 1. Creates the key if it does not exist.',
						action: 'Atomically increment a key by 1. Creates the key if it does not exist.',
					},
					{
						name: 'Info',
						value: 'info',
						description: 'Returns generic information about the Redis instance',
						action: 'Return generic information about the Redis instance',
					},
					{
						name: 'Keys',
						value: 'keys',
						description: 'Returns all the keys matching a pattern',
						action: 'Return all keys matching a pattern',
					},
					{
						name: 'Mget',
						value: 'mget',
						description: 'Get multiple values from Redis',
						action: 'Get multiple values from Redis',
					},
					{
						name: 'Mset',
						value: 'mset',
						description: 'Set multiple key-value pairs in Redis',
						action: 'Set multiple key-value pairs in Redis',
					},
					{
						name: 'Pop',
						value: 'pop',
						description: 'Pop data from a redis list',
						action: 'Pop data from a redis list',
					},
					{
						name: 'Publish',
						value: 'publish',
						description: 'Publish message to redis channel',
						action: 'Publish message to redis channel',
					},
					{
						name: 'Push',
						value: 'push',
						description: 'Push data to a redis list',
						action: 'Push data to a redis list',
					},
					{
						name: 'Set',
						value: 'set',
						description: 'Set the value of a key in redis',
						action: 'Set the value of a key in redis',
					},
				],
				default: 'info',
			},

			// ----------------------------------
			//         delete
			// ----------------------------------
			{
				displayName: 'Key',
				name: 'key',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['delete'],
					},
				},
				default: '',
				required: true,
				description: 'Name of the key(s) to delete from Redis',
			},

			// ----------------------------------
			//         get
			// ----------------------------------
			{
				displayName: 'Name',
				name: 'propertyName',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['get'],
					},
				},
				default: 'propertyName',
				required: true,
				description:
					'Name of the property to write received data to. Supports dot-notation. Example: "data.person[0].name".',
			},
			{
				displayName: 'Key',
				name: 'key',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['get'],
					},
				},
				default: '',
				required: true,
				description: 'Name of the key to get from Redis',
			},
			{
				displayName: 'Key Type',
				name: 'keyType',
				type: 'options',
				displayOptions: {
					show: {
						operation: ['get'],
					},
				},
				options: [
					{
						name: 'Automatic',
						value: 'automatic',
						description: 'Requests the type before requesting the data (slower)',
					},
					{
						name: 'Hash',
						value: 'hash',
						description: "Data in key is of type 'hash'",
					},
					{
						name: 'List',
						value: 'list',
						description: "Data in key is of type 'lists'",
					},
					{
						name: 'Sets',
						value: 'sets',
						description: "Data in key is of type 'sets'",
					},
					{
						name: 'String',
						value: 'string',
						description: "Data in key is of type 'string'",
					},
				],
				default: 'automatic',
				description: 'The type of the key to get',
			},

			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				displayOptions: {
					show: {
						operation: ['get'],
					},
				},
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Dot Notation',
						name: 'dotNotation',
						type: 'boolean',
						default: true,
						// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether
						description:
							'<p>By default, dot-notation is used in property names. This means that "a.b" will set the property "b" underneath "a" so { "a": { "b": value} }.<p></p>If that is not intended this can be deactivated, it will then set { "a.b": value } instead.</p>.',
					},
				],
			},

			// ----------------------------------
			//         mget
			// ----------------------------------
			{
				displayName: 'Name',
				name: 'propertyName',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['mget'],
					},
				},
				default: 'propertyName',
				required: true,
				description:
					'Name of the property to write the array of values to. Supports dot-notation. Example: "data.person[0].name".',
			},
			{
				displayName: 'Keys',
				name: 'keys',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['mget'],
					},
				},
				default: '',
				required: true,
				description:
					'Array of keys to get. Enter as a JSON array of strings, e.g. ["key1", "key2"].',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				displayOptions: {
					show: {
						operation: ['mget'],
					},
				},
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Dot Notation',
						name: 'dotNotation',
						type: 'boolean',
						default: true,
						// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether
						description:
							'<p>By default, dot-notation is used in property names. This means that "a.b" will set the property "b" underneath "a" so { "a": { "b": value} }.<p></p>If that is not intended this can be deactivated, it will then set { "a.b": value } instead.</p>.',
					},
				],
			},

			// ----------------------------------
			//         mset
			// ----------------------------------
			{
				displayName: 'Key-Value Pairs',
				name: 'keyValues',
				type: 'string',
				typeOptions: {
					editor: 'codeNodeEditor',
					editorLanguage: 'json',
				},
				displayOptions: {
					show: {
						operation: ['mset'],
					},
				},
				default: '{\n"key1": "value1",\n"key2": "value2"\n}',
				required: true,
				description:
					'Key-value pairs to set in Redis as a JSON object, e.g. {"key1": "value1", "key2": "value2"}',
			},
			{
				displayName: 'Expire',
				name: 'expire',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['mset'],
					},
				},
				default: false,
				description: 'Whether to set a timeout on all keys',
			},
			{
				displayName: 'TTL',
				name: 'ttl',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						operation: ['mset'],
						expire: [true],
					},
				},
				default: 60,
				description: 'Number of seconds before key expiration (applies to all keys)',
			},

			// ----------------------------------
			//         incr
			// ----------------------------------
			{
				displayName: 'Key',
				name: 'key',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['incr'],
					},
				},
				default: '',
				required: true,
				description: 'Name of the key to increment',
			},
			{
				displayName: 'Expire',
				name: 'expire',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['incr'],
					},
				},
				default: false,
				description: 'Whether to set a timeout on key',
			},
			{
				displayName: 'TTL',
				name: 'ttl',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						operation: ['incr'],
						expire: [true],
					},
				},
				default: 60,
				description: 'Number of seconds before key expiration',
			},

			// ----------------------------------
			//         keys
			// ----------------------------------
			{
				displayName: 'Key Pattern',
				name: 'keyPattern',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['keys'],
					},
				},
				default: '',
				required: true,
				description: 'The key pattern for the keys to return',
			},
			{
				displayName: 'Get Values',
				name: 'getValues',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['keys'],
					},
				},
				default: true,
				description: 'Whether to get the value of matching keys',
			},
			// ----------------------------------
			//         set
			// ----------------------------------
			{
				displayName: 'Key',
				name: 'key',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['set'],
					},
				},
				default: '',
				required: true,
				description: 'Name of the key to set in Redis',
			},
			{
				displayName: 'Value',
				name: 'value',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['set'],
					},
				},
				default: '',
				description: 'The value to write in Redis',
			},
			{
				displayName: 'Key Type',
				name: 'keyType',
				type: 'options',
				displayOptions: {
					show: {
						operation: ['set'],
					},
				},
				options: [
					{
						name: 'Automatic',
						value: 'automatic',
						description: 'Tries to figure out the type automatically depending on the data',
					},
					{
						name: 'Hash',
						value: 'hash',
						description: "Data in key is of type 'hash'",
					},
					{
						name: 'List',
						value: 'list',
						description: "Data in key is of type 'lists'",
					},
					{
						name: 'Sets',
						value: 'sets',
						description: "Data in key is of type 'sets'",
					},
					{
						name: 'String',
						value: 'string',
						description: "Data in key is of type 'string'",
					},
				],
				default: 'automatic',
				description: 'The type of the key to set',
			},
			{
				displayName: 'Value Is JSON',
				name: 'valueIsJSON',
				type: 'boolean',
				displayOptions: {
					show: {
						keyType: ['hash'],
					},
				},
				default: true,
				description: 'Whether the value is JSON or key value pairs',
			},
			{
				displayName: 'Expire',
				name: 'expire',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['set'],
					},
				},
				default: false,
				description: 'Whether to set a timeout on key',
			},

			{
				displayName: 'TTL',
				name: 'ttl',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						operation: ['set'],
						expire: [true],
					},
				},
				default: 60,
				description: 'Number of seconds before key expiration',
			},
			// ----------------------------------
			//         publish
			// ----------------------------------
			{
				displayName: 'Channel',
				name: 'channel',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['publish'],
					},
				},
				default: '',
				required: true,
				description: 'Channel name',
			},
			{
				displayName: 'Data',
				name: 'messageData',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['publish'],
					},
				},
				default: '',
				required: true,
				description: 'Data to publish',
			},
			// ----------------------------------
			//         push/pop
			// ----------------------------------
			{
				displayName: 'List',
				name: 'list',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['push', 'pop'],
					},
				},
				default: '',
				required: true,
				description: 'Name of the list in Redis',
			},
			{
				displayName: 'Data',
				name: 'messageData',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['push'],
					},
				},
				default: '',
				required: true,
				description: 'Data to push',
			},
			{
				displayName: 'Tail',
				name: 'tail',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['push', 'pop'],
					},
				},
				default: false,
				description: 'Whether to push or pop data from the end of the list',
			},
			{
				displayName: 'Name',
				name: 'propertyName',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['pop'],
					},
				},
				default: 'propertyName',
				description:
					'Optional name of the property to write received data to. Supports dot-notation. Example: "data.person[0].name".',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				displayOptions: {
					show: {
						operation: ['pop'],
					},
				},
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Dot Notation',
						name: 'dotNotation',
						type: 'boolean',
						default: true,
						// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether
						description:
							'<p>By default, dot-notation is used in property names. This means that "a.b" will set the property "b" underneath "a" so { "a": { "b": value} }.<p></p>If that is not intended this can be deactivated, it will then set { "a.b": value } instead.</p>.',
					},
				],
			},
		],
	};

	methods = {
		credentialTest: { redisConnectionTest },
	};

	async execute(this: IExecuteFunctions) {
		// TODO: For array and object fields it should not have a "value" field it should
		//       have a parameter field for a path. Because it is not possible to set
		//       array, object via parameter directly (should maybe be possible?!?!)
		//       Should maybe have a parameter which is JSON.
		const credentials = await this.getCredentials<RedisCredential>('redis');

		const client = setupRedisClient(credentials);
		await client.connect();
		await client.ping();

		const operation = this.getNodeParameter('operation', 0);
		const returnItems: INodeExecutionData[] = [];

		if (operation === 'info') {
			try {
				const result = await client.info();
				returnItems.push({ json: convertInfoToObject(result) });
			} catch (error) {
				if (this.continueOnFail()) {
					returnItems.push({
						json: {
							error: error.message,
						},
					});
				} else {
					await client.quit();
					throw new NodeOperationError(this.getNode(), error);
				}
			}
		} else if (
			['delete', 'get', 'keys', 'set', 'incr', 'publish', 'push', 'pop', 'mget', 'mset'].includes(
				operation,
			)
		) {
			const items = this.getInputData();

			// 第一步：收集所有需要查询类型的key
			const keysNeedingTypeQuery: Array<{
				itemIndex: number;
				key: string;
				source: 'get' | 'keys';
			}> = [];

			// 存储keys操作匹配到的key列表
			const keysOperationResults: Map<number, string[]> = new Map();

			// 先遍历一遍，收集需要查询类型的key
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				if (operation === 'get') {
					const keyGet = this.getNodeParameter('key', itemIndex) as string;
					const keyType = this.getNodeParameter('keyType', itemIndex) as string;

					if (keyType === 'automatic') {
						keysNeedingTypeQuery.push({ itemIndex, key: keyGet, source: 'get' });
					}
				} else if (operation === 'keys') {
					const keyPattern = this.getNodeParameter('keyPattern', itemIndex) as string;
					const getValues = this.getNodeParameter('getValues', itemIndex, true) as boolean;

					// 无论是否需要获取值，都要先收集匹配的keys
					const keys: string[] = [];
					for await (const key of client.scanIterator({ MATCH: keyPattern, COUNT: 10000 })) {
						keys.push(key);
						// 只有当需要获取值时才需要查询类型
						if (getValues) {
							keysNeedingTypeQuery.push({ itemIndex, key, source: 'keys' });
						}
					}
					keysOperationResults.set(itemIndex, keys);
				}
			}

			// 第二步：如果有需要查询类型的key，先执行类型查询pipeline
			const keyTypes: Map<string, string> = new Map();
			if (keysNeedingTypeQuery.length > 0) {
				const typePipeline = client.multi();
				for (const keyOp of keysNeedingTypeQuery) {
					typePipeline.type(keyOp.key);
				}
				const typeResults = await typePipeline.exec();

				for (let i = 0; i < keysNeedingTypeQuery.length; i++) {
					const actualType = (typeResults[i] as string) || 'string';
					keyTypes.set(keysNeedingTypeQuery[i].key, actualType);
				}
			}

			// 第三步：构建主要的pipeline命令
			const pipeline = client.multi();
			const itemOperations: Array<{
				itemIndex: number;
				operation: string;
				item: INodeExecutionData;
				commandCount: number;
			}> = [];

			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				try {
					const itemOperation = {
						itemIndex,
						operation,
						item: { json: {}, pairedItem: { item: itemIndex } },
						commandCount: 0,
					};

					if (operation === 'delete') {
						const keysToDelete = [this.getNodeParameter('key', itemIndex)].flat() as string[];
						if (keysToDelete.length > 0) {
							pipeline.del(keysToDelete);
							itemOperation.commandCount = 1;
						}
					} else if (operation === 'get') {
						const keyGet = this.getNodeParameter('key', itemIndex) as string;
						const keyType = this.getNodeParameter('keyType', itemIndex) as string;

						// 确定实际类型
						let actualType = keyType;
						if (keyType === 'automatic') {
							actualType = keyTypes.get(keyGet) || 'string';
						}

						// 修复：如果key不存在（type为"none"），直接跳过pipeline命令，commandCount保持为0
						if (actualType === 'none') {
							itemOperation.commandCount = 0;
						} else {
							// 根据实际类型添加获取值的命令
							if (actualType === 'string') {
								pipeline.get(keyGet);
							} else if (actualType === 'hash') {
								pipeline.hGetAll(keyGet);
							} else if (actualType === 'list') {
								pipeline.lRange(keyGet, 0, -1);
							} else if (actualType === 'set' || actualType === 'sets') {
								pipeline.sMembers(keyGet);
							}
							itemOperation.commandCount = 1;
						}
					} else if (operation === 'keys') {
						const getValues = this.getNodeParameter('getValues', itemIndex, true) as boolean;
						const keys = keysOperationResults.get(itemIndex) || [];

						if (!getValues) {
							// 不需要获取值，但仍需要将操作添加到itemOperations中进行结果处理
							itemOperation.commandCount = 0; // 没有pipeline命令
						} else {
							// 根据实际类型为每个key添加获取值命令
							for (const keyName of keys) {
								const actualType = keyTypes.get(keyName) || 'string';

								// 修复：如果key不存在（type为"none"），跳过pipeline命令
								if (actualType !== 'none') {
									if (actualType === 'string') {
										pipeline.get(keyName);
									} else if (actualType === 'hash') {
										pipeline.hGetAll(keyName);
									} else if (actualType === 'list') {
										pipeline.lRange(keyName, 0, -1);
									} else if (actualType === 'set' || actualType === 'sets') {
										pipeline.sMembers(keyName);
									}
									itemOperation.commandCount++;
								}
							}
						}
					} else if (operation === 'set') {
						const keySet = this.getNodeParameter('key', itemIndex) as string;
						const value = this.getNodeParameter('value', itemIndex) as string;
						const keyType = this.getNodeParameter('keyType', itemIndex) as string;
						const valueIsJSON = this.getNodeParameter('valueIsJSON', itemIndex, true) as boolean;
						const expire = this.getNodeParameter('expire', itemIndex, false) as boolean;
						const ttl = this.getNodeParameter('ttl', itemIndex, -1) as number;

						// 添加setValue命令到pipeline
						let actualType = keyType;
						if (actualType === 'automatic') {
							if (typeof value === 'string') {
								actualType = 'string';
							} else if (Array.isArray(value)) {
								actualType = 'list';
							} else if (typeof value === 'object') {
								actualType = 'hash';
							}
						}

						if (actualType === 'string') {
							pipeline.set(keySet, value.toString());
							itemOperation.commandCount++;
						} else if (actualType === 'hash') {
							if (valueIsJSON) {
								let values: unknown;
								try {
									values = typeof value === 'string' ? JSON.parse(value) : value;
								} catch {
									values = value;
								}
								for (const key of Object.keys(values as object)) {
									pipeline.hSet(keySet, key, (values as IDataObject)[key]!.toString());
									itemOperation.commandCount++;
								}
							} else {
								const values = value.toString().split(' ');
								pipeline.hSet(keySet, values);
								itemOperation.commandCount++;
							}
						} else if (actualType === 'list') {
							const valueArray = Array.isArray(value) ? value : [value];
							for (let index = 0; index < valueArray.length; index++) {
								pipeline.lSet(keySet, index, valueArray[index].toString());
								itemOperation.commandCount++;
							}
						} else if (actualType === 'sets') {
							if (Array.isArray(value)) {
								for (const item of value) {
									pipeline.sAdd(keySet, item.toString());
									itemOperation.commandCount++;
								}
							} else {
								pipeline.sAdd(keySet, value.toString());
								itemOperation.commandCount++;
							}
						}

						if (expire && ttl > 0) {
							pipeline.expire(keySet, ttl);
							itemOperation.commandCount++;
						}
					} else if (operation === 'incr') {
						const keyIncr = this.getNodeParameter('key', itemIndex) as string;
						const expire = this.getNodeParameter('expire', itemIndex, false) as boolean;
						const ttl = this.getNodeParameter('ttl', itemIndex, -1) as number;

						pipeline.incr(keyIncr);
						itemOperation.commandCount++;

						if (expire && ttl > 0) {
							pipeline.expire(keyIncr, ttl);
							itemOperation.commandCount++;
						}
					} else if (operation === 'publish') {
						const channel = this.getNodeParameter('channel', itemIndex) as string;
						const messageData = this.getNodeParameter('messageData', itemIndex) as string;

						pipeline.publish(channel, messageData);
						itemOperation.commandCount++;
					} else if (operation === 'push') {
						const redisList = this.getNodeParameter('list', itemIndex) as string;
						const messageData = this.getNodeParameter('messageData', itemIndex) as string;
						const tail = this.getNodeParameter('tail', itemIndex, false) as boolean;

						if (tail) {
							pipeline.rPush(redisList, messageData);
						} else {
							pipeline.lPush(redisList, messageData);
						}
						itemOperation.commandCount++;
					} else if (operation === 'pop') {
						const redisList = this.getNodeParameter('list', itemIndex) as string;
						const tail = this.getNodeParameter('tail', itemIndex, false) as boolean;

						if (tail) {
							pipeline.rPop(redisList);
						} else {
							pipeline.lPop(redisList);
						}
						itemOperation.commandCount++;
					} else if (operation === 'mget') {
						let keyList: string[];
						try {
							keyList = this.getNodeParameter('keys', itemIndex) as string[];
						} catch (error) {
							throw new NodeOperationError(
								this.getNode(),
								'The keys parameter is not valid JSON. Please provide a JSON array of strings.',
								{ itemIndex },
							);
						}

						if (keyList.length > 0) {
							pipeline.mGet(keyList);
							itemOperation.commandCount++;
						}
					} else if (operation === 'mset') {
						const expire = this.getNodeParameter('expire', itemIndex, false) as boolean;
						const ttl = this.getNodeParameter('ttl', itemIndex, -1) as number;

						let keyValuePairs: Record<string, string>;
						try {
							keyValuePairs = this.getNodeParameter('keyValues', itemIndex) as Record<
								string,
								string
							>;
						} catch (error) {
							throw new NodeOperationError(
								this.getNode(),
								'The key-value pairs parameter is not valid JSON. Please provide a JSON object.',
								{ itemIndex },
							);
						}

						if (
							typeof keyValuePairs !== 'object' ||
							keyValuePairs === null ||
							Array.isArray(keyValuePairs)
						) {
							throw new NodeOperationError(
								this.getNode(),
								'The key-value pairs must be a JSON object with string keys and string values.',
								{ itemIndex },
							);
						}

						pipeline.mSet(keyValuePairs);
						itemOperation.commandCount++;

						if (expire && ttl > 0) {
							const keys = Object.keys(keyValuePairs);
							for (const key of keys) {
								pipeline.expire(key, ttl);
								itemOperation.commandCount++;
							}
						}
					}

					itemOperations.push(itemOperation);
				} catch (error) {
					if (this.continueOnFail()) {
						returnItems.push({
							json: {
								error: error.message,
							},
							pairedItem: {
								item: itemIndex,
							},
						});
						continue;
					}
					await client.quit();
					throw new NodeOperationError(this.getNode(), error, { itemIndex });
				}
			}

			// 执行pipeline
			try {
				const results = await pipeline.exec();

				// 处理结果
				let resultIndex = 0;
				for (const itemOp of itemOperations) {
					try {
						const item = itemOp.item;

						if (itemOp.operation === 'delete') {
							const keysToDelete = [
								this.getNodeParameter('key', itemOp.itemIndex),
							].flat() as string[];
							returnItems.push({
								json: {
									deletedKeys: keysToDelete,
									count: keysToDelete.length,
								},
								pairedItem: { item: itemOp.itemIndex },
							});
							resultIndex += itemOp.commandCount;
						} else if (itemOp.operation === 'get') {
							const propertyName = this.getNodeParameter(
								'propertyName',
								itemOp.itemIndex,
							) as string;
							const options = this.getNodeParameter('options', itemOp.itemIndex, {});
							const keyGet = this.getNodeParameter('key', itemOp.itemIndex) as string;
							const keyType = this.getNodeParameter('keyType', itemOp.itemIndex) as string;

							let value = null;

							// 修复：检查key是否不存在
							if (keyType === 'automatic') {
								const actualType = keyTypes.get(keyGet) || 'string';
								if (actualType === 'none') {
									// key不存在，直接设置为null，不从results中读取
									value = null;
								} else {
									// key存在，从pipeline结果获取值
									value = results[resultIndex] ?? null;
									resultIndex++;
								}
							} else {
								// 非automatic模式，从pipeline结果获取值
								value = results[resultIndex] ?? null;
								resultIndex++;
							}

							if (options.dotNotation === false) {
								item.json[propertyName] = value;
							} else {
								set(item.json, propertyName, value);
							}

							returnItems.push(item);
						} else if (itemOp.operation === 'keys') {
							const getValues = this.getNodeParameter(
								'getValues',
								itemOp.itemIndex,
								true,
							) as boolean;
							const keys = keysOperationResults.get(itemOp.itemIndex) || [];

							if (!getValues) {
								// 不需要获取值，直接返回key列表
								returnItems.push({
									json: { keys },
									pairedItem: { item: itemOp.itemIndex },
								});
							} else {
								// 构建key-value映射
								const keyValueMap: Record<string, unknown> = {};
								for (const keyName of keys) {
									const actualType = keyTypes.get(keyName) || 'string';
									if (actualType === 'none') {
										// 修复：key不存在时直接设置为null
										keyValueMap[keyName] = null;
									} else {
										// key存在，从pipeline结果获取值
										const value = results[resultIndex] ?? null;
										keyValueMap[keyName] = value;
										resultIndex++;
									}
								}
								returnItems.push({
									json: {
										keys,
										values: keyValueMap,
									},
									pairedItem: { item: itemOp.itemIndex },
								});
							}
						} else if (itemOp.operation === 'set') {
							returnItems.push(items[itemOp.itemIndex]);
							resultIndex += itemOp.commandCount;
						} else if (itemOp.operation === 'incr') {
							const keyIncr = this.getNodeParameter('key', itemOp.itemIndex) as string;
							const incrementVal = results[resultIndex];
							resultIndex += itemOp.commandCount;

							returnItems.push({ json: { [keyIncr]: incrementVal } });
						} else if (itemOp.operation === 'publish') {
							returnItems.push(items[itemOp.itemIndex]);
							resultIndex += itemOp.commandCount;
						} else if (itemOp.operation === 'push') {
							returnItems.push(items[itemOp.itemIndex]);
							resultIndex += itemOp.commandCount;
						} else if (itemOp.operation === 'pop') {
							const propertyName = this.getNodeParameter(
								'propertyName',
								itemOp.itemIndex,
								'propertyName',
							) as string;
							const value = results[resultIndex];
							resultIndex++;

							let outputValue;
							try {
								outputValue = value && JSON.parse(value as string);
							} catch {
								outputValue = value;
							}

							const options = this.getNodeParameter('options', itemOp.itemIndex, {});
							if (options.dotNotation === false) {
								item.json[propertyName] = outputValue;
							} else {
								set(item.json, propertyName, outputValue);
							}
							returnItems.push(item);
						} else if (itemOp.operation === 'mget') {
							const propertyName = this.getNodeParameter(
								'propertyName',
								itemOp.itemIndex,
							) as string;
							const options = this.getNodeParameter('options', itemOp.itemIndex, {}) as {
								dotNotation?: boolean;
							};
							const values = results[resultIndex] || [];
							resultIndex++;

							if (options.dotNotation === false) {
								item.json[propertyName] = values;
							} else {
								set(item.json, propertyName, values);
							}

							returnItems.push(item);
						} else if (itemOp.operation === 'mset') {
							returnItems.push(items[itemOp.itemIndex]);
							resultIndex += itemOp.commandCount;
						}
					} catch (error) {
						if (this.continueOnFail()) {
							returnItems.push({
								json: {
									error: error.message,
								},
								pairedItem: {
									item: itemOp.itemIndex,
								},
							});
							// 修复：即使出错也要更新resultIndex以保持顺序
							resultIndex += itemOp.commandCount;
							continue;
						}
						await client.quit();
						throw new NodeOperationError(this.getNode(), error, { itemIndex: itemOp.itemIndex });
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnItems.push({
						json: {
							error: error.message,
						},
					});
				} else {
					await client.quit();
					throw new NodeOperationError(this.getNode(), error);
				}
			}
		}
		await client.quit();
		return [returnItems];
	}
}
