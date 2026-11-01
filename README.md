# 山河 · 三维战略地图编辑器

山河是基于 Three.js、React 和 TypeScript 的三维战略地图编辑器，支持 Windows Electron 桌面运行，以浏览器作为默认开发入口。它将连续高度场地形与六边形逻辑网格结合，用于制作包含地貌、植被、河流、据点和势力范围的地图，也可作为定制地图编辑器的开发基础。

## 主要功能

- **地形与地表**：创建不同尺寸的地图，雕刻高度、涂刷草地／泥土／岩石／沙地，调整材质尺度与细节，导入和导出高度图。
- **模型资源**：导入静态 GLB 时预览并确认名称、分类和基础变换；可替换已放置对象的模型并查看资源引用。
- **树木与草丛**：按密度、缩放和坡度等条件刷入或擦除植被。
- **河流与水面**：编辑河道控制点、宽深和水位，支持河流交汇及动态水面显示。
- **据点与势力**：放置城池和要塞，绘制六边形辖区，设置势力归属与派生范围。
- **编辑与保存**：透视／正交视图、图层显示、撤销重做、`.map3dproj` 目录工程及自包含 v4 `.map3d` 备份恢复。
- **游戏数据导出**：以通用 v2 协议导出地形、对象实例、归属及参考资源，附 Cocos 接入说明和独立读取示例，供游戏自行加载与呈现。

## 构建自己的编辑器

准备 Node.js 22.12 或更高版本。在工程根目录执行：

```sh
npm ci
```

双击 `启动编辑器.cmd`，启动本机 Vite 服务并在浏览器打开开发版。桌面开发可使用 `npm run dev:desktop`，详见[Windows 桌面开发](.agent/docs/desktop-development.md)。

检查代码及运行桌面回归：

```sh
npm test
npm run check:unused
npm run test:desktop
```

目前完整测试中有一项既有 LOD 素材面数阈值未通过，具体记录见[实施记录](.agent/docs/implementation.md)。

在 Windows x64 运行 `构建.cmd` 或 `npm run build`，生成 `dist/mapEdtor-v<版本号>`。将整个文件夹复制到目标电脑，双击 `ShanheMapEditor.exe`。应用需要 Windows 10 或更新的 x64 系统，无需安装 Node.js。便携版不注册开始菜单或文件关联，用户工程与应用配置保留在原位置。应用无自动更新和签名。

现有素材已由用户确认可在目标电脑使用；公开分发前仍需确认素材分发授权。

发布新版本前，同步更新 `package.json`、`package-lock.json` 的版本及 `.agent/docs/RELEASE_NOTES.txt`，记录日期和实际变更并保留旧条目，再运行 `npm run build`。

## 定制入口

| 定制内容 | 代码或资源位置 |
| --- | --- |
| 界面、工具面板和样式 | `src/ui/` |
| 地图数据、坐标、地形算法和命令历史 | `src/core/` |
| 编辑流程、工具状态和用例协调 | `src/application/` |
| 三维显示、材质、镜头和拾取 | `src/renderer/` |
| 工程格式、资源读写和导出适配 | `src/io/` |
| 平台文件操作、桌面桥接与浏览器草稿 | `src/platform/` |
| Electron 主进程、preload 和原生目录适配 | `desktop/` |
| 内置模型、贴图和分类清单 | `editor-assets/` |
| 启动示例地图 | `src/core/demo.ts` |
| Cocos 数据接入说明和读取示例 | `engine-adapters/cocos/` |

新增编辑能力时，由界面调用应用层，再更新核心地图数据并由渲染层显示。更换内置资源需同步对应分类清单；新增导出目标可基于 `src/io/export-adapter.ts` 定义的接口注册适配器。

## 进一步阅读

- [项目资料索引](.agent/docs/README.md)：需求、设计、操作说明及实现状态。
- [发布记录](.agent/docs/RELEASE_NOTES.txt)：各版本的更新内容。

公开分发前需确认内置地表和水面素材的分发授权。
