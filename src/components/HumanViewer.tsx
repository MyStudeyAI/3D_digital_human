import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { PoseFrame } from '../lib/humanModel'
import { createHumanModel, updateHumanModelFromPose, applyPoseToSkinnedMesh } from '../lib/humanModel'
import samplePose from '../data/samplePose'
import boneMap from '../data/boneMap.json'
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

export default function HumanViewer({ initialPose }: Props) {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const requestRef = useRef<number | null>(null)
  const threeRef = useRef<any>(null)
  const basePose = useMemo(() => createPoseWithDefaults(initialPose ?? samplePose), [initialPose])
  const poseRef = useRef<PoseFrame>(clonePose(basePose))
  const [pose, setPose] = useState<PoseFrame>(() => clonePose(basePose))
  const [selectedJoint, setSelectedJoint] = useState<number>(0)

  useEffect(() => {
    const container = canvasRef.current!
    const width = container.clientWidth || 800
    const height = container.clientHeight || 600

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0x0c111b, 1)
    renderer.outputEncoding = THREE.sRGBEncoding
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

    const { group, joints } = createHumanModel()
    scene.add(group)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.95
    controls.minDistance = 1.5
    controls.maxDistance = 12
    controls.target.set(0, 1.0, 0)
    controls.update()

    threeRef.current = { renderer, scene, camera, joints, controls, grid, axes }

    // 尝试加载 FBX 模型（如果存在），并绑定到场景
    ;(async () => {
      try {
        // 使用 Vite 的 import.meta.url 构造模型的绝对 URL
        const modelUrl = new URL('../model/skeleton.fbx', import.meta.url).href
        const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader')
        const loader = new FBXLoader()

        loader.load(modelUrl, (gltf: THREE.Group) => {
          // 将模型加入场景
          gltf.traverse((child: any) => {
            if (child.isMesh) {
              child.castShadow = true
              child.receiveShadow = true
            }
          })
          // 缩放/定位可按需调整
          gltf.scale.set(0.01, 0.01, 0.01)
          scene.add(gltf)

          // 查找 SkinnedMesh 与骨骼
          const skinned: THREE.SkinnedMesh | undefined = (() => {
            let s: any = undefined
            gltf.traverse((c: any) => {
              if (!s && c.isSkinnedMesh) s = c
            })
            return s
          })()

          if (skinned) {
            const skeleton = skinned.skeleton
            const bonesByName: Record<string, THREE.Bone> = {}
            skeleton.bones.forEach((b) => (bonesByName[b.name] = b))

            // 读取默认 boneMap（MediaPipe index -> bone name），尝试映射
            const mapping: Record<string, string> = boneMap as any

            // 应用示例 pose 到蒙皮模型
            try {
              applyPoseToSkinnedMesh(samplePose, mapping, bonesByName)
              console.log('[HumanViewer] 已将示例姿态应用到模型')
            } catch (err) {
              console.warn('[HumanViewer] 应用姿态到蒙皮模型失败', err)
            }
          } else {
            console.warn('[HumanViewer] 未在 FBX 中找到 SkinnedMesh，已添加静态模型到场景')
          }
        }, undefined, (err: unknown) => {
          console.warn('模型加载失败:', err)
        })
      } catch (e) {
        console.info('[HumanViewer] 未能加载 FBX 加载器或模型，继续使用球-线骨架')
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

    updateHumanModelFromPose(joints, poseRef.current)

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
    }
  }, [initialPose])

  useEffect(() => {
    poseRef.current = pose
    if (threeRef.current) {
      updateHumanModelFromPose(threeRef.current.joints, pose)
    }
  }, [pose])

  useEffect(() => {
    const next = clonePose(basePose)
    poseRef.current = next
    setPose(next)
    if (threeRef.current) {
      updateHumanModelFromPose(threeRef.current.joints, next)
    }
  }, [basePose])

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

  const handleJointValueChange = (axis: 'x' | 'y' | 'z', rawValue: number) => {
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
    const safeValue =
      axis === 'z' ? clamp(rawValue, -1.5, 1.5) : clamp(rawValue, 0, 1)
    setPose((prev) => {
      const next = { ...prev }
      const current = next[selectedJoint] ? { ...next[selectedJoint]! } : { ...DEFAULT_JOINT }
      current[axis] = safeValue
      next[selectedJoint] = current
      return next
    })
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

  const jointOptions = useMemo(() => {
    const indices = Array.from({ length: JOINT_COUNT }, (_, i) => i)
    return indices.map((idx) => ({
      value: idx,
      label: JOINT_LABELS[idx] ?? `Joint ${idx}`
    }))
  }, [])

  return (
    <div className="viewer-root">
      <div className="viewer-canvas-column">
        <div className="canvas-wrap" ref={canvasRef} />
        <div className="controls">
          <button onClick={applySample}>应用示例动作</button>
          <button onClick={resetView}>重置视角</button>
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
        <div className="panel-section">
          <div className="panel-subtitle">坐标（归一化）</div>
          <label className="field">
            <span>X（0-1）</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={activeJoint.x}
              onChange={(e) => handleJointValueChange('x', Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={Number(activeJoint.x.toFixed(2))}
              onChange={(e) => handleJointValueChange('x', Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Y（0-1）</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={activeJoint.y}
              onChange={(e) => handleJointValueChange('y', Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={Number(activeJoint.y.toFixed(2))}
              onChange={(e) => handleJointValueChange('y', Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Z（-1.5 - 1.5）</span>
            <input
              type="range"
              min={-1.5}
              max={1.5}
              step={0.01}
              value={activeJoint.z ?? 0}
              onChange={(e) => handleJointValueChange('z', Number(e.target.value))}
            />
            <input
              type="number"
              min={-1.5}
              max={1.5}
              step={0.01}
              value={Number((activeJoint.z ?? 0).toFixed(2))}
              onChange={(e) => handleJointValueChange('z', Number(e.target.value))}
            />
          </label>
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
      </div>
    </div>
  )
}
