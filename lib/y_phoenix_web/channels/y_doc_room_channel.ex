defmodule YPhoenixWeb.YDocRoomChannel do
  use YPhoenixWeb, :channel

  require Logger

  alias Yex.Sync.SharedDoc
  @impl true
  def join("y_doc_room:" <> doc_name, payload, socket) do
    if authorized?(payload) do
      case start_shared_doc(doc_name) do
        {:ok, docpid} ->
          Process.monitor(docpid)
          SharedDoc.observe(docpid)
          {:ok, socket |> assign(doc_name: doc_name, doc_pid: docpid)}

        {:error, reason} ->
          {:error, %{reason: reason}}
      end
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

  @impl true
  def handle_info(
        {:DOWN, _ref, :process, _pid, _reason},
        socket
      ) do
    {:stop, {:error, "remote process crash"}, socket}
  end

  defp start_shared_doc(doc_name) do
    case :global.whereis_name({__MODULE__, doc_name}) do
      :undefined -> SharedDoc.start([doc_name: doc_name, persistence: YPhoenix.EctoPersistence], name: {:global, {__MODULE__, doc_name}})
      pid -> {:ok, pid}
    end
    |> case do
      {:ok, pid} ->
        {:ok, pid}

      {:error, {:already_started, pid}} ->
        {:ok, pid}

      {:error, reason} ->
        Logger.error("""
        Failed to start shareddoc.
        Room: #{inspect(doc_name)}
        Reason: #{inspect(reason)}
        """)

        {:error, %{reason: "failed to start shareddoc"}}
    end
  end

  # Add authorization logic here as required.
  defp authorized?(_payload) do
    true
  end
end
