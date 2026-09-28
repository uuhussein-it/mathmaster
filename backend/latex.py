"""Conservative repair of PDF-flattened math text into LaTeX for KaTeX.

Strategy:
  1. Normalize unicode math glyphs (always safe).
  2. Reconstruct the safest patterns (parenthesised powers "(a+b) 2" -> "(a+b)^{2}",
     leading fractions "4 7 x" -> "\\frac{4}{7}x").
  3. Group consecutive "mathy" tokens and wrap them in inline math $...$,
     leaving prose words untouched.

This never produces garbage: unrepairable fragments simply stay as readable,
ordinary text instead of broken LaTeX.
"""
import re

# ---------- glyph normalization (always safe) ----------
GLYPH_MAP = {
    "−": "-", "—": "-", "–": "-", "×": "\\times ", "÷": "\\div ",
    "±": "\\pm ", "π": "\\pi ", "·": "\\cdot ", "∞": "\\infty ",
    "≤": "\\le ", "≥": "\\ge ", "≠": "\\ne ",
    "²": "^2", "³": "^3", "⁴": "^4", "⁵": "^5", "⁶": "^6",
    "⁷": "^7", "⁸": "^8", "⁹": "^9",
}


def normalize_glyphs(text):
    for k, v in GLYPH_MAP.items():
        text = text.replace(k, v)
    return text


# ---------- noise ----------
STRAY_SRC = re.compile(r"\[\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)[^]]*\]")
LEAD_SERIAL = re.compile(r"^\s*\d{1,3}\s+\[[^]]+\]\s*")


def clean_noise(text):
    text = STRAY_SRC.sub("", text)
    text = LEAD_SERIAL.sub("", text)
    text = re.sub(r"@@\s*PAGE\s*\d+\s*@@\s*", " ", text)
    text = re.sub(r"@satashkent\b", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ---------- paren powers:  "( a + b ) 2" -> "( a + b )^{2}" ----------
def repair_paren_superscripts(text):
    return re.sub(r"\)\s+(\d)(?![\d.,a-zA-Z])", lambda m: ")^{%s}" % m.group(1), text)


# ---------- variable powers:  "x 3" / "xy 2" -> "x^{3}" / "xy^{2}" ----------
# Only when the variable stands in a clearly-math position (start of an
# expression, after a bracket/operator/comma) and is not a prose word.
VAR_POWER = re.compile(r"(\A|[=+\-<>,(;:]\s*|\s)([a-z]{1,2})(\s+)(\d)(?![\d.,])")
VAR_STOP = {"is", "to", "of", "in", "at", "by", "or", "no", "an", "on", "as", "be", "we",
            "if", "it", "do", "go", "so", "me", "he", "up", "us", "am", "my", "px", "cm",
            "ft", "hr", "sq"}


def repair_var_superscripts(text):
    def repl(m):
        pre, var, sp, dig = m.group(1), m.group(2), m.group(3), m.group(4)
        if var in VAR_STOP:
            return m.group(0)
        # a plain digit after a variable without a space is already handled
        return "%s%s^{%s}" % (pre, var, dig)

    return VAR_POWER.sub(repl, text)


# ---------- leading fractions:  "4 7 x + 16 = y" -> "\frac{4}{7}x + 16 = y" ----------
def repair_leading_fraction(text):
    m = re.match(r"^\s*(\d{1,3})\s+(\d{1,3})(?=\s+(?![0-9.,]))", text)
    if m:
        n1, n2 = int(m.group(1)), int(m.group(2))
        if 0 < n1 <= 99 and 0 < n2 <= 99:
            return "\\frac{%d}{%d} " % (n1, n2) + text[m.end():]
    return text


STANDALONE_FRAC = re.compile(r"^\s*(-)?\s*(\d{1,3})\s+(\d{1,3})\s*$")


def repair_standalone_fraction(text):
    """'8 3' -> '\\frac{8}{3}', '- 2 5' -> '-\\frac{2}{5}'.

    The PDF renders fractions as stacked glyphs that flatten into two integer
    tokens. When the whole option is exactly a sign plus two integers, a
    fraction is the only sensible reading (SAT options never list two adjacent
    integers for other purposes).
    """
    m = STANDALONE_FRAC.match(text)
    if not m:
        return text
    sign = m.group(1) or ""
    frac = "\\frac{%s}{%s}" % (m.group(2), m.group(3))
    return ("-" + frac) if sign else frac


# ---------- token-class math wrapping ----------
MATHY_TOK = re.compile(r"\d|\\[a-zA-Z]|[()\^=\+\-<>/,.:*]|%")


def tokens(text):
    for m in re.finditer(r"\S+", text):
        yield m.start(), m.end(), m.group(0)


STOPWORDS = {
    "is", "to", "of", "in", "at", "by", "or", "no", "an", "on",
    "as", "be", "we", "if", "it", "do", "go", "so", "me", "he",
    "up", "us", "am", "my", "px", "cm", "ft", "in", "hr", "sq",
}


def is_mathy(tok):
    if not tok:
        return False
    if MATHY_TOK.search(tok):
        return True
    # macro fragments like "x^{3}" contain braces
    if "^{" in tok or "{" in tok:
        return True
    # single / double lowercase letters are likely math variables (x, y, xy)
    if re.fullmatch(r"[a-z]{1,2}", tok):
        return tok.lower() not in STOPWORDS
    return False


def escape_latex(tok):
    return (
        tok.replace("%", "\\%").replace("&", "\\&").replace("_", "\\_")
        .replace("#", "\\#").replace("$", "\\$")
    )


def wrap_math(text):
    if "$" in text:
        return text
    spans = []
    cur = []
    cur_start = None
    cur_end = None
    for start, end, tok in tokens(text):
        if is_mathy(tok):
            if not cur:
                cur_start = start
            cur.append((start, end, tok))
            cur_end = end
        else:
            if cur:
                spans.append((cur_start, cur_end, cur))
                cur = []
    if cur:
        spans.append((cur_start, cur_end, cur))
    if not spans:
        return text.replace("$", "&#36;")
    parts = []
    last = 0
    for start, end, group in spans:
        parts.append(text[last:start].replace("$", "&#36;"))
        inner = " ".join(escape_latex(t) for _, _, t in group)
        if "\\" in inner or "^{" in inner or re.search(r"\d\s*[-+*/=<>]", inner):
            parts.append("$" + inner + "$")
        else:
            parts.append(inner)
        last = end
    parts.append(text[last:].replace("$", "&#36;"))
    return "".join(parts)


# ---------- main ----------
def repair(text):
    if not text:
        return text
    t = normalize_glyphs(text)
    t = clean_noise(t)
    t = repair_paren_superscripts(t)
    t = repair_var_superscripts(t)
    t = repair_leading_fraction(t)
    t = repair_standalone_fraction(t)
    t = re.sub(r" +", " ", t)
    t = wrap_math(t)
    return t


def repair_block(prompt, options):
    return repair(prompt), [repair(o or "") for o in options]