import * as React from "react";

import { Excalidraw  } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import * as Y from "yjs";
import { createRoot } from "react-dom/client";
import { PhoenixChannelProvider } from "../y-phoenix-channel";
import { IndexeddbPersistence } from "y-indexeddb";
import { Socket } from "phoenix";
import { generateUsername } from "friendly-username-generator";
import { ExcalidrawBinding } from "./y-excalidraw";

type ExcalidrawProps = Parameters<typeof Excalidraw>[0];
type ExcalidrawImperativeAPI = Parameters<
  NonNullable<ExcalidrawProps["excalidrawAPI"]>
>[0];
const socket = new Socket("/socket");
socket.connect();
const ydoc = new Y.Doc();
const docname = `excalidraw:${new URLSearchParams(window.location.search).get("docname") ?? "excalidraw"}`;

const provider = new PhoenixChannelProvider(
  socket,
  `y_doc_room:${docname}`,
  ydoc,
);
const persistence = new IndexeddbPersistence(docname, ydoc);

provider.awareness.setLocalStateField("user", {
  name: generateUsername(),
});

export default function App() {
  const [api, setApi] = React.useState<ExcalidrawImperativeAPI | null>(null);
  const [binding, setBindings] = React.useState<ExcalidrawBinding | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!api) return;

    const binding = new ExcalidrawBinding(
      ydoc.getArray("elements"),
      ydoc.getArray("assets"),
      api,
      provider.awareness,
      {
        cursorDisplayTimeout: 5000,
      }
    );
    setBindings(binding);
    return () => {
      setBindings(null);
      binding.destroy();
    };
  }, [api]);

  return (
    <div style={{ height: "100vh" }} ref={containerRef}>
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
