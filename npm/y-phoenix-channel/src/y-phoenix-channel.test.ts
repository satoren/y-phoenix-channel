import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding.js'
import * as decoding from 'lib0/decoding.js'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import { PhoenixChannelProvider, messageSync } from './y-phoenix-channel'
import type { Socket, Channel } from 'phoenix'

// Mock Socket and Channel using builder pattern similar to msw-phoenix.channel-binding
class MockChannelBuilder {
  private state: string = 'joined'
  private listeners: Record<string, Function[]> = {}
  private errorListeners: Function[] = []
  private closeListeners: Function[] = []
  private pushHandler = vi.fn()
  private leaveFn = vi.fn()
  private joinPushReceiver: Function | null = null

  withState(state: string): MockChannelBuilder {
    this.state = state
    return this
  }

  onMessage(event: string, callback: Function): MockChannelBuilder {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(callback)
    return this
  }

  build(): Channel {
    const self = this
    const joinPush = {
      receive: vi.fn((event: string, callback: Function) => {
        if (event === 'ok') {
          self.joinPushReceiver = callback
          callback()
        }
        return joinPush
      }),
    }

    return {
      state: this.state,
      push: this.pushHandler,
      on: vi.fn((event: string, callback: Function) => {
        if (!self.listeners[event]) {
          self.listeners[event] = []
        }
        self.listeners[event].push(callback)
      }),
      onError: vi.fn((callback: Function) => {
        self.errorListeners.push(callback)
      }),
      onClose: vi.fn((callback: Function) => {
        self.closeListeners.push(callback)
      }),
      leave: this.leaveFn,
      join: vi.fn(() => joinPush),
      joinPush: joinPush as any,
      _triggerMessage: (event: string, data: any) => {
        self.listeners[event]?.forEach(cb => cb(data))
      },
      _triggerError: () => {
        self.errorListeners.forEach(cb => cb())
      },
      _triggerClose: () => {
        self.closeListeners.forEach(cb => cb())
      },
    } as any as Channel
  }
}

const createMockSocket = (): Socket => {
  const channels: Map<string, Channel> = new Map()
  
  return {
    endPointURL: vi.fn(() => 'ws://localhost:4000/socket'),
    channel: vi.fn((topic: string, params?: any) => {
      let channel = channels.get(topic)
      if (!channel) {
        channel = new MockChannelBuilder().build()
        channels.set(topic, channel)
      }
      return channel
    }),
  } as any as Socket
}

const createMockChannel = (state: string = 'joined'): Channel => {
  return new MockChannelBuilder().withState(state).build()
}

describe('PhoenixChannelProvider', () => {
  let doc: Y.Doc
  let socket: Socket
  let provider: PhoenixChannelProvider

  beforeEach(() => {
    doc = new Y.Doc()
    socket = createMockSocket()
    provider = new PhoenixChannelProvider(socket, 'test-room', doc, {
      connect: false, // disable auto-connect
    })
  })

  afterEach(() => {
    provider.destroy()
    doc.destroy()
  })

  describe('constructor', () => {
    it('should initialize with correct properties', () => {
      expect(provider.doc).toBe(doc)
      expect(provider.roomname).toBe('test-room')
      expect(provider.socket).toBe(socket)
      expect(provider.bcChannel).toContain('test-room')
    })

    it('should set connect = false when disabled', () => {
      expect(provider.shouldConnect).toBe(false)
    })

    it('should create awareness instance', () => {
      expect(provider.awareness).toBeDefined()
      expect(provider.awareness.doc).toBe(doc)
    })

    it('should not be synced initially', () => {
      expect(provider.synced).toBe(false)
    })

    it('should accept custom params', () => {
      const customParams = { token: 'test-token' }
      const customProvider = new PhoenixChannelProvider(
        socket,
        'test-room',
        doc,
        { connect: false, params: customParams }
      )
      expect(customProvider.params).toEqual(customParams)
      customProvider.destroy()
    })

    it('should accept custom awareness', () => {
      const customDoc = new Y.Doc()
      const customAwareness = new awarenessProtocol.Awareness(customDoc)
      const customProvider = new PhoenixChannelProvider(
        socket,
        'test-room',
        customDoc,
        { connect: false, awareness: customAwareness }
      )
      expect(customProvider.awareness).toBe(customAwareness)
      customProvider.destroy()
      customDoc.destroy()
    })
  })

  describe('connect', () => {
    it('should set shouldConnect to true', () => {
      provider.connect()
      expect(provider.shouldConnect).toBe(true)
    })

    it('should create a channel if not exists', () => {
      provider.connect()
      expect(socket.channel).toHaveBeenCalledWith('test-room', {})
    })

    it('should use default channel if provided', () => {
      const defaultChannel = createMockChannel()
      const newSocket = createMockSocket()
      const customProvider = new PhoenixChannelProvider(
        newSocket,
        'test-room-2',
        new Y.Doc(),
        { connect: false, channel: defaultChannel }
      )
      customProvider.connect()
      expect(customProvider.channel).toBe(defaultChannel)
      customProvider.destroy()
    })
  })

  describe('disconnect', () => {
    it('should set shouldConnect to false', () => {
      provider.connect()
      provider.disconnect()
      expect(provider.shouldConnect).toBe(false)
    })

    it('should leave channel if connected', () => {
      provider.connect()
      const leaveSpy = vi.spyOn(provider.channel!, 'leave')
      provider.disconnect()
      expect(leaveSpy).toHaveBeenCalled()
    })

    it('should set channel to undefined', () => {
      provider.connect()
      provider.disconnect()
      expect(provider.channel).toBeUndefined()
    })
  })

  describe('rejoin backoff', () => {
    it('should rejoin with delay on close when using internally created channel', () => {
      vi.useFakeTimers()
      try {
        const localDoc = new Y.Doc()
        const localProvider = new PhoenixChannelProvider(
          socket,
          'test-room',
          localDoc,
          {
            connect: false,
            rejoinBackoff: (tries) => Math.min(100 * Math.pow(2, tries - 1), 1000),
          }
        )

        localProvider.connect()
        expect(socket.channel).toHaveBeenCalledTimes(1)

        ;(localProvider.channel as any)._triggerClose()

        vi.advanceTimersByTime(99)
        expect(socket.channel).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(1)
        expect(socket.channel).toHaveBeenCalledTimes(2)

        localProvider.destroy()
        localDoc.destroy()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should not schedule rejoin when external channel option is provided', () => {
      vi.useFakeTimers()
      try {
        const localDoc = new Y.Doc()
        const externalChannel = createMockChannel('joined')
        const localProvider = new PhoenixChannelProvider(
          socket,
          'test-room',
          localDoc,
          {
            connect: false,
            channel: externalChannel,
            rejoinBackoff: (tries) => Math.min(100 * Math.pow(2, tries - 1), 1000),
          }
        )

        localProvider.connect()
        expect(socket.channel).not.toHaveBeenCalled()

        ;(externalChannel as any)._triggerClose()
        vi.advanceTimersByTime(1000)

        expect(socket.channel).not.toHaveBeenCalled()

        localProvider.destroy()
        localDoc.destroy()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('synced property', () => {
    it('should emit sync event when synced state changes', () => {
      return new Promise<void>((resolve) => {
        provider.on('sync', (state: boolean) => {
          expect(state).toBe(true)
          resolve()
        })
        provider.synced = true
      })
    })

    it('should not emit if state does not change', () => {
      const handler = vi.fn()
      provider.on('sync', handler)
      provider.synced = false
      provider.synced = false
      expect(handler).not.toHaveBeenCalled()
    })

    it('should toggle synced state', () => {
      expect(provider.synced).toBe(false)
      provider.synced = true
      expect(provider.synced).toBe(true)
      provider.synced = false
      expect(provider.synced).toBe(false)
    })
  })

  describe('destroy', () => {
    it('should disconnect before destroying', () => {
      provider.connect()
      const disconnectSpy = vi.spyOn(provider, 'disconnect')
      provider.destroy()
      expect(disconnectSpy).toHaveBeenCalled()
    })

    it('should clear resync interval', () => {
      const providerWithInterval = new PhoenixChannelProvider(
        socket,
        'test-room',
        doc,
        { connect: false, resyncInterval: 1000 }
      )
      const clearSpy = vi.spyOn(global, 'clearInterval')
      providerWithInterval.destroy()
      expect(clearSpy).toHaveBeenCalled()
    })

    it('should remove update handler', () => {
      const destroySpy = vi.spyOn(provider, 'disconnect')
      provider.destroy()
      expect(destroySpy).toHaveBeenCalled()
    })
  })

  describe('connectBc', () => {
    it('should not connect to broadcast channel if disabled', () => {
      const providerNoBc = new PhoenixChannelProvider(
        socket,
        'test-room',
        doc,
        { connect: false, disableBc: true }
      )
      providerNoBc.connectBc()
      expect(providerNoBc.bcconnected).toBe(false)
      providerNoBc.destroy()
    })

    it('should set bcconnected to true', () => {
      provider.connectBc()
      expect(provider.bcconnected).toBe(true)
    })
  })

  describe('disconnectBc', () => {
    it('should set bcconnected to false', () => {
      provider.connectBc()
      provider.disconnectBc()
      expect(provider.bcconnected).toBe(false)
    })
  })

  describe('Yjs document updates', () => {
    it('should track document updates', () => {
      const ytext = doc.getText('test')
      ytext.insert(0, 'hello')
      
      expect(ytext.toString()).toBe('hello')
    })

    it('should handle multiple document types', () => {
      const yarray = doc.getArray('items')
      const ymap = doc.getMap('data')
      
      expect(yarray).toBeDefined()
      expect(ymap).toBeDefined()
    })
  })

  describe('message handlers', () => {
    it('should have message handlers registered', () => {
      expect(provider.messageHandlers.length).toBeGreaterThan(0)
      expect(provider.messageHandlers[0]).toBeDefined() // messageSync
      expect(provider.messageHandlers[1]).toBeDefined() // messageAwareness
      expect(provider.messageHandlers[3]).toBeDefined() // messageQueryAwareness
    })
  })

  describe('awareness updates', () => {
    it('should initialize awareness', () => {
      const localState = provider.awareness.getLocalState()
      expect(localState === null || localState === undefined || Object.keys(localState).length === 0).toBe(true)
    })

    it('should set local awareness state', () => {
      const state = { user: 'testUser' }
      provider.awareness.setLocalState(state)
      expect(provider.awareness.getLocalState()).toEqual(state)
    })

    it('should emit awareness update events', () => {
      return new Promise<void>((resolve, reject) => {
        const updateHandler = vi.fn(() => {
          try {
            expect(updateHandler).toHaveBeenCalled()
            resolve()
          } catch (error) {
            reject(error)
          } finally {
            provider.awareness.off('update', updateHandler)
          }
        })

        provider.awareness.on('update', updateHandler)
        provider.awareness.setLocalState({ user: 'testUser' })
      })
    })
  })

  describe('resync interval', () => {
    it('should create resync interval if specified', () => {
      const customProvider = new PhoenixChannelProvider(
        socket,
        'test-room',
        doc,
        { connect: false, resyncInterval: 1000 }
      )
      expect(customProvider._resyncInterval).toBeDefined()
      customProvider.destroy()
    })

    it('should not create resync interval if negative', () => {
      const customProvider = new PhoenixChannelProvider(
        socket,
        'test-room',
        doc,
        { connect: false, resyncInterval: -1 }
      )
      expect(customProvider._resyncInterval).toBeNull()
      customProvider.destroy()
    })
  })

  describe('throttle interval', () => {
    it('should broadcast document updates immediately when throttle interval is 0', () => {
      const localDoc = new Y.Doc()
      const localProvider = new PhoenixChannelProvider(
        socket,
        'test-room',
        localDoc,
        { connect: false, updateThrottle: 0 }
      )
      localProvider.channel = createMockChannel('joined')
      const pushSpy = vi.spyOn(localProvider.channel, 'push')
      const ytext = localDoc.getText('test')

      ytext.insert(0, 'a')
      ytext.insert(1, 'b')

      expect(pushSpy).toHaveBeenCalledTimes(2)

      localProvider.destroy()
      localDoc.destroy()
    })

    it('should send first update immediately and flush buffered updates after throttle window', () => {
      vi.useFakeTimers()
      try {
        const localDoc = new Y.Doc()
        const localProvider = new PhoenixChannelProvider(
          socket,
          'test-room',
          localDoc,
          { connect: false, updateThrottle: 50 }
        )
        localProvider.channel = createMockChannel('joined')
        const pushSpy = vi.spyOn(localProvider.channel, 'push')
        const ytext = localDoc.getText('test')

        ytext.insert(0, 'a')
        ytext.insert(1, 'b')

        expect(pushSpy).toHaveBeenCalledTimes(1) // first sent immediately

        vi.advanceTimersByTime(50)

        expect(pushSpy).toHaveBeenCalledTimes(2) // buffered second flushed after interval

        const remoteDoc = new Y.Doc()
        for (const call of pushSpy.mock.calls) {
          const payload = new Uint8Array(call[1] as ArrayBuffer)
          const decoder = decoding.createDecoder(payload)
          expect(decoding.readVarUint(decoder)).toBe(messageSync)
          const replyEncoder = encoding.createEncoder()
          syncProtocol.readSyncMessage(decoder, replyEncoder, remoteDoc, null)
        }
        expect(remoteDoc.getText('test').toString()).toBe('ab')

        remoteDoc.destroy()
        localProvider.destroy()
        localDoc.destroy()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should discard pending updates when destroyed before throttle flush', () => {
      vi.useFakeTimers()
      try {
        const localDoc = new Y.Doc()
        const localProvider = new PhoenixChannelProvider(
          socket,
          'test-room',
          localDoc,
          { connect: false, updateThrottle: 50 }
        )
        localProvider.channel = createMockChannel('joined')
        const pushSpy = vi.spyOn(localProvider.channel, 'push')
        const ytext = localDoc.getText('test')

        ytext.insert(0, 'a') // sent immediately (leading edge)
        ytext.insert(1, 'b') // buffered during throttle window
        expect(pushSpy).toHaveBeenCalledTimes(1)

        localProvider.destroy()
        const callsAfterDestroy = pushSpy.mock.calls.length
        vi.advanceTimersByTime(50)
        expect(pushSpy.mock.calls.length).toBe(callsAfterDestroy)

        localDoc.destroy()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should enforce minimum interval after a flush before sending next update', () => {
      vi.useFakeTimers()
      try {
        const localDoc = new Y.Doc()
        const localProvider = new PhoenixChannelProvider(
          socket,
          'test-room',
          localDoc,
          { connect: false, updateThrottle: 50 }
        )
        localProvider.channel = createMockChannel('joined')
        const pushSpy = vi.spyOn(localProvider.channel, 'push')
        const ytext = localDoc.getText('test')

        ytext.insert(0, 'a') // immediate
        ytext.insert(1, 'b') // buffered
        expect(pushSpy).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(50)
        expect(pushSpy).toHaveBeenCalledTimes(2) // flush happened

        ytext.insert(2, 'c') // comes right after flush
        expect(pushSpy).toHaveBeenCalledTimes(2) // should not send immediately

        vi.advanceTimersByTime(49)
        expect(pushSpy).toHaveBeenCalledTimes(2)

        vi.advanceTimersByTime(1)
        expect(pushSpy).toHaveBeenCalledTimes(3)

        const remoteDoc = new Y.Doc()
        for (const call of pushSpy.mock.calls) {
          const payload = new Uint8Array(call[1] as ArrayBuffer)
          const decoder = decoding.createDecoder(payload)
          expect(decoding.readVarUint(decoder)).toBe(messageSync)
          const replyEncoder = encoding.createEncoder()
          syncProtocol.readSyncMessage(decoder, replyEncoder, remoteDoc, null)
        }
        expect(remoteDoc.getText('test').toString()).toBe('abc')

        remoteDoc.destroy()
        localProvider.destroy()
        localDoc.destroy()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('awareness throttle interval', () => {
    it('should broadcast awareness updates immediately when interval is 0', () => {
      const localDoc = new Y.Doc()
      const localProvider = new PhoenixChannelProvider(
        socket,
        'test-room',
        localDoc,
        { connect: false, awarenessThrottle: 0 }
      )
      localProvider.channel = createMockChannel('joined')
      const pushSpy = vi.spyOn(localProvider.channel, 'push')

      localProvider.awareness.setLocalState({ user: 'a' })
      localProvider.awareness.setLocalState({ user: 'b' })

      expect(pushSpy).toHaveBeenCalledTimes(2)

      localProvider.destroy()
      localDoc.destroy()
    })

    it('should send first awareness update immediately and flush buffered after throttle window', () => {
      vi.useFakeTimers()
      try {
        const localDoc = new Y.Doc()
        const localProvider = new PhoenixChannelProvider(
          socket,
          'test-room',
          localDoc,
          { connect: false, awarenessThrottle: 50 }
        )
        localProvider.channel = createMockChannel('joined')
        const pushSpy = vi.spyOn(localProvider.channel, 'push')

        localProvider.awareness.setLocalState({ user: 'a' })
        localProvider.awareness.setLocalState({ user: 'b' })

        expect(pushSpy).toHaveBeenCalledTimes(1) // first sent immediately

        vi.advanceTimersByTime(50)

        expect(pushSpy).toHaveBeenCalledTimes(2) // buffered second flushed after interval

        localProvider.destroy()
        localDoc.destroy()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should discard pending awareness updates when destroyed before flush', () => {
      vi.useFakeTimers()
      try {
        const localDoc = new Y.Doc()
        const localProvider = new PhoenixChannelProvider(
          socket,
          'test-room',
          localDoc,
          { connect: false, awarenessThrottle: 50 }
        )
        localProvider.channel = createMockChannel('joined')
        const pushSpy = vi.spyOn(localProvider.channel, 'push')

        localProvider.awareness.setLocalState({ user: 'a' }) // sent immediately (leading edge)
        localProvider.awareness.setLocalState({ user: 'b' }) // buffered during throttle window
        expect(pushSpy).toHaveBeenCalledTimes(1)

        localProvider.destroy()
        const callsAfterDestroy = pushSpy.mock.calls.length
        vi.advanceTimersByTime(50)
        expect(pushSpy.mock.calls.length).toBe(callsAfterDestroy)

        localDoc.destroy()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should enforce minimum interval after flush before sending next awareness update', () => {
      vi.useFakeTimers()
      try {
        const localDoc = new Y.Doc()
        const localProvider = new PhoenixChannelProvider(
          socket,
          'test-room',
          localDoc,
          { connect: false, awarenessThrottle: 50 }
        )
        localProvider.channel = createMockChannel('joined')
        const pushSpy = vi.spyOn(localProvider.channel, 'push')

        localProvider.awareness.setLocalState({ user: 'a' }) // immediate
        localProvider.awareness.setLocalState({ user: 'b' }) // buffered
        expect(pushSpy).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(50)
        expect(pushSpy).toHaveBeenCalledTimes(2) // flush happened

        localProvider.awareness.setLocalState({ user: 'c' })
        expect(pushSpy).toHaveBeenCalledTimes(2) // should not send immediately

        vi.advanceTimersByTime(49)
        expect(pushSpy).toHaveBeenCalledTimes(2)

        vi.advanceTimersByTime(1)
        expect(pushSpy).toHaveBeenCalledTimes(3)

        localProvider.destroy()
        localDoc.destroy()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('runtime throttle change', () => {
    it('should flush pending updates immediately when updateThrottle is set to 0', () => {
      vi.useFakeTimers()
      try {
        const localDoc = new Y.Doc()
        const localProvider = new PhoenixChannelProvider(
          socket,
          'test-room',
          localDoc,
          { connect: false, updateThrottle: 50 }
        )
        localProvider.channel = createMockChannel('joined')
        const pushSpy = vi.spyOn(localProvider.channel, 'push')
        const ytext = localDoc.getText('test')

        ytext.insert(0, 'a') // leading-edge: sent immediately
        ytext.insert(1, 'b') // buffered

        expect(pushSpy).toHaveBeenCalledTimes(1)

        localProvider.updateThrottle = 0 // should flush 'b' right now

        expect(pushSpy).toHaveBeenCalledTimes(2)

        vi.advanceTimersByTime(50) // timer should already be gone
        expect(pushSpy).toHaveBeenCalledTimes(2)

        localProvider.destroy()
        localDoc.destroy()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should flush pending awareness changes immediately when awarenessThrottle is set to 0', () => {
      vi.useFakeTimers()
      try {
        const localDoc = new Y.Doc()
        const localProvider = new PhoenixChannelProvider(
          socket,
          'test-room',
          localDoc,
          { connect: false, awarenessThrottle: 50 }
        )
        localProvider.channel = createMockChannel('joined')
        const pushSpy = vi.spyOn(localProvider.channel, 'push')

        localProvider.awareness.setLocalState({ user: 'a' }) // leading-edge: sent
        localProvider.awareness.setLocalState({ user: 'b' }) // buffered

        expect(pushSpy).toHaveBeenCalledTimes(1)

        localProvider.awarenessThrottle = 0 // should flush right now

        expect(pushSpy).toHaveBeenCalledTimes(2)

        vi.advanceTimersByTime(50)
        expect(pushSpy).toHaveBeenCalledTimes(2)

        localProvider.destroy()
        localDoc.destroy()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('event emission', () => {
    it('should emit status event', () => {
      return new Promise<void>((resolve) => {
        provider.on('status', (event: { status: string }) => {
          expect(['connected', 'disconnected', 'connecting']).toContain(event.status)
          resolve()
        })
        provider.emit('status', [{ status: 'connecting' }])
      })
    })

    it('should allow multiple event listeners', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      
      provider.on('sync', handler1)
      provider.on('sync', handler2)
      
      provider.synced = true
      
      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })
  })
})
