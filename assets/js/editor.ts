import Quill from "quill";
import QuillCursors from 'quill-cursors'

import * as Y from 'yjs'
import { QuillBinding } from 'y-quill'
import { IndexeddbPersistence } from 'y-indexeddb'

import {Socket} from "phoenix"
import { PhoenixChannelProvider } from "./y-phoenix-channel"

Quill.register('modules/cursors', QuillCursors)
const socket = new Socket("/socket")
socket.connect()


const ydoc = new Y.Doc()

const docname = new URLSearchParams(window.location.search).get('docname') ?? "quill"

//const channel = socket.channel(`y_doc_room:${docname}`, {})
//channel.join()

const provider = new PhoenixChannelProvider(socket, `y_doc_room:${docname}`, ydoc )
const persistence = new IndexeddbPersistence(docname, ydoc)

const usercolors = [
  '#30bced',
  '#6eeb83',
  '#ffbc42',
  '#ecd444',
  '#ee6352',
  '#9ac2c9',
  '#8acb88',
  '#1be7ff'
]
const myColor = usercolors[Math.floor(Math.random() * usercolors.length)]
provider.awareness.setLocalStateField('user', {
  name: "user1",
  color: myColor
})

const quill = new Quill('#editor', {
  modules: {
    cursors: true,
  },
  theme: 'snow'
});


const binding = new QuillBinding(ydoc.getText('quill'), quill, provider.awareness)
