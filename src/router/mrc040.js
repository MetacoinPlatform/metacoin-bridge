/* jshint esversion: 6 */
/* jshint node: true */
"use strict";

const { ParameterCheck } = require('../utils/lib')

module.exports = function (app, config, FabricManager, InvokeGet, JobProcess) {


	function get_mrc040(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc040get',
			args: [req.params.mrc040key]
		};

		FabricManager.channel.queryByChaincode(request)
			.then((query_responses) => {
				if (query_responses && query_responses.length == 1) {
					if (query_responses[0] instanceof Error) {
						return next(new Error(query_responses[0].toString()));
					} else {
						var data = JSON.parse(query_responses[0].toString());
						if (data.is_open == 0) {
							data.publickey = '';
						}
						res.json({
							result: 'SUCCESS',
							msg: '',
							data: JSON.stringify(data)
						});
					}
				} else {
					return next(new Error('Response Error'));
				}
			}).catch((err) => {
				res.json({
					result: 'ERROR',
					msg: err.message,
					data: ''
				});
			});
	}
	function post_mrc040_cancel(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.params, 'tkey');
		ParameterCheck(req.body, 'owner', "address");
		ParameterCheck(req.body, 'mrc040id');
		ParameterCheck(req.body, 'signature');

		let tx_id = FabricManager.client.newTransactionID();
		// owner, side, BaseToken, TargetToken, price, qtt, exchangeItemPK
		let request = {
			chaincodeId: config.chain_code_id,
			fcn: 'stodexUnRegister',
			args: [req.body.owner, req.body.mrc040id, req.body.signature, req.params.tkey],
			chainId: config.channel_name,
			txId: tx_id
		};
		JobProcess(request, res, tx_id, [req.body.owner], [], 0);

	}


	function post_mrc040_create(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		console.log(new Date().toLocaleString(), req.body);
		ParameterCheck(req.params, 'tkey');
		ParameterCheck(req.body, 'owner', "address");
		ParameterCheck(req.body, 'side');
		ParameterCheck(req.body, 'basetoken');
		ParameterCheck(req.body, 'targettoken');
		ParameterCheck(req.body, 'price', 'int');
		ParameterCheck(req.body, 'qtt', 'int');
		ParameterCheck(req.body, 'signature');

		let now = Math.round(new Date().getTime() / 1000);
		let MRC040KEY = "MRC040_" + getRandomString(40) + "_" + now;
		let tx_id = FabricManager.client.newTransactionID();
		// owner, side, BaseToken, TargetToken, price, qtt, exchangeItemPK
		let request = {
			chaincodeId: config.chain_code_id,
			fcn: 'stodexRegister',
			args: [req.body.owner, req.body.side, req.body.basetoken, req.body.targettoken, req.body.price, req.body.qtt, MRC040KEY, req.body.signature, req.params.tkey],
			chainId: config.channel_name,
			txId: tx_id,
			mrc040key: MRC040KEY
		};
		JobProcess(request, res, tx_id, [req.body.owner], [], 0);
	}


	function post_mrc040_exchange(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.params, 'tkey');
		ParameterCheck(req.body, 'requester');
		ParameterCheck(req.body, 'mrc040id');
		ParameterCheck(req.body, 'qtt', "int");
		ParameterCheck(req.body, 'signature');
		getHyperLedgerData(req.body.mrc040id)
			.then((mrc040_item) => {
				let tx_id = FabricManager.client.newTransactionID();
				let now = Math.round(new Date().getTime() / 1000);
				let MRC040KEY = "MRC040_" + getRandomString(40) + "_" + now;
				// owner, side, BaseToken, TargetToken, price, qtt, exchangeItemPK
				let request = {
					chaincodeId: config.chain_code_id,
					fcn: 'stodexExchange',
					args: [req.body.requester, req.body.qtt, req.body.mrc040id, MRC040KEY, req.body.signature, req.params.tkey],
					chainId: config.channel_name,
					txId: tx_id,
					mrc040key: MRC040KEY
				};
				JobProcess(request, res, tx_id, [req.body.requester, mrc040_item.Owner], []);
			}, function (reason) {
				res.json({
					result: 'ERROR',
					msg: '6002,ExchangeItem not found',
					data: ''
				});
				return Promise.reject(null);
			})
			.catch(function (err) {
				res.json({
					result: 'ERROR',
					msg: err.message,
					data: ''
				});
			});
	}


	function post_tokenupdate_tokenbase(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.params, 'tkey');
		ParameterCheck(req.params, 'token');
		ParameterCheck(req.params, 'baseToken');

		let tx_id = FabricManager.client.newTransactionID();
		let request = {
			chaincodeId: config.chain_code_id,
			fcn: 'tokenSetBase',
			args: [req.params.token, req.params.baseToken, req.body.signature, req.params.tkey],
			chainId: config.channel_name,
			txId: tx_id
		};
		JobProcess(request, res, tx_id, [], [req.params.token, req.params.baseToken]);
	}


	function post_tokenupdate_tokentargetadd(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.params, 'tkey');
		ParameterCheck(req.params, 'token');
		ParameterCheck(req.params, 'targetToken');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'tokenAddTarget',
			args: [req.params.token, req.params.targetToken, req.body.signature, req.params.tkey],
			chainId: config.channel_name,
			txId: tx_id
		};
		JobProcess(request, res, tx_id, [], [req.params.token, req.params.targetToken]);

	}


	function post_tokenupdate_tokentargetremove(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.params, 'tkey');
		ParameterCheck(req.params, 'token');
		ParameterCheck(req.params, 'targetToken');


		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'tokenRemoveTarget',
			args: [req.params.token, req.params.targetToken, req.body.signature, req.params.tkey],
			chainId: config.channel_name,
			txId: tx_id
		};
		JobProcess(request, res, tx_id, [], [req.params.token, req.params.targetToken]);

	}



	// mrc040
	app.get('/mrc040/:mrc040key', get_mrc040);
	app.post('/mrc040/cancel/:tkey', post_mrc040_cancel);
	app.post('/mrc040/create/:tkey', post_mrc040_create);
	app.post('/mrc040/exchange/:tkey', post_mrc040_exchange);


	// token update for mrc040
	app.post('/tokenUpdate/TokenBase/:tkey/:token/:baseToken', post_tokenupdate_tokenbase);
	app.post('/tokenUpdate/TokenTargetAdd/:tkey/:token/:targetToken', post_tokenupdate_tokentargetadd);
	app.post('/tokenUpdate/TokenTargetRemove/:tkey/:token/:targetToken', post_tokenupdate_tokentargetremove);

};
