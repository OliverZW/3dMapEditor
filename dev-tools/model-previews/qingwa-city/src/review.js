// Inspect actual content screenshots and task-specific behavior before passing this review.
// Content changes invalidate old evidence: return to pending and recheck affected states.
// Evidence identifies real screenshots/check results; it is not an aesthetic score from the SDK.
export const review = {
  status: 'pending',
  checks: [
    { name: 'GLB 结构、自包含资源与尺寸检查', status: 'passed', evidence: 'blender/validate_glb.py；两份交付 GLB 均通过' },
    { name: 'Blender 五视角内容检查', status: 'passed', evidence: 'docs/review/blender-main.png、blender-front.png、blender-rear.png、blender-roof.png、blender-corner.png' },
    { name: 'Edit3D 浏览器初始化、材质编辑与镜头播放', status: 'unverified', evidence: '完整环境与最小启动场景均返回 SCENE_HANDSHAKE_TIMEOUT' },
  ],
  limitations: ['内置浏览器握手超时，尚未完成 Edit3D 宿主内的材质、交互和镜头验收。'],
}
