# panellist-reorder

侧栏面板行（模组 / 技能 / 任务 / 接口 / 画板 / 设置 / 标签）拖拽排序。

按住任意一行上下拖动即可调整位置；松手后顺序写入浏览器 `localStorage`，刷新页面、切换语言、启用或禁用插件后都会保持。

## 为什么走 DOM 而不是注册表

`sidebar.panellist` 的 `order` 只在各插件装配期声明一次（`ctx.slots.register({ order })`），注册表本身只读，`ctx.layout` 也只提供 `selectPanel` / `toggleSidebar` 等导航动作，没有排序入口。所以顺序只能在渲染结果上落地：

1. 拖动时把行抬起（`position: fixed`），原位置用虚线占位块顶住，指针越过某行中线就把占位块插到该行前；
2. 松手时把行插回占位块的位置，收集 `nav` 内所有行的键写入 `localStorage`；
3. `MutationObserver` 监听 body，任何一次宿主重渲染后（语言切换、插件启停、面板重建）按存储顺序再校正一次，已经正确时不动 DOM。

## 行键

行键取自 React 的 `PanelRow` fiber `key`（`plugins` / `skills-panel` / `schedules` / `mcp-panel` / `excalidraw-panel` / `settings-button` / `session-tag-lite`），与插件注册 id 同源，切换界面语言不会丢顺序。fiber 取不到时退回 `aria-label` 文案（键前缀 `label:`）。

新出现的行（新装插件）不在存储里，会先追加到列表末尾，拖一次即可固定。

## DOM 契约与退化

- `nav[class$="_panelList"]`：面板行容器（flex column，`gap: 4px`）
- `button[class$="_panelRow"]`：单行；折叠态不渲染标题 span

CSS Module 类名的 hash 随构建变化、本地类名稳定，故选择器只用 `$=` 匹配后缀。契约不满足时插件不报错，也不改宿主结构，只是不再重排。

## 交互细节

- 指针移动不足 4px 视为点击，不抢面板切换；
- 拖动结束会吞掉紧随其后的那一次 `click`，避免松手顺带切到该面板；
- `settings-button` 插件在行上用捕获阶段拦 click 打开设置，本插件在 `document` 捕获阶段先一步吞掉拖拽后的 click，两者互不干扰。

## 文件

| 文件 | 作用 |
| --- | --- |
| `client.js` | 拖拽、持久化、MutationObserver 校正、样式注入 |
| `index.js` | Host 半，空实现（bundle 只靠 Client 半） |
| `cordis.patch.yml` | 插入 `panellist-reorder` 行 |
| `icon.svg` | 插件图标 |
