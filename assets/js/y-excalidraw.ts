import type {
  BinaryFileData,
  Collaborator,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types/types";
import * as Y from "yjs";
import type * as awarenessProtocol from "y-protocols/awareness";
import deepEqual from "fast-deep-equal";
import { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";

export class ExcalidrawBinding {
  subscriptions: (() => void)[] = [];
  collaborators: Map<string, Collaborator> = new Map();
  lastVersion: number | undefined = undefined;
  constructor(
    yarray: Y.Array<unknown>,
    api: ExcalidrawImperativeAPI,
    private awareness?: awarenessProtocol.Awareness,
  ) {
    this.subscriptions.push(
      api.onChange((elements) => {
        const version = getVersion(elements);
        if (this.lastVersion === version) {
          return;
        }
        this.lastVersion = version;

        const doc = yarray.doc;

        doc?.transact(() => {
          if (yarray.length < elements.length) {
            const add = Array.from(
              { length: elements.length - yarray.length },
              () => new Y.Map(),
            );
            yarray.push(add);
          } else if (yarray.length > elements.length) {
            yarray.delete(elements.length, yarray.length - elements.length);
          }

          for (let i = 0; i < elements.length; i++) {
            const map = yarray.get(i) as Y.Map<unknown>;
            const elem = elements[i];
            if (map.get("version") === elem.version) {
              continue;
            }

            for (const [key, value] of Object.entries(elem)) {
              const src = map.get(key);
              if (
                (typeof src === "object" && !deepEqual(map.get(key), value)) ||
                src !== value
              ) {
                map.set(key, value);
              }
            }
          }
        }, this);
      }),
    );

    yarray.observeDeep((_events, txn) => {
      if (txn.origin === this) {
        return;
      }

      const elements = [...api.getSceneElements()];

      for (const map of yarray) {
        if(!(map instanceof Y.Map)) {
          continue;
        }
        const id = map.get("id");
        const index = elements.findIndex((elem) => elem.id === id);
        if (index >= 0) {
          const version = map.get("version");
          if(version === elements[index].version) {
            elements[index] = map.toJSON() as NonDeletedExcalidrawElement;
          } else {
            elements.push(map.toJSON() as NonDeletedExcalidrawElement);
          }
        }
      }
    });

    api.updateScene({ elements: yarray.toJSON() });

    if (awareness) {
      this.subscriptions.push(
        api.onChange((_, state) => {
          awareness.setLocalStateField(
            "selectedElementIds",
            state.selectedElementIds,
          );
        }),
      );

      const awarenessChangeHandler = ({
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

          collaborators.set(id.toString(), {
            pointer: state.pointer,
            button: state.button,
            selectedElementIds: state.selectedElementIds,
            username: state.user?.name,
            color: state.user?.color,
            avatarUrl: state.user?.avatarUrl,
            userState: state.user?.state,
          });
        }
        for (const id of removed) {
          collaborators.delete(id.toString());
        }
        collaborators.delete(awareness.clientID.toString());
        api.updateScene({
          collaborators,
        });
        this.collaborators = collaborators;
      };
      awareness.on("change", awarenessChangeHandler);
      this.subscriptions.push(() => {
        awareness.off("change", awarenessChangeHandler);
      });
    }
  }

  onPointerUpdate = (payload: {
    pointer: {
      x: number;
      y: number;
      tool: "pointer" | "laser";
    };
    button: "down" | "up";
  }) => {
    this.awareness?.setLocalStateField("pointer", payload.pointer);
    this.awareness?.setLocalStateField("button", payload.button);
  };

  destroy() {
    for (const s of this.subscriptions) {
      s();
    }
  }
}

function getVersion(elems: readonly { version: number }[]): number {
  return elems.reduce((acc, curr) => {
    return curr.version + acc;
  }, 0);
}

export class ExcalidrawAssetsBinding {
  subscriptions: (() => void)[] = [];

  constructor(ymap: Y.Map<unknown>, api: ExcalidrawImperativeAPI) {
    this.subscriptions.push(
      api.onChange((_element, _appstate, files) => {
        const doc = ymap.doc;
        doc?.transact(() => {
          for (const key in files) {
            if (!ymap.get(key)) {
              ymap.set(key, files[key]);
            }
          }
        }, this);
      }),
    );

    const handler = (events: Y.YMapEvent<unknown>, txn: Y.Transaction) => {
      if (txn.origin === this) {
        return;
      }

      const addedFiles = [...events.keysChanged].map(
        (key) => ymap.get(key) as BinaryFileData,
      );
      api.addFiles(addedFiles);
    };
    ymap.observe(handler);
    this.subscriptions.push(() => {
      ymap.unobserve(handler);
    });

    api.addFiles([...ymap.keys()].map((key) => ymap.get(key) as BinaryFileData));
  }
  destroy() {
    for (const s of this.subscriptions) {
      s();
    }
  }
}
