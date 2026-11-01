import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanDist, inventory } from '../dev-tools/clean-dist.mjs';

describe('发布目录清理', () => {
  it('只清理完整匹配清单的旧版本，保留修改和额外文件', async () => {
    await mkdir('test-results/tests', { recursive: true });
    const dir = await mkdtemp(resolve('test-results/tests/dist-clean-'));
    for (const version of ['1.0.0', '1.0.1', '1.0.2', '1.0.3']) {
      const release = join(dir, `mapEdtor-v${version}`);
      await mkdir(join(release, 'app'), { recursive: true });
      await writeFile(join(release, '启动.exe'), 'original');
      await writeFile(
        join(release, 'app/build-inventory.json'),
        JSON.stringify(await inventory(release)),
      );
    }
    await writeFile(join(dir, 'mapEdtor-v1.0.1', 'user.map3d'), 'user');
    await writeFile(join(dir, 'mapEdtor-v1.0.2', '启动.exe'), 'modified');
    await mkdir(join(dir, 'mapEdtor-v1.0.3', 'empty-user-directory'));
    await cleanDist(dir, 'mapEdtor-v9.0.0', {});
    await expect(stat(join(dir, 'mapEdtor-v1.0.0'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(dir, 'mapEdtor-v1.0.1', 'user.map3d'), 'utf8')).toBe('user');
    expect(await readFile(join(dir, 'mapEdtor-v1.0.2', '启动.exe'), 'utf8')).toBe('modified');
    expect((await stat(join(dir, 'mapEdtor-v1.0.3', 'empty-user-directory'))).isDirectory()).toBe(
      true,
    );
  });
});
