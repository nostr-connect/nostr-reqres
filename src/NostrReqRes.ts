import type { FirstChunk, Chunk, CreateReqParams } from "."
import { Event, Relay } from "nostr-tools"
import EventEmitter from "events"
import { nip04, generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools"
import { validateEnvelope, validateMaxBytesPerChunk } from "./utils"
import { MAX_BYTES_PER_CHUNK, MIN_BYTES_PER_CHUNK, DEFAULT_TIMEOUT } from "./constants"
import { ExtendedError } from "./ExtendedError"
import { Req } from "./Req"
import { Res } from "./Res"

export class NostrReqRes {
  static readonly MAX_BYTES_PER_CHUNK = MAX_BYTES_PER_CHUNK
  static readonly MIN_BYTES_PER_CHUNK = MIN_BYTES_PER_CHUNK

  readonly kind: number

  readonly pendingRequests: Map<string, Req> = new Map()

  private _secretKey: Uint8Array
  get secretKey(): Uint8Array { return this._secretKey }
  
  private _pubkey: string
  get pubkey(): string { return this._pubkey }
  
  private _maxBytesPerChunk: number = NostrReqRes.MAX_BYTES_PER_CHUNK
  get maxBytesPerChunk(): number { return this._maxBytesPerChunk }
  set maxBytesPerChunk(value: number) { this._maxBytesPerChunk = validateMaxBytesPerChunk(value) }

  private _relay: Relay | null = null
  get relay(): Relay | null { return this._relay }

  // private _sub: Sub | null = null
  // get sub(): Sub | null { return this._sub }

  validateEventsSig: boolean

  private _emitter = new EventEmitter()
  
  waitForRealyAckWhenSendingChunks: boolean

  constructor({
    kind = 28080,
    maxBytesPerChunk = NostrReqRes.MAX_BYTES_PER_CHUNK,
    secretKey = generateSecretKey(),
    validateEventsSig = false,
    waitForRealyAckWhenSendingChunks = false
  }: {
    kind?: number
    maxBytesPerChunk?: number
    secretKey?: Uint8Array
    validateEventsSig?: boolean
    waitForRealyAckWhenSendingChunks?: boolean
  } = {}) {
    this._secretKey = secretKey
    this._pubkey = getPublicKey(this._secretKey)
    this.kind = kind
    this.maxBytesPerChunk = maxBytesPerChunk
    this.validateEventsSig = validateEventsSig
    this.waitForRealyAckWhenSendingChunks = waitForRealyAckWhenSendingChunks
  }

  async disconnect(): Promise<void> {
    if (this._relay && this._relay.connected) {
      await this._relay.close()
    }
  }

  async connect(relayUrl: string): Promise<this> {
    await this.disconnect()
    this._emitter.emit("connecting")

    try {
      this._relay = await Relay.connect(relayUrl)

    } catch (err) {
      const { message } = err as Error
      const extErr = new ExtendedError({
        message,
        code: "RELAY_CONNECTION_ERROR"
      })

      this._emitter.emit("error", extErr) 
      throw extErr
    }

    this._emitter.emit("connect")
    this._relay.onclose = () => this._emitter.emit("disconnect")
    
    // this._sub = this._relay.sub(filters)
    const onevent = async(event: Event) => {
      try {
        const chunk: FirstChunk | Chunk = JSON.parse(await nip04.decrypt(this._secretKey, event.pubkey, event.content))

        validateEnvelope(chunk)

        if (this.validateEventsSig) {
          chunk.validSig = await verifyEvent(event)
        } else {
          chunk.validSig = null
        }

        const { rrid } = chunk
        const isReq = rrid.startsWith("req")
        let req = this.pendingRequests.get(isReq ? rrid : rrid.replace(/^res/, "req"))
        
        // if !req && !isReq -> ignore, it's a response to a request that has already been handled, timed out, aborted or lost in the void
        
        // if !req && isReq && ttl >= Date.now() -> create new request
        if (!req && isReq && chunk.ttl >= Date.now()) {
          req = new Req({
            rrid: chunk.rrid,
            nostrReqRes: this,
            status: "receiving"
          })
          this.pendingRequests.set(rrid, req)
          this._emitter.emit("req", req)
          req.onReceived(req => this._emitter.emit("reqReceived", req))
        } 

        // if req -> add chunk to request
        if (req) {
          if (isReq) {
            req.addChunk(chunk)
          } else {
            if (!req.res) {
              req.res = new Res({
                rrid: chunk.rrid,
                nostrReqRes: this,
                req,
                status: "receiving"
              })
              req.res.onReceived(res => this._emitter.emit("resReceived", res))
            }
            req.res.addChunk(chunk)
          }
        }

      } catch (err) {
        if (err instanceof ExtendedError) {
          this._emitter.emit("error", err)
        } else {
          this._emitter.emit("error", new ExtendedError({
            message: (err as Error).message,
            code: "UNEXPECTED_ERROR"
          }))
        }
      }
    }

    this._relay.subscribe([{
      kinds: [this.kind],
      "#p": [this._pubkey]
    }], {
      onevent
    })

    return this
  }

  createReq({
    receiver,
    data,
    maxBytesPerChunk = this.maxBytesPerChunk,
    timeout = DEFAULT_TIMEOUT
  }: CreateReqParams): Req {
    const req = new Req({
      rrid: `req.${Math.random().toString().slice(2)}`,
      data,
      sender: this.pubkey,
      receiver,
      secretKey: this.secretKey,
      maxBytesPerChunk,
      ttl: new Date().getTime() + timeout,
      nostrReqRes: this,
      status: "ready"
    })
    this.pendingRequests.set(req.rrid, req)
    return req
  }

  sendReq({
    receiver,
    data,
    maxBytesPerChunk = this.maxBytesPerChunk,
    timeout = DEFAULT_TIMEOUT
  }: CreateReqParams): Promise<Res> {
    const req = this.createReq({ receiver, data, maxBytesPerChunk, timeout })
    return req.send()
  }


  onConnect = (callback: () => void) => { this._emitter.on("connect", callback) }
  onConnecting = (callback: () => void) => { this._emitter.on("connecting", callback) }
  onDisconnect = (callback: () => void) => { this._emitter.on("disconnect", callback) }
  onError = (callback: (err: ExtendedError | Error) => void) => { this._emitter.on("error", callback) }
  onReq = (callback: (req: Req) => void) => { this._emitter.on("req", callback) }
  onReqReceived = (callback: (req: Req) => void) => { this._emitter.on("reqReceived", callback) }
  onResReceived = (callback: (res: Res) => void) => { this._emitter.on("resReceived", callback) }
}