'use strict';

var fs = require('fs');
var util = require('util');

var bitcore = require('bitcore');
var async = require('async');

var RpcClient = bitcore.RpcClient;

var SATOSHI_FACTOR = 1e8;
var TRANSACTION_FEE = 10000;  // in satoshis

// Leave this much in account, to leave enough to cover transaction fee
var TRANSACTION_FEE_MARGIN = 3 * TRANSACTION_FEE;

// Number of outputs to split an incoming transaction into, per transaction
var PER_TRANSACTION_SPLIT_COUNT = 20;

// Expected maximum time for a block to complete, in minutes
var EXPECTED_MAX_BLOCK_TIME = 60;

// Expected transactions per minute
var EXPECTED_TRANSACTION_RATE = 2;

// The max number of transactions we expect per block confirmation
// For now this MUST be a multiple of PER_TRANSACTION_SPLIT_COUNT
var SPLIT_COUNT = EXPECTED_MAX_BLOCK_TIME * EXPECTED_TRANSACTION_RATE;
console.assert(SPLIT_COUNT % PER_TRANSACTION_SPLIT_COUNT === 0);
var SPLIT_TRANSACTION_COUNT = SPLIT_COUNT / PER_TRANSACTION_SPLIT_COUNT;

// An account is considered empty if it has less than this amount in it
var EPSILON = 2 * TRANSACTION_FEE_MARGIN * SPLIT_TRANSACTION_COUNT;

// Accounts.funding is where the operator sends coins to fund the system.
// Accounts.pool is where split up coins go, ready to spend by the system.
// Accounts.deposit is where users send coins for cash out.
var Accounts = {
  funding: 'funding',
  pool: 'pool',
  deposit: 'deposit'
};

var Bitcoind = function(config) {
  this.config = config;

  var bitcoindConfiguration = parseBitcoinConfiguration(config.bitcoindConfigurationPath);

  var rpcConfig = {
    protocol: 'http',
    user: bitcoindConfiguration.rpcuser,
    pass: bitcoindConfiguration.rpcpassword,
    port: bitcoindConfiguration.testnet === 1 ? 18333 : 8333
  };
  this.rpc = new RpcClient(rpcConfig);
  this.account = '';
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

  var bitcoins = (satoshis / SATOSHI_FACTOR).toFixed(8);
  this.rpc.sendFrom(this.account, address, bitcoins, confirmations, 
      function(err, txId) {
    if (err) {
      if (err.code === -6) return cb(richError('Insufficient funds', 'InsufficientFunds'));
      if (err instanceof Error) return cb(err);
      return cb(richError(err.message, 'bitcoindError'));
    }

    cb(null, txId);
  });
};

Bitcoind.prototype.balance = function balance(cb) {
  this.accountBalance(Accounts.pool, cb);
};

function isEmptyBalance(balance) {
  return balance < EPSILON;
}

Bitcoind.prototype._accountBalance = function accountBalance(account, cb) {
  this.rpc.getBalance(account, 1, function (err, result) {
    if (err) return cb(err);
    if (result.error) return richError(result.error, 'bitcoindError');
    var satoshiBalance = Math.round(SATOSHI_FACTOR * result.result);
    cb(null, satoshiBalance);
  });  
};

Bitcoind.prototype.monitorAccount = function monitorAccount(account) {
  var self = this;
  this._accountBalance(account, function (err, balance) {
    if (err) return self.emit('error', err);
    if (isEmptyBalance(balance)) return;
    self._splitAccount(Accounts.funding, balance);
    self.emit('funded', account, balance);
  });
};

Bitcoind.prototype._addressReceived = function _addressReceived(address, confs, cb) {
  this.rpc.getReceivedByAddress(address, confs, function (err, result) {
    if (err) return cb(err);
    if (result.error) return richError(result.error, 'bitcoindError');
    cb(null, Math.round(result.result * SATOSHI_FACTOR));
  });    
};

Bitcoind.prototype.monitorDepositAddress = function monitorDepositAddress(address, confs, cb) {
  this._addressReceived(address, confs, function (err, received) {
    if (err) return cb(err);
    if (received === 0) return;
    cb(null, received);
  });
};

Bitcoind.prototype.newAddress = function newAddress(account, cb) {
  this.rpc.getNewAddress(account, function (err, result) {
    if (err) return cb(err);
    if (result.error) return richError(result.error, 'bitcoindError');
    cb(null, result.result);
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

  this.rpc.sendMany(account, addressMap, 1, function (err, result) {
    if (err) return cb(err);
    if (result.error) return richError(result.error, 'bitcoindError');
    cb(null, result.result);
  });    
};

Bitcoind.prototype._splitAccountTransaction = function _splitAccountTransaction(account, satoshis, cb) {
  var self = this;
  function newAddressFunc(i, next) {
    self.newAddress(Accounts.pool, function (err, address) {
      if (err) return next(err);
      next(null, address);
    });
  }

  async.times(PER_TRANSACTION_SPLIT_COUNT, newAddressFunc, function (err, addresses) {
    if (err) return cb(err);
    self._sendSplitTransaction(account, addresses, satoshis, function(err, txId) {
      if (err) return cb(err);
      cb(null, txId);
    });
  });
};

Bitcoind.prototype._splitAccount = function _splitAccount(account, balance) {
  var perTransactionSatoshis = Math.floor(balance / SPLIT_TRANSACTION_COUNT) - TRANSACTION_FEE_MARGIN;

  var self = this;
  function splitFunc(index, next) {
    self._splitAccountTransaction(account, perTransactionSatoshis, function (err, txId) {
      next(err, txId);
    });
  }

  async.times(SPLIT_TRANSACTION_COUNT, splitFunc, function (err, txIds) {
    if (err) return self.emit('error', err);
    self.emit('splitTx', txIds);
  });
};

