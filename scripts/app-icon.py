#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
#
# Renders an app's adaptive launcher icon (vector background + foreground) to assets/icons/<slug>.svg:
#   python3 scripts/app-icon.py ~/apps/<App>/app/src/main/res assets/icons/<slug>.svg [extra res dirs for @color refs]
# Then add `app_icon: /assets/icons/<slug>.svg` to the app's front matter and run ruby scripts/og.rb.
import re, sys, glob, os
import xml.etree.ElementTree as ET

A = "{http://schemas.android.com/apk/res/android}"
AAPT = "{http://schemas.android.com/aapt}"

class Ctx:
    def __init__(self, res_dirs):
        self.res_dirs = res_dirs
        self.colors = {}
        for rd in res_dirs:
            for f in glob.glob(os.path.join(rd, "values", "*.xml")):
                try:
                    root = ET.parse(f).getroot()
                except ET.ParseError:
                    continue
                for c in root.iter("color"):
                    self.colors.setdefault(c.get("name"), (c.text or "").strip())
        self.defs = []
        self.n = 0

    def uid(self, p):
        self.n += 1
        return f"{p}{self.n}"

    def color(self, v):
        if v is None:
            return None, 1.0
        v = v.strip()
        for _ in range(5):
            if v.startswith("@color/") or v.startswith("@android:color/"):
                name = v.split("/", 1)[1]
                if v.startswith("@android:color/"):
                    v = {"white": "#FFFFFF", "black": "#000000", "transparent": "#00000000"}.get(name, "#000000")
                else:
                    v = self.colors.get(name)
                    if v is None:
                        raise KeyError(f"color {name}")
            else:
                break
        h = v.lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) == 4:
            h = "".join(c * 2 for c in h)
        if len(h) == 8:
            a = int(h[:2], 16) / 255
            return "#" + h[2:], a
        return "#" + h, 1.0

    def drawable(self, ref):
        name = ref.split("/", 1)[1]
        for rd in self.res_dirs:
            for sub in ("drawable", "drawable-anydpi", "drawable-v24", "drawable-anydpi-v24", "drawable-v26", "mipmap-anydpi", "mipmap-anydpi-v26"):
                f = os.path.join(rd, sub, name + ".xml")
                if os.path.exists(f):
                    return ET.parse(f).getroot()
        raise FileNotFoundError(ref)

def fnum(v, d=0.0):
    if v is None:
        return d
    return float(re.sub(r"(dp|dip|px)$", "", v))

def gradient(ctx, g, alpha=1.0):
    gid = ctx.uid("g")
    t = g.get(A + "type", "linear")
    stops = []
    items = g.findall("item")
    if items:
        for it in items:
            c, a = ctx.color(it.get(A + "color"))
            stops.append((float(it.get(A + "offset", "0")), c, a))
    else:
        for key, off in (("startColor", 0), ("centerColor", 0.5), ("endColor", 1)):
            if g.get(A + key):
                c, a = ctx.color(g.get(A + key))
                stops.append((off, c, a))
    st = "".join(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a*alpha:.3f}"/>' for o, c, a in stops)
    if t == "radial":
        ctx.defs.append(f'<radialGradient id="{gid}" gradientUnits="userSpaceOnUse" cx="{fnum(g.get(A+"centerX"))}" cy="{fnum(g.get(A+"centerY"))}" r="{fnum(g.get(A+"gradientRadius"))}">{st}</radialGradient>')
    else:
        ctx.defs.append(f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{fnum(g.get(A+"startX"))}" y1="{fnum(g.get(A+"startY"))}" x2="{fnum(g.get(A+"endX"))}" y2="{fnum(g.get(A+"endY"))}">{st}</linearGradient>')
    return f"url(#{gid})"

def paint(ctx, el, attr, alpha_attr):
    alpha = fnum(el.get(A + alpha_attr), 1.0)
    for at in el.findall(AAPT + "attr"):
        if at.get("name") == "android:" + attr:
            g = at.find("gradient")
            if g is not None:
                return gradient(ctx, g, alpha), 1.0
    v = el.get(A + attr)
    if v is None:
        return None, 1.0
    c, a = ctx.color(v)
    return c, a * alpha

def path_svg(ctx, p):
    d = p.get(A + "pathData")
    out = [f'<path d="{d}"']
    fill, fa = paint(ctx, p, "fillColor", "fillAlpha")
    out.append(f' fill="{fill}"' if fill else ' fill="none"')
    if fill and fa < 1:
        out.append(f' fill-opacity="{fa:.3f}"')
    if p.get(A + "fillType", "").lower() == "evenodd":
        out.append(' fill-rule="evenodd"')
    stroke, sa = paint(ctx, p, "strokeColor", "strokeAlpha")
    if stroke and fnum(p.get(A + "strokeWidth"), 0) > 0:
        out.append(f' stroke="{stroke}" stroke-width="{fnum(p.get(A+"strokeWidth"))}"')
        if sa < 1:
            out.append(f' stroke-opacity="{sa:.3f}"')
        out.append(f' stroke-linecap="{p.get(A+"strokeLineCap","butt")}" stroke-linejoin="{p.get(A+"strokeLineJoin","miter")}"')
        if p.get(A + "strokeMiterLimit"):
            out.append(f' stroke-miterlimit="{p.get(A+"strokeMiterLimit")}"')
    out.append("/>")
    return "".join(out)

def children_svg(ctx, el):
    parts = []
    clip = None
    for ch in el:
        tag = ch.tag
        if tag == "clip-path":
            cid = ctx.uid("c")
            ctx.defs.append(f'<clipPath id="{cid}"><path d="{ch.get(A+"pathData")}"/></clipPath>')
            clip = cid
            continue
        if tag == "path":
            s = path_svg(ctx, ch)
        elif tag == "group":
            s = group_svg(ctx, ch)
        else:
            continue
        if clip:
            s = f'<g clip-path="url(#{clip})">{s}</g>'
        parts.append(s)
    return "".join(parts)

def group_svg(ctx, g):
    px, py = fnum(g.get(A + "pivotX")), fnum(g.get(A + "pivotY"))
    tx, ty = fnum(g.get(A + "translateX")), fnum(g.get(A + "translateY"))
    sx, sy = fnum(g.get(A + "scaleX"), 1), fnum(g.get(A + "scaleY"), 1)
    r = fnum(g.get(A + "rotation"))
    tf = f"translate({px+tx} {py+ty}) rotate({r}) scale({sx} {sy}) translate({-px} {-py})"
    return f'<g transform="{tf}">{children_svg(ctx, g)}</g>'

def layer_svg(ctx, node):
    """Return SVG content occupying a 108x108 box for a drawable reference or element."""
    if node is None:
        return ""
    tag = node.tag
    if tag == "vector":
        vw, vh = fnum(node.get(A + "viewportWidth")), fnum(node.get(A + "viewportHeight"))
        w, h = fnum(node.get(A + "width"), 108), fnum(node.get(A + "height"), 108)
        tint = node.get(A + "tint")
        body = children_svg(ctx, node)
        # vector of w x h dp drawn into 108 x 108 layer, scaled to fill
        sx, sy = 108 / vw, 108 / vh
        a = fnum(node.get(A + "alpha"), 1.0)
        op = f' opacity="{a}"' if a < 1 else ""
        return f'<g transform="scale({sx} {sy})"{op}>{body}</g>'
    if tag == "shape":
        solid = node.find("solid")
        c, a = ctx.color(solid.get(A + "color")) if solid is not None else ("#FFFFFF", 1)
        g = node.find("gradient")
        fill = gradient_shape(ctx, g) if g is not None else c
        return f'<rect width="108" height="108" fill="{fill}" fill-opacity="{a}"/>'
    if tag == "inset":
        ins = fnum((node.get(A + "inset") or "0").rstrip("%"))
        frac = ins / 100 if (node.get(A + "inset") or "").endswith("%") else ins / 108
        inner = resolve(ctx, node.get(A + "drawable")) if node.get(A + "drawable") else (list(node)[0] if len(node) else None)
        s = 1 - 2 * frac
        return f'<g transform="translate({108*frac} {108*frac}) scale({s})">{layer_svg(ctx, inner)}</g>'
    if tag == "layer-list":
        return "".join(layer_svg(ctx, resolve(ctx, it.get(A + "drawable")) if it.get(A + "drawable") else (list(it)[0] if len(it) else None)) for it in node.findall("item"))
    if tag == "color":
        c, a = ctx.color(node.get(A + "color"))
        return f'<rect width="108" height="108" fill="{c}" fill-opacity="{a}"/>'
    raise ValueError(f"unsupported drawable <{tag}>")

def gradient_shape(ctx, g):
    gid = ctx.uid("g")
    s, a1 = ctx.color(g.get(A + "startColor"))
    e, a2 = ctx.color(g.get(A + "endColor"))
    ang = fnum(g.get(A + "angle"), 0)
    import math
    rad = math.radians(ang)
    x2, y2 = 0.5 + 0.5 * math.cos(rad), 0.5 - 0.5 * math.sin(rad)
    ctx.defs.append(f'<linearGradient id="{gid}" x1="{1-x2}" y1="{1-y2}" x2="{x2}" y2="{y2}"><stop offset="0" stop-color="{s}" stop-opacity="{a1}"/><stop offset="1" stop-color="{e}" stop-opacity="{a2}"/></linearGradient>')
    return f"url(#{gid})"

def resolve(ctx, ref):
    if ref is None:
        return None
    if ref.startswith("@color/") or ref.startswith("#"):
        el = ET.Element("color"); el.set(A + "color", ref); return el
    return ctx.drawable(ref)

def adaptive(ctx, root):
    out = []
    for part in ("background", "foreground"):
        el = root.find(part)
        if el is None:
            continue
        node = resolve(ctx, el.get(A + "drawable")) if el.get(A + "drawable") else (list(el)[0] if len(el) else None)
        out.append(layer_svg(ctx, node))
    return "".join(out)

def main():
    res, out = sys.argv[1], sys.argv[2]
    extra = sys.argv[3:]
    ctx = Ctx([res] + extra)
    icon = None
    for sub in ("mipmap-anydpi", "mipmap-anydpi-v26", "drawable-anydpi-v26", "drawable"):
        f = os.path.join(res, sub, "ic_launcher.xml")
        if os.path.exists(f):
            icon = ET.parse(f).getroot(); break
    if icon is None or icon.tag != "adaptive-icon":
        raise SystemExit("no adaptive ic_launcher.xml")
    body = adaptive(ctx, icon)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="18 18 72 72" width="512" height="512">'
           f'<defs>{"".join(ctx.defs)}</defs>{body}</svg>\n')
    open(out, "w").write(svg)

if __name__ == "__main__":
    main()
