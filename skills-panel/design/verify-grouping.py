"""用真实技能目录验证「来源 + 功能」两级分组的动态性。

关键结论要回答两件事：
1. 一级分组（来源）是否纯运行时判定 —— 不依赖任何人工表。
2. 二级分组（功能）到底有多少靠表、多少能自动推出来。
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

SKILLS_ROOT = r"C:\Users\29580\.agents\skills"
CWD = r"C:\Users\29580\Documents\deepseek-harness\default-workspace"

# 用户技能根：一级分组的全部依据。不在这里、也不在 cwd 下的 → 随应用发布=系统内置。
USER_ROOTS = [
    os.path.join(os.path.expanduser("~"), ".agents", "skills"),
    os.path.join(os.path.expanduser("~"), ".claude", "skills"),
    os.path.join(os.path.expanduser("~"), ".codex", "skills"),
    os.path.join(os.path.expanduser("~"), "agents-skills"),
]


def norm(p: str) -> str:
    return os.path.normcase(os.path.normpath(p))


def skill_source(path: str, cwd: str) -> str:
    """纯运行时判定：只看路径，无表。最长前缀优先。"""
    p = norm(path)
    roots = [(norm(r), "用户安装") for r in USER_ROOTS]
    roots.append((norm(cwd), "当前项目"))
    best = None
    for root, label in roots:
        if p == root or p.startswith(root + os.sep):
            if best is None or len(root) > len(best[0]):
                best = (root, label)
    return best[1] if best else "系统内置"


# 二级分组：前缀表（有序，先匹配先命中）
RULES = [
    ("飞书 / Lark", ("lark-",)),
    ("Redis", ("redis-",)),
    ("Zed 编辑器", ("sh-zed-",)),
    ("Agent 工作流", ("sh-agy-",)),
    ("Windows 装机与排障", ("sh-windows-", "sh-pwsh7-", "sh-disk-space-", "sh-uwp-",
                            "sh-atuin-", "sh-sublime-", "sh-chrome-", "sh-cc-switch-")),
    ("文档 / 归档 / 转写", ("sh-tech-doc-", "sh-office-extract-", "sh-image-watermark-",
                            "sh-troubleshooting-recap", "sh-web-archive", "sh-video-transcribe",
                            "sh-lark-chat-archive", "sh-lark-session-doc")),
    ("开发流程与协作", ("sh-github-", "sh-monorepo-", "sh-spec-driven-", "sh-plan-driven-",
                        "sh-claude-plan-", "sh-codex-plugin-", "sh-sql-query-", "sh-bruno-",
                        "sh-cluacpp-", "sh-pystand-", "sh-agent-handoff", "sh-backend-design",
                        "sh-frontend-deai")),
]


def category(name: str) -> str:
    for label, prefixes in RULES:
        if any(name.startswith(p) for p in prefixes):
            return label
    # 兜底：不用人工表也能给出一个可读的自动分组
    seg = name.split("-")
    if name.startswith("sh-") and len(seg) >= 2:
        return f"sh-{seg[1]}（自动）"
    return "未归类"


def main() -> None:
    names = sorted(
        d for d in os.listdir(SKILLS_ROOT)
        if os.path.isdir(os.path.join(SKILLS_ROOT, d)) and not d.startswith(".")
    )
    print(f"实测技能目录：{len(names)} 个\n")

    # 一级：动态判定
    by_source = {}
    for n in names:
        path = os.path.join(SKILLS_ROOT, n, "SKILL.md")
        by_source.setdefault(skill_source(path, CWD), []).append(n)
    for src, items in by_source.items():
        print(f"[一级] {src}: {len(items)}")

    # 二级：在「用户安装」内部分组
    user_items = by_source.get("用户安装", [])
    by_cat = {}
    for n in user_items:
        by_cat.setdefault(category(n), []).append(n)

    print(f"\n二级分组结果（用户安装 {len(user_items)} 项）：")
    for label, items in sorted(by_cat.items(), key=lambda kv: -len(kv[1])):
        flag = "  ← 表外自动兜底，无需改代码" if label.endswith("（自动）") or label == "未归类" else ""
        print(f"  {label:<22} {len(items):>3}{flag}")

    print("\n自动兜底桶明细（说明：这些没进表，但也没被丢掉）：")
    for label, items in sorted(by_cat.items()):
        if label.endswith("（自动）") or label == "未归类":
            print(f"  {label}: {', '.join(items)}")

    covered = sum(len(v) for k, v in by_cat.items()
                  if not (k.endswith("（自动）") or k == "未归类"))
    print(f"\n表内覆盖 {covered}/{len(user_items)}"
          f"（{covered / len(user_items):.0%}），表外兜底 {len(user_items) - covered} 项。")


if __name__ == "__main__":
    main()
