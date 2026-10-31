import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { validators } from 'virtual:engine-export-validators';

const read = (name) =>
  JSON.parse(readFileSync(new URL('../.agent/docs/contracts/' + name, import.meta.url), 'utf8'));
const schema = read('engine-export-v2.schema.json');
const example = read('engine-export-v2.example.json');
const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
ajv.addSchema(schema);
const validateManifest = validators[''];
const validator = (name) => validators[name];
const manifest = () => structuredClone(example.manifest);
const switches = ['trees', 'grass', 'water', 'sites', 'logic'];

describe('引擎导出 v2 字段契约（不代替包字节与引擎校验）', () => {
  it('schema 自身合法，根样例及全部子文档符合契约', () => {
    expect(ajv.validateSchema(schema)).toBe(true);
    expect(validateManifest(example.manifest), JSON.stringify(validateManifest.errors)).toBe(true);
    expect(validateManifest(example.manifest)).toBe(ajv.getSchema(schema.$id)(example.manifest));
    for (const [name, document] of Object.entries(example.documents)) {
      const validate = validator(name);
      expect(validate, name).toBeTypeOf('function');
      expect(validate(document), name + ': ' + JSON.stringify(validate.errors)).toBe(true);
    }
  });

  for (const mode of ['production', 'preview']) {
    for (let mask = 0; mask < 32; mask++) {
      it(`${mode} 模式内容开关组合 ${mask} 及入口不一致拒绝`, () => {
        const value = manifest();
        value.options.mode = mode;
        value.omissions = [];
        switches.forEach((key, bit) => {
          value.options[key] = Boolean(mask & (1 << bit));
          value.entries[key] = value.options[key] ? `${key}/index.json` : null;
        });
        expect(validateManifest(value), JSON.stringify(validateManifest.errors)).toBe(true);
        for (const key of switches) {
          const broken = structuredClone(value);
          broken.entries[key] = broken.options[key] ? null : `${key}/index.json`;
          expect(validateManifest(broken), key).toBe(false);
        }
      });
    }
  }

  it.each([
    ['旧包类型', (value) => (value.packageKind = 'cocos-map-export')],
    ['旧导出版本', (value) => (value.exportVersion = 1)],
    ['未知导出版本', (value) => (value.exportVersion = 3)],
    ['字符串版本', (value) => (value.exportVersion = '2')],
    ['空目标标识', (value) => (value.options.target = '')],
    ['不合法适配器标识', (value) => (value.adapter.id = 'bad/adapter')],
    ['未知算法', (value) => (value.algorithms.grassGenerator = 2)],
    ['未知能力', (value) => value.requiredCapabilities.push('unknown@1')],
    ['缺少地形数据能力', (value) => (value.requiredCapabilities = ['static-model-pbr@1'])],
    ['重复能力', (value) => value.requiredCapabilities.push('continuous-terrain@1')],
    [
      '正式包包含降级',
      (value) => {
        value.options.mode = 'production';
        value.omissions = [
          { capability: 'surface-four-layer@1', reason: '旧模式回退', fallback: '基础色' },
        ];
      },
    ],
    ['假定引擎已验证', (value) => (value.validation.engine = 'verified')],
    ['假定导入已通过', (value) => (value.validation.import = 'passed')],
    ['大小写错误哈希', (value) => (value.files[0].sha256 = 'A'.repeat(64))],
    ['哈希长度错误', (value) => (value.files[0].sha256 = 'a'.repeat(63))],
    ['负字节数', (value) => (value.files[0].byteLength = -1)],
    ['单文件超预算', (value) => (value.files[0].byteLength = 128 * 1024 * 1024 + 1)],
    ['未知字段', (value) => (value.engineVerified = true)],
    ['缺少字段', (value) => delete value.coordinates],
    ['非正地图尺寸', (value) => (value.map.width = 0)],
    ['不同采样维度', (value) => (value.map.samplesZ = 1025)],
    ['未知采样数', (value) => (value.map.samplesX = value.map.samplesZ = 257)],
  ])('拒绝%s', (_, change) => {
    const value = manifest();
    change(value);
    expect(validateManifest(value)).toBe(false);
  });

  it('公共字段不绑定 Cocos，目标是否支持由注册器和目标导入器检查', () => {
    const value = manifest();
    value.options.target = 'example-engine-1';
    value.adapter.id = 'example-engine-1';
    value.adapter.engine = 'Example Engine 1';
    expect(validateManifest(value)).toBe(true);
  });

  it.each([
    '',
    '/terrain/final.f32',
    '../final.f32',
    'terrain/../final.f32',
    './manifest.json',
    'terrain/./final.f32',
    'C:/final.f32',
    'terrain\\final.f32',
    'https://host/file',
    'terrain//final.f32',
    'terrain/',
    'terrain/%2e%2e/file',
    'terrain/file?x=1',
    'terrain/final.f32\n',
    'terrain/final name.f32',
  ])('拒绝不合法的包根相对路径 %s', (path) => {
    const value = manifest();
    value.files[0].path = path;
    expect(validateManifest(value)).toBe(false);
    value.files[0].path = 'report.json';
    value.entries.terrain = path;
    expect(validateManifest(value)).toBe(false);
  });

  it('裸数组必须声明类型、维度、数量及正确字节序', () => {
    const validate = validator('file');
    const value = {
      path: 'terrain/final.f32',
      purpose: 'data',
      mediaType: 'application/octet-stream',
      byteLength: 513 * 513 * 4,
      sha256: 'a'.repeat(64),
      binary: {
        componentType: 'float32',
        byteOrder: 'little',
        dimensions: [513, 513],
        elementCount: 513 * 513,
      },
    };
    expect(validate(value)).toBe(true);
    for (const type of ['float32', 'uint32', 'uint8']) {
      value.binary.componentType = type;
      value.binary.byteOrder = type === 'uint8' ? 'none' : 'little';
      expect(validate(value)).toBe(true);
      value.binary.byteOrder = type === 'uint8' ? 'little' : 'none';
      expect(validate(value)).toBe(false);
    }
    const bad = structuredClone(value);
    delete bad.binary;
    expect(validate(bad)).toBe(false);
    value.binary.componentType = 'uint8';
    value.binary.byteOrder = 'none';
    value.binary.dimensions = [0];
    expect(validate(value)).toBe(false);
  });

  it('PNG 必须声明图像元数据，JSON 不允许伪装为裸数组', () => {
    const validate = validator('file');
    const value = {
      ...example.manifest.files[0],
      path: 'terrain/height16.png',
      mediaType: 'image/png',
    };
    expect(validate(value)).toBe(false);
    value.image = { width: 513, height: 513, bitDepth: 16, channels: 1 };
    expect(validate(value)).toBe(true);
    value.image.width = 4097;
    expect(validate(value)).toBe(false);
    const json = {
      ...example.manifest.files[0],
      binary: { componentType: 'uint8', byteOrder: 'none', dimensions: [1], elementCount: 1 },
    };
    expect(validate(json)).toBe(false);
  });

  it('主动排除模型无路径，视觉实例禁止二次变换字段', () => {
    const validateModel = validator('model');
    const excluded = structuredClone(example.documents.models[1]);
    expect(validateModel(excluded)).toBe(true);
    excluded.path = 'models/example.glb';
    expect(validateModel(excluded)).toBe(false);
    const instance = structuredClone(example.documents.instances[0]);
    instance.scale = 0;
    expect(validator('instance')(instance)).toBe(false);
    instance.scale = 1;
    instance.assetYaw = 0.5;
    expect(validator('instance')(instance)).toBe(false);
  });

  it('材质版本、四层顺序与纹理色彩空间固定', () => {
    for (const name of ['surfaceMaterial', 'waterMaterial']) {
      const value = structuredClone(example.documents[name]);
      value.version = 2;
      expect(validator(name)(value)).toBe(false);
    }
    const surface = structuredClone(example.documents.surfaceMaterial);
    surface.layers.reverse();
    expect(validator('surfaceMaterial')(surface)).toBe(false);
    surface.layers.reverse();
    surface.layers[0].normal.colorSpace = 'srgb';
    expect(validator('surfaceMaterial')(surface)).toBe(false);
    surface.layers[0].normal.colorSpace = 'linear';
    surface.layers[0].normal.path = surface.layers[0].color.path;
    expect(validator('surfaceMaterial')(surface)).toBe(true);
    surface.layers[0].color.colorSpace = 'linear';
    expect(validator('surfaceMaterial')(surface)).toBe(false);
  });

  it('无水面允许空 primitive，存在网格时必须有顶点描述', () => {
    const validate = validator('water');
    const value = structuredClone(example.documents.water);
    value.mesh = null;
    expect(validate(value)).toBe(false);
    value.primitives = [];
    expect(validate(value)).toBe(true);
    value.mesh = 'water/water.glb';
    expect(validate(value)).toBe(false);
  });

  it('对象 ID 和草种子符合 Uint32 范围，生成器版本必须支持', () => {
    for (const value of [0, -1, 1.5, 4294967296]) expect(validator('id')(value)).toBe(false);
    expect(validator('id')(4294967295)).toBe(true);
    const value = structuredClone(example.documents.grass.layers[0]);
    value.generatorVersion = 2;
    expect(validator('grassLayer')(value)).toBe(false);
    value.generatorVersion = 1;
    value.seed = -1;
    expect(validator('grassLayer')(value)).toBe(false);
  });

  it('未实例化草层保留合成最终变换必需的模型校正', () => {
    const value = structuredClone(example.documents.grass.layers[0]);
    delete value.modelTransform;
    expect(validator('grassLayer')(value)).toBe(false);
    value.modelTransform = { yaw: 0, scale: 0, offset: 0 };
    expect(validator('grassLayer')(value)).toBe(false);
    value.modelTransform.scale = 1.5;
    expect(validator('grassLayer')(value)).toBe(true);
  });
});
