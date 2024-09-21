import { TextDecoder, TextEncoder } from "util"
import crypto from "crypto"

// Polyfills
Object.defineProperty(global, "window", {
  value: {
    MessageChannel: require("worker_threads").MessageChannel
  }
})
Object.defineProperty(globalThis, "crypto", {
  writable: true,
  value: {
    getRandomValues: (arr : any) => crypto.randomBytes(arr.length),
    subtle: crypto.webcrypto.subtle,
  }
})
Object.defineProperty(global, "TextDecoder", { value: TextDecoder })
Object.defineProperty(global, "TextEncoder", { value: TextEncoder })
Object.defineProperty(globalThis, "WebSocket", { value: require("ws") })

import { NostrReqRes } from "../src/index"
import { generateSecretKey } from "nostr-tools"
import { ExtendedError } from "../src/ExtendedError"

const relayUrl = "wss://nostr.vulpem.com"
// const relayUrl = "ws://localhost:7001"
// const relayUrl = "wss://relay.damus.io"
// const relayUrl = "wss://nostr-pub.wellorder.net"

const getClients = async (): Promise<{ sender: NostrReqRes, receiver: NostrReqRes }> => {
  const senderSk = generateSecretKey()
  const receiverSk = generateSecretKey()
  const nostrReqResSENDER = await new NostrReqRes({ secretKey: senderSk, waitForRealyAckWhenSendingChunks: true }).connect(relayUrl)
  nostrReqResSENDER.onError(err => { throw err })
  const nostrReqResRECEIVER = await new NostrReqRes({ secretKey: receiverSk, }).connect(relayUrl)
  nostrReqResRECEIVER.onError(err => { throw err })
  
  return {
    sender: nostrReqResSENDER,
    receiver: nostrReqResRECEIVER
  }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe("req-res tests", () => {
  it("req-res event based interface", async() => {
    const clients = await getClients()

    let receivedChunks = 0
    clients.receiver.onReq(req => {
      req.onChunk(chunk => {
        console.log("chunk received", chunk)
        receivedChunks++
      })

      req.onReceived(async () => {
        const res = req.createRes({  data: "Pong" })
        console.log("response received", req.data)
        await res.send()
      })
    })

    const req = clients.sender.createReq({
      receiver: clients.receiver.pubkey,
      data: "Ping".repeat(60) + "END",
      maxBytesPerChunk: 1000
    })

    req.onChunk(chunk => {
      console.log("chunk sent", chunk)
    })
    const res = await req.send()
  
    expect(res.data).toBe("Pong")
    expect(receivedChunks).toBe(5)
  })

  it("req-res simplified interface", async() => {
    const clients = await getClients()

    clients.receiver.onReqReceived(async req => {
      await req.sendRes({  data: "Pong" })
    })

    const res = await clients.sender.sendReq({
      receiver: clients.receiver.pubkey,
      data: "Ping"
    })

    expect(res.data).toBe("Pong")    
  })

  it("req-res timeout", async() => {
    jest.setTimeout(6000)
    const clients = await getClients()

    clients.receiver.onReqReceived(async req => {
      await wait(1000)
      try {
        req.createRes({ data: "Pong" })
        throw new Error("Should have thrown")
      } catch (err) {
        const { code } = err as ExtendedError
        if (code) {
          expect(code).toBe("TIMED_OUT")
        } else {
          throw err
        }
      }
    })

    const req = clients.sender.createReq({
      receiver: clients.receiver.pubkey,
      data: "Ping",
      timeout: 100
    })
    
    req.onStatusChange(status => {
      console.log("status", status)
    })

    try {
      await req.send()
      throw new Error("Should have thrown")
    } catch (err) {
      const { code } = err as ExtendedError
      if (code) {
        expect(code).toBe("TIMED_OUT")
      } else {
        throw err
      }
    }
  })
})
