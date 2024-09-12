import type {
  BinaryFileData,
  Collaborator,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types/types";
import * as Y from "yjs";
import type * as awarenessProtocol from "y-protocols/awareness";
import deepEqual from "fast-deep-equal";
import type { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";

export class ExcalidrawBinding {
  subscriptions: (() => void)[] = [];
  collaborators: Map<string, Collaborator> = new Map();
  constructor(
    ymap: Y.Map<unknown>,
    api: ExcalidrawImperativeAPI,
    private awareness?: awarenessProtocol.Awareness,
  ) {
    this.subscriptions.push(
      api.onChange((elements) => {
        const prevVersions = [...ymap.entries()]
          .map(([id, v]) => {
            if (v instanceof Y.Map) {
              return {
                id,
                version: v.get("version"),
                versionNonce: v.get("versionNonce"),
              };
            }
            return null;
          })
          .filter(
            (v): v is { id: string; version: number; versionNonce: number } =>
              v != null,
          );

        const prevVersionsMap = Object.fromEntries(
          prevVersions.map((elem) => [elem.id, elem]),
        );
        const elementMap = Object.fromEntries(
          elements.map((elem) => [elem.id, elem]),
        );

        const deleted = prevVersions
          .filter((el) => elementMap[el.id] == null)
          .map((el) => el.id);
        const added = elements
          .filter((el) => prevVersionsMap[el.id] == null)
          .map((el) => el.id);
        const changed = elements
          .filter((el) => {
            const prev = prevVersionsMap[el.id];
            if (!prev) {
              return false;
            }
            return (
              prev.version !== el.version ||
              prev.versionNonce !== el.versionNonce
            );
          })
          .map((el) => el.id);

        if (
          deleted.length === 0 &&
          added.length === 0 &&
          changed.length === 0
        ) {
          return;
        }
        const doc = ymap.doc;
        doc?.transact(() => {
          deleted.forEach((id) => {
            ymap.delete(id);
          });
          added.forEach((id) => {
            const map = ymap.set(id, new Y.Map());
            const elem = elementMap[id];

            for (const [key, value] of Object.entries(elem)) {
              map.set(key, value);
            }
          });
          changed.forEach((id) => {
            const map = ymap.get(id) as Y.Map<unknown> | undefined;
            const elem = elementMap[id];
            if (map) {
              for (const [key, value] of Object.entries(elem)) {
                const src = map.get(key);
                if (
                  (typeof src === "object" &&
                    !deepEqual(map.get(key), value)) ||
                  src !== value
                ) {
                  map.set(key, value);
                }
              }
            } else {
              const map = new Y.Map();
              ymap.set(id, map);
              const elem = elementMap[id];

              for (const [key, value] of Object.entries(elem)) {
                map.set(key, value);
              }
            }
          });
        }, this);
      }),
    );

    ymap.observeDeep((events, txn) => {
      if (txn.origin === this) {
        return;
      }
      const elements = [...api.getSceneElements()];
      let changed = false;
      ymap.forEach((map) => {
        if (map instanceof Y.Map) {
          const value = map.toJSON() as NonDeletedExcalidrawElement;
          const id = value.id;
          const version = value.version;
          const index = elements.findIndex((e) => e.id === id);
          if (index >= 0) {
            if (elements[index].version < version) {
              elements[index] = map.toJSON() as NonDeletedExcalidrawElement;
              changed = true;
            }
          } else {
            elements.push(map.toJSON() as NonDeletedExcalidrawElement);
            changed = true;
          }
        }
      });
      if (changed) {
        api.updateScene({ elements });
      }
    });

    // set initial
    api.updateScene({ elements: Object.values(ymap.toJSON()) });

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

    // set initial
    api.addFiles(
      [...ymap.keys()].map((key) => ymap.get(key) as BinaryFileData),
    );
  }
  destroy() {
    for (const s of this.subscriptions) {
      s();
    }
  }
}
