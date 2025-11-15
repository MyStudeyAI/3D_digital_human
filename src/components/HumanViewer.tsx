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
  type: 'hinge' // 单轴铰链关节（肘、膝）
}

type BallJointConfig = {
  parent: number
  child: number
  dependents?: number[]
  label: string
  type: 'ball' // 多轴球关节（肩、髋）
  // 俯仰角度（上下抬臂/抬腿），单位度
  elevationMin?: number
  elevationMax?: number
  // 内外旋角度（手臂旋转/腿部旋转），单位度
  rotationMin?: number
  rotationMax?: number
}

type JointConfig = HingeJointConfig | BallJointConfig

const JOINT_CONFIGS: Record<number, JointConfig> = {
  // 单轴铰链关节
  13: { parent: 11, child: 15, dependents: [17, 19, 21], min: 0, max: 150, label: '左肘', type: 'hinge' },
  14: { parent: 12, child: 16, dependents: [18, 20, 22], min: 0, max: 150, label: '右肘', type: 'hinge' },
  25: { parent: 23, child: 27, dependents: [29, 31], min: 0, max: 160, label: '左膝', type: 'hinge' },
  26: { parent: 24, child: 28, dependents: [30, 32], min: 0, max: 160, label: '右膝', type: 'hinge' },
  // 多轴球关节（肩）
  11: { parent: 0, child: 13, dependents: [15, 17, 19, 21], label: '左肩', type: 'ball', elevationMin: -180, elevationMax: 180, rotationMin: -90, rotationMax: 90 },
  12: { parent: 0, child: 14, dependents: [16, 18, 20, 22], label: '右肩', type: 'ball', elevationMin: -180, elevationMax: 180, rotationMin: -90, rotationMax: 90 },
  // 多轴球关节（髋）
  23: { parent: 24, child: 25, dependents: [27, 29, 31], label: '左髋', type: 'ball', elevationMin: -90, elevationMax: 90, rotationMin: -45, rotationMax: 45 },
  24: { parent: 23, child: 26, dependents: [28, 30, 32], label: '右髋', type: 'ball', elevationMin: -90, elevationMax: 90, rotationMin: -45, rotationMax: 45 }
}

// 保持向后兼容
const HINGE_JOINTS: Record<number, HingeJointConfig> = {}
Object.entries(JOINT_CONFIGS).forEach(([key, config]) => {
  if (config.type === 'hinge') {
    HINGE_JOINTS[Number(key)] = config
  }
})

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

function computeBallJointAngles(pose: PoseFrame, jointIdx: number): { elevation: number; rotation: number } | null {
  const cfg = JOINT_CONFIGS[jointIdx]
  if (!cfg || cfg.type !== 'ball') return null
  const joint = pose[jointIdx]
  const parent = pose[cfg.parent]
  const child = pose[cfg.child]
  if (!joint || !parent || !child) return null

  const jointScene = toSceneVector(joint)
  const parentScene = toSceneVector(parent)
  const childScene = toSceneVector(child)

  // 从父节点到关节的向量
  const parentToJoint = jointScene.clone().sub(parentScene)
  const parentToJointLen = parentToJoint.length()
  if (parentToJointLen < 1e-4) return null
  const parentToJointNorm = parentToJoint.normalize()

  // 从关节到子节点的向量
  const jointToChild = childScene.clone().sub(jointScene)
  const jointToChildLen = jointToChild.length()
  if (jointToChildLen < 1e-4) return null
  const jointToChildNorm = jointToChild.normalize()

  // 构建局部坐标系
  const up = new THREE.Vector3(0, 1, 0)
  let forward = new THREE.Vector3(0, 0, -1)
  let right = new THREE.Vector3(1, 0, 0)

  // 如果是髋关节，使用髋部中点作为参考
  if (jointIdx === 23 || jointIdx === 24) {
    const otherHipIdx = jointIdx === 23 ? 24 : 23
    const otherHip = pose[otherHipIdx]
    if (otherHip) {
      const otherHipScene = toSceneVector(otherHip)
      const hipCenter = parentScene.clone().add(jointScene).multiplyScalar(0.5)
      forward = otherHipScene.clone().sub(hipCenter).normalize()
      if (forward.lengthSq() < 1e-4) forward = new THREE.Vector3(0, 0, -1)
      right = up.clone().cross(forward).normalize()
      if (right.lengthSq() < 1e-4) right = new THREE.Vector3(1, 0, 0)
    }
  }

  // 计算俯仰角度（相对于水平面的上下角度）
  const elevationRad = Math.asin(clampNumber(jointToChildNorm.dot(up), -1, 1))
  const elevationDeg = THREE.MathUtils.radToDeg(elevationRad)

  // 计算旋转角度（在水平面上的左右角度）
  const projToForward = jointToChildNorm.clone().sub(up.clone().multiplyScalar(jointToChildNorm.dot(up))).normalize()
  if (projToForward.lengthSq() < 1e-4) {
    return { elevation: clampNumber(elevationDeg, cfg.elevationMin ?? -90, cfg.elevationMax ?? 90), rotation: 0 }
  }
  const rotationRad = Math.atan2(projToForward.dot(right), projToForward.dot(forward))
  const rotationDeg = THREE.MathUtils.radToDeg(rotationRad)

  return {
    elevation: clampNumber(elevationDeg, cfg.elevationMin ?? -90, cfg.elevationMax ?? 90),
    rotation: clampNumber(rotationDeg, cfg.rotationMin ?? -90, cfg.rotationMax ?? 90)
  }
}

function applyBallJointAngles(
  pose: PoseFrame,
  basePose: PoseFrame,
  jointIdx: number,
  elevationDeg: number,
  rotationDeg: number
) {
  const cfg = JOINT_CONFIGS[jointIdx]
  if (!cfg || cfg.type !== 'ball') return
  const joint = pose[jointIdx] ?? basePose[jointIdx]
  const parent = pose[cfg.parent] ?? basePose[cfg.parent]
  const child = pose[cfg.child] ?? basePose[cfg.child]
  if (!joint || !parent || !child) return

  const jointScene = toSceneVector(joint)
  const parentScene = toSceneVector(parent)
  const childScene = toSceneVector(child)

  const parentToJoint = jointScene.clone().sub(parentScene)
  const parentToJointLen = parentToJoint.length()
  const jointToChild = childScene.clone().sub(jointScene)
  const jointToChildLen = jointToChild.length()

  if (parentToJointLen < 1e-4 || jointToChildLen < 1e-4) return

  // 计算俯仰和旋转
  const elevationRad = THREE.MathUtils.degToRad(clampNumber(elevationDeg, cfg.elevationMin ?? -90, cfg.elevationMax ?? 90))
  const rotationRad = THREE.MathUtils.degToRad(clampNumber(rotationDeg, cfg.rotationMin ?? -90, cfg.rotationMax ?? 90))

  // 构建局部坐标系
  const up = new THREE.Vector3(0, 1, 0)
  let forward = new THREE.Vector3(0, 0, -1)
  let right = new THREE.Vector3(1, 0, 0)

  // 如果是髋关节，使用髋部中点作为参考
  if (jointIdx === 23 || jointIdx === 24) {
    const otherHipIdx = jointIdx === 23 ? 24 : 23
    const otherHip = pose[otherHipIdx] ?? basePose[otherHipIdx]
    if (otherHip) {
      const otherHipScene = toSceneVector(otherHip)
      const hipCenter = parentScene.clone().add(jointScene).multiplyScalar(0.5)
      forward = otherHipScene.clone().sub(hipCenter).normalize()
      if (forward.lengthSq() < 1e-4) forward = new THREE.Vector3(0, 0, -1)
      right = up.clone().cross(forward).normalize()
      if (right.lengthSq() < 1e-4) right = new THREE.Vector3(1, 0, 0)
    }
  }

  // 应用俯仰（绕右轴旋转）
  const elevationAxis = right.clone()
  const elevationQuat = new THREE.Quaternion().setFromAxisAngle(elevationAxis, elevationRad)
  let childDir = forward.clone().applyQuaternion(elevationQuat)

  // 应用旋转（绕上轴旋转）
  const rotationAxis = up.clone()
  const rotationQuat = new THREE.Quaternion().setFromAxisAngle(rotationAxis, rotationRad)
  childDir = childDir.applyQuaternion(rotationQuat)

  // 计算新的子节点位置
  const newChildScene = jointScene.clone().add(childDir.multiplyScalar(jointToChildLen))
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
    camera.position.set(3.0, 2.5, 7.5)

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
    camera.position.set(3.0, 2.5, 7.5)
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

  const jointConfig = JOINT_CONFIGS[selectedJoint]
  const hingeConfig = HINGE_JOINTS[selectedJoint]
  const ballConfig = jointConfig?.type === 'ball' ? jointConfig : null

  const hingeFlexAngle = useMemo(() => {
    if (!hingeConfig) return null
    const angle = computeFlexAngleDegrees(pose, selectedJoint)
    return angle ?? 0
  }, [pose, selectedJoint, hingeConfig])

  const ballJointAngles = useMemo(() => {
    if (!ballConfig) return null
    const angles = computeBallJointAngles(pose, selectedJoint)
    return angles ?? { elevation: 0, rotation: 0 }
  }, [pose, selectedJoint, ballConfig])

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

  const handleBallJointElevationChange = (value: number) => {
    if (!ballConfig || !ballJointAngles) return
    if (!Number.isFinite(value)) return
    const limited = clampNumber(value, ballConfig.elevationMin ?? -90, ballConfig.elevationMax ?? 90)
    setPose((prev) => {
      const next = clonePose(prev)
      applyBallJointAngles(next, basePose, selectedJoint, limited, ballJointAngles.rotation)
      poseRef.current = next
      return next
    })
  }

  const handleBallJointRotationChange = (value: number) => {
    if (!ballConfig || !ballJointAngles) return
    if (!Number.isFinite(value)) return
    const limited = clampNumber(value, ballConfig.rotationMin ?? -90, ballConfig.rotationMax ?? 90)
    setPose((prev) => {
      const next = clonePose(prev)
      applyBallJointAngles(next, basePose, selectedJoint, ballJointAngles.elevation, limited)
      poseRef.current = next
      return next
    })
  }

  const resetJointAngle = () => {
    if (!jointConfig) return
    const next = clonePose(basePose)
    poseRef.current = next
    setPose(next)
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
                <button className="reset-angle-btn" onClick={resetJointAngle}>
                  重置角度
                </button>
              </>
            ) : ballConfig ? (
              <>
                <label className="field inline radius-field">
                  <span>{ballConfig.label}俯仰 (°)</span>
                  <input
                    type="range"
                    min={ballConfig.elevationMin ?? -90}
                    max={ballConfig.elevationMax ?? 90}
                    step={1}
                    value={ballJointAngles?.elevation ?? 0}
                    onChange={(e) => handleBallJointElevationChange(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    min={ballConfig.elevationMin ?? -90}
                    max={ballConfig.elevationMax ?? 90}
                    step={1}
                    value={Number((ballJointAngles?.elevation ?? 0).toFixed(0))}
                    onChange={(e) => handleBallJointElevationChange(Number(e.target.value))}
                  />
                </label>
                <label className="field inline radius-field">
                  <span>{ballConfig.label}旋转 (°)</span>
                  <input
                    type="range"
                    min={ballConfig.rotationMin ?? -90}
                    max={ballConfig.rotationMax ?? 90}
                    step={1}
                    value={ballJointAngles?.rotation ?? 0}
                    onChange={(e) => handleBallJointRotationChange(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    min={ballConfig.rotationMin ?? -90}
                    max={ballConfig.rotationMax ?? 90}
                    step={1}
                    value={Number((ballJointAngles?.rotation ?? 0).toFixed(0))}
                    onChange={(e) => handleBallJointRotationChange(Number(e.target.value))}
                  />
                </label>
                <p className="note small">
                  俯仰：控制上下抬举（-90° 到 +90°）。旋转：控制内外旋转（-90° 到 +90°）。
                </p>
                <button className="reset-angle-btn" onClick={resetJointAngle}>
                  重置角度
                </button>
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
