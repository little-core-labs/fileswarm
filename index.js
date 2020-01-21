const strongLink = require('hypercore-strong-link')
const hyperswarm = require('./hyperswarm')
const hypercore = require('hypercore')
const messages = require('./messages')
const request = require('hypercore-block-request')
const assert = require('assert')
const crypto = require('hypercore-crypto')
const Batch = require('batch')
const debug = require('debug')('fileswarm')
const pump = require('pump')
const hook = require('hypercore-xsalsa20-onwrite-hook')
const from = require('random-access-storage-from')
const file = require('hypercore-indexed-file')
const path = require('path')
const lpm = require('length-prefixed-message')
const ram = require('random-access-memory')

/**
 * The `Stats` class represents a container for seed information
 * like the size of the feed in bytes or how many blocks are in it.
 * @private
 * @class
 */
class Stats {

  /**
   * `Stats` class constructor.
   * @param {Object} hello
   */
  constructor(hello) {
    this.key = hello.link && hello.link.feed
    this.size = hello.byteLength
    this.blocks = hello.length
    this.filename = hello.filename
  }
}

/**
 * Size in bytes of the expected buffer size for the shared
 * secret key.
 * @public
 */
const SECRET_BYTES = 32

/**
 * Seed file at `pathspec` where `pathspec` can be a local file path or a
 * HTTP URL. The underlying [hypercore][hypercore] `storage` must be
 * specified as the enciphered file at `pathspec` is stored there and
 * replicated in the [network swarm][hyperswarm]. If a shared secret is
 * given then the data stored in the underlying feed is encrypted. Readers
 * must be given access to the shared secret as well as a
 * [random-access-storage][ras] instance containing the nonces created by
 * the seeder. When indexing and seeding is complete, `callback()` will be
 * called. `callback(err)` is also called when an error occurs.
 *
 * @public
 * @param {String} pathspec
 * @param {Function<RandomAccessStorage>|String} storage
 * @param {?(Object)} opts
 * @param {?(String|Buffer)} opts.secret
 * @param {?(RandomAccessStorage)} opts.nonces
 * @param {?(Boolean)} [opts.channel = true]
 * @param {?(Function)} callback
 * @return {Hypercore}
 */
function seed(pathspec, storage, opts, callback) {
  assert(pathspec && 'string' === typeof pathspec,
    'Expecting pathspec to be a string.')

  assert('function' === typeof storage || 'string' === typeof storage,
    'Expecting storage to be a string or a factory a function.')

  if ('function' === typeof opts) {
    callback = opts
    opts = {}
  }

  opts = Object.assign({}, opts) // copy

  if (!opts.onwrite && opts.secret) {
    if (!opts.nonces) {
      opts.nonces = ram()
    }

    // convert string secret to buffer, assuming 'hex' encoding
    if ('string' === typeof opts.secret) {
      opts.secret = Buffer.from(opts.secret, 'hex')
    }

    assert(opts.nonces && 'object' === typeof opts.nonces,
      'Expecting `opts.nonces` to be a RandomAccessStorage object.')

    if (!opts.secret) {
      opts.secret = crypto.randomBytes(SECRET_BYTES)
    } else {
      const { secret } = opts
      assert(Buffer.isBuffer(secret) && SECRET_BYTES === secret.length,
        'Expecting `opts.secret` to be a 32 byte buffer.')
    }

    opts.onwrite = hook(opts.nonces, opts.secret)
  }

  const { nonces = null, secret = null } = opts
  const { highWaterMark } = opts
  const { id = crypto.randomBytes(32) } = opts

  const connections = new Set()
  const source = file(pathspec, { highWaterMark }, onindexed)
  const swarm = hyperswarm()

  let channel = null

  swarm.on('connection', onconnection)

  source.on('close', onclose)

  return Object.defineProperties(source, Object.getOwnPropertyDescriptors({
    nonces,
    secret,

    get pathspec() {
      return pathspec
    },

    get swarm() {
      return swarm
    },

    get channel() {
      return channel
    }
  }))

  function onerror(err) {
    if ('function' === typeof callback) {
      callback(err)
    } else {
      throw err
    }
  }

  function onclose() {
    if (channel) {
      channel.close()
      channel = null
    }

    swarm.destroy()
  }

  function onindexed(err) {
    if (err) {
      onerror(err)
    } else if (false !== opts.channel && opts.onwrite) {
      channel = hypercore(storage, source.key, {
        secretKey: source.secretKey,
        onwrite: opts.onwrite,
        sparse: true
      })

      channel.ready(() => {
        const reader = source.createReadStream()
        const writer = channel.createWriteStream()
        pump(reader, writer, onpumped)
      })
    } else {
      swarm.join(source.discoveryKey, {
        announce: true,
        lookup: true
      })

      if ('function' === typeof callback) {
        process.nextTick(callback, null)
      }
    }
  }

  function onpumped(err) {
    if (err) {
      onerror(err)
    } else {
      swarm.join(channel.discoveryKey, {
        announce: true,
        lookup: true,
      })

      if ('function' === typeof callback) {
        process.nextTick(callback, null)
      }
    }
  }

  function onconnection(connection, info) {
    info.stream.on('error', debug)

    if (false !== opts.channel && opts.onwrite && channel) {
      strongLink.generate(channel, channel.length - 1, onlink)
    } else {
      strongLink.generate(source, source.length - 1, onlink)
    }

    function onlink(err, link) {
      if (err) {
        debug(err)
        source.emit('error', err)
        connection.end()
        return
      }

      const { byteLength, length } = channel
      const filename = path.basename(pathspec)
      const hello = messages.Hello.encode({
        id,
        link,
        length,
        byteLength,
        filename,
        pathspec
      })

      lpm.write(connection, hello)
      lpm.read(connection, (res) => {
        const remoteHello = messages.Hello.decode(res)
        const dropped = info.deduplicate(id, remoteHello.id)
        if (!dropped) {
          if (false !== opts.channel && opts.onwrite && !channel) {
            connection.end()
            return
          }

          const stream = false !== opts.channel && opts.onwrite
            ? channel.replicate(info.client, { upload: true, download: false })
            : source.replicate(info.client, { upload: true, download: false })

          pump(stream, connection, stream)
        }
      })
    }
  }
}

/**
 * Share a seeded feed.
 * @public
 * @param {String|Buffer} key
 * @param {String|Function<RandomAccessStorage>} storage
 * @param {Object} opts
 */
function share(storage, key, opts) {
  assert('function' === typeof storage || 'string' === typeof storage,
    'Expecting storage to be a string or a factory a function.')

  if (key && 'object' === typeof key && !Buffer.isBuffer(key)) {
    opts = key
    key = opts.key || null
  }

  opts = Object.assign(opts, {}) // copy

  const { id = crypto.randomBytes(32) } = opts
  const swarm = hyperswarm()
  const feed = hypercore(storage, key, opts)

  // discovered on first hello
  let pathspec = null
  let filename = null

  feed.ready(onready)

  return feed

  function onready() {
    swarm.join(feed.discoveryKey, { announce: true })
    swarm.on('connection', onconnection)
  }

  function onconnection(connection, info) {
    info.stream.on('error', debug)

    if (feed.length) {
      strongLink.generate(feed, feed.length - 1, onlink)
    } else {
      onlink(null, null)
    }

    function onlink(err, link) {
      if (err) {
        debug(err)
        feed.emit('error', err)
        connection.end()
        return
      }

      const { byteLength, length } = feed
      const hello = messages.Hello.encode({
        id,
        link,
        length,
        byteLength,
        filename,
        pathspec
      })

      lpm.write(connection, hello)
      lpm.read(connection, (res) => {
        const remoteHello = messages.Hello.decode(res)
        const dropped = info.deduplicate(id, remoteHello.id)

        if (!dropped) {
          connection.end()
          return
        }

        if (remoteHello.filename) {
          filename = remoteHello.filename
        }

        if (remoteHello.pathspec) {
          pathspec = remoteHello.pathspec
        }

        const stream = feed.replicate(info.client, {
          download: true,
          upload: true,
          live: true
        })

        pump(stream, connection, stream)
      })
    }
  }
}

/**
 * Download a seeded/shared feed into a specified storage.
 * @public
 * @param {Object} opts
 * @param {?(String|Buffer)} opts.secret
 * @param {?(RandomAccessStorage)} opts.nonces
 * @param {?(Boolean)} opts.truncate
 * @return {Hypercore}
 */
function download(storage, opts, callback) {
  opts = Object.assign({}, opts) // copy

  if (!opts.onwrite && opts.secret) {
    if (!opts.nonces) {
      opts.nonces = ram()
    }

    // convert string secret to buffer, assuming 'hex' encoding
    if ('string' === typeof opts.secret) {
      opts.secret = Buffer.from(opts.secret, 'hex')
    }

    if ('string' === typeof opts.nonces) {
      opts.nonces = from(opts.nonces)
    }

    assert(opts.nonces && 'object' === typeof opts.nonces,
      'Expecting `opts.nonces` to be a RandomAccessStorage object.')

    const { secret } = opts
    assert(Buffer.isBuffer(secret) && SECRET_BYTES === secret.length,
      'Expecting `opts.secret` to be a 32 byte buffer.')

    opts.onwrite = hook(opts.nonces, opts.secret)
  }

  const { id = crypto.randomBytes(32) } = opts
  const swarm = hyperswarm()
  const feed = hypercore(createStorage, opts.key, {
    onwrite: opts.onwrite,
    sparse: true
  })

  swarm.on('connection', onconnection)

  feed.ready(onready)
  feed.on('close', onclose)

  return feed

  function createStorage(filename) {
    if ('data' === filename) {
      if ('string' === typeof storage) {
        return from.providers.file(storage, { truncate: opts.truncate })
      } else {
        return from(storage)
      }
    } else {
      return (opts.storage || ram)(filename)
    }
  }

  function onclose() {
    swarm.destroy()
  }

  function onready() {
    swarm.join(feed.discoveryKey, {
      announce: true,
      lookup: true
    })

    if ('function' === typeof callback) {
      if (feed.length && feed.length === feed.downloaded()) {
        callback(null)
      }
    }
  }

  function onconnection(connection, info) {
    info.stream.on('error', debug)

    const hello = messages.Hello.encode({ id })
    lpm.write(connection, hello)
    lpm.read(connection, (res) => {
      const remoteHello = messages.Hello.decode(res)
      const dropped = info.deduplicate(id, remoteHello.id)
      if (!dropped && remoteHello.id && remoteHello.link && remoteHello.length) {
        const stream = feed.replicate(info.client, {
          download: true,
          upload: false,
          live: true
        })

        pump(connection, stream, connection)

        strongLink.verify(feed, remoteHello.link, (err, data) => {
          if (err) {
            debug(err)
            source.emit('error', err)
            connection.end()
          } else {
            const downloaded = new Set()
            const ondownload = (i) => downloaded.add(i)

            feed.on('download', ondownload)

            request(feed, { start: 0, linear: false, end: feed.length }, (err) => {
              if (err) { return callback(err) }

              const missing = new Batch()

              // "get" missing blocks
              for (let i = 0; i < feed.length; ++i) {
                if (false === downloaded.has(i)) {
                  missing.push((next) => feed.get(i, (err) => next(err)))
                }
              }

              feed.removeListener('download', ondownload)
              missing.end(callback)
            })
          }
        })
      } else {
        connection.end()
      }
    })
  }
}

/**
 * Query for stats about a seeded/shared feed specified by a
 * Hypercore key.
 * @public
 * @param {String|Buffer} key
 * @param {Function} callback
 */
function stat(key, callback) {
  assert('string' === typeof key || (Buffer.isBuffer(key) && 32 === key.length),
    'Expecting key to be a string or buffer.')

  assert('function' === typeof callback,
    'Expecting callback to be a function.')

  const discoveryKey = crypto.discoveryKey(Buffer.from(key, 'hex'))
  const swarm = hyperswarm()
  const id = crypto.randomBytes(32)

  swarm.join(discoveryKey, {
    announce: false,
    lookup: true
  })

  swarm.on('connection', onconnection)

  function onconnection(connection, info) {
    lpm.read(connection, (res) => {
      try {
        const remoteHello = messages.Hello.decode(res)
        const stats = new Stats(remoteHello)
        swarm.removeListener('connection', onconnection)
        swarm.destroy()
        callback(null, stats)
      } catch (err) {
        callback(err)
      }
    })
  }
}

/**
 * Module exports.
 */
module.exports = {
  SECRET_BYTES,

  download,
  share,
  seed,
  stat
}
