/* jshint esversion: 6 */
/* jshint node: true */
"use strict";

const { ParameterCheck } = require('../utils/lib')

module.exports = function (app, config, FabricManager, InvokeGet, JobProcess) {

	function get_mrc800(req, res) {
		ParameterCheck(req.params, 'mrc800id');

		res.header('Cache-Control', 'no-cache');
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc400get',
			args: [req.params.mrc800id]
		};
		InvokeGet(request, res);
	}

	function post_mrc800(req, res) {
		ParameterCheck(req.body, 'owner', "address");
		ParameterCheck(req.body, 'name', "", false, 0, 128);
		ParameterCheck(req.body, 'url', "url", false, 1, 255);
		ParameterCheck(req.body, 'imageurl', "url", false, 1, 255);
		ParameterCheck(req.body, 'description', "string", true, 1, 4096);
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc800create',
			args: [req.body.owner, req.body.name, req.body.url, req.body.imageurl, req.body.description, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [], []);
	}


	function put_mrc800(req, res) {
		ParameterCheck(req.params, 'mrc800id');
		ParameterCheck(req.body, 'name', "string", true, 0, 128);
		ParameterCheck(req.body, 'url', "url", true, 0, 255);
		ParameterCheck(req.body, 'imageurl', "url", true, 0, 255);
		ParameterCheck(req.body, 'description', "string", true, 0, 4096);
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc800update',
			args: [req.params.mrc800id, req.body.name, req.body.url, req.body.imageurl, req.body.description, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [], []);

	}

	function post_mrc800_take(req, res) {
		ParameterCheck(req.body, 'mrc800id', "", false, 40, 40);
		ParameterCheck(req.body, 'from', "address");
		ParameterCheck(req.body, 'amont', "int");
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc800take',
			args: [req.params.mrc800id, req.body.from, req.body.url, req.body.imageurl, req.body.description, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [], []);
	}


	function post_mrc800_give(req, res) {
		ParameterCheck(req.body, 'mrc800id', "", false, 40, 40);
		ParameterCheck(req.body, 'to', "address");
		ParameterCheck(req.body, 'amont', "int");
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc800give',
			args: [req.params.mrc800id, req.body.name, req.body.url, req.body.imageurl, req.body.description, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [], []);
	}

	function post_mrc800_transfer(req, res) {
		ParameterCheck(req.body, 'from', "address");
		ParameterCheck(req.body, 'to', "address");
		ParameterCheck(req.body, 'mrc800id', "", false, 40, 40);
		ParameterCheck(req.body, 'amont', "int");
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		request.post({
			url: config.MTCBridge + "/mrc800/transfer/" + req.params.mrc800id,
			form: req.body
		}, default_txresponse_process);
	}


	app.get('/mrc800/:mrc800id', get_mrc800);
	app.post('/mrc800', post_mrc800);
	app.put('/mrc800/:mrc800id', put_mrc800);

	app.post('/mrc800/transfer', post_mrc800_transfer);
	app.post('/mrc800/take', post_mrc800_take);
	app.post('/mrc800/give', post_mrc800_give);



};
