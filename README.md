# 简要说明
该项目是react项目

### 项目启动相关
#### 项目依赖
> node 版本至少 v20

```
pnpm i 或者 npm i
```

#### 项目启动
```
pnpm dev 或者 npm run dev
```


### 项目与3d模型构建(此方案待定)
![点击模型](./readme/01.png)

- 方案一: mediapipe 是基于2d算法点阵形成的骨骼识别.如果必须要识别3d,就得把模型拍成很多图片,然后进行识别(挺画蛇添足的做法)
- 方案二: 手动制作相关模型,模型上的所有节点是可识别的,且都需要与一个标准的规则进行映射(需要提供相关文件)

### 目前的演示规则
![](./src/components/HumanViewer.tsx?#L64)

``` tsx
const HINGE_JOINTS: Record<number, HingeJointConfig> = {
  13: { parent: 11, child: 15, dependents: [17, 19, 21], min: 0, max: 150, label: '左肘' },
  14: { parent: 12, child: 16, dependents: [18, 20, 22], min: 0, max: 150, label: '右肘' },
  25: { parent: 23, child: 27, dependents: [29, 31], min: 0, max: 160, label: '左膝' },
  26: { parent: 24, child: 28, dependents: [30, 32], min: 0, max: 160, label: '右膝' }
}
```



### TODO
- [ ] 在需肩/髋等多轴关节，可扩展更多局部坐标系逻辑
- [ ] 在角度面板增加“重置角度”以快速回到初始姿态
- [ ] 结合真实骨骼名称完善 boneMap.json，让映射表全部显示"已匹配"