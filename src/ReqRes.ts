import { NostrReqRes } from "./NostrReqRes"
import { ReqResStatus, Chunk, FirstChunk, ReqResParams } from "."
import { EventEmitter } from "events"
import { ExtendedError } from "./ExtendedError"
import { prepareEventChunks } from "./utils"
import { Res } from "./Res"
import { Req } from "./Req"

export class ReqRes {
  protected _emitter = new EventEmitter()

  protected _rrid: string
  get rrid() {  return this._rrid }

  protected _data?: string
  get data() { return this._data }

  protected _validSig?: boolean | null
  get validSig() { return this._validSig }

  protected _status: ReqResStatus
  get status() { return this._status }

  get isReq () { return this._rrid!.startsWith("req") }

  get isRes () { return this._rrid!.startsWith("res") }

  protected _chunkCount?: number
  get chunkCount() { return this._chunkCount }

  protected _dataChunks: Map<number, string>

  protected _res?: Res
  get res() { return this._res }
  set res(res: Res | undefined) { 
    this._res = res
    if (res) {
      res._emitter.once("received", () => {
        this._setStatus("responded")
      })
    }
  }

  req?: Req

  protected _sender?: string
  get sender() { return this._sender }
  
  protected _receiver?: string
  get receiver() { return this._receiver }

  protected _secretKey?: string
  get secretKey() { return this._secretKey }

  protected _maxBytesPerChunk?: number
  get maxBytesPerChunk() { return this._maxBytesPerChunk }

  protected _ttl?: number
  get ttl() { return this._ttl }
  protected _ttlTimeout?: ReturnType<typeof setTimeout>

  protected _nostrReqRes: NostrReqRes

  private _error: ExtendedError | null = null
  get error() { return this._error }

  constructor(params: ReqResParams) {
    this._dataChunks = new Map()
    this._rrid = params.rrid
    this._nostrReqRes = params.nostrReqRes
    this._status = params.status
    this._data = params.data
    this._sender = params.sender
    this._receiver = params.receiver
    this._secretKey = params.secretKey
    this._maxBytesPerChunk = params.maxBytesPerChunk
    this._ttl = params.ttl
    this._setTtlTimeout()
    this.req = params.req

    this._emitter.on("statusChange", (status: ReqResStatus) => {
      if (["aborted", "timedOut"].includes(status)) {
        this._dataChunks.clear()
        delete this._data
        this._emitter.removeAllListeners()
        if (this._ttlTimeout) {
          clearTimeout(this._ttlTimeout)
        }
      }
    })
  }
    
  protected _setStatus(status: ReqResStatus) {
    if (this._status !== status) {
      this._status = status
      this._emitter.emit("statusChange", status)
      this._emitter.emit(status, this)
    }
  }

  protected _setTtlTimeout() {
    if (this._ttl) {
      if (this._ttlTimeout) {
        clearTimeout(this._ttlTimeout)
      }

      this._ttlTimeout = setTimeout(() => {
        this._setStatus("timedOut")
      }, this._ttl - new Date().getTime())
    }
  }

  abort() {
    if ([ "sending", "receiving" ].includes(this.status)) {
      this._setStatus("aborted")
    }
  }

  async send(): Promise<Res | void> {
    if (this.status === "sent") {
      throw new ExtendedError({
        message: "Already sent",
        code: "ALREADY_SENT",
        data: this
      })
    }

    if (this.status !== "ready") {
      throw new ExtendedError({
        message: "Not ready to send",
        code: "NOT_READY",
        data: this
      })
    }
    
    if (!this._nostrReqRes.relay) {
      throw new ExtendedError({
        message: "NostrReqRes has no relay",
        code: "NO_RELAY",
        data: this
      })
    }
  
    const data = await prepareEventChunks({
      rrid: this._rrid,
      data: this._data!,
      sender: this._sender!,
      receiver: this._receiver!,
      secretKey: this._secretKey!,
      maxBytesPerChunk: this._maxBytesPerChunk!,
      ttl: this._ttl!,
      kind: this._nostrReqRes.kind,
    })
    
    this._chunkCount = data.length
    await new Promise<void>((resolve, reject) => {
      let sentChunks = 0
      
      const respondedListener = () => resolve()
      const statusChangeListener = (status: ReqResStatus) => {
        switch(status) {
          case "aborted": {
            reject(
              new ExtendedError({
                message: "Request aborted",
                code: "ABORTED",
                data: this
              })
            )
            break
          }
          case "timedOut": {
            reject(new ExtendedError({
              message: "Request timed out",
              code: "TIMED_OUT",
              data: this
            }))
            break
          }
        }   
      }
      
      this._emitter.once("responded", respondedListener)
      this._emitter.on("statusChange", statusChangeListener)

      const removeListeners = () => {
        this._emitter.removeListener("responded", respondedListener)
        this._emitter.removeListener("statusChange", statusChangeListener)
      }

      for (const { event, chunk } of data) {
        const pub = this._nostrReqRes.relay!.publish(event)
        const onChunkSent = () => {
          this._emitter.emit("chunk", chunk)
          sentChunks++
          if (sentChunks === data.length) {
            removeListeners()
            resolve()
          }
        }

        if (this._nostrReqRes.waitForRealyAckWhenSendingChunks) {
          pub.on("ok", onChunkSent)
    
          pub.on("failed", (reason: any) => {
            this._error = new ExtendedError({
              message: "Failed to publish chunk",
              code: "PUBLISH_FAILED",
              data: {
                reason,
                chunk
              }
            })
            removeListeners()
            reject(this.error)
          })
        } else { 
          onChunkSent()
        }
      }
    })

    this._setStatus("sent")

    if (this.isReq) {
      return new Promise<Res>((resolve, reject) => {
        if (this.res) {
          resolve(this.res)
        }
        this._emitter.once("responded", () => resolve(this.res!))
        
        this._emitter.on("statusChange", (status: ReqResStatus) => {
          switch(status) {
            case "aborted": {
              reject(
                new ExtendedError({
                  message: "Request aborted",
                  code: "ABORTED",
                  data: this
                })
              )
              break
            }
            case "timedOut": {
              reject(new ExtendedError({
                message: "Request timed out",
                code: "TIMED_OUT",
                data: this
              }))
              break
            }
          }   
        })
      })
    } else {
      return
    }
  }

  async addChunk(chunk: FirstChunk | Chunk): Promise<void> {
    if (this.status !== "receiving") {
      return
    }

    const { rrid, chunkId, ttl, data } = chunk

    if (this.rrid !== rrid) {
      throw new ExtendedError({
        message: "Chunk rrid does not match ReqRes rrid",
        code: "CHUNK_RRID_MISMATCH",
        data: { chunk, reqRes: this }
      })
    }

    this._emitter.emit("chunk", chunk)

    if (ttl < Date.now()) {
      this._setStatus("timedOut")
      return
    }

    if (this._ttl !== ttl) {
      this._ttl = ttl
      this._setTtlTimeout()
    }

    this._dataChunks.set(chunkId, data)

    if (chunkId === 0) {
      const firstChunk = chunk as FirstChunk
      this._sender = firstChunk.sender
      this._validSig = firstChunk.validSig
      this._chunkCount = firstChunk.chunkCount
    }

    if (this._dataChunks.size === this._chunkCount) {
      this._data = Array.from(this._dataChunks.entries()).sort((a, b) => a[0] - b[0]).map(e => e[1]).join("")
      this._setStatus("received")
    }
  }

  onStatusChange(callback: (status: ReqResStatus) => void) { this._emitter.on("statusChange", callback) }
  onChunk(callback: (chunk: FirstChunk | Chunk) => void) { this._emitter.on("chunk", callback) }
}