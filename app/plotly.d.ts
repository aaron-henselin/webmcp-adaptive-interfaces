declare module 'plotly.js-dist-min' {
  type PlotNode = HTMLElement;
  type PlotlyApi = {
    react: (node: PlotNode, data: Array<Record<string, unknown>>, layout?: Record<string, unknown>, config?: Record<string, unknown>) => Promise<void>;
    purge: (node: PlotNode) => void;
  };

  const Plotly: PlotlyApi;
  export default Plotly;
}
