/** 仅供显示派生结果失效使用，不进入地图文档或撤销历史。 */
export interface RenderBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}
export interface RenderInvalidation {
  documentVersion: number;
  revision: number;
  kind: 'all' | 'terrain' | 'surface' | 'instances' | 'material';
  bounds?: RenderBounds;
  models?: ('trees' | 'grass' | 'sites')[];
}
