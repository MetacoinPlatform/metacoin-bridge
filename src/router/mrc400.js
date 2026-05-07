/* jshint esversion: 6 */
/* jshint node: true */
"use strict";

const { ParameterCheck } = require('../utils/lib')

module.exports = function (app, config, FabricManager, InvokeGet, JobProcess) {

	function get_mrc400(req, res) {
		ParameterCheck(req.params, 'mrc400id');
		res.header('Cache-Control', 'no-cache');
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc400get',
			args: [req.params.mrc400id]
		};
		InvokeGet(request, res);
	}


	function post_mrc400(req, res) {
		ParameterCheck(req.body, 'owner', "address");
		ParameterCheck(req.body, 'name', "string", false, 0, 128);
		ParameterCheck(req.body, 'url', "url", false, 1, 255);
		ParameterCheck(req.body, 'imageurl', "url", false, 1, 255);
		ParameterCheck(req.body, "allowtoken", "int", false, 1, 40);
		ParameterCheck(req.body, 'category', "string", false, 1, 64);
		ParameterCheck(req.body, 'description', "string", false, 1, 4096);
		ParameterCheck(req.body, 'itemurl', "url", false, 1, 255);
		ParameterCheck(req.body, 'itemimageurl', "url", false, 1, 255);
		ParameterCheck(req.body, 'data', "string", true, 1, 4096);
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc400create',
			args: [req.body.owner, req.body.name, req.body.url, req.body.imageurl, req.body.allowtoken, req.body.category, req.body.description, req.body.itemurl, req.body.itemimageurl, req.body.data, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.owner], []);

	}


	function put_mrc400(req, res) {
		ParameterCheck(req.params, 'mrc400id');
		ParameterCheck(req.body, 'name', 'string', true, 0, 128);
		ParameterCheck(req.body, 'url', "url", 0, 255);
		ParameterCheck(req.body, 'imageurl', "url", 0, 255);
		ParameterCheck(req.body, "allowtoken", "int", 1, 40);
		ParameterCheck(req.body, 'category', 'string', true, 0, 64);
		ParameterCheck(req.body, 'description', 'string', true, 0, 4096);
		ParameterCheck(req.body, 'itemurl', "url", 0, 255);
		ParameterCheck(req.body, 'itemimageurl', "url", 0, 255);
		ParameterCheck(req.body, 'data', 'string', true, 0, 4096);
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc400update',
			args: [req.params.mrc400id, req.body.name, req.body.url, req.body.imageurl, req.body.allowtoken, req.body.category, req.body.description, req.body.itemurl, req.body.itemimageurl, req.body.data, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [], []);
	}



	function get_mrc401(req, res) {
		ParameterCheck(req.params, 'mrc401id');
		res.header('Cache-Control', 'no-cache');

		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc401get',
			args: [req.params.mrc401id]
		};
		InvokeGet(request, res);
	}


	function post_mrc401(req, res) {
		ParameterCheck(req.params, 'mrc400id');
		ParameterCheck(req.body, 'itemdata');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc401create',
			args: [req.params.mrc400id, req.body.itemdata, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [], []);
	}


	function put_mrc401_update(req, res) {
		ParameterCheck(req.params, 'mrc400id');
		ParameterCheck(req.body, 'itemdata');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc401update',
			args: [req.params.mrc400id, req.body.itemdata, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [], []);
	}

	function post_mrc401_transfer(req, res) {
		ParameterCheck(req.params, 'mrc401id');
		ParameterCheck(req.body, 'fromAddr', "address");
		ParameterCheck(req.body, 'toAddr', "address");
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc401transfer',
			args: [req.params.mrc401id, req.body.fromAddr, req.body.toAddr, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [], []);

	}


	function post_mrc401_sell(req, res) {
		ParameterCheck(req.body, 'seller', "address");
		ParameterCheck(req.body, 'mrc400id');
		ParameterCheck(req.body, 'itemdata');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc401sell',
			args: [req.body.seller, req.body.mrc400id, req.body.itemdata, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.seller], []);

	}


	function post_mrc401_unsell(req, res) {
		ParameterCheck(req.body, 'seller', "address");
		ParameterCheck(req.body, 'mrc400id');
		ParameterCheck(req.body, 'itemdata');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');


		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc401unsell',
			args: [req.body.seller, req.body.mrc400id, req.body.itemdata, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.seller], []);

	}


	function post_mrc401_buy(req, res) {
		ParameterCheck(req.params, 'mrc401id');
		ParameterCheck(req.body, 'buyer', "address");
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc401buy',
			args: [req.body.buyer, req.params.mrc401id, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.buyer], []);

	}


	function post_mrc401_auction(req, res) {
		ParameterCheck(req.body, 'seller', "address");
		ParameterCheck(req.body, 'mrc400id');
		ParameterCheck(req.body, 'itemdata');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc401auction',
			args: [req.body.seller, req.body.mrc400id, req.body.itemdata, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.seller], []);
	}

	function post_mrc401_unauction(req, res) {
		ParameterCheck(req.body, 'seller', "address");
		ParameterCheck(req.body, 'mrc400id');
		ParameterCheck(req.body, 'itemdata');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc401unauction',
			args: [req.body.seller, req.body.mrc400id, req.body.itemdata, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.seller], []);
	}

	function get_mrc401_auctionfinish(req, res) {
		ParameterCheck(req.params, 'mrc401id');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc401auctionfinish',
			args: [req.params.mrc401id]
		};
		JobProcess(request, res, tx_id, [req.body.seller], []);
	}

	function post_mrc401_bid(req, res) {
		ParameterCheck(req.params, 'mrc401id');
		ParameterCheck(req.body, 'buyer', "address");
		ParameterCheck(req.body, 'amount', "int");
		ParameterCheck(req.body, 'token', "int");
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc401bid',
			args: [req.body.buyer, req.params.mrc401id, req.body.amount, req.body.token, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.buyer], []);

	}


	function post_mrc401_melt(req, res) {
		ParameterCheck(req.params, 'mrc401id');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc401melt',
			args: [req.params.mrc401id, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [], []);
	}



	// mrc400
	app.get('/mrc400/:mrc400id', get_mrc400);
	app.post('/mrc400', post_mrc400);
	app.put('/mrc400/:mrc400id', put_mrc400);

	// Routes setup
	app.get('/mrc401/:mrc401id', get_mrc401);
	app.post('/mrc401/transfer/:mrc401id', post_mrc401_transfer);
	app.post('/mrc401/sell', post_mrc401_sell);
	app.post('/mrc401/unsell', post_mrc401_unsell);
	app.post('/mrc401/buy/:mrc401id', post_mrc401_buy);
	app.post('/mrc401/melt/:mrc401id', post_mrc401_melt);
	app.post('/mrc401/bid/:mrc401id', post_mrc401_bid);
	app.post('/mrc401/auction', post_mrc401_auction);
	app.post('/mrc401/unauction', post_mrc401_unauction);
	app.get('/mrc401/auctionfinish/:mrc401id', get_mrc401_auctionfinish);
	app.put('/mrc401/:mrc400id', put_mrc401_update);
	app.post('/mrc401/:mrc400id', post_mrc401);
};
