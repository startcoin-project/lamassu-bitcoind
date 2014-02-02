'use strict';

// TODO: replace this, don't like the dependency
var errorCreate = require('error-create');

module.exports.SecurityError = errorCreate('SecurityError');
module.exports.InsufficentBitcoinsError = 
    errorCreate('InsufficientBitcoinsError');
