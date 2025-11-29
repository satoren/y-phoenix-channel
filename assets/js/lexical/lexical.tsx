import React from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { CollaborationPlugin } from "@lexical/react/LexicalCollaborationPlugin";
import * as Y from "yjs";
import { Socket } from "phoenix";
import { useCallback } from "react";
import { PhoenixChannelProvider } from "../y-phoenix-channel";
import { createRoot } from "react-dom/client";
import type { Provider } from "@lexical/yjs";

const socket = new Socket("/socket");
socket.connect();
const docname = `lexical:${new URLSearchParams(window.location.search).get("docname") ?? "lexical"}`;

function getDocFromMap(id: string, yjsDocMap: Map<string, Y.Doc>): Y.Doc {
	let doc = yjsDocMap.get(id);

	if (doc === undefined) {
		doc = new Y.Doc();
		yjsDocMap.set(id, doc);
	} else {
		doc.load();
	}

	return doc;
}

function Editor() {
	const initialConfig = {
		editorState: null,
		namespace: "Demo",
		nodes: [],
		onError: (error: Error) => {
			throw error;
		},
		theme: {},
	};

	const providerFactory = useCallback(
		(id: string, yjsDocMap: Map<string, Y.Doc>): Provider => {
			const doc = getDocFromMap(id, yjsDocMap);
			return new PhoenixChannelProvider(socket, `y_doc_room:${docname}`, doc, {
				connect: false,
			});
		},
		[docname],
	);

	return (
		<LexicalComposer initialConfig={initialConfig}>
			<RichTextPlugin
				contentEditable={<ContentEditable className="editor-input" />}
				placeholder={
					<div className="editor-placeholder">Enter some rich text...</div>
				}
				ErrorBoundary={LexicalErrorBoundary}
			/>
			<HistoryPlugin />
			<CollaborationPlugin
				id="lexical/react-rich-collab"
				providerFactory={providerFactory}
				shouldBootstrap={true}
			/>
		</LexicalComposer>
	);
}

export default function App() {
	return <Editor />;
}

const domNode = document.getElementById("root");
if (!domNode) {
	throw new Error("root element not found");
}

const root = createRoot(domNode);
root.render(<App />);
