# 当前工程目录与职责说明

检查日期：2026-10-25。工程：`F:\cocosProject\3dMapEditor`。

本说明记录当前实际目录，帮助先理解、再讨论系统划分。已按职责重命名内置资源、引擎适配与开发工具三个目录，并同步加载、导出和开发命令；具体迁移映射见下文。此次属于编辑器工程维护，不涉及地图制作或渲染效果调整。

## 1. 先区分软件与作品

**编辑器是制作地图的软件；地图是用软件保存出来的作品。** 编辑器提供画刷、材质混合、模型导入、河流、据点、历史、保存和导出。某张地图的山脉、河道、地表分布、城池位置及纹理尺度等，是地图内容。

- 做出可用的“地表材质”工具，是编辑器开发；用这个工具把一张地图画好，是地图制作。
- 现有地形画刷已经能手工塑造山脊和谷地；还没有正式制作这些内容的示例地图，不能直接说明工具做不到。
- 当前地图纹理尺度、细节强度和坡度显岩已经是可保存参数，调节它们是地图制作。若要增加每层独立调色、可编辑灯光或自动侵蚀算法，则需要先开发编辑器能力。
- 当前灯光、曝光和色调映射仍写在渲染代码里，界面没有地图灯光参数；现在修改这些常量会改变编辑器显示行为，不能称为只调整某张地图。
- 更换内置公共贴图是共享资源维护；选择已有贴图并设置某张地图的尺度是地图制作。两者影响范围不同。

通用准则以 [编辑器与地图制作边界](../rules/editor-map-boundary.md) 为准，本说明负责解释当前工程事实。

## 2. 根目录：每个目录放什么

```text
3dMapEditor/
├─ AGENTS.md                  AI 工作入口，指向规则与资料索引
├─ README.md                  人使用的启动、基本操作和交付边界说明
├─ .agent/
│  ├─ rules/                  项目长期适用的开发规则
│  └─ docs/                   需求、设计、实施记录、目录说明
│     └─ screenshots/         浮层外观设计参考
├─ src/                       编辑器应用的源码，另混有示例与生成数据
├─ editor-assets/             地图内置素材唯一来源、分类清单和来源记录
│  ├─ favicon.svg             应用图标
│  ├─ models/                 八个内置 GLB、元数据及 manifest.json
│  ├─ surface/                默认地表 PNG、缩略图及来源记录
│  └─ water/                  内置水纹法线、碎纹遮罩及来源记录
├─ engine-adapters/
│  └─ cocos/                  游戏接入说明及独立读取示例
├─ dev-tools/                 开发检查与资源加工脚本
├─ tests/                     测试代码、测试初始化和场景生成脚本
├─ test-results/              执行测试生成的地图包、导出包、报告和截图
├─ dist/                      生产构建输出，供预览或部署使用
├─ node_modules/              npm 安装的第三方依赖
├─ package.json               依赖声明与运行命令
├─ package-lock.json          依赖版本锁定文件
├─ index.html                 网页入口，挂载应用
├─ tsconfig.json              TypeScript 严格检查配置
├─ tsconfig.tsbuildinfo       TypeScript 增量检查缓存
├─ vite.config.ts             指定 editor-assets 静态资源目录
├─ vitest.config.ts           单元测试初始化与超时配置
├─ .prettierrc.json           源码格式约定
├─ .gitignore                 忽略依赖、构建、测试输出和缓存的约定
├─ 启动编辑器.cmd             Windows 双击启动入口
└─ start-editor.ps1           选择已有 Node 运行时并启动本地服务
```

根目录目前没有独立的正式地图作品目录；不能把 `test-results` 当作作品库。浏览器下载的 `.map3d` 实际存放位置由下载设置决定，未必在这个工程目录中。

后续地图作品采用用户选择位置的独立工程文件夹，不放入编辑器源码或安装目录；目录及 `.map3dproj` 专属入口已由[地图工程规范](map-project-format.md)确定，尚未实现，也未迁移现有地图。下文继续描述当前运行事实。

### 已完成的目录命名迁移

2026-10-24：`public/` 改为 `editor-assets/`，表达编辑器自带资源；`integrations/cocos/` 改为 `engine-adapters/cocos/`，表达引擎适配；`scripts/` 改为 `dev-tools/`，表达开发工具。原目录已整体移动，不保留重复副本。

Vite 的 `publicDir` 已显式指向 `editor-assets`，网页资源 URL 仍沿用 `/surface/` 等原路径；Cocos 导出读取新源码目录，ZIP 中仍使用 `cocos/` 和 `assets/runtime/`。开发命令名称保持原约定，执行路径改为 `dev-tools/`。详细约定见[技术设计](technical-design.md)的目录职责说明。

### 哪些是长期资料，哪些是执行产物

- **长期维护**：`src` 中的业务代码、`editor-assets` 中应用资源、`engine-adapters`、`dev-tools`、`tests`、规则、文档及根目录配置。正式地图作品应独立保存和备份；新的工程文件夹约定已确定、待实现，见[地图工程规范](map-project-format.md)。
- **运行后生成**：`dist`、`test-results`、`tsconfig.tsbuildinfo`。通常可以重新生成，但不能以目录名为由直接删除误存其中的人工成果。
- **安装后生成**：`node_modules`，由包声明与锁文件恢复；它的体积不等于本项目自己编写的代码体积。
- **脚本生成但目前位于源码范围**：地表默认描述、图片和测试图片编码。它们有被应用或测试引用，不能按“生成文件”直接删除。

本次只读扫描未发现当前目录或其父目录的 Git 仓库；`.gitignore` 的存在不表示源码和地图已获得版本备份。

## 3. src：编辑器内部怎样分层

正常的数据方向是：界面发起操作 → 应用层执行用例 → 核心文档与历史更新 → 渲染层读取结果。保存和导入由 IO 处理，浏览器下载和草稿存储由平台层适配。

### src/core：通用数据、算法与历史

这是“地图由什么数据构成、编辑计算怎么算”的部分，不依赖 React、Three.js 或浏览器文件接口。

- `types.ts`：地图文档、对象、资源、画刷等类型定义。地图本身通过 `MapDocument` 表达。
- `document.ts`：新文档初始化、内置模型元数据及文档校验。
- `terrain.ts`：高度查询、地形与地表画刷、河床合成等计算。
- `terrain-picking.ts`：射线与真实地形三角面的求交计算。
- `hex.ts`、`grid-coverage.ts`：六边形坐标、辖区、归属及地图网格覆盖。
- `map-bounds.ts`、`map-resize.ts`：地图边界、尺寸调整、重采样及内容裁剪。
- `river-mesh.ts`、`river-water.ts`：河流水面几何、交汇及重叠去重。
- `vegetation.ts`：树草分布、确定性生成及坡度／水域等过滤。
- `assets.ts`：模型资源引用统计。
- `history.ts`：地图修改快照、差异、撤销和重做。
- `surface-material.ts`：地表材质包的默认描述、复制与校验。
- `river-flow.ts`：控制点顺序派生的视觉流向采样与交汇混合；属于显示所用纯算法，不是河床开挖或水文模拟。
- 内置地表资源描述及默认米制尺度从 `editor-assets/surface/manifest.json` 引入；不在核心复制资源清单。
- `demo.ts`：启动时“山河初境”示例的高度、河流、对象与布局生成。**这是示例内容代码，不是地形编辑算法，也不是正式地图作品。**

### src/application：一次编辑操作如何完成

当前主要集中在 `editor-session.ts`：管理当前地图、活动工具、选择、笔触、预览、历史提交、尺寸调整和文档切换；协调核心计算与资源装配。

它是界面与地图数据之间的操作入口。目前仍是一个较大的会话类；是否按地形、河流、据点、资源等用例拆分，属于后续编辑器架构整理，不属于地图制作。

### src/renderer：地图如何显示与拾取

- `editor-viewport.ts`：Three.js 场景、地面网格、灯光、阴影、对象重建、鼠标拾取和渲染循环。
- `surface-material.ts`：地表权重纹理、三向贴图混合、细节法线及 GPU 纹理生命周期。
- `water-surface.ts`、`water-material.ts`：水面显示几何、水深与流向属性、分层水纹与变化反光，以及视口共享资源的加载和释放。
- `models.ts`：统一 GLB 解析、导入与渲染缓存；不再运行时构造内置模型。
- `camera-rig.ts`、`camera-navigation.ts`：相机数学、投影与导航输入。
- `logic-overlay.ts`、`resize-overlay.ts`：辖区、格线和尺寸预览的显示。
- `site-transform.ts`：据点模型的居中、缩放、朝向与贴地变换。

这一层提供显示能力，不保存另一套独立地图。当前光照常量也位于这里；其存在不等于已经向地图作者开放了灯光编辑工具。

### src/ui：用户看到和操作的界面

- `App.tsx`：整体布局、菜单、文件流程与弹窗组合，是当前较大的界面入口。
- `BrushPalette.tsx`、`SurfaceInspector.tsx`：地形／地表模式及材质参数。
- `VegetationPalette.tsx`、`VegetationModes.tsx`：植被资源选择与刷入／擦除方式。
- `SiteInspector.tsx`、`RiverInspector.tsx`、`FactionInspector.tsx`：据点、河流、势力属性。
- `MapOverview.tsx`：地图概览与尺寸输入；`InspectorActions.tsx`：固定编辑操作区。
- `AssetPreview.tsx`、`ModelDetails.tsx`：资源三维预览和详情。
- `ViewportToolbar.tsx`、`OrientationGizmo.tsx`、`InputHints.tsx`：视口图层、方向坐标系及操作提示。
- `VirtualList.tsx`、`virtual-range.ts`：资源列表的可见范围与虚拟滚动。
- `controls.tsx`、`styles.css`：共用控件与样式；`OperationGuide.tsx`：应用内操作指南。

### src/io：工程格式与资源编解码

- `project.ts`：自包含 `.map3d` 工程的 ZIP 保存、打开、校验及旧版本迁移；当前版本为 v3。
- `heightmap.ts`：高度 PNG 的读写及方向、高程参数。
- `glb-validation.ts`：外来静态 GLB 的结构约束。
- `surface-resources.ts`、`image-validation.ts`：地表图片装配、内容哈希、PNG 校验及资源预算。
- `export-adapter.ts`：引擎无关的导出快照与适配器注册。
- `cocos-export.ts`：生成 v2 地图数据与参考资源包；`engine-export-*` 负责文件、字段、字节和引用校验，`engine-glb.ts` 直接编码标准参考几何。
- `builtin-resources.ts`：模型、地表、水面与缩略图的分类清单读取、文件校验、base URL、不可变字节共享及模型装配。原 `generated/surface-bytes.json` 已删除，测试直接读取 editor-assets。

### src/platform：浏览器能力适配

当前是 `files.ts`：文件选择、下载，以及 IndexedDB 草稿保存与恢复。草稿在浏览器数据库中，不是磁盘上的某个源码文件；不能替代用户正式保存的 `.map3d` 工程。

### src 根部

`main.tsx` 先装配默认地表资源，再挂载 React 应用；`vite-env.d.ts` 提供构建环境类型。当前是浏览器编辑器，项目名称和导出目标不表示应用运行在 Cocos Creator 内部。

## 4. 素材、地图、样例和测试之间的关系

### 当前地图数据实际保存在哪里

- 正在编辑的内容位于会话中的 `MapDocument`：基础高度、地表权重、材质与显示参数、植被、河流、据点、势力和逻辑归属。
- 用户点击保存，生成独立的 `.map3d` 包，包含可继续编辑的数据和内嵌资源。它是地图作品的主要交付物。
- 浏览器草稿是恢复副本；高度 PNG 只表达地形高程，不能替代完整地图；Cocos ZIP 是运行资源导出，也不能替代编辑工程。
- 当前 `test-results/*.map3d` 都应先按测试输出识别，不自动视为用户正式制作完成的地图。

### 当前地表资源加工链

```text
工程外已有的 sanguo 研究图集（只读）
    → dev-tools/prepare-surface.py
    → editor-assets/surface/           页面加载的 PNG、缩略图与来源记录
    → editor-assets/surface/manifest.json
                                      应用与测试共用的资源描述与实际 PNG

页面默认资源或工程内嵌 PNG
    → 当前地图文档的材质包
    → 保存进这张地图的 .map3d 工程
```

这里的默认资源加工是编辑器内置资源维护，不是雕刻或绘制某张地图。外部 `sanguo` 目录不是运行依赖；只有重新加工这套研究素材时才需要原图集。本轮资源仅按已确认的本机研究范围使用。

### 三种容易混淆的“样例”

- `src/core/demo.ts`：用于打开应用时展示功能，属于内置启动示例。
- `tests/surface-fixture.cjs`：直接构造高度和权重数据的固定渲染测试场景，属于测试代码。它证明测试条件下的显示效果，不证明用户已经通过界面完成了一张地图。
- `test-results` 中的截图和工程：测试运行留下的证据与中间输出。这些文件不会因此自动升级为正式作品。

引擎导出当前采用[通用 v2 数据协议](engine-export-spec.md)，实际实现与验收见[对齐清单](engine-export-alignment.md)。包中以 manifest 的 entries／files 为入口，不存在 assets 与包根的重复数组，包结构与源码目录分别维护。

### 游戏接入参考目录

`engine-adapters/cocos/README.md` 保存随包说明，`examples/` 保存独立 Node.js 读取示例及其依赖声明。旧 extension 场景生成脚本和 runtime 查询组件已删除。此目录不包含游戏项目、资源覆盖系统或经过验收的 Creator 工程；游戏自行读取地图、配置和替换资源。

## 5. 目录为什么看起来大

以下为本次补充文档前的只读扫描，单位 MiB；后续运行测试、构建或归档会变化。

- `node_modules`：约 183.04 MiB，第三方依赖。
- `test-results`：约 145.95 MiB，重复生成的地图包、引擎包、截图和报告。
- `.agent`：规则、设计资料和实现记录；体积会随资料整理而变化。
- `src` 不再包含图片 Base64 副本；内置模型、贴图和清单只在 editor-assets 维护。
- `dist`、测试工程包和 Cocos ZIP 是构建或导出副本，可以包含同一素材，不是第二个素材来源。
- dev-tools/model-previews 是模型制作与预览工程；应用不从其中加载素材。

## 6. 下一轮系统划分前要决定什么

以下分别标明已确定规范、已落实事项和仍待讨论的整理点；未实施的目录迁移不能当作当前事实。

1. **地图工程结构（规范已确定、待实现）**：采用独立文件夹、`.map3dproj` 入口、共享内置素材及自包含备份，见[地图工程规范](map-project-format.md)。正式作品、教学样板和验收地图的集中作品库分类仍待讨论；本轮未创建作品库或迁移地图。
2. **示例内容与核心算法的边界**：将启动示例独立管理，避免 `demo.ts` 被误认为通用地形能力；是否改为独立地图工程需要另定加载和测试方式。
3. **应用资源与测试夹具的边界（已落实）**：测试直接读取 editor-assets 实际素材，源码图片副本已删除；固定测试场景仍由 tests 管理。
4. **文档与证据的边界**：规则保持简短稳定，需求和设计维护当前约定，实现记录与设计参考分别清晰标注，避免每轮“本轮”描述被误认为当前状态。
5. **业务模块与大入口的边界**：保留核心／应用／渲染／IO／平台／UI 的职责，再评估 `App.tsx`、`editor-session.ts` 和视口入口应如何按用例拆分；不能只按文件长度机械切开。
6. **可重建产物的处理**：确定 `test-results` 的清理与证据归档规则，区分构建输出、缓存、可复现资源和不可丢失的人工地图作品，再安排迁移或清理。

后续整理应先选定目标分类，再一次处理相关引用、加载路径、生成脚本、测试和文档。当前目录名称本身不构成删除、搬移或改变地图内容的依据。
