/* jshint esversion: 6 */
/* jshint node: true */
"use strict";

const { ParameterCheck } = require('../utils/lib')

module.exports = function (app, config, FabricManager, InvokeGet, JobProcess) {

	function get_block(req, res, next) {
		if (req.params.block_no == undefined || req.params.block_no.length == 0) {
			return next(new Error("Parameter block_no missing"));
		}
		let block_no;
		try {
			block_no = parseInt(req.params.block_no);
		} catch (err) {
			return next(new Error("Parameter block_no is not integer"));
		}

		if (block_no < 1) {
			return next(new Error("Parameter block_no 1 or higher"));
		}

		if (FabricManager.blockno > 0 && block_no > FabricManager.blockno) {
			res.json({
				result: 'ERROR',
				msg: '',
				data: 'chaincode error (status: 500, message: Failed to get block number ' + block_no + ', error Entry not found in index)'
			});
			return;
		}

		FabricManager.channel.queryBlock(block_no, FabricManager.peer, false, false)
			.then(function (block) {
				if (typeof block == typeof "" && block != "") {
					res.json({
						result: 'SUCCESS',
						msg: '',
						data: JSON.parse(block)
					});
					return;
				}
				var db_data = {
					id: block.header.data_hash,
					sn: block.header.number,
					transaction: [],
					timestamp: Math.floor(new Date(block.data.data[0].payload.header.channel_header.timestamp).valueOf() / 1000)
				};

				let Promise_list = new Array();
				for (var act in block.data.data) {
					Promise_list.push(FabricManager.channel.queryTransaction(block.data.data[act].payload.header.channel_header.tx_id, FabricManager.peer, false, false)
						.then(function (transaction) {
							return Promise.resolve(parse_transaction(transaction, db_data.id, db_data.sn));
						})
						.catch(function (err) {
							return Promise.resolve("");
						}));
				}
				Promise.all(Promise_list)
					.then(function (tx_list) {
						let dummy_cnt = 0;
						for (var idx in tx_list) {
							try {
								if (tx_list[idx].length == 0 || !tx_list[idx][0].hasOwnProperty("type") || tx_list[idx][0].type == '') {
									dummy_cnt = dummy_cnt + 1;
									continue;
								}
							} catch (err) {
								dummy_cnt = dummy_cnt + 1;
								continue;
							}
							db_data.transaction.push({
								id: tx_list[idx][0].id,
								timestamp: tx_list[idx][0].timestamp
							});
						}
						// console.log(new Date().toLocaleString(), 556, 'dummy count,', dummy_cnt, ', tx count', db_data.transaction.length);
						res.json({
							result: 'SUCCESS',
							msg: '',
							data: db_data
						});
					});
			})
			.catch(function (err) {
				if (FabricManager.blockno > block_no) {
					if (err.message.indexOf('error Entry not found in index') > 0) {
						FabricManager.blockno = block_no - 1;
					}
				}
				res.json({
					result: 'ERROR',
					msg: '',
					data: err.message
				});
			});
	}


	function get_transaction(req, res, next) {
		let blockInfo;
		FabricManager.channel.queryBlockByTxID(req.params.transaction_id, FabricManager.peer, false, false)
			.then(function (block) {
				blockInfo = block;
				return FabricManager.channel.queryTransaction(req.params.transaction_id, FabricManager.peer, false, false);
			})
			.then(function (tx_data) {
				if (typeof tx_data == typeof "" && tx_data != "") {
					res.json({
						result: 'SUCCESS',
						msg: '',
						data: JSON.parse(tx_data)
					});
				} else {
					let tx_save_data = parse_transaction(tx_data, blockInfo.header.data_hash, blockInfo.header.number);
					res.json({
						result: 'SUCCESS',
						msg: '',
						data: tx_save_data
					});
				}
			})
			.catch(function (err) {
				res.json({
					result: 'ERROR',
					msg: err.message,
					data: ''
				});
			});

	}


	function getBlockbyTX(req, res, next) {
		FabricManager.channel.queryBlockByTxID(req.params.transaction_id, FabricManager.peer, false, false)
			.then(function (block) {
				res.json({ result: 'SUCCESS', msg: '', data: block.header })
			})
			.catch(function (err) {
				res.json({ result: 'ERROR', msg: err.message, data: '' });
			});;
	}

	function getTxRaw(req, res, next) {
		let blockInfo;
		FabricManager.channel.queryBlockByTxID(req.params.transaction_id, FabricManager.peer, false, false)
			.then(function (block) {
				blockInfo = block;
				return FabricManager.channel.queryTransaction(req.params.transaction_id, FabricManager.peer, false, false)
					.then(function (transaction) {
						var actlist = transaction.transactionEnvelope.payload.data.actions;
						var txsave_data = [];
						for (var act in actlist) {
							var rwsetlist = actlist[act].payload.action.proposal_response_payload.extension.results.ns_rwset;
							for (var rwset in rwsetlist) {
								if (rwsetlist.length == 1 && rwsetlist[rwset].namespace == 'lscc') {
									continue;
								}
								for (var w in rwsetlist[rwset].rwset.writes) {
									if (rwsetlist[rwset].rwset.writes[w].key == 'MetaCoinICO') {
										continue;
									}
									txsave_data.push({
										db_id: blockInfo.header.data_hash,
										db_sn: blockInfo.header.number,
										data: rwsetlist[rwset].rwset.writes[w].value,
										validationCode: transaction.validationCode,
										datakey: rwsetlist[rwset].rwset.writes[w].key
									});
									console.log(txsave_data);
								}
							}
						}
						txsave_data.reverse();
						res.json({ result: 'SUCCESS', msg: '', data: txsave_data });
					})
					.catch(function (err) {
						res.json({ result: 'ERROR', msg: err.message, data: '' });
					});
			});

	};

	// not chain code.
	app.get('/block/:block_no', get_block);
	app.get('/transaction/:transaction_id', get_transaction)
	app.get('/blockByTX/:transaction_id', getBlockbyTX)
	app.get('/transactionraw/:transaction_id', getTxRaw)
}
