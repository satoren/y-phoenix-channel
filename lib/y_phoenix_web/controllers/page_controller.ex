defmodule YPhoenixWeb.PageController do
  use YPhoenixWeb, :controller

  def home(conn, _params) do
    render(conn, :quill, layout: false)
  end

  def quill(conn, _params) do
    render(conn, :quill, layout: false)
  end

  def blocknote(conn, _params) do
    render(conn, :blocknote, layout: false)
  end

  def excalidraw(conn, _params) do
    render(conn, :excalidraw, layout: false)
  end
end
