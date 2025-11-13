import React from 'react'
import HumanViewer from './components/HumanViewer'
import samplePose from './data/samplePose'

export default function App() {
  return (
    <div className="app-container">
      <div className="header">3D 数字人体（React + TypeScript）</div>
      <HumanViewer initialPose={samplePose} />
    </div>
  )
}
