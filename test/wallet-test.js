'use strict';

var assert = require('chai').assert;

var bitcore = require('bitcore');
var Address = bitcore.Address;
var Bitcoind = require('../lib/wallet.js');

describe('Bitcoind', function() {
  var bitcoind = null;
  before(function () {
    bitcoind = Bitcoind.factory({bitcoindConfigurationPath: 'test/bitcoin.conf'});
    bitcoind.testMode = true;
  });

  beforeEach(function (done) {
    bitcoind.rpc.getBalance('funding', 0, function (err, result) {
      if (err) throw err;
      var balance = result.result;
      if (balance == 0) return done();
      bitcoind.rpc.move('funding', 'stash', balance, 0, function (err) {
        if (err) throw err;
        done();
      });
    });
  });

  afterEach(function () {
    bitcoind.removeAllListeners();
  });

  describe('#newAddress', function () {
    it('should return a valid Bitcoin address', function(done) {
      bitcoind.newAddress('testAccount', function (err, addr) {
        assert.isNull(err);
        assert.ok(new Address(addr).isValid());
        done();
      });
    });
  });

  describe('#monitorDepositAddress', function() {
    it('should return 0 satoshis for a new address', function(done) {
      bitcoind.newAddress('testAccount', function (err, addr) {
        bitcoind.monitorDepositAddress(addr, 0, function (err, satoshis) {
          assert.isNull(err);
          assert.equal(satoshis, 0);
          done();
        });
      });
    });

    it('should return an error for bad address', function(done) {
      bitcoind.monitorDepositAddress('bogus', 0, function (err) {
        assert.isNotNull(err);
        assert.equal(err.code, -5);
        done();
      });
    });

    it('should return zero for non-existant address', function(done) {
      bitcoind.monitorDepositAddress('moKFmN5DtxKpFwnJ3vULBjuGxaVKMB6tG3', 0, function (err, satoshis) {
        assert.isNull(err);
        assert.equal(satoshis, 0);
        done();
      });
    });

    it('should return the correct amount in satoshis', function(done) {
      var bitcoinAmount = 0.001;
      var satoshiAmount = Math.round(bitcoinAmount * 1e8);
      bitcoind.newAddress('testAccount', function (err, addr) {
        bitcoind.rpc.sendFrom('stash', addr, bitcoinAmount, 0, function (err) {
          if (err) throw err;
          bitcoind.monitorDepositAddress(addr, 0, function (err, satoshis) {
            assert.isNull(err);
            assert.equal(satoshis, satoshiAmount);
            done();
          });          
        });
      });
    });
  });

  describe('#monitorAccount', function() {
    it('should do nothing on empty account', function(done) {
      bitcoind.once('error', function () {
        assert.fail('shouldn\'t have errored');
      });
      bitcoind.once('funded', function () {
        assert.fail('funding account should be empty');
      });
      bitcoind.monitorAccount('empty', function (err, balance) {
        assert.isNull(err);
        assert.isNull(balance);
        done();
      });
    });
  });

  describe('#monitorAccount', function() {
    it('should emit "funded" event on funded account', function(done) {
      var fundEmitted = null;
      var satoshiAmount = 10 * Bitcoind.EPSILON;
      var bitcoinAmount = satoshiAmount / 1e8;

      bitcoind.once('error', function () {
        assert.fail('shouldn\'t have errored');
      });
      bitcoind.once('funded', function (account, balance) {
        fundEmitted = {account: account, balance: balance};
      });
      bitcoind.newAddress('funding', function (err, addr) {
        bitcoind.rpc.sendFrom('stash', addr, bitcoinAmount, 0, function (err) {
          if (err) throw err;
          bitcoind.monitorAccount('funding', function (err, balance) {
            if (err) throw err;
            assert.isNull(err);
            assert.equal(balance, satoshiAmount);
            assert.equal(fundEmitted.balance, satoshiAmount);
            assert.equal(fundEmitted.account, 'funding');
            done();              
          });
        });
      });
    });
  });

});
