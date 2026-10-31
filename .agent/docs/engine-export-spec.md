# 通用引擎导出协议 v2

日期：2026-10-25 · 状态：**运行导出器已切换 v2；按地图数据与可替换参考资源交付。真实引擎导入与运行另行验收。**  
入口：[资料索引](README.md) · [Cocos 接入说明](cocos-export.md) · [对齐验收清单](engine-export-alignment.md) · [字段契约](contracts/engine-export-v2.schema.json) · [字段样例](contracts/engine-export-v2.example.json)

## 1. 用途、版本与边界

编辑器确定地形、河流、对象布局、逻辑格心、辖区与初始势力；游戏项目按照协议读取和配置，自行替换模型、贴图、材质及调整游戏内容。格式唯一来源为本文及关联字段契约。旧版“正式包强制复刻编辑器材质、附带导入器／SDK／Effect”的要求被本次用户确认的范围替代。

`packageKind=map3d-engine-export`，整数 `exportVersion=2`。source 记录工程格式／生成器版本，algorithms 分别记录 terrainSampling、grassGenerator、waterGeometry、waterFlow，当前均为 1。adapter 记录目标及适配器版本；当前只注册 `cocos-creator-3.8`。通用字段不包含 Cocos UUID、Prefab 路径或引擎类；Unity、Godot 不提供占位导出。

工程 `.map3d` 与导出包分开：前者保存可继续编辑的数据和历史所需语义，当前仍为 v3；后者是已提交快照，不是工程备份，不包含编辑历史。旧 `cocos-map-export/exportVersion=1` 应从原工程重新导出，不猜测迁移。编辑器工程 v1～v3 的兼容不变。

不自动创建游戏场景或地图 Prefab，不管理游戏资源覆盖、重新导入或双向同步。内置原始模型与编辑器显示不因导出而改变。

## 2. 文件与清单

```text
manifest.json                    唯一入口，版本、坐标、地图、开关、入口及文件清单
report.json                      本次包检查报告
terrain/terrain.json              地形文件及参考材质入口
terrain/terrain.glb               一个连续参考地面 Mesh
terrain/final.f32                 含河床的最终高度唯一权威数组
terrain/surface.rgba              四层地表权重唯一数组
terrain/height16.png              最终高度的 PNG16 量化交换副本
terrain/height16.terrain.json      高度图尺寸、方向、原点与范围
models/index.json                逻辑资源 ID、类别、尺寸、来源、资源与材质路径
models/<sha256>.glb              原始模型，或据点水平锚点修正后的模型
materials/models/<sha256>.json   模型 glTF 材质及独立贴图索引
textures/<sha256>.png|webp|jpg    独立贴图，保持原编码并按内容去重
materials/surface.json           地表参考纹理、尺度、细节及坡度参数
materials/water.json             水面参考纹理、颜色及动画参数
instances/trees.json             有效树实例与合成后的变换
instances/sites.json             据点视觉实例与合成后的变换
logic/logic.json                 据点、势力及 owners 引用
logic/owners.u32                 逐格据点归属唯一数组
water/rivers.json                河流元数据唯一文件
water/water.json                 参考网格及逐顶点数据入口
water/water.glb                  裁切、交汇去重后的参考水面
water/<primitive>-*.f32          水深、岸距与 XZ 流向
grass/layers.json               草层、密度引用和生成参数
grass/<layerId>.f32              草密度数组
grass/exclusions.json            据点排除足迹及河流引用
protocol/engine-export-v2.schema.json 字段契约
README.md                        游戏接入说明
examples/read-map.mjs            独立 Node.js 读取示例
examples/package.json            示例依赖声明
```

JSON 字段以 Schema 为准。manifest 的 entries 中 terrain、models 必需；trees／sites／grass／water／logic 关闭时对应入口为 null，开启但没有内容时保存合法空数组／描述。data、resource、diagnostic、tooling 四种 purpose 表达文件用途；不通过扫描目录推测入口，不因包内容自动执行脚本。

files 包含 path、purpose、mediaType、byteLength、sha256；裸数组附 binary 描述，图片附 image 描述。manifest 不列入自身清单，report 必须列入。报告 counts.files 为全部清单项数；listedBytes 为清单文件的字节总和但排除 report 自身，不包含 manifest、ZIP 压缩开销。

所有路径均为 ASCII 包根相对路径，使用 `/`，区分大小写；禁止绝对路径、盘符、URL、空段、`.`／`..`、反斜线、符号链接、Windows 保留设备名、尾点和大小写冲突。所有生成文件除 manifest 外必须列入清单，引用必须存在。ID 表示逻辑身份，SHA-256 表示输出内容；据点锚点处理后按实际输出字节重新计算哈希。

预算：ZIP ≤256 MiB，解压文件及 manifest 合计 ≤512 MiB，清单 ≤10000 项，单文件 ≤128 MiB，单 JSON ≤16 MiB。图片每边 ≤4096、单图编码 ≤16 MiB、单图按 RGBA8 估算解码 ≤64 MiB、合计 ≤256 MiB；逻辑格 ≤1048576。预算是输入保护，不是对应规模的性能承诺。

JSON 为 UTF-8，无 BOM，不含重复键和非有限值。Float32／Uint32 数组为 little endian，Uint8 为 none，按 row-major 排列。binary 的 dimensions 乘积等于 elementCount，实际字节数严格匹配。图片实际尺寸、通道及位深与 image 描述一致；参考图片支持灰度／RGB／RGBA PNG、JPEG 和 WebP，地表仍为 RGB／RGBA8，PNG16 高度为单灰度通道。

## 3. 坐标、地形与布局

右手系，Y 向上，XZ 为地图平面，单位米，水平中心 `(0,0)`；yaw 为绕 +Y 的弧度。图片向右为 +X，向下为 +Z；采样数 n 为 513 或 1025，samplesX=samplesZ，矩形地图由 width／depth 表达。

采样 `(row,col)` 对应 `x=(col/(n-1)-0.5)*width`、`z=(row/(n-1)-0.5)*depth`、`y=final[row*n+col]`。每格三角形 `[i,i+n,i+1]`、`[i+1,i+n,i+n+1]`，从上方看逆时针。查询高度使用同一对角线的三角面插值，不能用双线性替代。GLB 的 UV 为 `(col/(n-1),1-row/(n-1))`。地面始终一个连续网格，不是六边形拼接地形。

final.f32 已包含河床，不再次雕河。PNG16 为非交错、colorType=0、bitDepth=16；编码 `round((h-minHeight)/(maxHeight-minHeight)*65535)`，超界拒绝。JSON 参数包含宽长、采样、范围、原点 `[-width/2,0,-depth/2]`、方向及 includesRiverbed=true。量化副本与权威高度的误差不超过半量化步长加浮点舍入。

实例只保存 id、assetId、position:[x,y,z]、yaw、正统一 scale。变换已合成：`yaw=instance.yaw+asset.yaw`、`scale=instance.scale*asset.scale`、`position.y=sampleHeight(final,x,z)+asset.offset*instance.scale`。树使用自身 XZ，据点从逻辑格心换算。消费者采用 `T*Ry*S`，不再次应用默认参数。

城池／要塞 GLB 增加一个水平包围盒中心归零的包装节点，不改顶点、贴图或原垂直原点。其他模型沿用原始字节；不导出编辑器 LOD、临时显示开关、相机或辅助图形。

models/index 的 id 是游戏关联资源的键，与文件哈希和 Prefab 无关。material 指向 kind=reference-model-pbr、version=1 的参考 JSON：materials 保留 glTF 材质字段，textures 按 glTF 纹理索引列出 path 和 sampler。独立贴图与 GLB 内嵌贴图同时存在，前者供游戏编辑替换，后者保证 GLB 自包含；编辑参考 JSON 不会自动回写 GLB。

## 4. 初始逻辑、草与水

逻辑格采用轴坐标 `{q,r}`，列为 `q+floor(r/2)`，索引为 `r*columns+col`；世界中心 `x=originX+sqrt(3)*radius*(q+r/2)`、`z=originZ+1.5*radius*r`。Site、Faction、树、草层及河流 ID 为正 Uint32，0 表示无归属。

logic.json 保存 Site 的 id／kind／name／assetId／center／factionId，Faction 的 id／name／color，以及 owners 文件引用。owners.u32 长度为 rows×columns，非零值引用存在的 Site，中心受保护且互不重叠，完全在地图外的格无归属。初始势力由 Site.factionId 派生，null 为未分配，不另存逐格势力副本。

树只导出坡度、水域和据点避让后有效的实例，不删除工程原记录；资源集合按实际输出引用收集。关闭据点视觉但开启逻辑时，所需模型可仅有描述，included=false、path=null、material=null，不附 GLB。

草层包含稳定 ID、assetId、密度文件、Uint32 seed、generatorVersion=1、minScale／maxScale／maxSlope／wind 和 modelTransform（模型默认 yaw／scale／offset）。密度维度 `[n,n]`、范围 0～20。生成规则仍为 0.5 米世界格、既有 hashRandom、密度最近采样、抖动、缩放和避让；身份由 `(layerId,cellX,cellZ)` 表达，旧 32 位 id 仅为排序键。wind 是给游戏参考的参数，不声明随包提供风动 shader 或运行时生成器。

exclusions 独立保存所有据点的最终世界 center:[x,z]、halfX／halfZ（含 2 米外扩）和最终 yaw，并引用唯一 rivers 文件。只导出草时也保留这些依赖，即使关闭据点、水面或逻辑显示内容。

rivers.json 保存稳定 ID、名称、控制点、宽深、水位、显式 interpolation 和 clipped。water.json 引用 GLB、材质及 primitives；各 primitive 的 nodeName／meshIndex／primitiveIndex／vertexCount 与 GLB 对应。depth `[N]`、shore `[N]`、flow `[N,2]` 按 POSITION 原始顺序，分别为非负水深、岸距米和世界 XZ 流向，不要求流向为单位向量。水面复用裁切、同水位并集与 4 米细分；无河流时 mesh=null、primitives=[]，不创建空二进制。

地表参考材质保存四层顺序 grass／soil／rock／sand、meters、颜色／法线纹理、scale／detail／slopeRock 和 sampler。颜色引用为 srgb，法线／遮罩为 linear，同一图片可按用途采用不同采样语义。水面参数保存颜色、roughness／opacity／metalness、flowSpeed=0.8、phaseSeconds=12。游戏自行决定 shader、光照、阴影和动画，不以这些参考描述承诺效果一致。

## 5. 检查、模式和读取示例

options 默认全部内容开启、target=cocos-creator-3.8、mode=production；preview 仅保留协议兼容 API，当前两种模式都必须输出完整且通过检查的所选数据，UI 使用默认正式模式。缺少地形／资源／逻辑数据不能以预览为由忽略。

requiredCapabilities 表达数据读取语义：至少 continuous-terrain@1，实际包含模型增加 static-model-pbr@1，有草层增加 grass-generator@1，有逻辑增加 hex-owners@1。既有 surface-four-layer／river-water／grass-wind 名称保留字段契约，但当前不作为强制引擎效果能力。当前完整包 omissions=[]；参考表现边界写入 report 的 I_REFERENCE_ASSETS 信息。

包检查覆盖 Schema、路径、文件长度与哈希、数组维度及值域、图片、PNG16 高度一致性、连续地面坐标、资源引用、格心与 owner、势力、草依赖和水面逐顶点引用。结构或数据失败抛出带定位的 E_SCHEMA／E_PATH／E_HASH／E_ARRAY／E_REFERENCE／E_CENTER_OWNER／E_BUDGET／E_CAPABILITY／E_TARGET，不生成可下载 ZIP，不修改地图和历史。

report 的 validation 三阶段独立记录：package=passed、import=not-run、engine=not-run。真实引擎验证由游戏项目或独立夹具完成，网页不能预填通过。

包内 examples/read-map.mjs 为独立 Node.js 22.12+ 示例，仅依赖 Ajv 8.17.1 和 Node 内置模块；安装 examples/package.json 的依赖后运行。它检查清单文件及字段，读取数组，并示范 getHeight、getCellOwner、getCellFaction。游戏接入需将 Node 文件读取替换为自己的资源加载方式；不提供游戏运行组件、专用配置界面、资源覆盖系统或场景生成器。包字段样例不是完整可导入包，实际测试产物在 test-results 下。
