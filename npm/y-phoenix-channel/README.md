# y-phoenix-channel

A provider library for integrating Yjs with Phoenix Channel.

## Installation

```
npm install y-phoenix-channel
```

## Usage

```ts
import { PhoenixChannelProvider } from "y-phoenix-channel";
import * as Y from "yjs";
import { Socket } from "phoenix";

const ydoc = new Y.Doc();
const socket = new Socket("/socket", { params: {} });
const provider = new PhoenixChannelProvider(socket, "room-name", ydoc);
``` 