fileswarm
=========

> Seed, share, and download files securely over a p2p network.

## Installation

```sh
$ npm install fileswarm
```

## Usage

```js
// seed a file encrypted with `secret`
feed = fileswarm.seed('/path/to/file/to/seed', storage, { secret }, callback)

// TODO
```

## API

### `feed = fileswarm.seed(pathspec, storage[, opts[, callback])`

> TODO

```js
const fileswarm = require('fileswarm')
const crypto = require('crypto')
const path = require('path')
const raf = require('random-access-file')
const ram = require('random-access-memory')
const fs = require('fs')

const pathspec = 'http://humanstxt.org/humans.txt'
const filename = path.basename(pathspec)
const secret = crypto.randomBytes(32) // share this
const seed = fileswarm.seed(pathspec, ram, { secret }, onseed)

function onseed(err) {
  if (err) throw err

  const basename = path.basename(seed.pathspec)
  const keyFile = basename + '.key'

  fs.writeFile(keyFile, secret, () => { ... })
}
```

### `feed = fileswarm.download(storage[, opts[, callback]])`

> TODO

### `feed = fileswarm.share(storage[, opts])`

> TODO

### `fileswarm.stat(key, callback)`

> TODO

## License

MIT

[hyperswarm]: https://github.com/hyperswarm/hyperswarm
[hypercore]: https://github.com/mafintosh/hypercore
[ras]: https://github.com/random-access-storage/random-access-storage
