# sidebar-footer-row

把 dsh 侧栏底部的 footer 从「两行」改回「一行」：**Remote 靠左，重启/退出图标靠右**。

## 为什么要这个插件

`ds-harness-remote` 为了让 Remote 入口独占一行，往页面注入了：

```css
[class*="_footerActions"]:has(.dshRemoteSidebarEntry){
  display:flex!important; flex-direction:column; align-items:stretch
}
```

于是 sidebar 底部变成：

```
[  Remote                    ]   ← 整行按钮（276x36）
[ ⟳ ][ ⏻ ]                      ← app-restart 两个 34x34 图标落到下一行
```

本插件用纯 CSS 覆盖，把它改回单行 flex：

```
[ Remote ]              [ ⟳ ][ ⏻ ]
```

## 实现

- 纯 CSS 注入，**不改 DOM、不挂钩子、无存储**
- 容器恒为单行 flex（`flex-direction: row !important`），**不依赖 Remote 是否存在**
- 透明包裹层（React fragment，实测 `0x0`）保持 `display: contents`，让 Remote 与按钮组成为同级 flex 项
- Remote 用 `flex: 1 1 auto; min-width: 0`，标题过长时省略而不挤压按钮
- 控制按钮组用 `margin-left: auto` **恒定贴右**，锚点是 app-restart 自己的 `.rsr_wrap`，不碰兄弟插件

## Remote 被禁用时会怎样

布局位置保持不变：

```
有 Remote：  [ Remote            ]        [ ⟳ ][ ⏻ ]
无 Remote：                                [ ⟳ ][ ⏻ ]
```

因为「单行」和「贴右」这两条规则都不带 `:has(.dshRemoteSidebarEntry)` 前提。
只有 `gap: 8px` 与 Remote 的 `flex: 1 1 auto` 是条件规则（Remote 不在就没意义）。

## 启用

profile 的 `package.json`：

```json
"@local/sidebar-footer-row": "link:D:/Users/dsh-local-plugins/sidebar-footer-row"
```

`dsh.profile.bundles` 里加 `@local/sidebar-footer-row`，然后在该 profile 目录跑 `pnpm install`，重启 dsh。

## 停用

从 `bundles` 里删掉这一行（dependencies 可留），`pnpm install` 后重启即可，无残留。
