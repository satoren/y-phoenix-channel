import Editor from 'js-draw/Editor';
import 'js-draw/Editor.css';
import '@melloware/coloris/dist/coloris.css';
import * as Y from "yjs";
import { JsDrawBinding } from "./y-js-draw"



import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { PhoenixChannelProvider } from "./y-phoenix-channel";
import { IndexeddbPersistence } from "y-indexeddb";
import { Socket } from "phoenix";

const socket = new Socket("/socket");
socket.connect();
const ydoc = new Y.Doc();
const docname = `js-draw:${new URLSearchParams(window.location.search).get("docname") ?? "js-draw"}`;

const provider = new PhoenixChannelProvider(
  socket,
  `y_doc_room:${docname}`,
  ydoc,
);
const persistence = new IndexeddbPersistence(docname, ydoc);


const domNode = document.getElementById("root");
if (!domNode) {
  throw new Error("Root element not found");
}
const editor = new Editor(domNode);

const a = new JsDrawBinding(ydoc.getMap('elementMap'), editor);

editor.addToolbar();