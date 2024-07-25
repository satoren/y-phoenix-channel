defmodule YPhoenix.SharedDoc do
  @moduledoc """
  """
  use GenServer

  require Logger
  alias Yex.Sync

  @idle_timeout 15000
  defmodule Persistence do
    @moduledoc """
    Persistence behavior for SharedDoc
    """

    @callback bind(doc_name :: String.t(), doc :: Yex.Doc.t()) :: term()
    @callback unbind(term :: term(), doc_name :: String.t(), doc :: Yex.Doc.t()) :: :ok
    @callback update_v1(
                term :: term(),
                update :: binary(),
                doc_name :: String.t(),
                doc :: Yex.Doc.t()
              ) :: term()

    @optional_callbacks update_v1: 4, unbind: 3
  end

  defmodule LocalPubSub do
    @moduledoc """
    LocalPubSub behavior for SharedDoc
    Used to notify SharedDoc users of updates.
    """

    @callback monitor_count(doc_name :: String.t()) :: integer()
    @callback broadcast(doc_name :: String.t(), message :: term(), exclude_origin :: term()) ::
                :ok

    @callback monitor(doc_name :: String.t()) :: :ok
    @callback demonitor(doc_name :: String.t()) :: :ok
  end

  def send_yjs_message(server, message) when is_binary(message) do
    send(GenServer.whereis(server), {:yjs, message, self()})
  end

  def start_sync(server, step1_message) do
    send(GenServer.whereis(server), {:start_sync, step1_message, self()})
  end

  def doc_name(server) do
    GenServer.call(server, :doc_name)
  end

  def start_link(param, option \\ []) do
    GenServer.start_link(__MODULE__, param, option)
  end

  def start(param, option \\ []) do
    GenServer.start(__MODULE__, param, option)
  end

  @impl true
  def init(option) do
    doc_name = Keyword.fetch!(option, :doc_name)
    persistence = Keyword.get(option, :persistence)
    timeout = Keyword.get(option, :idle_timeout, @idle_timeout)
    pg_scope = Keyword.get(option, :pg_scope, nil)
    local_pubsub = Keyword.get(option, :local_pubsub, nil)
    doc = Yex.Doc.new()
    {:ok, awareness} = Yex.Awareness.new(doc)

    Yex.Awareness.clean_local_state(awareness)

    persistence_state =
      if function_exported?(persistence, :bind, 2) do
        persistence.bind(doc_name, doc)
      end

    {:ok, step1_data} = Sync.get_sync_step1(doc)
    message = Yex.Sync.message_encode!({:sync, step1_data})
    step1 = {:yjs, message, self()}

    if local_pubsub != nil do
      local_pubsub.broadcast(
        doc_name,
        step1,
        ""
      )
    end

    if pg_scope != nil do
      :pg.join(pg_scope, doc_name, self())
      {_group_monitor_ref, pids} = :pg.monitor(pg_scope, doc_name)

      pids
      |> Enum.reject(&(&1 == self()))
      |> Enum.each(fn pid ->
        send(pid, step1)
      end)
    end

    Yex.Doc.monitor_update_v1(doc)
    Yex.Awareness.monitor_change(awareness)

    {:ok,
     %{
       doc: doc,
       awareness: awareness,
       doc_name: doc_name,
       persistence: persistence,
       persistence_state: persistence_state,
       timeout: timeout,
       pg_scope: pg_scope,
       local_pubsub: local_pubsub
     }, timeout}
  end

  @impl true
  def handle_call(:doc_name, _from, state) do
    {:reply, state.doc_name, state}
  end

  @impl true
  def handle_info({:start_sync, message, from}, state) when is_binary(message) do
    with {:ok, {:sync, sync_message}} <- Yex.Sync.message_decode(message),
         {:ok, reply} <- Sync.read_sync_message(sync_message, state.doc, "#{inspect(from)}"),
         {:ok, sync_message} = Yex.Sync.message_encode({:sync, reply}) do
      send(from, {:yjs, sync_message, self()})

      with {:ok, step1} <- Sync.get_sync_step1(state.doc),
           {:ok, step1} <- Yex.Sync.message_encode({:sync, step1}) do
        send(from, {:yjs, step1, self()})
      else
        error ->
          error
      end

      awareness_clients = Yex.Awareness.get_client_ids(state.awareness)

      with true <- length(awareness_clients) > 0,
           {:ok, awareness_update} <-
             Yex.Awareness.encode_update(state.awareness, awareness_clients) do
        send(from, {:yjs, Yex.Sync.message_encode!({:awareness, awareness_update}), self()})
      else
        false -> :ok
        error -> error
      end
    else
      error ->
        error
    end

    {:noreply, state, state.timeout}
  end

  @impl true
  def handle_info({:yjs, message, from}, state) when is_binary(message) do
    case Yex.Sync.message_decode(message) do
      {:ok, message} ->
        handle_yjs_message(message, from, state)

      error ->
        Logger.error(error)
        {:noreply, state, state.timeout}
    end
  end

  @impl true
  def handle_info({:update_v1, update, origin, _doc}, state) do
    state =
      if function_exported?(state.persistence, :update_v1, 4) do
        persistence_state =
          state.persistence.update_v1(state.persistence_state, update, state.doc_name, state.doc)

        put_in(state, :persistence_state, persistence_state)
      else
        state
      end

    with {:ok, s} <- Sync.get_update(update),
         {:ok, message} = Yex.Sync.message_encode({:sync, s}) do
      broadcast_to_group_process(message, origin, state)

      broadcast_to_users(message, origin, state)
    else
      error ->
        error
    end

    {:noreply, state, state.timeout}
  end

  @impl true
  def handle_info(
        {:awareness_change, %{removed: removed, added: added, updated: updated}, origin,
         awareness},
        state
      ) do
    changed_clients = added ++ updated ++ removed

    with {:ok, update} <- Yex.Awareness.encode_update(awareness, changed_clients),
         {:ok, message} = Yex.Sync.message_encode({:awareness, update}) do
      broadcast_to_group_process(message, origin, state)
      broadcast_to_users(message, origin, state)
    else
      error ->
        Logger.error(error)
        error
    end

    {:noreply, state, state.timeout}
  end

  def handle_info({_ref, :join, _group, pids}, %{doc: doc} = state) do
    with {:ok, s} <- Sync.get_sync_step1(doc),
         {:ok, step1} <- Yex.Sync.message_encode({:sync, s}) do
      pids
      |> Enum.each(fn pid ->
        send(pid, {:yjs, step1, self()})
      end)
    else
      error ->
        Logger.error(error)
        error
    end

    {:noreply, state, state.timeout}
  end

  def handle_info({_ref, :leave, _group, _pids}, state) do
    {:noreply, state, state.timeout}
  end

  def handle_info(:timeout, state) do
    if should_exit?(state) do
      {:stop, :normal, state}
    else
      {:noreply, state, state.timeout}
    end
  end

  @impl true
  def terminate(_reason, state) do
    if function_exported?(state.persistence, :unbind, 3) do
      state.persistence.unbind(state.persistence_state, state.doc_name, state.doc)
    end

    :ok
  end

  defp handle_yjs_message({:sync, sync_message}, from, state) do
    with {:ok, reply} <- Sync.read_sync_message(sync_message, state.doc, "#{inspect(from)}"),
         {:ok, sync_message} = Yex.Sync.message_encode({:sync, reply}) do
      send(from, {:yjs, sync_message, self()})
    else
      error ->
        error
    end

    {:noreply, state, state.timeout}
  end
  defp handle_yjs_message({:awareness, message}, from, state) do
    Yex.Awareness.apply_update(state.awareness, message)
    {:noreply, state, state.timeout}
  end

  defp handle_yjs_message(_, from, state) do

    # unsupported_message
    {:noreply, state, state.timeout}
  end

  defp should_exit?(state) do
    state.local_pubsub && state.local_pubsub.monitor_count(state.doc_name) === 0
  end

  defp broadcast_to_users(message, origin, state) do
    if state.local_pubsub != nil do
      state.local_pubsub.broadcast(
        state.doc_name,
        {:yjs, message, self()},
        origin
      )
    end
  end

  defp broadcast_to_group_process(message, _origin, state) do
    if state.pg_scope != nil do
      :pg.get_members(state.pg_scope, state.doc_name)
      |> Enum.reject(&(&1 == self()))
      |> Enum.each(fn pid ->
        send(pid, {:yjs, message, self()})
      end)
    end
  end
end
