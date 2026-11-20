/**
 * Mermaid rendering helpers shared by the diagram node view, the
 * heading-format gallery and the whole-file heading preview.
 */
import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";

let elkLayoutLoadersRegistered = false;

export function ensureElkLayoutLoaders(): void {
  if (elkLayoutLoadersRegistered) return;
  mermaid.registerLayoutLoaders(elkLayouts);
  elkLayoutLoadersRegistered = true;
}

// Mermaid pre-calculates foreignObject height before HTML layout, so wrapped
// text labels overflow their declared bounds and get clipped. Fix: expand each
// foreignObject to its actual scrollHeight, then recompute the SVG viewBox.
export const fixMermaidViewBox = async (containerEl: HTMLElement): Promise<void> => {
  const svgEl = containerEl.querySelector('svg') as SVGSVGElement | null;
  if (!svgEl) return;

  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

  if (!containerEl.isConnected) return;

  try {
    for (const fo of Array.from(svgEl.querySelectorAll<SVGForeignObjectElement>('foreignObject'))) {
      const inner = fo.firstElementChild as HTMLElement | null;
      if (!inner) continue;
      const declared = parseFloat(fo.getAttribute('height') ?? '0');
      const actual = inner.scrollHeight;
      if (actual > declared + 1) {
        fo.setAttribute('height', String(actual + 2));
      }
    }

    const bbox = svgEl.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      const pad = 8;
      svgEl.setAttribute(
        'viewBox',
        `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`
      );
    }
  } catch {
    // getBBox() unavailable in some environments
  }
};

/** Mermaid settings used by the editor (node view, previews, thumbnails). */
export const initializeMermaidForEditor = (isDark: boolean): void => {
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "loose",
    themeVariables: isDark
      ? {
          // Dark palette — overrides every Mermaid "base" theme color so
          // diagrams stay legible even when the markdown ships its own
          // classDef fill:#... declarations.
          background: "#1a202c",
          primaryColor: "#2d3748",
          primaryTextColor: "#f1f5f9",
          primaryBorderColor: "#94a3b8",
          secondaryColor: "#374151",
          secondaryTextColor: "#f1f5f9",
          secondaryBorderColor: "#94a3b8",
          tertiaryColor: "#1f2937",
          tertiaryTextColor: "#f1f5f9",
          tertiaryBorderColor: "#94a3b8",
          mainBkg: "#2d3748",
          secondBkg: "#374151",
          tertiaryBkg: "#1f2937",
          nodeBorder: "#94a3b8",
          clusterBkg: "#1f2937",
          clusterBorder: "#6b7280",
          defaultLinkColor: "#cbd5e1",
          titleColor: "#f1f5f9",
          edgeLabelBackground: "#1f2937",
          textColor: "#f1f5f9",
          nodeTextColor: "#f1f5f9",
          lineColor: "#cbd5e1",
          labelTextColor: "#f1f5f9",
          labelBackground: "#1f2937",
        }
      : undefined,
  });
};

// Post-process the rendered SVG to force a dark palette. Mermaid's inline
// <style> + classDef styles win against scoped CSS, so we walk the DOM and
// set attributes/inline styles directly — that wins against everything.
const DARK_NODE_FILL = "#2d3748";
const DARK_NODE_STROKE = "#94a3b8";
const DARK_CLUSTER_FILL = "#1f2937";
const DARK_TEXT = "#f1f5f9";
const DARK_EDGE = "#cbd5e1";

export function repaintMermaidDark(container: HTMLElement): void {
  const svg = container.querySelector("svg");
  if (!svg) return;

  // Inject a high-priority style block AFTER Mermaid's own <style>. Cascade
  // order means later rules win on tie — combined with `!important` this
  // beats any classDef-emitted fill without removing Mermaid's own style
  // (which carries marker geometry / display rules we must keep).
  const overrideStyleId = "mermark-mermaid-dark-override";
  let overrideStyle = svg.querySelector(`style#${overrideStyleId}`);
  if (!overrideStyle) {
    overrideStyle = document.createElementNS("http://www.w3.org/2000/svg", "style");
    overrideStyle.id = overrideStyleId;
    svg.appendChild(overrideStyle);
  }
  overrideStyle.textContent = `
    g.node rect, g.node polygon, g.node ellipse, g.node circle, g.node path:not(.arrowMarkerPath),
    .label-container, .basic.label-container {
      fill: ${DARK_NODE_FILL} !important;
      stroke: ${DARK_NODE_STROKE} !important;
    }
    .cluster rect, .cluster polygon {
      fill: ${DARK_CLUSTER_FILL} !important;
      stroke: #6b7280 !important;
    }
    text, tspan { fill: ${DARK_TEXT} !important; }
    foreignObject *, .nodeLabel, .nodeLabel *, .cluster-label *, .edgeLabel * {
      color: ${DARK_TEXT} !important;
    }
    .edgePath path:not(.arrowMarkerPath), .flowchart-link, path.path,
    line, .messageLine0, .messageLine1 {
      stroke: ${DARK_EDGE} !important;
    }
  `;

  const setStyleImportant = (el: SVGElement | HTMLElement, prop: string, val: string) => {
    el.style.setProperty(prop, val, "important");
  };

  const isInsideMarker = (el: Element): boolean => !!el.closest("marker");

  // 1) Every shape inside a node group — flowchart nodes, sequence
  // actors, etc. Walk every rect/polygon/ellipse/circle/path under a
  // .node (no matter how deep), skipping arrow-marker geometry.
  svg.querySelectorAll<SVGElement>(
    "g.node rect, g.node polygon, g.node ellipse, g.node circle, g.node path"
  ).forEach((el) => {
    if (isInsideMarker(el)) return;
    el.setAttribute("fill", DARK_NODE_FILL);
    el.setAttribute("stroke", DARK_NODE_STROKE);
    setStyleImportant(el, "fill", DARK_NODE_FILL);
    setStyleImportant(el, "stroke", DARK_NODE_STROKE);
  });

  // 2) Free-standing label containers Mermaid emits outside .node groups.
  svg.querySelectorAll<SVGElement>(".label-container, .basic.label-container").forEach((el) => {
    el.setAttribute("fill", DARK_NODE_FILL);
    el.setAttribute("stroke", DARK_NODE_STROKE);
    setStyleImportant(el, "fill", DARK_NODE_FILL);
    setStyleImportant(el, "stroke", DARK_NODE_STROKE);
  });

  // 3) Subgraph / cluster backgrounds — slightly darker, distinct border.
  svg.querySelectorAll<SVGElement>(".cluster rect, .cluster polygon, .cluster path").forEach((el) => {
    if (isInsideMarker(el)) return;
    el.setAttribute("fill", DARK_CLUSTER_FILL);
    el.setAttribute("stroke", "#6b7280");
    setStyleImportant(el, "fill", DARK_CLUSTER_FILL);
    setStyleImportant(el, "stroke", "#6b7280");
  });

  // 4) SVG <text> + <tspan> — all label text rendered as plain SVG.
  svg.querySelectorAll<SVGElement>("text, tspan").forEach((el) => {
    if (isInsideMarker(el)) return;
    el.setAttribute("fill", DARK_TEXT);
    setStyleImportant(el, "fill", DARK_TEXT);
  });

  // 5) foreignObject labels — Mermaid renders HTML inside SVG for many
  // diagram types. Force a light color across the entire HTML subtree.
  svg.querySelectorAll<HTMLElement>("foreignObject *").forEach((el) => {
    setStyleImportant(el, "color", DARK_TEXT);
    if (el.style.backgroundColor && el.style.backgroundColor !== "transparent") {
      setStyleImportant(el, "background-color", DARK_CLUSTER_FILL);
    }
  });

  // 6) Edges and arrows — strokes only. Exclude paths inside <marker>
  // (arrow heads) so we don't paint over the marker-defined fill or add
  // an oversized stroke that warps the arrow geometry.
  svg.querySelectorAll<SVGElement>(".edgePath path, .flowchart-link, path.path, line, .messageLine0, .messageLine1").forEach((el) => {
    if (isInsideMarker(el)) return;
    if (el.classList.contains("arrowMarkerPath")) return;
    el.setAttribute("stroke", DARK_EDGE);
    setStyleImportant(el, "stroke", DARK_EDGE);
  });

  // 7) Arrow markers — fill, not stroke.
  svg.querySelectorAll<SVGElement>("marker path, marker polygon").forEach((el) => {
    el.setAttribute("fill", DARK_EDGE);
    setStyleImportant(el, "fill", DARK_EDGE);
  });
}

/** True while the app is in dark mode. */
export const isDocumentDark = (): boolean => document.documentElement.classList.contains("dark");
