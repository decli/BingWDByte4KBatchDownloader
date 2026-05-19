# Bing WDByte 4K Batch Downloader

用于 [bing.wdbyte.com/zh-cn](https://bing.wdbyte.com/zh-cn/) 的油猴脚本。它会在壁纸列表页的每张缩略图右下角添加复选框，支持多选后批量下载 4K/UHD 图片到用户选择的本地目录。

## 功能

- 在列表页每张缩略图右下角添加复选框。
- 支持多张图片多选。
- 选中图片后显示右侧悬浮「批量下载」按钮。
- 悬浮按钮支持拖动，位置会保存在浏览器本地。
- 点击批量下载后选择保存目录，并按选中顺序依次下载 4K/UHD 图片。
- 自动按 Bing 图片链接中的 `OHR.` 文件名重命名。
- 如果目标目录已存在同名文件，则跳过该图片。
- 下载完成后显示下载目录名、选中数量、成功数量、跳过数量、失败数量。
- 失败 URL 会集中列出，并支持一键复制。

## 安装

1. 安装浏览器扩展：
   - [Tampermonkey](https://www.tampermonkey.net/)
   - 或其他兼容 UserScript 的扩展。
2. 打开脚本文件：
   - [`bing-wdbyte-batch-download.user.js`](./bing-wdbyte-batch-download.user.js)
3. 将脚本内容复制到 Tampermonkey 新脚本中并保存。
4. 打开或刷新 [https://bing.wdbyte.com/zh-cn/](https://bing.wdbyte.com/zh-cn/)。

## 使用

1. 在列表页勾选需要下载的壁纸。
2. 点击右侧悬浮的「批量下载」按钮。
3. 在浏览器弹出的目录选择器中选择保存目录。
4. 等待脚本依次下载完成。
5. 查看结果弹窗中的统计信息和失败 URL。

## 文件命名规则

脚本从 UHD 图片 URL 的 `id` 参数中提取文件名，并移除开头的 `OHR.`。

例如：

```text
https://cn.bing.com/th?id=OHR.SpainLighthouse_ZH-CN6024263415_UHD.jpg&rf=LaDigue_UHD.jpg&pid=hp&w=3840&h=2160&rs=1&c=4
```

保存为：

```text
SpainLighthouse_ZH-CN6024263415_UHD.jpg
```

## 浏览器要求

脚本使用浏览器的 File System Access API 选择本地保存目录并写入文件。建议使用新版 Chrome 或 Edge。

如果当前浏览器不支持目录选择 API，脚本会在结果弹窗中提示无法选择保存目录。

## 说明

- 浏览器安全策略只允许脚本显示用户选择的目录名，不能读取完整磁盘路径。
- 下载请求通过 `GM_xmlhttpRequest` 发起，需要脚本管理器允许访问 `cn.bing.com`。
- 当前脚本主要匹配 `https://bing.wdbyte.com/zh-cn/` 及其归档页面。

## 许可证

MIT
