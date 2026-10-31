import type { ProjectStorage } from '../io/project-storage';
import type { DesktopBridge } from './desktop-contract';

export class DesktopProjectStorage implements ProjectStorage {
  constructor(
    private bridge: DesktopBridge,
    private token: string,
  ) {}
  createRootExclusive() {
    return this.bridge.createRoot(this.token);
  }
  async read(path: string, maxBytes: number) {
    const bytes = await this.bridge.read(this.token, path, maxBytes);
    return bytes === undefined ? undefined : new Uint8Array(bytes);
  }
  writeNew(path: string, bytes: Uint8Array) {
    return this.bridge.writeNew(this.token, path, bytes);
  }
  replaceAtomic(path: string, bytes: Uint8Array, expected?: Uint8Array) {
    return this.bridge.replaceAtomic(this.token, path, bytes, expected);
  }
  list(directory: string) {
    return this.bridge.list(this.token, directory);
  }
  removeFile(path: string) {
    return this.bridge.removeFile(this.token, path);
  }
}
