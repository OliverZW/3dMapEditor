import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { initializeBuiltinResources } from './io/builtin-resources';
import './ui/styles.css';
const root = document.getElementById('root')!;
root.textContent = '正在准备地图内置资源…';
void initializeBuiltinResources()
  .then(() => createRoot(root).render(<App />))
  .catch((error: unknown) => {
    root.textContent = `地图内置资源准备失败，请刷新重试。${String(error)}`;
  });
