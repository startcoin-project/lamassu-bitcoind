'use strict';

var fs = require('fs');
var bitcore = require('bitcore');
var RpcClient = bitcore.RpcClient;

var SATOSHI_FACTOR = Math.pow(10, 8);

var Bitcoind = function(config) {
  this.config = config;

  var bitcoindConfiguration = parseBitcoinConfiguration('<path>');
  var rpcConfig = {
    protocol: 'http',
    user: bitcoindConfiguration.rpcuser,
    pass: bitcoindConfiguration.rpcpassword
  };
  this.rpc = new RpcClient(rpcConfig);
  this.account = '';
};
Bitcoind.factory = function factory(config) {
  return new Bitcoind(config);
};

function richError(msg, flavor) {
  var err = new Error(msg);
  err.flavor = flavor;
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
  this.rpc.sendFrom(this.account, address, satoshis / SATOSHI_FACTOR, confirmations, 
      function(err, txId) {
    if (err) {
      // TODO: check how error reporting is done here
      // FIX: This is a strange result structure. See if node-bitcoin can be fixed.
//      var errCode = _.values(err)[0];
//      if (errCode === -6)   // See: https://github.com/bitcoin/bitcoin/blob/master/src/rpcprotocol.h
//        return cb(richError('Insufficient funds', 'insufficientFunds'));

      // TODO: change lamassu-server to use rich errors instead of appErr

      return cb(err);
    }

    cb(null, txId);
  });
};

// We want a balance that includes all spends (0 conf) but only deposits that
// have at least 1 confirmation. getbalance does this for us automatically.
Bitcoind.prototype.balance = function balance(cb) {
  this.rpc.getBalance(this.account, 1, function(err, balance) {
    if (err) return cb(err);
    cb(null, balance * SATOSHI_FACTOR);
  });
};

module.exports = Bitcoind;
