const path = require('path');

module.exports = {
  entry: './web-app/index.js',
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'web-app/dist')
  },
  mode: 'development',
  externals: {
    'node-fetch': 'fetch',
    'text-encoding': 'TextEncoder',
    'whatwg-url': 'window',
    'isomorphic-fetch': 'fetch',
    '@trust/webcrypto': 'crypto',
    'fs': 'empty'
  }
};
