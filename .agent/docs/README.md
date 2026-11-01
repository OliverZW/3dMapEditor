# 3D 地图编辑器 · 项目资料索引

本索引汇总当前有效资料。编辑器能力、地图作品和测试样例分别表达；测试场景不是正式地图作品。

## 当前状态

- Windows x64 便携版构建位于 `dist/mapEdtor-v<版本号>/`；构建与验证见[实施记录](implementation.md)。
- 浏览器编辑器支持地形、地表、模型、树草、河流、据点、辖区、势力、撤销和工程保存；运行方法、实际验证及剩余差距见[实施记录](implementation.md)。
- 当前源码已提供 v4 自包含备份、`.map3dproj` 目录工程、Electron 首页、自定义模型和地表材质，以及 Windows 便携版构建；不兼容旧包，见[地图工程规范](map-project-format.md)和[实施记录](implementation.md)。
- 运行导出采用引擎数据协议 v2，游戏负责读取与呈现；真实 Cocos Creator 导入、材质和运行性能尚未验收。详见[导出协议](engine-export-spec.md)与[Cocos 适配](cocos-export.md)。
- 完整地图性能和成品美术质量尚未验收；测试数据与限制见[实施记录](implementation.md)和[渲染优化](render-optimization.md)。

## 按主题查阅

| 主题 | 资料与职责 |
| --- | --- |
| 任务判断 | [编辑器与地图制作边界](../rules/editor-map-boundary.md)：区分软件能力、地图内容、共享资源与测试交付。 |
| 开发约束 | [架构规则](../rules/architecture.md)、[代码规范](../rules/code-style.md)、[整体风格](../rules/visual-style.md)、[Git 提交规则](../rules/git-workflow.md)：长期适用的约束。 |
| 功能目标 | [需求与验收](requirements.md)：已确认需求、参数与验收场景，待实现目标明确标注。 |
| 新版本计划 | [分步实施计划](new-version-plan.md)：七个固定步骤及依赖、交付物和验收条件；实际完成范围见实施记录。 |
| 桌面开发 | [Windows 桌面开发](desktop-development.md)：Electron 启动、原生工程操作、进程边界和便携版构建验证。 |
| 实现设计 | [技术设计](technical-design.md)：模块、数据、算法及资源生命周期。 |
| 操作设计 | [界面与操作](interaction.md)：布局、流程、输入与反馈。 |
| 版本记录 | [发布记录](RELEASE_NOTES.txt)：版本变更。 |
| 实际状态 | [当前实现与验证](implementation.md)：能力、测试条件、结论与差距；[渲染优化](render-optimization.md)保存独立性能矩阵及候选取舍。 |
| 目录职责 | [工程目录与职责](project-directory-guide.md)：源码、制作源文件、运行资源与产物的归属。 |
| 工程文件 | [地图工程规范](map-project-format.md)：目录工程、资源引用、v4 备份与存储适配契约；实际平台接入状态见实施记录。 |
| 引擎数据 | [通用协议 v2](engine-export-spec.md)是格式唯一来源，附[JSON Schema](contracts/engine-export-v2.schema.json)和[字段样例](contracts/engine-export-v2.example.json)；[Cocos 接入](cocos-export.md)说明目标差异，[对齐清单](engine-export-alignment.md)说明实现与验收边界。 |

## 设计参考

[浮层外观参考](screenshots/editor-main.png)用于确认深色样式，实际布局与操作以[界面与操作](interaction.md)为准。测试条件和文字结论见[实施记录](implementation.md)及[渲染优化](render-optimization.md)。

## 维护约定

`.agent/rules/` 保存项目通用规则；需求、设计和验收资料保存在 `.agent/docs/`。新增、删除或移动资料时同步本索引及受影响的引用。实际实现与设计目标、历史兼容和未验收事项应明确区分。
