'use strict';

var fs = require('fs');
var bitcore = require('bitcore');
var RpcClient = bitcore.RpcClient;

var SATOSHI_FACTOR = 1e8;

var Bitcoind = function(config) {
  this.config = config;

  var bitcoindConfiguration = parseBitcoinConfiguration(config.bitcoindConfigurationPath);

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
  console.log('bitcoins: %s', bitcoins);
  this.rpc.sendFrom(this.account, address, bitcoins, confirmations, 
      function(err, res) {
    if (err) {
      if (err.code === -6) return cb(richError('Insufficient funds', 'InsufficientFunds'));
      if (err instanceof Error) return cb(err);
      return cb(richError(err.message, 'bitcoindError'));
    }

    cb(null, res.result);
  });
};

// We want a balance that includes all spends (0 conf) but only deposits that
// have at least 1 confirmation. getbalance does this for us automatically.
Bitcoind.prototype.balance = function balance(cb) {
  this.rpc.getBalance(this.account, 1, function(err, result) {
    if (err) return cb(err);
    if (result.error) return richError(result.error, 'bitcoindError');
    var satoshiBalance = Math.round(SATOSHI_FACTOR * result.result);
    cb(null, satoshiBalance);
  });
};

module.exports = Bitcoind;
