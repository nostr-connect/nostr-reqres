import type { Event, UnsignedEvent, VerifiedEvent } from "nostr-tools"
import type { Chunk, FirstChunk } from "."
import { ExtendedError } from "./ExtendedError"
import { nip04, validateEvent, verifyEvent, finalizeEvent } from "nostr-tools"
import { MAX_BYTES_PER_CHUNK, MIN_BYTES_PER_CHUNK } from "./constants"

export const validateEnvelope = (envelope: FirstChunk | Chunk): boolean => {
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
    const firstChunkEnvelope = envelope as FirstChunk

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

export const validateMaxBytesPerChunk = (value: number): number => {
  if (value < MIN_BYTES_PER_CHUNK) {
    throw new ExtendedError({
      message: `maxBytesPerChunk must be greater than ${MIN_BYTES_PER_CHUNK}}`,
      code: "INVALID_MAX_BYTES_PER_CHUNK",
      data: { maxBytesPerChunk: value }
    })
  } else if (value > MAX_BYTES_PER_CHUNK) {
    throw new ExtendedError({
      message: `maxBytesPerChunk must be less than ${MAX_BYTES_PER_CHUNK}`,
      code: "INVALID_MAX_BYTES_PER_CHUNK",
      data: { maxBytesPerChunk: value }
    })
  }
  return value
}

export const validateMaxBytesPerRequest = (value: number | null): number | null => {
  if (value !== null && value <= 0) {
    throw new ExtendedError({
      message: "maxBytesPerRequest must be greater than 0",
      code: "INVALID_MAX_BYTES_PER_REQUEST",
      data: { maxBytesPerRequest: value }
    })
  }
  return value
}

export type PrepareEventParams = {
  receiver: string
  envelope: Chunk
  kind: number
  pubkey: string
  secretKey: Uint8Array
}

export const prepareEvent = async({
  receiver,
  envelope,
  kind,
  pubkey,
  secretKey
}: PrepareEventParams): Promise<Event> => {
  const cipherText = await nip04.encrypt(secretKey, receiver, JSON.stringify(envelope))

  const unsignedEvent: UnsignedEvent = {
    kind,
    created_at: Math.floor(Date.now() / 1000),
    pubkey,
    tags: [["p", receiver]],
    content: cipherText
  }
  
  const event: VerifiedEvent = finalizeEvent(unsignedEvent, secretKey)

  const ok = validateEvent(event)
  if (!ok) {
    throw new ExtendedError({
      message: "Event is not valid",
      code: "INVALID_EVENT",
      data: event
    })
  }

  const veryOk = verifyEvent(event)
  if (!veryOk) {
    throw new ExtendedError({
      message: "Event signature is not valid",
      code: "INVALID_SIGNATURE",
      data: event
    })
  }

  return event
}

export const prepareEventChunks = async({
  sender,
  receiver,
  rrid,
  ttl,
  data,
  kind,
  secretKey,
  maxBytesPerChunk
}: {
  sender: string,
  receiver: string
  rrid: string,
  ttl: number
  data: string,
  kind: number,
  secretKey: Uint8Array,
  maxBytesPerChunk: number
}): Promise<{ chunk: FirstChunk | Chunk, event: Event }[]> => {
  validateMaxBytesPerChunk(maxBytesPerChunk)

  const chunk: FirstChunk = {
    rrid,
    chunkId: 0,
    ttl,
    data,
    chunkCount: 1,
    sender
  }

  const prepareEventParams: PrepareEventParams = {
    receiver,
    envelope: chunk,
    kind,
    pubkey: sender,
    secretKey,
  }

  const event = await prepareEvent(prepareEventParams)
  const eventStr = JSON.stringify(event)
  const eventLen = eventStr.length

  if (eventLen <= maxBytesPerChunk) {
    return [{
      chunk,
      event
    }]
  } else {
    let chunkCount = Math.ceil(eventLen / (maxBytesPerChunk - 750))
    const chunkSize = Math.ceil(data.length / chunkCount)

    const prepareEventParamsArray: PrepareEventParams[] = []
    const chunks = []
    for (let i = 0; i < chunkCount; i++) {
      const chunkData = data.slice(i * chunkSize, (i + 1) * chunkSize)
      const chunk: FirstChunk | Chunk = {
        rrid,
        chunkId: i,
        ttl,
        data: chunkData
      }

      if (i === 0) {
        Object.assign(chunk, { chunkCount, sender })
      }

      chunks.push(chunk)
      prepareEventParamsArray.push({
        receiver,
        envelope: chunk,
        kind,
        pubkey: sender,
        secretKey
      })
    }
    const events = await Promise.all(prepareEventParamsArray.map((params => prepareEvent(params))))
    return chunks.map((chunk, i) => ({ chunk, event: events[i] }))
  }
}