const fileswarm = require('../..')

const nonces = 'http://werle.dev:3000'
const secret = process.argv[3]
const key = process.argv[2]

console.log('key=', key);
console.log('secret=', secret);
console.log('nonces=', nonces);

fileswarm.stat(key, onstat)

let feed = null

function onstat(err, stats) {
  feed = fileswarm.download(stats.filename, { key, secret, nonces }, ondownload)
}

function ondownload(err) {
  console.log('download', err, feed.byteLength, feed.length, feed.downloaded());
}
