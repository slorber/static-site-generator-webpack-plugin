var StaticSiteGeneratorPlugin = require('../../../');

module.exports = {

  entry: {
    main: __dirname + '/index.js'
  },

  output: {
    filename: 'index.js',
    path: __dirname + '/actual-output',
    publicPath: '/',
    libraryTarget: 'umd'
  },

  plugins: [
    new StaticSiteGeneratorPlugin({
      entry: 'THIS_DOESNT_EXIST',
      paths: ['/']
    })
  ]

};
