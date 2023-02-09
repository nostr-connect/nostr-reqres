import { ExtendedError } from "./ExtendedError"
import { ReqRes } from "./ReqRes"
import { ReqResParams } from "."

export class Res extends ReqRes {
  constructor(params: ReqResParams) {
    super(params)
  }

  async send(): Promise<void> {
    const res = await super.send()
    if (!res) {
      return
    } else {
      throw new ExtendedError({
        message: "Unexpected error: send function resolved with a response",
        code: "UNEXPECTED_ERROR",
        data: this
      })
    }
  }

  onSending(callback: (req: Res) => void) { this._emitter.on("sending", callback) }
  onSent(callback: (req: Res) => void) { this._emitter.on("sent", callback) }
  onReceiving(callback: (req: Res) => void) { this._emitter.on("receiving", callback) }
  onReceived(callback: (req: Res) => void) { this._emitter.on("received", callback) }
  onResponded(callback: (req: Res) => void) { this._emitter.on("responded", callback) }
  onAborted(callback: (req: Res) => void) { this._emitter.on("aborted", callback) }
  onTimedOut(callback: (req: Res) => void) { this._emitter.on("timedOut", callback) }
  onReady(callback: (req: Res) => void) { this._emitter.on("ready", callback) }
}