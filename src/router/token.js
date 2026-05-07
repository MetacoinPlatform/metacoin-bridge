/* jshint esversion: 6 */
/* jshint node: true */
"use strict";
const { ParameterCheck } = require('../utils/lib')
const Redis = require("ioredis")
module.exports = function (app, config, FabricManager, InvokeGet, JobProcess) {
	const redis = new Redis(config.redis_server);
	function post_token(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.body, 'symbol');
		ParameterCheck(req.body, 'totalsupply', "int");
		ParameterCheck(req.body, 'decimal', "int");
		ParameterCheck(req.body, 'name');
		ParameterCheck(req.body, 'owner');
		if (!Number(req.body.totalsupply)) {
			return next(new Error('totalsupply must be number'));
		}
		if (Number(req.body.totalsupply) < 1) {
			return next(new Error('totalsupply must be bigger then 0'));
		}

		let d = parseInt(req.body.decimal);
		if (req.body.totalsupply.length - d > 30) {
			return next(new Error('totalsupply must be less then 1e30 (without decimals(precision))'));
		}

		if (typeof req.body.tier == typeof []) {
			req.body.tier.forEach(function (tier) {
				tier.startdate = parseInt(tier.startdate);
				tier.enddate = parseInt(tier.enddate);
				if (tier.rate === undefined || tier.rate == '') {
					return next(new Error('Tier rate not defined'));
				}
				tier.rate = parseInt(tier.rate);
				tier.tiersn = parseInt(tier.tiersn);
				tier.unlockdate = parseInt(tier.unlockdate);
			});
		} else {
			req.body.tier = [];
		}
		if (typeof req.body.reserve == typeof []) {
			req.body.reserve.forEach(function (reserve) {
				reserve.unlockdate = parseInt(reserve.unlockdate);
				if (!isNormalInteger(reserve.value)) {
					return next(new Error('value must be number'));
				}
			});
		} else {
			req.body.reserve = [];
		}

		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'getNonce',
			args: [req.body.owner]
		};
		FabricManager.channel.queryByChaincode(request)
			.then((query_responses) => {
				if (query_responses && query_responses.length == 1) {
					if (query_responses[0] instanceof Error) {
						throw new Error(query_responses[0].toString());
					} else {
						req.body.decimal = parseInt(req.body.decimal);
						redis.set('TKEY_TOKEN_' + query_responses[0].toString(), JSON.stringify(req.body), 'EX', 3600, function (err) {
							if (err == null) {
								res.json({
									result: 'SUCCESS',
									msg: '',
									data: query_responses[0].toString()
								});
							}
						});
					}
				} else {
					throw new Error('Response Error');
				}
			}).catch((err) => {
				res.json({
					result: 'ERROR',
					msg: err.message,
					data: ''
				});
			});

	}

	function post_token_tkey(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.params, "tkey");
		ParameterCheck(req.body, "signature");

		redis.get('TKEY_TOKEN_' + req.params.tkey)
			.then(function (value) {
				if (value == null || value == '') {
					return next(new Error("Token information not found or invalid key"));
				}

				var token_data = JSON.parse(value);
				if (token_data.type != '010') {
					token_data.type = '010'
				}

				redis.del('TKEY_TOKEN_' + req.params.tkey, function (err, reply) { });
				var tx_id = FabricManager.client.newTransactionID();
				var request = {
					chaincodeId: config.chain_code_id,
					fcn: 'tokenRegister',
					args: [value, req.body.signature, req.params.tkey],
					chainId: config.channel_name,
					txId: tx_id
				};
				InvokePost(request, res, tx_id, [], []);
			})
			.catch(function (err) {
				if (err != null) {
					res.json({
						result: 'ERROR',
						msg: err.toString(),
						data: ""
					});
					return;
				}
			});
	}



	function put_token(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.body, 'token');
		ParameterCheck(req.body, 'url');
		ParameterCheck(req.body, 'info');
		ParameterCheck(req.body, 'image');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.params, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'tokenUpdate',
			args: [req.body.token, req.body.url, req.body.info, req.body.image, req.body.signature, req.params.tkey],
			chainId: config.channel_name,
			txId: tx_id
		};
		JobProcess(request, res, tx_id, [], [req.body.token]);

	}


	function post_token_burn(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.body, 'token');
		ParameterCheck(req.body, 'amount', 'int');
		ParameterCheck(req.body, 'memo', "string", true);
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.params, 'tkey');

		getHyperLedgerData('TOKEN_DATA_' + req.body.token)
			.then(function (token_data) {
				var tx_id = FabricManager.client.newTransactionID();
				var request = {
					chaincodeId: config.chain_code_id,
					fcn: 'tokenBurning',
					args: [req.body.token, req.body.amount, req.body.memo, req.body.signature, req.params.tkey],
					chainId: config.channel_name,
					txId: tx_id
				};
				JobProcess(request, res, tx_id, [token_data.owner], [req.body.token]);
			})
			.catch(function (err) {
				res.json({
					result: 'ERROR',
					msg: err.message,
					data: ''
				});
			});
	}


	function post_token_increase(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.body, 'token');
		ParameterCheck(req.body, 'amount', 'int');
		ParameterCheck(req.body, 'memo', "string", true);
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.params, 'tkey');

		getHyperLedgerData('TOKEN_DATA_' + req.body.token)
			.then(function (token_data) {
				var tx_id = FabricManager.client.newTransactionID();
				var request = {
					chaincodeId: config.chain_code_id,
					fcn: 'tokenIncrease',
					args: [req.body.token, req.body.amount, req.body.memo, req.body.signature, req.params.tkey],
					chainId: config.channel_name,
					txId: tx_id
				};
				JobProcess(request, res, tx_id, [token_data.owner], [req.body.token]);
			})
			.catch(function (err) {
				res.json({
					result: 'ERROR',
					msg: err.message,
					data: ''
				});
			});

	}

	function post_token_sell(req, res) {
		ParameterCheck(req.body, 'address', 'address');
		ParameterCheck(req.body, 'amount', "int");
		ParameterCheck(req.body, 'token', "int");
		ParameterCheck(req.body, 'price', "int");
		ParameterCheck(req.body, 'platform_name', "string", true, 0, 255);
		ParameterCheck(req.body, 'platform_url', "url", true, 0, 255);
		ParameterCheck(req.body, 'platform_address', "address", true);
		ParameterCheck(req.body, 'platform_commission', "string", true, 0, 5);
		ParameterCheck(req.body, 'min_trade_unit', "int", true, 1, 100000000);

		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc010sell',
			args: [req.body.address, req.body.amount, req.params.mrc010id, req.body.price, req.body.token,
			req.body.platform_name, req.body.platform_url, req.body.platform_address, req.body.platform_commission,
			req.body.min_trade_unit, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address], []);
	}

	function post_token_unsell(req, res) {
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc010unsell',
			args: [req.params.mrc010dexid, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address, req.params.mrc010dexid], []);
	}

	function post_token_buy(req, res) {
		ParameterCheck(req.body, 'address', 'address');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'amount', "int");
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc010buy',
			args: [req.params.mrc010dexid, req.body.address, req.body.amount, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address, req.params.mrc010dexid], []);
	}

	function post_token_reqsell(req, res) {
		ParameterCheck(req.body, 'address', 'address');
		ParameterCheck(req.body, 'amount', "int");
		ParameterCheck(req.body, 'token', "int");
		ParameterCheck(req.body, 'price', "int");
		ParameterCheck(req.body, 'platform_name', "string", true, 0, 255);
		ParameterCheck(req.body, 'platform_url', "url", true, 0, 255);
		ParameterCheck(req.body, 'platform_address', "address", true);
		ParameterCheck(req.body, 'platform_commission', "string", true, 0, 5);
		ParameterCheck(req.body, 'min_trade_unit', "int", true, 1, 100000000);

		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc010reqsell',
			args: [req.body.address, req.body.amount, req.params.mrc010id, req.body.price, req.body.token,
			req.body.platform_name, req.body.platform_url, req.body.platform_address, req.body.platform_commission,
			req.body.min_trade_unit, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address], []);
	}

	function post_token_unreqsell(req, res) {
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc010unreqsell',
			args: [req.params.mrc010dexid, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address, req.params.mrc010dexid], []);
	}

	function post_token_acceptreqsell(req, res) {
		ParameterCheck(req.body, 'address', 'address');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'amount', "int");
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc010acceptreqsell',
			args: [req.params.mrc010dexid, req.body.address, req.body.amount, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address, req.params.mrc010dexid], []);
	}



	function get_token(req, res, next) {
		ParameterCheck(req.params, "token");
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'get',
			args: ['TOKEN_DATA_' + req.params.token]
		};
		InvokeGet(request, res);
	}

	function get_token_dex(req, res, next) {
		ParameterCheck(req.params, "mrc010dexid", "string", false, 40, 40);
		if (!req.params.mrc010dexid.startsWith("DEX010_") || req.params.mrc010dexid.length != 40) {
			throw new Error(req.params.mrc010dexid + " is not MRC010 DEX ID");
		}
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'get',
			args: [req.params.mrc010dexid]
		};
		InvokeGet(request, res);
	}




	function post_transfer(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		var data = "";
		// req.body.unlockdate = "0";
		ParameterCheck(req.body, 'from', "address");
		ParameterCheck(req.body, 'to', "address");
		ParameterCheck(req.body, 'token', "int");
		ParameterCheck(req.body, 'amount', 'int', false, 1, 99);
		ParameterCheck(req.body, 'checkkey');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'unlockdate', "int");

		if (req.body.from == req.body.to) {
			return next(new Error('The from address and to addressare the same.'));
		}

		if (req.body.tags === undefined) {
			req.body.tags = '';
		}

		if (req.body.memo === undefined) {
			req.body.memo = '';
		}

		req.body.tags = req.body.tags.substr(0, 64);
		req.body.memo = req.body.memo.substr(0, 2048);

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'transfer',
			args: [req.body.from, req.body.to, req.body.amount, req.body.token, req.body.signature, req.body.unlockdate, req.body.tags, req.body.memo, req.body.checkkey],
			chainId: config.channel_name,
			txId: tx_id
		};
		JobProcess(request, res, tx_id, [req.body.from, req.body.to], [], 0);
	}


	function post_multitransfer(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		var data = "";
		// req.body.unlockdate = "0";
		ParameterCheck(req.body, 'from', "address");
		ParameterCheck(req.body, 'transferlist');
		ParameterCheck(req.body, 'token', "int");
		ParameterCheck(req.body, 'checkkey');
		ParameterCheck(req.body, 'signature');

		try {
			data = JSON.parse(req.body.transferlist);
		} catch (e) {
			return next(new Error('The transferlist must be a json encoded array'));
		}

		if (Array.isArray(data) == false) {
			return next(new Error('The transferlist must be a json encoded array'));
		}
		if (data.length > 100) {
			return next(new Error('There must be no more than 100 recipients of multitransfer'));
		}

		let AddrList = [];
		for (var key in data) {
			ParameterCheck(data[key], 'address', "address");
			ParameterCheck(data[key], 'amount', 'int', false, 1, 99);
			ParameterCheck(data[key], 'unlockdate', 'int');

			if (req.body.from == data[key].address) {
				return next(new Error('The from address and to addressare the same.'));
			}
			AddrList.push(data[key].address);
		}
		AddrList.push(req.body.from);

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'multitransfer',
			args: [req.body.from, req.body.transferlist, req.body.token, req.body.signature, req.body.checkkey],
			chainId: config.channel_name,
			txId: tx_id
		};
		JobProcess(request, res, tx_id, AddrList, [], 0);
	}


	function post_exchange(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.body, 'fromAddr', "address");
		ParameterCheck(req.body, 'fromAmount', 'int');
		ParameterCheck(req.body, 'fromToken');
		ParameterCheck(req.body, 'fromFeesendto');
		ParameterCheck(req.body, 'fromFeeamount', 'int');
		ParameterCheck(req.body, 'fromFeetoken');
		ParameterCheck(req.body, 'fromTag', 'string', true, 0, 64);
		ParameterCheck(req.body, 'fromMemo', 'string', true, 0, 2048);
		ParameterCheck(req.body, 'fromSign');
		ParameterCheck(req.params, 'fromTkey');
		ParameterCheck(req.body, 'toAddr', "address");
		ParameterCheck(req.body, 'toAmount', 'int');
		ParameterCheck(req.body, 'toToken');
		ParameterCheck(req.body, 'toFeesendto');
		ParameterCheck(req.body, 'toFeeamount', 'int');
		ParameterCheck(req.body, 'toFeetoken');
		ParameterCheck(req.body, 'toTag', 'string', true, 0, 64);
		ParameterCheck(req.body, 'toMemo', 'string', true, 0, 2048);
		ParameterCheck(req.body, 'toSign');
		ParameterCheck(req.params, 'toTkey');

		if (req.body.fromAddr == req.body.toAddr) {
			return next(new Error('The from address and to address are the same.'));
		}

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'exchange',
			args: [req.body.fromAddr, req.body.fromAmount, req.body.fromToken, req.body.fromFeesendto, req.body.fromFeeamount, req.body.fromFeetoken,
			req.body.fromTag, req.body.fromMemo, req.body.fromSign,
			req.body.toAddr, req.body.toAmount, req.body.toToken, req.body.toFeesendto, req.body.toFeeamount, req.body.toFeetoken,
			req.body.toTag, req.body.toMemo, req.body.toSign,
			req.params.fromTkey, req.params.toTkey,
			],
			chainId: config.channel_name,
			txId: tx_id
		};
		JobProcess(request, res, tx_id, [req.body.fromAddr, req.body.toAddr, req.body.fromFeesendto, req.body.toFeesendto], [], 0);

	}


	app.post('/token', post_token);
	app.post('/token/:tkey', post_token_tkey);
	// token update
	app.put('/token/update/:tkey', put_token);
	app.put('/token/increase/:tkey', post_token_increase);
	app.put('/token/burn/:tkey', post_token_burn);

	app.post('/token/sell/:mrc010id', post_token_sell);
	app.post('/token/unsell/:mrc010dexid', post_token_unsell);
	app.post('/token/buy/:mrc010dexid', post_token_buy);

	app.post('/token/reqsell/:mrc010id', post_token_reqsell);
	app.post('/token/unreqsell/:mrc010dexid', post_token_unreqsell);
	app.post('/token/acceptreqsell/:mrc010dexid', post_token_acceptreqsell);
	// token
	app.get('/token/:token', get_token);
	app.get('/token/dex/:mrc010dexid', get_token_dex);

	// transfer and exchange
	app.post('/transfer', post_transfer);
	app.post('/multitransfer', post_multitransfer);
	app.post('/exchange/:fromTkey/:toTkey', post_exchange);


}
