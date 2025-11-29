// blocknote.tsx を blocknote ディレクトリに移動
import * as React from "react";
import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import * as Y from "yjs";
import "@blocknote/mantine/style.css";

import { createRoot } from "react-dom/client";
import { PhoenixChannelProvider } from "y-phoenix-channel";
import { IndexeddbPersistence } from "y-indexeddb";
import { Socket } from "phoenix";
import { generateUsername } from "friendly-username-generator";

const socket = new Socket("/socket");
socket.connect();
const ydoc = new Y.Doc();
const docname = `blocknote:${new URLSearchParams(window.location.search).get("docname") ?? "blocknote"}`;

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
export default function App() {
  // Creates a new editor instance.
  const editor = useCreateBlockNote({
    collaboration: {
      provider,
      fragment: ydoc.getXmlFragment("document-store"),
      user: {
        name: generateUsername(),
        color: myColor,
      },
    },
    // ...
  });

  // Renders the editor instance using a React component.
  return <BlockNoteView editor={editor} theme="light" />;
}

const domNode = document.getElementById("root");
if (!domNode) {
  throw new Error("root element not found");
}

const root = createRoot(domNode);
root.render(<App />);
