import { TaskItem } from "@tiptap/extension-list";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";

import { CharacterCount } from "@tiptap/extensions";

import { Highlight } from "@tiptap/extension-highlight";
import { TaskList } from "@tiptap/extension-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import React, { useCallback, useEffect, useState } from "react";
import * as Y from "yjs";
import "./tiptap.scss";
import { createRoot } from "react-dom/client";

import { PhoenixChannelProvider } from "y-phoenix-channel";
import { Socket } from "phoenix";

const colors = [
  "#958DF1",
  "#F98181",
  "#FBBC88",
  "#FAF594",
  "#70CFF8",
  "#94FADB",
  "#B9F18D",
  "#C3E2C2",
  "#EAECCC",
  "#AFC8AD",
  "#EEC759",
  "#9BB8CD",
  "#FF90BC",
  "#FFC0D9",
  "#DC8686",
  "#7ED7C1",
  "#F3EEEA",
  "#89B9AD",
  "#D0BFFF",
  "#FFF8C9",
  "#CBFFA9",
  "#9BABB8",
  "#E3F4F4",
];
const names = [
  "Lea Thompson",
  "Cyndi Lauper",
  "Tom Cruise",
  "Madonna",
  "Jerry Hall",
  "Joan Collins",
  "Winona Ryder",
  "Christina Applegate",
  "Alyssa Milano",
  "Molly Ringwald",
  "Ally Sheedy",
  "Debbie Harry",
  "Olivia Newton-John",
  "Elton John",
  "Michael J. Fox",
  "Axl Rose",
  "Emilio Estevez",
  "Ralph Macchio",
  "Rob Lowe",
  "Jennifer Grey",
  "Mickey Rourke",
  "John Cusack",
  "Matthew Broderick",
  "Justine Bateman",
  "Lisa Bonet",
];

const defaultContent = `
  <p>Hi 👋, this is a collaborative document.</p>
  <p>Feel free to edit and collaborate in real-time!</p>
`;

const getRandomElement = <T,>(list: T[]) =>
  list[Math.floor(Math.random() * list.length)];

const getRandomColor = () => getRandomElement(colors);
const getRandomName = () => getRandomElement(names);

const getInitialUser = () => {
  return {
    name: getRandomName(),
    color: getRandomColor(),
  };
};

const Editor = ({
  ydoc,
  provider,
  room,
}: {
  ydoc: Y.Doc;
  provider: PhoenixChannelProvider;
  room: string;
}) => {
  const [status, setStatus] = useState("connecting");
  const [currentUser, setCurrentUser] = useState(getInitialUser);

  const editor = useEditor({
    enableContentCheck: true,
    onContentError: ({ disableCollaboration }) => {
      disableCollaboration();
    },
    extensions: [
      StarterKit.configure({
        undoRedo: false,
      }),
      Highlight,
      TaskList,
      TaskItem,
      CharacterCount.extend().configure({
        limit: 10000,
      }),
      Collaboration.extend().configure({
        document: ydoc,
      }),
      CollaborationCaret.configure({
        provider,
        user: currentUser,
      }),
    ],
  });

  useEffect(() => {
    // Update status changes
    const statusHandler = (event: {
      status: "connecting" | "connected" | "disconnected";
    }) => {
      setStatus(event.status);
    };

    provider.on("status", statusHandler);

    return () => {
      provider.off("status", statusHandler);
    };
  }, [provider]);

  useEffect(() => {
    provider.on("sync", () => {
      // The onSynced callback ensures initial content is set only once using editor.setContent(), preventing repetitive content loading on editor syncs.

      if (!ydoc.getMap("config").get("initialContentLoaded") && editor) {
        ydoc.getMap("config").set("initialContentLoaded", true);

        editor.commands.setContent(`
          <p>This is a radically reduced version of Tiptap. It has support for a document, with paragraphs and text. That’s it. It’s probably too much for real minimalists though.</p>
          <p>The paragraph extension is not really required, but you need at least one node. Sure, that node can be something different.</p>
          `);
      }
    });
  }, [provider, editor]);

  const setName = useCallback(() => {
    const name = (window.prompt("Name", currentUser.name) || "")
      .trim()
      .substring(0, 32);

    if (name) {
      return setCurrentUser({ ...currentUser, name });
    }
  }, [currentUser]);

  if (!editor) {
    return null;
  }

  return (
    <div className="column-half">
      <div className="control-group">
        <div className="button-group">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive("bold") ? "is-active" : ""}
          >
            Bold
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive("italic") ? "is-active" : ""}
          >
            Italic
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={editor.isActive("strike") ? "is-active" : ""}
          >
            Strike
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={editor.isActive("bulletList") ? "is-active" : ""}
          >
            Bullet list
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={editor.isActive("code") ? "is-active" : ""}
          >
            Code
          </button>
        </div>
      </div>

      <EditorContent editor={editor} className="main-group" />

      <div
        className="collab-status-group"
        data-state={status === "connected" ? "online" : "offline"}
      >
        {" "}
        <label>
          {status === "connected"
            ? `${editor.storage.collaborationCaret.users.length} user${
                editor.storage.collaborationCaret.users.length === 1 ? "" : "s"
              } online in ${room}`
            : "offline"}
        </label>
        <button style={{ "--color": currentUser.color }} onClick={setName}>
          ✎ {currentUser.name}
        </button>
      </div>
    </div>
  );
};

const socket = new Socket("/socket");
socket.connect();
const ydoc = new Y.Doc();
const docname = `tiptap:${
  new URLSearchParams(window.location.search).get("docname") ?? "tiptap"
}`;

const provider = new PhoenixChannelProvider(
  socket,
  `y_doc_room:${docname}`,
  ydoc,
);

const App = () => {
  return (
    <div className="col-group">
      <Editor provider={provider} ydoc={ydoc} room={docname} />
    </div>
  );
};
const domNode = document.getElementById("root");
if (!domNode) {
  throw new Error("root element not found");
}

const root = createRoot(domNode);
root.render(<App />);
