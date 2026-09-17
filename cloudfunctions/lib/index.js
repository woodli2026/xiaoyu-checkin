// cloudfunctions/lib/index.js —— 纯逻辑汇总出口（不含 wx-server-sdk，可被 node:test 直接单测）
module.exports = Object.assign({},
  require('./util'),
  require('./streak'),
  require('./level'),
  require('./token'),
  require('./pin'),
  require('./visibility'),
  require('./checkInCore'),
  require('./redeemCore')
);
