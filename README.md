fileswarm
=========

> Share and download files securely over a p2p network.

## Installation

```sh
$ npm install fileswarm
```

## Usage

```js
const fileswarm = require('fileswarm')
const crypto = require('crypto')
const ram = require('random-access-memory')

const secret = crypto.randomBytes(32)

const src = './path/to/source/file'
const dst = './path/to/destination/file'

// seeds `src` and broadcasts as an enciphered feed of bytes
// where each "block" in the feed stores a 24 byte nonce in
// a `seed.nonces` storage used for the cipher and that should
// be accessible to the downloader along with the
// corresponding shared secret
const seed = fileswarm.seed(src, ram, { secret }, (err) => {
  const { key, nonces } = seed
  // without `secret` and `nonces` the download cannot decipher the
  // seed's feed storage after verification
  fileswarm.download(dst, { key, nonces, secret }, (err) => {
    // `dst` points to decrypted file downloaded from seed
  })
})
```

## API

### `fileswarm.seed(pathspec, storage[, opts[, callback])`

> TODO

### `fileswarm.downloaded(storage[, opts[, callback]])`

> TODO

## License

MIT
