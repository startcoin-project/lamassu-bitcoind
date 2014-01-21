/*
* THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED
* WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
* OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT,
* INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
* (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
* HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
* STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
* IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
* POSSIBILITY OF SUCH DAMAGE.
*/

'use strict';

var quickHttps = require('../util/quick_https');
var appErr = require('../applicationerror');
var async = require('async');
var _ = require('lodash');
var winston = require('winston');
var logger = new (winston.Logger)({transports:[new (winston.transports.Console)()]});

var _domain = 'blockchain.info';


var Blockchain = function(config) {
  this.config = config;
};
Blockchain.factory = function factory(config) {
  return new Blockchain(config);
};


Blockchain.prototype.setDomain = function(domain) {
  _domain = domain;
};


Blockchain.prototype.sendBitcoins = function sendBitcoins(address, satoshis,
      transactionFee, callback) {
  var self = this;
  var order = {address: address, satoshis: satoshis};
  var t0 = Date.now();

  // Preload txs for our address to see if the new transaction later appears
  this._fetchTransactions(t0, order, function(err, txs) {
    if (err) return callback(err);
    self._sendBitcoins(order, txs, t0, callback);
  });
};

Blockchain.prototype._sendBitcoins = function _sendBitcoins(order, txs, t0,
    callback) {
  // TODO: needs unit test
  var self = this;
  var tx = null;

  async.until(
    function() { return (tx || self._retryExpired(t0)); },
    function(lcb) {
      self._doSendBitcoins(order, function(err, ltx) {
        if (err)
          logger.error('Erros _sendBitcoins. %j', err);
        else
          tx = ltx;
        lcb();
      });
    },
    function(err) {
      if (err) return callback(err);
      if (tx) return callback(null, tx);
      callback(new Error('Network timeout'));
    }
  );
};

Blockchain.prototype._sendBitcoinsLookup =
    function _sendBitcoinsLookup(order, txs, t0, callback) {
  this._fetchTransactions(t0, order, function(err, newTxs) {
    if (err) return callback(err);
    var freshTxs = _.difference(newTxs, txs);
    if (_.isEmpty(freshTxs)) callback();
    else callback(null, _.first(freshTxs));
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

Blockchain.prototype._sendBitcoinsError =
    function _sendBitcoinsError(err, order, txs, t0, callback) {
  var self = this;
  if (err instanceof appErr.InsufficentBitcoinsError) return callback(err);
  this._sendBitcoinsLookup(order, txs, t0, function(err, tx) {
    if (err) return callback(err);
    if (tx) return callback(null, tx); // Transaction was sent

    // Transaction wasn't sent successfully
    setTimeout(function() { self._sendBitcoins(order, txs, t0, callback); },
      self.config.retryInterval);
  });
};

// This is the actual call to blockchain.info
Blockchain.prototype._doSendBitcoins =
    function _doSendBitcoins(order, callback) {
  var config = this.config;
  var data = {
    password: config.password,
    to: order.address,
    amount: order.satoshis,
    from: config.fromAddress
  };

  var path = '/merchant/' + config.guid + '/payment';
  quickHttps.post('blockchain.info', path, data, function(err, res) {
    if (err) return callback(err);
    if (res.error) {
      var regex =
          /(^Insufficient Funds Available)|(^No free outputs to spend)/;
      if (res.error.match(regex))
        return callback(new appErr.InsufficentBitcoinsError(res.error));
      return callback(new Error(res.error));
    }
    callback(null, res.tx_hash);
  });
};

// We want a balance that includes all spends (0 conf) but only deposits that
// have at least 1 confirmation.
Blockchain.prototype.balance = function balance(callback) {
  var self = this;
  async.parallel([
      function(lcb) { self._checkBalance(0, lcb); },
      function(lcb) { self._checkBalance(1, lcb); }
    ],
    function(err, results){
      if (err) return callback(err);
      var unconfirmedDeposits = results[0].total_received -
        results[1].total_received;
      callback(null, results[0].balance - unconfirmedDeposits);
    }
  );
};

Blockchain.prototype._checkBalance = function _checkBalance(conf, callback) {
  var config = this.config;
  var data = {
    password: config.password,
    address: config.fromAddress
  };
  if (conf > 0) data.confirmations = conf;

  var path = '/merchant/' + config.guid + '/address_balance';
  quickHttps.post(_domain, path, data, function(err, res) {
    if (err) return callback(err);
    if (res.error) return callback(new Error(res.error));
    callback(null, res);
  });
};

Blockchain.prototype._fetchTransactions =
    function _fetchTransactions(t0, order, callback) {
  var self = this;
  var path = '/address/' + this.config.fromAddress + '?format=json&limit=10';
  var txs = null;
  async.until(
    function() { return (txs || self._retryExpired(t0)); },
    function(lcb) {
      quickHttps.get(_domain, path, function(err, res) {
        var allErr = err ? err.message : res.error;
        if (allErr) {
          logger.error('Error fetTransactions: %j', allErr);
          setTimeout(lcb, self.config.retryInterval);
        } else {
          txs = self._reduceTransactionsToHashes(order, res.txs);
          lcb();
        }
      });
    },
    function(err) {
      if (err) return callback(err);
      if (txs) return callback(null, txs);
      callback(new Error('Network timeout'));
    }
  );
};

Blockchain.prototype._retryExpired = function _retryExpired(t0) {
  return Date.now() - t0 > this.config.retryTimeout;
};

module.exports = Blockchain;
