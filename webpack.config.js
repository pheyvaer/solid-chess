const path = require('path');

module.exports = {
  entry: './index.js',
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist')
  },
  mode: 'development',
  // externals: {
  //   'node-fetch': 'fetch',
  //   'text-encoding': 'TextEncoder',
  //   'whatwg-url': 'window',
  //   'isomorphic-fetch': 'fetch',
  //   '@trust/webcrypto': 'crypto'
  // }
};
