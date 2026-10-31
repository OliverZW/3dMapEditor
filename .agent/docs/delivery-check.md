# 当前交付检查

- 编辑器已提供基本编辑、工程保存和 v2 数据导出；实际实现、测试命令和条件见[实施记录](implementation.md)。
- [引擎导出协议](engine-export-spec.md)及[字段契约](contracts/engine-export-v2.schema.json)是导出格式依据；验收边界见[对齐清单](engine-export-alignment.md)。真实 Cocos 导入、材质和游戏运行尚未验收。
- 当前工程为 `.map3d` v3；文件夹工程、`.map3dproj` 和 v4 备份仍待实现，见[工程规范](map-project-format.md)。
- 完整地图流畅度与成品美术质量尚未验收；性能对照的场景和设备限制见[渲染优化](render-optimization.md)及实施记录。
