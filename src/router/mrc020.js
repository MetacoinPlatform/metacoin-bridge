/* jshint esversion: 6 */
/* jshint node: true */
"use strict";

const { ParameterCheck } = require('../utils/lib')

module.exports = function (app, config, FabricManager, InvokeGet, JobProcess) {
	function get_mrc020(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		const request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc020get',
			args: [req.params.mrc020key]
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

	function post_mrc020(req, res, next) {
		res.header('Cache-Control', 'no-cache');
		ParameterCheck(req.body, 'owner', "address");
		ParameterCheck(req.body, 'algorithm', "", true, 0, 64);
		ParameterCheck(req.body, 'data', "", false, 1, 2048);
		ParameterCheck(req.body, 'publickey');
		ParameterCheck(req.body, 'opendate');
		ParameterCheck(req.body, 'referencekey', "", true, 0, 64);
		ParameterCheck(req.body, 'signature');

		if (/[^a-zA-Z0-9_]/.test(req.body.referencekey)) {
			res.json({
				result: 'ERROR',
				msg: 'Reference key is a-z, A-Z, 0-9 only',
				data: ''
			});
			return;
		}

		let now = Math.round(new Date().getTime() / 1000);
		let opendate = parseInt(req.body.opendate);
		if (opendate == NaN) {
			res.json({
				result: 'ERROR',
				msg: 'The opendate value is not unix timesamp'
			});
			return;
		}

		if ((opendate - now) <= 0) {
			res.json({
				result: 'ERROR',
				msg: 'The opendate value is not a future'
			});
			return;
		}

		if ((opendate - now) > 3600) {
			res.json({
				result: 'ERROR',
				msg: 'The opendate value is not within one hour.'
			});
			return;
		}

		let mrc020key = "MRC020_" + req.body.owner + "_" + req.body.referencekey;
		var tx_id = FabricManager.client.newTransactionID();
		var request = {
			chaincodeId: config.chain_code_id,
			fcn: 'mrc020',
			args: [req.body.owner, req.body.algorithm, req.body.data, req.body.publickey, req.body.opendate, req.body.referencekey, req.body.signature],
			chainId: config.channel_name,
			txId: tx_id,
			mrc020key: mrc020key
		};
		InvokePost(request, res, tx_id, [], []);
	}

	// Routes setup
	app.get('/mrc020/:mrc020key', get_mrc020);
	app.post('/mrc020', post_mrc020);

};
