'use strict';

var jsonquest = require('jsonquest');
var async = require('async');
var insufficientFundsRegex = /(^Insufficient Funds Available)|(^No free outputs to spend)/;

var Blockchain = function(config) {
  this.config = config;
  this.host = config.host || 'blockchain.info';
  this.port = config.port || 443;
};
Blockchain.factory = function factory(config) {
  return new Blockchain(config);
};

Blockchain.prototype.sendBitcoins = function sendBitcoins(address, satoshis,
      transactionFee, cb) {

  var config = this.config;
  var path = '/merchant/' + config.guid + '/payment';
  var data = {
    password: config.password,
    to: address,
    amount: satoshis,
    from: config.fromAddress
  };

  this._request(path, data, function(err, response, result) {
    if (err && err.message.match(insufficientFundsRegex)) {
      var newErr = new Error(err.message);
      newErr.name = 'InsufficientFunds';
      return cb(newErr);
    }
    if (err) return cb(err);
    cb(null, result.tx_hash);
  });
};

// We want a balance that includes all spends (0 conf) but only deposits that
// have at least 1 confirmation.
Blockchain.prototype.balance = function balance(cb) {
  var self = this;
  async.parallel([
      function(lcb) { self._checkBalance(0, lcb); },
      function(lcb) { self._checkBalance(1, lcb); }
    ],
    function(err, results){
      if (err) return cb(err);
      var unconfirmedDeposits = results[0].total_received -
        results[1].total_received;
      cb(null, results[0].balance - unconfirmedDeposits);
    }
  );
};

Blockchain.prototype._checkBalance = function _checkBalance(conf, cb) {
  var config = this.config;
  var data = {
    password: config.password,
    address: config.fromAddress
  };
  if (conf > 0) data.confirmations = conf;

  var path = '/merchant/' + config.guid + '/address_balance';
  this._request(path, data, function(err, response, result) {
    cb(err, result);
  });
};

Blockchain.prototype._request = function _request(path, data, cb) {
  jsonquest({
    host: this.host,
    port: this.port,
    path: path,
    body: data,
    method: 'POST',
    protocol: 'https',
    requestEncoding: 'queryString'
  }, cb);
};

module.exports = Blockchain;
