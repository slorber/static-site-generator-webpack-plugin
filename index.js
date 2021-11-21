const RawSource = require('webpack-sources/lib/RawSource');
const evaluate = require('eval');
const path = require('path');
const cheerio = require('cheerio');
const url = require('url');

const pluginName = 'static-site-generator-webpack-plugin'

class StaticSiteGeneratorWebpackPlugin {
  constructor(options) {
    if (arguments.length > 1) {
      options = legacyArgsToOptions.apply(null, arguments);
    }

    options = options || {};

    this.entry = options.entry;
    this.paths = Array.isArray(options.paths) ? options.paths : [options.paths || '/'];
    this.locals = options.locals;
    this.globals = options.globals;
    this.crawl = Boolean(options.crawl);
    this.preferFoldersOutput = options.preferFoldersOutput;
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
      compilation.hooks.optimizeAssets.tapAsync(
        pluginName,
        (_, done) => {
          const webpackStats = compilation.getStats();
          const webpackStatsJson = webpackStats.toJson({ all: false, assets: true }, true);

          try {
            const asset = findAsset(this.entry, compilation, webpackStatsJson);

            if (asset == null) {
              throw new Error(`Source file not found: "${this.entry}"`);
            }

            const assets = getAssetsFromCompilation(compilation, webpackStatsJson);

            const source = asset.source();
            let render = evaluate(
                source,
                /* filename: */ this.entry,
                /* scope: */ this.globals,
                /* includeGlobals: */ true
            );

            if (render.hasOwnProperty('default')) {
              render = render['default'];
            }

            if (typeof render !== 'function') {
              throw new Error(`Export from "${this.entry}" must be a function that returns an HTML string. Is output.libraryTarget in the configuration set to "umd"?`);
            }

            renderPaths(this.crawl, this.locals, this.paths, render, assets, webpackStats, compilation, this.preferFoldersOutput)
              .then((res) => {
                done(null, res);
              }, (err) => {
                done(err);
              });
          } catch (err) {
            compilation.errors.push(err.stack);
            done();
          }
        }
      );
    });
  }
}

function renderPaths(crawl, userLocals, paths, render, assets, webpackStats, compilation, preferFoldersOutput) {
  const renderPromises = paths.map((outputPath) => {
    const locals = {
      path: outputPath,
      assets,
      webpackStats,
    };

    for (const prop in userLocals) {
      if (userLocals.hasOwnProperty(prop)) {
        locals[prop] = userLocals[prop];
      }
    }

    const renderPromise = render.length < 2
      ? Promise.resolve(render(locals))
      : new Promise((resolve, reject) => {
          render(locals, (err, succ) => {
            if (err) {
              return reject(err)
            }
            return resolve(succ)
          })
        });

    return renderPromise
      .then((output) => {
        const outputByPath = typeof output === 'object' ? output : { [outputPath]: output } ;

        const assetGenerationPromises = Object.keys(outputByPath).map((key) => {
          const rawSource = outputByPath[key];
          const assetName = pathToAssetName(key, preferFoldersOutput);
          // console.log("pathToAssetName: " + key + " => " + assetName);

          if (compilation.assets[assetName]) {
            return;
          }

          compilation.assets[assetName] = new RawSource(rawSource);

          if (crawl) {
            const relativePaths = relativePathsFromHtml({
              source: rawSource,
              path: key,
            });

            return renderPaths(crawl, userLocals, relativePaths, render, assets, webpackStats, compilation, preferFoldersOutput);
          }
        });

        return Promise.all(assetGenerationPromises);
      })
      .catch((err) => {
        compilation.errors.push(err.stack);
      });
  });

  return Promise.all(renderPromises);
}

function findAsset(src, { assets }, { assetsByChunkName }) {
  if (!src) {
    const chunkNames = Object.keys(assetsByChunkName);

    src = chunkNames[0];
  }

  const asset = assets[src];

  if (asset) {
    return asset;
  }

  let chunkValue = assetsByChunkName[src];

  if (!chunkValue) {
    return null;
  }
  // Webpack outputs an array for each chunk when using sourcemaps
  if (chunkValue instanceof Array) {
    // Is the main bundle always the first element?
    chunkValue = chunkValue.find((filename) => /\.js$/.test(filename));
  }
  return assets[chunkValue];
}

// Shamelessly stolen from html-webpack-plugin - Thanks @ampedandwired :)
function getAssetsFromCompilation({ options }, { assetsByChunkName }) {
  const assets = {};
  for (const chunk in assetsByChunkName) {
    let chunkValue = assetsByChunkName[chunk];

    // Webpack outputs an array for each chunk when using sourcemaps
    if (chunkValue instanceof Array) {
      // Is the main bundle always the first JS element?
      chunkValue = chunkValue.find((filename) => /\.js$/.test(filename));
    }

    if (options.output.publicPath) {
      chunkValue = options.output.publicPath + chunkValue;
    }
    assets[chunk] = chunkValue;
  }

  return assets;
}

function pathToAssetName(outputPath, preferFoldersOutput) {
  const outputFileName = outputPath.replace(/^(\/|\\)/, ''); // Remove leading slashes for webpack-dev-server

  // Paths ending with .html are left untouched
  if (/\.(html?)$/i.test(outputFileName)) {
    return outputFileName;
  }

  // Legacy retro-compatible behavior
  if (typeof preferFoldersOutput === 'undefined') {
    return path.join(outputFileName, 'index.html');
  }

  // New behavior: we can say if we prefer file/folder output
  // Useful resource: https://github.com/slorber/trailing-slash-guide
  if (outputPath === '' || outputPath.endsWith('/') || preferFoldersOutput) {
    return path.join(outputFileName, 'index.html');
  } else {
    return `${outputFileName}.html`;
  }
}

function relativePathsFromHtml(options) {
  const html = options.source;
  const currentPath = options.path;

  const $ = cheerio.load(html);

  const linkHrefs = $('a[href]')
      .map((i, el) => $(el).attr('href'))
      .get();

  const iframeSrcs = $('iframe[src]')
      .map((i, el) => $(el).attr('src'))
      .get();

  return []
      .concat(linkHrefs)
      .concat(iframeSrcs)
      .map((href) => {
        if (href.indexOf('//') === 0) {
          return null;
        }

        const parsed = url.parse(href);

        if (parsed.protocol || typeof parsed.path !== 'string') {
          return null;
        }

        return parsed.path.indexOf('/') === 0 ? parsed.path : url.resolve(currentPath, parsed.path);
      })
      .filter((href) => href != null);
}

function legacyArgsToOptions(entry, paths, locals, globals) {
  return {
    entry,
    paths,
    locals,
    globals,
  };
}

module.exports = StaticSiteGeneratorWebpackPlugin;
