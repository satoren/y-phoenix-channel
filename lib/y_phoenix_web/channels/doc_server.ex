defmodule YPhoenixWeb.DocServer do
  use Yex.DocServer
  require Logger
  alias Yex.Awareness
  alias Yex.Sync
  alias YPhoenixWeb.Presence

  @persistence YPhoenix.EctoPersistence
  @ttl 5_000
  @awareness_throttle_ms 50

  @impl true
  def init(option, %{doc: doc} = state) do
    topic = Keyword.fetch!(option, :topic)
    doc_name = Keyword.fetch!(option, :doc_name)
    Logger.info("DocServer for #{doc_name} initialized.")

    persistance_state = @persistence.bind(%{}, doc_name, doc)

    Presence.subscribe(topic)

    user_count = Presence.list_users(topic) |> length()

    {:ok,
     state
     |> assign(%{
       topic: topic,
       doc_name: doc_name,
       origin_clients_map: %{},
       user_count: user_count,
       persistance_state: persistance_state,
       shutdown_timer_ref: nil,
       awareness_throttle_ms: @awareness_throttle_ms,
       awareness_window_open: false,
       awareness_pending_clients: MapSet.new(),
       awareness_pending_origin: :unset,
       awareness_flush_timer_ref: nil
     })}
  end

  @impl true
  def handle_update_v1(doc, update, origin, state) do
    persistance_state =
      @persistence.update_v1(
        state.assigns.persistance_state,
        update,
        state.assigns.doc_name,
        doc
      )

    state = assign(state, :persistance_state, persistance_state)

    with {:ok, s} <- Sync.get_update(update),
         {:ok, message} <- Sync.message_encode({:sync, s}) do
      if origin do
        YPhoenixWeb.Endpoint.broadcast_from(
          origin,
          state.assigns.topic,
          "yjs",
          {:binary, message}
        )
      else
        YPhoenixWeb.Endpoint.broadcast(state.assigns.topic, "yjs", {:binary, message})
      end
    else
      error ->
        error
    end

    {:noreply, state}
  end

  @impl true
  def handle_awareness_update(
        awareness,
        %{removed: removed, added: added, updated: updated},
        origin,
        state
      ) do
    updated_clients = MapSet.new(added ++ updated ++ removed)

    state =
      if origin do
        monitor_and_update_origin_clients_map(state, origin, added, removed)
      else
        state
      end

    if state.assigns.awareness_window_open do
      pending_clients = MapSet.union(state.assigns.awareness_pending_clients, updated_clients)
      pending_origin = merge_pending_origin(state.assigns.awareness_pending_origin, origin)

      {:noreply,
       assign(state, %{
         awareness_pending_clients: pending_clients,
         awareness_pending_origin: pending_origin
       })}
    else
      with {:ok, update} <- Awareness.encode_update(awareness, MapSet.to_list(updated_clients)),
           {:ok, message} <- Sync.message_encode({:awareness, update}) do
        broadcast_awareness_update(origin, state.assigns.topic, message)

        ref =
          Process.send_after(
            self(),
            :flush_awareness,
            state.assigns.awareness_throttle_ms
          )

        {:noreply,
         assign(state, %{
           awareness_window_open: true,
           awareness_pending_clients: MapSet.new(),
           awareness_pending_origin: :unset,
           awareness_flush_timer_ref: ref
         })}
      else
        error ->
          Logger.log(:warning, error)
          {:noreply, state}
      end
    end
  end

  defp broadcast_awareness_update(origin, topic, message) do
    if origin do
      YPhoenixWeb.Endpoint.broadcast_from(origin, topic, "yjs", {:binary, message})
    else
      YPhoenixWeb.Endpoint.broadcast(topic, "yjs", {:binary, message})
    end
  end

  defp monitor_and_update_origin_clients_map(state, origin, added, removed) do
    origin_clients_map = state.assigns[:origin_clients_map] || %{}
    entry = Map.get(origin_clients_map, origin)
    # Monitor if not already monitored
    ref =
      case entry do
        nil -> Process.monitor(origin)
        %{monitor_ref: r} -> r
      end

    # Update client_ids
    client_ids =
      case entry do
        nil ->
          added

        %{client_ids: prev} ->
          (added ++ prev) |> Enum.uniq() |> Enum.reject(&Enum.member?(removed, &1))
      end

    # Demonitor if no client_ids left
    origin_clients_map =
      if client_ids == [] do
        Process.demonitor(ref, [:flush])
        Map.delete(origin_clients_map, origin)
      else
        # Update map
        Map.put(origin_clients_map, origin, %{monitor_ref: ref, client_ids: client_ids})
      end

    assign(state, %{origin_clients_map: origin_clients_map})
  end

  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    origin_clients_map = state.assigns[:origin_clients_map] || %{}

    case Map.get(origin_clients_map, pid) do
      %{client_ids: ids} ->
        Awareness.remove_states(state.awareness, ids)
        origin_clients_map = Map.delete(origin_clients_map, pid)
        {:noreply, assign(state, %{origin_clients_map: origin_clients_map})}

      _ ->
        {:noreply, state}
    end
  end

  @impl true
  def handle_info({Presence, {:join, _presence}}, state) do
    state = assign(state, :user_count, state.assigns.user_count + 1)
    # Cancel shutdown timer if a user joins
    if state.assigns.shutdown_timer_ref do
      Process.cancel_timer(state.assigns.shutdown_timer_ref)
    end

    {:noreply, assign(state, :shutdown_timer_ref, nil)}
  end

  def handle_info({Presence, {:leave, _presence}}, state) do
    user_count = state.assigns.user_count - 1
    state = assign(state, :user_count, user_count)

    # Cancel existing shutdown timer if present
    if state.assigns.shutdown_timer_ref do
      Process.cancel_timer(state.assigns.shutdown_timer_ref)
    end

    # Set new shutdown timer if no users remain
    state =
      if user_count <= 0 do
        ref = Process.send_after(self(), :delayed_shutdown, @ttl)
        assign(state, :shutdown_timer_ref, ref)
      else
        assign(state, :shutdown_timer_ref, nil)
      end

    {:noreply, state}
  end

  def handle_info(:flush_awareness, state) do
    pending_clients = MapSet.to_list(state.assigns.awareness_pending_clients)
    topic = state.assigns.topic
    trailing_origin = resolve_pending_origin(state.assigns.awareness_pending_origin)

    state =
      assign(state, %{
        awareness_window_open: false,
        awareness_pending_clients: MapSet.new(),
        awareness_pending_origin: :unset,
        awareness_flush_timer_ref: nil
      })

    case pending_clients do
      [] ->
        {:noreply, state}

      _ ->
        with {:ok, update} <- Awareness.encode_update(state.awareness, pending_clients),
             {:ok, message} <- Sync.message_encode({:awareness, update}) do
          broadcast_awareness_update(trailing_origin, topic, message)
          {:noreply, state}
        else
          error ->
            Logger.log(:warning, error)
            {:noreply, state}
        end
    end
  end

  def handle_info(:delayed_shutdown, state) do
    if state.assigns.user_count <= 0 do
      {:stop, :shutdown, state}
    else
      {:noreply, assign(state, :shutdown_timer_ref, nil)}
    end
  end

  @impl true
  def terminate(_reason, state) do
    if state.assigns.awareness_flush_timer_ref do
      Process.cancel_timer(state.assigns.awareness_flush_timer_ref)
    end

    @persistence.unbind(
      state.assigns.persistance_state,
      state.assigns.doc_name,
      state.doc
    )

    Logger.info("DocServer for #{state.assigns.doc_name} terminated.")

    :ok
  end

  defp merge_pending_origin(:unset, origin), do: origin
  defp merge_pending_origin(:mixed, _origin), do: :mixed
  defp merge_pending_origin(origin, origin), do: origin
  defp merge_pending_origin(_origin, _other_origin), do: :mixed

  defp resolve_pending_origin(:unset), do: nil
  defp resolve_pending_origin(:mixed), do: nil
  defp resolve_pending_origin(origin), do: origin
end
