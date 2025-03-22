import type * as awarenessProtocol from "y-protocols/awareness";
import type * as Y from "yjs";

import { YKeyValue } from "y-utility/y-keyvalue";

import {
  hashElementsVersion,
  reconcileElements,
  type Excalidraw,
} from "@excalidraw/excalidraw";

type ExcalidrawProps = Parameters<typeof Excalidraw>[0];
type ExcalidrawImperativeAPI = Parameters<
  NonNullable<ExcalidrawProps["excalidrawAPI"]>
>[0];
type UpdateSceneParam = Parameters<ExcalidrawImperativeAPI["updateScene"]>[0];
type ExcalidrawElement = NonNullable<UpdateSceneParam["elements"]>[0];
type Collaborators = NonNullable<UpdateSceneParam["collaborators"]>;
type SocketId = Collaborators extends Map<infer K, unknown> ? K : never;
type Collaborator = Collaborators extends Map<unknown, infer V> ? V : never;
type BinaryFileData = Parameters<ExcalidrawImperativeAPI["addFiles"]>[0][0];

export type ExcalidrawBindingElementsStore = Y.Array<{
  key: string;
  val: ExcalidrawElement;
}>;
export type ExcalidrawBindingAssetsStore = Y.Array<{
  key: string;
  val: BinaryFileData;
}>;

const isValidElement = (element: ExcalidrawElement) => {
  return element.id != null;
};

type Option = {
  cursorDisplayTimeout?: number;
};

/**
 * Manages the binding between Excalidraw and Y.js for collaborative drawing
 * Handles synchronization of elements, assets, and user awareness
 */
export class ExcalidrawBinding {
  #yElements: YKeyValue<ExcalidrawElement>;
  #yAssets: YKeyValue<BinaryFileData>;
  #api: ExcalidrawImperativeAPI;
  awareness?: awarenessProtocol.Awareness;
  cursorDisplayTimeout?: number; // milliseconds
  cursorDisplayTimeoutTimer: ReturnType<typeof setInterval> | undefined; // Changed from setTimeout to setInterval
  // Record last update time for each collaborator
  #lastPointerUpdateTime: Map<SocketId, number> = new Map();

  subscriptions: (() => void)[] = [];
  collaborators: Collaborators = new Map();
  lastVersion = 0;
  addedFileIds: Set<string> = new Set();

  /**
   * Initializes the binding between Excalidraw and Y.js
   * @param yElements - Y.js array for storing drawing elements
   * @param yAssets - Y.js array for storing binary assets
   * @param api - Excalidraw imperative API instance
   * @param awareness - Optional Y.js awareness instance for user presence
   */
  constructor(
    yElements: ExcalidrawBindingElementsStore,
    yAssets: ExcalidrawBindingAssetsStore,
    api: ExcalidrawImperativeAPI,
    awareness?: awarenessProtocol.Awareness,
    option?: Option,
  ) {
    this.#yElements = new YKeyValue(yElements);
    this.#yAssets = new YKeyValue(yAssets);
    this.#api = api;
    this.awareness = awareness;
    this.cursorDisplayTimeout = option?.cursorDisplayTimeout;

    let init = false;

    const setInitialElements = () => {
      // Initialize elements and assets from Y.js state
      const initialValue = this.#yElements.yarray
        .map(({ val }) => ({ ...val }))
        .filter(isValidElement);

      this.lastVersion = hashElementsVersion(initialValue);
      this.#api.updateScene({ elements: initialValue,  captureUpdate: "NEVER" });
    };

    // Listen for local changes in Excalidraw and sync to Y.js
    this.subscriptions.push(
      this.#api.onChange(
        throttle((elements, state, files) => {
          if (state.isLoading) {
            return;
          }
          if (!init) {
            setInitialElements();
            init = true;
            return;
          }

          const version = hashElementsVersion(elements);
          if (version !== this.lastVersion) {
            this.#yElements.doc?.transact(() => {
              // check deletion
              for (const yElem of this.#yElements.yarray) {
                const deleted =
                  elements.find((element) => element.id === yElem.key)
                    ?.isDeleted ?? true;
                if (deleted) {
                  this.#yElements.delete(yElem.key);
                }
              }
              for (const element of elements) {
                const remoteElements = this.#yElements.get(element.id);
                if (
                  remoteElements?.versionNonce !== element.versionNonce ||
                  remoteElements?.version !== element.version
                ) {
                  this.#yElements.set(element.id, { ...element });
                }
              }
            }, this);
            this.lastVersion = version;
          }
          if (files) {
            const newFiles = Object.entries(files).filter(([id, file]) => {
              return this.#yAssets.get(id) == null;
            });

            this.#yAssets.doc?.transact(() => {
              for (const [id, file] of newFiles) {
                this.#yAssets.set(id, { ...file });
              }
            }, this);
          }
        }, 50),
      ),
    );

    setInitialElements();

    // Listen for remote changes in Y.js elements and sync to Excalidraw
    const _remoteElementsChangeHandler = (
      event: Array<Y.YEvent<any>>,
      txn: Y.Transaction,
    ) => {
      if (txn.origin === this) {
        return;
      }

      const remoteElements = this.#yElements.yarray
        .map(({ val }) => ({ ...val }))
        .filter(isValidElement);
      const elements = reconcileElements(
        this.#api.getSceneElements(),
        // @ts-expect-error TODO:
        remoteElements,
        this.#api.getAppState(),
      );

      this.#api.updateScene({ elements, captureUpdate: "NEVER" });
    };
    this.#yElements.yarray.observeDeep(_remoteElementsChangeHandler);
    this.subscriptions.push(() =>
      this.#yElements.yarray.unobserveDeep(_remoteElementsChangeHandler),
    );

    // Listen for remote changes in Y.js assets and sync to Excalidraw
    const _remoteFilesChangeHandler = (
      changes: Map<
        string,
        | { action: "delete"; oldValue: BinaryFileData }
        | {
            action: "update";
            oldValue: BinaryFileData;
            newValue: BinaryFileData;
          }
        | { action: "add"; newValue: BinaryFileData }
      >,
      txn: Y.Transaction,
    ) => {
      if (txn.origin === this) {
        return;
      }

      const addedFiles = [...changes.entries()].flatMap(([key, change]) => {
        if (change.action === "add") {
          return [change.newValue];
        }
        return [];
      });
      for (const assets of addedFiles) {
        this.addedFileIds.add(assets.id);
      }
      this.#api.addFiles(addedFiles);
    };
    this.#yAssets.on("change", _remoteFilesChangeHandler); // only observe and not observe deep as assets are only added/deleted not updated
    this.subscriptions.push(() => {
      this.#yAssets.off("change", _remoteFilesChangeHandler);
    });

    if (awareness) {
      const toCollaborator = (state: {
        // biome-ignore lint/suspicious/noExplicitAny: TODO
        [x: string]: any;
      }): Collaborator => {
        return {
          pointer: state.pointer,
          button: state.button,
          selectedElementIds: state.selectedElementIds,
          username: state.user?.name,
          avatarUrl: state.user?.avatarUrl,
          userState: state.user?.state,
          isSpeaking: state.user?.isSpeaking,
          isMuted: state.user?.isMuted,
          isInCall: state.user?.isInCall,
        };
      };
      // Handle remote user presence updates
      const _remoteAwarenessChangeHandler = ({
        added,
        updated,
        removed,
      }: {
        added: number[];
        updated: number[];
        removed: number[];
      }) => {
        const states = awareness.getStates();

        const collaborators = new Map(this.collaborators);
        const update = [...added, ...updated];
        for (const id of update) {
          const state = states.get(id);
          if (!state) {
            continue;
          }

          const socketId = id.toString() as SocketId;
          const newCollaborator = toCollaborator(state);
          const existingCollaborator = collaborators.get(socketId);

          // Only record last update time when pointer is updated
          if (
            newCollaborator.pointer &&
            (!existingCollaborator?.pointer ||
              JSON.stringify(existingCollaborator.pointer) !==
                JSON.stringify(newCollaborator.pointer))
          ) {
            this.#lastPointerUpdateTime.set(socketId, Date.now());
          }

          collaborators.set(socketId, newCollaborator);
        }
        for (const id of removed) {
          const socketId = id.toString() as SocketId;
          collaborators.delete(socketId);
          // Remove tracking for deleted collaborators
          this.#lastPointerUpdateTime.delete(socketId);
        }
        collaborators.delete(awareness.clientID.toString() as SocketId);
        this.#api.updateScene({ collaborators });
        this.collaborators = collaborators;
      };
      awareness.on("change", _remoteAwarenessChangeHandler);
      this.subscriptions.push(() => {
        this.awareness?.off("change", _remoteAwarenessChangeHandler);
      });

      // Initialize collaborator state
      const collaborators: Collaborators = new Map();
      for (const [id, state] of awareness.getStates().entries()) {
        if (state) {
          const socketId = id.toString() as SocketId;
          const collaborator = toCollaborator(state);
          collaborators.set(socketId, collaborator);

          // During initialization, record last update time only if pointer exists
          if (collaborator.pointer) {
            this.#lastPointerUpdateTime.set(socketId, Date.now());
          }
        }
      }
      this.#api.updateScene({ collaborators });
      this.collaborators = collaborators;

      // Set up timeout monitoring during initialization
      this.startCursorTimeoutChecker();
    }

    // init assets
    const initialAssets = this.#yAssets.yarray.map(({ val }) => val);

    for (const assets of initialAssets) {
      this.addedFileIds.add(assets.id);
    }
    this.#api.addFiles(initialAssets);
  }

  public updateLocalState = throttle((state: { [x: string]: unknown }) => {
    if (this.awareness) {
      this.awareness.setLocalState({
        ...this.awareness.getLocalState(),
        ...state,
      });
    }
  }, 50);

  /**
   * Updates pointer position and button state for collaboration
   * @param payload - Contains pointer coordinates and button state
   */
  public onPointerUpdate = (payload: {
    pointer: {
      x: number;
      y: number;
      tool: "pointer" | "laser";
    };
    button: "down" | "up";
  }) => {
    this.updateLocalState({
      pointer: payload.pointer,
      button: payload.button,
      selectedElementIds: this.#api.getAppState().selectedElementIds,
    });
  };

  /**
   * Start monitoring pointer timeouts
   * Using interval timer to ensure regular checks
   */
  private startCursorTimeoutChecker() {
    if (!this.cursorDisplayTimeout) {
      return;
    }

    // Clear existing timer
    if (this.cursorDisplayTimeoutTimer) {
      clearInterval(this.cursorDisplayTimeoutTimer);
    }

    // Check periodically using interval timer
    this.cursorDisplayTimeoutTimer = setInterval(() => {
      this.checkCursorTimeouts();
    }, 200);
  }

  /**
   * Check and hide timed-out pointers
   */
  private checkCursorTimeouts() {
    const cursorDisplayTimeout = this.cursorDisplayTimeout;
    if (!cursorDisplayTimeout) {
      return;
    }

    const now = Date.now();
    const updatedCollaborators = new Map(this.collaborators);
    let hasChanges = false;

    // Check each collaborator's pointer
    updatedCollaborators.forEach((collaborator, id) => {
      const lastUpdateTime = this.#lastPointerUpdateTime.get(id);

      // If pointer exists and hasn't been updated within timeout period
      if (
        collaborator.pointer &&
        lastUpdateTime &&
        now - lastUpdateTime > cursorDisplayTimeout
      ) {
        hasChanges = true;
        updatedCollaborators.set(id, {
          ...collaborator,
          pointer: undefined,
        });
        // Remove the last update time after timeout
        this.#lastPointerUpdateTime.delete(id);
      }
    });

    if (hasChanges) {
      this.#api.updateScene({ collaborators: updatedCollaborators });
      this.collaborators = updatedCollaborators;
    }
  }

  /**
   * Cleanup method to remove all event listeners
   */
  destroy() {
    for (const s of this.subscriptions) {
      s();
    }

    // Clear timer
    if (this.cursorDisplayTimeoutTimer) {
      clearInterval(this.cursorDisplayTimeoutTimer); // Changed from clearTimeout to clearInterval
    }
  }
}

// biome-ignore lint/suspicious/noExplicitAny: any is used to avoid type errors
function throttle<T extends (...args: any[]) => void>(
  func: T,
  limit: number,
): T {
  let lastFunc: ReturnType<typeof setTimeout> | null = null;
  let lastRan: number | null = null;

  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    if (lastRan === null) {
      func.apply(this, args);
      lastRan = Date.now();
    } else {
      if (lastFunc) {
        clearTimeout(lastFunc);
      }
      lastFunc = setTimeout(() => {
        if (Date.now() - (lastRan as number) >= limit) {
          func.apply(this, args);
          lastRan = Date.now();
        }
      }, limit - (Date.now() - lastRan));
    }
  } as T;
}
