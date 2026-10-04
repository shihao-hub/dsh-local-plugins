"""验证「功能分组能不能动态算出来」—— v2，换成最直白的名字段统计。

方法：把每个技能名按 `-` 切成段，生成长度 1~2 的候选前缀，
统计每个前缀覆盖多少个技能，覆盖率达标的前缀就成了一个分组；其余进兜底。

不提任何类目名，看数据自己能长出什么结构。
"""
import os
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")

SKILLS_ROOT = r"C:\Users\29580\.agents\skills"
MIN_GROUP = 3      # 至少覆盖 3 个技能才算一个分组
MIN_PREFIX = 4     # 前缀至少 4 字符，"sh-" 这种太短的不算


def candidates(name: str):
    seg = name.split("-")
    for depth in (1, 2):                 # sh-zed- / lark- / redis- / sh-agy-
        if len(seg) >= depth:
            yield "-".join(seg[:depth]) + "-"


def auto_group(names):
    freq = Counter()
    for n in names:
        for p in set(candidates(n)):
            if len(p) >= MIN_PREFIX + 1:   # 含结尾的 '-'
                freq[p] += 1

    # 贪心：从覆盖面最大的前缀开始，已被分走的技能不再重复计入
    groups, assigned = [], set()
    for prefix, _ in freq.most_common():
        members = [n for n in names if n.startswith(prefix) and n not in assigned]
        if len(members) >= MIN_GROUP:
            groups.append((prefix, sorted(members)))
            assigned.update(members)
    return groups, [n for n in names if n not in assigned]


def main() -> None:
    names = sorted(
        d for d in os.listdir(SKILLS_ROOT)
        if os.path.isdir(os.path.join(SKILLS_ROOT, d)) and not d.startswith(".")
    )
    print(f"输入：{len(names)} 个技能名，零人工类目表\n")
    groups, rest = auto_group(names)

    print(f"{'自动长出来的分组':<16}{'成员数':>6}   成员")
    print("-" * 104)
    for prefix, members in sorted(groups, key=lambda g: -len(g[1])):
        shown = ", ".join(members[:6]) + (f" … 共 {len(members)} 个" if len(members) > 6 else "")
        print(f"{prefix + '*':<16}{len(members):>6}   {shown}")
    print("-" * 104)
    print(f"{'兜底（无共同前缀）':<14}{len(rest):>6}   {', '.join(rest[:10])} …")
    covered = len(names) - len(rest)
    print(f"\n自动覆盖 {covered}/{len(names)}（{covered / len(names):.0%}），"
          f"兜底 {len(rest)} 项，{len(groups) + 1} 个分组，无一项丢失。")


if __name__ == "__main__":
    main()
