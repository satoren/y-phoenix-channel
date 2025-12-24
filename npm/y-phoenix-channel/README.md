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

## Options

- connect: Automatically connect after provider construction. Default is true.
- awareness: Custom Awareness instance.
- params: Channel join parameters.
- resyncInterval: Interval in milliseconds to request full sync from server. Disabled by default.
- updateThrottle: Interval in milliseconds to throttle document update broadcasts. Default is 0.
  While throttled, incoming updates are buffered and merged with Y.mergeUpdates before a single broadcast.
- awarenessThrottle: Interval in milliseconds to throttle awareness update broadcasts. Default is 0.
  While throttled, changed client IDs are accumulated (deduplicated) and sent in a single broadcast.
- disableBc: Disable BroadcastChannel communication across tabs.
- channel: Use a pre-created Phoenix channel instance.