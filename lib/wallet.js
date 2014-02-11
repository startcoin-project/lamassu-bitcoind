'use strict';

var quickHttps = require('./util/quick_https');
var appErr = require('./applicationerror');
var async = require('async');
var _ = require('lodash');

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
  var self = this;
  var order = {address: address, satoshis: satoshis};
  var t0 = Date.now();

  // Preload txs for our address to see if the new transaction later appears
  this._fetchTransactions(t0, order, function(err, txs) {
    if (err) return cb(err);
    self._sendBitcoins(order, txs, t0, cb);
  });
};

Blockchain.prototype._sendBitcoins =
    function _sendBitcoins(order, txs, t0, cb) {
  var self = this;
  var tx = null;
  async.until(
    function() { return (tx || self._retryExpired(t0)); },
    function(lcb) {
      self._safeSend(order, txs, t0, function(err, ltx) {
        if (err) return lcb(err);
        if (ltx) tx = ltx;
        lcb();
      });
    },
    function(err) {
      if (err) return cb(err);
      if (tx) return cb(null, tx);
      cb(new Error('Network timeout'));
    }
  );
};

Blockchain.prototype._safeSend = function _safeSend(order, txs, t0, cb) {
  var self = this;
  self._doSendBitcoins(order, function(err, tx) {
    if (err) {
      if (err instanceof appErr.InsufficentBitcoinsError) return cb(err);
      return setTimeout(function() { self._checkSent(order, txs, t0, cb); },
          self.config.retryInterval);
    }
    cb(null, tx);
  });
};

Blockchain.prototype._checkSent = function _checkSent(order, txs, t0, cb) {
  this._fetchTransactions(t0, order, function(err, newTxs) {
    if (err) return cb(err);
    var freshTxs = _.difference(newTxs, txs);
    if (_.isEmpty(freshTxs)) cb();
    else cb(null, _.first(freshTxs));
  });
};

// Input is transactions list from blockchain.info, output is list of
// transaction hashes that include a payment of correct amount to destination.
Blockchain.prototype._reduceTransactionsToHashes =
    function _reduceTransactionsToHashes(order, txs) {
  var filtered = _.filter(txs, function(tx) {
    return _.some(tx.out, function(output) {
      return (output.value === order.satoshis && output.addr === order.address);
    });
  });
  return _.pluck(filtered, 'hash');
};

// This is the actual call to blockchain.info
Blockchain.prototype._doSendBitcoins = function _doSendBitcoins(order, cb) {
  var config = this.config;
  var data = {
    password: config.password,
    to: order.address,
    amount: order.satoshis,
    from: config.fromAddress
  };

  var path = '/merchant/' + config.guid + '/payment';
  quickHttps.post(this.host, this.port, path, data, function(err, res) {
    if (err) return cb(err);
    if (res.error) {
      var regex =
          /(^Insufficient Funds Available)|(^No free outputs to spend)/;
      if (res.error.match(regex))
        return cb(new appErr.InsufficentBitcoinsError(res.error));
      return cb(new Error(res.error));
    }
    cb(null, res.tx_hash);
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
  quickHttps.post(this.host, this.port, path, data, function(err, res) {
    if (err) return cb(err);
    if (res.error) return cb(new Error(res.error));
    cb(null, res);
  });
};

Blockchain.prototype._fetchTransactions =
    function _fetchTransactions(t0, order, cb) {
  var self = this;
  var path = '/address/' + this.config.fromAddress + '?format=json&limit=10';
  var txs = null;
  async.until(
    function() { return (txs || self._retryExpired(t0)); },
    function(lcb) {
      quickHttps.get(self.host, path, function(err, res) {
        var allErr = err ? err.message : res.error;
        if (allErr) {
          console.log(allErr);
          setTimeout(lcb, self.config.retryInterval);
        } else {
          txs = self._reduceTransactionsToHashes(order, res.txs);
          lcb();
        }
      });
    },
    function(err) {
      if (err) return cb(err);
      if (txs) return cb(null, txs);
      cb(new Error('Network timeout'));
    }
  );
};

Blockchain.prototype._retryExpired = function _retryExpired(t0) {
  return Date.now() - t0 > this.config.retryTimeout;
};

module.exports = Blockchain;
