'use strict';

var https = require('https');
var querystring = require('querystring');
var _ = require('lodash');

// TODO: set in config
var NETWORK_TIMEOUT = 20000;

var QuickHttps = {};

QuickHttps.post = function post(hostname, path, data, callback) {
  var onceCallback = _.once(callback);
  var payload = querystring.stringify(data);
  var options = {
    hostname: hostname,
    path: path,
    method: 'POST',
    rejectUnauthorized: false,
    requestCert: true,
    agent: false,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': payload.length
    }
  };

  var req = https.request(options, function(res) {
    var buf = '';
    res.setEncoding('utf8');
    res.on('data', function (chunk) {
      buf += chunk;
    })
    .on('end', function(){
      QuickHttps._handleResponse(buf, onceCallback);
    })
    .on('error', onceCallback);
  });

  req.setTimeout(NETWORK_TIMEOUT, function() {
    req.abort();
    return onceCallback(new Error('Network Timeout'));
  });
  req.on('error', onceCallback);
  req.end(payload);
};

QuickHttps.get = function get(hostname, path, callback) {
  var onceCallback = _.once(callback);
  var options = {
    hostname: hostname,
    path: path,
    method: 'GET'
  };

  var req = https.request(options, function(res) {
    var buf = '';
    res.setEncoding('utf8');
    res.on('data', function (chunk) {
      buf += chunk;
    })
    .on('end', function(){
      QuickHttps._handleResponse(buf, onceCallback);
    })
    .on('error', onceCallback);
  });

  req.setTimeout(NETWORK_TIMEOUT, function() {
    req.abort();
    return onceCallback(new Error('Network Timeout'));
  });
  req.on('error', onceCallback);
  req.end();
};

QuickHttps._handleResponse = function _handleResponse(data, cb) {
  var json = null;
  try { json = JSON.parse(data); }
  catch(e) { cb(e); return; }
  cb(null, json);
};

module.exports = QuickHttps;
