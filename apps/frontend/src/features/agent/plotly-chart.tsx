"use client";

import { useEffect, useState, type ComponentType } from "react";

type PlotlyChartProps = {
  spec: unknown;
};

type PlotlyFigureSpec = {
  data?: unknown[];
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
  frames?: unknown[];
};

type PlotComponentProps = Record<string, unknown>;
type PlotComponent = ComponentType<PlotComponentProps>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlotlyFigureSpec(spec: unknown): spec is PlotlyFigureSpec {
  return isRecord(spec);
}

function getPlotTitle(layout: Record<string, unknown>): string | null {
  const title = layout.title;
  if (typeof title === "string" && title.trim().length > 0) {
    return title;
  }

  if (isRecord(title) && typeof title.text === "string" && title.text.trim().length > 0) {
    return title.text;
  }

  return null;
}

function buildAxis(axis: unknown) {
  const baseAxis = isRecord(axis) ? axis : {};
  const tickfont = isRecord(baseAxis.tickfont) ? baseAxis.tickfont : {};

  return {
    ...baseAxis,
    automargin: true,
    tickformat: ",.2f",
    separatethousands: true,
    tickfont: {
      size: 12,
      ...tickfont
    }
  };
}

export function PlotlyChart({ spec }: PlotlyChartProps) {
  const [PlotComponent, setPlotComponent] = useState<PlotComponent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadPlotly() {
      try {
        const [{ default: createPlotlyComponent }, { default: plotlyModule }] =
          await Promise.all([
            import("react-plotly.js/factory.js"),
            import("plotly.js-basic-dist-min")
          ]);

        if (!isActive) {
          return;
        }

        setPlotComponent(() => createPlotlyComponent(plotlyModule));
      } catch {
        if (!isActive) {
          return;
        }

        setLoadError("No se pudo cargar el renderer de Plotly.");
      }
    }

    void loadPlotly();

    return () => {
      isActive = false;
    };
  }, []);

  if (!isPlotlyFigureSpec(spec)) {
    return (
      <div className="plotly-shell">
        <div className="plotly-state muted">
          `plotly_spec` recibido con formato no compatible.
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="plotly-shell">
        <div className="plotly-state banner banner-error">{loadError}</div>
      </div>
    );
  }

  if (!PlotComponent) {
    return (
      <div className="plotly-shell">
        <div className="plotly-state muted">Cargando visualizacion...</div>
      </div>
    );
  }

  const layout = isRecord(spec.layout) ? spec.layout : {};
  const config = isRecord(spec.config) ? spec.config : {};
  const frames = Array.isArray(spec.frames) ? spec.frames : undefined;
  const title = getPlotTitle(layout);

  return (
    <div className="plotly-shell">
      {title ? <div className="plotly-title">{title}</div> : null}
      <PlotComponent
        className="plotly-figure"
        config={{
          ...config,
          displaylogo: false,
          responsive: true
        }}
        data={Array.isArray(spec.data) ? spec.data : []}
        frames={frames}
        layout={{
          ...layout,
          autosize: true,
          title: undefined,
          height:
            typeof layout.height === "number" ? layout.height : 320,
          margin: {
            l: 72,
            r: 24,
            t: 16,
            b: 32,
            ...(isRecord(layout.margin) ? layout.margin : {})
          },
          xaxis: buildAxis(layout.xaxis),
          yaxis: buildAxis(layout.yaxis),
          paper_bgcolor: "rgba(0, 0, 0, 0)",
          plot_bgcolor: "rgba(0, 0, 0, 0)"
        }}
        style={{ height: "100%", width: "100%" }}
        useResizeHandler
      />
    </div>
  );
}
