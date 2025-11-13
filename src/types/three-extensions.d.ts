declare module 'three/examples/jsm/controls/OrbitControls' {
  import { Camera, EventDispatcher, MOUSE, Vector3 } from 'three'

  export class OrbitControls extends EventDispatcher {
    constructor(object: Camera, domElement?: HTMLElement)

    object: Camera
    domElement: HTMLElement | Document
    enabled: boolean
    target: Vector3
    minDistance: number
    maxDistance: number
    minZoom: number
    maxZoom: number
    minPolarAngle: number
    maxPolarAngle: number
    minAzimuthAngle: number
    maxAzimuthAngle: number
    enableDamping: boolean
    dampingFactor: number
    enableZoom: boolean
    zoomSpeed: number
    enableRotate: boolean
    rotateSpeed: number
    enablePan: boolean
    keyPanSpeed: number
    autoRotate: boolean
    autoRotateSpeed: number
    keys: { LEFT: string; UP: string; RIGHT: string; BOTTOM: string }
    mouseButtons: { LEFT: MOUSE; MIDDLE: MOUSE; RIGHT: MOUSE }
    update(): void
    saveState(): void
    reset(): void
    dispose(): void
    listenToKeyEvents(domElement: HTMLElement): void
  }
}

declare module 'three/examples/jsm/loaders/FBXLoader' {
  import { Group, Loader, LoadingManager } from 'three'

  export class FBXLoader extends Loader<Group> {
    constructor(manager?: LoadingManager)
    load(
      url: string,
      onLoad: (object: Group) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (event: unknown) => void
    ): void
    parse(data: ArrayBuffer | string, path: string, onLoad?: (object: Group) => void): Group
  }
}

declare module '*.fbx?url' {
  const src: string
  export default src
}

