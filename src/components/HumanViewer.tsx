import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { PoseFrame } from '../lib/humanModel'
import { applyPoseToSkinnedMesh, createHumanModel, updateHumanModelFromPose } from '../lib/humanModel'
import samplePose from '../data/samplePose'
import boneMap from '../data/boneMap.json'
import skeletonModelUrl from '../assets/model/skeleton.fbx?url'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'

type Props = { initialPose?: PoseFrame }

const JOINT_COUNT = 33

const JOINT_LABELS: Record<number, string> = {
  0: 'Nose',
  1: 'Left Eye Inner',
  2: 'Left Eye',
  3: 'Left Eye Outer',
  4: 'Right Eye Inner',
  5: 'Right Eye',
  6: 'Right Eye Outer',
  7: 'Left Ear',
  8: 'Right Ear',
  9: 'Mouth Left',
  10: 'Mouth Right',
  11: 'Left Shoulder',
  12: 'Right Shoulder',
  13: 'Left Elbow',
  14: 'Right Elbow',
  15: 'Left Wrist',
  16: 'Right Wrist',
  17: 'Left Pinky',
  18: 'Right Pinky',
  19: 'Left Index',
  20: 'Right Index',
  21: 'Left Thumb',
  22: 'Right Thumb',
  23: 'Left Hip',
  24: 'Right Hip',
  25: 'Left Knee',
  26: 'Right Knee',
  27: 'Left Ankle',
  28: 'Right Ankle',
  29: 'Left Heel',
  30: 'Right Heel',
  31: 'Left Foot Index',
  32: 'Right Foot Index'
}

const DEFAULT_JOINT: PoseFrame[number] = { x: 0.5, y: 0.5, z: 0 }

type MarkerMap = Record<number, THREE.Mesh>
const JOINT_INDICES = Array.from({ length: JOINT_COUNT }, (_, i) => i)

type HingeJointConfig = {
  parent: number
  child: number
  dependents?: number[]
  min?: number
  max?: number
  label: string
}

const HINGE_JOINTS: Record<number, HingeJointConfig> = {
  13: { parent: 11, child: 15, dependents: [17, 19, 21], min: 0, max: 150, label: '左肘' },
  14: { parent: 12, child: 16, dependents: [18, 20, 22], min: 0, max: 150, label: '右肘' },
  25: { parent: 23, child: 27, dependents: [29, 31], min: 0, max: 160, label: '左膝' },
  26: { parent: 24, child: 28, dependents: [30, 32], min: 0, max: 160, label: '右膝' }
}

const clonePose = (pose: PoseFrame): PoseFrame =>
  Object.fromEntries(
    Object.entries(pose).map(([key, value]) => [
      Number(key),
      { x: value.x, y: value.y, z: value.z ?? 0 }
    ])
  ) as PoseFrame

const createPoseWithDefaults = (pose?: PoseFrame): PoseFrame => {
  const full: PoseFrame = {}
  for (let i = 0; i < JOINT_COUNT; i++) {
    full[i] = { ...DEFAULT_JOINT }
  }
  if (pose) {
    Object.entries(pose).forEach(([key, value]) => {
      const idx = Number(key)
      full[idx] = { x: value.x, y: value.y, z: value.z ?? 0 }
    })
  }
  return full
}

function createJointMarkers() {
  const group = new THREE.Group()
  const joints: MarkerMap = {}
  const geometry = new THREE.SphereGeometry(0.035, 16, 16)

  JOINT_INDICES.forEach((idx) => {
    const material = new THREE.MeshBasicMaterial({
      color: idx <= 10 ? 0x38bdf8 : idx <= 22 ? 0x34d399 : 0xf97316
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.visible = false
    group.add(mesh)
    joints[idx] = mesh
  })

  return { group, joints }
}

function updateJointMarkers(markers: MarkerMap, pose: PoseFrame) {
  JOINT_INDICES.forEach((idx) => {
    const mesh = markers[idx]
    const point = pose[idx]
    if (!mesh) return
    if (!point) {
      mesh.visible = false
      return
    }
    mesh.position.set((point.x - 0.5) * 5, (0.5 - point.y) * 5, (point.z || 0) * -3)
    mesh.visible = true
  })
}

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function toSceneVector(joint: PoseFrame[number]) {
  const sx = (joint.x - 0.5) * 5
  const sy = (0.5 - joint.y) * 5
  const sz = (joint.z ?? 0) * -3
  return new THREE.Vector3(sx, sy, sz)
}

function toPoseVector(vec: THREE.Vector3): PoseFrame[number] {
  return {
    x: clampNumber(vec.x / 5 + 0.5, 0, 1),
    y: clampNumber(0.5 - vec.y / 5, 0, 1),
    z: clampNumber(-vec.z / 3, -1.5, 1.5)
  }
}

function computeOrientation(joint: PoseFrame[number]) {
  const vec = toSceneVector(joint)
  const radius = vec.length()
  if (radius < 1e-5) {
    return { radius: 0, azimuth: 0, elevation: 0 }
  }
  const azimuth = Math.atan2(vec.y, vec.x)
  const planar = Math.sqrt(vec.x * vec.x + vec.y * vec.y)
  const elevation = Math.atan2(vec.z, planar)
  return { radius, azimuth, elevation }
}

function computeFlexAngleDegrees(pose: PoseFrame, jointIdx: number): number | null {
  const cfg = HINGE_JOINTS[jointIdx]
  if (!cfg) return null
  const joint = pose[jointIdx]
  const parent = pose[cfg.parent]
  const child = pose[cfg.child]
  if (!joint || !parent || !child) return null
  const jointScene = toSceneVector(joint)
  const upper = toSceneVector(parent).sub(jointScene)
  const lower = toSceneVector(child).sub(jointScene)
  const upperLen = upper.length()
  const lowerLen = lower.length()
  if (upperLen < 1e-4 || lowerLen < 1e-4) return null
  const angle = upper.angleTo(lower)
  const flex = THREE.MathUtils.radToDeg(Math.PI - angle)
  const min = cfg.min ?? 0
  const max = cfg.max ?? 160
  return clampNumber(flex, min, max)
}

function applyHingeFlex(
  pose: PoseFrame,
  basePose: PoseFrame,
  jointIdx: number,
  flexDeg: number
) {
  const cfg = HINGE_JOINTS[jointIdx]
  if (!cfg) return
  const joint = pose[jointIdx] ?? basePose[jointIdx]
  const parent = pose[cfg.parent] ?? basePose[cfg.parent]
  const child = pose[cfg.child] ?? basePose[cfg.child]
  if (!joint || !parent || !child) return

  const jointScene = toSceneVector(joint)
  const parentScene = toSceneVector(parent)
  const childScene = toSceneVector(child)

  const upper = parentScene.clone().sub(jointScene)
  let lower = childScene.clone().sub(jointScene)

  const upperLen = upper.length()
  const lowerLen = lower.length()
  if (upperLen < 1e-4 || lowerLen < 1e-4) return

  const upperDir = upper.clone().normalize()
  let axisNormal = upper.clone().cross(lower).normalize()
  if (axisNormal.lengthSq() < 1e-6) {
    axisNormal = new THREE.Vector3(0, 0, 1).cross(upper).normalize()
    if (axisNormal.lengthSq() < 1e-6) {
      axisNormal = new THREE.Vector3(0, 1, 0).cross(upper).normalize()
      if (axisNormal.lengthSq() < 1e-6) axisNormal = new THREE.Vector3(1, 0, 0)
    }
  }

  let axisPerp = axisNormal.clone().cross(upperDir).normalize()
  if (axisPerp.lengthSq() < 1e-6) {
    axisPerp = axisNormal.clone()
  }

  const lowerNorm = lower.clone().normalize()
  const sign = axisPerp.dot(lowerNorm) >= 0 ? 1 : -1
  axisPerp.multiplyScalar(sign)

  const min = cfg.min ?? 0
  const max = cfg.max ?? 160
  const flex = THREE.MathUtils.degToRad(clampNumber(flexDeg, min, max))
  const dir = axisPerp
    .clone()
    .multiplyScalar(Math.sin(flex))
    .sub(upperDir.clone().multiplyScalar(Math.cos(flex)))
  if (dir.lengthSq() < 1e-6) return
  dir.normalize()

  const newChildScene = jointScene.clone().add(dir.multiplyScalar(lowerLen))
  const deltaScene = newChildScene.clone().sub(childScene)

  pose[cfg.child] = toPoseVector(newChildScene)
  cfg.dependents?.forEach((idx) => {
    const dep = pose[idx] ?? basePose[idx]
    if (!dep) return
    const depScene = toSceneVector(dep).add(deltaScene)
    pose[idx] = toPoseVector(depScene)
  })
}

export default function HumanViewer({ initialPose }: Props) {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const requestRef = useRef<number | null>(null)
  const threeRef = useRef<any>(null)
  const viewModeRef = useRef<'stick' | 'model'>('stick')
  const basePose = useMemo(() => createPoseWithDefaults(initialPose ?? samplePose), [initialPose])
  const poseRef = useRef<PoseFrame>(clonePose(basePose))
  const [pose, setPose] = useState<PoseFrame>(() => clonePose(basePose))
  const [selectedJoint, setSelectedJoint] = useState<number>(0)
  const [availableBones, setAvailableBones] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'stick' | 'model'>('stick')
  const [fbxReady, setFbxReady] = useState(false)
  const [anglePanelCollapsed, setAnglePanelCollapsed] = useState(false)

  useEffect(() => {
    const container = canvasRef.current!
    const width = container.clientWidth || 800
    const height = container.clientHeight || 600
    let disposed = false

    setFbxReady(false)
    setAvailableBones([])

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0x0c111b, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x111217)
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
    camera.position.set(2.5, 2.2, 5.2)

    const ambient = new THREE.AmbientLight(0xffffff, 0.8)
    const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x1f2933, 0.4)
    const dir = new THREE.DirectionalLight(0xffffff, 0.9)
    dir.position.set(6, 8, 6)
    dir.castShadow = true
    scene.add(ambient, hemi, dir)

    const grid = new THREE.GridHelper(12, 24, 0x2dd4bf, 0x1a2a3a)
    grid.position.y = -1.2
    scene.add(grid)
    const axes = new THREE.AxesHelper(1.2)
    scene.add(axes)

    const { group: markerGroup, joints: markerJoints } = createJointMarkers()
    markerGroup.visible = false
    scene.add(markerGroup)

    const { group: stickGroup, joints: stickJoints } = createHumanModel()
    stickGroup.scale.set(1, 1.25, 1)
    scene.add(stickGroup)
    updateHumanModelFromPose(stickJoints, poseRef.current)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.95
    controls.minDistance = 1.5
    controls.maxDistance = 12
    controls.target.set(0, 1.0, 0)
    controls.update()

    threeRef.current = {
      renderer,
      scene,
      camera,
      controls,
      grid,
      axes,
      stickGroup,
      stickJoints,
      markerGroup,
      markerJoints,
      bonesByName: null as Record<string, THREE.Bone> | null,
      boneMapping: boneMap as Record<string, string> | null,
      fbxGroup: null as THREE.Group | null
    }
    updateJointMarkers(markerJoints, poseRef.current)

    // 尝试加载 FBX 模型（如果存在），并绑定到场景
    ;(async () => {
      try {
        const response = await fetch(skeletonModelUrl)
        if (!response.ok) {
          throw new Error(`无法加载模型资源（${response.status} ${response.statusText}）`)
        }

        const buffer = await response.arrayBuffer()
        const view = new DataView(buffer)
        const isUtf16 = view.byteLength >= 2 && view.getUint16(0, true) === 0xfeff

        const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader')
        const loader = new FBXLoader()

        let fbx: THREE.Group
        if (isUtf16) {
          const decoder = new TextDecoder('utf-16le')
          const text = decoder.decode(buffer)
          fbx = loader.parse(text, '')
        } else {
          fbx = loader.parse(buffer, '')
        }

        fbx.traverse((child: any) => {
          if (child.isMesh) {
            child.castShadow = true
            child.receiveShadow = true
            child.frustumCulled = false
          }
        })
        fbx.scale.set(0.1, 0.1, 0.1)
        fbx.position.set(0, -0.6, 0)
        fbx.visible = viewModeRef.current === 'model'
        scene.add(fbx)
        threeRef.current.fbxGroup = fbx
        if (!disposed) setFbxReady(true)

        const skinned: THREE.SkinnedMesh | undefined = (() => {
          let s: any = undefined
          fbx.traverse((c: any) => {
            if (!s && c.isSkinnedMesh) s = c
          })
          return s
        })()

        if (skinned) {
          const skeleton = skinned.skeleton
          const bonesByName: Record<string, THREE.Bone> = {}
          skeleton.bones.forEach((b) => (bonesByName[b.name] = b))

          const mapping: Record<string, string> = boneMap as any

          try {
            applyPoseToSkinnedMesh(poseRef.current, mapping, bonesByName)
            console.log('[HumanViewer] 已将当前姿态应用到 FBX 模型')
          } catch (err) {
            console.warn('[HumanViewer] 应用姿态到蒙皮模型失败', err)
          }

          threeRef.current.bonesByName = bonesByName
          threeRef.current.skinnedMesh = skinned
          threeRef.current.boneMapping = mapping
          if (!disposed) setAvailableBones(skeleton.bones.map((bone) => bone.name))
        } else {
          console.warn('[HumanViewer] 未在 FBX 中找到 SkinnedMesh，已添加静态模型到场景')
        }
      } catch (e) {
        console.info('[HumanViewer] 未能加载 FBX 加载器或模型，继续使用球-线骨架', e)
      }
    })()

    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      requestRef.current = requestAnimationFrame(animate)
    }
    animate()

    const onResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      scene.remove(markerGroup)
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      markerGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh
          if (mesh.geometry) geometries.add(mesh.geometry)
          if (mesh.material) {
            const material = mesh.material as THREE.Material | THREE.Material[]
            if (Array.isArray(material)) material.forEach((m) => materials.add(m))
            else materials.add(material)
          }
        }
      })
      geometries.forEach((geo) => geo.dispose())
      materials.forEach((mat) => mat.dispose())
      scene.remove(stickGroup)
      const stickGeometries = new Set<THREE.BufferGeometry>()
      const stickMaterials = new Set<THREE.Material>()
      stickGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh
          if (mesh.geometry) stickGeometries.add(mesh.geometry)
          if (mesh.material) {
            const material = mesh.material as THREE.Material | THREE.Material[]
            if (Array.isArray(material)) material.forEach((m) => stickMaterials.add(m))
            else stickMaterials.add(material)
          }
        }
      })
      stickGeometries.forEach((geo) => geo.dispose())
      stickMaterials.forEach((mat) => mat.dispose())
      if (threeRef.current?.fbxGroup) {
        scene.remove(threeRef.current.fbxGroup)
      }
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
      threeRef.current = null
      disposed = true
    }
  }, [initialPose])

  useEffect(() => {
    poseRef.current = pose
    if (threeRef.current) {
      if (threeRef.current.markerJoints) {
        updateJointMarkers(threeRef.current.markerJoints, pose)
      }
      if (threeRef.current.stickJoints) {
        updateHumanModelFromPose(threeRef.current.stickJoints, pose)
      }
      if (threeRef.current.bonesByName && threeRef.current.boneMapping) {
        applyPoseToSkinnedMesh(pose, threeRef.current.boneMapping, threeRef.current.bonesByName)
      }
    }
  }, [pose])

  useEffect(() => {
    const next = clonePose(basePose)
    poseRef.current = next
    setPose(next)
    if (threeRef.current) {
      if (threeRef.current.markerJoints) {
        updateJointMarkers(threeRef.current.markerJoints, next)
      }
      if (threeRef.current.stickJoints) {
        updateHumanModelFromPose(threeRef.current.stickJoints, next)
      }
      if (threeRef.current.bonesByName && threeRef.current.boneMapping) {
        applyPoseToSkinnedMesh(next, threeRef.current.boneMapping, threeRef.current.bonesByName)
      }
    }
  }, [basePose])

  useEffect(() => {
    viewModeRef.current = viewMode
    if (!threeRef.current) return
    const { stickGroup, markerGroup, fbxGroup } = threeRef.current
    if (stickGroup) stickGroup.visible = viewMode === 'stick'
    if (markerGroup) markerGroup.visible = viewMode === 'model'
    if (fbxGroup) fbxGroup.visible = viewMode === 'model'
  }, [viewMode])

  const applySample = () => {
    const next = createPoseWithDefaults(samplePose)
    poseRef.current = clonePose(next)
    setPose(next)
  }

  const resetView = () => {
    if (!threeRef.current) return
    const { camera, controls } = threeRef.current
    camera.position.set(2.5, 2.2, 5.2)
    controls.target.set(0, 1.0, 0)
    controls.update()
  }

  const activeJoint = useMemo(() => {
    return pose[selectedJoint] ?? DEFAULT_JOINT
  }, [pose, selectedJoint])

  const computedAngles = useMemo(() => {
    const toDegrees = (rad: number) => Math.round((rad * 180) / Math.PI * 10) / 10
    const offsetX = (activeJoint.x - 0.5) * 5
    const offsetY = (0.5 - activeJoint.y) * 5
    const offsetZ = (activeJoint.z ?? 0) * -3
    return {
      xy: toDegrees(Math.atan2(offsetY, offsetX)),
      yz: toDegrees(Math.atan2(offsetY, offsetZ || 0.0001)),
      zx: toDegrees(Math.atan2(offsetZ, offsetX))
    }
  }, [activeJoint])

  const jointOptions = useMemo(
    () =>
      JOINT_INDICES.map((idx) => ({
        value: idx,
        label: JOINT_LABELS[idx] ?? `Joint ${idx}`
      })),
    []
  )

  const mappingSummary = useMemo(() => {
    const mapping = boneMap as Record<string, string>
    return JOINT_INDICES.map((idx) => {
      const label = JOINT_LABELS[idx] ?? `Joint ${idx}`
      const mappedBone = mapping[String(idx)]
      if (!mappedBone) {
        return { idx, label, boneName: null, status: 'unmapped' as const }
      }
      const exists = availableBones.includes(mappedBone)
      return { idx, label, boneName: mappedBone, status: exists ? 'linked' : 'missing' as const }
    })
  }, [availableBones])

  const hingeConfig = HINGE_JOINTS[selectedJoint]
  const hingeFlexAngle = useMemo(() => {
    if (!hingeConfig) return null
    const angle = computeFlexAngleDegrees(pose, selectedJoint)
    return angle ?? 0
  }, [pose, selectedJoint, hingeConfig])

  const handleHingeFlexChange = (value: number) => {
    if (!hingeConfig) return
    if (!Number.isFinite(value)) return
    const limited = clampNumber(value, hingeConfig.min ?? 0, hingeConfig.max ?? 160)
    setPose((prev) => {
      const next = clonePose(prev)
      applyHingeFlex(next, basePose, selectedJoint, limited)
      poseRef.current = next
      return next
    })
  }

  return (
    <div className="viewer-root">
      <div className="viewer-canvas-column">
        <div className="canvas-wrap" ref={canvasRef} />
        <div className="controls">
          <div className="view-toggle">
            <button
              className={`toggle-button ${viewMode === 'stick' ? 'active' : ''}`}
              onClick={() => setViewMode('stick')}
            >
              火柴人模式
            </button>
            <button
              className={`toggle-button ${viewMode === 'model' ? 'active' : ''}`}
              onClick={() => setViewMode('model')}
              disabled={!fbxReady}
            >
              模型模式
            </button>
          </div>
          <div className="control-actions">
            <button onClick={applySample}>应用示例动作</button>
            <button onClick={resetView}>重置视角</button>
          </div>
        </div>
      </div>
      <div className="control-panel">
        <div className="panel-section">
          <div className="panel-title">关节编辑</div>
          <label className="field">
            <span>关节</span>
            <select value={selectedJoint} onChange={(e) => setSelectedJoint(Number(e.target.value))}>
              {jointOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.value} · {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="panel-section angle-panel">
          <button
            type="button"
            className="collapse-header"
            onClick={() => setAnglePanelCollapsed((prev) => !prev)}
          >
            <span>角度控制</span>
            <span className={`chevron ${anglePanelCollapsed ? 'collapsed' : ''}`} />
          </button>
          <div className={`collapse-content ${anglePanelCollapsed ? 'collapsed' : ''}`}>
            {hingeConfig ? (
              <>
                <label className="field inline radius-field">
                  <span>{hingeConfig.label}弯曲 (°)</span>
                  <input
                    type="range"
                    min={hingeConfig.min ?? 0}
                    max={hingeConfig.max ?? 160}
                    step={1}
                    value={hingeFlexAngle ?? 0}
                    onChange={(e) => handleHingeFlexChange(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    min={hingeConfig.min ?? 0}
                    max={hingeConfig.max ?? 160}
                    step={1}
                    value={Number((hingeFlexAngle ?? 0).toFixed(0))}
                    onChange={(e) => handleHingeFlexChange(Number(e.target.value))}
                  />
                </label>
                <p className="note small">
                  0° 表示完全伸直，数值越大表示弯曲越明显（建议范围 {hingeConfig.min ?? 0}° —
                  {hingeConfig.max ?? 160}°）。
                </p>
              </>
            ) : (
              <p className="note small">
                当前关节暂不支持直接输入角度，可通过采集数据或示例姿态驱动。
              </p>
            )}
          </div>
        </div>
        <div className="panel-section">
          <div className="panel-subtitle">角度预览（相对原点）</div>
          <div className="angles-grid">
            <div>
              <span>XY 平面</span>
              <strong>{computedAngles.xy}°</strong>
            </div>
            <div>
              <span>YZ 平面</span>
              <strong>{computedAngles.yz}°</strong>
            </div>
            <div>
              <span>ZX 平面</span>
              <strong>{computedAngles.zx}°</strong>
            </div>
          </div>
          <p className="note">
            数值根据当前关节位置估算，可用于辅助输入角度与位移信息。
          </p>
        </div>
        {
          viewMode === 'model' && (
            <div className="panel-section">
              <div className="panel-title">骨骼映射</div>
              <div className="mapping-table">
                <div className="mapping-row header">
                  <span>索引</span>
                  <span>MediaPipe 关节</span>
                  <span>模型骨骼</span>
                  <span>状态</span>
                </div>
                {mappingSummary.map((row) => (
                  <div key={row.idx} className={`mapping-row status-${row.status}`}>
                    <span>{row.idx}</span>
                    <span>{row.label}</span>
                    <span>{row.boneName ?? '未映射'}</span>
                    <span className="status-pill">
                      {row.status === 'linked' && '已匹配'}
                      {row.status === 'missing' && '骨骼缺失'}
                      {row.status === 'unmapped' && '未配置'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        }
      </div>
    </div>
  )
}
