const isBrowser = require('is-browser')

/**
 * Branching factory for `hyperswarm` and `hyperswarm-web`
 * depending on the run time context.
 * @public
 * @default
 * @param {...Mixed} ...args
 * @return {Hyperswarm}
 */
function createHyperswarm(...args) {
  if (isBrowser) {
    return require('hyperswarm-web')(...args)
  } else {
    return require('hyperswarm')(...args)
  }
}

/**
 * Module exports.
 */
module.exports = createHyperswarm
