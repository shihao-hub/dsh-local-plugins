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
