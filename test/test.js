require("websocket-polyfill")
const { generatePrivateKey, getPublicKey } = require("nostr-tools")

const senderSk = generatePrivateKey()
const receiverSk = generatePrivateKey()
const receiverPk = getPublicKey(receiverSk)

// eslint-disable-next-line no-undef
globalThis.crypto = require("crypto")

const { initNostrReqRes } = require("../dist")

void (async () => {
  const kind = 28080
  const relayUrl = "ws://localhost:7001"

  const nostrReqResB = await initNostrReqRes({
    relayUrl,
    secretKey: senderSk,
    kind
  })


  nostrReqResB.on("error", (e) => {
    console.error(e.code)
  })

  const nostrReqResA = await initNostrReqRes({
    relayUrl,
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
