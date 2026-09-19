# FFmpeg 依赖获取模式调研

核查日期：2026-09-18。仅检查发布者文档及源码，没有安装插件或下载二进制。以下是已找到的实例，不代表市场普及率；`main` 分支链接可能随上游更新。

## 1. CP's Nice Player：先已有安装，再由用户确认下载

- VS Code 插件的解析顺序是：显式 `cp-nice-player.ffmpegPath`（设置后只尝试这个路径，失败不会偷偷换版本）；未设置时尝试 `PATH` 中的 `ffmpeg`，随后尝试插件管理的已下载版本。[解析源码](https://github.com/tanchihpin0517/cp-nice-player/blob/main/src/ffmpegHost.ts)
- 找不到时弹出带下载大小的 `Download FFmpeg`、`Set Path`、`Learn More` 选项，仅选择下载才执行安装；也提供独立下载命令。这是“自动检测 + 一键下载”，不是静默自动下载。[解析及提示源码](https://github.com/tanchihpin0517/cp-nice-player/blob/main/src/ffmpegHost.ts)
- 管理下载仅支持 Linux，使用 BtbN 的固定日期版本及固定 SHA-256；解压 `ffmpeg`、`ffprobe` 至 `<globalStorage>/ffmpeg/<tag>-<arch>/`，暂存后 rename，并执行 `ffmpeg -version` 检查。构建依赖 glibc，不直接支持 Alpine/musl；需要支持 xz 的 tar。macOS/Windows 要自行安装。[上游依赖说明](https://github.com/tanchihpin0517/cp-nice-player/blob/main/docs/ffmpeg.md)
- FFmpeg 运行于 extension host 所在机器；Remote SSH、Containers、WSL、Codespaces 下是远端，不是显示编辑器窗口的本机。[发布者 Marketplace 说明](https://marketplace.visualstudio.com/items?itemName=tanchihpin0517.cp-nice-player)

## 2. ZoyClip：本地检查失败后自动下载

- Obsidian 插件先选存在的用户指定路径，再按 `/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`、`/bin` 查找，最后交给 `PATH`；选定候选后检查 `-encoders` 输出是否包含 `libx264`。并非把每一个系统候选都逐个运行验证。[工具解析源码](https://github.com/zoyluoblue/obsidian-note-to-video/blob/main/src/ffmpeg.ts)
- 用户启动视频生产后，FFmpeg 检查失败会直接调用 `ensureFfmpeg`，没有单独的下载确认对话框；包括已安装 FFmpeg 不满足编码器要求的情况，不仅是完全未安装。[视频流程源码](https://github.com/zoyluoblue/obsidian-note-to-video/blob/main/src/pipeline/assemble.ts)
- 下载只覆盖 macOS，按 arm64/x64 选择 `eugeneware/ffmpeg-static` 的固定 `b6.1.1` 版本；缓存为 `<vault>/<configDir>/plugins/<plugin-id>/runtime/ffmpeg` 和 `ffprobe`，已存在则复用。插件本身为桌面专用。[缓存目录构造](https://github.com/zoyluoblue/obsidian-note-to-video/blob/main/src/pipeline/assemble.ts)、[下载源码](https://github.com/zoyluoblue/obsidian-note-to-video/blob/main/src/runtime.ts)、[项目 README](https://github.com/zoyluoblue/obsidian-note-to-video)
- 该下载实现未见摘要校验或 staging 后原子发布，且会清除 macOS quarantine 属性；它能证明此产品模式存在，但不宜原样照搬为供应链安全方案。[下载源码](https://github.com/zoyluoblue/obsidian-note-to-video/blob/main/src/runtime.ts)

## 3. Homebridge：相反顺序的对照

`homebridge-camera-ffmpeg` 默认优先随依赖提供的 FFmpeg，没有包含版本才回落到系统版本，也允许 `videoProcessor` 显式指定；`ffmpeg-for-homebridge` 的下载发生于插件依赖安装阶段，而不是先检查系统没有后才下载。因此它不是“系统优先、缺失下载”的严格实例。[插件 README](https://github.com/homebridge-plugins/homebridge-camera-ffmpeg/blob/latest/README.md)、[依赖包 README](https://github.com/homebridge/ffmpeg-for-homebridge)

## 对当前设计的建议

另一个 VS Code 实例 ReplayIt 的发布者说明明确写出：启动录屏时，如果 FFmpeg 尚未安装，会自动下载并安装 `eugeneware/ffmpeg-static` 的 `b6.1.1` 构建。本次仅核实发布者文档，未确认其源码搜索顺序、缓存位置和完整性校验，不能把它当作安全实现范例。[ReplayIt Marketplace](https://marketplace.visualstudio.com/items?itemName=learntime.replayit)

建议借鉴 CP's Nice Player 的“显式路径 > host PATH > 管理缓存 > 用户确认下载”策略，而不是复制任何项目的完整实现；固定版本、校验摘要、下载失败可重试即可。缓存放在 extension host 的 `globalStorageUri`，按 host OS/arch 选择构建，并明确 musl 不等于 glibc。[VS Code Remote Extensions 官方指南](https://code.visualstudio.com/api/advanced-topics/remote-extensions)、[CP's Nice Player 实现](https://github.com/tanchihpin0517/cp-nice-player/blob/main/src/ffmpegHost.ts)

Native FFmpeg 的后备路径与已有 Webview/WASM 解码是不同架构选项，不能把“原生工具按需下载”直接当成现有 WASM 包体清理。纯 Web Extension 的浏览器 host 无法启动外部可执行文件，因此仍需保留浏览器可执行的实现，或明确功能只支持 Node extension host。[VS Code Web Extensions 官方指南](https://code.visualstudio.com/api/extension-guides/web-extensions)

本地源码核查：`src/stream-codecs.js:18` 使用 `LibAV` 解码 AAC，`src/stream-worker.js:29` 加载对应 JS/WASM；当前 `src/extension.cjs` 负责原始媒体读取桥接，不启动 FFmpeg。改用系统 FFmpeg 需要新增 host 解码及 PCM/时间戳传输，重新验证四声道保持、seek 和音视频同步。建议保留当前小型 WASM 主链路；原生 FFmpeg 只在将来需要额外编码支持时作为可选后备。依赖检查应有超时、成功缓存和并发合并，避免每次切换媒体重复扫描；下载须按 host OS/arch 选择固定版本、核验可信摘要并原子安装，不改系统 PATH 或要求管理员权限。以上是设计建议，不是已实现功能。

## 可直接读取的原始源码

- [CP's Nice Player ffmpegHost.ts](https://raw.githubusercontent.com/tanchihpin0517/cp-nice-player/main/src/ffmpegHost.ts)
- [CP's Nice Player ffmpeg.md](https://raw.githubusercontent.com/tanchihpin0517/cp-nice-player/main/docs/ffmpeg.md)
- [ZoyClip ffmpeg.ts](https://raw.githubusercontent.com/zoyluoblue/obsidian-note-to-video/main/src/ffmpeg.ts)
- [ZoyClip assemble.ts](https://raw.githubusercontent.com/zoyluoblue/obsidian-note-to-video/main/src/pipeline/assemble.ts)
- [ZoyClip runtime.ts](https://raw.githubusercontent.com/zoyluoblue/obsidian-note-to-video/main/src/runtime.ts)
