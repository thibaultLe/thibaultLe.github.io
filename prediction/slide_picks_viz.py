import json
import csv
import os
from collections import Counter
from urllib.parse import unquote
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.image import imread

# Windows path; on WSL use /mnt/c/Users/Thibault Lechien/Downloads/predictions_rows.csv
CSV_PATH = "/mnt/c/Users/Thibault Lechien/Downloads/predictions_rows.csv"
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
with open(CSV_PATH, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        ids_str = row["selected_ids"]
        ids = json.loads(ids_str)
        for sid in ids:
            counts[sid] += 1

# Sort by count descending for "most picked"
sorted_items = counts.most_common()
slide_ids = [x[0] for x in sorted_items]
pick_counts = [x[1] for x in sorted_items]

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
for j in range(i + 1, len(axes1)):
    axes1[j].axis("off")
plt.tight_layout()
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
ax1.set_title("Slide picks: most picked slides")
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

plt.show()

print("\nTop 10 most picked slides:")
for sid, c in sorted_items[:10]:
    name = candidates.get(sid, {}).get("name", "?")
    print(f"  Slide {sid} ({name}): {c} picks")
