/* jshint esversion: 6 */
/* jshint node: true */
"use strict";


/*
 let connectionOptions = {
		identity: USER_ID,
		wallet: wallet,
		discovery: { enabled: false, asLocalhost: true },
		eventHandlerOptions: {
			 strategy: null
			 }
		 }

	await gateway.connect(connectionProfile, connectionOptions)
	https://stackoverflow.com/questions/56936560/why-do-i-take-more-than-2-seconds-to-just-do-a-transaction
*/
// init data.
const app_ver = "ver 2.1.1";
const app_title = "MetaCoin Bridge";
const listen_port = 20920;
const config = require('./config.json');

const { logger } = require('./src/utils/lib.winston')
const { errorHandler } = require('./src/utils/lib.express')

const addressRouter = require('./src/router/address');
const blockRouter = require('./src/router/block');

const mrc020Router = require('./src/router/mrc020');
const mrc030Router = require('./src/router/mrc030');
const mrc040Router = require('./src/router/mrc040');
const mrc100Router = require('./src/router/mrc100');
const mrc400Router = require('./src/router/mrc400');
const mrc402Router = require('./src/router/mrc402');
const mrc800Router = require('./src/router/mrc800');

const tokenRouter = require('./src/router/token');

const { ParameterCheck, isAddress, isNormalInteger, getRandomString } = require('./src/utils/lib')

// default handler.
process.stderr.write = function (str, encoding, fg) {
	if (str.indexOf("message: Failed to get block number") == -1 &&
		str.indexOf("message: Failed to get transaction with id") == -1 &&
		str.indexOf("Promise is rejected: Error: 2 UNKNOWN: chaincode error (status: 500, message: Key not exist)") == -1) {
		logger.error(str);
	}
}

process.on('unhandledRejection', error => {
	logger.error('=== UNHANDLED REJECTION ===');
	logger.error(error);
});

// default modules.
const path = require('path');
const http = require('http');

const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const md5 = require('md5');

const multer = require('multer'),
	upload = multer();


const Fabric_Client = require('fabric-client');
const { json } = require('body-parser');
const store_path = path.join(__dirname, 'hfc-key-store');


const FabricStatus_Connect = 50;
const FabricStatus_Wait = 10;
const FabricStatus_Idle = 0;

var JobManager = {
	pendingA: new Map(),
	count: 0,
	job: new Array(),
	waitBlock: false,
	waitJobProc: false,
	txCount: 0,
}

var FabricManager = {
	client: null,
	channel: null,
	peer: null,
	orderer: null,
	eventhub: null,
	status: 0,
	blockno: -1
}

function HyperLedgerConnect() {
	if (FabricManager.status != FabricStatus_Idle) {
		return;
	}
	FabricManager.status = FabricStatus_Wait;
	FabricManager.client = new Fabric_Client();
	FabricManager.channel = FabricManager.client.newChannel(config.channel_name);
	FabricManager.peer = FabricManager.client.newPeer(config.bind_peer_addr, {
		'pem': config.cert_peer_pem,
		'ssl-target-name-override': config.cert_peer_host
	});
	FabricManager.orderer = FabricManager.client.newOrderer(config.bind_orderer_addr, {
		'pem': config.cert_orderer_pem,
		'ssl-target-name-override': config.cert_orderer_host
	});

	FabricManager.channel.addPeer(FabricManager.peer);
	FabricManager.channel.addOrderer(FabricManager.orderer);

	Fabric_Client.newDefaultKeyValueStore({
		path: store_path
	}).then((state_store) => {
		FabricManager.client.setStateStore(state_store);
		var crypto_suite = Fabric_Client.newCryptoSuite();
		var crypto_store = Fabric_Client.newCryptoKeyStore({
			path: store_path
		});
		crypto_suite.setCryptoKeyStore(crypto_store);
		FabricManager.client.setCryptoSuite(crypto_suite);

		return FabricManager.client.getUserContext(config.user || 'user1', true);
	}).then(async (user_from_store) => {
		if (user_from_store && user_from_store.isEnrolled()) {

			FabricManager.eventhub = FabricManager.channel.newChannelEventHub(FabricManager.peer);
			FabricManager.eventhub.registerBlockEvent((block) => {
				FabricManager.blockno = parseInt(block.header.number);

				logger.info('BLOCK EVENT RECV', FabricManager.blockno)
				JobManager.pendingA.clear();
				JobManager.waitBlock = false;
				JobManager.count = 0;
			}, (error) => {
			});

			await FabricManager.eventhub.connect({
				full_block: true
			});

			FabricManager.status = FabricStatus_Connect;
			logger.info('HyperLedger Login Success');
		} else {
			throw new Error('HyperLedger Login fail');
		}
	}).catch(function (err) {
		logger.error(err);
		FabricManager.status = FabricStatus_Idle;
	});
}

function JobQueueCheck() {
	/*
	if (JobManager.waitBlock || JobManager.waitJobProc) {
		setTimeout(JobQueueCheck, 10);
		return;
	}
	*/
	if (JobManager.waitJobProc) {
		setTimeout(JobQueueCheck, 10);
		return;
	}

	while (JobManager.job.length > 0) {
		let job = JobManager.job.shift();
		if (job.length != 6) {
			continue;
		}
		if ((Date.now() - job[5]) > 5000) {
			job[1].json({
				result: 'ERROR',
				msg: 'Request job wait timeout',
				data: ''
			});
			continue;
		}
		JobProcess(job[0], job[1], job[2], job[3], job[4], job[5]);
		break;
	}
	setTimeout(JobQueueCheck, 10);
}

function JobProcess(req, res, tx_id, addresses, token, addTime) {
	addTime = addTime || Date.now();
	JobManager.waitJobProc = true
	try {
		let needPedning = false;
		let address;
		for (address of addresses) {
			if (JobManager.pendingA.has(address)) {
				needPedning = true;
				break;
			}
		}
		if (needPedning) {
			let cnt = 0;
			while (JobManager.count < 10) {
				let request = {
					chaincodeId: config.chain_code_id,
					fcn: 'dummy',
					args: ["" + cnt],
					chainId: config.channel_name,
					txId: FabricManager.client.newTransactionID()
				};
				JobManager.count++;
				InvokeDummy(request, request.txId);
				cnt++;
			}
			if (cnt > 0) {
				logger.info('TXProcess for DUMMY ', cnt, JobManager.count);
			}
			JobManager.job.splice(0, 0, [req, res, tx_id, addresses, token, addTime]);
			return;
		}

		for (address of addresses) {
			JobManager.pendingA.set(address, 1);
		}
		JobManager.count++;
		logger.info('Invoke POST', addresses[0], addresses[1], JobManager.count)
		InvokePost(req, res, tx_id, addresses, token);
	} finally {
		JobManager.waitJobProc = false
	}
}

function InvokeGet(request, res) {
	FabricManager.channel.queryByChaincode(request)
		.then((query_responses) => {
			if (query_responses && query_responses.length == 1) {
				if (query_responses[0] instanceof Error) {
					throw new Error(query_responses[0].toString());
				} else {
					res.json({
						result: 'SUCCESS',
						msg: '',
						data: query_responses[0].toString()
					});
				}
			} else {
				throw new Error('Response Error');
			}
		}).catch((err) => {
			if (request.fcn == "get" && request.args.length > 0) {
				res.json({
					result: 'ERROR',
					msg: request.args[0] + " not found",
					data: ''
				});
			} else {
				res.json({
					result: 'ERROR',
					msg: err.message,
					data: ''
				});
			}
		});
}

function InvokeDummy(request, tx_id) {
	FabricManager.channel.sendTransactionProposal(request)
		.then((results) => {
			if (results[0] && results[0][0].response &&
				results[0][0].response.status === 200) {
				let request = {
					proposalResponses: results[0],
					proposal: results[1]
				};
				try {
					return Promise.all([FabricManager.channel.sendTransaction(request)]);
				} catch (err) {
					return Promise.reject(err);
				}
			} else {
				return Promise.reject(new Error(results[0][0].details));
			}
		}).then((results) => {
			if (results && results[0] && results[0].status === 'SUCCESS') {
			} else {
			}
		}).catch((err) => {
		});
}


function InvokePost(request, res, tx_id, pending_addrs, pending_tokens) {
	FabricManager.channel.sendTransactionProposal(request)
		.then(function (results) {
			var proposalResponses = results[0];
			var proposal = results[1];

			if (proposalResponses && proposalResponses[0].response &&
				proposalResponses[0].response.status === 200) {
			} else {
				for (let address of pending_addrs) {
					JobManager.pendingA.delete(address);
				}
				logger.error('throw error ', proposalResponses[0].message)
				throw new Error(proposalResponses[0].message);
			}

			var request = {
				proposalResponses: proposalResponses,
				proposal: proposal
			};

			//Get the transaction ID string to be used by the event processing
			var transaction_id_string = tx_id.getTransactionID();
			var promises = [];
			try {
				var sendPromise = FabricManager.channel.sendTransaction(request);
				//we want the send transaction first, so that we know where to check status
				promises.push(sendPromise);
			} catch (err) {
				logger.error('send tx error')
				return reject(err);
			}

			let txPromise = new Promise((resolve, reject) => {
				let handle = setTimeout(() => {
					resolve({
						event_status: 'TIMEOUT'
					});
				}, 100000);
				FabricManager.eventhub.registerTxEvent(transaction_id_string, (tx, code) => {
					clearTimeout(handle);
					FabricManager.eventhub.unregisterTxEvent(transaction_id_string);
					var return_status = {
						event_status: code,
						tx_id: transaction_id_string
					};

					if (code !== 'VALID') {
						return reject(new Error('The transaction was invalid, code = ' + code));
					} else {
						return resolve(return_status);
					}
				}, (err) => {
					HyperLedgerConnect();
					return reject(new Error('There was a problem with the eventhub ::' + err));
				});
			});
			promises.push(txPromise);
			return Promise.all(promises);
		}).then(async function (results) {
			if (results && results[0] && results[0].status === 'SUCCESS') { } else {
				throw new Error('Failed to order the transaction.');
			}

			// GET new Generation ID
			if (results && results[1] && results[1].event_status === 'VALID') {
				if (res == null) {
					return;
				}

				let tx = await FabricManager.channel.queryTransaction(tx_id.getTransactionID(),
					FabricManager.peer, false, false);
				let tx_parse = parse_transaction(tx, null, null);
				switch (request.fcn) {
					case "newwallet":
						res.json({
							result: 'SUCCESS',
							msg: '',
							data: tx_parse[0].address,
							txid: tx_id.getTransactionID(),
							code: '0'
						});
						break;
					case "mrc020set":
						res.json({
							result: 'SUCCESS',
							msg: request.mrc020key,
							data: tx_id.getTransactionID(),
							txid: tx_id.getTransactionID(),
							code: '0'
						});
						break;
					case "mrc030create":
						res.json({
							result: 'SUCCESS',
							msg: request.mrc030key,
							data: tx_id.getTransactionID(),
							txid: tx_id.getTransactionID()
						});
						break;
					case "stodexRegister":
						res.json({
							result: 'SUCCESS',
							msg: request.mrc040key,
							data: tx_id.getTransactionID(),
							txid: tx_id.getTransactionID(),
							code: '0'
						});
						break;
					case "stodexExchange":
						res.json({
							result: 'SUCCESS',
							msg: request.mrc040key,
							data: tx_id.getTransactionID(),
							txid: tx_id.getTransactionID(),
							code: '0'
						});
						break;
					case "mrc100Log":
						res.json({
							result: 'SUCCESS',
							msg: request.mrc100logkey,
							data: tx_id.getTransactionID(),
							txid: tx_id.getTransactionID(),
							code: '0'
						});
						break;
					case "mrc010sell":
					case "mrc010reqsell":
					case "mrc402sell":
					case "mrc400create":
					case "mrc402create":
					case "mrc402auction":
						res.json({
							result: 'SUCCESS',
							msg: tx_parse[0].parameters[0],
							data: tx_id.getTransactionID(),
							txid: tx_id.getTransactionID(),
							code: '0'
						});
						break;
					default:
						res.json({
							result: 'SUCCESS',
							msg: '',
							data: tx_id.getTransactionID(),
							txid: tx_id.getTransactionID(),
							code: '0'
						});

				}
			} else {
				throw new Error('Transaction failed to be committed to the ledger due to ' + results[1].event_status);
			}

			// console.log(new Date().toLocaleString(), 482, 'InvokePost', tx_id.getTransactionID());
		}).catch(function (err) {
			logger.error(request.fcn, request.args, err.message);
			if (res == null) {
				return;
			}
			res.json({
				result: 'ERROR',
				msg: err.message,
				data: '',
				txid: '',
				code: '0'
			});
		});
}


function getHyperLedgerData(key) {
	let fnc = 'get';
	if (key.indexOf('MRC040_') == 0) {
		fnc = 'mrc040get';
	}
	return FabricManager.channel.queryByChaincode({
		chaincodeId: config.chain_code_id,
		fcn: fnc,
		args: [key]
	})
		.then((query_responses) => {
			if (query_responses && query_responses.length == 1) {
				if (query_responses[0] instanceof Error) {
					if (query_responses[0].code == 2) {
						throw new Error("Data not found");
					} else {
						throw new Error(query_responses[0].message);
					}
				} else {
					var j = JSON.parse(query_responses[0]);
					return j;
				}
			} else {
				throw new Error("Response Error");
			}
		});
}



function parse_transaction(transaction, db_id, db_sn) {
	var actlist = transaction.transactionEnvelope.payload.data.actions;
	var txsave_data = [];
	for (var act in actlist) {
		var rwsetlist = actlist[act].payload.action.proposal_response_payload.extension.results.ns_rwset;
		if (rwsetlist.length == 2 && rwsetlist[0].namespace == '_lifecycle' && rwsetlist[1].namespace == 'lscc') {
			if (txsave_data.length == 0) {
				txsave_data.push({
					timestamp: Math.floor(new Date(transaction.transactionEnvelope.payload.header.channel_header.timestamp).valueOf() / 1000),
					id: transaction.transactionEnvelope.payload.header.channel_header.tx_id,
					parameters: [],
					token: "",
					type: "Chaincode Install or Update",
					db_id: db_id,
					db_sn: db_sn
				});
			}
			continue;
		}

		for (var rwset in rwsetlist) {
			if (rwsetlist[rwset].namespace != 'metacoin') {
				continue;
			}
			for (var w in rwsetlist[rwset].rwset.writes) {
				if (rwsetlist[rwset].rwset.writes[w].key == 'MetaCoinICO') {
					continue;
				}
				if (rwsetlist[rwset].rwset.writes[w].key == 'Token_MAX_NO') {
					continue;
				}
				let params;
				let paramx;
				try {
					if (rwsetlist[rwset].rwset.writes[w].key.indexOf('MRC020_MT') == 0) {
						params = JSON.parse(rwsetlist[rwset].rwset.writes[w].value);
						paramx = [];
						if (params.is_open == 0) {
							params['publickey'] = '';
						}
					} else {
						params = JSON.parse(rwsetlist[rwset].rwset.writes[w].value);
						if (params.job_args == undefined) {
							continue;
						}
						if (params.job_type == 'MRC100LOG') {
							paramx = [rwsetlist[rwset].rwset.writes[w].key, params.token, params.logger, params.job_args, "", ""];
							delete (params.values);
						} else {
							paramx = JSON.parse(params.job_args);
							if (params.balance == undefined && params.token != undefined) {
								params.balance = params.token;
								delete (params.token);
							}
						}
					}
				} catch (err) {
					params = [];
					paramx = [];
				}
				var txv = {
					timestamp: Math.floor(new Date(transaction.transactionEnvelope.payload.header.channel_header.timestamp).valueOf() / 1000),
					id: transaction.transactionEnvelope.payload.header.channel_header.tx_id,
					parameters: paramx,
					token: params.token || '',
					type: params.job_type || '',
					values: params || '',
					validationCode: transaction.validationCode,
					address: '',
					datakey: rwsetlist[rwset].rwset.writes[w].key,
					db_id: db_id,
					db_sn: db_sn
				};
				if (txv.type == '') {
					continue;
				}

				var txv2 = {
					timestamp: Math.floor(new Date(transaction.transactionEnvelope.payload.header.channel_header.timestamp).valueOf() / 1000),
					id: transaction.transactionEnvelope.payload.header.channel_header.tx_id,
					parameters: paramx,
					token: params.token || '',
					type: params.job_type || '',
					values: params || '',
					validationCode: transaction.validationCode,
					address: '',
					datakey: rwsetlist[rwset].rwset.writes[w].key,
					db_id: db_id,
					db_sn: db_sn
				};

				if (isAddress(rwsetlist[rwset].rwset.writes[w].key)) {
					txv.address = rwsetlist[rwset].rwset.writes[w].key;
				}

				if (txv.type == 'exchangePair') {
					if (paramx[0] == paramx[12]) { // from == tofee
						txv2.type = 'exchange';
						txsave_data.push(txv2);
					}
				}
				if (txv.type == 'exchangeFee') {
					if (paramx[9] == paramx[3]) { // to == fromfee
						txv2.type = 'exchangePair';
						txsave_data.push(txv2);
					}
				}

				if (txv.type == 'exchangeFeePair') {
					if (paramx[3] == paramx[12]) {
						txv2.type = 'exchangeFee';
						txsave_data.push(txv2);
					}
				}
				txsave_data.push(txv);
			}
		}
	}
	txsave_data.reverse();
	return txsave_data;
}




// express handler.
app.use(function (req, res, next) {
	var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

	if (!req.url.startsWith("/block/")) {
		logger.info(ip.replace('::ffff:', ''), '\t', req.method, '\t', req.url);
	}
	if (FabricManager.status != FabricStatus_Connect) {
		res.status(503).json({
			result: 'ERROR',
			msg: 'Hyperledger connecting, please wait',
			data: ''
		});
		return;
	}
	res.header('Access-Control-Allow-Origin', '*');
	next();
});

app.use(bodyParser.json({
	limit: '50mb'
}));
app.use(bodyParser.urlencoded({
	limit: '50mb',
	extended: true
}));

function get_get(req, res, next) {
	const request = {
		chaincodeId: config.chain_code_id,
		fcn: 'get',
		args: [req.params.key]
	};
	InvokeGet(request, res);
}

function post_set(req, res, next) {
	res.header('Cache-Control', 'no-cache');
	var tx_id = FabricManager.client.newTransactionID();
	var request = {
		chaincodeId: config.chain_code_id,
		fcn: 'set',
		args: [req.params.key, req.body.data],
		chainId: config.channel_name,
		txId: tx_id
	};
	InvokePost(request, res, tx_id, [], []);
}
app.post('/set/:key', upload.array(), post_set);



function post_set(req, res, next) {
	res.header('Cache-Control', 'no-cache');
	var tx_id = FabricManager.client.newTransactionID();
	var request = {
		chaincodeId: config.chain_code_id,
		fcn: 'set',
		args: [req.params.key, req.body.data],
		chainId: config.channel_name,
		txId: tx_id
	};
	InvokePost(request, res, tx_id, [], []);
}
app.post('/set/:key', post_set);



// for ICO.
function post_buy(req, res, next) {
	ParameterCheck(req.body, "address", "address");
	ParameterCheck(req.body, "token_amount", 'int');
	ParameterCheck(req.body, "subcoin_amount", 'int');
	ParameterCheck(req.body, "bounty_address");
	ParameterCheck(req.body, "bounty_mtc");
	ParameterCheck(req.body, "bounty_subcoin");
	ParameterCheck(req.body, "bounty_buyer_mtc");
	ParameterCheck(req.body, "bounty_buyer_subcoin");
	ParameterCheck(req.body, "subcointype");
	var tx_id = FabricManager.client.newTransactionID();
	var request = {
		chaincodeId: config.chain_code_id,
		fcn: 'buy',
		args: [req.body.address, req.body.token_amount, req.body.subcoin_amount,
		req.body.bounty_address, req.body.bounty_mtc, req.body.bounty_subcoin,
		req.body.bounty_buyer_mtc, req.body.bounty_buyer_subcoin, req.body.subcointype
		],
		chainId: config.channel_name,
		txId: tx_id
	};
	InvokePost(request, res, tx_id, [], []);
}
app.post('/buy', post_buy);

addressRouter(app, config, FabricManager, InvokeGet, JobProcess);
blockRouter(app, config, FabricManager, InvokeGet, JobProcess);
mrc020Router(app, config, FabricManager, InvokeGet, JobProcess);
mrc030Router(app, config, FabricManager, InvokeGet, JobProcess);
mrc040Router(app, config, FabricManager, InvokeGet, JobProcess);
mrc100Router(app, config, FabricManager, InvokeGet, JobProcess);
mrc400Router(app, config, FabricManager, InvokeGet, JobProcess);
mrc402Router(app, config, FabricManager, InvokeGet, JobProcess);
mrc800Router(app, config, FabricManager, InvokeGet, JobProcess);

tokenRouter(app, config, FabricManager, InvokeGet, JobProcess);
// create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
// App init.


// error handler
app.use(errorHandler);

try {
	HyperLedgerConnect();
	app.listen(listen_port, () => {
		logger.info('%s %s listening on port %d', app_title, app_ver, listen_port);

	});
	setTimeout(JobQueueCheck, 10);
} catch (err) {
	logger.error(err)
	logger.error('%s %s port %d bind error', app_title, app_ver, listen_port);
}