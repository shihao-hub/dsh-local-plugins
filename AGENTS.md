# dsh-local-plugins 工作区约定

## DSH Web GUI 视觉验收（每次会话适用）

本仓库的插件验收依赖 chrome-devtools MCP 打开 `http://127.0.0.1:11111`。该 GUI 对浏览器强制会话认证：无 cookie 时一律 401。`dsh web` 的 launch token 只打印在服务进程 stdout，Agent 侧拿不到（`DSH_WEB_URL` 是干净地址，不含 `token=`）。

**不要**向用户索要 token，也不要为截图去检索 token。直接自愈：

0. **先直接导航**：cookie 有效期 30 天且跨 `dsh web` 重启，多数会话直接可用；只有落到 401 页面才继续下面步骤。
1. 生成 cookie（离线签名，脚本不打印 cookie 值；`powershell.exe` 5.1 与 `pwsh` 7 均已实测可跑）：
   ```powershell
   cd D:\Users\dsh-local-plugins
   .\tools\dsh-gui-auth.ps1 -OutFile "$env:TEMP\dsh-gui-cookie.txt"
   ```
   换端口或换 host 时传 `-Authority 127.0.0.1:<port>`：cookie 名与签名都绑定 authority，混用 `localhost` / `127.0.0.1` 视为不同站点。脚本内部会用该 cookie 请求一次 `/`，返回 200 才算成功。
2. 确认当前页面就是该 GUI 的 401 页（必须同源，才能写它的 cookie）。
3. `evaluate_script` 插入一个**透明**文件输入（记住它的 id）：
   `opacity:0; position:fixed; left:0; top:0; width:1px; height:1px`。
   **不要用 `display:none`**——那样元素不进 a11y 树，`take_snapshot` 拿不到 uid，`upload_file` 就无法执行。
4. `take_snapshot` 取该 input 的 uid → `upload_file` 上传第 1 步的 txt。
5. `evaluate_script` 读文件写 cookie（**不要**依赖 `change` 处理器，`upload_file` 不保证触发它）：
   ```js
   async () => {
     const input = document.getElementById('dsh-auth-file');
     const text = (await input.files[0].text()).trim();
     document.cookie = text + '; path=/';
     return { wrote: document.cookie.length > 0 };
   }
   ```
6. `navigate_page` reload；页面标题变成 `DeepSeek Harness` 即认证成功。随后删除该 txt。

原理：cookie 是 `HMAC-SHA256` 签名，密钥持久保存在 `~/.dsh/.credentials.yaml` 的 `client-connection/browser-session` 记录里，与进程无关；有效期 30 天（`cookieMaxAgeDays`）。因此无需 launch token 也能离线重算，且 cookie 一旦写入 MCP 的持久 profile 就跨 `dsh web` 重启有效。凭证只经临时文件与浏览器流动，不进入对话。

> Chrome 侧用独立 profile（`chrome-devtools-mcp\chrome-profile`），与用户日常浏览器完全隔离：验收只动这一份 profile，不会污染用户自己的浏览器数据。

---

## chrome-devtools 浏览器收尾（每次会话适用，硬性）

只要用过 MCP 浏览器（截图、DOM 检查、插件验收都算），**该轮任务一结束就关**，不要留到会话末尾。

两条硬规则：

1. **不得以「稍后还要用 / 等重启再验」为由挂着浏览器。** 确需跨轮保留，先在回复里说明原因并征得用户同意；默认动作永远是关掉、需要时再开（cookie 30 天有效，重开成本只有一条命令）。
2. **收尾必须由 Agent 杀进程组，不能指望用户关窗口。** `chrome-devtools` MCP 在每次工具调用时都会确保浏览器存活：用户把窗口关掉后，Agent 再调一次 `list_pages` / 截图 / 导航，它就会当场拉起一个全新的 Chrome（实测：用户关闭后一次 `list_pages` 就复活了 7 个进程）。

收尾命令（按独立 profile 过滤整组终止，并复核为 0）：

```powershell
$procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*chrome-devtools-mcp\chrome-profile*' }
$procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800
@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*chrome-devtools-mcp\chrome-profile*' }).Count   # 必须是 0
```

- 只杀浏览器进程组；**不要**杀 `chrome-devtools-mcp` 的 node server（父进程是 `dsh web`，随宿主生命周期，关掉它等于废掉 MCP 工具）。
- 收尾后在回复里带一句结果，例如：`MCP 浏览器已关闭：残留 chrome 进程 0`。
- 验收清单的最后一项固定写「关闭浏览器」，避免「代码写完就忘」。`list_pages` 只剩 `about:blank` 不代表可以留着——那个空页就是它拉起的。

---

## 插件显示名元数据（新建 / 重写插件时，硬性）

设置页的插件标题取 `meta.title ?? 包名`。新增插件或重写 `package.json` 时**必须同时补齐 locale 元数据**，否则设置页显示 `@local/xxx`，且全程不报错（静默回退，2026-10 补 21 个插件时踩过）：

- `locale/en.json`：`meta.title`（**入口**，缺它则 `zh.json` 也不生效）
- `locale/zh.json`：`meta.title` + `meta.description`
- `package.json`：`exports` 加 `"./locale/*.json"`，`files` 加 `"locale/*.json"`

自检：`node tools\verify-plugin-locale.mjs`。新增 `locale/` 或改 `exports` 后需重启 `dsh web` 才生效（Node 在进程内缓存包 manifest）；只改文案刷新设置页即可。

回退矩阵与示例见本仓库 [README.md](./README.md) 的「插件显示名与简介（locale 元数据）约定」小节。
