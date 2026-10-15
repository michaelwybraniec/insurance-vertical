import { useEffect, useId, useRef, useState } from 'react';
import { select, zoom, zoomIdentity, type ZoomBehavior } from 'd3';
import mermaid from 'mermaid';

let initialized = false;

function ensureMermaid() {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: '"DM Sans", system-ui, sans-serif',
    fontSize: 14,
    themeVariables: {
      primaryColor: 'rgba(232, 242, 238, 0.55)',
      primaryTextColor: '#14241f',
      primaryBorderColor: 'transparent',
      lineColor: '#6b7f76',
      secondaryColor: 'rgba(238, 243, 248, 0.45)',
      tertiaryColor: 'rgba(243, 246, 244, 0.4)',
      background: 'transparent',
      mainBkg: 'rgba(255, 255, 255, 0.45)',
      secondBkg: 'rgba(232, 242, 238, 0.4)',
      nodeBorder: 'transparent',
      clusterBkg: 'transparent',
      clusterBorder: 'transparent',
      titleColor: '#14241f',
      edgeLabelBackground: 'transparent',
      textColor: '#14241f',
      nodeTextColor: '#14241f',
      actorBkg: 'rgba(232, 242, 238, 0.5)',
      actorBorder: 'transparent',
      actorTextColor: '#14241f',
      signalColor: '#3a524a',
      signalTextColor: '#14241f',
      labelBoxBkgColor: 'rgba(255, 255, 255, 0.35)',
      labelBoxBorderColor: 'transparent',
      labelTextColor: '#14241f',
      loopTextColor: '#14241f',
      noteBkgColor: 'rgba(251, 191, 36, 0.16)',
      noteTextColor: '#14241f',
      noteBorderColor: 'transparent',
      activationBkgColor: 'rgba(215, 235, 227, 0.55)',
      activationBorderColor: 'transparent',
      sequenceNumberColor: '#ffffff',
      sectionBkgColor: 'transparent',
      altSectionBkgColor: 'transparent',
      stateBkg: 'rgba(255, 255, 255, 0.4)',
      stateLabelColor: '#14241f',
      transitionColor: '#6b7f76',
      compositeTitleBackground: 'transparent',
    },
    flowchart: {
      curve: 'basis',
      padding: 18,
      htmlLabels: true,
      nodeSpacing: 48,
      rankSpacing: 48,
      diagramPadding: 12,
      useMaxWidth: true,
    },
    sequence: {
      diagramMarginX: 16,
      diagramMarginY: 18,
      actorMargin: 56,
      width: 175,
      height: 48,
      boxMargin: 10,
      useMaxWidth: true,
    },
    state: {
      useMaxWidth: true,
    },
  });
  initialized = true;
}

/**
 * Mermaid 12 SVG ids look like:
 *   nodes:    `{renderId}-flowchart-W-0`
 *   clusters: `{renderId}-EXT`
 */
function mermaidLogicalId(elementId: string): string | null {
  if (!elementId) return null;
  const node = elementId.match(/flowchart-([A-Za-z][\w]*)-(\d+)$/);
  if (node) return node[1] ?? null;
  const cluster = elementId.match(/-([A-Za-z][\w]*)$/);
  return cluster?.[1] ?? null;
}

function sizeSvg(
  el: SVGSVGElement,
  containerWidth: number,
  panZoom: boolean,
  fillWidth = false,
  containerHeight = 0,
  fitPad = 1,
) {
  el.removeAttribute('height');
  el.removeAttribute('style');
  const vb = el.viewBox?.baseVal;
  const fontPx = 14;
  const pad = Math.min(1, Math.max(0.4, fitPad));
  if (fillWidth && vb && vb.width > 0) {
    // Fit inside the host box (width + height) so hero slides do not clip.
    const availW = Math.max(containerWidth, 1);
    const availH = Math.max(containerHeight, 1);
    const scale =
      (containerHeight > 40
        ? Math.min(availW / vb.width, availH / vb.height)
        : availW / vb.width) * pad;
    el.style.width = `${Math.floor(vb.width * scale)}px`;
    el.style.height = `${Math.floor(vb.height * scale)}px`;
    el.style.maxWidth = '100%';
    el.style.maxHeight = '100%';
  } else if (vb && vb.width > 0 && containerWidth > 0) {
    if (panZoom) {
      // Keep natural diagram size; d3-zoom fits it into the viewport.
      el.style.width = `${Math.ceil(vb.width)}px`;
      el.style.maxWidth = 'none';
      el.style.height = 'auto';
    } else {
      const fit = containerWidth / vb.width;
      const readable = 12 / fontPx;
      const scale = Math.min(1, Math.max(fit, readable));
      const px = Math.ceil(vb.width * scale);
      el.style.width = `${px}px`;
      el.style.maxWidth = px > containerWidth ? 'none' : '100%';
      el.style.height = 'auto';
    }
  } else {
    el.style.maxWidth = panZoom ? 'none' : '100%';
    el.style.height = 'auto';
  }
  el.style.display = 'block';
}

function applyHighlights(host: HTMLElement, activeLogicalIds: readonly string[] | undefined) {
  const active = new Set(activeLogicalIds ?? []);
  const hasSelection = active.size > 0;
  host.classList.toggle('has-arch-selection', hasSelection);
  host.querySelectorAll<SVGGElement>('.node, .cluster').forEach((node) => {
    const logical = mermaidLogicalId(node.id);
    const on = logical != null && active.has(logical);
    node.classList.toggle('is-arch-active', on);
    // Never dim non-selected pieces — selection is stroke-only so the full map stays readable.
    node.classList.remove('is-arch-dim');
    node.style.opacity = '1';
  });
}

/** Content bbox in Mermaid local coords (ignores current zoom transform). */
function contentBox(rootEl: SVGGElement, fallbackW: number, fallbackH: number) {
  const prev = rootEl.getAttribute('transform');
  rootEl.removeAttribute('transform');
  let box: DOMRect;
  try {
    box = rootEl.getBBox();
  } catch {
    box = new DOMRect(0, 0, fallbackW, fallbackH);
  }
  if (prev) rootEl.setAttribute('transform', prev);
  else rootEl.removeAttribute('transform');
  const gw = box.width > 1 ? box.width : fallbackW;
  const gh = box.height > 1 ? box.height : fallbackH;
  const ox = box.width > 1 ? box.x : 0;
  const oy = box.height > 1 ? box.y : 0;
  return { gw, gh, ox, oy };
}

/** Fit Mermaid content into a frame where 1 user unit = 1 CSS px. */
function fitTransform(frameW: number, frameH: number, rootEl: SVGGElement, pad = 0.985) {
  const { gw, gh, ox, oy } = contentBox(rootEl, frameW, frameH);
  const fit = Math.min(frameW / gw, frameH / gh) * pad;
  return zoomIdentity
    .translate((frameW - gw * fit) / 2 - ox * fit, (frameH - gh * fit) / 2 - oy * fit)
    .scale(fit);
}

export function Mermaid({
  chart,
  className = '',
  title,
  panZoom = false,
  fillWidth = false,
  fitPad = 1,
  onElementClick,
  activeLogicalIds,
}: {
  chart: string;
  className?: string;
  title?: string;
  /** Enable grab-to-pan and wheel/pinch zoom. */
  panZoom?: boolean;
  /** Stretch the SVG to the full host width (opening / hero charts). */
  fillWidth?: boolean;
  /** 0–1 scale after fit (lower = more zoomed out). */
  fitPad?: number;
  /** Fired with the Mermaid node/subgraph id (e.g. `UI`, `W`). */
  onElementClick?: (logicalId: string) => void;
  /** Logical ids to highlight (nodes and/or clusters). */
  activeLogicalIds?: readonly string[];
}) {
  const fitPadClamped = Math.min(1, Math.max(0.4, fitPad));
  const rawId = useId().replace(/:/g, '');
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<Element, unknown> | null>(null);
  const svgSelRef = useRef<ReturnType<typeof select<Element, unknown>> | null>(null);
  const onClickRef = useRef(onElementClick);
  onClickRef.current = onElementClick;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    let cancelled = false;
    ensureMermaid();
    const render = async () => {
      if (!host.current) return;
      try {
        const id = `mmd-${rawId}-${Math.random().toString(36).slice(2, 9)}`;
        const { svg } = await mermaid.render(id, chart.trim());
        if (!cancelled && host.current) {
          host.current.innerHTML = svg;
          const el = host.current.querySelector('svg');
          if (el) {
            el.setAttribute('role', 'img');
            if (title) el.setAttribute('aria-label', title);
            const box = viewport.current ?? host.current;
            const containerW = box?.clientWidth || 640;
            const containerH = box?.clientHeight || 0;
            sizeSvg(el, containerW, panZoom, fillWidth, containerH, fitPadClamped);

            host.current.querySelectorAll<SVGGElement>('.node, .cluster').forEach((node) => {
              if (panZoom || onClickRef.current) node.style.cursor = 'pointer';
            });

            applyHighlights(host.current, activeLogicalIds);
          }
          setError(null);
          setReady((n) => n + 1);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Diagram failed');
        }
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
    // activeLogicalIds applied in a separate effect after paint
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-render only when chart changes
  }, [chart, rawId, title, panZoom, fillWidth, fitPadClamped]);

  // Re-fit fillWidth diagrams when the hero stage resizes (same slide frame, different chart area).
  useEffect(() => {
    if (!fillWidth || panZoom || !host.current) return;
    const box = viewport.current ?? host.current;
    const el = host.current.querySelector('svg');
    if (!box || !el) return;
    const ro = new ResizeObserver(() => {
      sizeSvg(el, box.clientWidth || 640, panZoom, fillWidth, box.clientHeight || 0, fitPadClamped);
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [fillWidth, panZoom, ready, fitPadClamped]);

  useEffect(() => {
    if (!host.current) return;
    applyHighlights(host.current, activeLogicalIds);
  }, [activeLogicalIds, ready]);

  // Selection via pointerup (not click): d3-zoom preventDefault on mousedown kills click.
  useEffect(() => {
    if (!onElementClick && !panZoom) return;
    const frame = viewport.current ?? host.current;
    if (!frame) return;

    let startX = 0;
    let startY = 0;
    let startTarget: Element | null = null;

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      startTarget = event.target as Element | null;
    };

    const onUp = (event: PointerEvent) => {
      if (event.button !== 0 || !startTarget) return;
      const moved =
        Math.abs(event.clientX - startX) > 6 || Math.abs(event.clientY - startY) > 6;
      const target = startTarget;
      startTarget = null;
      if (moved) return;
      const node = target.closest?.('.node, .cluster');
      if (!node) return;
      const logical = mermaidLogicalId(node.id);
      if (logical) onClickRef.current?.(logical);
    };

    frame.addEventListener('pointerdown', onDown);
    frame.addEventListener('pointerup', onUp);
    return () => {
      frame.removeEventListener('pointerdown', onDown);
      frame.removeEventListener('pointerup', onUp);
    };
  }, [panZoom, onElementClick, ready]);

  const fitRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!panZoom || !host.current || !viewport.current) return;
    const svgEl = host.current.querySelector('svg');
    const frame = viewport.current;
    if (!svgEl) return;

    const svg = select(svgEl as unknown as Element);
    let root = svg.select<SVGGElement>('g.mermaid-zoom-root');
    if (root.empty()) {
      const zoomRoot = svgEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
      zoomRoot.setAttribute('class', 'mermaid-zoom-root');
      // Wrap Mermaid's painted content so zoom does not overwrite its own transforms.
      while (svgEl.firstChild) {
        zoomRoot.appendChild(svgEl.firstChild);
      }
      svgEl.appendChild(zoomRoot);
      root = select(zoomRoot);
    }

    const rootEl = root.node();
    if (!rootEl) return;

    let fitting = false;
    let userZoomed = false;

    const behavior = zoom<Element, unknown>()
      .scaleExtent([0.25, 3.2])
      .filter((event) => {
        const target = event.target as Element | null;
        if (target?.closest?.('.mermaid-zoom-controls')) return false;
        if (event.type === 'wheel') return true;
        return !event.ctrlKey && !event.button;
      })
      .on('zoom', (event) => {
        if (!fitting) userZoomed = true;
        root.attr('transform', event.transform.toString());
      });

    const syncSvgFrame = (width: number, height: number) => {
      // Frame-sized SVG + matching viewBox ⇒ 1 user unit = 1 CSS px of the chart window.
      // Content is then centered via d3 transform (no viewBox meet double-scale).
      svgEl.setAttribute('width', String(width));
      svgEl.setAttribute('height', String(height));
      svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svgEl.style.width = '100%';
      svgEl.style.height = '100%';
      svgEl.style.maxWidth = 'none';
      svgEl.style.maxHeight = 'none';
      svgEl.style.display = 'block';
    };

    const applyFit = () => {
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      if (width < 40 || height < 40) return;
      syncSvgFrame(width, height);
      fitting = true;
      svg.call(behavior.transform, fitTransform(width, height, rootEl, fitPadClamped * 0.98));
      fitting = false;
      userZoomed = false;
    };
    fitRef.current = applyFit;

    svg.call(behavior);
    svg.on('dblclick.zoom', null);
    applyFit();
    zoomRef.current = behavior;
    svgSelRef.current = svg;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
    };
    frame.addEventListener('wheel', onWheel, { passive: false });

    // Re-fit when the chart window changes size (slide layout / browser resize).
    const resizeObserver = new ResizeObserver(() => {
      if (!userZoomed) applyFit();
    });
    resizeObserver.observe(frame);

    // Slides off-screen can measure a stale/zero box — refit when the chart enters view.
    const slide = frame.closest('.guide-slide') ?? frame;
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !userZoomed) applyFit();
      },
      { threshold: 0.2 },
    );
    visibilityObserver.observe(slide);

    return () => {
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      frame.removeEventListener('wheel', onWheel);
      svg.on('.zoom', null);
      zoomRef.current = null;
      svgSelRef.current = null;
      fitRef.current = () => {};
    };
  }, [panZoom, ready, fitPadClamped]);

  const bumpZoom = (factor: number) => {
    const behavior = zoomRef.current;
    const svg = svgSelRef.current;
    if (!behavior || !svg) return;
    behavior.scaleBy(svg, factor);
  };

  const resetZoom = () => {
    fitRef.current();
  };

  return (
    <figure className={`mermaid-figure${panZoom ? ' mermaid-panzoom' : ''} ${className}`.trim()}>
      {title && <figcaption>{title}</figcaption>}
      {error ? (
        <p className="flash error">Diagram could not render: {error}</p>
      ) : panZoom ? (
        <div className="mermaid-viewport" ref={viewport}>
          <div className="mermaid-zoom-controls" aria-label="Diagram zoom">
            <button type="button" onClick={() => bumpZoom(1.2)} aria-label="Zoom in">
              +
            </button>
            <button type="button" onClick={() => bumpZoom(1 / 1.2)} aria-label="Zoom out">
              −
            </button>
            <button type="button" onClick={resetZoom} aria-label="Reset zoom">
              Reset
            </button>
          </div>
          <div className="mermaid-host mermaid-host-panzoom" ref={host} />
        </div>
      ) : (
        <div className="mermaid-host" ref={host} />
      )}
    </figure>
  );
}
