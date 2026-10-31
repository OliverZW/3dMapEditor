# 3D 地图编辑器 · 项目资料索引

本索引汇总当前有效资料。编辑器能力、地图作品和测试样例分别表达；测试场景不是正式地图作品。

## 当前状态

- 浏览器编辑器支持地形、地表、模型、树草、河流、据点、辖区、势力、撤销和工程保存；运行方法、实际验证及剩余差距见[实施记录](implementation.md)。
- 当前 `.map3d` 工程为 v3；文件夹工程、`.map3dproj` 和自包含 v4 备份是已确定但尚未实现的目标，见[地图工程规范](map-project-format.md)。
- 运行导出采用引擎数据协议 v2，游戏负责读取与呈现；真实 Cocos Creator 导入、材质和运行性能尚未验收。详见[导出协议](engine-export-spec.md)与[Cocos 适配](cocos-export.md)。
- 完整地图性能和成品美术质量尚未验收；测试数据与限制见[实施记录](implementation.md)和[渲染优化](render-optimization.md)。

## 按主题查阅

- [编辑器与地图制作边界](../rules/editor-map-boundary.md) · [工程目录与职责](project-directory-guide.md)
- [需求与验收](requirements.md) · [技术设计](technical-design.md) · [界面与操作](interaction.md)
- [通用引擎导出协议 v2](engine-export-spec.md)（格式唯一来源） · [JSON Schema](contracts/engine-export-v2.schema.json) · [字段样例](contracts/engine-export-v2.example.json) · [实现对齐与验收](engine-export-alignment.md)
- [地图工程目录与专属文件规范](map-project-format.md) · [应用实施与验证](implementation.md) · [渲染性能优化](render-optimization.md) · [交付检查](delivery-check.md)
- [架构规则](../rules/architecture.md) · [代码规范](../rules/code-style.md) · [整体风格](../rules/visual-style.md)

## 设计参考

[浮层外观参考](screenshots/editor-main.png)用于确认深色样式，实际布局与操作以[界面与操作](interaction.md)为准。测试条件和文字结论见[实施记录](implementation.md)及[渲染优化](render-optimization.md)。

## 维护约定

`.agent/rules/` 保存项目通用规则；需求、设计和验收资料保存在 `.agent/docs/`。新增、删除或移动资料时同步本索引及受影响的引用。实际实现与设计目标、历史兼容和未验收事项应明确区分。
