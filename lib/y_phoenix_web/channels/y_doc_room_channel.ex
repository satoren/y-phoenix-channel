defmodule YPhoenixWeb.YDocRoomChannel do
  use YPhoenixWeb, :channel

  alias YPhoenix.{SharedDocSupervisor, SharedDoc}
  @impl true
  def join("y_doc_room:" <> doc_name, payload, socket) do
    if authorized?(payload) do
      SharedDocSupervisor.monitor_shared_doc_update(doc_name)
      {:ok, docpid} = SharedDocSupervisor.start_child(doc_name)

      {:ok, socket |> assign(doc_name: doc_name, doc_pid: docpid)}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  @impl true
  def handle_in("yjs_sync", {:binary, chunk}, socket) do
    SharedDoc.start_sync(socket.assigns.doc_pid, chunk)
    {:noreply, socket}
  end

  def handle_in("yjs", {:binary, chunk}, socket) do
    SharedDoc.send_yjs_message(socket.assigns.doc_pid, chunk)
    {:noreply, socket}
  end

  @impl true
  def handle_info({:yjs, message, _proc}, socket) do
    push(socket, "yjs", {:binary, message})
    {:noreply, socket}
  end

  # Add authorization logic here as required.
  defp authorized?(_payload) do
    true
  end
end
