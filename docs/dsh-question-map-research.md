# DSH_question_map 插件调研报告

- **目标插件**：`DSH_question_map`
- **仓库地址**：[`https://github.com/huahuazz/DSH_question_map`](https://github.com/huahuazz/DSH_question_map)
- **作者/组织**：`huahuazz`
- **适用平台**：DeepSeek Harness (DSH) Web / Desktop（建议 `dsh >= 0.2.1-rc.2`）

---

## 一、插件核心定位

在 DeepSeek Harness 的长会话/大上下文开发对话中，用户常常需要对 AI 回复中的某个局部术语或片段展开追问。如果在当前会话直接追问，会导致主会话上下文急速膨胀、历史混乱。

`DSH_question_map` 是专为此设计的**局部文本独立追问与问题脉络图谱（Question Map）插件**。

---

## 二、核心功能特性

1. **选区无上下文侧问（Context-Free Side Questions）**
   - 在会话 Transcript 中高亮选中任意文本片段，旁边会弹出 `Ask` 按钮（或通过快捷键 `Alt + Enter` 唤起）。
   - 在独立 Popover 浮窗中开启轻量小会话，仅使用选中文本及紧邻上下文作为输入，**完全不污染、不膨胀主线程的上下文窗口**。

2. **多叉衍生问题网格图谱（Visual Question Grid / Map）**
   - 记录每一次提问所附着的原始文本片段与父级关系。
   - 动态构建全景有向图谱网格（Canvas Grid）：
     - 锚点（Anchors） $\rightarrow$ 根问题（Root Questions） $\rightarrow$ 嵌套子追问（Sub-questions）。
   - 支持在子追问的回答中继续选区提问，实现无上限的多叉树状分支探索。

3. **视觉层级与快速导航**
   - **深度着色**：节点根据树状深度显示不同色彩梯度。
   - **链路高亮**：鼠标悬停在某一节点时，自动高亮其祖先链路（Ancestor Chain）并淡化无关分支。
   - **快速跳转**：点击节点即可平滑滚动/切换至对应的子会话视图；提供浮动圆点（Quick Peek Dot）原地预览内容。

4. **持久化与导出**
   - 节点图谱与状态保存在本地浏览器 `localStorage` 中，跨页面刷新或重启保留。
   - 支持将当前完整的问题网格/拓扑图一键导出为 PNG 高清图片。

---

## 三、安装与接入命令

在本地已配置 DSH 环境下，可通过 DSH 插件 CLI 直接从 GitHub 仓库安装：

### 1. DSH Web 实例
```bash
dsh plugin --profile web add github:huahuazz/DSH_question_map
```
*(若上架至 npm 生态亦支持别名 `dsh plugin --profile web add dsh-question-map`)*

### 2. DSH Desktop 桌面端
```bash
dsh plugin --profile desktop add github:huahuazz/DSH_question_map
```
或者在桌面端 GUI 界面中通过 **设置 (Settings) $\rightarrow$ 插件 (Plugins)** 填入 GitHub 仓库地址进行添加。

---

## 四、信源与参考链接

- **GitHub 官方仓库**：[huahuazz/DSH_question_map](https://github.com/huahuazz/DSH_question_map)
- **DSH 插件规范与生态索引**：DSH 官方插件机制 (`dsh plugin --profile <profile> add`) 与社区分发渠道
