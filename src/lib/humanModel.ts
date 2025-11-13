import * as THREE from 'three'

export type Joint = { x: number; y: number; z?: number }
export type PoseFrame = Record<number, Joint>
export type JointMap = Record<number, THREE.Mesh>

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [17, 19], [19, 21],
  [15, 19], [15, 21],
  [12, 14], [14, 16], [16, 18], [18, 20], [20, 22],
  [16, 20], [16, 22],
  [11, 23], [12, 24],
  [23, 24], [23, 25], [25, 27], [27, 29], [29, 31],
  [24, 26], [26, 28], [28, 30], [30, 32],
  [27, 31], [28, 32],
  [0, 9], [0, 10],
  [0, 11], [0, 12]
]

export function createHumanModel() {
  const group = new THREE.Group()
  const joints: JointMap = {}

  const jointGeo = new THREE.SphereGeometry(0.07, 12, 12)
  const jointMat = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    emissive: 0x1d4ed8,
    emissiveIntensity: 0.2,
    roughness: 0.35,
    metalness: 0.15
  })

  for (let i = 0; i < 33; i++) {
    const m = new THREE.Mesh(jointGeo, jointMat.clone())
    m.visible = false
    group.add(m)
    joints[i] = m
  }

  CONNECTIONS.forEach(() => {
    const geom = new THREE.BufferGeometry()
    const mat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 })
    const line = new THREE.Line(geom, mat)
    line.visible = false
    group.add(line)
  })

  return { group, joints }
}

export function updateHumanModelFromPose(joints: JointMap, pose: PoseFrame) {
  Object.keys(joints).forEach((k) => {
    const idx = Number(k)
    const mesh = joints[idx]
    const p = pose[idx]
    if (p) {
      mesh.position.set((p.x - 0.5) * 5, (0.5 - p.y) * 5, (p.z || 0) * -3)
      mesh.visible = true
    } else {
      mesh.visible = false
    }
  })

  const group = (Object.values(joints)[0].parent as THREE.Group)
  let lineIndex = 33
  CONNECTIONS.forEach(([s, e]) => {
    const start = pose[s]
    const end = pose[e]
    const line = group.children[lineIndex] as THREE.Line
    lineIndex++
    if (start && end) {
      const p1 = new THREE.Vector3((start.x - 0.5) * 5, (0.5 - start.y) * 5, (start.z || 0) * -3)
      const p2 = new THREE.Vector3((end.x - 0.5) * 5, (0.5 - end.y) * 5, (end.z || 0) * -3)
      const geom = new THREE.BufferGeometry().setFromPoints([p1, p2])
      if (line.geometry) line.geometry.dispose()
      line.geometry = geom
      line.visible = true
    } else {
      line.visible = false
    }
  })
}

/**
 * 将 pose 应用到 Skinned Mesh 的骨骼（简化实现）
 * @param pose PoseFrame - 媒体点索引映射到 3D 坐标
 * @param boneNameMap Record<number, string> - 媒体点索引 -> 模型骨骼名
 * @param bonesByName Record<string, THREE.Bone> - 模型中 name -> Bone 映射
 */
export function applyPoseToSkinnedMesh(
  pose: PoseFrame,
  boneNameMap: Record<string, string>,
  bonesByName: Record<string, THREE.Bone>
) {
  Object.entries(boneNameMap).forEach(([idxStr, boneName]) => {
    const idx = Number(idxStr)
    const joint = pose[idx]
    const bone = bonesByName[boneName]
    if (!joint || !bone) return

    // 将标准化坐标转换为 Three.js 场景坐标（与 updateHumanModelFromPose 保持一致）
    const target = new THREE.Vector3((joint.x - 0.5) * 5, (0.5 - joint.y) * 5, (joint.z || 0) * -3)

    // 直接设置骨骼位置（简化，真实项目可能需要计算旋转以保持骨骼层级关系）
    bone.position.copy(target)
    bone.updateMatrixWorld(true)
  })
}
