defmodule YPhoenixWeb.DocServerTest do
  use YPhoenixWeb.ChannelCase, async: true

  alias Yex.Awareness
  alias Yex.Doc
  alias Yex.DocServer.State

  test "awareness updates are throttled with leading and trailing broadcasts" do
    topic = "y_doc_room:throttle_test"
    :ok = YPhoenixWeb.Endpoint.subscribe(topic)

    doc = Doc.new()
    {:ok, awareness} = Awareness.new(doc)
    :ok = Awareness.set_local_state(awareness, %{"name" => "alice"})

    client_id = Awareness.client_id(awareness)

    state =
      %State{doc: doc, awareness: awareness, module: YPhoenixWeb.DocServer}
      |> State.assign(%{
        topic: topic,
        doc_name: "throttle_test",
        origin_clients_map: %{},
        user_count: 1,
        persistance_state: %{},
        shutdown_timer_ref: nil,
        awareness_throttle_ms: 50,
        awareness_window_open: false,
        awareness_pending_clients: MapSet.new(),
        awareness_pending_origin: :unset,
        awareness_flush_timer_ref: nil
      })

    {:noreply, state} =
      YPhoenixWeb.DocServer.handle_awareness_update(
        awareness,
        %{removed: [], added: [client_id], updated: []},
        nil,
        state
      )

    assert_receive %Phoenix.Socket.Broadcast{topic: ^topic, event: "yjs"}

    {:noreply, state} =
      YPhoenixWeb.DocServer.handle_awareness_update(
        awareness,
        %{removed: [], added: [], updated: [client_id]},
        nil,
        state
      )

    refute_receive %Phoenix.Socket.Broadcast{topic: ^topic, event: "yjs"}, 10

    {:noreply, state} = YPhoenixWeb.DocServer.handle_info(:flush_awareness, state)

    assert_receive %Phoenix.Socket.Broadcast{topic: ^topic, event: "yjs"}

    assert state.assigns.awareness_window_open == false
    assert state.assigns.awareness_pending_clients == MapSet.new()
    assert state.assigns.awareness_pending_origin == :unset
    assert is_nil(state.assigns.awareness_flush_timer_ref)
  end

  test "trailing awareness uses origin when all pending updates share the same origin" do
    topic = "y_doc_room:throttle_origin_same"
    :ok = YPhoenixWeb.Endpoint.subscribe(topic)

    doc = Doc.new()
    {:ok, awareness} = Awareness.new(doc)
    :ok = Awareness.set_local_state(awareness, %{"name" => "alice"})

    client_id = Awareness.client_id(awareness)

    state =
      %State{doc: doc, awareness: awareness, module: YPhoenixWeb.DocServer}
      |> State.assign(%{
        topic: topic,
        doc_name: "throttle_origin_same",
        origin_clients_map: %{},
        user_count: 1,
        persistance_state: %{},
        shutdown_timer_ref: nil,
        awareness_throttle_ms: 50,
        awareness_window_open: false,
        awareness_pending_clients: MapSet.new(),
        awareness_pending_origin: :unset,
        awareness_flush_timer_ref: nil
      })

    {:noreply, state} =
      YPhoenixWeb.DocServer.handle_awareness_update(
        awareness,
        %{removed: [], added: [client_id], updated: []},
        nil,
        state
      )

    assert_receive %Phoenix.Socket.Broadcast{topic: ^topic, event: "yjs"}

    {:noreply, state} =
      YPhoenixWeb.DocServer.handle_awareness_update(
        awareness,
        %{removed: [], added: [], updated: [client_id]},
        self(),
        state
      )

    {:noreply, _state} = YPhoenixWeb.DocServer.handle_info(:flush_awareness, state)

    refute_receive %Phoenix.Socket.Broadcast{topic: ^topic, event: "yjs"}, 10
  end

  test "trailing awareness falls back to broadcast when pending origins are mixed" do
    topic = "y_doc_room:throttle_origin_mixed"
    :ok = YPhoenixWeb.Endpoint.subscribe(topic)

    doc = Doc.new()
    {:ok, awareness} = Awareness.new(doc)
    :ok = Awareness.set_local_state(awareness, %{"name" => "alice"})

    client_id = Awareness.client_id(awareness)

    state =
      %State{doc: doc, awareness: awareness, module: YPhoenixWeb.DocServer}
      |> State.assign(%{
        topic: topic,
        doc_name: "throttle_origin_mixed",
        origin_clients_map: %{},
        user_count: 1,
        persistance_state: %{},
        shutdown_timer_ref: nil,
        awareness_throttle_ms: 50,
        awareness_window_open: false,
        awareness_pending_clients: MapSet.new(),
        awareness_pending_origin: :unset,
        awareness_flush_timer_ref: nil
      })

    {:noreply, state} =
      YPhoenixWeb.DocServer.handle_awareness_update(
        awareness,
        %{removed: [], added: [client_id], updated: []},
        nil,
        state
      )

    assert_receive %Phoenix.Socket.Broadcast{topic: ^topic, event: "yjs"}

    {:noreply, state} =
      YPhoenixWeb.DocServer.handle_awareness_update(
        awareness,
        %{removed: [], added: [], updated: [client_id]},
        self(),
        state
      )

    {:noreply, state} =
      YPhoenixWeb.DocServer.handle_awareness_update(
        awareness,
        %{removed: [], added: [], updated: [client_id]},
        nil,
        state
      )

    {:noreply, _state} = YPhoenixWeb.DocServer.handle_info(:flush_awareness, state)

    assert_receive %Phoenix.Socket.Broadcast{topic: ^topic, event: "yjs"}
  end
end
