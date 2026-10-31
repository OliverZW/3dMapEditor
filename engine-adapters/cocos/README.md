# 地图数据协议 v2 · Cocos 接入参考

本目录及导出包提供地图数据协议、标准参考资源和独立读取示例。游戏项目自行决定加载、节点组织、模型、贴图、材质、批渲染和后续调整；不安装旧场景生成扩展，不自动创建场景或地图 Prefab。

## 使用数据包

1. 在编辑器选择“Cocos 导出”，勾选内容并生成 ZIP，解压到独立目录。
2. 以 `manifest.json` 为唯一入口；读取 `exportVersion=2`、坐标、地图尺寸、entries 和 files。先校验版本、路径、字节数及 SHA-256，再读取数据。
3. `terrain/final.f32` 是包含河床的最终绝对高度；PNG16 是量化交换副本，不再重复合成河床。地形 GLB 是一个连续参考网格。
4. 实例 JSON 的 `assetId` 引用 `models/index.json` 的逻辑 ID。`position`、`yaw`、`scale` 已合成模型默认值，不要二次应用默认缩放、偏移或水平居中。
5. 通过逻辑 ID 建立游戏自己的 Prefab／资源关联即可替换模型。贴图和材质可以在游戏项目中自行编辑，协议不存放 Cocos UUID、Prefab 路径或生成代码中的硬编码引用。
6. `logic/logic.json` 中保存据点及初始势力；`owners.u32` 保存逐格据点 ID，势力由据点的 `factionId` 派生。游戏中的后续运行状态由游戏管理。

## 独立读取示例

示例适用 Node.js 22.12+，用来验证如何消费协议，不是 Cocos 运行组件。解压包后执行：

```powershell
npm install --prefix examples --ignore-scripts
node examples/read-map.mjs .
```

示例仅依赖锁定声明的 Ajv 8.17.1 和 Node 内置模块，不导入编辑器源码；核对清单、路径、哈希、字段、数组和必要引用，并提供 `getHeight(x,z)`、`getCellOwner(q,r)`、`getCellFaction(q,r)` 的读取示范。示例读取清单文件，不扫描游戏目录或修改文件，也不会创建场景。完整生成包校验由导出器测试覆盖，不把示例当作通用的不可信压缩包导入器。

游戏需自行将文件读取部分换成其平台的资源加载方式；Cocos 构建运行时不应直接使用 Node 的 fs。通用 JSON／二进制数据与节点呈现分别处理。只导出草时，河流元数据和据点排除足迹仍会存在，它们不是可见水面或据点节点。

## 可编辑、可替换的参考资源

- 模型是自包含标准静态 GLB，保留源模型几何、材质和贴图；据点仅增加水平中心归零包装节点，垂直原点不变。原始工程素材不被修改。
- 内嵌模型贴图另外提取为 `textures/<sha256>.png|webp|jpg`，保持原编码，不有损转码；相同内容去重。模型索引的 `material` 引用可读 JSON，其 materials 使用 glTF 材质字段，textures 按索引列出独立文件路径和采样参数。
- GLB 的内嵌贴图保证模型本身可独立使用；外置贴图与材质描述供游戏重建或替换素材，不会自动回写 GLB。
- 地表四层贴图、权重及水面法线／遮罩和参数独立提供。编辑器专有 shader、光照和动画不要求在游戏中复刻。
- 不直接修改需要校验的原始导出包来维持“原包已验证”的声明。将所需文件复制到游戏素材目录后自行修改；游戏怎样管理这些修改和下一次导出，由游戏项目决定。

## 状态与版本

当前导出器已实现 `map3d-engine-export/exportVersion=2`。包内 `validation.package=passed` 只代表数据包检查，`import`／`engine` 固定为 `not-run`；真实 Creator 导入、材质、性能没有在本示例中验收。旧 v1 包不由新示例读取，应打开原 `.map3d` 后重新导出；地图工程仍为 v3，旧工程读取兼容不变。

协议唯一来源：工程内 `.agent/docs/engine-export-spec.md`；随包字段契约：`protocol/engine-export-v2.schema.json`。本目录不包含引擎导入扩展、数据回写、覆盖系统或游戏加载器。
