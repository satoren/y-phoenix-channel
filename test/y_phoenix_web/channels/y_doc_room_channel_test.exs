defmodule YPhoenixWeb.YDocRoomChannelTest do
  use YPhoenixWeb.ChannelCase

  setup do
    # Initialize Syn scopes for tests
    :syn.add_node_to_scopes([:doc_servers])

    {:ok, _, socket} =
      YPhoenixWeb.UserSocket
      |> socket("user_id", %{some: :assign})
      |> subscribe_and_join(YPhoenixWeb.YDocRoomChannel, "y_doc_room:lobby")

    on_exit(fn ->
      # Clean up Syn registrations after test
      # Note: Syn automatically cleans up when processes terminate
      :ok
    end)

    %{socket: socket}
  end

  test "join creates a socket and starts DocServer via Syn", %{socket: socket} do
    assert socket.assigns.doc_name == "lobby"
    assert is_pid(socket.assigns.doc_pid)

    # Verify the DocServer is registered in Syn
    case :syn.lookup(:doc_servers, "lobby") do
      {pid, _metadata} -> assert pid == socket.assigns.doc_pid
      :undefined -> flunk("DocServer not found in Syn registry")
    end
  end

  test "multiple joins to same document reuse the same DocServer" do
    # First connection
    {:ok, _, socket1} =
      YPhoenixWeb.UserSocket
      |> socket("user_1", %{})
      |> subscribe_and_join(YPhoenixWeb.YDocRoomChannel, "y_doc_room:shared_doc")

    pid1 = socket1.assigns.doc_pid

    # Second connection to same document
    {:ok, _, socket2} =
      YPhoenixWeb.UserSocket
      |> socket("user_2", %{})
      |> subscribe_and_join(YPhoenixWeb.YDocRoomChannel, "y_doc_room:shared_doc")

    pid2 = socket2.assigns.doc_pid

    # Both should reference the same DocServer process
    assert pid1 == pid2
  end

  test "join with different documents creates separate DocServers" do
    {:ok, _, socket1} =
      YPhoenixWeb.UserSocket
      |> socket("user_1", %{})
      |> subscribe_and_join(YPhoenixWeb.YDocRoomChannel, "y_doc_room:doc_1")

    {:ok, _, socket2} =
      YPhoenixWeb.UserSocket
      |> socket("user_2", %{})
      |> subscribe_and_join(YPhoenixWeb.YDocRoomChannel, "y_doc_room:doc_2")

    # Different documents should have different PIDs
    assert socket1.assigns.doc_pid != socket2.assigns.doc_pid
    assert socket1.assigns.doc_name == "doc_1"
    assert socket2.assigns.doc_name == "doc_2"
  end
end
