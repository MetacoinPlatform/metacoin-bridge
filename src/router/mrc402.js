/* jshint esversion: 6 */
/* jshint node: true */
"use strict";

const { ParameterCheck } = require('../utils/lib')

module.exports = function (app, config, FabricManager, InvokeGet, JobProcess) {

	function get_mrc402(req, res) {
		ParameterCheck(req.params, 'mrc402id');
		res.header('Cache-Control', 'no-cache');
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc402get',
			args: [req.params.mrc402id]
		};
		InvokeGet(request, res);
	}

	function get_mrc402_dex(req, res) {
		ParameterCheck(req.params, 'mrc402dexid');
		ParameterCheck(req.params, "mrc402dexid", "string", false, 40, 40);
		if (!req.params.mrc402dexid.startsWith("DEX402_") || req.params.mrc402dexid.length != 40) {
			throw new Error(req.params.mrc402dexid + " is not MRC402 DEX ID");
		}
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'get',
			args: [req.params.mrc402dexid]
		};
		InvokeGet(request, res);
	}


	function post_mrc402(req, res) {
		ParameterCheck(req.body, 'name', "string", false, 1, 128);
		ParameterCheck(req.body, 'creator', "address");
		ParameterCheck(req.body, 'creatorcommission');
		ParameterCheck(req.body, 'totalsupply', "int", false, 1, 8);
		ParameterCheck(req.body, 'decimal', "int", false, 1, 1);
		ParameterCheck(req.body, 'url', "url", false, 1, 255);
		ParameterCheck(req.body, 'imageurl', "url", false, 1, 255);
		ParameterCheck(req.body, "shareholder", "string", true, 1, 1024);
		ParameterCheck(req.body, "initialreserve", "string", true, 1, 1024);
		ParameterCheck(req.body, "expiredate", "int", true, 0, 12);
		ParameterCheck(req.body, 'data', "string", true, 0, 40960);
		ParameterCheck(req.body, 'information', "string", true, 0, 40960);
		ParameterCheck(req.body, 'socialmedia', "string", true, 0, 40960);
		ParameterCheck(req.body, 'copyright_registration_country', "string", true, 0, 2);
		ParameterCheck(req.body, 'copyright_registrar', "string", true, 0, 128);
		ParameterCheck(req.body, 'copyright_registration_number', "string", true, 0, 64);
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402create',
			args: [req.body.creator, req.body.name, req.body.creatorcommission, req.body.totalsupply, req.body.decimal,
			req.body.url, req.body.imageurl, req.body.shareholder, req.body.initialreserve, req.body.expiredate,
			req.body.data, req.body.information, req.body.socialmedia, req.body.copyright_registration_country, req.body.copyright_registrar,
			req.body.copyright_registration_number, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.creator], []);
	}

	function post_mrc402_transfer(req, res) {
		ParameterCheck(req.body, 'fromAddr', "address");
		ParameterCheck(req.body, 'toAddr', "address");
		ParameterCheck(req.body, 'amount', "int");
		ParameterCheck(req.body, 'tag');
		ParameterCheck(req.body, 'memo');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402transfer',
			args: [req.body.fromAddr, req.body.toAddr, req.body.amount, req.params.mrc402id, req.body.tag,
			req.body.memo, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.fromAddr, req.body.toAddr], []);
	}


	function put_mrc402(req, res) {
		ParameterCheck(req.body, 'url', "url", false, 1, 255);
		ParameterCheck(req.body, 'data', "string", true, 0, 40960);
		ParameterCheck(req.body, 'information', "string", true, 0, 40960);
		ParameterCheck(req.body, 'socialmedia', "string", true, 0, 40960);
		ParameterCheck(req.body, 'copyright_registration_country', "string", true, 0, 2);
		ParameterCheck(req.body, 'copyright_registrar', "string", true, 0, 128);
		ParameterCheck(req.body, 'copyright_registration_number', "string", true, 0, 64);
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402update',
			args: [req.params.mrc402id, req.body.url, req.body.data, req.body.information, req.body.socialmedia,
			req.body.copyright_registration_country, req.body.copyright_registrar, req.body.copyright_registration_number, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.params.mrc402id], []);
	}

	function put_mrc402_mint(req, res) {
		ParameterCheck(req.body, 'amount');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'memo', "string", true, 0, 1024);
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402mint',
			args: [req.params.mrc402id, req.body.amount, req.body.memo, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.params.mrc402id], []);
	}

	function put_mrc402_burn(req, res) {
		ParameterCheck(req.body, 'amount');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'memo', "string", true, 0, 1024);
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402burn',
			args: [req.params.mrc402id, req.body.amount, req.body.memo, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.params.mrc402id], []);
	}

	function post_mrc402_melt(req, res) {
		ParameterCheck(req.body, 'address', 'address');
		ParameterCheck(req.body, 'amount');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402melt',
			args: [req.params.mrc402id, req.body.address, req.body.amount, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address, req.params.mrc402id], []);
	}

	function post_mrc402_sell(req, res) {
		ParameterCheck(req.body, 'address', 'address');
		ParameterCheck(req.body, 'amount', "int");
		ParameterCheck(req.body, 'token', "int");
		ParameterCheck(req.body, 'price', "int");
		ParameterCheck(req.body, 'platform_name', "string", true, 0, 255);
		ParameterCheck(req.body, 'platform_url', "url", true, 0, 255);
		ParameterCheck(req.body, 'platform_address', "address", true);
		ParameterCheck(req.body, 'platform_commission', "string", true, 0, 5);

		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402sell',
			args: [req.body.address, req.body.amount, req.params.mrc402id, req.body.price, req.body.token,
			req.body.platform_name, req.body.platform_url, req.body.platform_address, req.body.platform_commission,
			req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address], []);
	}

	function post_mrc402_unsell(req, res) {
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402unsell',
			args: [req.params.mrc402dexid, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address, req.params.mrc402dexid], []);
	}

	function post_mrc402_buy(req, res) {
		ParameterCheck(req.body, 'address', 'address');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'amount', "int");
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402buy',
			args: [req.params.mrc402dexid, req.body.address, req.body.amount, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address, req.params.mrc402dexid], []);
	}

	function post_mrc402_auction(req, res) {
		ParameterCheck(req.body, 'address', 'address');
		ParameterCheck(req.body, 'amount', "int");
		ParameterCheck(req.body, 'auction_start_price', "int");
		ParameterCheck(req.body, 'token', "int");
		ParameterCheck(req.body, 'auction_bidding_unit', "int");
		ParameterCheck(req.body, 'auction_buynow_price', "string", true);
		ParameterCheck(req.body, 'auction_start_date', "int", true);
		ParameterCheck(req.body, 'auction_end_date', "int", true);
		ParameterCheck(req.body, 'platform_name', "string", true, 0, 255);
		ParameterCheck(req.body, 'platform_url', "url", true, 0, 255);
		ParameterCheck(req.body, 'platform_address', "address", true);
		ParameterCheck(req.body, 'platform_commission', "string", true, 0, 5);

		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402auction',
			args: [req.body.address, req.body.amount, req.params.mrc402id, req.body.auction_start_price, req.body.token,
			req.body.auction_bidding_unit, req.body.auction_buynow_price, req.body.auction_start_date, req.body.auction_end_date, req.body.platform_name,
			req.body.platform_url, req.body.platform_address, req.body.platform_commission, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address], []);
	}

	function post_mrc402_unauction(req, res) {
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402unauction',
			args: [req.params.mrc402dexid, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address, req.params.mrc402dexid], []);
	}

	function post_mrc402_bid(req, res) {
		ParameterCheck(req.body, 'address', 'address');
		ParameterCheck(req.body, 'amount');
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402bid',
			args: [req.params.mrc402dexid, req.body.address, req.body.amount, req.body.signature, req.body.tkey]
		};
		JobProcess(request, res, tx_id, [req.body.address, req.params.mrc402dexid], []);
	}

	function get_mrc402_auctionfinish(req, res) {

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			chainId: config.channel_name,
			txId: tx_id,
			fcn: 'mrc402auctionfinish',
			args: [req.params.mrc402dexid]
		};
		JobProcess(request, res, tx_id, [req.body.seller, req.params.mrc402dexid], []);
	}

	// Routes setup
	app.get('/mrc402/:mrc402id', get_mrc402);
	app.get('/mrc402/dex/:mrc402dexid', get_mrc402_dex);
	app.post('/mrc402', post_mrc402);
	app.post('/mrc402/transfer/:mrc402id', post_mrc402_transfer);
	app.put('/mrc402/update/:mrc402id', put_mrc402);
	app.put('/mrc402/mint/:mrc402id', put_mrc402_mint);
	app.put('/mrc402/burn/:mrc402id', put_mrc402_burn);
	app.post('/mrc402/melt/:mrc402id', post_mrc402_melt);
	app.post('/mrc402/sell/:mrc402id', post_mrc402_sell);
	app.post('/mrc402/unsell/:mrc402dexid', post_mrc402_unsell);
	app.post('/mrc402/buy/:mrc402dexid', post_mrc402_buy);
	app.post('/mrc402/bid/:mrc402dexid', post_mrc402_bid);
	app.post('/mrc402/auction/:mrc402id', post_mrc402_auction);
	app.post('/mrc402/unauction/:mrc402dexid', post_mrc402_unauction);
	app.get('/mrc402/auctionfinish/:mrc402dexid', get_mrc402_auctionfinish);
};
