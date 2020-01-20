const fileswarm = require('../../')
const crypto = require('crypto')
const ram = require('random-access-memory')

const nonces = ram()
const secret = crypto.randomBytes(fileswarm.SECRET_BYTES)
const seed = fileswarm.seed(__filename, ram, { nonces, secret }, onseed)

function onseed(err) {
  if (err) { throw err }
  fileswarm.stat(seed.key, onstat)
}

function onstat(err, stats) {
  console.log(err, stats);
  seed.close()
}
