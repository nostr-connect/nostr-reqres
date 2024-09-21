import type { Req } from "./Req"
import type { NostrReqRes } from "./NostrReqRes"
import type { ReqRes } from "./ReqRes"
import type { Res } from "./Res"
import type { ExtendedError } from "./ExtendedError"

export type { Req, ReqRes, Res, ExtendedError }

export type CreateReqParams = {
  receiver: string,
  data: string,
  maxBytesPerChunk?: number,
  timeout?: number
}

export type CreateResParams = {
  data: string,
  maxBytesPerChunk?: number,
  timeout?: number
}

export type ReqResParams = {
  rrid: string
  nostrReqRes: NostrReqRes
  status: ReqResStatus
  data?: string
  sender?: string
  receiver?: string
  secretKey?: Uint8Array
  maxBytesPerChunk?: number
  ttl?: number
  req?: Req
}

export type ReqResStatus = "sending" | "sent" | "receiving" | "received" | "responded" | "aborted" | "timedOut" | "ready" | "error"

export type Chunk = {
  rrid: string
  chunkId: number
  ttl: number
  data: string
  validSig?: boolean | null
}

export type FirstChunk = Chunk & {
  chunkId: 0
  sender: string
  chunkCount: number
  resMaxSize?: number
}

export { NostrReqRes } from "./NostrReqRes"