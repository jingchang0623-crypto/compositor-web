# Compositor Web

[Compositor](https://github.com/robbietilton/Compositor)（macOS 开源修图/合成工具，MIT）的 Web 版。
目标与验收见 [GOALS.md](GOALS.md)。在线试用：https://jingchang0623-crypto.github.io/compositor-web/

## 运行

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # 单元测试（manifest 校验、渲染顺序、变换、调整层数学）
npm run build      # 纯静态站点，产物在 dist/
npm run fixture    # 重新生成 public/fixtures/demo.comp(.zip)
npm run g3:materials  # 重新生成 G3 测试素材（public/g3/）
npm run g3:doc     # 从 src/g3/questions.ts 生成 docs/g3/questionnaire.md
```

## 页面

| 地址 | 用途 |
|---|---|
| `/` | 编辑器：新建画布，或拖入 `.comp` 文件夹 / zip；多项目标签页 |
| `/?open=/fixtures/demo.comp.zip` | 直接打开一个 zip 的 `.comp` |
| `/?test=blend` | G0.1：24 种混合模式、5 种调整层、渲染方向，GPU 对 CPU 参考逐像素比对 |
| `/?bench=1` | G0.2 / G0.3：生成 20 层 4000×3000 文档并测帧时（可加 `&layers=&w=&h=`） |
| `/?g3=task` · `survey` · `observe` · `results` | G3 用户测试：任务卡、问卷、观察记录、汇总（见 [docs/g3](docs/g3/README.md)） |

## 能做什么（G2）

- 打开 / 保存桌面版 `.comp`（文件夹或 zip），导入与粘贴图片，导出 PNG / JPEG；自动保存到浏览器，可恢复
- 图层：新建、复制、删除、重命名、拖拽排序、编组，显隐、不透明度、24 种混合模式；蒙版（含从选区建蒙版）
- 移动 / 变换：拖动、手柄缩放、旋转、翻转、数值输入，吸附画布与其他图层
- 画笔 / 橡皮（画像素或蒙版）、矩形 / 椭圆选区、清除与填充
- 调整层：色阶、曲线、色相 / 饱和度、曝光度、反相
- 100 步撤销；快捷键见"帮助 → 快捷键"（或按 ?）

## 操作

| 操作 | 方式 |
|---|---|
| 平移 | 滚轮 / 触控板滚动；抓手工具（H）拖动；任何工具下按住空格拖动 |
| 缩放 | ⌘ 或 ⌥ + 滚轮、双指捏合；缩放工具（Z）单击放大、⌥ 单击缩小、左右拖动平滑缩放 |
| 适配 / 实际像素 | ⌘0 / ⌘1，或双击抓手 / 缩放工具图标；100% = 1 图像像素对 1 屏幕物理像素（同桌面版） |
| 撤销 / 重做 | ⌘Z / ⇧⌘Z |
| 保存 | ⌘S（Chromium 写回文件夹，其他浏览器下载 zip）；⇧⌘S 另存为 |
| 图层 | ⌥⇧⌘N 新建、⌘J 复制、⌘G 编组；图层面板里 ⌫ 删除、Enter 重命名、↑↓ 切换 |
| 画笔 | B / E 切换画笔与橡皮；[ ] 大小；Shift+[ ] 硬度；1…0 不透明度；X 交换颜色 |
| 选区 | M；Shift 加选、Option 减选；⌫ 清除、⌥⌫ 填充前景色；⌘D 取消 |

## 部署

推送到 `main` 后，`.github/workflows/deploy.yml` 会测试、构建并发布到 GitHub Pages（仓库设置里 Pages 来源选 GitHub Actions）。
本地预览 Pages 构建：`BASE=/compositor-web/ npm run build && npx vite preview --base /compositor-web/`。

## G0.4 验证步骤（需要桌面版）

1. 安装桌面版：`brew install --cask robbietilton-compositor`（需要 macOS 26、Apple 芯片）
2. 用桌面版打开 `public/fixtures/demo.comp`，⌘S 保存一次（会写入 `QuickLook/Preview.jpg`）
3. 把 `demo.comp` 拖进 Web 编辑器（或在 Finder 里压缩成 zip 再用「打开 zip」）
4. 右侧「与桌面版预览对比」显示 PSNR，≥ 35dB 即通过

## 代码结构

```
src/model/     .comp manifest v11 的类型与校验（= Web 版数据模型）、渲染顺序与图层变换
src/engine/    WebGL2 合成器：混合模式着色器、调整层查找表、导航缓存、编辑缓存
src/io/        读取 .comp（文件夹 / zip / 拖放）、与桌面版预览图对比
src/bench/     基准文档生成、帧时统计、混合模式自动测试
src/ui/        编辑器界面（React）
tools/         按上游文档写 .comp 夹具
```
