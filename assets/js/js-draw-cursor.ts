import {
  type Editor,
  EditorEventType,
  Mat33,
  ReactiveValue,
  Vec2,
  Vec3,
} from "js-draw";

type CursorElementProps = {
  color: string;
  name: string;
};
class CursorElement {
  root: HTMLElement;
  svg: SVGSVGElement;
  cursor: SVGPathElement;
  text: SVGTextElement;
  position = ReactiveValue.fromInitialValue(Mat33.identity);
  constructor(private props: CursorElementProps, editor: Editor) {
    const root = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    root.style.position = "absolute";
    root.style.pointerEvents = "none";
    root.appendChild(svg);

    const cursor = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path"
    );
    cursor.setAttribute(
      "d",
      "M6.0514 13.8265l-.2492-.0802L2.9457 7.2792C.1918 1.0445.092.8038.1699.5806.2228.4288.3482.3056.5341.2228.7984.1049 1.0774.1889 4.671 1.4678c2.1194.7542 5.1566 1.8335 6.7494 2.3984 2.7276.9673 2.9033 1.0434 3.0214 1.3084.079.1773.091.3553.0325.4813-.0943.2028-.263.3007-3.883 2.2529-.7343.396-1.1547.6679-1.2886.8336-.1093.1352-.6487 1.157-1.1987 2.2706-1.2672 2.5658-1.3349 2.6849-1.5911 2.7991-.1167.052-.3243.0585-.4613.0144Z"
    );
    cursor.setAttribute("stroke", "black");
    cursor.setAttribute("stroke-width", "2");
    svg.appendChild(cursor);

    const cursorText = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );
    cursorText.setAttribute("fill", "black");
    cursorText.setAttribute("stroke", "black");
    cursorText.setAttribute("stroke-width", "0.1");
    cursorText.setAttribute("font-size", "14px");
    cursorText.setAttribute("font-family", "Arial");
    cursorText.setAttribute("font-family", "Arial");
    cursorText.setAttribute("x", "0px");
    cursorText.setAttribute("y", "28px");
    svg.appendChild(cursorText);

    this.root = root;
    this.svg = svg;
    this.cursor = cursor;
    this.text = cursorText;

    editor.anchorElementToCanvas(root, this.position);

    this.update(props);
  }

  update(props: CursorElementProps) {
    this.props = props;
    this.cursor.setAttribute("fill", props.color);
    this.text.setAttribute("fill", props.color);
    this.text.textContent = props.name;
  }
}

type Listener = (pos: { x: number; y: number }) => void;

type Subscription = () => void;

export class JsDrawCursor {
  cursors: Map<string | number, CursorElement> = new Map();
  listeners: Listener[] = [];
  subscriptions: Subscription[] = [];
  constructor(private editor: Editor) {
    const update = throttle((pos: Vec3) => {
      const topLeft = this.editor.getOutputBBoxInDOM().topLeft;
      const canvasPosition = this.editor.viewport.screenToCanvas(
        pos.minus(topLeft)
      );
      for (const listner of this.listeners) {
        listner({ x: canvasPosition.x, y: canvasPosition.y });
      }
    }, 50);

    const mouseMoveHandler = (e: PointerEvent) => {
      update(Vec3.of(e.clientX, e.clientY, 0));
    };

    const root = this.editor.getRootElement();
    root.addEventListener("pointermove", mouseMoveHandler);
    this.subscriptions.push(() =>
      root.removeEventListener("pointermove", mouseMoveHandler)
    );
  }

  addCursorChange(fn: Listener) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  updateCursor(
    id: string | number,
    cur: {
      x: number;
      y: number;
      color: string;
      name: string;
    }
  ) {
    const c = this.cursors.get(id);
    const props = { color: cur.color, name: cur.name };

    const position = Mat33.translation(Vec2.of(cur.x, cur.y));
    if (c) {
      c.update(props);
      c.position.set(position);
      return;
    }

    const cursor = new CursorElement(props, this.editor);

    cursor.position.set(position);
    this.cursors.set(id, cursor);
  }
  removeCursor(id: string | number) {
    const c = this.cursors.get(id);
    if (c) {
      c.svg.remove();
      this.cursors.delete(id);
    }
  }

  remove() {
    for (const cursor of this.cursors.values()) {
      cursor.svg.remove();
    }

    for (const sub of this.subscriptions) {
      sub();
    }
  }
}

// biome-ignore lint/suspicious/noExplicitAny: any is used to avoid type errors
function throttle<T extends (...args: any[]) => void>(
  func: T,
  limit: number
): T {
  let lastFunc: ReturnType<typeof setTimeout> | null = null;
  let lastRan: number | null = null;

  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    if (lastRan === null) {
      func.apply(this, args);
      lastRan = Date.now();
    } else {
      if (lastFunc) {
        clearTimeout(lastFunc);
      }
      lastFunc = setTimeout(() => {
        if (Date.now() - (lastRan as number) >= limit) {
          func.apply(this, args);
          lastRan = Date.now();
        }
      }, limit - (Date.now() - lastRan));
    }
  } as T;
}
