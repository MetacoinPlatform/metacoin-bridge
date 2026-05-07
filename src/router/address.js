/* jshint esversion: 6 */
/* jshint node: true */
"use strict";

const { ParameterCheck } = require('../utils/lib')

module.exports = function (app, config, FabricManager, InvokeGet, JobProcess) {


	function get_address(req, res, next) {
		if (isAddress(req.params.address) == false) {
			res.json({
				result: 'ERROR',
				msg: 'Invalid Address',
				data: ''
			});
		}
		res.header('Cache-Control', 'no-cache');
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'get',
			args: [req.params.address]
		};
		InvokeGet(request, res);
	}

	function get_nonce(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.params, 'address');
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'getNonce',
			args: [req.params.address]
		};
		InvokeGet(request, res);
	}



	function post_address(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.body, "publickey");

		if (req.body.addinfo === undefined) {
			req.body.addinfo = '';
		}

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'newwallet',
			args: [req.body.publickey, req.body.addinfo],
			chainId: config.channel_name,
			txId: tx_id
		};
		InvokePost(request, res, tx_id, [], []);
	}


	// not chain code & internal
	app.get('/getkey/:keytype/:address', get_nonce);
	app.get('/nonce/:address', get_nonce);

	// wallet
	app.get('/address/:address', get_address);
	app.post('/address', post_address);
};
