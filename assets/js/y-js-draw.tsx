import { AbstractComponent, type Editor, EditorEventType, Erase, uniteCommands } from 'js-draw';
import equal from "fast-deep-equal";
import type * as Y from "yjs"
import type * as awarenessProtocol from "y-protocols/awareness";

type JsDrawSerializedElement = {
  data: string
  | number
  | unknown[]
  | Record<string, unknown>;
  id: string;
  loadSaveData: unknown;
  name: string;
  zIndex: number;
}
export class JsDrawBinding {
  yElements: Y.Map<JsDrawSerializedElement>
  editor: Editor;
  awareness?: awarenessProtocol.Awareness;
  undoManager?: Y.UndoManager;

  subscriptions: (() => void)[] = [];

  constructor(ymap: Y.Map<JsDrawSerializedElement>, editor: Editor, awareness?: awarenessProtocol.Awareness) {
    this.editor = editor;
    this.yElements = ymap;

    this.subscriptions.push(editor.notifier.on(
      EditorEventType.CommandDone, (e) => {
        setTimeout(() => {
          try {
            this.syncToYjs();
          } catch (e) {
            console.error(e);
            this.yElements.clear();
          }
        }, 0);

      }).remove);
    this.subscriptions.push(editor.notifier.on(
      EditorEventType.CommandUndone, (e) => {
        setTimeout(() => {
          try {
            this.syncToYjs();
          } catch (e) {
            console.error(e);
            this.yElements.clear();
          }
        }, 0);

      }).remove);
      ymap.observe((events, txn) => {
        if (txn.origin === this) {
          return;
        }
        const commands = [...events.changes.keys.entries()].flatMap(([key, event]) => {
          if (event.action === 'add' ) {
            const data = ymap.get(key);
            const element = this.editor.image.lookupElement(key);
            if(!equal(data, element?.serialize())){
              const newElement = AbstractComponent.deserialize(data);
              return [this.editor.image.addElement(newElement)]
            }
          } 
          if (event.action === 'update') {
            const data = ymap.get(key);
            const element = this.editor.image.lookupElement(key);
            if(!equal(data, element?.serialize())){
              const newElement = AbstractComponent.deserialize(data);
              if (element) {
                return [new Erase([element]),this.editor.image.addElement(newElement),];
              }
              return [this.editor.image.addElement(newElement)];
            }
          } 
           if (event.action === 'delete') {
            const element = this.editor.image.lookupElement(key);
            if (element) {
              return [new Erase([element])];
            }
          }
          return []
        }).filter((command) => command != null) ;
        editor.dispatch(uniteCommands(commands));
      });
  }

  syncToYjs() {
    const editor = this.editor;
    const yElements = this.yElements;
    const serializeElements = editor.image.getAllElements().map((element) => element.serialize());
    const elementsIds = serializeElements.map((element) => element.id);
    const added = serializeElements.filter((element) => !yElements.has(element.id));
    const deleted = [...yElements.keys()].filter((id) => !elementsIds.includes(id));
    const changed = serializeElements.filter((element) => {
      const data = yElements.get(element.id);

      return !equal(data,element)
    });


    if (added.length === 0 && deleted.length === 0 && changed.length === 0) {
      return
    }

    yElements.doc?.transact(() => {
      for (const element of added) {
        const data = element;
        yElements.set(data.id, data);
      }
      for (const id of deleted) {
        yElements.delete(id);
      }
      for (const element of changed) {
        yElements.set(element.id, element);
      }
    }, this);
  }
}