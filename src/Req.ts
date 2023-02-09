import { NostrReqRes } from "./NostrReqRes"
import { ExtendedError } from "./ExtendedError"
import { DEFAULT_TIMEOUT } from "./constants"
import { ReqRes } from "./ReqRes"
import { Res } from "./Res"
import { CreateResParams, ReqResParams } from "."

export class Req extends ReqRes {
  constructor(params: ReqResParams) {
    super(params)
  }

  createRes({
    data,
    maxBytesPerChunk = this.maxBytesPerChunk || NostrReqRes.MAX_BYTES_PER_CHUNK,
    timeout = DEFAULT_TIMEOUT
  }: CreateResParams): Res {
    if (this.isRes) {
      throw new ExtendedError({
        message: "Cannot create a response to a response",
        code: "INVALID_OPERATION",
        data: this
      })
    }

    if (this._res) {
      throw new ExtendedError({
        message: "Response already created",
        code: "ALREADY_CREATED",
        data: this
      })
    }

    if (this.status === "timedOut") {
      throw new ExtendedError({
        message: "Can't create response to timed out request",
        code: "TIMED_OUT",
        data: this
      })
    }
      
    this._res = new Res({
      rrid: this._rrid.replace(/^req/, "res"),
      data,
      sender: this._nostrReqRes!.pubkey,
      receiver: this._sender!,
      secretKey: this._nostrReqRes!.secretKey,
      maxBytesPerChunk,
      ttl: new Date().getTime() + timeout,
      nostrReqRes: this._nostrReqRes,
      req: this,
      status: "ready"
    })

    return this._res
  }

  async send(): Promise<Res> {
    const res = await super.send()
    if (res) {
      return res
    } else { 
      throw new ExtendedError({
        message: "Unexpected error: send function resolved with no response",
        code: "UNEXPECTED_ERROR",
        data: this
      })
    }
  }
  
  async sendRes({
    data,
    maxBytesPerChunk = this.maxBytesPerChunk || NostrReqRes.MAX_BYTES_PER_CHUNK,
    timeout = DEFAULT_TIMEOUT
  }: CreateResParams): Promise<void> {
    const res = this.createRes({
      data,
      maxBytesPerChunk,
      timeout
    })

    await res.send()
  }
 
  onSending(callback: (req: Req) => void) { this._emitter.on("sending", callback) }
  onSent(callback: (req: Req) => void) { this._emitter.on("sent", callback) }
  onReceiving(callback: (req: Req) => void) { this._emitter.on("receiving", callback) }
  onReceived(callback: (req: Req) => void) { this._emitter.on("received", callback) }
  onResponded(callback: (req: Req) => void) { this._emitter.on("responded", callback) }
  onAborted(callback: (req: Req) => void) { this._emitter.on("aborted", callback) }
  onTimedOut(callback: (req: Req) => void) { this._emitter.on("timedOut", callback) }
  onReady(callback: (req: Req) => void) { this._emitter.on("ready", callback) }
}