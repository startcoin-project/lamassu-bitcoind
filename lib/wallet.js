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

var https = require('https');
var querystring = require('querystring');

function Blockchain(config, domain) {
  if(!(this instanceof Blockchain)) {
    return new Blockchain(config, domain);
  }
  this.config = config;
  this.domain = domain || 'blockchain.info';
}

Blockchain.factory = function factory(config) {
  return new Blockchain(config);
};


var bc = Blockchain.prototype;

bc.setDomain = function(domain) {
  this.domain = domain;
};

bc.sendBitcoins = function(address, satoshis, transactionFee, done) {
  var postData = querystring.stringify({
    password: this.config.password,
    to: address,
    amount: satoshis,
    from: this.config.fromAddress
  });

  var postOptions = {
    hostname: this.domain,
    port: 3001,
    path: '/merchant/' + this.config.guid + '/payment',
    method: 'POST',
    rejectUnauthorized: false,
    requestCert: true,
    agent: false,
    header: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': postData.length
    }
  };

  var req = https.request(postOptions, function(res) {
    res.setEncoding('utf8');
    var buf = '';
    res.on('data', function (chunk) {
      buf += chunk;
    }).on('end', function() {
      var json = null;
      try {
        json = JSON.parse(buf);
      } catch(e) {
        return done(new Error('Couldn\'t parse JSON response'));
      }
      done(null, json.tx_hash);
    }).on('error', function(e){
      done(e);
    });
  });

  req.end(postData);
};

bc.balance = function(done) {
  var self = this;
  // We want a balance that includes all spends (0 conf) but only deposits that
  // have at least 1 confirmation.
  _checkBalance(0, self.domain, self.config, function(err, allspends) {
    if(err) {
      return done(err);
    }

    _checkBalance(1, self.domain, self.config, function(err, confirmedDeposits) {
      if(err) {
        return done(err);
      }
      var unconfirmedDeposits = allspends.total_received - confirmedDeposits.total_received;
      done(null, allspends.balance - unconfirmedDeposits);
    });
  });
};

function _checkBalance(conf, domain, config, done) {
  var data = {
    password: config.password,
    address: config.fromAddress
  };

  if (conf > 0) {
    data.confirmations = conf;
  }

  var postData = querystring.stringify(data);

  var postOptions = {
    hostname: domain,
    port: 3001,
    path: '/merchant/' + config.guid + '/address_balance',
    method: 'POST',
    rejectUnauthorized: false,
    requestCert: true,
    agent: false,
    header: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': postData.length
    }
  };

  var req = https.request(postOptions, function(res) {
    res.setEncoding('utf8');
    var buf = '';
    res.on('data', function(chunk){
      buf += chunk;
    }).on('end', function() {
      var json = null;
      try {
        json = JSON.parse(buf);
      } catch(e) {
        return done(new Error('Couldn\'t parse JSON response'));
      }
      done(null, json);
    }).on('error', function(e){
      done(e);
    });
  });

  req.end(postData);
}

module.exports = Blockchain;

