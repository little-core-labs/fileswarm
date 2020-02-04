const fileswarm = require('../../')
const crypto = require('crypto')
const from = require('random-access-storage-from')
const ram = require('random-access-memory')

const secret = crypto.randomBytes(fileswarm.SECRET_BYTES)
//const seed = fileswarm.seed(__filename, ram, { secret }, onseed)
const seed = fileswarm.seed('/home/werle/files/bunny.mp4', ram, { secret }, onseed)

function onseed(err) {
  if (err) { throw err }
  fileswarm.stat(seed.key, onstat)
}

function onstat(err, stats) {
  console.log(stats);
  console.log('key+secret=\n%s %s',
    seed.key.toString('hex'),
    secret.toString('hex'))
}
