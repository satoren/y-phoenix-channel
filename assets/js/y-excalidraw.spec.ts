import { describe, expect, test, vi } from "vitest";
import { ExcalidrawBinding } from "./y-excalidraw";
import * as Y from "yjs";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types/types";
import { ExcalidrawElement, NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";

const syncDocs = (doc1: Y.Doc, doc2: Y.Doc) => {
  const sv1 = Y.encodeStateVector(doc1);
  const update2 = Y.encodeStateAsUpdate(doc2, sv1);
  Y.applyUpdate(doc1, update2);

  const sv2 = Y.encodeStateVector(doc2);
  const update1 = Y.encodeStateAsUpdate(doc1, sv2);
  Y.applyUpdate(doc2, update1);
}

const createExcalidrawApiMock = () => {
  let elements = []
  type OnChangeCallback = (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => void
  const onChangeListeners:OnChangeCallback[] = []

  return   vi.mocked<ExcalidrawImperativeAPI>(({
    updateScene: vi.fn(({elements: updatedElements})=>{
      elements = updatedElements
      onChangeListeners.forEach(listener=>listener(updatedElements, {} as any, {}))
    }),
    updateLibrary: vi.fn(),
    resetScene: undefined,
    getSceneElementsIncludingDeleted: vi.fn(()=>elements),
    history: {
      clear: undefined
    },
    scrollToContent: vi.fn(),
    getSceneElements: vi.fn(()=>elements),
    getAppState: vi.fn(),
    getFiles: vi.fn(),
    refresh: vi.fn(),
    setToast: vi.fn(),
    addFiles: vi.fn(),
    id: "",
    setActiveTool: vi.fn(),
    setCursor: vi.fn(),
    resetCursor: vi.fn(),
    toggleSidebar: vi.fn(),
    updateFrameRendering: vi.fn(),
    onChange: vi.fn((callback: OnChangeCallback)=>{
      onChangeListeners.push(callback)
      return ()=>{
        const index = onChangeListeners.indexOf(callback)
        if(index>-1){
          onChangeListeners.splice(index, 1)
        }
      }
    }),
    onPointerDown: vi.fn(),
    onPointerUp: vi.fn(),
  }))
}

describe("ExcalidrawBinding", () => {
  test("snapshot", () => {
    const e1 = [
      {
        id: "cIQh4r6HOcWQTbIKlVdc7",
        type: "freedraw",
        x: 927.3333740234375,
        y: 171.66668701171875,
        width: 0,
        height: 0,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 1238615798,
        version: 2,
        versionNonce: 1130941290,
        isDeleted: false,
        boundElements: null,
        updated: 1726214549611,
        link: null,
        locked: false,
        points: [[0, 0]],
        pressures: [],
        simulatePressure: true,
        lastCommittedPoint: null,
      },
    ] as const;
    const e2 = [
      {
        id: "cIQh4r6HOcWQTbIKlVdc7",
        type: "freedraw",
        x: 927.3333740234375,
        y: 171.66668701171875,
        width: 76.6666259765625,
        height: 162,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 1238615798,
        version: 22,
        versionNonce: 246133354,
        isDeleted: false,
        boundElements: null,
        updated: 1726214550044,
        link: null,
        locked: false,
        points: [
          [0, 0],
          [-62.66668701171875, 62.666656494140625],
          [-68.66668701171875, 75.33331298828125],
          [-72, 96],
          [-72, 100],
          [-70.66668701171875, 112],
          [-69.3333740234375, 119.33331298828125],
          [-66, 124],
          [-60, 134.66665649414062],
          [-50, 144],
          [-42.66668701171875, 149.33331298828125],
          [-36, 152.66665649414062],
          [-30, 154.66665649414062],
          [-28.66668701171875, 155.33331298828125],
          [-18.66668701171875, 158.66665649414062],
          [-17.3333740234375, 158.66665649414062],
          [-12, 160.66665649414062],
          [-8, 161.33331298828125],
          [-6.66668701171875, 162],
          [3.33331298828125, 162],
          [4.6666259765625, 162],
        ],
        pressures: [],
        simulatePressure: true,
        lastCommittedPoint: null,
      },
    ] as const;
    const e3 = [
      {
        id: "cIQh4r6HOcWQTbIKlVdc7",
        type: "freedraw",
        x: 927.3333740234375,
        y: 171.66668701171875,
        width: 77.33331298828125,
        height: 162.66665649414062,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 1238615798,
        version: 24,
        versionNonce: 1958584298,
        isDeleted: false,
        boundElements: null,
        updated: 1726214550375,
        link: null,
        locked: false,
        points: [
          [0, 0],
          [-62.66668701171875, 62.666656494140625],
          [-68.66668701171875, 75.33331298828125],
          [-72, 96],
          [-72, 100],
          [-70.66668701171875, 112],
          [-69.3333740234375, 119.33331298828125],
          [-66, 124],
          [-60, 134.66665649414062],
          [-50, 144],
          [-42.66668701171875, 149.33331298828125],
          [-36, 152.66665649414062],
          [-30, 154.66665649414062],
          [-28.66668701171875, 155.33331298828125],
          [-18.66668701171875, 158.66665649414062],
          [-17.3333740234375, 158.66665649414062],
          [-12, 160.66665649414062],
          [-8, 161.33331298828125],
          [-6.66668701171875, 162],
          [3.33331298828125, 162],
          [4.6666259765625, 162],
          [5.33331298828125, 162.66665649414062],
          [5.33331298828125, 162.66665649414062],
        ],
        pressures: [],
        simulatePressure: true,
        lastCommittedPoint: [5.33331298828125, 162.66665649414062],
      },
      {
        id: "_FY_CXdx9ffRERbgVngnV",
        type: "freedraw",
        x: 994.6666870117188,
        y: 203.66668701171875,
        width: 94.66668701171875,
        height: 13.33331298828125,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 1837712630,
        version: 13,
        versionNonce: 1690477482,
        isDeleted: false,
        boundElements: null,
        updated: 1726214588511,
        link: null,
        locked: false,
        points: [
          [0, 0],
          [-12, 3.33331298828125],
          [-16.66668701171875, 4.666656494140625],
          [-21.33331298828125, 6],
          [-28, 7.33331298828125],
          [-56.66668701171875, 11.33331298828125],
          [-60, 12],
          [-68.66668701171875, 12.666656494140625],
          [-84, 12.666656494140625],
          [-86.66668701171875, 12.666656494140625],
          [-92.66668701171875, 12.666656494140625],
          [-94.66668701171875, 13.33331298828125],
        ],
        pressures: [],
        simulatePressure: true,
        lastCommittedPoint: null,
      },
    ] as const;
    const e4 = [
      {
        id: "cIQh4r6HOcWQTbIKlVdc7",
        type: "freedraw",
        x: 927.3333740234375,
        y: 171.66668701171875,
        width: 77.33331298828125,
        height: 162.66665649414062,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 1238615798,
        version: 24,
        versionNonce: 1958584298,
        isDeleted: false,
        boundElements: null,
        updated: 1726214550375,
        link: null,
        locked: false,
        points: [
          [0, 0],
          [-62.66668701171875, 62.666656494140625],
          [-68.66668701171875, 75.33331298828125],
          [-72, 96],
          [-72, 100],
          [-70.66668701171875, 112],
          [-69.3333740234375, 119.33331298828125],
          [-66, 124],
          [-60, 134.66665649414062],
          [-50, 144],
          [-42.66668701171875, 149.33331298828125],
          [-36, 152.66665649414062],
          [-30, 154.66665649414062],
          [-28.66668701171875, 155.33331298828125],
          [-18.66668701171875, 158.66665649414062],
          [-17.3333740234375, 158.66665649414062],
          [-12, 160.66665649414062],
          [-8, 161.33331298828125],
          [-6.66668701171875, 162],
          [3.33331298828125, 162],
          [4.6666259765625, 162],
          [5.33331298828125, 162.66665649414062],
          [5.33331298828125, 162.66665649414062],
        ],
        pressures: [],
        simulatePressure: true,
        lastCommittedPoint: [5.33331298828125, 162.66665649414062],
      },
      {
        id: "_FY_CXdx9ffRERbgVngnV",
        type: "freedraw",
        x: 994.6666870117188,
        y: 203.66668701171875,
        width: 104,
        height: 13.33331298828125,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 1837712630,
        version: 20,
        versionNonce: 884557546,
        isDeleted: false,
        boundElements: null,
        updated: 1726214588674,
        link: null,
        locked: false,
        points: [
          [0, 0],
          [-12, 3.33331298828125],
          [-16.66668701171875, 4.666656494140625],
          [-21.33331298828125, 6],
          [-28, 7.33331298828125],
          [-56.66668701171875, 11.33331298828125],
          [-60, 12],
          [-68.66668701171875, 12.666656494140625],
          [-84, 12.666656494140625],
          [-86.66668701171875, 12.666656494140625],
          [-92.66668701171875, 12.666656494140625],
          [-94.66668701171875, 13.33331298828125],
          [-95.33331298828125, 13.33331298828125],
          [-98.66668701171875, 13.33331298828125],
          [-99.33331298828125, 13.33331298828125],
          [-100, 13.33331298828125],
          [-102.66668701171875, 13.33331298828125],
          [-104, 13.33331298828125],
          [-104, 13.33331298828125],
        ],
        pressures: [],
        simulatePressure: true,
        lastCommittedPoint: [-104, 13.33331298828125],
      },
    ] as const;
    
  const ydoc = new Y.Doc();
    const array = ydoc.getArray<Y.Map<unknown>>("elements");
    const api1 = createExcalidrawApiMock()
    const binding = new ExcalidrawBinding(array, api1);
    
    const ydoc2 = new Y.Doc();
    const array2 = ydoc2.getArray<Y.Map<unknown>>("elements");
    const api2= createExcalidrawApiMock()
    const binding2 = new ExcalidrawBinding(array, api2);

    api1.updateScene({ elements: e1 });
    syncDocs(ydoc, ydoc2);
    api1.updateScene({ elements: e2 });
    syncDocs(ydoc, ydoc2);
    api1.updateScene({ elements: e3 });
    syncDocs(ydoc, ydoc2);
    api1.updateScene({ elements: e4 });
    syncDocs(ydoc, ydoc2);

    api2.updateScene({ elements: [...e4].reverse() });
    syncDocs(ydoc, ydoc2);
    api2.updateScene({ elements: e4 });
    syncDocs(ydoc, ydoc2);

    expect(api1.getSceneElements()).toMatchSnapshot();
    expect(api2.getSceneElements()).toMatchSnapshot();


     expect(array2.toJSON()).toMatchSnapshot();
     api2.updateScene({ elements: e4.map((e) => ({ ...e, isDeleted: true })) });
     syncDocs(ydoc, ydoc2);

     expect(api1.getSceneElements()).toEqual([]);
     expect(api2.getSceneElements()).toEqual([]);
  });
});
