import * as React from "react";

// can not use development version for excalidraw on esbuild
import { Excalidraw } from "@excalidraw/excalidraw/dist/excalidraw.production.min";
import * as Y from "yjs";

import { createRoot } from "react-dom/client";
import { PhoenixChannelProvider } from "./y-phoenix-channel";
import { IndexeddbPersistence } from "y-indexeddb";
import { Socket } from "phoenix";
import { generateUsername } from "friendly-username-generator";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import { ExcalidrawBinding } from "y-excalidraw";

const socket = new Socket("/socket");
socket.connect();
const ydoc = new Y.Doc();
const docname = `excalidraw:${new URLSearchParams(window.location.search).get("docname") ?? "exalidraw"}`;

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

export default function App() {
  const [api, setApi] = React.useState<ExcalidrawImperativeAPI | null>(null);
  const [binding, setBindings] = React.useState<ExcalidrawBinding | null>(null);

  const conrainerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!api) return;

    const yElements = ydoc.getArray<Y.Map<unknown>>("elements");
    const yAssets = ydoc.getMap("assets");
    const binding = new ExcalidrawBinding(
      yElements,
      yAssets,
      api,
      provider.awareness,
      // excalidraw dom is needed to override the undo/redo buttons in the UI as there is no way to override it via props in excalidraw
      // You might need to pass {trackedOrigins: new Set()} to undomanager depending on whether your provider sets an origin or not
      conrainerRef.current
        ? {
            excalidrawDom: conrainerRef.current,
            undoManager: new Y.UndoManager(yElements),
          }
        : undefined,
    );
    setBindings(binding);
    return () => {
      setBindings(null);
      binding.destroy();
    };
  }, [api]);

  return (
    <div style={{ height: "100vh" }} ref={conrainerRef}>
      <Excalidraw
        excalidrawAPI={setApi}
        onPointerUpdate={binding?.onPointerUpdate}
        theme="light"
      />
    </div>
  );
}

const domNode = document.getElementById("root");
if (!domNode) {
  throw new Error("root element not found");
}

const root = createRoot(domNode);
root.render(<App />);
