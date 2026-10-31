# rightbar-width（`@local/rightbar-width`）

让 DSH Web 的**左右两栏宽度都固定下来**：左栏在宿主允许的 264–420px 内记忆（默认沿用宿主 280），右栏默认 480px（比宿主的「一半」窄）。拖过一次、设过一次，之后每次打开（含刷新与 `dsh web` 重启）都用同一个宽度。

## 为什么需要它（根因，均从 `dsh-client-ui-layout/lib/client.js` 核实）

宿主把两栏宽度都当**瞬时状态**，只写内存、不落盘：

```js
init: () => ({
  layoutInfo: {
    sidebar: 280,     // ← 每次页面加载都是 280
    rightbar: null,   // ← 每次页面加载都是 null
    ...
  }
}),
setSidebar: (d, px) => { d.layoutInfo.sidebar = clampWidth(px, 264, 420); },
openRightbar: (d, track, fullscreen) => {
  ...
  d.layoutInfo.rightbar ??= Math.max(300, Math.round(d.layoutInfo.viewportWidth * RIGHTBAR_DEFAULT_RATIO));
  ...
}
```

- 左栏：`computeColumns()` 与 `setSidebar()` **两处**都把宽度硬 clamp 在 `264 ～ 420`，初始 280；
- 右栏：`RIGHTBAR_DEFAULT_RATIO = 0.45` —— 首次打开固定 45%，即视觉上的「占一半」；
- 拖动只调 `setSidebar(px)` / `setRightbar(px)` 写内存，**不落盘**：刷新 / 重启后 store 重建，两栏回到默认；
- 宿主 README 也写明：「面板几何是瞬时状态——重新加载会恢复侧栏默认值」。

所以这不是拖拽坏了，也不是左栏不能调——**能拖，但范围只有 264–420，且刷新就忘**。

## 做法

只补持久化，不改宿主几何算法：

| 时机 | 左栏 | 右栏 |
| :--- | :--- | :--- |
| 首次启用（无记录） | 不干预，保持宿主 280。宿主默认值本身合理，无需强改。 | 直接写 `480px` 并落地为记录，解决「每次都一半」。 |
| 插件启动（有记录） | 读 `localStorage['rightbar-width.sidebar']`，`panels.setSidebar(px)`（宿主再 clamp 到 264–420）。 | 读 `localStorage['rightbar-width.width']`；数字就 `panels.setRightbar(px)`。 |
| 拖动分隔条结束 | `pointerdown` 命中 `[data-side="sidebar"]` 时跟踪；`pointerup` 后等两帧量左栏宽度并记入 `rightbar-width.sidebar`。 | `pointerdown` 命中 `[data-side="rightbar"]` 时跟踪；`pointerup` 后量 `[data-rightbar-col]` 的渲染宽度记入 `rightbar-width.width`。 |
| 通用设置 | 「侧栏宽度记忆」一行里左栏一组：`280 / 320 / 360 / 400` 预设、自定义 px（Enter / 失焦应用）、「默认 280」复位。 | 同一行右栏一组：`360 / 420 / 480 / 560` 预设、自定义 px、「跟随宿主 45%」。 |

两栏都**不**用指针位移自己算宽度，一律量宿主 clamp 后的实际渲染值，避免与宿主范围打架。

存储语义：

| 键 | 值 | 含义 |
| :--- | :--- | :--- |
| `rightbar-width.sidebar` | `<数字>` | 左栏固定该 px（读出时再 clamp 到 264–420） |
| | 不存在 | 从未设置：启动不干预，宿主用 280 |
| `rightbar-width.width` | `<数字>` | 右栏固定该 px（启动时写进 layout store） |
| | `"auto"` | 明确「跟随宿主」：启动不干预，每次由宿主按 45% 初始化 |
| | 不存在 | 从未设置：按默认 480 落地 |

右栏「跟随宿主 45%」写 `auto` 而不是删键：否则下次启动又会按「从未设置」套上 480。左栏复位则直接删键，因为「无记录」与「跟随宿主 280」行为完全一致，多一个 `auto` 状态只会多一类分支。

### 左栏宽度怎么量的

右栏有宿主的 `data-rightbar-col` 标记，左栏**没有**等价的 data 属性（列的 class 名带构建 hash，不可依赖）。所以按回退链取值：

1. 找左栏分隔条 `[data-side="sidebar"]`，读它父节点（frame）的 inline `grid-template-columns` 第一段 —— 宿主每次渲染都重写这个值，正是 clamp 后的 `cols.sidebar`；
2. 读不到就退回分隔条的 inline `left`（同样等于 `cols.sidebar`）；
3. 仍拿不到返回 `0`，本次不保存（宁可少存，不存错值）。

### 为什么动 `layout.panels`

`ctx.layout` 的公开面（`ILayout`）只有 `selectPanel / beginNavigation / toggleSidebar / openRightbar / closeRightbar / panelInfo`，**没有** `setRightbar`，也**没有** `setSidebar`。真正的写入是 `LayoutController` 内部字段 `panels` 上的绑定 action：

```js
const layout = new LayoutController(instance.actions, ...);   // instance.actions.setSidebar / setRightbar
```

bundle 未压缩字段名，运行时可直接取到。这属宿主私有契约，故：

- 取不到时（宿主升级改名）返回 `null`，插件整体退化为 no-op，不抛错、不阻断启动；
- 两栏 action 分别探测：旧宿主只暴露其中一个时，另一个静默跳过；
- 不用 React fiber 猜 store，也不复制几何计算。

### 与全屏 / 窄屏的关系

- 只写宽度偏好，不碰 `rightbarShown / rightbarTrack / rightbarFullscreen / narrowExpanded`，全屏与窄屏展开行为不变；
- 窄屏（< 1024px）下左栏是否收起由 `narrowExpanded` 决定，与保存的宽度无关；
- 存的值超限时宿主自己 clamp，下次窗口变宽会恢复原值。

## 已知边界

- **左栏上限就是 420px**（宿主 `computeColumns` / `setSidebar` 写死）。设置里输入 500 会被压回 420；要更宽只能改宿主，本插件不越界 hack（否则拖拽手柄与实际列宽会错位）。
- 左栏在 264–420 内只影响导航栏观感，过宽会挤压中间对话区（`available = viewport - sidebar - 400`）。
- 设置行/布局偏好按**浏览器 profile** 存在 `localStorage`，不同浏览器互不同步；
- 若未来宿主公开了 `layout.setRightbar` / `layout.setSidebar`，把 `resolvePanels()` 换成公开方法即可，其余逻辑不动。

## 验收

```powershell
cd D:\Users\dsh-local-plugins\rightbar-width
node self-test.mjs
```

浏览器内：

1. 清掉两个存储键后刷新：右栏打开为 480（而非 45%），左栏保持 280；
2. 拖左栏分隔条到 360，`F5`：左栏仍是 360；拖右栏到 520，`F5`：右栏仍是 520；
3. 设置 → 通用设置 → 「侧栏宽度记忆」：左栏点 `400` 即刻生效，右栏点 `420` 即刻生效，刷新后都保持；
4. 左栏点「默认 280」：回到 280 且记录被清掉，刷新后仍是 280；
5. 右栏点「跟随宿主 45%」：回到 45%，记录变 `auto`，刷新后仍 45%。

## 安装（profile）

```yaml
# ~/.dsh/profiles/web/package.json → dsh.profile.bundles 追加
"@local/rightbar-width"
```

并在同文件 `dependencies` 加 `"@local/rightbar-width": "link:D:/Users/dsh-local-plugins/rightbar-width"`。

> 包名保留 `rightbar-width` 是为了不破坏 profile 里已有的 link 依赖；插件显示名与设置行已改为「侧栏宽度记忆」，覆盖左右两栏。
