import argparse
import json
import csv
import os
from collections import Counter
from datetime import datetime
from urllib.parse import unquote
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.patches as mpatches
import numpy as np
from matplotlib.image import imread

# Windows path; on WSL use /mnt/c/Users/Thibault Lechien/Downloads/predictions_rows.csv
CSV_PATH = "/mnt/c/Users/Thibault Lechien/Downloads/predictions_rows.csv"

parser = argparse.ArgumentParser(
    description="Slide picks visualization and leaderboard. "
    "Use --picks to pass the committee's 8 picks for leaderboard and green highlights."
)
parser.add_argument("--picks", "-p", nargs=8, metavar="ID",
                    help="Committee's 8 picked slide IDs (e.g. --picks 28 17 19 35 7 47 10 83)")
args = parser.parse_args()
committee_picks = [str(x) for x in args.picks] if args.picks else []
committee_set = set(committee_picks) if committee_picks else set()
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CANDIDATES_PATH = os.path.join(SCRIPT_DIR, "candidates.json")

# Load candidates: id -> {name, imageUrl}
with open(CANDIDATES_PATH, encoding="utf-8") as f:
    candidates_list = json.load(f)
candidates = {c["id"]: c for c in candidates_list}

def image_path_for(sid):
    c = candidates.get(sid)
    if not c:
        return None
    raw = c["imageUrl"]
    path = os.path.join(SCRIPT_DIR, unquote(raw))
    return path if os.path.isfile(path) else None

def last_name(sid):
    """Extract last name from candidates (format 'Last, First')."""
    name = candidates.get(sid, {}).get("name", "")
    return name.split(",", 1)[0].strip() if "," in name else name

def short_name(full_name):
    """Format 'Last, First' as 'First L.'"""
    if not full_name or full_name == "?":
        return "?"
    parts = [p.strip() for p in full_name.split(",", 1)]
    if len(parts) == 2:
        last, first = parts
        initial = last[0] + "." if last else ""
        return f"{first} {initial}".strip()
    return full_name

# Read CSV and count picks per slide
counts = Counter()
rows_with_time = []
predictions = []
with open(CSV_PATH, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        ids_str = row["selected_ids"]
        ids = json.loads(ids_str)
        for sid in ids:
            counts[sid] += 1
        t = row["created_at"].replace("+00", "+00:00")
        rows_with_time.append({"created_at": datetime.fromisoformat(t), "selected_ids": ids})
        predictions.append({"submitter_name": row["submitter_name"], "selected_ids": ids})

# Sort by count descending, then by last name for ties
sorted_items = sorted(counts.items(), key=lambda x: (-x[1], last_name(x[0])))
slide_ids = [x[0] for x in sorted_items]
pick_counts = [x[1] for x in sorted_items]

# Leaderboard and wisdom of crowd (when committee picks provided)
if committee_set and len(committee_set) == 8:
    scores = []
    for p in predictions:
        hits = sum(1 for sid in p["selected_ids"] if sid in committee_set)
        scores.append({"name": p["submitter_name"], "hits": hits, "total": 8})
    wisdom_ids = [sid for sid, _ in sorted_items[:8]]
    wisdom_hits = sum(1 for sid in wisdom_ids if sid in committee_set)
    scores.append({"name": "Wisdom of the crowd", "hits": wisdom_hits, "total": 8})
    scores.sort(key=lambda x: (-x["hits"], x["name"]))
    print("\n--- Leaderboard (committee picks: %s) ---" % ", ".join(sorted(committee_set)))
    for r, s in enumerate(scores, 1):
        print(f"  {r}. {s['name']}: {s['hits']}/8")

# --- Figure 1: Top slides as images (max 20) ---
N_TOP = min(30, len(sorted_items))
n_cols = 6
n_rows = (N_TOP + n_cols - 1) // n_cols
fig1, axes1 = plt.subplots(n_rows, n_cols, figsize=(2.5 * n_cols, 2.2 * n_rows))
axes1 = np.atleast_2d(axes1)
axes1 = axes1.flatten()
for i, (sid, c) in enumerate(sorted_items[:N_TOP]):
    ax = axes1[i]
    path = image_path_for(sid)
    name = candidates.get(sid, {}).get("name", "?")
    if path:
        try:
            img = imread(path)
            ax.imshow(img)
        except Exception:
            ax.text(0.5, 0.5, "No image", ha="center", va="center")
    else:
        ax.text(0.5, 0.5, "No image", ha="center", va="center")
    ax.set_title(f"{c} picks\n{name}", fontsize=10)
    ax.axis("off")
    if sid in committee_set:
        neon_green = "#39FF14"
        pad = 0.06
        bg = mpatches.Rectangle((-pad, -pad), 1 + 2 * pad, 1.25 + pad, transform=ax.transAxes,
                                fill=True, facecolor=neon_green, alpha=0.5, zorder=100)
        ax.add_patch(bg)
        border = mpatches.Rectangle((-pad, -pad), 1 + 2 * pad, 1.25 + pad, transform=ax.transAxes,
                                    fill=False, edgecolor=neon_green, linewidth=8, zorder=101)
        ax.add_patch(border)
        ax.text(0.5, 0.5, "✓", fontsize=72, color=neon_green, va="center", ha="center",
                transform=ax.transAxes, zorder=102, fontweight="bold")
for j in range(i + 1, len(axes1)):
    axes1[j].axis("off")
fig1.suptitle("The top 30 most predicted", fontsize=16)
fig1.tight_layout(rect=[0, 0, 1, 0.96])
out1 = os.path.join(SCRIPT_DIR, "slide_picks_viz.png")
plt.savefig(out1, dpi=150, bbox_inches="tight")
print("Saved", out1)

# --- Figure 2: Bar chart + distribution ---
fig2, axes2 = plt.subplots(2, 1, figsize=(12, 10))
ax1 = axes2[0]
bar_labels = [short_name(candidates.get(sid, {}).get("name", "?")) for sid in slide_ids]
ax1.bar(range(len(slide_ids)), pick_counts, color="steelblue", edgecolor="navy", alpha=0.8)
ax1.set_xticks(range(len(slide_ids)))
ax1.set_xticklabels(bar_labels, rotation=60, ha="right")
ax1.set_xlabel("Candidate")
ax1.set_ylabel("Number of picks")
ax1.set_title("All predictions")
ax1.grid(axis="y", alpha=0.3)
ax2 = axes2[1]
# Include slides picked 0 times (candidates never picked)
n_zero = len(candidates) - len(counts)
hist_data = list(pick_counts) + [0] * n_zero
# Bins centered on whole integers (0, 1, 2, ...)
max_count = max(pick_counts) if pick_counts else 0
bin_edges = np.arange(-0.5, max_count + 1.5, 1)
ax2.hist(hist_data, bins=bin_edges, color="coral", edgecolor="darkred", alpha=0.8)
ax2.set_xlabel("Number of picks (per slide)")
ax2.set_ylabel("Number of slides")
ax2.set_title("Distribution of pick counts across slides")
ax2.xaxis.set_major_locator(plt.MaxNLocator(integer=True))
ax2.grid(axis="y", alpha=0.3)
plt.tight_layout()
out2 = os.path.join(SCRIPT_DIR, "slide_picks_bars.png")
plt.savefig(out2, dpi=150, bbox_inches="tight")
print("Saved", out2)

# --- Figure 3: Cumulative picks over time (top candidates) ---
rows_with_time.sort(key=lambda r: r["created_at"])
cum = Counter()
history = []
for row in rows_with_time:
    for sid in row["selected_ids"]:
        cum[sid] += 1
    history.append((row["created_at"], cum.copy()))
top_n = 10
top_ids = [sid for sid, _ in sorted_items[:top_n]]
fig3, ax3 = plt.subplots(figsize=(12, 6))
times = [h[0] for h in history]
t_start, t_end = times[0], times[-1]
# Uniform x positions in time: #10 left, #1 right
uniform_times = [t_start + (t_end - t_start) * i / max(1, top_n - 1) for i in range(top_n)]
# Draw all other lines first (grey, faint)
top_ids_set = set(top_ids)
for sid in counts:
    if sid not in top_ids_set:
        ys = [h[1].get(sid, 0) for h in history]
        ax3.plot(times, ys, color="grey", alpha=0.2, lw=1)
# Draw top 10 on top
line_offset = 0.04  # small offset (< 0.5) to separate the 10 lines
for i, sid in enumerate(reversed(top_ids)):
    ys = [h[1].get(sid, 0) for h in history]
    rank = top_n - i  # i=0 is 10th, i=9 is 1st
    label = f"#{rank} {short_name(candidates.get(sid, {}).get('name', '?'))}"
    y_off = i * line_offset
    ys_plot = [y + y_off for y in ys]
    line = ax3.plot(times, ys_plot, alpha=0.85, lw=2, marker="o", markersize=3)[0]
    # Uniform x; interpolate y from neighbors so arrow lands on line
    x_ann = uniform_times[i]
    j = max([k for k in range(len(times)) if times[k] <= x_ann], default=-1)
    if j < 0:
        y_ann = y_off
    elif j < len(times) - 1 and times[j] < times[j + 1]:
        t0, t1 = times[j], times[j + 1]
        y0, y1 = ys_plot[j], ys_plot[j + 1]
        y_ann = y0 + (y1 - y0) * (x_ann - t0).total_seconds() / (t1 - t0).total_seconds()
    else:
        y_ann = ys_plot[j]
    # Offsets: keep close to line, alternating above/below to avoid overlap
    x_off = 3 + i * 0.5
    y_off_txt = 12 * ((-1) ** i) * (i // 2 + 1)
    ax3.annotate(label, xy=(x_ann, y_ann), xytext=(x_off, y_off_txt), textcoords="offset points",
                 fontsize=11, fontweight="bold", ha="left", va="center", color=line.get_color(),
                 bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.85, edgecolor="none"),
                 arrowprops=dict(arrowstyle="->", color=line.get_color(), lw=2, alpha=0.9))
ax3.set_xlabel("Time")
ax3.set_ylabel("Cumulative picks")
ax3.set_title("Cumulative picks over time (top 10 candidates)")
ax3.xaxis.set_major_formatter(mdates.DateFormatter("%A\n%H:%M"))
ax3.xaxis.set_major_locator(mdates.AutoDateLocator())
ax3.grid(True, alpha=0.3)
fig3.autofmt_xdate()
plt.tight_layout()
out3 = os.path.join(SCRIPT_DIR, "slide_picks_cumulative.png")
plt.savefig(out3, dpi=150, bbox_inches="tight")
print("Saved", out3)

# --- Figure 4: Never picked (0 picks) ---
unpicked_ids = [c["id"] for c in candidates_list if c["id"] not in counts]
unpicked_ids.sort(key=lambda sid: last_name(sid))
n_unpicked = len(unpicked_ids)
if n_unpicked > 0:
    n_cols = 5
    n_rows = (n_unpicked + n_cols - 1) // n_cols
    fig4, axes4 = plt.subplots(n_rows, n_cols, figsize=(2.5 * n_cols, 2.2 * n_rows))
    axes4 = np.atleast_2d(axes4)
    axes4 = axes4.flatten()
    for i, sid in enumerate(unpicked_ids):
        ax = axes4[i]
        path = image_path_for(sid)
        name = candidates.get(sid, {}).get("name", "?")
        if path:
            try:
                img = imread(path)
                ax.imshow(img)
            except Exception:
                ax.text(0.5, 0.5, "No image", ha="center", va="center")
        else:
            ax.text(0.5, 0.5, "No image", ha="center", va="center")
        ax.set_title(name, fontsize=9)
        ax.axis("off")
        if sid in committee_set:
            neon_green = "#39FF14"
            pad = 0.06
            bg = mpatches.Rectangle((-pad, -pad), 1 + 2 * pad, 1.25 + pad, transform=ax.transAxes,
                                    fill=True, facecolor=neon_green, alpha=0.5, zorder=100)
            ax.add_patch(bg)
            border = mpatches.Rectangle((-pad, -pad), 1 + 2 * pad, 1.25 + pad, transform=ax.transAxes,
                                        fill=False, edgecolor=neon_green, linewidth=8, zorder=101)
            ax.add_patch(border)
            ax.text(0.5, 0.5, "✓", fontsize=72, color=neon_green, va="center", ha="center",
                    transform=ax.transAxes, zorder=102, fontweight="bold")
    for j in range(i + 1, len(axes4)):
        axes4[j].axis("off")
    fig4.suptitle("The underdogs (not predicted by anyone)", fontsize=12)
    plt.tight_layout()
    out4 = os.path.join(SCRIPT_DIR, "slide_picks_unpicked.png")
    plt.savefig(out4, dpi=150, bbox_inches="tight")
    print("Saved", out4)

plt.show()

print("\nTop 10 most picked slides:")
for sid, c in sorted_items[:10]:
    name = candidates.get(sid, {}).get("name", "?")
    print(f"  Slide {sid} ({name}): {c} picks")
