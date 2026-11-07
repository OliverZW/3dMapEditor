import type { EditorSession } from '../application/editor-session';

interface InspectorState {
  title: string;
  targetKey: string;
  showActions: boolean;
  showProperties: boolean;
  showModelHelp: boolean;
  message?: string;
}

export function inspectorState(session: EditorSession): InspectorState {
  const { doc, tool } = session;
  const ready = (
    title: string,
    id: string | number,
    actions = true,
    help = false,
  ): InspectorState => ({
    title,
    targetKey: `${tool}:${id}`,
    showActions: actions,
    showProperties: true,
    showModelHelp: help,
  });
  const empty = (message: string, actions = false): InspectorState => ({
    title: '工具属性',
    targetKey: `${tool}:empty:${message}`,
    showActions: actions,
    showProperties: false,
    showModelHelp: false,
    message,
  });
  switch (tool) {
    case 'overview':
      return ready('地图设置', 'map', false);
    case 'terrain':
      return ready('工具属性', session.brush.terrainMode, false);
    case 'surface': {
      const layer = doc.surfaceMaterial.layers[session.brush.surfaceLayer];
      return layer
        ? ready('地表属性', layer.id, false)
        : empty(
            doc.surfaceMaterial.layers.length
              ? '请从左侧选择地表。'
              : '暂无地表，请点击左侧“添加地表”创建地表。',
          );
    }
    case 'grass':
    case 'trees': {
      const trees = tool === 'trees';
      const layer = trees ? session.treeLayer : session.grassLayer;
      const label = trees ? '树木' : '草丛';
      if (!layer) return empty(`暂无${label}图层，请点击左侧“添加${label}”创建图层。`);
      if (trees && session.treeMode === 'select') {
        const instance = doc.trees.find((tree) => tree.id === session.selectedTree);
        return instance
          ? ready('树木属性', `instance:${instance.id}`)
          : empty(
              doc.trees.length
                ? '请在地图中选择树木实例。'
                : '暂无树木实例，请切换到“刷入”添加树木。',
              true,
            );
      }
      if (!session.brushAsset(trees ? 'tree' : 'grass'))
        return empty(`当前${label}图层的模型不可用，请从资源库替换模型。`);
      return ready(`${label}属性`, layer.id, true, true);
    }
    case 'river': {
      if (session.riverPreview) return ready('河流属性', `preview:${session.riverPreview.id}`);
      const river = doc.rivers.find((item) => item.id === session.selectedRiver);
      return river
        ? ready('河流属性', river.id)
        : empty(
            doc.rivers.length ? '请从左侧选择河流。' : '暂无河流，请点击左侧“新建河流”创建河流。',
          );
    }
    case 'sites': {
      if (session.sitePlacement || session.movingSite)
        return ready('据点属性', `preview:${session.siteMode}`);
      const site = doc.sites.find((item) => item.id === session.selectedSite);
      return site
        ? ready('据点属性', site.id)
        : empty(
            doc.sites.length
              ? '请点击地图中的据点模型，或从左侧据点列表选择。'
              : '暂无据点，请点击左侧“添加据点”创建据点。',
          );
    }
    case 'factions': {
      const faction = doc.factions.find((item) => item.id === session.selectedFaction);
      return faction
        ? ready('势力属性', faction.id)
        : empty(
            doc.factions.length ? '请从左侧选择势力。' : '暂无势力，请点击左侧“新增势力”创建势力。',
          );
    }
  }
}
