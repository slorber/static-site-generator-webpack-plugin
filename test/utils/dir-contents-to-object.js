const { promisify } = require('util');
const readFilesAsync = promisify(require('node-dir').readFiles);
const { relative } = require('path');

module.exports = dirname => {
  const files = {};

  const handleFile = (err, content, filePath, next) => {
    if (err) throw err;

    const relativeFilePath = relative(dirname, filePath)
      // win32
      .replace(/\\/g, '/');

    files[relativeFilePath] = /\.html?$/.test(relativeFilePath)
      ? content
      : 'CONTENTS IGNORED IN SNAPSHOT TEST';

    next();
  };

  return readFilesAsync(dirname, handleFile).then(() => files);
};
