/**
 * based on https://github.com/yjs/y-websocket/blob/master/src/y-websocket.js
 */

/* eslint-env browser */

import type * as Y from "yjs";
import { mergeUpdates } from "yjs";
import * as bc from "lib0/broadcastchannel";
import * as time from "lib0/time";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import { ObservableV2 } from "lib0/observable";
import * as env from "lib0/environment";
import type { Socket, Channel, Push } from "phoenix";

declare module "phoenix" {
  interface Channel {
    // It’s not ideal since it’s a private member, but it was added as a workaround for cases where a channel instance is passed externally, and the joined event cannot be received from the channel instance.
    joinPush: Push;
  }
}

export const messageSync = 0;
export const messageQueryAwareness = 3;
export const messageAwareness = 1;

/**
 *                       encoder,          decoder,          provider,          emitSynced, messageType
 * @type {Array<function(encoding.Encoder, decoding.Decoder, PhoenixChannelProvider, boolean,    number):void>}
 */
const messageHandlers: ((
  encoder: encoding.Encoder,
  decoder: decoding.Decoder,
  PhoenixChannelProvider: PhoenixChannelProvider,
  emitSynced: boolean,
  messageType: number,
) => void)[] = [];

messageHandlers[messageSync] = (
  encoder,
  decoder,
  provider,
  emitSynced,
  _messageType,
) => {
  encoding.writeVarUint(encoder, messageSync);
  const syncMessageType = syncProtocol.readSyncMessage(
    decoder,
    encoder,
    provider.doc,
    provider,
  );
  if (
    emitSynced &&
    syncMessageType === syncProtocol.messageYjsSyncStep2 &&
    !provider.synced
  ) {
    provider.synced = true;
  }
};

messageHandlers[messageQueryAwareness] = (
  encoder,
  _decoder,
  provider,
  _emitSynced,
  _messageType,
) => {
  encoding.writeVarUint(encoder, messageAwareness);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(
      provider.awareness,
      Array.from(provider.awareness.getStates().keys()),
    ),
  );
};

messageHandlers[messageAwareness] = (
  _encoder,
  decoder,
  provider,
  _emitSynced,
  _messageType,
) => {
  awarenessProtocol.applyAwarenessUpdate(
    provider.awareness,
    decoding.readVarUint8Array(decoder),
    provider,
  );
};

/**
 * @param {PhoenixChannelProvider} provider
 * @param {Uint8Array} buf
 * @param {boolean} emitSynced
 * @return {encoding.Encoder}
 */
const readMessage = (
  provider: PhoenixChannelProvider,
  buf: Uint8Array,
  emitSynced: boolean,
): encoding.Encoder => {
  const decoder = decoding.createDecoder(buf);
  const encoder = encoding.createEncoder();
  const messageType = decoding.readVarUint(decoder);
  const messageHandler = provider.messageHandlers[messageType];
  if (/** @type {any} */ messageHandler) {
    messageHandler(encoder, decoder, provider, emitSynced, messageType);
  } else {
    console.error("Unable to compute message");
  }
  return encoder;
};

const setupChannel = (provider: PhoenixChannelProvider, joinPush: Push) => {
  if (provider.shouldConnect && provider.channel != null) {
    provider.channel.onError(() => {
      provider.emit("status", [
        {
          status: "disconnected",
        },
      ]);
      provider.synced = false;
      // update awareness (all users except local left)
      awarenessProtocol.removeAwarenessStates(
        provider.awareness,
        Array.from(provider.awareness.getStates().keys()).filter(
          (client) => client !== provider.doc.clientID,
        ),
        provider,
      );
    });
    provider.channel.onClose(() => {
      provider.emit("status", [
        {
          status: "disconnected",
        },
      ]);
      provider.synced = false;
      // update awareness (all users except local left)
      awarenessProtocol.removeAwarenessStates(
        provider.awareness,
        Array.from(provider.awareness.getStates().keys()).filter(
          (client) => client !== provider.doc.clientID,
        ),
        provider,
      );
    });

    provider.channel.on("yjs", (data) => {
      provider.wsLastMessageReceived = time.getUnixTime();
      const encoder = readMessage(provider, new Uint8Array(data), true);
      if (encoding.length(encoder) > 1) {
        provider.channel?.push("yjs", encoding.toUint8Array(encoder).buffer);
      }
    });

    provider.emit("status", [
      {
        status: "connecting",
      },
    ]);
    const handleJoined = () => {
      provider.emit("status", [
        {
          status: "connected",
        },
      ]);

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeSyncStep1(encoder, provider.doc);

      const data = encoding.toUint8Array(encoder);
      provider.channel?.push("yjs_sync", data.buffer);

      // broadcast local awareness state
      if (provider.awareness.getLocalState() !== null) {
        const encoderAwarenessState = encoding.createEncoder();
        encoding.writeVarUint(encoderAwarenessState, messageAwareness);
        encoding.writeVarUint8Array(
          encoderAwarenessState,
          awarenessProtocol.encodeAwarenessUpdate(provider.awareness, [
            provider.doc.clientID,
          ]),
        );
        provider.channel?.push(
          "yjs",
          encoding.toUint8Array(encoderAwarenessState).buffer,
        );
      }
    };

    switch (provider.channel.state) {
      case "joined":
        handleJoined();
        break;
      case "joining":
        provider.emit("status", [
          {
            status: "connecting",
          },
        ]);
        break;

      default:
        break;
    }
    joinPush.receive("ok", handleJoined);
  }
};

/**
 * @param {PhoenixChannelProvider} provider
 * @param {ArrayBuffer} buf
 */
const broadcastMessage = (
  provider: PhoenixChannelProvider,
  buf: Uint8Array,
) => {
  const channel = provider.channel;
  if (channel?.state === "joined") {
    channel.push("yjs", buf.buffer);
  }
  if (provider.bcconnected) {
    bc.publish(provider.bcChannel, buf, provider);
  }
};

type EventMap = {
  "connection-close": (
    event: CloseEvent | null,
    provider: PhoenixChannelProvider,
  ) => any;
  status: (event: {
    status: "connected" | "disconnected" | "connecting";
  }) => any;
  "connection-error": (event: Event, provider: PhoenixChannelProvider) => any;
  sync: (state: boolean) => any;
};

type Options = {
  /** Whether to connect automatically (default: `true`) */
  connect?: boolean;
  /** Awareness instance */
  awareness?: awarenessProtocol.Awareness;
  /** Channel join parameters */
  params?: object;
  /** Interval (ms) to resync server state. Disabled when <= 0 */
  resyncInterval?: number;
  /** Throttle interval (ms) for document update broadcasts. Disabled when <= 0 (default) */
  updateThrottle?: number;
  /** Throttle interval (ms) for awareness update broadcasts. Disabled when <= 0 (default) */
  awarenessThrottle?: number;
  /** Disable cross-tab BroadcastChannel communication */
  disableBc?: boolean;
  /**
   * External channel instance to use instead of creating a new one.
   * Useful when the channel is created outside the provider and the joined event cannot be received.
   */
  channel?: Channel;
};

/**
 * PhoenixChannelProvider for Yjs. This provider synchronizes Yjs documents using Phoenix Channels.
 * The document name is associated with the specified roomname.
 *
 * @example
 *   import * as Y from 'yjs'
 *   import { PhoenixChannelProvider } from 'y-phoenix-channel'
 *   const doc = new Y.Doc()
 *   const provider = new PhoenixChannelProvider(socket, 'my-document-name', doc)
 *
 * @param {Socket} socket - Phoenix Socket instance
 * @param {string} roomname - Channel name (document name)
 * @param {Y.Doc} doc - Yjs document
 * @param {Options} [opts] - Options
 */
export class PhoenixChannelProvider extends ObservableV2<EventMap> {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  serverUrl: string;
  channel: Channel | undefined;
  socket: Socket;
  bcChannel: string;
  params: object;
  roomname: string;
  bcconnected: boolean;
  disableBc: boolean;
  wsUnsuccessfulReconnects: number;
  messageHandlers: ((
    encoder: encoding.Encoder,
    decoder: decoding.Decoder,
    PhoenixChannelProvider: PhoenixChannelProvider,
    emitSynced: boolean,
    messageType: number,
  ) => void)[];
  _synced: boolean;
  wsLastMessageReceived: number;
  shouldConnect: boolean;
  _resyncInterval: ReturnType<typeof setInterval> | null = null;
  _updateThrottler: Throttler<
    Uint8Array<ArrayBuffer>,
    Uint8Array<ArrayBuffer>[]
  >;
  _awarenessThrottler: Throttler<number[], Set<number>>;
  _bcSubscriber: (data: any, origin: any) => void;
  _updateHandler: (update: any, origin: any) => void;
  _awarenessUpdateHandler: (
    { added, updated, removed }: { added: any; updated: any; removed: any },
    _origin: any,
  ) => void;
  _exitHandler: () => void;
  defaultChannel: Channel | undefined;
  /**
   */
  constructor(
    socket: Socket,
    roomname: string,
    doc: Y.Doc,
    {
      channel: defaultChannel = undefined,
      connect = true,
      awareness = new awarenessProtocol.Awareness(doc),
      params = {},
      resyncInterval = -1,
      updateThrottle = 0,
      awarenessThrottle = 0,
      disableBc = false,
    }: Options = {},
  ) {
    super();
    this.socket = socket;
    this.serverUrl = socket.endPointURL();
    this.bcChannel = this.serverUrl + "/" + roomname;
    /**
     * The specified url parameters. This can be safely updated. The changed parameters will be used
     * when a new connection is established.
     * @type {Object<string,string>}
     */
    this.params = params;
    this.roomname = roomname;
    this.doc = doc;
    this.awareness = awareness;
    this.bcconnected = false;
    this.disableBc = disableBc;
    this.wsUnsuccessfulReconnects = 0;
    this.messageHandlers = messageHandlers.slice();
    this.defaultChannel = defaultChannel;
    this._updateThrottler = new Throttler<
      Uint8Array<ArrayBuffer>,
      Uint8Array<ArrayBuffer>[]
    >({
      interval: updateThrottle,
      createPending: () => [],
      hasPending: (pending) => pending.length > 0,
      addPending: (pending, update) => {
        pending.push(update);
      },
      flushPending: (pending) => {
        this._sendMergedDocumentUpdates(pending);
      },
      sendImmediate: (update) => {
        this._sendDocumentUpdate(update);
      },
    });
    this._awarenessThrottler = new Throttler<number[], Set<number>>({
      interval: awarenessThrottle,
      createPending: () => new Set<number>(),
      hasPending: (pending) => pending.size > 0,
      addPending: (pending, changedClients) => {
        for (const client of changedClients) {
          pending.add(client);
        }
      },
      flushPending: (pending) => {
        this._sendAwarenessChanges(Array.from(pending));
      },
      sendImmediate: (changedClients) => {
        this._sendAwarenessChanges(changedClients);
      },
    });
    /**
     * @type {boolean}
     */
    this._synced = false;
    this.wsLastMessageReceived = 0;
    /**
     * Whether to connect to other peers or not
     * @type {boolean}
     */
    this.shouldConnect = connect;

    if (resyncInterval > 0) {
      this._resyncInterval = setInterval(() => {
        if (this.channel && this.channel.state == "joined") {
          // resend sync step 1
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.writeSyncStep1(encoder, doc);
          this.channel.push("yjs_sync", encoding.toUint8Array(encoder).buffer);
        }
      }, resyncInterval);
    }

    /**
     * @param {ArrayBuffer} data
     * @param {any} origin
     */
    this._bcSubscriber = (data, origin) => {
      if (origin !== this) {
        const encoder = readMessage(this, new Uint8Array(data), false);
        if (encoding.length(encoder) > 1) {
          bc.publish(this.bcChannel, encoding.toUint8Array(encoder), this);
        }
      }
    };
    /**
     * Listens to Yjs updates and sends them to remote peers (ws and broadcastchannel)
     * @param {Uint8Array} update
     * @param {any} origin
     */
    this._updateHandler = (update: Uint8Array<ArrayBuffer>, origin) => {
      if (origin !== this) {
        this._updateThrottler.enqueue(update);
      }
    };
    this.doc.on("update", this._updateHandler);
    /**
     * @param {any} changed
     * @param {any} _origin
     */
    this._awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
      if (origin !== this) {
        const changedClients: number[] = added.concat(updated).concat(removed);
        this._awarenessThrottler.enqueue(changedClients);
      }
    };
    this._exitHandler = () => {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [doc.clientID],
        "app closed",
      );
    };
    if (env.isNode && typeof process !== "undefined") {
      process.on("exit", this._exitHandler);
    }
    awareness.on("update", this._awarenessUpdateHandler);
    if (connect) {
      this.connect();
    }
  }

  /**
   * @type {boolean}
   */
  get synced() {
    return this._synced;
  }

  set synced(state) {
    if (this._synced !== state) {
      this._synced = state;
      // @ts-expect-error
      this.emit("synced", [state]);
      this.emit("sync", [state]);
    }
  }

  get updateThrottle(): number {
    return this._updateThrottler.interval;
  }

  set updateThrottle(value: number) {
    this._updateThrottler.interval = value;
  }

  get awarenessThrottle(): number {
    return this._awarenessThrottler.interval;
  }

  set awarenessThrottle(value: number) {
    this._awarenessThrottler.interval = value;
  }

  _sendDocumentUpdate(update: Uint8Array<ArrayBuffer>) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    broadcastMessage(this, encoding.toUint8Array(encoder));
  }

  _sendMergedDocumentUpdates(pendingUpdates: Uint8Array<ArrayBuffer>[]) {
    const mergedUpdate =
      pendingUpdates.length === 1
        ? pendingUpdates[0]
        : mergeUpdates(pendingUpdates);
    this._sendDocumentUpdate(mergedUpdate as Uint8Array<ArrayBuffer>);
  }

  _sendAwarenessChanges(changedClients: number[]) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
    );
    broadcastMessage(this, encoding.toUint8Array(encoder));
  }

  destroy() {
    if (this._resyncInterval != null) {
      clearInterval(this._resyncInterval);
    }
    this._updateThrottler.destroy();
    this._awarenessThrottler.destroy();
    this.disconnect();
    if (env.isNode && typeof process !== "undefined") {
      process.off("exit", this._exitHandler);
    }
    this.awareness.off("update", this._awarenessUpdateHandler);
    this.doc.off("update", this._updateHandler);
    super.destroy();
  }

  connectBc() {
    if (this.disableBc) {
      return;
    }
    if (!this.bcconnected) {
      bc.subscribe(this.bcChannel, this._bcSubscriber);
      this.bcconnected = true;
    }
    // send sync step1 to bc
    // write sync step 1
    const encoderSync = encoding.createEncoder();
    encoding.writeVarUint(encoderSync, messageSync);
    syncProtocol.writeSyncStep1(encoderSync, this.doc);
    bc.publish(this.bcChannel, encoding.toUint8Array(encoderSync), this);
    // broadcast local state
    const encoderState = encoding.createEncoder();
    encoding.writeVarUint(encoderState, messageSync);
    syncProtocol.writeSyncStep2(encoderState, this.doc);
    bc.publish(this.bcChannel, encoding.toUint8Array(encoderState), this);
    // write queryAwareness
    const encoderAwarenessQuery = encoding.createEncoder();
    encoding.writeVarUint(encoderAwarenessQuery, messageQueryAwareness);
    bc.publish(
      this.bcChannel,
      encoding.toUint8Array(encoderAwarenessQuery),
      this,
    );
    // broadcast local awareness state
    const encoderAwarenessState = encoding.createEncoder();
    encoding.writeVarUint(encoderAwarenessState, messageAwareness);
    encoding.writeVarUint8Array(
      encoderAwarenessState,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
        this.doc.clientID,
      ]),
    );
    bc.publish(
      this.bcChannel,
      encoding.toUint8Array(encoderAwarenessState),
      this,
    );
  }

  disconnectBc() {
    // broadcast message with local awareness state set to null (indicating disconnect)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(
        this.awareness,
        [this.doc.clientID],
        new Map(),
      ),
    );
    broadcastMessage(this, encoding.toUint8Array(encoder));
    if (this.bcconnected) {
      bc.unsubscribe(this.bcChannel, this._bcSubscriber);
      this.bcconnected = false;
    }
  }

  disconnect() {
    this.shouldConnect = false;
    this.disconnectBc();
    if (this.channel != null) {
      this.channel?.leave();
    }
    this.channel = undefined;
  }

  connect() {
    this.shouldConnect = true;
    if (this.channel == null) {
      if (this.defaultChannel !== undefined) {
        this.channel = this.defaultChannel;
        setupChannel(this, this.channel.joinPush);
      } else {
        this.channel = this.socket.channel(this.roomname, this.params);

        setupChannel(this, this.channel.join());
      }
      this.connectBc();
    }
  }
}

type ThrottlerOptions<TInput, TPending> = {
  interval: number;
  createPending: () => TPending;
  hasPending: (pending: TPending) => boolean;
  addPending: (pending: TPending, input: TInput) => void;
  flushPending: (pending: TPending) => void;
  sendImmediate: (input: TInput) => void;
  now?: () => number;
};

class Throttler<TInput, TPending> {
  private _interval: number;
  private _pending: TPending;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _lastSentAt: number | null = null;
  private _now: () => number;

  private readonly _createPending: () => TPending;
  private readonly _hasPending: (pending: TPending) => boolean;
  private readonly _addPending: (pending: TPending, input: TInput) => void;
  private readonly _flushPending: (pending: TPending) => void;
  private readonly _sendImmediate: (input: TInput) => void;

  constructor(options: ThrottlerOptions<TInput, TPending>) {
    this._interval = options.interval;
    this._createPending = options.createPending;
    this._hasPending = options.hasPending;
    this._addPending = options.addPending;
    this._flushPending = options.flushPending;
    this._sendImmediate = options.sendImmediate;
    this._now = options.now ?? Date.now;
    this._pending = this._createPending();
  }

  get interval(): number {
    return this._interval;
  }

  set interval(value: number) {
    this._interval = value;

    if (value <= 0) {
      if (this._timer != null) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      this.flush();
      return;
    }

    if (this._timer != null) {
      clearTimeout(this._timer);
      this._timer = null;
      this._schedule();
    }
  }

  enqueue(input: TInput) {
    if (this._interval <= 0) {
      this._sendImmediate(input);
      return;
    }

    const now = this._now();
    if (
      this._timer == null &&
      !this._hasPending(this._pending) &&
      (this._lastSentAt == null || now - this._lastSentAt >= this._interval)
    ) {
      this._sendImmediate(input);
      this._lastSentAt = now;
      return;
    }

    this._addPending(this._pending, input);
    this._schedule();
  }

  flush() {
    this._timer = null;
    if (!this._hasPending(this._pending)) {
      return;
    }

    const pending = this._pending;
    this._pending = this._createPending();
    this._flushPending(pending);
    this._lastSentAt = this._now();
  }

  destroy() {
    if (this._timer != null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._pending = this._createPending();
  }

  private _schedule() {
    if (this._timer != null) {
      return;
    }

    const now = this._now();
    const elapsed =
      this._lastSentAt == null ? this._interval : now - this._lastSentAt;
    const wait = Math.max(this._interval - elapsed, 0);

    this._timer = setTimeout(() => {
      this.flush();
    }, wait);
  }
}
