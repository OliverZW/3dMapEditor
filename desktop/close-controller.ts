import { randomUUID } from 'node:crypto';

export class CloseController {
  private pending: string | null = null;
  private approved = false;
  request(send: (id: string) => void): void {
    if (this.pending) return;
    this.pending = randomUUID();
    send(this.pending);
  }
  complete(id: string, allow: boolean): void {
    if (id !== this.pending) throw new Error('关闭请求已失效');
    this.pending = null;
    this.approved = allow;
  }
  consumeApproval(): boolean {
    const value = this.approved;
    this.approved = false;
    return value;
  }
}
