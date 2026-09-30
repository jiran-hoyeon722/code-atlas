export interface Plot {
  id: string;
  name: string;
  area: number;
  crops: string[];
}

export function emptyPlot(id: string): Plot {
  return { id, name: id, area: 1, crops: [] };
}
