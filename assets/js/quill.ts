import Quill from "quill";
import QuillCursors from "quill-cursors";

import * as Y from "yjs";
import { QuillBinding } from "y-quill";
import { IndexeddbPersistence } from "y-indexeddb";

import { Socket } from "phoenix";
import { PhoenixChannelProvider } from "./y-phoenix-channel";
import { generateUsername } from "friendly-username-generator";

Quill.register("modules/cursors", QuillCursors);
const socket = new Socket("/socket");
socket.connect();

const ydoc = new Y.Doc({ gc: true });

const docname = `quill:${new URLSearchParams(window.location.search).get("docname") ?? "quill"}`;

//const channel = socket.channel(`y_doc_room:${docname}`, {})
//channel.join()

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

const toolbarOptions = [
  ["bold", "italic", "underline", "strike"], // toggled buttons
  ["blockquote", "code-block"],
  ["link", "image", "video", "formula"],

  [{ list: "ordered" }, { list: "bullet" }, { list: "check" }],
  [{ script: "sub" }, { script: "super" }], // superscript/subscript
  [{ indent: "-1" }, { indent: "+1" }], // outdent/indent
  [{ direction: "rtl" }], // text direction

  [{ header: [1, 2, 3, 4, 5, 6, false] }],

  [{ color: [] }, { background: [] }], // dropdown with defaults from theme
  [{ font: [] }],
  [{ align: [] }],

  ["clean"], // remove formatting button
];

const quill = new Quill("#editor", {
  modules: {
    cursors: true,
    toolbar: toolbarOptions,
  },
  theme: "snow",
});

const binding = new QuillBinding(
  ydoc.getText("quill"),
  quill,
  provider.awareness,
);
