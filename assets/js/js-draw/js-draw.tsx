import Editor from "js-draw/Editor";
import "js-draw/Editor.css";
import "@melloware/coloris/dist/coloris.css";
import * as Y from "yjs";
import { JsDrawBinding } from "./y-js-draw";
import { PhoenixChannelProvider } from "y-phoenix-channel";
import { IndexeddbPersistence } from "y-indexeddb";
import { Socket } from "phoenix";
import { JsDrawCursor } from "./js-draw-cursor";
import { generateUsername } from "friendly-username-generator";

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

const usercolors = [
  "#30bced",
  "#6eeb83",
  "#ffbc42",
  "#ecd444",
  "#ee6352",
  "#9ac2c9",
  "#8acb88",
  "#1be7ff",
];

const myColor = usercolors[Math.floor(Math.random() * usercolors.length)];
provider.awareness.setLocalStateField("user", {
  name: generateUsername(),
  color: myColor,
});

const domNode = document.getElementById("root");
if (!domNode) {
  throw new Error("Root element not found");
}

const editorRoot = document.createElement("div");
editorRoot.style.width = "100%";
editorRoot.style.height = "100%";
editorRoot.style.position = "absolute";
domNode.appendChild(editorRoot);

const editor = new Editor(editorRoot);

const overlay = document.createElement("div");
overlay.style.width = "100%";
overlay.style.height = "100%";
overlay.style.position = "absolute";
overlay.style.pointerEvents = "none";
domNode.appendChild(overlay);

const cursors = new JsDrawCursor(editor, overlay);
const a = new JsDrawBinding(
  ydoc.getMap("elementMap"),
  editor,
  provider.awareness,
  cursors,
);

editor.addToolbar();
