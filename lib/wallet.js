'use strict';

var fs = require('fs');
var util = require('util');

var bitcoin = require('bitcoin');
var async = require('async');

var SATOSHI_FACTOR = 1e8;
var TRANSACTION_FEE = 10000;  // in satoshis

var Bitcoind = function(config) {
  this.config = config;

  var bitcoindConfiguration = parseBitcoinConfiguration(config.bitcoindConfigurationPath);

  var rpcConfig = {
    protocol: 'http',
    user: bitcoindConfiguration.rpcuser,
    pass: bitcoindConfiguration.rpcpassword,
    port: bitcoindConfiguration.testnet == 1 ? 18332 : 8332
  };
  this.rpc = new bitcoin.Client(rpcConfig);
  this.testMode = false;

  // Leave this much in account, to leave enough to cover transaction fee
  this.TRANSACTION_FEE_MARGIN = 3 * TRANSACTION_FEE;

  // Number of outputs to split an incoming transaction into, per transaction
  this.PER_TRANSACTION_SPLIT_COUNT = 20;

  // Expected maximum time for a block to complete, in minutes
  this.EXPECTED_MAX_BLOCK_TIME = 60;

  // Expected transactions per minute
  this.EXPECTED_TRANSACTION_RATE = 2;

  // The max number of transactions we expect per block confirmation
  // For now this MUST be a multiple of PER_TRANSACTION_SPLIT_COUNT
  this.SPLIT_COUNT = this.EXPECTED_MAX_BLOCK_TIME * this.EXPECTED_TRANSACTION_RATE;
  console.assert(this.SPLIT_COUNT % this.PER_TRANSACTION_SPLIT_COUNT === 0);
  this.SPLIT_TRANSACTION_COUNT = this.SPLIT_COUNT / this.PER_TRANSACTION_SPLIT_COUNT;

  // An account is considered empty if it has less than this amount in it
  this.EPSILON = 2 * this.TRANSACTION_FEE_MARGIN * this.SPLIT_TRANSACTION_COUNT;

  this.poolAccount = config.poolAccount;
};

var EventEmitter = require('events').EventEmitter;
util.inherits(Bitcoind, EventEmitter);
module.exports = Bitcoind;

Bitcoind.factory = function factory(config) {
  return new Bitcoind(config);
};

function richError(msg, name) {
  var err = new Error(msg);
  err.name = name;
  return err;
}

function parseBitcoinConfiguration(configurationPath) {
  var conf = fs.readFileSync(configurationPath);
  var lines = conf.toString().split('\n');
  var res = {};
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var arr = line.split('=');
    var name = arr[0];
    var value = arr[1];
    if (!value) continue;
    res[name] = value;
  }

  return res;
}

Bitcoind.prototype.sendBitcoins = function sendBitcoins(address, satoshis,
      transactionFee, cb) {
  var confirmations = 1;

  var bitcoins = parseFloat((satoshis / SATOSHI_FACTOR).toFixed(8));
  this.rpc.sendFrom(this.poolAccount, address, bitcoins, confirmations,
      function(err, txId) {
    if (err) {
      if (err.code === -6) return cb(richError('Insufficient funds', 'InsufficientFunds'));
      return cb(err);
    }

    cb(null, txId);
  });
};

Bitcoind.prototype.balance = function balance(cb) {
  this._accountBalance(this.poolAccount, 1, cb);
};


Bitcoind.prototype._isEmptyBalance = function _isEmptyBalance(balance) {
  return balance < this.EPSILON;
};

Bitcoind.prototype._accountBalance = function accountBalance(account, confs, cb) {
  this.rpc.getBalance(account, confs, function (err, balance) {
    if (err) return cb(err);
    var satoshiBalance = Math.round(SATOSHI_FACTOR * balance);
    cb(null, satoshiBalance);
  });
};

Bitcoind.prototype.monitorAccount = function monitorAccount(account, cb) {
  var self = this;
  var confs = this.testMode ? 0 : 1;
  this._accountBalance(account, confs, function (err, balance) {
    if (err) {
      self.emit('error', err);
      return cb && cb(err);
    }
    if (self._isEmptyBalance(balance)) return cb && cb(null, null);
    self.emit('funded', account, balance);
    self._splitAccount(account, balance, function (err, txIds) {
      if (err) return cb && cb(err);
      cb(null, balance, txIds);
    });
  });
};

Bitcoind.prototype.addressReceived = function addressReceived(address, confs, cb) {
  this.rpc.getReceivedByAddress(address, confs, function (err, received) {
    if (err) return cb(err);
    cb(null, Math.round(received * SATOSHI_FACTOR));
  });
};

Bitcoind.prototype.newAddress = function newAddress(account, cb) {
  this.rpc.getNewAddress(account, function (err, addr) {
    if (err) return cb(err);
    cb(null, addr);
  });
};

Bitcoind.prototype._sendSplitTransaction = function _sendSplitTransaction(account, addresses, totalSatoshis, cb) {
  var count = addresses.length;
  var eachSatoshis = Math.floor(totalSatoshis / count);
  var firstSatoshis = eachSatoshis + totalSatoshis % count;

  var addressMap = {};
  addresses.forEach(function (address, index) {
    var satoshis = index === 0 ? firstSatoshis : eachSatoshis;
    var amount = satoshis / SATOSHI_FACTOR;
    addressMap[address] = amount;
  });

  var confs = this.testMode ? 0 : 1;
  this.rpc.sendMany(account, addressMap, confs, function (err, txId) {
    if (err) return cb(new Error(err));
    cb(null, txId);
  });
};

Bitcoind.prototype._splitAccountTransaction = function _splitAccountTransaction(account, satoshis, cb) {
  var self = this;
  function newAddressFunc(i, next) {
    self.newAddress(self.poolAccount, function (err, address) {
      if (err) return next(err);
      next(null, address);
    });
  }

  async.times(this.PER_TRANSACTION_SPLIT_COUNT, newAddressFunc, function (err, addresses) {
    if (err) return cb(err);
    self._sendSplitTransaction(account, addresses, satoshis, function(err, txId) {
      if (err) return cb(err);
      cb(null, txId);
    });
  });
};

Bitcoind.prototype._splitAccount = function _splitAccount(account, balance, cb) {
  var perTransactionSatoshis =
    Math.floor(balance / this.SPLIT_TRANSACTION_COUNT) - this.TRANSACTION_FEE_MARGIN;

  var self = this;
  function splitFunc(index, next) {
    self._splitAccountTransaction(account, perTransactionSatoshis, function (err, txId) {
      next(err, txId);
    });
  }

  async.times(this.SPLIT_TRANSACTION_COUNT, splitFunc, function (err, txIds) {
    if (err) return cb(err);
    cb(null, txIds);
  });
};


