import type {
  BinaryFileData,
  Collaborator,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types/types";
import * as Y from "yjs";
import type * as awarenessProtocol from "y-protocols/awareness";
import deepEqual from "fast-deep-equal";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/types/element/types";

type ElementWithIndex = NonDeletedExcalidrawElement & {
  index: number;
};

 const syncElementsToYArray = (
  elements: readonly ExcalidrawElement[],
  yarray: Y.Array<Y.Map<unknown>>,
) => {
  const prevVersions = yarray
    .map((v) => {
      if (v instanceof Y.Map) {
        const id = v.get("id") as string;
        return {
          id,
          version: v.get("version"),
          versionNonce: v.get("versionNonce"),
          pos: v.get("index"),
        };
      }
      return null;
    })
    .filter(
      (
        v,
      ): v is {
        id: string;
        version: number;
        versionNonce: number;
        pos: number;
      } => v != null,
    );

  const prevVersionsMap = Object.fromEntries(
    prevVersions.map((elem) => [elem.id, elem]),
  );
  const elementMap = Object.fromEntries(
    elements.map((elem) => [elem.id, elem]),
  );
  const prevPositionMap = Object.fromEntries(
    prevVersions.map((elem) => [elem.id, elem.pos]),
  );

  const positionMap = Object.fromEntries(
    elements.map((elem, index) => [elem.id, index]),
  );

  const deleted = prevVersions
    .filter((el) => {
      const elem = elementMap[el.id];
      return elem == null || elem.isDeleted;
    })
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
        prev.versionNonce !== el.versionNonce ||
        prevPositionMap[el.id] !== positionMap[el.id]
      );
    })
    .map((el) => el.id);

  if (deleted.length === 0 && added.length === 0 && changed.length === 0) {
    return;
  }

  // https://discuss.yjs.dev/t/moving-elements-in-lists/92/5
  const doc = yarray.doc;
  doc?.transact(() => {
    // delete from right to left so that deletions don't affect the current position
    for (let i = yarray.length - 1; i >= 0; i--) {
      const item = yarray.get(i);
      if (item instanceof Y.Map) {
        const id = item.get("id") as string;
        if (deleted.includes(id)) {
          yarray.delete(i);
          continue;
        }
        if (changed.includes(id)) {
          const elem = elementMap[id];
          for (const [key, value] of Object.entries(elem)) {
            const src = item.get(key);
            if (
              (typeof src === "object" && !deepEqual(item.get(key), value)) ||
              src !== value
            ) {
              item.set(key, value);
            }
          }
          if (item.get("index") !== positionMap[id]) {
            item.set("index", positionMap[id]);
          }
        }
      }
    }

    for (const id of added) {
      const item = new Y.Map();
      yarray.push([item]);
      const elem = elementMap[id];

      for (const [key, value] of Object.entries(elem)) {
        item.set(key, value);
      }
      item.set("index", positionMap[id]);
    }
  }, this);
};

export class ExcalidrawBinding {
  subscriptions: (() => void)[] = [];
  collaborators: Map<string, Collaborator> = new Map();
  constructor(
    yarray: Y.Array<Y.Map<unknown>>,
    api: ExcalidrawImperativeAPI,
    private awareness?: awarenessProtocol.Awareness,
  ) {
    this.subscriptions.push(
      api.onChange((elements) => {
        syncElementsToYArray(elements, yarray);
      }),
    );

    yarray.observe((e, txn) => {
      if (txn.origin === this) {
        return;
      }
      // temporary Set of all ids used in yarray
      const uniqueIds = new Set();
      const array = yarray.toArray();
      // bundle all changes in a transaction, so that only one event is fired
      yarray.doc?.transact(() => {
        // delete from right to left so that deletions don't affect the current position
        for (let i = array.length - 1; i >= 0; i--) {
          const item = array[i];
          if (item instanceof Y.Map) {
            const id = item.get("id");
            if (uniqueIds.has(id)) {
              // We already found this item, delete it
              yarray.delete(i, 1);
            } else {
              // This is the first time we found this item (the id is unique)
              uniqueIds.add(id);
            }
          }
        }
      });
    });
    yarray.observeDeep((events, txn) => {
      if (txn.origin === this) {
        return;
      }
      let elements = [...api.getSceneElements()];
      let changed = false;

      const positionMap = {};

      for (const map of yarray) {
        if (map instanceof Y.Map) {
          const value = map.toJSON() as ElementWithIndex;
          positionMap[value.id] = value.index;
          const id = value.id;
          const version = value.version;
          const index = elements.findIndex((e) => e.id === id);
          if (index >= 0) {
            if (elements[index].version < version) {
              elements[index] = dropIndex(value);
              changed = true;
            }
          } else {
            elements.push(dropIndex(value));
            changed = true;
          }
          if (index !== value.index) {
            changed = true;
          }
        }
      }
      if (Object.keys(positionMap).length !== elements.length) {
        changed = true;
      }
      if (changed) {
        const newElements = elements.filter((e) => (e.id in positionMap)).sort((a, b) => positionMap[a.id] - positionMap[b.id]);
        api.updateScene({ elements: newElements });
      }
    });

    // set initial
    const initialValue = yarray.toJSON() as ElementWithIndex[];

    api.updateScene({
      elements: initialValue.sort((a, b) => a.index - b.index).map(dropIndex),
    });
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

const dropIndex = ({
  index,
  ...rest
}: ElementWithIndex): NonDeletedExcalidrawElement => rest;

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
