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
const mtcUtil = require("./mtcUtil");

// program start banner
console.log(new Date().toLocaleString(), app_title + " " + app_ver);

// default handler.
process.stderr.write = function (str, encoding, fg) {
    if (str.indexOf("message: Failed to get block number") == -1 &&
        str.indexOf("message: Failed to get transaction with id") == -1 &&
        str.indexOf("Promise is rejected: Error: 2 UNKNOWN: chaincode error (status: 500, message: Key not exist)") == -1) {
        console.log(new Date().toLocaleString(), str);
    }
}

process.on('unhandledRejection', error => {
    console.log(new Date().toLocaleString(), '=== UNHANDLED REJECTION ===');
    console.log(new Date().toLocaleString(), error);
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

const {
    crc32
} = require('crc');
const Redis = require("ioredis"),
    redis = new Redis(config.redis_server);

const Fabric_Client = require('fabric-client');
const store_path = path.join(__dirname, 'hfc-key-store');


// express handler.
app.use(function (req, res, next) {
    var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    if (!req.url.startsWith("/block/")) {
        console.log(new Date().toLocaleString(), ip.replace('::ffff:', ''), '\t', req.method, '\t', req.url);
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

                console.log(new Date().toLocaleString(), 'BLOCK EVENT RECV', FabricManager.blockno)
                JobManager.pendingA.clear();
                JobManager.waitBlock = false;
                JobManager.count = 0;
            }, (error) => {
            });

            await FabricManager.eventhub.connect({
                full_block: true
            });

            FabricManager.status = FabricStatus_Connect;
            console.log(new Date().toLocaleString(), 'HyperLedger Login Success');
        } else {
            throw new Error('HyperLedger Login fail');
        }
    }).catch(function (err) {
        console.log(new Date().toLocaleString(), 162, err);
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
                // console.log('address dupe ', address)
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
                console.log('TXProcess for DUMMY ', cnt, JobManager.count);
            }
            JobManager.job.splice(0, 0, [req, res, tx_id, addresses, token, addTime]);
            return;
        }

        for (address of addresses) {
            JobManager.pendingA.set(address, 1);
        }
        JobManager.count++;
        console.log('Invoke POST', addresses[0], addresses[1], JobManager.count)
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
            res.json({
                result: 'ERROR',
                msg: err.message,
                data: ''
            });
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
                console.log('throw error ', proposalResponses[0].message)
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
                console.log(new Date().toLocaleString(), 391, 'send tx error');
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
            console.log('TX EVENT RECV')
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
                let tx_parse = parse_transaction(tx);
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
            console.log(new Date().toLocaleString(), 482, request.fcn, request.args, err.message);
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



function parse_transaction(transaction) {
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
                    type: "Chaincode Install or Update"
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
                    datakey: rwsetlist[rwset].rwset.writes[w].key
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
                    datakey: rwsetlist[rwset].rwset.writes[w].key
                };

                if (mtcUtil.isAddress(rwsetlist[rwset].rwset.writes[w].key)) {
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
            console.log('query block result');
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
                        return Promise.resolve(parse_transaction(transaction));
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
                        redis.set("TX_" + tx_list[idx][0].id, JSON.stringify(tx_list[idx]), "EX", 600);
                        db_data.transaction.push({
                            id: tx_list[idx][0].id,
                            timestamp: tx_list[idx][0].timestamp
                        });
                    }
                    console.log(new Date().toLocaleString(), 556, 'dummy count,', dummy_cnt, ', tx count', db_data.transaction.length);
                    redis.set("BLOCK_" + block_no, JSON.stringify(db_data), "EX", 600);
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


app.get('/transactionraw/:transaction_id', (req, res) => {
    FabricManager.channel.queryTransaction(req.params.transaction_id, FabricManager.peer, false, false)
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
                        console.log(rwsetlist[rwset].rwset.writes[w].key);
                        txsave_data.push({
                            data: rwsetlist[rwset].rwset.writes[w].value,
                            validationCode: transaction.validationCode,
                            datakey: rwsetlist[rwset].rwset.writes[w].key
                        });
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


function get_transaction(req, res, next) {
    redis.get("TX_" + req.params.transaction_id)
        .then(function (value) {
            if (value != null && value) {
                return Promise.resolve(value);
            } else {
                return FabricManager.channel.queryTransaction(req.params.transaction_id, FabricManager.peer, false, false);
            }
        })
        .catch(function (err) {
            return Promise.reject(err);
        })

        .then(function (tx_data) {
            if (typeof tx_data == typeof "" && tx_data != "") {
                res.json({
                    result: 'SUCCESS',
                    msg: '',
                    data: JSON.parse(tx_data)
                });
            } else {
                let tx_save_data = parse_transaction(tx_data);
                redis.set("TX_" + req.params.transaction_id, JSON.stringify(tx_save_data), "EX", 600);
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

function get_address(req, res, next) {
    if (mtcUtil.isAddress(req.params.address) == false) {
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
    mtcUtil.ParameterCheck(req.params, 'address');
    const request = {
        chaincodeId: config.chain_code_id,
        fcn: 'getNonce',
        args: [req.params.address]
    };
    InvokeGet(request, res);
}


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
    mtcUtil.ParameterCheck(req.body, 'owner', "address");
    mtcUtil.ParameterCheck(req.body, 'title', "", false, 1, 256);
    mtcUtil.ParameterCheck(req.body, 'description', "", false, 0, 2048);
    mtcUtil.ParameterCheck(req.body, 'startdate', "int");
    mtcUtil.ParameterCheck(req.body, 'enddate', "int");
    mtcUtil.ParameterCheck(req.body, 'reward', "int", false, 1, 50);
    mtcUtil.ParameterCheck(req.body, 'rewardtoken', "int", false, 1, 50);
    mtcUtil.ParameterCheck(req.body, 'maxrewardrecipient', "int", false, 1, 50);
    mtcUtil.ParameterCheck(req.body, 'rewardtype');
    mtcUtil.ParameterCheck(req.body, 'url', "url");
    mtcUtil.ParameterCheck(req.body, 'query');
    mtcUtil.ParameterCheck(req.body, 'sign_need', "string", true);
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');


    let mrc030key = "MRC030_" + mtcUtil.getRandomString(33)
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
    mtcUtil.ParameterCheck(req.body, "mrc030id");
    mtcUtil.ParameterCheck(req.body, 'voter', "address");
    mtcUtil.ParameterCheck(req.body, 'answer');
    mtcUtil.ParameterCheck(req.body, 'voteCreatorSign', 'string', true);
    mtcUtil.ParameterCheck(req.body, 'signature');

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



function get_token(req, res, next) {
    mtcUtil.ParameterCheck(req.params, "token");
    const request = {
        chaincodeId: config.chain_code_id,
        fcn: 'get',
        args: ['TOKEN_DATA_' + req.params.token]
    };
    InvokeGet(request, res);
}


function post_address(req, res, next) {
    res.header('Cache-Control', 'no-cache');
    mtcUtil.ParameterCheck(req.body, "publickey");

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


function post_buy(req, res, next) {
    mtcUtil.ParameterCheck(req.body, "address", "address");
    mtcUtil.ParameterCheck(req.body, "token_amount", 'int');
    mtcUtil.ParameterCheck(req.body, "subcoin_amount", 'int');
    mtcUtil.ParameterCheck(req.body, "bounty_address");
    mtcUtil.ParameterCheck(req.body, "bounty_mtc");
    mtcUtil.ParameterCheck(req.body, "bounty_subcoin");
    mtcUtil.ParameterCheck(req.body, "bounty_buyer_mtc");
    mtcUtil.ParameterCheck(req.body, "bounty_buyer_subcoin");
    mtcUtil.ParameterCheck(req.body, "subcointype");
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


function post_transfer(req, res, next) {
    res.header('Cache-Control', 'no-cache');
    var data = "";
    // req.body.unlockdate = "0";
    mtcUtil.ParameterCheck(req.body, 'from', "address");
    mtcUtil.ParameterCheck(req.body, 'to', "address");
    mtcUtil.ParameterCheck(req.body, 'token', "int");
    mtcUtil.ParameterCheck(req.body, 'amount', 'int', false, 1, 99);
    mtcUtil.ParameterCheck(req.body, 'checkkey');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'unlockdate', "int");

    if (req.body.from == req.body.to) {
        return next(new Error('The from address and to addressare the same.'));
    }

    if (req.body.tags === undefined) {
        req.body.tags = '';
    }

    if (req.body.memo === undefined) {
        req.body.memo = '';
    }

    req.body.tags = req.body.tags.substr(0, 64);
    req.body.memo = req.body.memo.substr(0, 2048);

    var tx_id = FabricManager.client.newTransactionID();
    var request = {
        chaincodeId: config.chain_code_id,
        fcn: 'transfer',
        args: [req.body.from, req.body.to, req.body.amount, req.body.token, req.body.signature, req.body.unlockdate, req.body.tags, req.body.memo, req.body.checkkey],
        chainId: config.channel_name,
        txId: tx_id
    };
    JobProcess(request, res, tx_id, [req.body.from, req.body.to], [], 0);
}


function post_multitransfer(req, res, next) {
    res.header('Cache-Control', 'no-cache');
    var data = "";
    // req.body.unlockdate = "0";
    mtcUtil.ParameterCheck(req.body, 'from', "address");
    mtcUtil.ParameterCheck(req.body, 'transferlist');
    mtcUtil.ParameterCheck(req.body, 'token', "int");
    mtcUtil.ParameterCheck(req.body, 'checkkey');
    mtcUtil.ParameterCheck(req.body, 'signature');

    try {
        data = JSON.parse(req.body.transferlist);
    } catch (e) {
        return next(new Error('The transferlist must be a json encoded array'));
    }

    if (Array.isArray(data) == false) {
        return next(new Error('The transferlist must be a json encoded array'));
    }
    if (data.length > 100) {
        return next(new Error('There must be no more than 100 recipients of multitransfer'));
    }

    let AddrList = [];
    for (var key in data) {
        mtcUtil.ParameterCheck(data[key], 'address', "address");
        mtcUtil.ParameterCheck(data[key], 'amount', 'int', false, 1, 99);
        mtcUtil.ParameterCheck(data[key], 'unlockdate', 'int');

        if (req.body.from == data[key].address) {
            return next(new Error('The from address and to addressare the same.'));
        }
        AddrList.push(data[key].address);
    }
    AddrList.push(req.body.from);

    var tx_id = FabricManager.client.newTransactionID();
    var request = {
        chaincodeId: config.chain_code_id,
        fcn: 'multitransfer',
        args: [req.body.from, req.body.transferlist, req.body.token, req.body.signature, req.body.checkkey],
        chainId: config.channel_name,
        txId: tx_id
    };
    JobProcess(request, res, tx_id, AddrList, [], 0);
}


function post_exchange(req, res, next) {
    res.header('Cache-Control', 'no-cache');
    mtcUtil.ParameterCheck(req.body, 'fromAddr', "address");
    mtcUtil.ParameterCheck(req.body, 'fromAmount', 'int');
    mtcUtil.ParameterCheck(req.body, 'fromToken');
    mtcUtil.ParameterCheck(req.body, 'fromFeesendto');
    mtcUtil.ParameterCheck(req.body, 'fromFeeamount', 'int');
    mtcUtil.ParameterCheck(req.body, 'fromFeetoken');
    mtcUtil.ParameterCheck(req.body, 'fromTag', 'string', true, 0, 64);
    mtcUtil.ParameterCheck(req.body, 'fromMemo', 'string', true, 0, 2048);
    mtcUtil.ParameterCheck(req.body, 'fromSign');
    mtcUtil.ParameterCheck(req.params, 'fromTkey');
    mtcUtil.ParameterCheck(req.body, 'toAddr', "address");
    mtcUtil.ParameterCheck(req.body, 'toAmount', 'int');
    mtcUtil.ParameterCheck(req.body, 'toToken');
    mtcUtil.ParameterCheck(req.body, 'toFeesendto');
    mtcUtil.ParameterCheck(req.body, 'toFeeamount', 'int');
    mtcUtil.ParameterCheck(req.body, 'toFeetoken');
    mtcUtil.ParameterCheck(req.body, 'toTag', 'string', true, 0, 64);
    mtcUtil.ParameterCheck(req.body, 'toMemo', 'string', true, 0, 2048);
    mtcUtil.ParameterCheck(req.body, 'toSign');
    mtcUtil.ParameterCheck(req.params, 'toTkey');

    if (req.body.fromAddr == req.body.toAddr) {
        return next(new Error('The from address and to address are the same.'));
    }

    var tx_id = FabricManager.client.newTransactionID();
    var request = {
        chaincodeId: config.chain_code_id,
        fcn: 'exchange',
        args: [req.body.fromAddr, req.body.fromAmount, req.body.fromToken, req.body.fromFeesendto, req.body.fromFeeamount, req.body.fromFeetoken,
        req.body.fromTag, req.body.fromMemo, req.body.fromSign,
        req.body.toAddr, req.body.toAmount, req.body.toToken, req.body.toFeesendto, req.body.toFeeamount, req.body.toFeetoken,
        req.body.toTag, req.body.toMemo, req.body.toSign,
        req.params.fromTkey, req.params.toTkey,
        ],
        chainId: config.channel_name,
        txId: tx_id
    };
    JobProcess(request, res, tx_id, [req.body.fromAddr, req.body.toAddr, req.body.fromFeesendto, req.body.toFeesendto], [], 0);

}


function post_mrc020(req, res, next) {
    res.header('Cache-Control', 'no-cache');
    mtcUtil.ParameterCheck(req.body, 'owner', "address");
    mtcUtil.ParameterCheck(req.body, 'algorithm', "", true, 0, 64);
    mtcUtil.ParameterCheck(req.body, 'data', "", false, 1, 2048);
    mtcUtil.ParameterCheck(req.body, 'publickey');
    mtcUtil.ParameterCheck(req.body, 'opendate');
    mtcUtil.ParameterCheck(req.body, 'referencekey', "", true, 0, 64);
    mtcUtil.ParameterCheck(req.body, 'signature');

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


function post_mrc040_cancel(req, res, next) {
    res.header('Cache-Control', 'no-cache');
    mtcUtil.ParameterCheck(req.params, 'tkey');
    mtcUtil.ParameterCheck(req.body, 'owner', "address");
    mtcUtil.ParameterCheck(req.body, 'mrc040id');
    mtcUtil.ParameterCheck(req.body, 'signature');

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
    mtcUtil.ParameterCheck(req.params, 'tkey');
    mtcUtil.ParameterCheck(req.body, 'owner', "address");
    mtcUtil.ParameterCheck(req.body, 'side');
    mtcUtil.ParameterCheck(req.body, 'basetoken');
    mtcUtil.ParameterCheck(req.body, 'targettoken');
    mtcUtil.ParameterCheck(req.body, 'price', 'int');
    mtcUtil.ParameterCheck(req.body, 'qtt', 'int');
    mtcUtil.ParameterCheck(req.body, 'signature');

    let now = Math.round(new Date().getTime() / 1000);
    let MRC040KEY = "MRC040_" + mtcUtil.getRandomString(40) + "_" + now;
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
    mtcUtil.ParameterCheck(req.params, 'tkey');
    mtcUtil.ParameterCheck(req.body, 'requester');
    mtcUtil.ParameterCheck(req.body, 'mrc040id');
    mtcUtil.ParameterCheck(req.body, 'qtt', "int");
    mtcUtil.ParameterCheck(req.body, 'signature');
    getHyperLedgerData(req.body.mrc040id)
        .then((mrc040_item) => {
            let tx_id = FabricManager.client.newTransactionID();
            let now = Math.round(new Date().getTime() / 1000);
            let MRC040KEY = "MRC040_" + mtcUtil.getRandomString(40) + "_" + now;
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


function post_token(req, res, next) {
    res.header('Cache-Control', 'no-cache');
    mtcUtil.ParameterCheck(req.body, 'symbol');
    mtcUtil.ParameterCheck(req.body, 'totalsupply', "int");
    mtcUtil.ParameterCheck(req.body, 'decimal', "int");
    mtcUtil.ParameterCheck(req.body, 'name');
    mtcUtil.ParameterCheck(req.body, 'owner');
    if (!Number(req.body.totalsupply)) {
        return next(new Error('totalsupply must be number'));
    }
    if (Number(req.body.totalsupply) < 1) {
        return next(new Error('totalsupply must be bigger then 0'));
    }

    let d = parseInt(req.body.decimal);
    if (req.body.totalsupply.length - d > 30) {
        return next(new Error('totalsupply must be less then 1e30 (without decimals(precision))'));
    }

    if (typeof req.body.tier == typeof []) {
        req.body.tier.forEach(function (tier) {
            tier.startdate = parseInt(tier.startdate);
            tier.enddate = parseInt(tier.enddate);
            if (tier.rate === undefined || tier.rate == '') {
                return next(new Error('Tier rate not defined'));
            }
            tier.rate = parseInt(tier.rate);
            tier.tiersn = parseInt(tier.tiersn);
            tier.unlockdate = parseInt(tier.unlockdate);
        });
    } else {
        req.body.tier = [];
    }
    if (typeof req.body.reserve == typeof []) {
        req.body.reserve.forEach(function (reserve) {
            reserve.unlockdate = parseInt(reserve.unlockdate);
            if (!mtcUtil.isNormalInteger(reserve.value)) {
                return next(new Error('value must be number'));
            }
        });
    } else {
        req.body.reserve = [];
    }

    const request = {
        chaincodeId: config.chain_code_id,
        fcn: 'getNonce',
        args: [req.body.owner]
    };

    FabricManager.channel.queryByChaincode(request)
        .then((query_responses) => {
            if (query_responses && query_responses.length == 1) {
                if (query_responses[0] instanceof Error) {
                    throw new Error(query_responses[0].toString());
                } else {
                    req.body.decimal = parseInt(req.body.decimal);
                    redis.set('TKEY_TOKEN_' + query_responses[0].toString(), JSON.stringify(req.body), 'EX', 3600, function (err) {
                        if (err == null) {
                            res.json({
                                result: 'SUCCESS',
                                msg: '',
                                data: query_responses[0].toString()
                            });
                        }
                    });
                }
            } else {
                throw new Error('Response Error');
            }
        }).catch((err) => {
            res.json({
                result: 'ERROR',
                msg: err.message,
                data: ''
            });
        });

}

function post_token_tkey(req, res, next) {
    res.header('Cache-Control', 'no-cache');
    mtcUtil.ParameterCheck(req.params, "tkey");
    mtcUtil.ParameterCheck(req.body, "signature");

    redis.get('TKEY_TOKEN_' + req.params.tkey)
        .then(function (value) {
            if (value == null || value == '') {
                return next(new Error("Token information not found or invalid key"));
            }

            var token_data = JSON.parse(value);
            if (token_data.type != '010') {
                token_data.type = '010'
            }

            redis.del('TKEY_TOKEN_' + req.params.tkey, function (err, reply) { });
            var tx_id = FabricManager.client.newTransactionID();
            var request = {
                chaincodeId: config.chain_code_id,
                fcn: 'tokenRegister',
                args: [value, req.body.signature, req.params.tkey],
                chainId: config.channel_name,
                txId: tx_id
            };
            InvokePost(request, res, tx_id, [], []);
        })
        .catch(function (err) {
            if (err != null) {
                res.json({
                    result: 'ERROR',
                    msg: err.toString(),
                    data: ""
                });
                return;
            }
        });
}


function post_tokenupdate_tokenbase(req, res, next) {
    res.header('Cache-Control', 'no-cache');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.params, 'tkey');
    mtcUtil.ParameterCheck(req.params, 'token');
    mtcUtil.ParameterCheck(req.params, 'baseToken');

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
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.params, 'tkey');
    mtcUtil.ParameterCheck(req.params, 'token');
    mtcUtil.ParameterCheck(req.params, 'targetToken');

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
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.params, 'tkey');
    mtcUtil.ParameterCheck(req.params, 'token');
    mtcUtil.ParameterCheck(req.params, 'targetToken');


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


function put_token(req, res, next) {
    res.header('Cache-Control', 'no-cache');
    mtcUtil.ParameterCheck(req.body, 'token');
    mtcUtil.ParameterCheck(req.body, 'url');
    mtcUtil.ParameterCheck(req.body, 'info');
    mtcUtil.ParameterCheck(req.body, 'image');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.params, 'tkey');

    var tx_id = FabricManager.client.newTransactionID();
    var request = {
        chaincodeId: config.chain_code_id,
        fcn: 'tokenUpdate',
        args: [req.body.token, req.body.url, req.body.info, req.body.image, req.body.signature, req.params.tkey],
        chainId: config.channel_name,
        txId: tx_id
    };
    JobProcess(request, res, tx_id, [], [req.body.token]);

}


function post_token_burn(req, res, next) {
    res.header('Cache-Control', 'no-cache');
    mtcUtil.ParameterCheck(req.body, 'token');
    mtcUtil.ParameterCheck(req.body, 'amount', 'int');
    mtcUtil.ParameterCheck(req.body, 'memo', "string", true);
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.params, 'tkey');

    getHyperLedgerData('TOKEN_DATA_' + req.body.token)
        .then(function (token_data) {
            var tx_id = FabricManager.client.newTransactionID();
            var request = {
                chaincodeId: config.chain_code_id,
                fcn: 'tokenBurning',
                args: [req.body.token, req.body.amount, req.body.memo, req.body.signature, req.params.tkey],
                chainId: config.channel_name,
                txId: tx_id
            };
            JobProcess(request, res, tx_id, [token_data.owner], [req.body.token]);
        })
        .catch(function (err) {
            res.json({
                result: 'ERROR',
                msg: err.message,
                data: ''
            });
        });
}


function post_token_increase(req, res, next) {
    res.header('Cache-Control', 'no-cache');
    mtcUtil.ParameterCheck(req.body, 'token');
    mtcUtil.ParameterCheck(req.body, 'amount', 'int');
    mtcUtil.ParameterCheck(req.body, 'memo', "string", true);
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.params, 'tkey');

    getHyperLedgerData('TOKEN_DATA_' + req.body.token)
        .then(function (token_data) {
            var tx_id = FabricManager.client.newTransactionID();
            var request = {
                chaincodeId: config.chain_code_id,
                fcn: 'tokenIncrease',
                args: [req.body.token, req.body.amount, req.body.memo, req.body.signature, req.params.tkey],
                chainId: config.channel_name,
                txId: tx_id
            };
            JobProcess(request, res, tx_id, [token_data.owner], [req.body.token]);
        })
        .catch(function (err) {
            res.json({
                result: 'ERROR',
                msg: err.message,
                data: ''
            });
        });

}

function post_token_sell(req, res) {
    mtcUtil.ParameterCheck(req.body, 'address', 'address');
    mtcUtil.ParameterCheck(req.body, 'amount', "int");
    mtcUtil.ParameterCheck(req.body, 'token', "int");
    mtcUtil.ParameterCheck(req.body, 'price', "int");
    mtcUtil.ParameterCheck(req.body, 'platform_name', "string", true, 0, 255);
    mtcUtil.ParameterCheck(req.body, 'platform_url', "url", true, 0, 255);
    mtcUtil.ParameterCheck(req.body, 'platform_address', "address", true);
    mtcUtil.ParameterCheck(req.body, 'platform_commission', "string", true, 0, 5);

    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

    var tx_id = FabricManager.client.newTransactionID();
    var request = {
        chaincodeId: config.chain_code_id,
        chainId: config.channel_name,
        txId: tx_id,
        fcn: 'mrc010sell',
        args: [req.body.address, req.body.amount, req.params.mrc010id, req.body.price, req.body.token,
        req.body.platform_name, req.body.platform_url, req.body.platform_address, req.body.platform_commission,
        req.body.signature, req.body.tkey]
    };
    JobProcess(request, res, tx_id, [req.body.address], []);
}

function post_token_unsell(req, res) {
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

    var tx_id = FabricManager.client.newTransactionID();
    var request = {
        chaincodeId: config.chain_code_id,
        chainId: config.channel_name,
        txId: tx_id,
        fcn: 'mrc010unsell',
        args: [req.params.mrc010dexid, req.body.signature, req.body.tkey]
    };
    JobProcess(request, res, tx_id, [req.body.address, req.params.mrc010dexid], []);
}

function post_token_buy(req, res) {
    mtcUtil.ParameterCheck(req.body, 'address', 'address');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'amount', "int");
    mtcUtil.ParameterCheck(req.body, 'tkey');

    var tx_id = FabricManager.client.newTransactionID();
    var request = {
        chaincodeId: config.chain_code_id,
        chainId: config.channel_name,
        txId: tx_id,
        fcn: 'mrc010buy',
        args: [req.params.mrc010dexid, req.body.address, req.body.amount, req.body.signature, req.body.tkey]
    };
    JobProcess(request, res, tx_id, [req.body.address, req.params.mrc010dexid], []);
}

function post_token_reqsell(req, res) {
    mtcUtil.ParameterCheck(req.body, 'address', 'address');
    mtcUtil.ParameterCheck(req.body, 'amount', "int");
    mtcUtil.ParameterCheck(req.body, 'token', "int");
    mtcUtil.ParameterCheck(req.body, 'price', "int");
    mtcUtil.ParameterCheck(req.body, 'platform_name', "string", true, 0, 255);
    mtcUtil.ParameterCheck(req.body, 'platform_url', "url", true, 0, 255);
    mtcUtil.ParameterCheck(req.body, 'platform_address', "address", true);
    mtcUtil.ParameterCheck(req.body, 'platform_commission', "string", true, 0, 5);

    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

    var tx_id = FabricManager.client.newTransactionID();
    var request = {
        chaincodeId: config.chain_code_id,
        chainId: config.channel_name,
        txId: tx_id,
        fcn: 'mrc010reqsell',
        args: [req.body.address, req.body.amount, req.params.mrc010id, req.body.price, req.body.token,
        req.body.platform_name, req.body.platform_url, req.body.platform_address, req.body.platform_commission,
        req.body.signature, req.body.tkey]
    };
    JobProcess(request, res, tx_id, [req.body.address], []);
}

function post_token_unreqsell(req, res) {
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

    var tx_id = FabricManager.client.newTransactionID();
    var request = {
        chaincodeId: config.chain_code_id,
        chainId: config.channel_name,
        txId: tx_id,
        fcn: 'mrc010unreqsell',
        args: [req.params.mrc010dexid, req.body.signature, req.body.tkey]
    };
    JobProcess(request, res, tx_id, [req.body.address, req.params.mrc010dexid], []);
}

function post_token_acceptreqsell(req, res) {
    mtcUtil.ParameterCheck(req.body, 'address', 'address');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'amount', "int");
    mtcUtil.ParameterCheck(req.body, 'tkey');

    var tx_id = FabricManager.client.newTransactionID();
    var request = {
        chaincodeId: config.chain_code_id,
        chainId: config.channel_name,
        txId: tx_id,
        fcn: 'mrc010acceptreqsell',
        args: [req.params.mrc010dexid, req.body.address, req.body.amount, req.body.signature, req.body.tkey]
    };
    JobProcess(request, res, tx_id, [req.body.address, req.params.mrc010dexid], []);
}





function post_mrc100_payment(req, res, next) {
    mtcUtil.ParameterCheck(req.body, 'to');
    mtcUtil.ParameterCheck(req.body, 'token');
    mtcUtil.ParameterCheck(req.body, 'tag');
    mtcUtil.ParameterCheck(req.body, 'userlist');
    mtcUtil.ParameterCheck(req.body, 'gameid');
    mtcUtil.ParameterCheck(req.body, 'gamememo');

    req.body.gameid = req.body.gameid.substr(0, 64);
    req.body.gamememo = req.body.gamememo.substr(0, 2048);

    let userlist;
    try {
        userlist = JSON.parse(req.body.userlist);
    } catch (e) {
        res.status(400).send("userlist json decode error");
        return;
    }

    if (typeof userlist != typeof []) {
        res.status(400).send("userlist is not array");
        return;
    }

    if (userlist.length < 1) {
        res.status(400).send("userlist is empty");
        return;

    }
    if (!mtcUtil.isAddress(req.body.to)) {
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
            if (!mtcUtil.isAddress(u.address)) {
                return next(new Error('Invalid address - ' + u.addres));
            }
            if (!mtcUtil.isNormalInteger(u.amount)) {
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
    mtcUtil.ParameterCheck(req.body, 'from', "address");
    mtcUtil.ParameterCheck(req.body, 'token');
    mtcUtil.ParameterCheck(req.body, 'userlist');
    mtcUtil.ParameterCheck(req.body, 'gameid');
    mtcUtil.ParameterCheck(req.body, 'gamememo');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

    req.body.gameid = req.body.gameid.substr(0, 64);
    req.body.gamememo = req.body.gamememo.substr(0, 2048);

    let userlist;
    try {
        userlist = JSON.parse(req.body.userlist);
    } catch (e) {
        res.status(400).send("userlist json decode error");
        return;
    }

    if (typeof userlist != typeof []) {
        res.status(400).send("userlist is not array");
        return;
    }

    if (userlist.length < 1) {
        res.status(400).send("userlist is empty");
        return;

    }
    if (!mtcUtil.isAddress(req.body.from)) {
        return next(new Error("from address is invalid"));
    }

    let addr_list = [req.body.from];
    for (var i = 0; i < userlist.length; i++) {
        let u = userlist[i];
        if (u.address == undefined || u.amount == undefined || u.tag == undefined || u.memo == undefined) {
            res.status(400).send("userlist data is invalid at " + i);
            return;
        }
        if (!mtcUtil.isAddress(u.address)) {
            res.status(400).send(u.address + " is invalid address");
            return;
        }
        if (!mtcUtil.isNormalInteger(u.amount)) {
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
    mtcUtil.ParameterCheck(req.params, 'tkey');
    mtcUtil.ParameterCheck(req.body, 'token');
    mtcUtil.ParameterCheck(req.body, 'logger');
    mtcUtil.ParameterCheck(req.body, 'log');
    mtcUtil.ParameterCheck(req.body, 'signature');

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
    mtcUtil.ParameterCheck(req.params, 'mrc100key');

    res.header('Cache-Control', 'no-cache');
    const request = {
        chaincodeId: config.chain_code_id,
        fcn: 'mrc100get',
        args: [req.params.mrc100key]
    };
    InvokeGet(request, res);
}


function get_mrc100_logger(req, res) {
    mtcUtil.ParameterCheck(req.params, 'token');

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
    mtcUtil.ParameterCheck(req.params, 'tkey');
    mtcUtil.ParameterCheck(req.body, 'token');
    mtcUtil.ParameterCheck(req.body, 'address');
    mtcUtil.ParameterCheck(req.body, 'signature');


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
    mtcUtil.ParameterCheck(req.params, 'tkey');
    mtcUtil.ParameterCheck(req.body, 'token');
    mtcUtil.ParameterCheck(req.body, 'address');
    mtcUtil.ParameterCheck(req.body, 'signature');


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


function get_mrc400(req, res) {
    mtcUtil.ParameterCheck(req.params, 'mrc400id');
    res.header('Cache-Control', 'no-cache');
    const request = {
        chaincodeId: config.chain_code_id,
        fcn: 'mrc400get',
        args: [req.params.mrc400id]
    };
    InvokeGet(request, res);
}


function post_mrc400(req, res) {
    mtcUtil.ParameterCheck(req.body, 'owner', "address");
    mtcUtil.ParameterCheck(req.body, 'name', "string", false, 0, 128);
    mtcUtil.ParameterCheck(req.body, 'url', "url", false, 1, 255);
    mtcUtil.ParameterCheck(req.body, 'imageurl', "url", false, 1, 255);
    mtcUtil.ParameterCheck(req.body, "allowtoken", "int", false, 1, 40);
    mtcUtil.ParameterCheck(req.body, 'category', "string", false, 1, 64);
    mtcUtil.ParameterCheck(req.body, 'description', "string", false, 1, 4096);
    mtcUtil.ParameterCheck(req.body, 'itemurl', "url", false, 1, 255);
    mtcUtil.ParameterCheck(req.body, 'itemimageurl', "url", false, 1, 255);
    mtcUtil.ParameterCheck(req.body, 'data', "string", true, 1, 4096);
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.params, 'mrc400id');
    mtcUtil.ParameterCheck(req.body, 'name', 'string', true, 0, 128);
    mtcUtil.ParameterCheck(req.body, 'url', "url", 0, 255);
    mtcUtil.ParameterCheck(req.body, 'imageurl', "url", 0, 255);
    mtcUtil.ParameterCheck(req.body, "allowtoken", "int", 1, 40);
    mtcUtil.ParameterCheck(req.body, 'category', 'string', true, 0, 64);
    mtcUtil.ParameterCheck(req.body, 'description', 'string', true, 0, 4096);
    mtcUtil.ParameterCheck(req.body, 'itemurl', "url", 0, 255);
    mtcUtil.ParameterCheck(req.body, 'itemimageurl', "url", 0, 255);
    mtcUtil.ParameterCheck(req.body, 'data', 'string', true, 0, 4096);
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.params, 'mrc401id');
    res.header('Cache-Control', 'no-cache');

    const request = {
        chaincodeId: config.chain_code_id,
        fcn: 'mrc401get',
        args: [req.params.mrc401id]
    };
    InvokeGet(request, res);
}


function post_mrc401(req, res) {
    mtcUtil.ParameterCheck(req.params, 'mrc400id');
    mtcUtil.ParameterCheck(req.body, 'itemdata');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.params, 'mrc400id');
    mtcUtil.ParameterCheck(req.body, 'itemdata');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.params, 'mrc401id');
    mtcUtil.ParameterCheck(req.body, 'fromAddr', "address");
    mtcUtil.ParameterCheck(req.body, 'toAddr', "address");
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'seller', "address");
    mtcUtil.ParameterCheck(req.body, 'mrc400id');
    mtcUtil.ParameterCheck(req.body, 'itemdata');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'seller', "address");
    mtcUtil.ParameterCheck(req.body, 'mrc400id');
    mtcUtil.ParameterCheck(req.body, 'itemdata');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');


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
    mtcUtil.ParameterCheck(req.params, 'mrc401id');
    mtcUtil.ParameterCheck(req.body, 'buyer', "address");
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'seller', "address");
    mtcUtil.ParameterCheck(req.body, 'mrc400id');
    mtcUtil.ParameterCheck(req.body, 'itemdata');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'seller', "address");
    mtcUtil.ParameterCheck(req.body, 'mrc400id');
    mtcUtil.ParameterCheck(req.body, 'itemdata');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.params, 'mrc401id');

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
    mtcUtil.ParameterCheck(req.params, 'mrc401id');
    mtcUtil.ParameterCheck(req.body, 'buyer', "address");
    mtcUtil.ParameterCheck(req.body, 'amount', "int");
    mtcUtil.ParameterCheck(req.body, 'token', "int");
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.params, 'mrc401id');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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




function get_mrc402(req, res) {
    mtcUtil.ParameterCheck(req.params, 'mrc402id');
    res.header('Cache-Control', 'no-cache');
    const request = {
        chaincodeId: config.chain_code_id,
        fcn: 'mrc402get',
        args: [req.params.mrc402id]
    };
    InvokeGet(request, res);
}

function post_mrc402(req, res) {
    mtcUtil.ParameterCheck(req.body, 'name', "string", false, 1, 128);
    mtcUtil.ParameterCheck(req.body, 'creator', "address");
    mtcUtil.ParameterCheck(req.body, 'creatorcommission');
    mtcUtil.ParameterCheck(req.body, 'totalsupply', "int", false, 1, 8);
    mtcUtil.ParameterCheck(req.body, 'decimal', "int", false, 1, 1);
    mtcUtil.ParameterCheck(req.body, 'url', "url", false, 1, 255);
    mtcUtil.ParameterCheck(req.body, 'imageurl', "url", false, 1, 255);
    mtcUtil.ParameterCheck(req.body, "shareholder", "string", true, 1, 1024);
    mtcUtil.ParameterCheck(req.body, "initialreserve", "string", true, 1, 1024);
    mtcUtil.ParameterCheck(req.body, "expiredate", "int", true, 0, 12);
    mtcUtil.ParameterCheck(req.body, 'data', "string", true, 0, 40960);
    mtcUtil.ParameterCheck(req.body, 'information', "string", true, 0, 40960);
    mtcUtil.ParameterCheck(req.body, 'socialmedia', "string", true, 0, 40960);
    mtcUtil.ParameterCheck(req.body, 'copyright_registration_country', "string", true, 0, 2);
    mtcUtil.ParameterCheck(req.body, 'copyright_registrar', "string", true, 0, 128);
    mtcUtil.ParameterCheck(req.body, 'copyright_registration_number', "string", true, 0, 64);
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');


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
    mtcUtil.ParameterCheck(req.body, 'fromAddr', "address");
    mtcUtil.ParameterCheck(req.body, 'toAddr', "address");
    mtcUtil.ParameterCheck(req.body, 'amount', "int");
    mtcUtil.ParameterCheck(req.body, 'tag');
    mtcUtil.ParameterCheck(req.body, 'memo');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'url', "url", false, 1, 255);
    mtcUtil.ParameterCheck(req.body, 'data', "string", true, 0, 40960);
    mtcUtil.ParameterCheck(req.body, 'information', "string", true, 0, 40960);
    mtcUtil.ParameterCheck(req.body, 'socialmedia', "string", true, 0, 40960);
    mtcUtil.ParameterCheck(req.body, 'copyright_registration_country', "string", true, 0, 2);
    mtcUtil.ParameterCheck(req.body, 'copyright_registrar', "string", true, 0, 128);
    mtcUtil.ParameterCheck(req.body, 'copyright_registration_number', "string", true, 0, 64);
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'amount');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'memo', "string", true, 0, 1024);
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'amount');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'memo', "string", true, 0, 1024);
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'address', 'address');
    mtcUtil.ParameterCheck(req.body, 'amount');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'address', 'address');
    mtcUtil.ParameterCheck(req.body, 'amount', "int");
    mtcUtil.ParameterCheck(req.body, 'token', "int");
    mtcUtil.ParameterCheck(req.body, 'price', "int");
    mtcUtil.ParameterCheck(req.body, 'platform_name', "string", true, 0, 255);
    mtcUtil.ParameterCheck(req.body, 'platform_url', "url", true, 0, 255);
    mtcUtil.ParameterCheck(req.body, 'platform_address', "address", true);
    mtcUtil.ParameterCheck(req.body, 'platform_commission', "string", true, 0, 5);

    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'address', 'address');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'amount', "int");
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'address', 'address');
    mtcUtil.ParameterCheck(req.body, 'amount', "int");
    mtcUtil.ParameterCheck(req.body, 'auction_start_price', "int");
    mtcUtil.ParameterCheck(req.body, 'token', "int");
    mtcUtil.ParameterCheck(req.body, 'auction_bidding_unit', "int");
    mtcUtil.ParameterCheck(req.body, 'auction_buynow_price', "string", true);
    mtcUtil.ParameterCheck(req.body, 'auction_start_date', "int", true);
    mtcUtil.ParameterCheck(req.body, 'auction_end_date', "int", true);
    mtcUtil.ParameterCheck(req.body, 'platform_name', "string", true, 0, 255);
    mtcUtil.ParameterCheck(req.body, 'platform_url', "url", true, 0, 255);
    mtcUtil.ParameterCheck(req.body, 'platform_address', "address", true);
    mtcUtil.ParameterCheck(req.body, 'platform_commission', "string", true, 0, 5);

    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'address', 'address');
    mtcUtil.ParameterCheck(req.body, 'amount');
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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

function get_mrc800(req, res) {
    mtcUtil.ParameterCheck(req.params, 'mrc800id');

    res.header('Cache-Control', 'no-cache');
    const request = {
        chaincodeId: config.chain_code_id,
        fcn: 'mrc400get',
        args: [req.params.mrc800id]
    };
    InvokeGet(request, res);
}

function post_mrc800(req, res) {
    mtcUtil.ParameterCheck(req.body, 'owner', "address");
    mtcUtil.ParameterCheck(req.body, 'name', "", false, 0, 128);
    mtcUtil.ParameterCheck(req.body, 'url', "url", false, 1, 255);
    mtcUtil.ParameterCheck(req.body, 'imageurl', "url", false, 1, 255);
    mtcUtil.ParameterCheck(req.body, 'description', "string", true, 1, 4096);
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.params, 'mrc800id');
    mtcUtil.ParameterCheck(req.body, 'name', "string", true, 0, 128);
    mtcUtil.ParameterCheck(req.body, 'url', "url", true, 0, 255);
    mtcUtil.ParameterCheck(req.body, 'imageurl', "url", true, 0, 255);
    mtcUtil.ParameterCheck(req.body, 'description', "string", true, 0, 4096);
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'mrc800id', "", false, 40, 40);
    mtcUtil.ParameterCheck(req.body, 'from', "address");
    mtcUtil.ParameterCheck(req.body, 'amont', "int");
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'mrc800id', "", false, 40, 40);
    mtcUtil.ParameterCheck(req.body, 'to', "address");
    mtcUtil.ParameterCheck(req.body, 'amont', "int");
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

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
    mtcUtil.ParameterCheck(req.body, 'from', "address");
    mtcUtil.ParameterCheck(req.body, 'to', "address");
    mtcUtil.ParameterCheck(req.body, 'mrc800id', "", false, 40, 40);
    mtcUtil.ParameterCheck(req.body, 'amont', "int");
    mtcUtil.ParameterCheck(req.body, 'signature');
    mtcUtil.ParameterCheck(req.body, 'tkey');

    request.post({
        url: config.MTCBridge + "/mrc800/transfer/" + req.params.mrc800id,
        form: req.body
    }, default_txresponse_process);
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
app.post('/set/:key', post_set);



// internal function
app.get('/get/:key', get_get);
app.post('/set/:key', post_set);

// not chain code.
app.get('/block/:block_no', get_block);
app.get('/transaction/:transaction_id', get_transaction);

// not chain code & internal
app.get('/getkey/:keytype/:address', get_nonce);
app.get('/nonce/:address', get_nonce);

// wallet
app.get('/address/:address', get_address);
app.post('/address', post_address);

// transfer and exchange
app.post('/transfer', post_transfer);
app.post('/multitransfer', post_multitransfer);
app.post('/exchange/:fromTkey/:toTkey', post_exchange);

// token
app.get('/token/:token', get_token);
app.post('/token', post_token);
app.post('/token/:tkey', post_token_tkey);
// token update
app.put('/token/update/:tkey', put_token);
app.put('/token/increase/:tkey', post_token_increase);
app.put('/token/burn/:tkey', post_token_burn);

app.post('/token/sell/:mrc010id', post_token_sell);
app.post('/token/unsell/:mrc010dexid', post_token_unsell);
app.post('/token/buy/:mrc010dexid', post_token_buy);

app.post('/token/reqsell/:mrc010id', post_token_reqsell);
app.post('/token/unreqsell/:mrc010dexid', post_token_unreqsell);
app.post('/token/acceptreqsell/:mrc010dexid', post_token_acceptreqsell);

// mrc020
app.get('/mrc020/:mrc020key', get_mrc020);
app.post('/mrc020', post_mrc020);

// mrc030
app.get('/mrc030/:mrc030key', get_mrc030);
app.get('/mrc030/finish/:mrc030key', get_mrc030_finish);
app.post('/mrc030', post_mrc030);
app.post('/mrc030/:mrc030key', post_mrc030_join);
app.get('/mrc031/:mrc031key', get_mrc031);


// mrc040
app.get('/mrc040/:mrc040key', get_mrc040);
app.post('/mrc040/cancel/:tkey', post_mrc040_cancel);
app.post('/mrc040/create/:tkey', post_mrc040_create);
app.post('/mrc040/exchange/:tkey', post_mrc040_exchange);


// mrc100
app.post('/mrc100/payment', post_mrc100_payment);
app.post('/mrc100/reward', post_mrc100_reward);
app.post('/mrc100/log/:tkey', post_mrc100_log);
app.get('/mrc100/log/:mrc100key', get_mrc100_log);

app.get('/mrc100/logger/:token', get_mrc100_logger);
app.post('/mrc100/logger/:tkey', post_mrc100_logger);
app.delete('/mrc100/logger/:tkey', delete_mrc100_logger);


// mrc400
app.get('/mrc400/:mrc400id', get_mrc400);
app.post('/mrc400', post_mrc400);
app.put('/mrc400/:mrc400id', put_mrc400);

// mrc401
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

app.get('/mrc402/:mrc402id', get_mrc402);
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


// mrc800 - point
app.get('/mrc800/:mrc800id', get_mrc800);
app.post('/mrc800', post_mrc800);
app.put('/mrc800/:mrc800id', put_mrc800);

app.post('/mrc800/transfer', post_mrc800_transfer);
app.post('/mrc800/take', post_mrc800_take);
app.post('/mrc800/give', post_mrc800_give);


// token update for mrc040
app.post('/tokenUpdate/TokenBase/:tkey/:token/:baseToken', post_tokenupdate_tokenbase);
app.post('/tokenUpdate/TokenTargetAdd/:tkey/:token/:targetToken', post_tokenupdate_tokentargetadd);
app.post('/tokenUpdate/TokenTargetRemove/:tkey/:token/:targetToken', post_tokenupdate_tokentargetremove);

// for ICO.
app.post('/buy', post_buy);

// create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
// App init.


app.use(function (err, req, res, next) {
    console.log(new Date().toLocaleString(), err);
    res.json({
        result: 'ERROR',
        msg: err.message,
        data: ''
    });
});

try {
    HyperLedgerConnect();
    http.createServer(app).listen(listen_port, function () {
        console.log(new Date().toLocaleString(), app_title + ' listening on port ' + listen_port);
    });
    setTimeout(JobQueueCheck, 10);
} catch (err) {
    console.error(app_title + ' port ' + listen_port + ' bind error');
}