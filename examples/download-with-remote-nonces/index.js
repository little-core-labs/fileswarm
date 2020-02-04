const fileswarm = require('../..')

const secret = process.argv[3]
const key = process.argv[2]

console.log('key=', key);
console.log('secret=', secret);

fileswarm.stat(key, onstat)

let feed = null

function onstat(err, stats) {
  feed = fileswarm.download(stats.filename, { key, secret }, ondownload)
}

function ondownload(err) {
  console.log('download', err, feed.byteLength, feed.length, feed.downloaded());
}
