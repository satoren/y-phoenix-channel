import {
  ySyncPlugin,
  yCursorPlugin,
  yUndoPlugin,
  initProseMirrorDoc,
  undo,
  redo,
} from "y-prosemirror";
import { exampleSetup } from "prosemirror-example-setup";
import { PhoenixChannelProvider } from "y-phoenix-channel";
import { Socket } from "phoenix";
import * as Y from "yjs";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "prosemirror-schema-basic";
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { keymap } from "prosemirror-keymap";

import "prosemirror-view/style/prosemirror.css";
import "prosemirror-example-setup/style/style.css";
import "prosemirror-menu/style/menu.css";

const socket = new Socket("/socket");
socket.connect();
const ydoc = new Y.Doc();
const docname = `prosemirror:${
  new URLSearchParams(window.location.search).get("docname") ?? "prosemirror"
}`;

const Editor = ({ ydoc, room }) => {
  const editorContainerRef = useRef(null);

  useEffect(() => {
    if (!editorContainerRef.current) {
      return;
    }

    const initialize = async () => {
      const provider = new PhoenixChannelProvider(
        socket,
        `y_doc_room:${docname}`,
        ydoc,
      );
      if (!provider.synced) {
        await new Promise((resolve) => {
          provider.once("synced", resolve);
        });
      }

      const type = ydoc.get("prosemirror", Y.XmlFragment);
      const { doc, mapping } = initProseMirrorDoc(type, schema);
      const prosemirrorView = new EditorView(editorContainerRef.current, {
        state: EditorState.create({
          doc,
          schema,
          plugins: [
            ySyncPlugin(type, { mapping }),
            yCursorPlugin(provider.awareness),
            yUndoPlugin(),
            keymap({
              "Mod-z": undo,
              "Mod-y": redo,
              "Mod-Shift-z": redo,
            }),
            ...exampleSetup({ schema, history: false }),
          ],
        }),
      });

      return () => {
        provider.destroy();
        prosemirrorView.destroy();
      };
    };

    const cleanup = initialize();

    return () => {
      cleanup.then((c) => {
        c();
      });
    };
  }, []);

  return <div className="editor-container" ref={editorContainerRef}></div>;
};

const App = () => {
  return (
    <div className="col-group">
      <Editor ydoc={ydoc} room={docname} />
    </div>
  );
};
const domNode = document.getElementById("root");
if (!domNode) {
  throw new Error("root element not found");
}

const root = createRoot(domNode);
root.render(<App />);
