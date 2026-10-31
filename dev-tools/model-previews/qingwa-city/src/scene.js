import * as THREE from 'three'
import { enableToneMapping } from './environment/tonemap.js'
import { createSky } from './environment/sky.js'
import { createTerrain } from './environment/terrain.js'
import { createRocks } from './environment/rocks.js'
import { createGrass } from './environment/grass.js'
import { bindParams, excludeFromFraming, framingReport } from './kit/edit3d.js'

export async function createScene({ asset }) {
  enableToneMapping({ curve: 'aces' })
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(43, 1, 0.2, 60000)
  scene.add(camera)

  const params = { hour: 17.5, grassHeight: 0.55, dryness: 0.35 }
  const sky = createSky({ hour: params.hour, clouds: 0.28 })
  const sun = new THREE.DirectionalLight(0xffffff, 3)
  sun.name = '日光'
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -72, right: 72, top: 72, bottom: -72, near: 1, far: 1200 })
  sun.shadow.normalBias = 0.04
  scene.add(sun, sun.target)

  // Keep the inspection preview lightweight enough for software WebGL and remote desktops.
  const terrain = createTerrain({
    preset: 'hills',
    size: 400,
    resolution: 128,
    erosionResolution: 64,
    erosionIterations: 24,
    apron: 600,
    seed: 17,
    heightScale: 0.7,
    grassCover: true,
    pads: [{ x: 0, z: 0, width: 64, depth: 58, angle: 0 }],
  })
  const groundY = terrain.pads[0].y
  const grass = createGrass({
    heightTexture: terrain.heightTexture,
    bounds: terrain.bounds,
    height: params.grassHeight,
    density: 0.45,
    radius: 65,
    maxInstances: 200000,
    dryness: params.dryness,
    seed: 23,
  })
  terrain.setMeadowColor(grass.groundColor)
  const rocks = createRocks({
    heightAt: terrain.heightAt,
    mask: terrain.boulderAt,
    area: { x: 0, z: 0, radius: 100 },
    count: 24,
    sizeRange: [0.45, 2.8],
    detail: 3,
    seed: 29,
  })
  scene.add(terrain.mesh, grass.object, rocks.group)

  const model = await asset.loadModel('/models/qingwa-city.glb')
  const city = model.object
  city.position.set(0, groundY, 0)
  city.traverse((object) => {
    if (!object.isMesh) return
    object.castShadow = true
    object.receiveShadow = true
  })
  scene.add(city)

  camera.position.set(68, groundY + 50, 74)
  camera.lookAt(0, groundY + 5, 0)
  sun.target.position.set(0, groundY + 3, 0)
  sky.applyTo(scene, { sun })
  excludeFromFraming(terrain.mesh, grass.object, rocks.group, sky.object)

  asset.register('city', city, { name: '青瓦城池', type: 'building' })
  const groups = [
    ['city_walls', '城墙与城门', '城墙与城门'],
    ['city_towers', '角楼', '角楼'],
    ['city_buildings', '城内建筑', '城内建筑'],
    ['city_decor', '装饰与旗帜', '装饰与旗帜'],
  ]
  for (const [id, nodeName, label] of groups) {
    const object = city.getObjectByName(nodeName)
    if (object) asset.register(id, object, { name: label, parent: 'city' })
  }
  asset.register('camera_main', camera, { name: '主相机' })
  asset.register('sky', sky.object, { name: '山地天空' })
  asset.register('sun', sun, { name: '傍晚日光' })
  asset.register('terrain', terrain.mesh, { name: '预览山地' })
  asset.register('grass', grass.object, { name: '预览草甸' })
  asset.register('rocks', rocks.group, { name: '预览岩石' })

  const offParams = bindParams(asset, 'environment', params, {
    hour: { type: 'number', label: '日照时间', min: 6, max: 20, step: 0.05 },
    grassHeight: { type: 'number', label: '草高（米）', min: 0.15, max: 1.2, step: 0.05 },
    dryness: { type: 'number', label: '草木枯黄度', min: 0, max: 1, step: 0.05 },
  }, (value) => {
    sky.setHour(value.hour)
    grass.set({ height: value.grassHeight, dryness: value.dryness })
    terrain.setMeadowColor(grass.groundColor)
  }, { name: '预览环境', objectId: 'sky' })

  const tick = (time) => {
    terrain.update(time)
    grass.update(time)
    sky.update(time)
  }
  asset.registerAnimation('environment_motion', {
    name: '山风与天空',
    objectId: 'grass',
    duration: 60,
    sample: tick,
  })
  asset.registerShot('city_overview', {
    camera: 'camera_main',
    duration: 6,
    keyframes: [
      { time: 0, position: [68, groundY + 50, 74], lookAt: [0, groundY + 5, 0] },
      { time: 6, position: [52, groundY + 38, 62], lookAt: [0, groundY + 5, 0] },
    ],
  })
  asset.registerShot('city_gate', {
    camera: 'camera_main',
    duration: 5,
    keyframes: [
      { time: 0, position: [18, groundY + 17, 48], lookAt: [0, groundY + 6, 17] },
      { time: 5, position: [0, groundY + 11, 39], lookAt: [0, groundY + 6, 18] },
    ],
  })
  asset.registerShot('city_roofs', {
    camera: 'camera_main',
    duration: 6,
    keyframes: [
      { time: 0, position: [-38, groundY + 35, 45], lookAt: [0, groundY + 5, 0] },
      { time: 6, position: [-48, groundY + 42, -32], lookAt: [0, groundY + 5, 0] },
    ],
  })
  asset.registerTrack('shots', {
    clips: [
      { shotId: 'city_overview', start: 0 },
      { shotId: 'city_gate', start: 6 },
      { shotId: 'city_roofs', start: 11 },
    ],
  })
  tick(0)
  const framing = framingReport(scene, city)
  scene.userData.framing = framing
  scene.userData.groundY = groundY

  return {
    scene,
    camera,
    dispose() {
      offParams()
      terrain.dispose()
      grass.dispose()
      rocks.dispose()
      const geometries = new Set()
      const materials = new Set()
      const textures = new Set()
      city.traverse((object) => {
        if (!object.isMesh) return
        geometries.add(object.geometry)
        for (const material of [object.material].flat()) {
          materials.add(material)
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value)
        }
      })
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
      textures.forEach((texture) => texture.dispose())
    },
  }
}
