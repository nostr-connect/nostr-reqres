import { Event, Relay, Sub, relayInit } from "nostr-tools"
import EventEmitter from "events"
import { nip04, generatePrivateKey, getPublicKey, getEventHash, signEvent, validateEvent, verifySignature } from "nostr-tools"

export type NostrReqResOptions = {
  realayURL: string
  kind: number
  maxBytesPerChunk?: number
  maxRequestSize?: number | null
  secretKey?: string
  validateEventsSig?: boolean
}

export type ChunkEnvelope = {
  rrid: string
  chunkId: number
  ttl: number
  data: string
  validSig?: boolean | null
}

export type FirstChunkEnvelope = ChunkEnvelope & {
  chunkId: 0
  sender: string
  chunkCount: number
  resMaxSize?: number
}

export type ReqRes = {
  id: string
  ttl: number
  data: string
  sender: string
  validSig: boolean | null
}

export interface Req extends ReqRes {
  sendResponse: (data: {
    data: string,
    maxBytesPerChunk?: number,
    timeout?: number
  }) => Promise<void>
}

export interface Res extends ReqRes {
  req: Req
}

export async function initNostrReqRes(options: NostrReqResOptions & { relayUrl: string }): Promise<NostrReqRes> {
  const nostrReqRes = new NostrReqRes(options)
  await nostrReqRes.connect(options.relayUrl)
  return nostrReqRes
}

export class NostrReqRes extends EventEmitter {
  static readonly MAX_BYTES_PER_CHUNK = 16384
  static readonly MIN_BYTES_PER_CHUNK = 1000

  readonly kind: number

  private _state: {
    chunks: { [rrid: string]: { [chunkId: number]: ChunkEnvelope | FirstChunkEnvelope } },
    reqRes: { [rrid: string]: ReqRes }
  } = { chunks: {}, reqRes: {} }
  private _secretKey: string
  private _pubkey: string
  private _maxBytesPerChunk: number = NostrReqRes.MAX_BYTES_PER_CHUNK
  get maxBytesPerChunk(): number {
    return this._maxBytesPerChunk
  }
  set maxBytesPerChunk(value: number) {
    this._validateMaxBytesPerChunk(value)
    this._maxBytesPerChunk = value
  }
  private _maxBytesPerRequest: number | null = null
  get maxBytesPerRequest(): number | null {
    return this._maxBytesPerRequest
  }
  set maxBytesPerRequest(value: number | null) {
    if (value !== null && value <= 0) {
      throw new ExtendedError({
        message: "maxBytesPerRequest must be greater than 0",
        code: "INVALID_MAX_BYTES_PER_REQUEST",
        data: { maxBytesPerRequest: value }
      })
    }
    this._maxBytesPerRequest = value
  }
  private _relatUrl: string | null = null
  get relayUrl(): string | null {
    return this._relatUrl
  }
  private _relay: Relay | null = null
  get relay(): Relay | null {
    return this._relay
  }
  private _sub: Sub | null = null
  get sub(): Sub | null {
    return this._sub
  }

  validateEventsSig: boolean

  constructor({
    kind,
    maxBytesPerChunk = NostrReqRes.MAX_BYTES_PER_CHUNK,
    maxRequestSize = null,
    secretKey = generatePrivateKey(),
    validateEventsSig = false
  }: NostrReqResOptions) {
    super()
    this._secretKey = secretKey
    this._pubkey = getPublicKey(this._secretKey)
    this.kind = kind
    this.maxBytesPerChunk = maxBytesPerChunk
    this.maxBytesPerRequest = maxRequestSize
    this.validateEventsSig = validateEventsSig
  }

  async disconnect(): Promise<void> {
    if (this._relay) {
      await this._relay.close()
    }
  }

  async connect(relayUrl: string): Promise<this> {
    await this.disconnect()

    this._relay = relayInit(relayUrl)
    this._relatUrl = relayUrl
    await new Promise((resolve, reject) => {
      this._relay!.connect().catch(reject)
      this._relay!.on("connect", resolve)
      this._relay!.on("error", () => reject(new ExtendedError({
        message: "Failed to connect to relay",
        code: "RELAY_CONNECTION_ERROR"
      })))
    })

    const filters = [{
      kinds: [this.kind],
      "#p": [this._pubkey]
    }]
    
    this._sub = this._relay.sub(filters)
   
    this._sub.on("event", async(event: Event) => {
      try {
        const envelope: FirstChunkEnvelope | ChunkEnvelope = JSON.parse(await nip04.decrypt(this._secretKey, event.pubkey, event.content))

        this._validateEnvelope(envelope)

        if (this.validateEventsSig) {
          envelope.validSig = await verifySignature(event as Event & { sig: string })
        } else {
          envelope.validSig = null
        }

        const reqRes = await this._envelopes2reqRes(envelope)
        if (reqRes) {
          if (reqRes.id.startsWith("res")) {
            await this._handleResponse(reqRes)
          } else if (reqRes.id.startsWith("req")) {
            await this._handleRequest(reqRes)
          } else {
            this.emit("error", new ExtendedError({
              message: "Invalid request id",
              code: "INVALID_ID_FORMAT",
              data: reqRes
            }))
          }
        }
      } catch (err) {
        if (err instanceof ExtendedError) {
          this.emit("error", err)
        } else {
          this.emit("error", new ExtendedError({
            message: (err as Error).message,
            code: "UNEXPECTED_ERROR"
          }))
        }
      }
    })

    return this
  }

  private _validateMaxBytesPerChunk(value: number): number {
    if (value < NostrReqRes.MIN_BYTES_PER_CHUNK) {
      throw new ExtendedError({
        message: `maxBytesPerChunk must be greater than ${NostrReqRes.MIN_BYTES_PER_CHUNK}}`,
        code: "INVALID_MAX_BYTES_PER_CHUNK",
        data: { maxBytesPerChunk: value }
      })
    } else if (value > NostrReqRes.MAX_BYTES_PER_CHUNK) {
      throw new ExtendedError({
        message: `maxBytesPerChunk must be less than ${NostrReqRes.MAX_BYTES_PER_CHUNK}`,
        code: "INVALID_MAX_BYTES_PER_CHUNK",
        data: { maxBytesPerChunk: value }
      })
    }
    return value
  }

  private _validateEnvelope(envelope: FirstChunkEnvelope | ChunkEnvelope): boolean {
    const errors = []
    if (typeof envelope.rrid !== "string") {
      errors.push("rrid must be a string")
    } else {
      if (!envelope.rrid.startsWith("req") && !envelope.rrid.startsWith("res")) {
        errors.push("rrid must start with 'req' or 'res'")
      }
    }

    if (typeof envelope.chunkId !== "number") {
      errors.push("chunkId must be a number")
    } else {
      if (envelope.chunkId < 0) {
        errors.push("chunkId must be greater than or equal to 0")
      }
    }

    if (typeof envelope.ttl !== "number") {
      errors.push("ttl must be a number")
    } else {
      if (envelope.ttl < 0) {
        errors.push("ttl must be greater than or equal to 0")
      }
    }

    if (typeof envelope.data !== "string") {
      errors.push("data must be a string")
    }

    if (envelope.chunkId === 0) {
      const firstChunkEnvelope = envelope as FirstChunkEnvelope

      if (typeof firstChunkEnvelope.chunkCount !== "number") {
        errors.push("chunkCount must be a number")
      } else {
        if (firstChunkEnvelope.chunkCount < 1) {
          errors.push("chunkCount must be greater than 0")
        }
      }

      if (typeof firstChunkEnvelope.sender !== "string") {
        errors.push("sender must be a string")
      } else {
        if (firstChunkEnvelope.sender.length !== 64) {
          errors.push("sender must be 64 characters long")
        }
      }
    }

    if (errors.length > 0) {
      throw new ExtendedError({
        message: "Invalid envelope",
        code: "INVALID_ENVELOPE",
        data: { errors, envelope }
      })
    }

    return true
  }

  getPublicKey(): string {
    return this._pubkey
  }

  private async _envelopes2reqRes(envelope: FirstChunkEnvelope | ChunkEnvelope): Promise<ReqRes | null> {
    const { rrid, chunkId, ttl, data } = envelope

    if (envelope.ttl < Date.now()) {
      delete this._state.chunks[envelope.rrid]
      return null
    }

    if ((envelope as FirstChunkEnvelope).chunkCount === 1) {
      const firstChunkEnvelope = envelope as FirstChunkEnvelope

      return {
        id: rrid,
        ttl: ttl,
        data,
        sender: firstChunkEnvelope.sender,
        validSig: firstChunkEnvelope.validSig
      } as ReqRes
    } else {
      if (!this._state.chunks[rrid]) {
        this._state.chunks[rrid] = {}
      }
      this._state.chunks[rrid][chunkId] = envelope

      const firstChunkEnvelope = this._state.chunks[rrid][0] as FirstChunkEnvelope
      if (!firstChunkEnvelope) {
        return null
      }
      const { chunkCount } = firstChunkEnvelope

      if (Object.keys(this._state.chunks[rrid]).length === chunkCount) {
        const envelopeChunks = Object.values(this._state.chunks[rrid])
        envelopeChunks.sort((a, b) => a.chunkId - b.chunkId)
        delete this._state.chunks[rrid]
        const firstChunkEnvelope = envelopeChunks[0] as FirstChunkEnvelope

        return envelopeChunks.reduce((reqRes: ReqRes, envelopeChunk: ChunkEnvelope) => {
          reqRes.data += envelopeChunk.data
          if (reqRes.validSig !== false) {
            if (envelopeChunk.validSig === true && reqRes.validSig !== null) {
              reqRes.validSig = true
            } else {
              reqRes.validSig = envelopeChunk.validSig as boolean | null
            }
          }

          return reqRes
        }, {
          id: firstChunkEnvelope.rrid,
          ttl: firstChunkEnvelope.ttl,
          sender: firstChunkEnvelope.sender,
          data: "",
          validSig: firstChunkEnvelope.validSig!
        })
      }
    }
    return null
  }

  private async _handleRequest(reqRes: ReqRes) {
    let sent = false
    const req: Req = Object.assign(reqRes, {
      sendResponse: async ({
        data,
        maxBytesPerChunk = this.maxBytesPerChunk,
        timeout
      }: {
        data: string,
        maxBytesPerChunk?: number,
        timeout?: number
      }): Promise<void> => {
        if (sent) {
          throw new ExtendedError({
            message: "Response already sent",
            code: "RESPONSE_ALREADY_SENT",
            data: reqRes
          })
        }

        if (reqRes.ttl < Date.now()) {
          throw new ExtendedError({
            message: "Request expired",
            code: "REQUEST_EXPIRED",
            data: reqRes
          })
        }

        sent = true

        await this._sendReqRes({
          receiver: reqRes.sender,
          data,
          maxBytesPerChunk,
          timeout,
          reqId: reqRes.id
        })
      }
    })

    this.emit("request", req)
  }

  private async _handleResponse(reqRes: ReqRes) {
    const { id } = reqRes
    const reqId = id.replace(/^res/, "req")
    const req = this._state.reqRes[reqId]
    if (req) {
      const res = Object.assign(reqRes, { req })
      this.emit(id, res)
      delete this._state.reqRes[reqId]
    } else {
      this.emit("error", new ExtendedError({
        message: "Request timed out",
        code: "TIMEOUT",
        data: reqRes
      }))
    }
  }

  private async _prepareEvent({
    receiver,
    envelope
  }: {
    receiver: string,
    envelope: ChunkEnvelope,
  }): Promise<Event> {
    const cipherText = await nip04.encrypt(this._secretKey, receiver, JSON.stringify(envelope))

    const event: Event = {
      kind: this.kind,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: this._pubkey,
      tags: [["p", receiver]],
      content: cipherText,
    }

    const signedEvent = {
      ...event,
      id: getEventHash(event),
      sig: signEvent(event, this._secretKey)
    }

    const ok = validateEvent(signedEvent)
    if (!ok) {
      throw new ExtendedError({
        message: "Event is not valid",
        code: "INVALID_EVENT",
        data: signedEvent
      })
    }

    const veryOk = verifySignature(signedEvent)
    if (!veryOk) {
      throw new ExtendedError({
        message: "Event signature is not valid",
        code: "INVALID_SIGNATURE",
        data: signedEvent
      })
    }

    return signedEvent
  }

  private async _getEvents({
    sender,
    receiver,
    rrid,
    ttl,
    data,
    maxBytesPerChunk
  }: {
    sender: string,
    receiver: string
    rrid: string,
    ttl: number
    data: string,
    maxBytesPerChunk: number
  }): Promise<Event[]> {
    this._validateMaxBytesPerChunk(maxBytesPerChunk)

    const envelope: FirstChunkEnvelope = {
      rrid,
      chunkId: 0,
      ttl,
      data,
      chunkCount: 1,
      sender
    }
    const event = await this._prepareEvent({
      receiver,
      envelope
    })
    const eventStr = JSON.stringify(event)
    const eventLen = eventStr.length

    if (eventLen <= maxBytesPerChunk) {
      return [event]
    } else {
      let chunkCount = Math.ceil(eventLen / (maxBytesPerChunk - 750))
      const chunkSize = Math.ceil(data.length / chunkCount)

      const unsignedEvents = []
      for (let i = 0; i < chunkCount; i++) {
        const chunkData = data.slice(i * chunkSize, (i + 1) * chunkSize)
        const envelope: FirstChunkEnvelope | ChunkEnvelope = {
          rrid,
          chunkId: i,
          ttl,
          data: chunkData
        }

        if (i === 0) {
          Object.assign(envelope, { chunkCount, sender })
        }

        unsignedEvents.push({
          receiver,
          envelope
        })
      }
      return await Promise.all(unsignedEvents.map(unsignedEvent => this._prepareEvent(unsignedEvent)))
    }
  }

  private async _sendReqRes({
    receiver,
    data,
    maxBytesPerChunk = this.maxBytesPerChunk,
    timeout = 60000,
    reqId
  }: {
    receiver: string,
    data: string,
    maxBytesPerChunk?: number,
    timeout?: number
    reqId?: string | null,
  }): Promise<Res | void> {
    if (!this.relay) {
      throw new ExtendedError({
        message: "A relay connection is required to send a request or response, call connect(relayUrl) first",
        code: "NO_RELAY_CONNECTION",
      })
    }

    let rrid: string
    const ttl = new Date().getTime() + timeout
    const sender = this.getPublicKey()
    let req: ReqRes | undefined
    if (!reqId) {
      rrid = `req.${Math.random().toString().slice(2)}`
      req = {
        id: rrid,
        ttl: ttl,
        data: data,
        sender: sender,
        validSig: null
      }

      this._state.reqRes[rrid] = req
    } else {
      rrid = reqId.replace(/^req/, "res")
    }

    const events = await this._getEvents({
      sender,
      receiver,
      rrid,
      ttl,
      data,
      maxBytesPerChunk
    })

    events.forEach(event => this.relay!.publish(event))

    if (req) {
      const abortController = new AbortController

      const waitTimeout = () => new Promise((_, reject) => {
        if (abortController.signal.aborted) {
          reject(new ExtendedError({
            message: "Request aborted",
            code: "ABORTED",
            data: req
          }))
          return
        }

        const t = setTimeout(() => {
          reject(new ExtendedError({
            message: "Request timeout",
            code: "TIMEOUT",
            data: req
          }))
        }, timeout)

        const abortHandler = () => {
          clearTimeout(t)
          reject(new ExtendedError({
            message: "Request aborted",
            code: "ABORTED"
          }))
          abortController.signal.removeEventListener("abort", abortHandler)
        }
        abortController.signal.addEventListener("abort", abortHandler)
      })

      const waitResponse = () => new Promise<Res>((resolve, reject) => {
        if (abortController.signal.aborted) {
          reject(new ExtendedError({
            message: "Request aborted",
            code: "ABORTED"
          }))
          return
        }

        const eventName = rrid.replace(/^req/, "res")

        const abortHandler = () => {
          this.removeAllListeners(eventName)
          reject(new ExtendedError({
            message: "Request aborted",
            code: "ABORTED"
          }))
        }

        abortController.signal.addEventListener("abort", abortHandler)

        this.once(eventName, (res: Res) => {
          resolve(res)
          abortController.signal.removeEventListener("abort", abortHandler)
        })
      })

      const res = await Promise.race([
        waitTimeout(),
        waitResponse()
      ]) as Res

      abortController.abort()
      return res
    }
  }

  async sendRequest({
    receiver,
    data,
    maxBytesPerChunk = this.maxBytesPerChunk,
    timeout
  }: {
    receiver: string,
    data: string,
    maxBytesPerChunk?: number,
    timeout?: number
  }): Promise<Res> {
    return this._sendReqRes({
      receiver,
      data,
      maxBytesPerChunk,
      timeout
    }) as Promise<Res>
  }
}

export class ExtendedError extends Error {
  code: string
  data?: any

  constructor({ message, code, data }: { message: string, code: string, data?: any }) {
    super(message)
    this.code = code
    this.data = data
  }
}
