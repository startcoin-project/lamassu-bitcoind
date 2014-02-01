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

bc._request = function(options, done) {
  var data = options.data;
  data.password = this.config.password;

  var postData = querystring.stringify(data);

  var req = https.request({
    hostname: this.domain,
    path: options.path,
    rejectUnauthorized: false,
    requestCert: true,
    agent: false,
    header: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': postData.length
    },
  }, function(res) {
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
    }).on('error', done);
  });

  req.on('error', done);
  req.end(postData);
};

bc.sendBitcoins = function(address, satoshis, transactionFee, done) {
  var data = {
    to: address,
    amount: satoshis,
    from: this.config.fromAddress
  };

  var postOptions = {
    path: '/merchant/' + this.config.guid + '/payment',
    method: 'POST',
    data: data
  };

  var req = this._request(postOptions, done);
};

bc.getBalance = function(confirmations, done) {
  var data = {
    address: this.config.fromAddress
  };

  if (confirmations > 0) {
    data.confirmations = confirmations;
  }

  var options = {
    path: '/merchant/' + this.config.guid + '/address_balance',
    method: 'POST',
    rejectUnauthorized: false,
    data: data
  };
  this._request(options, done);
};

bc.balance = function(done) {
  var self = this;
  // We want a balance that includes all spends (0 conf) but only deposits that
  // have at least 1 confirmation.
  self.getBalance(0, function(err, allspends) {
    if(err) {
      return done(err);
    }

    self.getBalance(1, function(err, confirmedDeposits) {
      if(err) {
        return done(err);
      }
      var unconfirmedDeposits = allspends.total_received - confirmedDeposits.total_received;
      done(null, allspends.balance - unconfirmedDeposits);
    });
  });
};

module.exports = Blockchain;

