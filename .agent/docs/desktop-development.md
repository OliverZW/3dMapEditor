# Windows 桌面开发与原生工程操作

关联：[资料索引](README.md) · [新版本计划](new-version-plan.md) · [工程格式](map-project-format.md) · [实际验证](implementation.md)。

本页描述网页版开发入口、Electron 桌面调试、平台适配和 Windows 便携版构建。

## 启动与当前操作

准备 Node.js 22.12 或更高版本，在根目录执行 `npm ci`，然后双击 `启动编辑器.cmd` 在浏览器开发。桌面调试可运行：

```sh
npm run dev:desktop
```

该命令先做 TypeScript 检查，将 `desktop/` 转译到忽略跟踪的 `test-results/cache/desktop-runtime`，启动仅监听 `127.0.0.1` 的 Vite 服务，再启动 Electron。端口占用时自动选择可用端口，退出桌面应用后停止该开发服务。启动显示工程首页，进入工程后复用现有编辑器布局。

近期工程和 Chromium 配置保存在当前用户应用数据目录 `ShanheMapEditor`，与其他应用隔离。自动测试使用独立的临时配置目录；安装交付在后续发布步骤配置。

Electron 锁定为 45.2.1。若环境禁止依赖安装脚本、启动提示 Electron 未安装完整，可运行 `node node_modules/electron/install.js` 完成官方运行时安装。运行时下载需联网。

- **保存工程**：首页创建成功后绑定工程目录；Ctrl+S/保存直接生成新的数据版本。自包含 v4 `.map3d` 的底层编解码能力保留，界面不提供备份导出或恢复入口。
- **打开**：通过原生文件选择对话框选择 `project.map3dproj`。校验通过后整体切换；取消、无权限、坏格式、缺失资源和哈希错误均保留当前编辑会话。
- **新建**：首页填写工程名称、父目录、尺寸和采样；默认空白，也可选择以固定示例参数创建独立副本。首版数据校验并提交后进入编辑器。目标目录存在时拒绝覆盖，失败保留原会话。
- **近期工程**：列出最近成功创建或打开的 10 项，记录名称、路径及时间；可移除记录或在路径失效后重新定位，移除不删除工程。
- **关闭窗口**：有未保存修改时提供“保存后继续／放弃并继续／取消”。保存失败、取消目录选择或保存期间产生新编辑，不关闭窗口。存在异步操作或未确认预览时先提示处理该操作，再退出。
- 浏览器开发入口 `启动编辑器.cmd` 和 `npm run dev` 保留；其下载包和 IndexedDB 草稿不作为桌面正式保存。桌面端不自动读取浏览器的全局草稿；目录恢复和会话接口已具备，恢复草稿的用户交互尚未接入。

## 构建便携版

网页源码入口位于 `web/index.html`，Vite 保持项目根目录为工作根；Electron 打包配置位于 `dev-tools/forge.config.cjs`。

Windows x64 上安装 Node.js 22.12+ 并执行 `npm ci`，运行 `构建.cmd` 或 `npm run build`，输出 `dist/mapEdtor-v<版本号>`。复制整个目录后双击 `ShanheMapEditor.exe`；目标电脑需要 Windows 10 或更新的 x64 系统，无需 Node.js。应用直接使用 Electron 运行，缺失运行时文件或系统不兼容时可能由 Windows 报错，无法保证应用启动前显示依赖检查提示。

便携版不注册开始菜单或文件关联，不提供自动更新和签名。配置仍存放在当前用户应用数据目录，工程由用户选择位置；复制应用文件夹不会复制这些数据。现有素材已确认可在目标电脑使用，公开分发前仍须确认分发授权。构建成功后清理内容清单完整匹配的旧构建；有额外或已修改文件时保留并提示。

## 进程与接口边界

- 主进程负责 BrowserWindow、原生对话框、工程根目录授权和文件系统操作；渲染进程不持有 Node API。
- preload 启用上下文隔离与沙箱，只暴露 `window.mapEditorDesktop` 中的固定方法，不暴露 `ipcRenderer`、通用 invoke、任意命令执行或任意绝对路径读写。
- 工程授权使用主进程生成的随机 token，只能由用户选择目录/入口获得；关闭或切换工程后释放。所有 IPC 验证来自同一窗口、主框架和本机开发页面，并验证参数与预算。
- 主进程限制可访问文件为入口、UUID 数据版本、按哈希命名的素材及 `.editor` 草稿/会话文件；删除仅允许标准数据版本文件。路径链中的符号链接和 junction 拒绝，目录和读取大小有预算。
- `DesktopProjectStorage` 将存储接口转为受限 IPC；`DesktopProjectSession` 协调候选打开、快照保存、工程绑定和编辑版本判定；核心算法及 `ProjectRepository` 不引入 Electron/Node 文件 API。
- 打包后通过受限的 `shanhe://editor/` 协议读取应用内资源；开发时仍只允许本机 Vite 页面。页面禁止导航、重定向、新窗口和权限请求，并设置 CSP；禁用刷新快捷键以防绕过未保存保护。主进程关闭请求必须经渲染端确认，重复请求合并，过期确认拒绝。备份文件通过原生对话框选择，渲染端不获得任意文件路径权限。

进程边界参考 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)。既有 Ajv 契约校验使用[官方 standalone 预编译方式](https://ajv.js.org/standalone.html)：Vite/Vitest 插件在开发或构建进程生成静态校验函数，渲染进程不加载 Ajv 编译器、不需要 `unsafe-eval`；协议字段及判定保持不变。GLB 内嵌图片的 blob 读取列入 CSP，但不允许其他来源的脚本或框架。

## 文件提交与故障处理

不可变文件使用独占新建并同步写入；入口先写同目录临时文件并同步，再同卷 rename 替换，绝不降级为删除旧入口再重命名。替换期间使用独占 `.map3d-write.lock`，在锁内比较原入口，跨适配器旧快照不得覆盖新入口。只清理本次生成的临时文件和锁，已提交入口不因辅助清理失败而改报保存失败。

正常退出和错误分支释放文件句柄及写入锁。进程被强制终止时可能留下锁；编辑器不会自动抢占。确认所有写入程序已关闭后，可移除提示中的 `.map3d-write.lock` 再保存；正式打开仍以成功提交的入口为准。

路径检查用于拒绝已存在的越界链接与非标准文件；本轮不承诺在外部恶意进程持续更换目录链接的竞争条件下提供操作系统级隔离，也不声称已验证断电持久性或网络盘原子性。实际验证以实施记录为准。

## 验证命令

### 最终 Windows 发布入口

第 6 步起，Windows 多显卡启动默认优先高性能显卡；显式 `--force_low_power_gpu`／`--force_high_performance_gpu` 仍优先。实现依照 [Electron 官方启动开关](https://www.electronjs.org/docs/latest/api/command-line-switches#--force_high_performance_gpu)，在 ready 前设置，实际路径仍须查看报告。仅有核显或其他驱动的设备不能套用 GTX 1050 的结果；历史第 1～5 步默认 HD 630 的结果保留原条件。

原便携版目录包含 `发布说明.txt`，构建清单同步收录。运行 `npm run prepare:performance-fixture` 后，`npm run test:windows-release-matrix` 串行完成 513²／1025² 与三档的正式矩阵；高精度示例为程序构造目录工程，保留内置资源身份和 LOD。`npm run test:windows-release-interaction` 单独验证最终便携版的平移／环绕／缩放、连续雕刻与取消、撤销重做、原生保存重开及延迟旧草结果跨工程返回；不要与正式采样并行。完整范围与限制见[发布验收](windows-release-performance.md)。

### 发布版性能诊断

当前编辑器首次默认“流畅”，视口左上“画质”选择可切换均衡／高画质并记住本机偏好，具体行为见[显示档位验收](windows-display-quality.md)。性能工具为复现第 1 步原画质，默认显式选择 `--quality=high`；复测产品默认档应指定 `--quality=fast`，也支持 `--quality=balanced`。报告记录实际档位，不能与历史原画质数据混合。

第 3 步后流畅档使用[简化地表](windows-simple-surface.md)。仅做同构建旧地表对照时，使用 `--baseline-only --quality=fast --previous-surface`；此诊断参数不改变产品默认路径或地图，报告通过材质类型和程序标识区分两组。

先构建原有 `dist/mapEdtor-v<版本号>/`，再运行独立采样工具：

```sh
npm run build
npm run test:windows-performance -- --quick
npm run test:windows-performance
```

构建前关闭该发布目录中的程序，避免 Windows 文件占用。工具默认从当前版本的原 dist 启动真实 EXE；可用 `--exe=<路径>` 指定其他便携版。`--quick` 只做工具验证（预热 1 秒、采样 2 秒、一轮），正式基线预热 5 秒、采样 15 秒、重复三轮；第 6 步起预热也显式连续提交，旧报告的静态等待预热按各自条件保留。采样时保持测试窗口前台，失焦、切到后台、文档变化或上下文丢失会使结果无效。

工具使用 `test-results/tests/windows-performance-<时间戳>/` 中的独立配置及通过首页创建的空白／内置示例工程，不读取用户工程或近期记录。报告保存 EXE 对应 `app.asar` 哈希、输入工程入口哈希、显卡及驱动、显示器缩放、绘制缓冲尺寸、图形后端、CPU／GPU 时间、FPS 和 P95。CPU 墙钟耗时可能包含驱动等待；GPU 计时不可用时为空，不能互相替代。

`--baseline-only` 只测当前画质的静止和固定相机平移。`--force-integrated` 添加低功耗显卡开关用于核显对照，与 `--force-discrete` 互斥。`--force-discrete` 显式添加 Electron 官方的 [`--force_high_performance_gpu`](https://www.electronjs.org/docs/latest/api/command-line-switches#--force_high_performance_gpu)，用于多 GPU 设备对照；实际显卡仍以报告为准，不修改 Windows 配置或产品默认设置。

采样工具通过 `MAP_EDITOR_PERFORMANCE_PROBE=1` 请求主进程向 preload 传递固定诊断标识，随后仅在编辑视口中安装受限的 `window.mapEditorPerformance` 诊断对象。正常启动不安装此对象、不加载诊断模块；该入口不暴露 session、Node、任意 IPC 或文件访问，也不进入地图、历史或导出。每个对照重新创建并释放视口，在相同文档、相机和面板布局中只调整指定渲染因素。具体结果及限制见[发布版性能基线](windows-performance-baseline.md)。

### 按需绘制验证

第 4 步新增固定只读 `editor:window-visible` 布尔事件，preload 缓存／回放并提供可取消订阅，主进程根据最小化／隐藏／恢复／显示发送；渲染端不获得窗口控制权。页面可见性与原生状态共同控制调度。

第 4 步后，空场景正常待机停止提交，统计显示“静止 · 按需刷新”；可见水面与近景草继续动画。`npm run test:demand-render` 验证源码交互／异步资源；`npm run test:demand-render-desktop` 验证原 dist 的三轮 15 秒零提交、操作唤醒、隐藏动画层以及真实窗口最小化／恢复。

`test:windows-performance` 的 `sample` 显式强制连续绘制（静止与运动均如此），结果新增 `scheduling=forced-continuous-diagnostic` 标记，结束后恢复按需调度；其静止项测的是连续渲染能力，不能冒充产品待机状态。待机降耗报告使用不调用 `sample` 的真实帧提交计数，分别记录，见[按需绘制验收](windows-demand-rendering.md)。

### 连续编辑性能

第 5 步使用 `npm run test:windows-editing` 在原 dist 中测试实际输入、长任务、撤销／重做及原生保存重开；同源码剖析和算法一致性分别记录。Worker 为 Vite 独立模块资源，通过现有受限协议及 CSP 加载，正常启动不暴露额外编辑／文件诊断权限。方法、子集参数和限制见[连续编辑验收](windows-editing-performance.md)。

### 原生工程与桌面功能

```sh
npx vitest run tests/native-project-storage.test.ts tests/project-storage.test.ts
npm run test:desktop
```

原生测试使用工程内独占的临时目录，覆盖中文路径、移动、原子替换、预算、junction、权限失败和草稿；权限测试仅临时修改自身测试目录 ACL 并在 finally 恢复。桌面交互测试用 Playwright 启动真实 Electron，替换原生对话框返回值以自动选择测试目录，其余过程经过真实 preload、IPC、渲染界面和文件适配。

## 本机渲染与显卡设置

编辑器顶部设置统一管理画质预设和独立渲染开关，首页不提供入口。显卡偏好保存在用户配置目录的 `gpu-preference.json`，通过受信页面限定的读写 IPC 访问，输入仅允许 discrete／integrated／auto。主进程在 ready 前读取并应用，缺省或损坏时使用独显优先并提示；显式 GPU 启动参数优先。修改偏好下次启动生效，不自动退出，实际硬件仍受系统及驱动影响。仅 Windows 允许修改，其他环境禁用此项。

渲染设置见[显示档位](windows-display-quality.md)。`node tests/render-settings-smoke.cjs` 验证设置应用、连续／按需提交、最小化、相机与数据保持及重启偏好；`npm run test:desktop` 包含设置表单的取消、自定义和恢复默认交互。
