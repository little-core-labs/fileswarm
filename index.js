const hyperswarm = require('./hyperswarm')
const hypercore = require('hypercore')
const messages = require('./messages')
const assert = require('assert')
const crypto = require('crypto')
const debug = require('debug')('fileswarm')
const pump = require('pump')
const hook = require('hypercore-xsalsa20-onwrite-hook')
const from = require('random-access-storage-from')
const file = require('hypercore-indexed-file')
const lpm = require('length-prefixed-message')
const raf = require('random-access-file')
const ram = require('random-access-memory')

/**
 * Size in bytes of the expected buffer size for the shared
 * secret key.
 * @public
 */
const SECRET_BYTES = 32

/**
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
        onwrite: opts.onwrite,
        secretKey: source.secretKey
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

    const hello = messages.Hello.encode({ id })

    lpm.write(connection, hello)
    lpm.read(connection, (res) => {
      const remoteHello = messages.Hello.decode(res)
      const dropped = info.deduplicate(id, remoteHello.id)
      if (!dropped) {
        const stream = false !== opts.channel && opts.onwrite
          ? channel.replicate(info.client)
          : source.replicate(info.client)

        pump(stream, connection, stream)
      }
    })
  }
}

/**
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

    assert(opts.nonces && 'object' === typeof opts.nonces,
      'Expecting `opts.nonces` to be a RandomAccessStorage object.')

    const { secret } = opts
    assert(Buffer.isBuffer(secret) && SECRET_BYTES === secret.length,
      'Expecting `opts.secret` to be a 32 byte buffer.')

    opts.onwrite = hook(opts.nonces, opts.secret)
  }

  const swarm = hyperswarm()
  const feed = hypercore(createStorage, opts.key, opts)
  const { id = crypto.randomBytes(32) } = opts

  swarm.on('connection', onconnection)

  feed.ready(onready)
  feed.on('close', onclose)

  return feed

  function createStorage(filename) {
    if ('data' === filename) {
      if ('string' === typeof storage) {
        return raf(storage, { truncate: opts.truncate })
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
      } else {
        feed.once('sync', () => {
          callback(null)
        })
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
      if (!dropped) {
        pump(connection, feed.replicate(info.client), connection)
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
  seed
}
