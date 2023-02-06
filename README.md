# nostr-reqres

Nostr ReqRes implements a request-response paradigm over Nostr. It provides a simple way to send and receive data over a decentralized network in a secure and reliable way. The library uses NIP04 encryption to encrypt and decrypt the data. Request and response can be of any size due to chunking mechanism.

## Installation

``` bash
npm i nostr-reqres
```

## Usage

``` js
const { relayInit, generatePrivateKey, getPublicKey } = require("nostr-tools")

const senderSk = generatePrivateKey()
const receiverSk = generatePrivateKey()
const receiverPk = getPublicKey(receiverSk)

const { default: NostrReqRes } = require("nostr-reqres")

async function connectToRelay(realayURL) {
  const relay = relayInit(realayURL)
  await new Promise((resolve, reject) => {
    relay.connect().catch(reject)
    relay.on("connect", resolve)
    relay.on("error", () => reject(new Error(`failee to connect to ${relay.url}`)))
  })
  return relay
}

void (async () => {
  const kind = 28080
  const relay = await connectToRelay("ws://localhost:7001")

  const nostrReqResB = new NostrReqRes({
    relay,
    secretKey: senderSk,
    kind
  })

  nostrReqResB.on("error", (e) => {
    console.error(e.code)
  })

  const nostrReqResA = new NostrReqRes({
    relay,
    secretKey: receiverSk,
    kind,
  })

  nostrReqResA.on("request", async req => {
    console.log("got request:", req.data) // "Ping"

    try {
      await req.sendResponse({
        data: "Pong",
        maxBytesPerChunk: 1000,
      })
    } catch (e) {
      console.error(e.code, e.data)
    }
  })

  try {
    const res = await nostrReqResB.sendRequest({
      receiver: receiverPk,
      data: "Ping",
      maxBytesPerChunk: 5000,
      timeout: 2000
    })

    console.log("got response:", res.data)
  } catch (e) {
    console.error(e.code, e.data)
  }
})().catch(e => {
  console.error(e)
})

```
