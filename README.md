# nostr-reqres

The NostrReqRes library is a JavaScript library that provides an easy way to create, manage, and track request/response communication of any size over Nostr protocol. By automatically splitting and reassembling large payloads into smaller chunks, it allows seamless handling of requests and responses without size limitations. The library utilizes Nostr Tools for low-level operations and implements higher-level abstractions for request and response handling.

## Installation

``` bash
npm install @nostr-connect/nostr-reqres
```

## Examples

``` ts
// Import the NostrReqRes module
import { NostrReqRes } from "nostr-reqres"

// Define an immediately invoked async function expression (IIFE)
void (async () => {
  // Create new instances of NostrReqRes for the sender and the receiver
  const nostrReqResSENDER = new NostrReqRes()
  const nostrReqResRECEIVER = new NostrReqRes()

  // Connect both sender and receiver to the WebSocket server at localhost:7001
  await Promise.all([
    nostrReqResSENDER.connect("ws://localhost:7001"),
    nostrReqResRECEIVER.connect("ws://localhost:7001")
  ])

  // Set up an event listener for incoming requests on the receiver
  nostrReqResRECEIVER.onReqReceived(async (req) => {
    // Log the request data to the console
    console.log(req.data) // ping

    // Send a response with the data "pong" back to the sender
    await req.sendRes({
      data: "pong"
    })
  })

  // Send a request from the sender to the receiver with the data "ping"
  const res = await nostrReqResSENDER.sendReq({
    receiver: nostrReqResRECEIVER.pubkey,
    data: "ping"
  })

  // Log the response data to the console
  console.log(res.data) // pong
})()
  // Catch any errors and log them to the console
  .catch((err) => {
    console.error(err)
  })

```

``` ts
// Import the NostrReqRes library
import { NostrReqRes } from "nostr-reqres";

// Create an immediately invoked async function expression
void (async () => {
  // Initialize sender and receiver instances of NostrReqRes
  const nostrReqResSENDER = new NostrReqRes();
  const nostrReqResRECEIVER = new NostrReqRes();

  // Connect both sender and receiver to the WebSocket server at localhost on port 7001
  await Promise.all([
    nostrReqResSENDER.connect("ws://localhost:7001"),
    nostrReqResRECEIVER.connect("ws://localhost:7001")
  ]);

  // Set up an event listener for when the receiver receives a request chunk
  nostrReqResRECEIVER.onReq(async (req) => {
    // Log received request chunks
    req.onChunk((chunk) => {
      console.log("req chunk received", chunk);
    });

    // Set up an event listener for when the entire request is received
    req.onReceived(async (req) => {
      // Log the received request data
      console.log(req.data); // "ping"

      // Create a response object with the data "pong"
      const res = req.createRes({
        data: "pong"
      });

      // Send the response back to the sender
      await res.send();
    });
  });

  // Create a new request object with the receiver's public key and the data "ping"
  const req = await nostrReqResSENDER.createReq({
    receiver: nostrReqResRECEIVER.pubkey,
    data: "ping"
  });

  // Log sent request chunks
  req.onChunk((chunk) => {
    console.log("req chunk sent", chunk);
  });

  // Send the request and wait for the response
  const res = await req.send();

  // Log the received response data
  console.log(res.data); // "pong"
})()
  .catch((err) => {
    // Log any errors that occur during execution
    console.error(err);
  });
```

## NostrReqRes constuctor options

- `kind` _(optional, number)_: The kind of event to be used for request-response communication. Default is 28080.
- `maxBytesPerChunk` _(optional, number)_: The maximum number of bytes allowed per chunk when splitting large payloads. Default is NostrReqRes.MAX_BYTES_PER_CHUNK (16384).
- `secretKey` _(optional, string)_: The secret key to be used for signing and encrypting events. Default is a randomly generated private key.
- `validateEventsSig` _(optional, boolean)_: A flag indicating whether to validate event signatures when receivd; this shuold be done by the relay. Default is false.
- `waitForRealyAckWhenSendingChunks` _(optional, boolean)_: A flag indicating whether to wait for a relay acknowledgement when sending chunks; not all the relay implements the ack on ephimeral kinds. Default is false.

example:

``` ts

import { NostrReqRes } from "nostr-reqres";

const nostrReqRes = new NostrReqRes({
  kind: 28080,
  maxBytesPerChunk: 1000,
  secretKey: "your_secret_key",
  validateEventsSig: false,
  waitForRealyAckWhenSendingChunks: true
});
```
