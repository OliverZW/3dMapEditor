import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import { EditorSession } from '../application/editor-session';
import { createDocument } from '../core/document';
import { DesktopProjectSession } from '../application/desktop-project-session';
import type {
  DesktopBridge,
  DesktopProjectHandle,
  RecentProject,
} from '../platform/desktop-contract';
import { App } from './App';
import { MapDimensions } from './MapOverview';
import { Button } from './controls';

export function DesktopHome({ bridge }: { bridge: DesktopBridge }) {
  const [session] = useState(() => new EditorSession(createDocument()));
  const [desktop] = useState(() => new DesktopProjectSession(session, bridge));
  const [editing, setEditing] = useState(false),
    [hasProject, setHasProject] = useState(false);
  const [creating, setCreating] = useState(false),
    [parent, setParent] = useState<DesktopProjectHandle | null>(null);
  const [name, setName] = useState('新地图'),
    [samples, setSamples] = useState(513);
  const [width, setWidth] = useState(2048),
    [depth, setDepth] = useState(2048),
    [example, setExample] = useState(false);
  const [recent, setRecent] = useState<RecentProject[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const runLock = useRef(false);
  const refresh = async () => {
    try {
      setRecent(await bridge.recentList());
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    if (!editing) void refresh();
  }, [editing]);
  useEffect(() => {
    if (editing) return;
    return bridge.onCloseRequest((id) => {
      if (busy) void bridge.finishClose(id, false);
      else void bridge.finishClose(id, true);
    });
  }, [editing, busy, bridge]);
  useEffect(
    () => () => {
      if (parent) void bridge.releaseProject(parent.token);
    },
    [parent, bridge],
  );
  const run = async (operation: () => Promise<boolean>) => {
    if (runLock.current) return;
    runLock.current = true;
    setBusy(true);
    setError('');
    try {
      if (await operation()) {
        setHasProject(true);
        setEditing(true);
        setCreating(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      runLock.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (editing) return;
    return bridge.onOpenProject((handle) => {
      if (busy || runLock.current) {
        void bridge.releaseProject(handle.token);
        setError('请先完成当前操作，再打开工程');
        return;
      }
      void run(() => desktop.open(handle));
    });
  }, [editing, busy, bridge, desktop]);
  if (editing)
    return (
      <App
        initialSession={session}
        initialDesktop={desktop}
        onHome={() => {
          setEditing(false);
          setCreating(false);
        }}
      />
    );
  return (
    <main className="home-screen">
      <div className={`home-content${creating ? ' is-creating' : ''}`}>
        <header className="home-heading">
          <p className="home-brand">
            山河 <small>MAP STUDIO</small>
          </p>
          <h1>三维战略地图编辑器</h1>
          <p>创建三维地理场景，构建你的战略世界</p>
        </header>
        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}
        {creating ? (
          <div className="home-create">
            <h2>创建工程</h2>
            <label className="text-field">
              工程名称
              <input
                aria-label="工程名称"
                value={name}
                maxLength={128}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="home-parent">
              <span>{parent?.directory ?? '尚未选择工程父目录'}</span>
              <Button
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    try {
                      const next = await bridge.selectParent();
                      if (next) setParent(next);
                    } catch (e) {
                      setError(String(e));
                    }
                  })()
                }
              >
                选择父目录
              </Button>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={example}
                onChange={(e) => setExample(e.target.checked)}
              />
              导入示例工程
            </label>
            <fieldset disabled={example || busy} className="home-fields">
              <label className="text-field">
                地形采样
                <select
                  aria-label="地形采样"
                  value={example ? 513 : samples}
                  onChange={(e) => setSamples(Number(e.target.value))}
                >
                  <option value={513}>513 × 513 · 标准</option>
                  <option value={1025}>1025 × 1025 · 高精度</option>
                </select>
              </label>
              <MapDimensions
                width={example ? 2048 : width}
                depth={example ? 2048 : depth}
                onWidth={setWidth}
                onDepth={setDepth}
              />
            </fieldset>
            <p className="palette-note">
              {example
                ? '以示例创建独立副本，原始示例不会被修改。'
                : '创建空白地图，初始高度为 32 米。'}
            </p>
            <div className="home-actions">
              <Button disabled={busy} onClick={() => setCreating(false)}>
                取消
              </Button>
              <Button
                className="primary"
                disabled={
                  busy ||
                  !parent ||
                  !name.trim() ||
                  ![width, depth].every(
                    (v) => example || (Number.isInteger(v) && v > 0 && v <= 16384),
                  )
                }
                onClick={() => {
                  if (parent)
                    void run(() => desktop.create(parent, name, samples, width, depth, example));
                }}
              >
                创建工程
              </Button>
            </div>
          </div>
        ) : (
          <>
            <nav className="home-shortcuts" aria-label="工程操作">
              <button
                className="home-shortcut"
                aria-label="创建工程"
                disabled={busy}
                onClick={() => setCreating(true)}
              >
                <span className="home-shortcut-icon home-shortcut-primary">
                  <Plus size={25} />
                </span>
                <span className="home-shortcut-copy">
                  <strong>创建工程</strong>
                  <small>新建一个地图工程</small>
                </span>
              </button>
              <button
                className="home-shortcut"
                aria-label="打开工程"
                disabled={busy}
                onClick={() => void run(() => desktop.open())}
              >
                <span className="home-shortcut-icon">
                  <FolderOpen size={24} />
                </span>
                <span className="home-shortcut-copy">
                  <strong>打开工程</strong>
                  <small>打开本地工程</small>
                </span>
              </button>
            </nav>
            {hasProject && (
              <div className="home-return">
                <Button disabled={busy} onClick={() => setEditing(true)}>
                  返回编辑器
                </Button>
              </div>
            )}
            {recent.length > 0 && (
              <section className="home-recent">
                <h2>近期工程</h2>
                {recent.map((item) => (
                  <div className="home-recent-row" key={item.id}>
                    <button
                      className="home-project"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => desktop.open(await bridge.recentOpen(item.id)))
                      }
                    >
                      <strong>{item.name}</strong>
                      <span>{item.directory}</span>
                      <small>{new Date(item.openedAt).toLocaleString('zh-CN')}</small>
                    </button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const result = await desktop.open();
                          if (result) {
                            try {
                              if ((await bridge.recentList())[0]?.id !== item.id)
                                await bridge.recentRemove(item.id);
                            } catch (e) {
                              session.message(`工程已打开，旧记录清理失败：${String(e)}`, true);
                            }
                          }
                          return result;
                        })
                      }
                    >
                      重新定位
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void bridge
                          .recentRemove(item.id)
                          .then(refresh)
                          .catch((e) => setError(String(e)))
                      }
                    >
                      移除
                    </Button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
