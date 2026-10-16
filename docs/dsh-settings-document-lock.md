# [DSH] web profile 设置写入静默丢失：设置文档被外部程序占用

- **环境**：DeepSeek Harness `0.2.0-rc.2`，`dsh web --port 11111 --no-open`，Windows 11（本机实测）
- **影响面**：`dsh web`（web profile）下**任何**设置写入都不落盘 —— 内置「外观（浅色/深色/跟随系统）」、字号、以及所有插件注册到设置面板的开关；桌面端使用同一 profile 文件时同样受影响
- **表现**：UI 无任何报错。客户端先乐观显示新值，随后被宿主推回的旧值覆盖，刷新后仍是旧值 —— 用户看到的是「点了没反应 / 一会儿自己变回去」
- **定位结论**：profile 的用户设置文档（`profiles/<profile>/cordis.patch.yml`）被外部程序（本例：Zed）持有，导致 DSH 的「临时文件 + 原子 rename」写入被系统拒绝（`EPERM`）

---

## 一、最小复现

1. 用一个外部程序打开 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`（本例是 Zed；设置面板右上角的「打开配置文件」就是把它交给编辑器的入口）
2. 在该 `dsh web` 实例里打开「设置 → 通用设置」，点「深色」（或任意插件开关）
3. **预期**：偏好保存，刷新后保持
   **实际**：界面短暂变化后自行跳回原值，刷新后仍是旧值；控制台、UI 均无提示

## 二、证据

### 1) RPC 层直接报 EPERM（连续 4 次全失败）

```
POST /api/settings/mutate -> 200（HTTP 层 200，RPC 层失败）

settings/rejected: EPERM: operation not permitted, rename
'C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml.8c69325781ba.tmp' ->
'C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml'
```

### 2) 设置文档根本没被改动

写入前后各查一次 `settings/describe`：

```
before      value{preference:"system",fontSize:14}  user{}  revision 0
after set   value{preference:"system",fontSize:14}  user{}  revision 0
```

### 3) 隔离实验：同目录的未占用文件替换成功，被占用的失败

| 操作 | 结果 |
|---|---|
| 同目录下 temp → rename 覆盖一个**无人占用**的文件 | ✅ `rename OK` |
| 同目录下 temp → rename 覆盖 `cordis.patch.yml` | ❌ `Win32 5 Access is denied` |

同时 `CreateFileW(DELETE)` 探测可以拿到 DELETE 权限、独占打开失败 —— 即「句柄存在但删除被拒」的特征（内存映射持有）。

### 4) 占用者（Windows Restart Manager 按文件反查）

```
=== C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml
  exclusive-open: held
  holder pid=43628 app="Zed"
=== C:\Users\<user>\.dsh\profiles\desktop\cordis.patch.yml
  exclusive-open: held
  holder pid=43628 app="Zed"
```

关闭 Zed 后同一操作立刻成功（同一脚本、同一数据集）：

```
before      value{preference:"system"}  user{}                  revision 0
set         ok:true                                             revision 1
after set   value{preference:"dark"}    user{preference:"dark"} revision 1
unset       ok:true                                             revision 2
after unset value{preference:"system"}  user{}                  revision 2
```

## 三、根因

1. web/desktop profile 的**用户设置文档**就是 `profiles/<profile>/cordis.patch.yml`（同一文件既是用户设置载体，又是「打开配置文件」交给编辑器的对象）。
2. 设置写入走「同目录临时文件 + 原子 rename」。
3. Windows 上若目标文件正被其它进程持有（Zed 的映射/句柄），rename 返回 `ACCESS_DENIED`，libuv 映射为 `EPERM`。
4. 客户端 config form 先**本地乐观更新**（`ThemeRuntime.setTheme` 立即 publish），失败后的回滚依赖宿主推送时 `adopt()` 重读持久值 —— 于是表现为「先变、再自己变回去」。

## 四、建议修复方向

1. **失败可见**：把 `settings/rejected` 冒泡到设置面板（行内提示或 toast），不要静默回滚。
2. **写入退化**：rename 遇 `EPERM/EACCES` 时退化为「直接覆写 + 写前备份」，或做有限重试后给出明确错误码。
3. **存储分离**：用户设置（随时被 UI 改写）与「交给外部编辑器打开的配置文件」不应是同一份；若必须共用，至少在被外部占用时探测并提示。
4. **可选**：`settings/openSettingsDocument` 之后对文档做一次「外部占用」探测，避免后续所有写入静默失效。

## 五、下游案例（本机实际触发的现象）

自研插件 `@local/rider-theme`（JetBrains Rider Dark 调色板）的配色走**插件自有 override layer**，不依赖设置文档，所以调色板总能生效；而「深色基座」依赖持久化偏好，必然失败。结果是 **深色 alias token 叠在浅色基座上**：`body[data-ds-dark-theme]` 缺失，代码高亮（`--shiki-*`）与结构性样式仍是浅色，看起来像「主题只应用了一半」。

该插件已加兜底：写不进去时在设置行内给出可见告警（见 `rider-theme/client.js` 的 `persistNotice` 与 `rider-theme/design/test-persist-notice.mjs`），但这是**兜底而非修复**，根因仍在 DSH 侧。

## 六、定位手法（可复用）

- 占用者反查：Windows Restart Manager（`RmStartSession` / `RmRegisterResources` / `RmGetList`），比 `handle.exe` 免安装。
- 影响确认：同目录「未占用文件 vs 目标文件」的 rename 对照实验，即可区分「目录/ACL 问题」与「文件被持有」。
- 端到端确认：直接打 `/api/settings/describe` 与 `/api/settings/mutate`，看 `revision` 是否递增、`user` 是否出现字段。
