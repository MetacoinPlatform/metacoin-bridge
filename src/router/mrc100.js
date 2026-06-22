/* jshint esversion: 6 */
/* jshint node: true */
"use strict";

const { ParameterCheck } = require('../utils/lib')

module.exports = function (app, config, FabricManager, InvokeGet, JobProcess) {
	function post_mrc100_payment(req, res, next) {
		ParameterCheck(req.body, 'to');
		ParameterCheck(req.body, 'token');
		ParameterCheck(req.body, 'tag');
		ParameterCheck(req.body, 'userlist');
		ParameterCheck(req.body, 'gameid');
		ParameterCheck(req.body, 'gamememo');

		req.body.gameid = req.body.gameid.substr(0, 64);
		req.body.gamememo = req.body.gamememo.substr(0, 2048);

		let userlist;
		try {
			userlist = JSON.parse(req.body.userlist);
		} catch (e) {
			res.status(400).send("userlist json decode error");
			return;
		}

		if (Array.isArray(userlist)) {
			res.status(400).send("userlist is not array");
			return;
		}

		if (userlist.length < 1) {
			res.status(400).send("userlist is empty");
			return;

		}
		if (!isAddress(req.body.to)) {
			return next(new Error("to address is invalid"));
		}

		let addr_list = [req.body.from];
		let promise_list = [];
		try {
			for (var i = 0; i < userlist.length; i++) {
				let u = userlist[i];
				if (u.address == undefined || u.amount == undefined || u.tkey == undefined || u.signature == undefined) {
					return next(new Error("userlist data is invalid at " + i));
				}
				if (!isAddress(u.address)) {
					return next(new Error('Invalid address - ' + u.addres));
				}
				if (!isNormalInteger(u.amount)) {
					return next(new Error('Invalid amount - ' + u.addres));
				}
				addr_list.push(u.address);
			}
		} catch (err) {
			return next(err);
		}

		Promise.all(promise_list)
			.then(function (values) {
				var tx_id = FabricManager.client.newTransactionID();
				var request = {
					chaincodeId: config.chain_code_id,
					fcn: 'mrc100Payment',
					args: [req.body.to, req.body.token, req.body.tag, req.body.userlist, req.body.gameid, req.body.gamememo],
					chainId: config.channel_name,
					txId: tx_id
				};
				JobProcess(request, res, tx_id, addr_list, []);
			});

	}

	function post_mrc100_reward(req, res, next) {
		ParameterCheck(req.body, 'from', "address");
		ParameterCheck(req.body, 'token');
		ParameterCheck(req.body, 'userlist');
		ParameterCheck(req.body, 'gameid');
		ParameterCheck(req.body, 'gamememo');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		req.body.gameid = req.body.gameid.substr(0, 64);
		req.body.gamememo = req.body.gamememo.substr(0, 2048);

		let userlist;
		try {
			userlist = JSON.parse(req.body.userlist);
		} catch (e) {
			res.status(400).send("userlist json decode error");
			return;
		}

		if (Array.isArray(userlist)) {
			res.status(400).send("userlist is not array");
			return;
		}

		if (userlist.length < 1) {
			res.status(400).send("userlist is empty");
			return;

		}
		if (!isAddress(req.body.from)) {
			return next(new Error("from address is invalid"));
		}

		let addr_list = [req.body.from];
		for (var i = 0; i < userlist.length; i++) {
			let u = userlist[i];
			if (u.address == undefined || u.amount == undefined || u.tag == undefined || u.memo == undefined) {
				res.status(400).send("userlist data is invalid at " + i);
				return;
			}
			if (!isAddress(u.address)) {
				res.status(400).send(u.address + " is invalid address");
				return;
			}
			if (!isNormalInteger(u.amount)) {
				return next(new Error('Invalid amount - ' + u.addres));
			}
			addr_list.push(u.address);
		}

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc100Reward',
			args: [req.body.from, req.body.token, req.body.userlist, req.body.gameid, req.body.gamememo, req.body.signature, req.body.tkey],
			chainId: config.channel_name,
			txId: tx_id
		};
		JobProcess(request, res, tx_id, addr_list, []);
	}


	function post_mrc100_log(req, res) {
		ParameterCheck(req.params, 'tkey');
		ParameterCheck(req.body, 'token');
		ParameterCheck(req.body, 'logger');
		ParameterCheck(req.body, 'log');
		ParameterCheck(req.body, 'signature');

		req.body.log = req.body.log.substr(0, 2048);


		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc100Log',
			args: [key, req.body.token, req.body.logger, req.body.log, req.body.signature, req.params.tkey],
			chainId: config.channel_name,
			txId: tx_id,
			mrc100logkey: key
		}
		JobProcess(request, res, tx_id, [], []);

	}


	function get_mrc100_log(req, res, next) {
		ParameterCheck(req.params, 'mrc100key');

		res.header('Cache-Control', 'no-cache');
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc100get',
			args: [req.params.mrc100key]
		};
		InvokeGet(request, res);
	}


	function get_mrc100_logger(req, res) {
		ParameterCheck(req.params, 'token');

		let rv;
		getHyperLedgerData('TOKEN_DATA_' + req.params.token)
			.then(function (data) {
				try {
					if (typeof data.logger == typeof {}) {

					} else {
						data.logger = {};
					}
					data.logger[data.owner] = data.createdate;
					rv = data.logger;
					res.json({
						result: 'SUCCESS',
						msg: '',
						data: rv
					});
				} catch (e) {
					// console.log(e);
				}
			});
	}

	function post_mrc100_logger(req, res) {
		ParameterCheck(req.params, 'tkey');
		ParameterCheck(req.body, 'token');
		ParameterCheck(req.body, 'address');
		ParameterCheck(req.body, 'signature');


		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'tokenAddLogger',
			args: [req.body.token, req.body.address, req.body.signature, req.params.tkey],
			chainId: config.channel_name,
			txId: tx_id
		};
		JobProcess(request, res, tx_id, [], [req.body.token]);
	}

	function delete_mrc100_logger(req, res) {
		ParameterCheck(req.params, 'tkey');
		ParameterCheck(req.body, 'token');
		ParameterCheck(req.body, 'address');
		ParameterCheck(req.body, 'signature');


		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'tokenRemoveLogger',
			args: [req.body.token, req.body.address, req.body.signature, req.params.tkey],
			chainId: config.channel_name,
			txId: tx_id
		};
		JobProcess(request, res, tx_id, [], [req.body.token]);
	}



	// mrc100
	app.post('/mrc100/payment', post_mrc100_payment);
	app.post('/mrc100/reward', post_mrc100_reward);
	app.post('/mrc100/log/:tkey', post_mrc100_log);
	app.get('/mrc100/log/:mrc100key', get_mrc100_log);

	app.get('/mrc100/logger/:token', get_mrc100_logger);
	app.post('/mrc100/logger/:tkey', post_mrc100_logger);
	app.delete('/mrc100/logger/:tkey', delete_mrc100_logger);
};
