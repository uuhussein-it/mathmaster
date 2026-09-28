"""Render MCQ option regions from the source PDF as PNGs.

The SAT book prints some options as graphs, tables, or vector/embedded
figures whose text is absent (or unusable) in the extraction layer. For
those questions each option is cropped from the rendered page at 3x zoom
and stored as data/option_imgs/{topic-slug}_{number}_{letter}.png so the
frontend can display them inside the answer buttons.

Run standalone after seed. Config maps (subtopic, number) -> (pdf page
index, pixel cell per letter). Cells are in PDF points; the page column
split for 2x2 layouts is at x ~145 (left page column) in these questions.
"""
import os
import re

import fitz

PDF = os.environ.get("MATHBOOK_PDF", "/Users/hussein/Downloads/MathBook 2.5.pdf")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "option_imgs")

# (subtopic, number): (page index 0-based, {letter: (x0, y0, x1, y1)})
CELLS = {
    ("Linear Functions", 16): (73, {
        "A": (40, 148, 530, 302),
        "B": (40, 303, 530, 452),
        "C": (40, 453, 530, 602),
        "D": (40, 603, 530, 648),
    }),
    ("Linear Functions", 217): (116, {
        "A": (58, 228, 147, 385),
        "B": (58, 385, 147, 470),
        "C": (150, 228, 295, 385),
        "D": (150, 385, 295, 470),
    }),
    ("Linear Functions", 237): (120, {
        "A": (58, 547, 148, 584),
        "B": (58, 584, 148, 620),
        "C": (148, 547, 296, 584),
        "D": (148, 584, 296, 620),
    }),
    ("Research Organizing", 13): (307, {
        "A": (55, 198, 295, 254),
        "B": (55, 254, 295, 316),
        "C": (55, 316, 295, 364),
        "D": (55, 364, 295, 415),
    }),
    ("Quadratics", 133): (225, {
        "A": (58, 742, 148, 770),
        "B": (58, 770, 148, 812),
        "C": (148, 742, 296, 770),
        "D": (148, 770, 296, 812),
    }),
    ("Triangles", 47): (334, {
        "A": (58, 628, 148, 668),
        "B": (58, 668, 148, 710),
        "C": (148, 628, 296, 668),
        "D": (148, 668, 296, 710),
    }),
    ("Trigonometry", 7): (342, {
        "A": (58, 490, 148, 520),
        "B": (58, 520, 148, 560),
        "C": (148, 490, 296, 520),
        "D": (148, 520, 296, 560),
    }),
}


def slug(name):
    return re.sub(r"[^A-Za-z]", "", name)


def render():
    doc = fitz.open(PDF)
    os.makedirs(OUT_DIR, exist_ok=True)
    made = []
    for (topic, number), (page, cells) in CELLS.items():
        pg = doc[page]
        page_rect = pg.rect
        for letter, (x0, y0, x1, y1) in cells.items():
            rect = fitz.Rect(x0, y0, x1, y1) & page_rect
            if rect.is_empty:
                continue
            name = f"{slug(topic)}_{number}_{letter}.png"
            pix = pg.get_pixmap(matrix=fitz.Matrix(3, 3), clip=rect)
            pix.save(os.path.join(OUT_DIR, name))
            made.append(name)
    doc.close()
    print(f"rendered {len(made)} option images -> {OUT_DIR}")


if __name__ == "__main__":
    render()