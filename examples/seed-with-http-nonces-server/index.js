const  { createServer } = require('random-access-http-server')
const fileswarm = require('../../')
const crypto = require('crypto')
const from = require('random-access-storage-from')
const ram = require('random-access-memory')

const nonces = ram()
const secret = crypto.randomBytes(fileswarm.SECRET_BYTES)
//const seed = fileswarm.seed(__filename, ram, { nonces, secret }, onseed)
const seed = fileswarm.seed('/home/werle/files/bunny.mp4', ram, { nonces, secret }, onseed)

const server = createServer({
  autoCloseStorage: false,
  storage(filename, opts, req) {
    console.log(req.headers.range);
    console.log(filename);
    return nonces
  }
})

server.listen(3000, onlistening)

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

function onlistening() {
  const { port } = server.address()
  console.log('listening on port %d', port)
}
