const fileswarm = require('../..')
const crypto = require('crypto')
const ram = require('random-access-memory')
const fs = require('fs')

const secret = crypto.randomBytes(fileswarm.SECRET_BYTES)
const origin = fileswarm.seed(__filename, ram, { secret }, onseed)

const authFile = './copy.js'
const spyFile ='./spied.js'

let missing = 2
let auth = null
let spy = null

function onseed(err) {
  if (err) { throw err }
  const { key } = origin
  auth = fileswarm.download(authFile, { secret, key }, ondownload)
  spy = fileswarm.download(spyFile, { key }, ondownload)
}

function ondownload(err) {
  if (err) { throw err }
  if (--missing) { return }
  origin.close(() => {
    auth.close(() => {
      spy.close(() => {
        fs.readFile(spyFile, (err, buffer) => {
          console.log('ciphertext->\n%s', buffer);
          fs.readFile(authFile, (err, buffer) => {
            console.log('plaintext->\n%s', buffer);
            process.nextTick(process.exit)
          })
        })
      })
    })
  })
}
