defmodule YPhoenixWeb.YDocRoomChannel do
  use YPhoenixWeb, :channel

  require Logger

  alias YPhoenixWeb.DocServer
  @impl true
  def join("y_doc_room:" <> doc_name = topic, payload, socket) do
    if authorized?(payload) do
      uid = "#{node()}_#{System.unique_integer()}"

      YPhoenixWeb.Presence.track_user(topic, uid, %{})

      case start_shared_doc(topic, doc_name) do
        {:ok, docpid} ->
          Process.monitor(docpid)
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
    server = socket.assigns.doc_pid

    DocServer.process_message_v1(server, chunk, self())
    |> handle_process_message_result(server)

    {:noreply, socket}
  end

  def handle_in("yjs", {:binary, chunk}, socket) do
    server = socket.assigns.doc_pid

    DocServer.process_message_v1(server, chunk, self())
    |> handle_process_message_result(server)

    {:noreply, socket}
  end

  defp handle_process_message_result(result, server) do
    case result do
      {:ok, replies} ->
        Enum.each(replies, fn reply ->
          send(self(), {:yjs, reply, server})
        end)

        :ok

      error ->
        error
    end
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

  defp start_shared_doc(topic, doc_name) do
    case :syn.lookup(:doc_servers, doc_name) do
      {pid, _metadata} ->
        {:ok, pid}

      :undefined ->
        DocServer.start([topic: topic, doc_name: doc_name, persistence: YPhoenix.EctoPersistence],
          name: {:via, :syn, {:doc_servers, doc_name}}
        )
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
