const router = require('express').Router()
const config = require('../../config.json');

const { request } = require('../utils/lib.superagent')
const { ParameterCheck } = require('../utils/lib')
const { default_txresponse_process,
    response } = require('../utils/lib.express')

function get_mrc800(req, res) {
    ParameterCheck(req.params, 'mrc800id');

    req.db.get('MRC800:DB:' + req.params.mrc800id)
        .then(function (value) {
            response(req, res, 200, value);
        })
        .catch(function (err) {
            response(req, res, 404, 'MRC800 ' + req.params.mrc800id + ' not found');
        });
}

function post_mrc800(req, res) {
    ParameterCheck(req.body, 'owner', "address");
    ParameterCheck(req.body, 'name', "", false, 0, 128);
    ParameterCheck(req.body, 'url', "url", false, 1, 255);
    ParameterCheck(req.body, 'imageurl', "url", false, 1, 255);
    ParameterCheck(req.body, 'description', "string", true, 1, 4096);
    ParameterCheck(req.body, 'signature');
    ParameterCheck(req.body, 'tkey');

    request.post(config.MTCBridge + "/mrc800",
        req.body,
        function (err, response) { default_txresponse_process(err, req, res, response, "mrc800id"); });
}


function put_mrc800(req, res) {
    ParameterCheck(req.params, 'mrc800id');
    ParameterCheck(req.body, 'name', "string", true, 0, 128);
    ParameterCheck(req.body, 'url', "url", true, 0, 255);
    ParameterCheck(req.body, 'imageurl', "url", true, 0, 255);
    ParameterCheck(req.body, 'description', "string", true, 0, 4096);
    ParameterCheck(req.body, 'signature');
    ParameterCheck(req.body, 'tkey');

    request.put(config.MTCBridge + "/mrc800/" + req.params.mrc400id,
        req.body,
        function (err, response) { default_txresponse_process(err, req, res, response); });

}

function post_mrc800_take(req, res) {
    ParameterCheck(req.body, 'mrc800id', "", false, 40, 40);
    ParameterCheck(req.body, 'from', "address");
    ParameterCheck(req.body, 'amont', "int");
    ParameterCheck(req.body, 'signature');
    ParameterCheck(req.body, 'tkey');

    request.post(config.MTCBridge + "/mrc800/take/" + req.params.mrc800id,
        req.body,
        function (err, response) { default_txresponse_process(err, req, res, response); });
}


function post_mrc800_give(req, res) {
    ParameterCheck(req.body, 'mrc800id', "", false, 40, 40);
    ParameterCheck(req.body, 'to', "address");
    ParameterCheck(req.body, 'amont', "int");
    ParameterCheck(req.body, 'signature');
    ParameterCheck(req.body, 'tkey');

    request.post(config.MTCBridge + "/mrc800/give/" + req.params.mrc800id,
        req.body,
        function (err, response) { default_txresponse_process(err, req, res, response); });
}

function post_mrc800_transfer(req, res) {
    ParameterCheck(req.body, 'from', "address");
    ParameterCheck(req.body, 'to', "address");
    ParameterCheck(req.body, 'mrc800id', "", false, 40, 40);
    ParameterCheck(req.body, 'amont', "int");
    ParameterCheck(req.body, 'signature');
    ParameterCheck(req.body, 'tkey');

    request.post(config.MTCBridge + "/mrc800/transfer/" + req.params.mrc800id,
        req.body,
        function (err, response) { default_txresponse_process(err, req, res, response); });
}

// mrc800 - point
router.get('/mrc800/:mrc800id', get_mrc800);
router.post('/mrc800', post_mrc800);
router.put('/mrc800/:mrc800id', put_mrc800);

router.post('/mrc800/transfer', post_mrc800_transfer);
router.post('/mrc800/take', post_mrc800_take);
router.post('/mrc800/give', post_mrc800_give);


module.exports = router
