/* jshint esversion: 6 */
/* jshint node: true */
"use strict";

const { ParameterCheck } = require('../utils/lib')

module.exports = function (app, config, FabricManager, InvokeGet, JobProcess) {

	function get_mrc030(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc030get',
			args: [req.params.mrc030key]
		};
		InvokeGet(request, res);
	}

	function get_mrc031(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc031get',
			args: [req.params.mrc030key]
		};
		InvokeGet(request, res);
	}

	function get_mrc030_finish(req, res, next) {
		res.header('Cache-Control', 'no-cache');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc030finish',
			args: [req.params.mrc030key],
			chainId: config.channel_name,
			txId: tx_id,
		};
		JobProcess(request, res, tx_id, [req.body.owner, req.params.mrc030key], [], 0);
	}


	function post_mrc030(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.body, 'owner', "address");
		ParameterCheck(req.body, 'title', "", false, 1, 256);
		ParameterCheck(req.body, 'description', "", false, 0, 2048);
		ParameterCheck(req.body, 'startdate', "int");
		ParameterCheck(req.body, 'enddate', "int");
		ParameterCheck(req.body, 'reward', "int", false, 1, 50);
		ParameterCheck(req.body, 'rewardtoken', "int", false, 1, 50);
		ParameterCheck(req.body, 'maxrewardrecipient', "int", false, 1, 50);
		ParameterCheck(req.body, 'rewardtype');
		ParameterCheck(req.body, 'url', "url");
		ParameterCheck(req.body, 'query');
		ParameterCheck(req.body, 'sign_need', "string", true);
		ParameterCheck(req.body, 'signature');
		ParameterCheck(req.body, 'tkey');


		let mrc030key = "MRC030_" + getRandomString(33)
		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc030create',
			args: [req.body.owner, mrc030key, req.body.title, req.body.description, req.body.startdate, req.body.enddate, req.body.reward, req.body.rewardtoken, req.body.maxrewardrecipient, req.body.rewardtype, req.body.url, req.body.query, req.body.sign_need, req.body.signature, req.body.tkey],
			chainId: config.channel_name,
			txId: tx_id,
			mrc030key: mrc030key
		};
		JobProcess(request, res, tx_id, [req.body.owner], []);
	}



	function post_mrc030_join(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.body, "mrc030id");
		ParameterCheck(req.body, 'voter', "address");
		ParameterCheck(req.body, 'answer');
		ParameterCheck(req.body, 'voteCreatorSign', 'string', true);
		ParameterCheck(req.body, 'signature');

		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc030join',
			args: [req.body.mrc030id, req.body.voter, req.body.answer, req.body.voteCreatorSign, req.body.signature],
			chainId: config.channel_name,
			txId: tx_id
		};
		JobProcess(request, res, tx_id, [req.body.voter, req.body.mrc030id], []);
	}


	// Routes setup
	app.get('/mrc030/:mrc030key', get_mrc030);
	app.get('/mrc030/finish/:mrc030key', get_mrc030_finish);
	app.post('/mrc030', post_mrc030);
	app.post('/mrc030/:mrc030key', post_mrc030_join);
	app.get('/mrc031/:mrc031key', get_mrc031);


};
