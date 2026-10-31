import { createScene } from './scene.js'

export function createProject() {
  return {
    id: 'qingwa-city',
    name: '青瓦城池 · 内置模型预览',
    defaultSceneId: 'main',
    scenes: [{ id: 'main', name: '山地城池', createScene }],
  }
}
